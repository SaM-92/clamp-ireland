-- Independent of 0003 analytics; requires 0001 + 0002.
-- A neighbourhood is a fixed 500m radius from the selected coordinate, NOT a
-- connected component. Existing map circles, locations and scoring are unchanged.
create table public.area_summaries (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_metres int not null default 500 check (radius_metres = 500),
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  source_count int not null check (source_count between 1 and 200),
  source_bytes bigint not null check (source_bytes between 0 and 48000),
  oldest_source_created_at timestamptz not null,
  newest_source_created_at timestamptz not null,
  newest_source_reviewed_at timestamptz not null,
  model text not null default 'gpt-5-mini' check (model = 'gpt-5-mini'),
  contract_version text not null default 'area-summary-v1' check (contract_version = 'area-summary-v1'),
  sentence text not null check (
    char_length(sentence) between 18 and 240
    and sentence ~ '^Reports mention [^.!?]+[.]$'
    and sentence !~ '[[:cntrl:]<>@]'
    and sentence !~* '(https?:|www[.])'
  ),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'stale')),
  generated_at timestamptz not null default statement_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  check (status <> 'approved' or reviewed_at is not null)
);
create index area_summaries_cache_idx on public.area_summaries
  (latitude, longitude, source_fingerprint, model, contract_version);
alter table public.area_summaries enable row level security;
-- No browser policy, table/view grants, or direct service-role writes. All
-- writes use the narrow RPCs below; drafts stay service-only.
revoke all on public.area_summaries from public, anon, authenticated, service_role;
grant select on public.area_summaries to service_role;

create function public.area_summary_sources(p_lat double precision, p_lng double precision)
returns table (
  report_id uuid, location_id uuid, description text, created_at timestamptz,
  reviewed_at timestamptz, latitude double precision, longitude double precision
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_lat is null or p_lng is null or not (p_lat between -90 and 90 and p_lng between -180 and 180) then
    raise exception 'Invalid area summary coordinate';
  end if;
  return query
    select r.id, r.location_id, r.description, r.created_at, r.reviewed_at,
      ST_Y(l.geom::geometry), ST_X(l.geom::geometry)
    from public.reports r
    join public.locations l on l.id = r.location_id
    where r.moderation_status = 'published' and r.reviewed_at is not null and not r.is_removed
      -- Geography distance is metres on the WGS84 spheroid; boundary is inclusive.
      and ST_DWithin(l.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, 500, true)
    order by r.id;
end;
$$;

-- Hash every source, in UUID order, including approved wording, membership,
-- review time and geometry. Only a digest (not notes) is needed for public reads.
create function public.area_summary_source_state(p_lat double precision, p_lng double precision)
returns table (
  source_fingerprint text, source_count bigint, source_bytes bigint,
  oldest_source_created_at timestamptz, newest_source_created_at timestamptz,
  newest_source_reviewed_at timestamptz
)
language sql stable security definer
set search_path = public
set timezone = 'UTC'
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'latitude', p_lat, 'longitude', p_lng, 'radius_metres', 500,
    'source_hashes', coalesce(string_agg(
      encode(sha256(convert_to(to_jsonb(s)::text, 'UTF8')), 'hex'), '' order by s.report_id
    ), '')
  )::text, 'UTF8')), 'hex'),
    count(*), coalesce(sum(octet_length(s.description)), 0)::bigint,
    min(s.created_at), max(s.created_at), max(s.reviewed_at)
  from public.area_summary_sources(p_lat, p_lng) s;
$$;

