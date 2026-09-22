import { expect, test } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sourceSnapshotSchema, publicAreaSummarySchema } from "../src/modules/area-summaries/types";

const admin = "00000000-0000-4000-8000-000000000001";
const author = "00000000-0000-4000-8000-000000000002";
const sentence = "Reports mention visitor parking permits.";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function fixture() {
  const db = new PGlite();
  try {
    // POLICY FIXTURE ONLY: PGlite has no PostGIS. Geometry is an array and
    // ST_DWithin is planar with 10,000 fake metres per degree, NOT geodesy.
    // The production migration is executed unchanged; this does not prove
    // real WGS84 boundary distances. The exact production expression is tested below.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create domain geography as double precision[];
      create domain geometry as double precision[];
      create function ST_MakePoint(double precision, double precision) returns geometry
        language sql immutable as $$ select array[$1, $2]::geometry $$;
      create function ST_SetSRID(geometry, int) returns geometry
        language sql immutable as $$ select $1 $$;
      create function ST_X(geometry) returns double precision language sql immutable as $$ select $1[1] $$;
      create function ST_Y(geometry) returns double precision language sql immutable as $$ select $1[2] $$;
      create function ST_DWithin(geography, geography, double precision, boolean) returns boolean
        language sql immutable as $$
          select sqrt(power(($1[1]-$2[1])*10000,2) + power(($1[2]-$2[2])*10000,2)) <= $3
        $$;
      create table profiles(id uuid primary key, is_admin boolean default false, is_banned boolean default false);
      create table locations(id uuid primary key, geom geography not null, report_count int default 0,
        risk_score numeric default 0, risk_level text default 'low', updated_at timestamptz default now());
      create table reports(id uuid primary key, location_id uuid references locations(id) on delete cascade,
        user_id uuid references profiles(id), reporter_type text default 'witness',
        description text, description_raw text default 'PRIVATE ORIGINAL', image_url text default 'PRIVATE PHOTO',
        incident_date date, created_at timestamptz default '2026-09-20T10:00:00Z',
        moderation_status text default 'pending', is_removed boolean default false);
      alter table profiles enable row level security;
      alter table reports enable row level security;
      create function find_or_create_location(double precision, double precision, int) returns int
        language sql as $$ select 1 $$;
      insert into profiles values ('${admin}', true, false), ('${author}', false, false);
    `);
    await db.exec(await readFile(path.resolve("supabase", "migrations", "0002_reviewed_public_notes.sql"), "utf8"));
    await db.exec(await readFile(path.resolve("supabase", "migrations", "0004_reviewed_area_summaries.sql"), "utf8"));
    await db.exec(`
      insert into locations(id,geom) values
        ('${id(10)}',array[0,0]), ('${id(11)}',array[0.0499,0]),
        ('${id(12)}',array[0.05,0]), ('${id(13)}',array[0.0501,0]),
        ('${id(14)}',array[0.09,0]);
      insert into reports(id, location_id, user_id, description, moderation_status, reviewed_at, reviewed_by) values
        ('${id(101)}','${id(10)}','${author}','Permit mentioned','published','2026-09-21T10:00:00Z','${admin}'),
        ('${id(102)}','${id(11)}','${author}','Registration mentioned','published','2026-09-21T11:00:00Z','${admin}'),
        ('${id(103)}','${id(12)}','${author}',null,'published','2026-09-21T12:00:00Z','${admin}'),
        ('${id(104)}','${id(13)}','${author}','Just outside','published',now(),'${admin}'),
        ('${id(105)}','${id(14)}','${author}','Reachable only through a chain','published',now(),'${admin}'),
        ('${id(106)}','${id(10)}','${author}','Unreviewed legacy text','published',null,null),
        ('${id(107)}','${id(10)}','${author}','Pending text','pending',now(),'${admin}'),
        ('${id(108)}','${id(10)}','${author}','Rejected text','rejected',now(),'${admin}'),
        ('${id(109)}','${id(10)}','${author}','Removed text','published',now(),'${admin}');
      update reports set is_removed=true where id='${id(109)}';
    `);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function sources(db: PGlite, longitude = 0) {
  const result = await db.query<{ snapshot: unknown }>(
    "select get_area_summary_sources(0, $1) as snapshot", [longitude],
  );
  return sourceSnapshotSchema.parse(result.rows[0].snapshot);
}

async function draft(db: PGlite, longitude = 0) {
  const snapshot = await sources(db, longitude);
  const result = await db.query<{ id: string }>(
    "select create_area_summary_draft(0, $1, $2, $3) as id",
    [longitude, snapshot.source_fingerprint, sentence],
  );
  return result.rows[0].id;
}

async function approve(db: PGlite, summary: string) {
  await db.query("select review_area_summary($1, $2, 'approved')", [summary, admin]);
}

async function publicSummary(db: PGlite, longitude = 0) {
  const result = await db.query<{ summary: unknown }>(
    "select get_public_area_summary(0, $1) as summary", [longitude],
  );
  return publicAreaSummarySchema.nullable().parse(result.rows[0].summary);
}

test("production source predicate uses inclusive fixed 500m spheroidal geography, not chains or last-N", async () => {
  const sql = await readFile(path.resolve("supabase", "migrations", "0004_reviewed_area_summaries.sql"), "utf8");
  const selection = sql.split("create function public.area_summary_sources")[1]
    .split("create function public.area_summary_source_state")[0];
  expect(selection).toContain("ST_DWithin(l.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, 500, true)");
  expect(selection).toContain("r.moderation_status = 'published' and r.reviewed_at is not null and not r.is_removed");
  expect(selection).toContain("order by r.id");
  expect(selection).not.toMatch(/\blimit\b|\brecursive\b/i);
});

test("policy fixture includes boundary and every approved source, excludes chain-only/pending/removed sources", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    const snapshot = await sources(db);
    expect(snapshot.sources.map((source) => source.report_id)).toEqual([id(101), id(102), id(103)]);
    expect(snapshot.source_count).toBe(3); // Includes the approved empty note.
    expect(snapshot.sources[2].description).toBeNull();
    const overlapping = await sources(db, 0.0499);
    expect(overlapping.sources.map((source) => source.report_id)).toContain(id(101));
    expect(overlapping.sources.map((source) => source.report_id)).toContain(id(105));
    expect(overlapping.source_fingerprint).not.toBe(snapshot.source_fingerprint);
    await db.exec("set timezone = 'Pacific/Auckland'");
    expect((await sources(db)).source_fingerprint).toBe(snapshot.source_fingerprint);
    await expect(sources(db, 1)).rejects.toThrow("No human-approved");
    await expect(db.query("select get_area_summary_sources('NaN', 0)")).rejects.toThrow("Invalid");
    await expect(db.query("select get_area_summary_sources(null, 0)")).rejects.toThrow("Invalid");
    await expect(db.query("select get_area_summary_sources(0, 181)")).rejects.toThrow("Invalid");
  } finally { await db.close(); }
});

test("drafts and source RPCs are service-only; only reviewed fresh safe projection is public", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    const summary = await draft(db);
    expect(await draft(db)).toBe(summary);
    expect(await publicSummary(db)).toBeNull();
    await expect(db.query("update area_summaries set status='approved'")).rejects.toThrow();
    await expect(db.query("select review_area_summary($1,$2,'approved')", [summary, author]))
      .rejects.toThrow("active human administrator");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      expect(await publicSummary(db)).toBeNull();
      for (const query of [
        "select * from area_summaries",
        "select * from area_summary_sources(0,0)",
        "select * from area_summary_source_state(0,0)",
        "select get_area_summary_sources(0,0)",
        `select create_area_summary_draft(0,0,'${"a".repeat(64)}','${sentence}')`,
        `select review_area_summary('${summary}','${admin}','approved')`,
        `insert into area_summaries(latitude) values(0)`,
      ]) await expect(db.query(query)).rejects.toThrow();
    }
    await db.exec("reset role; set role service_role");
    await approve(db, summary);
    await db.exec("reset role; set role anon");
    const published = await publicSummary(db);
    expect(published?.sentence).toBe(sentence);
    expect(published?.source_count).toBe(3);
    expect(published?.model).toBe("gpt-5-mini");
    expect(Object.keys(published ?? {}).sort()).toEqual([
      "id", "latitude", "longitude", "radius_metres", "sentence", "source_count",
      "oldest_source_created_at", "newest_source_created_at", "newest_source_reviewed_at",
      "generated_at", "approved_at", "model", "contract_version",
    ].sort());
    expect(JSON.stringify(published)).not.toMatch(/PRIVATE|Permit mentioned|reviewed_by|user_id|description|image/);
  } finally { await db.close(); }
});

test("source changes, rejection/removal, membership and geometry changes permanently invalidate summaries", async () => {
  const db = await fixture();
  try {
    const mutations = [
      [`update reports set description='Changed approved wording' where id='${id(101)}'`,
        `update reports set description='Permit mentioned' where id='${id(101)}'`],
      [`update reports set moderation_status='rejected' where id='${id(101)}'`,
        `update reports set moderation_status='published' where id='${id(101)}'`],
      [`update reports set is_removed=true where id='${id(101)}'`,
        `update reports set is_removed=false where id='${id(101)}'`],
      [`update reports set reviewed_at=null where id='${id(101)}'`,
        `update reports set reviewed_at='2026-09-21T10:00:00Z' where id='${id(101)}'`],
      [`update reports set location_id='${id(14)}' where id='${id(101)}'`,
        `update reports set location_id='${id(10)}' where id='${id(101)}'`],
      [`update locations set geom=array[0.2,0] where id='${id(10)}'`,
        `update locations set geom=array[0,0] where id='${id(10)}'`],
      [`update reports set moderation_status='published' where id='${id(107)}'`,
        `update reports set moderation_status='pending' where id='${id(107)}'`],
      [`insert into reports(id,location_id,user_id,description,moderation_status,reviewed_at)
        values('${id(110)}','${id(10)}','${author}','New note','published',now())`,
        `delete from reports where id='${id(110)}'`],
    ];
    for (const [change, restore] of mutations) {
      const summary = await draft(db);
      await approve(db, summary);
      expect(await publicSummary(db)).not.toBeNull();
      await db.exec(change);
      expect(await publicSummary(db)).toBeNull();
      expect((await db.query<{ status: string }>("select status from area_summaries where id=$1", [summary])).rows[0].status)
        .toBe("stale");
      await db.exec(restore);
      expect(await publicSummary(db)).toBeNull();
      await expect(approve(db, summary)).rejects.toThrow("Only an existing draft");
    }
    const summary = await draft(db);
    await approve(db, summary);
    await db.exec(`delete from locations where id='${id(10)}'`);
    expect(await publicSummary(db)).toBeNull();
  } finally { await db.close(); }
});

test("fingerprint read gate independently blocks stale text even without invalidation trigger delivery", async () => {
  const db = await fixture();
  try {
    const original = await sources(db);
    const summary = await draft(db);
    await approve(db, summary);
    // Simulates a missed invalidation/racing write. Public reads still compare sources.
    await db.exec(`alter table reports disable trigger area_summary_report_update;
      update reports set description='Different note' where id='${id(101)}'`);
    expect((await sources(db)).source_fingerprint).not.toBe(original.source_fingerprint);
    await db.exec("set role anon");
    expect(await publicSummary(db)).toBeNull();
    await db.exec("reset role; set role service_role");
    await expect(db.query("select create_area_summary_draft(0,0,$1,$2)", [original.source_fingerprint, sentence]))
      .rejects.toThrow("sources changed");
    const next = await draft(db);
    await db.exec(`reset role; update reports set description='Changed again' where id='${id(101)}'`);
    await expect(approve(db, next)).rejects.toThrow("sources changed");
  } finally { await db.close(); }
});

test("irrelevant private edits and out-of-radius notes do not alter source identity or score/map state", async () => {
  const db = await fixture();
  try {
    const before = await sources(db);
    const summary = await draft(db);
    await approve(db, summary);
    const locations = (await db.query("select * from locations order by id")).rows;
    await db.exec(`
      update reports set description_raw='Private edit', image_url='Private new photo', reviewed_by=null
        where id='${id(101)}';
      update reports set description='Changed outside area' where id='${id(105)}';
      update reports set description='Pending edit' where id='${id(107)}';
    `);
    expect((await sources(db)).source_fingerprint).toBe(before.source_fingerprint);
    expect(await publicSummary(db)).not.toBeNull();
    expect((await db.query("select * from locations order by id")).rows).toEqual(locations);
  } finally { await db.close(); }
});

test("database rejects over-limit complete sets, empty text, invalid sentences and non-human approval", async () => {
  const db = await fixture();
  try {
    await db.exec(`delete from reports where id <> '${id(101)}'`);
    await db.exec(`update reports set description=repeat('é',24000) where id='${id(101)}'`);
    expect((await sources(db)).source_bytes).toBe(48000);
    await db.exec(`update reports set description=description || 'x' where id='${id(101)}'`);
    await expect(sources(db)).rejects.toThrow("no sources truncated");
    await db.exec(`update reports set description=' ' where id='${id(101)}'`);
    await expect(sources(db)).rejects.toThrow("No approved note text");
    await db.exec(`update reports set description='Parking' where id='${id(101)}';
      insert into reports(id,location_id,user_id,description,moderation_status,reviewed_at)
      select ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
        '${id(10)}','${author}','Parking','published',now() from generate_series(1,199) n`);
    expect((await sources(db)).sources).toHaveLength(200);
    const snapshot = await sources(db);
    for (const invalid of ["Proven incident.", "Reports mention permits. This is fact.", "Reports mention contact@someone.", "Reports mention\nparking."]) {
      await expect(db.query("select create_area_summary_draft(0,0,$1,$2)", [snapshot.source_fingerprint, invalid]))
        .rejects.toThrow();
    }
    const summary = await draft(db);
    await db.exec(`update profiles set is_banned=true where id='${admin}'`);
    await expect(approve(db, summary)).rejects.toThrow("active human administrator");
    await db.exec(`update profiles set is_banned=false where id='${admin}'`);
    await db.query("select review_area_summary($1,$2,'rejected')", [summary, admin]);
    expect(await publicSummary(db)).toBeNull();
    expect(await draft(db)).not.toBe(summary);
    await db.exec(`insert into reports(id,location_id,user_id,description,moderation_status,reviewed_at)
      values('${id(111)}','${id(10)}','${author}','One too many','published',now())`);
    await expect(sources(db)).rejects.toThrow("no sources truncated");
    expect(await publicSummary(db)).toBeNull();
  } finally { await db.close(); }
});

test("regeneration preserves the approved row, and edited publication requires fresh sources and an actual admin", async () => {
  const db = await fixture();
  try {
    const original = await draft(db);
    await approve(db, original);
    const source = await sources(db);
    await db.exec("set role service_role");
    const fresh = (await db.query<{ id: string }>(
      "select create_area_summary_draft(0,0,$1,$2,true) as id", [source.source_fingerprint, sentence],
    )).rows[0].id;
    expect(fresh).not.toBe(original);
    expect((await publicSummary(db))?.id).toBe(original);
    const edited = "Reports mention registration for visitor parking.";
    await expect(db.query("select approve_area_summary_draft($1,$2,$3,$4)",
      [fresh, author, edited, source.source_fingerprint])).rejects.toThrow("active human administrator");
    expect((await db.query<{ sentence: string }>("select sentence from area_summaries where id=$1", [fresh])).rows[0].sentence).toBe(sentence);
    await expect(db.query("select approve_area_summary_draft($1,$2,$3,$4)",
      [fresh, admin, edited, "b".repeat(64)])).rejects.toThrow("sources changed");
    await db.query("select approve_area_summary_draft($1,$2,$3,$4)", [fresh, admin, edited, source.source_fingerprint]);
    expect((await publicSummary(db))?.sentence).toBe(edited);
    expect((await db.query<{ sentence: string }>("select sentence from area_summaries where id=$1", [original])).rows[0].sentence).toBe(sentence);
    await expect(db.query("select approve_area_summary_draft($1,$2,$3,$4)",
      [fresh, admin, sentence, source.source_fingerprint])).rejects.toThrow("sources changed");
    await db.exec(`reset role; update reports set description='Changed after publication' where id='${id(101)}'`);
    expect(await publicSummary(db)).toBeNull();
  } finally { await db.close(); }
});

test("generation admission is service-only, blocks duplicate paid calls and retains a one-minute cooldown", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select acquire_area_summary_generation(0,0)")).rejects.toThrow();
      await expect(db.query("select release_area_summary_generation($1)", [id(99)])).rejects.toThrow();
      await expect(db.query("select * from area_summary_generation_leases")).rejects.toThrow();
      await expect(db.query("select approve_area_summary_draft($1,$2,$3,$4)", [id(99), admin, sentence, "a".repeat(64)])).rejects.toThrow();
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const acquire = async () => (await db.query<{ lease: string | null }>(
      "select acquire_area_summary_generation(0,0) as lease",
    )).rows[0].lease;
    const first = await acquire();
    expect(first).toBeTruthy();
    expect(await acquire()).toBeNull();
    await db.query("select release_area_summary_generation($1)", [first]);
    expect(await acquire()).toBeNull();
    await db.exec("reset role; update area_summary_generation_leases set expires_at=clock_timestamp()-interval '1 second'; set role service_role");
    const second = await acquire();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    await db.query("select release_area_summary_generation($1)", [first]);
    expect(await acquire()).toBeNull();
    await expect(db.query("update area_summary_generation_leases set expires_at=now()")).rejects.toThrow();
  } finally { await db.close(); }
});
