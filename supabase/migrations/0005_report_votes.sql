begin;

create table public.report_votes (
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  vote text not null check (vote in ('agree', 'disagree')),
  primary key (report_id, user_id)
);
create index report_votes_user_idx on public.report_votes(user_id);
alter table public.report_votes enable row level security;
revoke all on public.report_votes from public, anon, authenticated, service_role;

-- Preserve the original six public columns and publication filter exactly.
create or replace view public.reports_public
with (security_barrier = true) as
select r.id, r.location_id, r.reporter_type, r.description, r.incident_date, r.created_at,
  totals.agree_count, totals.disagree_count
from public.reports r
cross join lateral (
  select count(*) filter (where v.vote = 'agree') as agree_count,
    count(*) filter (where v.vote = 'disagree') as disagree_count
  from public.report_votes v where v.report_id = r.id
) totals
where r.moderation_status = 'published' and r.reviewed_at is not null and r.is_removed = false;
revoke all on public.reports_public from public, anon, authenticated;
grant select on public.reports_public to anon, authenticated;

-- Only the authenticated application server can call this definer function.
-- Lock the report to serialize votes and moderation without updating scoring data.
create function public.set_report_vote(p_report_id uuid, p_user_id uuid, p_vote text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_vote is not null and p_vote not in ('agree', 'disagree') then
    raise exception 'Invalid vote' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    raise exception 'Confirmed account required' using errcode = '28000';
  end if;
  perform 1 from public.reports
    where id = p_report_id and moderation_status = 'published'
      and reviewed_at is not null and is_removed = false
    for update;
  if not found then return null; end if;

  if p_vote is null then
    delete from public.report_votes where report_id = p_report_id and user_id = p_user_id;
  else
    insert into public.report_votes(report_id, user_id, vote)
      values (p_report_id, p_user_id, p_vote)
      on conflict (report_id, user_id) do update set vote = excluded.vote;
  end if;

  select jsonb_build_object(
    'reportId', id, 'vote', p_vote, 'agreeCount', agree_count, 'disagreeCount', disagree_count
  ) into result from public.reports_public where id = p_report_id;
  return result;
end;
$$;
revoke all on function public.set_report_vote(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_report_vote(uuid, uuid, text) to service_role;

create function public.get_report_votes_for_user(p_report_ids uuid[], p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_report_ids is null or cardinality(p_report_ids) < 1 or cardinality(p_report_ids) > 50
    or array_position(p_report_ids, null) is not null then
    raise exception 'Supply between 1 and 50 report IDs' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    raise exception 'Confirmed account required' using errcode = '28000';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('reportId', r.id, 'vote', v.vote) order by r.id), '[]'::jsonb)
    into result
  from public.reports r
  left join public.report_votes v on v.report_id = r.id and v.user_id = p_user_id
  where r.id = any(p_report_ids) and r.moderation_status = 'published'
    and r.reviewed_at is not null and r.is_removed = false;
  return result;
end;
$$;
revoke all on function public.get_report_votes_for_user(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.get_report_votes_for_user(uuid[], uuid) to service_role;

commit;
