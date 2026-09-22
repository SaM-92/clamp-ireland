import { expect, test } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";

const report = "10000000-0000-4000-8000-000000000001";
const pending = "10000000-0000-4000-8000-000000000002";
const removed = "10000000-0000-4000-8000-000000000003";
const unreviewed = "10000000-0000-4000-8000-000000000004";
const rejected = "10000000-0000-4000-8000-000000000005";
const user = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";
const unconfirmed = "20000000-0000-4000-8000-000000000003";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    create table public.profiles(id uuid primary key references auth.users(id) on delete cascade);
    create table public.locations(id uuid primary key, report_count int, risk_score numeric, risk_level text);
    insert into public.locations values ('30000000-0000-4000-8000-000000000001', 1, 17, 'low');
    create table public.reports(
      id uuid primary key, location_id uuid references public.locations(id),
      user_id uuid references public.profiles(id) on delete cascade,
      reporter_type text, description text, incident_date date, created_at timestamptz default now(),
      description_raw text, image_url text, moderation_status text, reviewed_at timestamptz, is_removed boolean
    );
    alter table public.reports enable row level security;
    create view public.reports_public with (security_barrier=true) as
      select id, location_id, reporter_type, description, incident_date, created_at
      from public.reports where moderation_status='published' and reviewed_at is not null and is_removed=false;
    grant select on public.reports_public to anon, authenticated;
    insert into auth.users values ('${user}', now()), ('${second}', now()), ('${unconfirmed}', null);
    insert into public.profiles select id from auth.users;
    insert into public.reports(id, location_id, user_id, reporter_type, description, description_raw,
      image_url, moderation_status, reviewed_at, is_removed) values
      ('${report}', '30000000-0000-4000-8000-000000000001', '${user}', 'victim', 'Approved wording', 'PRIVATE', 'PRIVATE', 'published', now(), false),
      ('${pending}', null, '${user}', 'witness', 'Pending', 'PRIVATE', null, 'pending', null, false),
      ('${removed}', null, '${user}', 'witness', 'Removed', 'PRIVATE', null, 'published', now(), true),
      ('${unreviewed}', null, '${user}', 'witness', 'Unreviewed', 'PRIVATE', null, 'published', null, false),
      ('${rejected}', null, '${user}', 'witness', 'Rejected', 'PRIVATE', null, 'rejected', now(), false);
  `);
  await db.exec(await readFile(path.resolve("supabase", "migrations", "0005_report_votes.sql"), "utf8"));
  return db;
}

async function vote(db: PGlite, id: string, voter: string, value: string | null) {
  return (await db.query<{ result: unknown }>(
    "select public.set_report_vote($1::uuid, $2::uuid, $3::text) as result", [id, voter, value],
  )).rows[0].result;
}

test("vote migration enforces service-only access, unique atomic set/switch/remove and preserves report data", async () => {
  const db = await database();
  try {
    const reportsBefore = (await db.query("select * from public.reports order by id")).rows;
    const locationsBefore = (await db.query("select * from public.locations")).rows;
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select user_id from public.report_votes")).rejects.toThrow();
      await expect(db.query(`insert into public.report_votes values ('${report}', '${user}', 'agree')`)).rejects.toThrow();
      await expect(db.query("update public.report_votes set vote='disagree'")).rejects.toThrow();
      await expect(db.query("delete from public.report_votes")).rejects.toThrow();
      await expect(vote(db, report, user, "agree")).rejects.toThrow();
      await expect(db.query("select public.get_report_votes_for_user($1::uuid[], $2::uuid)", [[report], user])).rejects.toThrow();
      const publicRows = (await db.query<Record<string, unknown>>("select * from public.reports_public")).rows;
      expect(publicRows).toHaveLength(1);
      expect(Object.keys(publicRows[0])).toEqual([
        "id", "location_id", "reporter_type", "description", "incident_date", "created_at", "agree_count", "disagree_count",
      ]);
      expect(JSON.stringify(publicRows)).not.toContain("PRIVATE");
      expect(JSON.stringify(publicRows)).not.toContain(user);
      await db.exec("reset role");
    }

    await db.exec("set role service_role");
    await expect(db.query(`insert into public.report_votes values ('${report}', '${user}', 'agree')`)).rejects.toThrow();
    await expect(vote(db, report, unconfirmed, "agree")).rejects.toThrow("Confirmed account");
    await expect(vote(db, report, user, "maybe")).rejects.toThrow("Invalid vote");
    for (const id of [pending, removed, unreviewed, rejected]) expect(await vote(db, id, user, "agree")).toBeNull();
    // The report author may vote too: no self-voting restriction was approved.
    const agreed = { reportId: report, vote: "agree", agreeCount: 1, disagreeCount: 0 };
    expect(await vote(db, report, user, "agree")).toEqual(agreed);
    expect(await vote(db, report, user, "agree")).toEqual(agreed);
    expect(await vote(db, report, user, "disagree")).toEqual({ ...agreed, vote: "disagree", agreeCount: 0, disagreeCount: 1 });
    expect(await vote(db, report, user, null)).toEqual({ ...agreed, vote: null, agreeCount: 0 });
    expect(await vote(db, report, user, null)).toEqual({ ...agreed, vote: null, agreeCount: 0 });
    await Promise.all([vote(db, report, user, "agree"), vote(db, report, second, "disagree")]);
    const privateRows = await db.query<{ result: unknown }>(
      "select public.get_report_votes_for_user($1::uuid[], $2::uuid) as result", [[report, pending, removed], user],
    );
    expect(privateRows.rows[0].result).toEqual([{ reportId: report, vote: "agree" }]);
    await expect(db.query("select public.get_report_votes_for_user($1::uuid[], $2::uuid)", [Array(51).fill(report), user])).rejects.toThrow();
    await db.exec("reset role");
    await expect(db.query(`insert into public.report_votes values ('${report}', '${user}', 'disagree')`)).rejects.toThrow(/unique|duplicate/i);
    await expect(db.query(`insert into public.report_votes values ('${report}', '${unconfirmed}', 'other')`)).rejects.toThrow(/check/i);
    expect((await db.query("select * from public.report_votes")).rows).toHaveLength(2);
    expect((await db.query("select * from public.reports order by id")).rows).toEqual(reportsBefore);
    expect((await db.query("select * from public.locations")).rows).toEqual(locationsBefore);
    await db.exec("set role anon");
    expect((await db.query("select agree_count::int, disagree_count::int from public.reports_public")).rows).toEqual([{ agree_count: 1, disagree_count: 1 }]);
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

test("unpublication hides aggregates and rejects new votes; user/report deletion cascades", async () => {
  const db = await database();
  try {
    await vote(db, report, user, "agree");
    await vote(db, report, second, "disagree");
    await db.exec(`update public.reports set is_removed=true where id='${report}'; set role anon`);
    expect((await db.query("select * from public.reports_public")).rows).toEqual([]);
    await db.exec("reset role; set role service_role");
    expect(await vote(db, report, second, "agree")).toBeNull();
    expect(await vote(db, report, second, null)).toBeNull();
    expect((await db.query<{ result: unknown }>(
      "select public.get_report_votes_for_user($1::uuid[], $2::uuid) as result", [[report], user],
    )).rows[0].result).toEqual([]);
    await db.exec(`reset role; update public.reports set is_removed=false where id='${report}'`);
    await db.exec(`delete from auth.users where id='${second}'`);
    expect((await db.query("select agree_count::int, disagree_count::int from public.reports_public")).rows).toEqual([{ agree_count: 1, disagree_count: 0 }]);
    await db.exec(`delete from public.reports where id='${report}'`);
    expect((await db.query("select * from public.report_votes")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});
