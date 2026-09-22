-- Daily aggregate counters only: no event log or visitor identifiers.
create table public.traffic_daily (
  day date not null,
  route text not null check (route in ('/', '/appeal')),
  viewport text not null check (viewport in ('mobile', 'tablet', 'desktop')),
  pageviews bigint not null check (pageviews > 0),
  primary key (day, route, viewport)
);

alter table public.traffic_daily enable row level security;
revoke all on public.traffic_daily from public, anon, authenticated, service_role;
grant select on public.traffic_daily to service_role;

create function public.increment_traffic(p_route text, p_viewport text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  utc_day date := (statement_timestamp() at time zone 'UTC')::date;
begin
  if p_route is null or p_route not in ('/', '/appeal')
     or p_viewport is null or p_viewport not in ('mobile', 'tablet', 'desktop') then
    raise exception 'Invalid traffic category' using errcode = '22023';
  end if;

  insert into public.traffic_daily (day, route, viewport, pageviews)
  values (utc_day, p_route, p_viewport, 1)
  on conflict (day, route, viewport) do update
    set pageviews = public.traffic_daily.pageviews + 1;

  -- Retention runs only on the next successful increment, not on a schedule.
  delete from public.traffic_daily where day < utc_day - 90;
end;
$$;

revoke all on function public.increment_traffic(text, text) from public, anon, authenticated;
grant execute on function public.increment_traffic(text, text) to service_role;
