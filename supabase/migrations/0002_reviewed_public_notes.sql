-- Public notes now require a recorded human review, including text-only reports.
alter table public.reports
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

-- The old schema cannot distinguish auto-published text from reviewed text.
-- Requeue it once rather than exposing unreviewed legacy notes.
update public.reports set moderation_status = 'pending'
where moderation_status = 'published' and reviewed_at is null;

update public.locations
set report_count = 0, risk_score = 0, risk_level = 'low', updated_at = now();

drop policy if exists "reports_select_published" on public.reports;
create policy "reports_select_own" on public.reports
  for select to authenticated using (auth.uid() = user_id);

-- Public readers must use a column-limited view, never the private originals.
create or replace view public.reports_public
with (security_barrier = true) as
select id, location_id, reporter_type, description, incident_date, created_at
from public.reports
where moderation_status = 'published' and reviewed_at is not null and is_removed = false;
revoke all on public.reports_public from public, anon, authenticated;
grant select on public.reports_public to anon, authenticated;

-- Moderator roles must never be self-assignable through a profile update.
drop policy if exists "profiles_update_own" on public.profiles;

-- Location creation must pass through the authenticated application endpoint.
revoke execute on function public.find_or_create_location(double precision, double precision, int)
  from public, anon, authenticated;
grant execute on function public.find_or_create_location(double precision, double precision, int)
  to service_role;
