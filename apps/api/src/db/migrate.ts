import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createPool } from "./pool.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = createPool(databaseUrl);
const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum_sha256 text NOT NULL CHECK (length(checksum_sha256) = 64),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const filenames = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    const sql = await readFile(new URL(`../../migrations/${filename}`, import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(77241002)");

      const existing = await client.query<{ checksum: string }>(
        `
          SELECT checksum_sha256 AS checksum
          FROM schema_migrations
          WHERE filename = $1
        `,
        [filename],
      );
      const applied = existing.rows[0];

      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(
            `Migration ${filename} checksum changed after application. Create a new migration instead of editing an applied file.`,
          );
        }
        await client.query("COMMIT");
        continue;
      }

      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum_sha256) VALUES ($1, $2)",
        [filename, checksum],
      );
      await client.query("COMMIT");
      console.log(`applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
