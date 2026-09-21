-- Clamp Transparency Signal — initial schema
-- Depends on: docs/02-data-model.md (source of truth for design rationale).
-- Apply with the Supabase CLI: `supabase db push` (or paste into the SQL
-- editor of a Supabase project).

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- Public profile row, one-to-one with auth.users. Named `profiles` (not
-- `users`) to avoid confusion with Supabase's own `auth.users` table in the
-- same Postgres instance.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  is_banned boolean not null default false,
  trust_score int not null default 0,
  is_admin boolean not null default false
);

-- One row per distinct clamping hotspot pin. Multiple reports attach to one location.
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  geom geography(Point, 4326) not null,
  address_label text,
  risk_score numeric not null default 0,
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  report_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists locations_geom_idx on public.locations using gist (geom);

-- Convenience view exposing plain lat/lng instead of a PostGIS geography
-- value, so the API layer never has to parse WKB/WKT client-side.
create or replace view public.locations_public as
select
  id,
  ST_Y(geom::geometry) as lat,
  ST_X(geom::geometry) as lng,
  risk_score,
  risk_level,
  report_count,
  created_at,
  updated_at
from public.locations;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reporter_type text not null check (reporter_type in ('victim', 'neighbour', 'witness')),
  has_image boolean not null default false,
  image_url text,
  -- Public-facing text after the AI/heuristic softening pass (see
  -- src/modules/reports/server/textSoftening.ts).
  description text,
  -- Private original as typed by the user, kept for the author's own
  -- record/dispute resolution — never exposed via the public API.
  description_raw text,
  incident_date date,
  -- 'pending' reports (always true when has_image) are excluded from public
  -- reads and from risk scoring until a moderator approves them.
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  is_flagged boolean not null default false,
  is_removed boolean not null default false
);
create index if not exists reports_location_idx on public.reports (location_id);
create index if not exists reports_moderation_status_idx on public.reports (moderation_status);

create table if not exists public.flags (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  flagged_by uuid not null references public.profiles (id),
  reason text,
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);

-- Finds an existing pin within `p_radius_meters` of (p_lat, p_lng), or
-- creates a new one. security definer so it can insert into `locations`
-- despite anon/authenticated roles having no direct INSERT policy on that
-- table (see RLS section below) — callers still must be authenticated at
-- the API layer (src/app/api/locations/route.ts).
create or replace function public.find_or_create_location(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters int default 30
)
returns public.locations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location public.locations;
begin
  select * into v_location
  from public.locations
  where ST_DWithin(geom, ST_MakePoint(p_lng, p_lat)::geography, p_radius_meters)
  order by ST_Distance(geom, ST_MakePoint(p_lng, p_lat)::geography) asc
  limit 1;

  if found then
    return v_location;
  end if;

  insert into public.locations (geom)
  values (ST_MakePoint(p_lng, p_lat)::geography)
  returning * into v_location;

  return v_location;
end;
$$;

grant execute on function public.find_or_create_location(double precision, double precision, int) to anon, authenticated;

-- Auto-create a `profiles` row whenever a new Supabase Auth user signs up.
-- Without this, the first report a new user submits would fail its foreign
-- key to `profiles` (reports.user_id -> profiles.id). security definer so
-- it can write to `public.profiles` from a trigger owned by the auth schema.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security ----------------------------------------------------
-- Design intent (docs/02-data-model.md): the browser client only ever
-- reads directly; every write goes through a Next.js API route using the
-- service-role key (which bypasses RLS entirely), so business logic
-- (text softening, moderation gating, score recompute) always runs first.

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.reports enable row level security;
alter table public.flags enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "locations_select_all" on public.locations
  for select using (true);

create policy "reports_select_published" on public.reports
  for select using (
    (moderation_status = 'published' and is_removed = false)
    or auth.uid() = user_id
  );

create policy "flags_insert_own" on public.flags
  for insert with check (auth.uid() = flagged_by);

create policy "flags_select_admin" on public.flags
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create policy "flags_update_admin" on public.flags
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- Intentionally no INSERT/UPDATE policy on locations/reports for
-- anon/authenticated — those go through the service-role key only.

-- Storage: create a PRIVATE bucket named 'report-images' via the Supabase
-- dashboard (Storage > New bucket > Public: off). Access is only ever via
-- short-lived signed URLs generated server-side, and only for reports that
-- have moderation_status = 'published' — see
-- src/modules/reports/server/imageStorage.ts.
