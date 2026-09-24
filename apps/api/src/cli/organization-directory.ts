import { createPool } from "../db/pool.js";
import { loadDirectoryConfig } from "../modules/organization-directory/config.js";
import { createDirectoryPull } from "../modules/organization-directory/client.js";
import { PgOrganizationDirectory } from "../modules/organization-directory/repository.js";
import { directoryMetadata } from "../modules/organization-directory/routes.js";
import { jakartaBusinessDate } from "../modules/organization-directory/validation.js";

// Operator-only process, no public write/reconciliation endpoint and no payload dump.
const command = process.argv[2];
if (!["reconcile", "status"].includes(command ?? "") || process.argv.length !== 3) {
  throw new Error("Usage: organization-directory <status|reconcile>");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = createPool(process.env.DATABASE_URL);
try {
  const repository = new PgOrganizationDirectory(pool);
  if (command === "status") {
    const projection = await repository.read();
    const latestAttempt = (await pool.query(`SELECT attempt_id, started_at, finished_at, result,
      source_snapshot_id, source_version, as_of, counts, error_category, synchronized_at
      FROM organization_directory_sync_attempts ORDER BY finished_at DESC LIMIT 1`)).rows[0] ?? null;
    console.log(JSON.stringify({ ...(projection ? { directory: directoryMetadata(projection, new Date()), counts: projection.snapshot.counts } : { error: "DIRECTORY_UNAVAILABLE" }), latestAttempt }));
    if (!projection) process.exitCode = 1;
  } else {
    const { sync } = loadDirectoryConfig();
    if (!sync) throw new Error("Directory synchronization is disabled");
    const attempt = await repository.synchronize(jakartaBusinessDate(new Date()), createDirectoryPull(sync));
    console.log(JSON.stringify(attempt ?? { result: "BUSY" }));
    if (!attempt || attempt.result === "FAILED") process.exitCode = 1;
  }
} catch {
  console.error(JSON.stringify({ error: "DIRECTORY_OPERATION_FAILED" }));
  process.exitCode = 1;
} finally { await pool.end(); }
