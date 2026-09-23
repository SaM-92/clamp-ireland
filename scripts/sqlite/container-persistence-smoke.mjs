import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const volume = `clamp-sqlite-fixture-${randomUUID()}`;
const ids = [];
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const location = "30000000-0000-4000-8000-000000000001";
const report = "40000000-0000-4000-8000-000000000001";
const token = randomBytes(32).toString("base64url");
const origin = "http://127.0.0.1:3000";
const publicImage = process.env.PUBLIC_IMAGE;
const adminImage = process.env.ADMIN_IMAGE;
if (!publicImage || !adminImage) throw new Error("Specify independently built PUBLIC_IMAGE and ADMIN_IMAGE.");

async function request(id, route, options = {}) {
  const code = `fetch(${JSON.stringify(origin + route)},${JSON.stringify(options)})
    .then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))
    .catch(()=>process.exit(1))`;
  return JSON.parse(docker("exec", id, "node", "-e", code));
}
async function ready(id) {
  for (let n = 0; n < 60; n++) {
    try { if ((await request(id, "/api/health")).status === 200) return; }
    catch (error) { if (n === 59) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Container did not become ready.");
}
try {
  docker("volume", "create", volume);
  for (const [index, image] of [publicImage, adminImage].entries()) {
    ids.push(docker("run", "-d", "--network", "none", "--memory", index ? "512m" : "2g",
      "--mount", `type=volume,source=${volume},target=/data`,
      "--env", "DATABASE_PATH=/data/clamp.sqlite", "--env", `AUTH_PUBLIC_ORIGIN=${origin}`,
      "--env", `ADMIN_SITE_URL=${origin}`, "--env", `ADMIN_ALLOWED_USER_IDS=${owner},${other}`,
      "--env", "ENABLE_LOCAL_AI_DEMO=false", "--env", "ENABLE_AREA_SUMMARIES=false", image));
  }
  await Promise.all(ids.map(ready));
  assert.equal((await request(ids[0], "/api/locations")).status, 200);
  const seed = `
    const {DatabaseSync}=require('node:sqlite'); const {createHash}=require('node:crypto');
    const db=new DatabaseSync('/data/clamp.sqlite');
    db.function('distance_m',{varargs:true},()=>{throw new Error('Unexpected seed geography evaluation')});
    db.prepare("INSERT INTO profiles(id,google_subject,email,is_admin) VALUES (?,?,?,1)").run(${JSON.stringify(owner)},'synthetic-subject','synthetic@fixture.invalid');
    db.prepare("INSERT INTO profiles(id,google_subject,email,is_admin) VALUES (?,?,?,1)").run(${JSON.stringify(other)},'synthetic-other','other@fixture.invalid');
    db.prepare("INSERT INTO locations(id,lat,lng) VALUES (?,53.3,-6.2)").run(${JSON.stringify(location)});
    db.prepare("INSERT INTO reports(id,location_id,user_id,reporter_type,has_image,description,description_raw) VALUES (?,?,?,'witness',0,'Pending fixture','Private fixture')").run(${JSON.stringify(report)},${JSON.stringify(location)},${JSON.stringify(owner)});
    db.prepare("INSERT INTO sessions VALUES (?,?,'admin',?,?)").run(createHash('sha256').update(${JSON.stringify(token)}).digest('hex'),${JSON.stringify(owner)},Date.now()+3600000,Date.now());
    db.close();
  `;
  docker("exec", ids[0], "node", "-e", seed);
  const headers = { Cookie: `clamp-admin-session=${token}`, Origin: origin, "Content-Type": "application/json" };
  assert.equal((await request(ids[1], "/api/admin/overview", { headers })).body.pending, 1);
  const review = await request(ids[1], `/api/moderation/reports/${report}`, {
    method: "PATCH", headers, body: JSON.stringify({ action: "approve", description: "Reviewed fixture.", reviewed: true }),
  });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.equal((await request(ids[0], "/api/locations")).body[0].reportCount, 1);
  docker("restart", ...ids);
  await Promise.all(ids.map(ready));
  assert.equal((await request(ids[0], "/api/locations")).body[0].reportCount, 1);
  assert.equal((await request(ids[1], "/api/admin/overview", { headers })).body.published, 1);
  assert.equal(docker("exec", ids[0], "id", "-u"), "1000");
  assert.equal(docker("exec", ids[1], "id", "-u"), "1000");
  console.log("Two non-root Linux apps share durable SQLite: admin publication is public and survives both restarts.");
} finally {
  for (const id of ids) docker("rm", "--force", id);
  docker("volume", "rm", volume);
}