create function public.get_area_summary_sources(p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql stable security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_state record;
  v_sources jsonb;
begin
  select * into v_state from public.area_summary_source_state(p_lat, p_lng);
  if v_state.source_count = 0 then
    raise exception 'No human-approved published sources in this 500m neighbourhood';
  end if;
  if v_state.source_count > 200 or v_state.source_bytes > 48000 then
    raise exception 'Area summary resource limit exceeded (200 sources / 48000 UTF-8 bytes); no sources truncated';
  end if;
  if not exists (
    select 1 from public.area_summary_sources(p_lat, p_lng) where description ~ '[^[:space:]]'
  ) then
    raise exception 'No approved note text to summarise';
  end if;
  select jsonb_agg(to_jsonb(s) order by s.report_id) into v_sources
    from public.area_summary_sources(p_lat, p_lng) s;
  return to_jsonb(v_state) || jsonb_build_object(
    'latitude', p_lat, 'longitude', p_lng, 'radius_metres', 500, 'sources', v_sources
  );
end;
$$;

create function public.create_area_summary_draft(
  p_lat double precision, p_lng double precision, p_source_fingerprint text, p_sentence text,
  p_regenerate boolean default false
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_id uuid;
begin
  v_snapshot := public.get_area_summary_sources(p_lat, p_lng);
  if p_source_fingerprint is distinct from v_snapshot->>'source_fingerprint' then
    raise exception 'Area summary sources changed; discard generated draft and reload';
  end if;
  -- Reuse only current drafts/approvals of this contract, never rejected/stale
  -- text. Do not overwrite an approved sentence with newly generated wording.
  select id into v_id from public.area_summaries
  where latitude = p_lat and longitude = p_lng and source_fingerprint = p_source_fingerprint
    and model = 'gpt-5-mini' and contract_version = 'area-summary-v1'
    and status in ('draft', 'approved')
    and not p_regenerate
  order by generated_at desc, id desc limit 1;
  if found then return v_id; end if;
  insert into public.area_summaries (
    latitude, longitude, source_fingerprint, sentence, source_count, source_bytes,
    oldest_source_created_at, newest_source_created_at, newest_source_reviewed_at
  ) values (
    p_lat, p_lng, p_source_fingerprint, p_sentence,
    (v_snapshot->>'source_count')::int, (v_snapshot->>'source_bytes')::bigint,
    (v_snapshot->>'oldest_source_created_at')::timestamptz,
    (v_snapshot->>'newest_source_created_at')::timestamptz,
    (v_snapshot->>'newest_source_reviewed_at')::timestamptz
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Editing and approving is one transaction. A stale/unauthorised approval
-- rolls back the edit too; existing approved summaries are never overwritten.
create function public.approve_area_summary_draft(
  p_id uuid, p_reviewer uuid, p_sentence text, p_source_fingerprint text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_summary public.area_summaries;
begin
  select * into v_summary from public.area_summaries where id = p_id for update;
  if not found or v_summary.status <> 'draft'
    or v_summary.source_fingerprint is distinct from p_source_fingerprint then
    raise exception 'Area summary sources changed; reload draft';
  end if;
  update public.area_summaries set sentence = p_sentence where id = p_id;
  perform public.review_area_summary(p_id, p_reviewer, 'approved');
end;
$$;

-- Cross-process admission control, not a global spend cap. At most one
-- generation per exact centre per minute; in-flight leases last 90 seconds.
create table public.area_summary_generation_leases (
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  lease_id uuid not null,
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (latitude, longitude)
);
alter table public.area_summary_generation_leases enable row level security;
revoke all on public.area_summary_generation_leases from public, anon, authenticated, service_role;

create function public.acquire_area_summary_generation(p_lat double precision, p_lng double precision)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.area_summary_generation_leases as leases
    (latitude, longitude, lease_id, requested_at, expires_at)
  values (p_lat, p_lng, gen_random_uuid(), clock_timestamp(), clock_timestamp() + interval '90 seconds')
  on conflict (latitude, longitude) do update
    set lease_id = excluded.lease_id, requested_at = excluded.requested_at, expires_at = excluded.expires_at
    where leases.expires_at <= clock_timestamp()
  returning lease_id into v_id;
  return v_id;
end;
$$;

create function public.release_area_summary_generation(p_lease_id uuid)
returns void
language sql security definer
set search_path = public
as $$
  update public.area_summary_generation_leases
  set expires_at = greatest(requested_at + interval '60 seconds', clock_timestamp())
  where lease_id = p_lease_id;
$$;

create function public.review_area_summary(p_id uuid, p_reviewer uuid, p_decision text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_summary public.area_summaries;
  v_snapshot jsonb;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid area summary review decision';
  end if;
  if not exists (select 1 from public.profiles where id = p_reviewer and is_admin and not is_banned) then
    raise exception 'Area summary review requires an active human administrator';
  end if;
  select * into v_summary from public.area_summaries where id = p_id for update;
  if not found or v_summary.status <> 'draft' then
    raise exception 'Only an existing draft can be reviewed';
  end if;
  if p_decision = 'approved' then
    v_snapshot := public.get_area_summary_sources(v_summary.latitude, v_summary.longitude);
    if v_summary.source_fingerprint is distinct from v_snapshot->>'source_fingerprint' then
      raise exception 'Area summary sources changed; approval blocked';
    end if;
  end if;
  update public.area_summaries
  set status = p_decision, reviewed_at = statement_timestamp(), reviewed_by = p_reviewer
  where id = p_id;
end;
$$;

create function public.get_public_area_summary(p_lat double precision, p_lng double precision)
returns jsonb
language sql stable security definer
set search_path = public
set timezone = 'UTC'
as $$
  select jsonb_build_object(
    'id', a.id, 'latitude', a.latitude, 'longitude', a.longitude, 'radius_metres', a.radius_metres,
    'sentence', a.sentence, 'source_count', a.source_count,
    'oldest_source_created_at', a.oldest_source_created_at,
    'newest_source_created_at', a.newest_source_created_at,
    'newest_source_reviewed_at', a.newest_source_reviewed_at,
    'generated_at', a.generated_at, 'approved_at', a.reviewed_at,
    'model', a.model, 'contract_version', a.contract_version
  )
  from public.area_summaries a
  cross join public.area_summary_source_state(p_lat, p_lng) s
  where a.latitude = p_lat and a.longitude = p_lng
    and a.status = 'approved' and a.reviewed_at is not null
    and a.source_fingerprint = s.source_fingerprint and a.source_count = s.source_count
    and s.source_count between 1 and 200 and s.source_bytes <= 48000
    and a.model = 'gpt-5-mini' and a.contract_version = 'area-summary-v1'
  order by a.reviewed_at desc, a.generated_at desc, a.id desc limit 1;
$$;

-- Permanently stale even if a note is edited/rejected then restored. The
-- fingerprint read gate remains the authority, including concurrent writes.
create function public.invalidate_area_summaries_for_report()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if TG_OP <> 'INSERT' then
    if old.moderation_status = 'published' and old.reviewed_at is not null and not old.is_removed then
      update public.area_summaries a set status = 'stale'
      from public.locations l
      where l.id = old.location_id and a.status in ('draft', 'approved')
        and ST_DWithin(l.geom, ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography, 500, true);
    end if;
  end if;
  if TG_OP <> 'DELETE' then
    if new.moderation_status = 'published' and new.reviewed_at is not null and not new.is_removed then
      update public.area_summaries a set status = 'stale'
      from public.locations l
      where l.id = new.location_id and a.status in ('draft', 'approved')
        and ST_DWithin(l.geom, ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography, 500, true);
    end if;
  end if;
  return null;
end;
$$;
create trigger area_summary_report_insert_delete
after insert or delete on public.reports
for each row execute function public.invalidate_area_summaries_for_report();
create trigger area_summary_report_update
after update of description, location_id, created_at, reviewed_at, moderation_status, is_removed on public.reports
for each row
when (
  (old.description, old.location_id, old.created_at, old.reviewed_at, old.moderation_status, old.is_removed)
  is distinct from
  (new.description, new.location_id, new.created_at, new.reviewed_at, new.moderation_status, new.is_removed)
)
execute function public.invalidate_area_summaries_for_report();

create function public.invalidate_area_summaries_for_location()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update public.area_summaries a set status = 'stale'
  where a.status in ('draft', 'approved')
    and ST_DWithin(old.geom, ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography, 500, true);
  if TG_OP = 'UPDATE' then
    update public.area_summaries a set status = 'stale'
    where a.status in ('draft', 'approved')
      and ST_DWithin(new.geom, ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography, 500, true);
  end if;
  return null;
end;
$$;
-- BEFORE DELETE retains the old geometry even when report deletion cascades.
create trigger area_summary_location_delete
before delete on public.locations
for each row execute function public.invalidate_area_summaries_for_location();
create trigger area_summary_location_update
after update of geom on public.locations
for each row when (old.geom is distinct from new.geom)
execute function public.invalidate_area_summaries_for_location();

-- PostgreSQL otherwise grants new functions EXECUTE to PUBLIC by default.
revoke all on function public.area_summary_sources(double precision, double precision) from public, anon, authenticated;
revoke all on function public.area_summary_source_state(double precision, double precision) from public, anon, authenticated;
revoke all on function public.get_area_summary_sources(double precision, double precision) from public, anon, authenticated;
revoke all on function public.create_area_summary_draft(double precision, double precision, text, text, boolean) from public, anon, authenticated;
revoke all on function public.review_area_summary(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.approve_area_summary_draft(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.acquire_area_summary_generation(double precision, double precision) from public, anon, authenticated;
revoke all on function public.release_area_summary_generation(uuid) from public, anon, authenticated;
revoke all on function public.get_public_area_summary(double precision, double precision) from public, anon, authenticated;
revoke all on function public.invalidate_area_summaries_for_report() from public, anon, authenticated;
revoke all on function public.invalidate_area_summaries_for_location() from public, anon, authenticated;
grant execute on function public.area_summary_sources(double precision, double precision) to service_role;
grant execute on function public.area_summary_source_state(double precision, double precision) to service_role;
grant execute on function public.get_area_summary_sources(double precision, double precision) to service_role;
grant execute on function public.create_area_summary_draft(double precision, double precision, text, text, boolean) to service_role;
grant execute on function public.review_area_summary(uuid, uuid, text) to service_role;
grant execute on function public.approve_area_summary_draft(uuid, uuid, text, text) to service_role;
grant execute on function public.acquire_area_summary_generation(double precision, double precision) to service_role;
grant execute on function public.release_area_summary_generation(uuid) to service_role;
grant execute on function public.get_public_area_summary(double precision, double precision) to anon, authenticated, service_role;
