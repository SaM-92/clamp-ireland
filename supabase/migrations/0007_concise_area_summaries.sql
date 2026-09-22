-- Preserve historical wording, but never reuse or publish a v1 summary as v2.
-- Requires 0004; applying this migration does not invoke AI or publish text.
alter table public.area_summaries
  drop constraint area_summaries_contract_version_check,
  alter column contract_version set default 'area-summary-v2',
  add constraint area_summaries_contract_version_check
    check (contract_version in ('area-summary-v1', 'area-summary-v2')),
  add constraint area_summaries_concise_sentence_check check (
    contract_version <> 'area-summary-v2' or (
      char_length(sentence) <= 160
      and cardinality(regexp_split_to_array(btrim(sentence), '[[:space:]]+')) <= 20
    )
  );

update public.area_summaries set status = 'stale'
where contract_version = 'area-summary-v1' and status in ('draft', 'approved');

create or replace function public.create_area_summary_draft(
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
  select id into v_id from public.area_summaries
  where latitude = p_lat and longitude = p_lng and source_fingerprint = p_source_fingerprint
    and model = 'gpt-5-mini' and contract_version = 'area-summary-v2'
    and status in ('draft', 'approved')
    and not p_regenerate
  order by generated_at desc, id desc limit 1;
  if found then return v_id; end if;
  insert into public.area_summaries (
    latitude, longitude, source_fingerprint, sentence, source_count, source_bytes,
    oldest_source_created_at, newest_source_created_at, newest_source_reviewed_at,
    contract_version
  ) values (
    p_lat, p_lng, p_source_fingerprint, p_sentence,
    (v_snapshot->>'source_count')::int, (v_snapshot->>'source_bytes')::bigint,
    (v_snapshot->>'oldest_source_created_at')::timestamptz,
    (v_snapshot->>'newest_source_created_at')::timestamptz,
    (v_snapshot->>'newest_source_reviewed_at')::timestamptz,
    'area-summary-v2'
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_public_area_summary(p_lat double precision, p_lng double precision)
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
    and a.model = 'gpt-5-mini' and a.contract_version = 'area-summary-v2'
  order by a.reviewed_at desc, a.generated_at desc, a.id desc limit 1;
$$;

revoke all on function public.create_area_summary_draft(double precision, double precision, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_area_summary_draft(double precision, double precision, text, text, boolean)
  to service_role;
revoke all on function public.get_public_area_summary(double precision, double precision) from public;
grant execute on function public.get_public_area_summary(double precision, double precision) to anon, authenticated, service_role;
