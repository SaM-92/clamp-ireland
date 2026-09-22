import { expect, test } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";

const user = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";
const unconfirmed = "20000000-0000-4000-8000-000000000003";
const fresh = "20000000-0000-4000-8000-000000000004";
const report = "10000000-0000-4000-8000-000000000001";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create table public.profiles(
      id uuid primary key references auth.users(id), display_name text, is_admin boolean default false,
      is_banned boolean default false, trust_score int default 0
    );
    create table public.reports(
      id uuid primary key, user_id uuid references public.profiles(id), description text, description_raw text,
      moderation_status text default 'pending', reviewed_at timestamptz, reviewed_by uuid references public.profiles(id)
    );
    alter table public.profiles enable row level security;
    alter table public.reports enable row level security;
    create policy profiles_select_own on profiles for select using (id=auth.uid());
    create policy profiles_update_own on profiles for update using (id=auth.uid());
    create policy reports_all_legacy on reports for all using (true) with check (true);
    grant select, insert, update, delete on profiles, reports to anon, authenticated, service_role;
    grant insert(display_name), update(display_name, is_admin) on profiles to authenticated;
    grant insert(description), update(description, description_raw) on reports to authenticated;
    create function public.handle_new_user() returns trigger language plpgsql security definer as $$
      begin insert into profiles(id, display_name) values(new.id, new.raw_user_meta_data->>'name'); return new; end;
    $$;
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
    insert into auth.users values
      ('${user}', now(), '{"name":"Anonymous placeholder"}'),
      ('${second}', now(), '{"name":"Private Full Name"}'),
      ('${unconfirmed}', null, '{"name":"Metadata must not count"}');
    update profiles set is_admin=true, trust_score=8 where id='${user}';
    insert into reports(id,user_id,description,description_raw) values ('${report}','${user}','Pending note','Private note');
    create function public.existing_moderation_rpc(p_id uuid) returns void
      language sql security definer set search_path='' as $$
        update public.reports set moderation_status='published', reviewed_at=now() where id=p_id;
      $$;
    revoke all on function public.existing_moderation_rpc(uuid) from public, anon, authenticated;
    grant execute on function public.existing_moderation_rpc(uuid) to service_role;
  `);
  await db.exec(await readFile(path.resolve("supabase", "migrations", "0006_content_policy.sql"), "utf8"));
  return db;
}

async function consume(db: PGlite, id = user) {
  return (await db.query<{ allowed: boolean }>("select public.consume_content_policy_attempt($1::uuid) as allowed", [id])).rows[0].allowed;
}

test("migration removes table and column bypasses even with permissive legacy RLS; admin moderation survives", async () => {
  const db = await database();
  try {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}; set request.jwt.claim.sub='${user}'`);
      await expect(db.query("update profiles set display_name='unsafe' where id=$1", [user])).rejects.toThrow();
      await expect(db.query("update profiles set is_admin=false where id=$1", [user])).rejects.toThrow();
      await expect(db.query("insert into profiles(id,display_name) values($1,'unsafe')", [fresh])).rejects.toThrow();
      await expect(db.query("update reports set description='unsafe',description_raw='unsafe' where id=$1", [report])).rejects.toThrow();
      await expect(db.query("insert into reports(id,user_id,description) values($1,$2,'unsafe')", [fresh, user])).rejects.toThrow();
      await expect(db.query("delete from reports where id=$1", [report])).rejects.toThrow();
      await expect(db.query("select public.set_approved_username($1::uuid,'unsafe')", [user])).rejects.toThrow();
      await expect(consume(db)).rejects.toThrow();
      await expect(db.query("select * from public.content_policy_limits")).rejects.toThrow();
      await db.exec("reset role");
    }
    expect((await db.query("select description from reports")).rows).toEqual([{ description: "Pending note" }]);
    expect((await db.query("select display_name,username_policy_checked_at,is_admin,trust_score from profiles where id=$1", [user])).rows)
      .toEqual([{ display_name: null, username_policy_checked_at: null, is_admin: true, trust_score: 8 }]);
    await db.exec("set role service_role");
    await db.query("select public.existing_moderation_rpc($1::uuid)", [report]);
    await db.query("update reports set description='Human-reviewed text' where id=$1", [report]);
    await db.exec("reset role");
    expect((await db.query("select moderation_status,description,reviewed_at is not null as reviewed from reports")).rows)
      .toEqual([{ moderation_status: "published", description: "Human-reviewed text", reviewed: true }]);
  } finally { await db.close(); }
});

test("new and changed auth metadata never approve a username; confirmed service-only save is unique and constrained", async () => {
  const db = await database();
  try {
    await db.query("insert into auth.users values($1,now(),$2::jsonb)", [fresh, JSON.stringify({ name: "unsafe", username: "admin", approved: true })]);
    await db.query("update auth.users set raw_user_meta_data=$1::jsonb where id=$2", [JSON.stringify({ name: "Another Real Name" }), user]);
    expect((await db.query("select display_name,username_policy_checked_at from profiles")).rows)
      .toEqual(Array(4).fill({ display_name: null, username_policy_checked_at: null }));
    await db.exec("set role service_role");
    await expect(db.query("select public.set_approved_username($1::uuid,'river_walker')", [unconfirmed])).rejects.toThrow("Confirmed");
    await expect(db.query("select public.set_approved_username($1::uuid,'Bad Format')", [user])).rejects.toThrow("Invalid");
    await db.query("select public.set_approved_username($1::uuid,'river_walker')", [user]);
    await expect(db.query("select public.set_approved_username($1::uuid,'river_walker')", [second])).rejects.toThrow(/unique|duplicate/i);
    await db.exec("reset role");
    await db.query("update profiles set is_banned=true where id=$1", [second]);
    await db.exec("set role service_role");
    await expect(db.query("select public.set_approved_username($1::uuid,'other_walker')", [second])).rejects.toThrow("Account unavailable");
    await db.exec("reset role");
    expect((await db.query("select display_name,username_policy_checked_at is not null as checked from profiles where id=$1", [user])).rows)
      .toEqual([{ display_name: "river_walker", checked: true }]);
  } finally { await db.close(); }
});

test("atomic backend budget caps user and global reservations and resets bounded windows", async () => {
  const db = await database();
  try {
    await db.exec("set role service_role");
    await expect(consume(db, unconfirmed)).rejects.toThrow("Confirmed active");
    const attempts = await Promise.all(Array.from({ length: 12 }, () => consume(db)));
    expect(attempts.filter(Boolean)).toHaveLength(10);
    expect(await consume(db, second)).toBe(true);
    await expect(db.query("update public.content_policy_limits set attempts=0")).rejects.toThrow();
    await db.exec("reset role");
    expect((await db.query("select attempts from content_policy_limits where scope='global'")).rows).toEqual([{ attempts: 11 }]);
    await db.query("update content_policy_limits set window_start=window_start-interval '1 hour' where scope=$1", [user]);
    await db.exec("set role service_role");
    expect(await consume(db)).toBe(true);
    await db.exec("reset role; update content_policy_limits set attempts=200 where scope='global'; set role service_role");
    expect(await consume(db, second)).toBe(false);
    await db.exec("reset role; update content_policy_limits set window_start=window_start-interval '1 day' where scope='global'; set role service_role");
    expect(await consume(db, second)).toBe(true);
    await db.exec("reset role");
    expect((await db.query("select attempts from content_policy_limits where scope='global'")).rows).toEqual([{ attempts: 1 }]);
  } finally { await db.close(); }
});
