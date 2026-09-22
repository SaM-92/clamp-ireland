import { test, expect } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("public notes require review and never expose private originals or moderator controls", async () => {
  const db = new PGlite();
  try {
    // Minimal pre-0002 schema: no geometry operations are needed for the access policy.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      create table profiles(id uuid primary key, is_admin boolean default false);
      create table locations(id uuid primary key, report_count int, risk_score numeric, risk_level text, updated_at timestamptz);
      create table reports(id uuid primary key, location_id uuid, user_id uuid, reporter_type text,
        description text, description_raw text, incident_date date, created_at timestamptz default now(),
        moderation_status text, is_removed boolean default false);
      alter table profiles enable row level security;
      alter table reports enable row level security;
      create policy profiles_select_own on profiles for select using (auth.uid() = id);
      create policy profiles_update_own on profiles for update using (auth.uid() = id);
      create policy reports_select_published on reports for select using (
        (moderation_status = 'published' and not is_removed) or auth.uid() = user_id);
      grant select, update on profiles to authenticated;
      grant select on reports to anon, authenticated;
      create function find_or_create_location(double precision, double precision, int) returns int
        language sql security definer as $$ select 1 $$;
      insert into profiles values ('00000000-0000-4000-8000-000000000001', false);
      insert into locations values ('00000000-0000-4000-8000-000000000002', 1, 40, 'medium', now());
      insert into reports values ('00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',
        'victim','Public wording','Private original',null,now(),'published',false);
    `);
    await db.exec(await readFile(path.resolve("supabase", "migrations", "0002_reviewed_public_notes.sql"), "utf8"));
    expect((await db.query<{ moderation_status: string }>("select moderation_status from reports")).rows[0].moderation_status).toBe("pending");
    expect((await db.query<{ report_count: number }>("select report_count from locations")).rows[0].report_count).toBe(0);
    await db.exec("set role anon");
    expect((await db.query("select * from reports_public")).rows).toEqual([]);
    expect((await db.query("select description_raw from reports")).rows).toEqual([]);
    await expect(db.query("select description_raw from reports_public")).rejects.toThrow();
    await expect(db.query("select find_or_create_location(53.2,-6.6,30)")).rejects.toThrow();
    await db.exec("reset role; update reports set moderation_status='published', reviewed_at=now()");
    await db.exec("set role anon");
    const published = await db.query<Record<string, unknown>>("select * from reports_public");
    expect(published.rows).toHaveLength(1);
    expect(Object.keys(published.rows[0])).not.toContain("user_id");
    expect(Object.keys(published.rows[0])).not.toContain("description_raw");
    await db.exec("reset role; update reports set is_removed=true; set role anon");
    expect((await db.query("select * from reports_public")).rows).toEqual([]);
    await db.exec("reset role; set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'");
    await db.exec("update profiles set is_admin=true where id=auth.uid()");
    expect((await db.query<{ is_admin: boolean }>("select is_admin from profiles")).rows[0].is_admin).toBe(false);
  } finally { await db.close(); }
});
