begin;

alter table public.profiles add column username_policy_checked_at timestamptz;
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;
-- Legacy placeholders, OAuth names and signup metadata have not passed this policy.
-- Preserve IDs, admin/ban flags and report ownership; onboarding replaces only names.
update public.profiles set display_name = null;
alter table public.profiles add constraint profiles_approved_username check (
  (display_name is null and username_policy_checked_at is null)
  or (display_name is not null and username_policy_checked_at is not null
    and display_name ~ '^[a-z][a-z0-9_]{2,23}$')
);
create unique index profiles_approved_username_unique on public.profiles(display_name)
  where username_policy_checked_at is not null;

drop policy if exists profiles_update_own on public.profiles;
revoke insert, update, delete, truncate, references, trigger
  on public.profiles, public.reports from public, anon, authenticated;
-- Table-level revocation does not revoke pre-existing per-column grants.
do $$
declare
  target text;
  columns text;
begin
  foreach target in array array['profiles', 'reports'] loop
    select string_agg(quote_ident(attname), ', ' order by attnum) into columns
      from pg_attribute where attrelid = ('public.' || target)::regclass
        and attnum > 0 and not attisdropped;
    execute format('revoke insert (%s), update (%s), references (%s) on public.%I from public, anon, authenticated',
      columns, columns, columns, target);
  end loop;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name, username_policy_checked_at)
    values (new.id, null, null) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create function public.set_approved_username(p_user_id uuid, p_username text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_username is null or p_username !~ '^[a-z][a-z0-9_]{2,23}$' then
    raise exception 'Invalid username' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    raise exception 'Confirmed account required' using errcode = '28000';
  end if;
  update public.profiles set display_name = p_username, username_policy_checked_at = statement_timestamp()
    where id = p_user_id and not is_banned;
  if not found then raise exception 'Account unavailable' using errcode = '42501'; end if;
  return p_username;
end;
$$;
revoke all on function public.set_approved_username(uuid, text) from public, anon, authenticated;
grant execute on function public.set_approved_username(uuid, text) to service_role;

-- Counters contain no submitted text. One row per account plus one global row;
-- fixed limits cap inference across every server instance and both write routes.
create table public.content_policy_limits (
  scope text primary key,
  window_start timestamptz not null,
  attempts integer not null check (attempts >= 0)
);
alter table public.content_policy_limits enable row level security;
revoke all on public.content_policy_limits from public, anon, authenticated, service_role;

create function public.consume_content_policy_attempt(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  hour_start timestamptz := date_trunc('hour', statement_timestamp());
  day_start timestamptz := date_trunc('day', statement_timestamp());
  global_attempts integer;
  user_attempts integer;
begin
  if not exists (
    select 1 from auth.users u join public.profiles p on p.id = u.id
      where u.id = p_user_id and u.email_confirmed_at is not null and not p.is_banned
  ) then raise exception 'Confirmed active account required' using errcode = '28000'; end if;

  insert into public.content_policy_limits values ('global', day_start, 0) on conflict do nothing;
  -- Always lock the same global row first, serializing reservation and avoiding deadlocks.
  perform 1 from public.content_policy_limits where scope = 'global' for update;
  update public.content_policy_limits set window_start = day_start, attempts = 0
    where scope = 'global' and window_start < day_start;
  insert into public.content_policy_limits values (p_user_id::text, hour_start, 0) on conflict do nothing;
  update public.content_policy_limits set window_start = hour_start, attempts = 0
    where scope = p_user_id::text and window_start < hour_start;
  select attempts into global_attempts from public.content_policy_limits where scope = 'global';
  select attempts into user_attempts from public.content_policy_limits where scope = p_user_id::text;
  if global_attempts >= 200 or user_attempts >= 10 then return false; end if;
  update public.content_policy_limits set attempts = attempts + 1
    where scope in ('global', p_user_id::text);
  return true;
end;
$$;
revoke all on function public.consume_content_policy_attempt(uuid) from public, anon, authenticated;
grant execute on function public.consume_content_policy_attempt(uuid) to service_role;

commit;
