// One-off runner: executes scripts/deploy/grant-sql-users.sql against Azure SQL
// using an Entra access token (fetched via `az account get-access-token`),
// since the installed sqlcmd version only supports Windows-integrated AAD auth
// and this admin identity is an external/guest Entra account.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import sql from "mssql";

const server = process.argv[2];
const database = process.argv[3];
const filePath = process.argv[4];

if (!server || !database || !filePath) {
  console.error(
    "Usage: node run-grant-sql.mjs <server-fqdn> <database> <sql-file-path>"
  );
  process.exit(1);
}

const token = execSync(
  "az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv",
  { encoding: "utf8" }
).trim();

const script = readFileSync(filePath, "utf8");
const batches = script
  .split(/^\s*GO\s*$/im)
  .map((batch) => batch.trim())
  .filter((batch) => batch.length > 0);

const pool = new sql.ConnectionPool({
  server,
  database,
  options: { encrypt: true },
  authentication: {
    type: "azure-active-directory-access-token",
    options: { token },
  },
});

try {
  await pool.connect();
  for (const batch of batches) {
    console.log(`--- Executing batch ---\n${batch}\n`);
    await pool.request().query(batch);
  }
  console.log("All batches executed successfully.");
} finally {
  await pool.close();
}
