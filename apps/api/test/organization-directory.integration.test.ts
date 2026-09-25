import pg from "pg";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PgOrganizationDirectory } from "../src/modules/organization-directory/repository.js";
import { contentVersion, DirectorySyncError } from "../src/modules/organization-directory/validation.js";
import { changed, fixture } from "./organization-directory.fixture.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for integration tests");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let now = new Date("2026-09-24T01:30:00Z");
const repo = new PgOrganizationDirectory(pool, () => now);
const asOf = "2026-09-24";
beforeEach(async () => {
  now = new Date("2026-09-24T01:30:00Z");
  await pool.query("TRUNCATE organization_directory_projection, organization_directory_sync_attempts");
});
afterAll(() => pool.end());

describe("HUB-IMPL-018 PostgreSQL atomic projection", () => {
  it("reports safe CLI status with date-only asOf across host timezones", async () => {
    await repo.synchronize(asOf, async () => fixture());
    const output = execFileSync(process.execPath, ["--import", "tsx", "src/cli/organization-directory.ts", "status"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", env: { ...process.env, TZ: "Asia/Jakarta" },
    });
    const status = JSON.parse(output);
    expect(status.directory.asOf).toBe(asOf);
    expect(status.latestAttempt.as_of).toBe(asOf);
    expect(output).not.toMatch(/Pegawai|DEMO-001|opaque-demo-subject/);
  });
  it("bootstraps actual HCIS final-head fixture and idempotently retries without rewriting content", async () => {
    expect(await repo.read()).toBeNull();
    expect((await repo.synchronize(asOf, async () => fixture()))?.result).toBe("APPLIED");
    now = new Date("2026-09-24T01:35:00Z");
    const retry = fixture(); retry.generatedAt = now.toISOString();
    expect((await repo.synchronize(asOf, async () => retry))?.result).toBe("UNCHANGED");
    const projection = await repo.read();
    expect(projection?.snapshot).toEqual(fixture());
    expect(projection?.synchronizedAt).toBe(now.toISOString());
    expect((await pool.query("SELECT result FROM organization_directory_sync_attempts ORDER BY finished_at")).rows.map((r) => r.result)).toEqual(["APPLIED", "UNCHANGED"]);
  });

  it("applies changed employee content with the same revision and propagates deactivation", async () => {
    await repo.synchronize(asOf, async () => fixture());
    const next = changed((s) => { s.people[0]!.active = false; });
    expect((await repo.synchronize(asOf, async () => next))?.result).toBe("APPLIED");
    expect((await repo.read())?.snapshot.people[0]?.active).toBe(false);
    expect((await repo.read())?.snapshot.version).toBe(next.version);
  });

  it("retains minimum tombstones, removes stale identity mappings, and permits reappearance", async () => {
    await repo.synchronize(asOf, async () => fixture());
    const next = changed((s) => { s.people = []; s.units = []; s.positions = []; });
    await repo.synchronize(asOf, async () => next);
    const p = await repo.read();
    expect(p?.tombstones.people[0]).toEqual({ id: fixture().people[0]!.id, displayName: "Pegawai Demo Satu", active: false, sourceAbsent: true });
    expect(p?.tombstones.units).toHaveLength(2);
    expect(p?.tombstones.positions).toHaveLength(1);
    expect(JSON.stringify(p?.tombstones)).not.toMatch(/employeeNumber|identityRefs|structuralPositionIds/);
    await repo.synchronize(asOf, async () => next);
    expect((await repo.read())?.tombstones).toEqual(p?.tombstones);
    await repo.synchronize(asOf, async () => fixture());
    expect((await repo.read())?.tombstones).toEqual({ units: [], positions: [], people: [] });
  });

  it.each(["digest", "schema", "reference", "duplicate", "cycle", "identity", "date", "future", "counts"])("keeps exact LKG and successful-sync time when %s validation fails", async (kind) => {
    await repo.synchronize(asOf, async () => fixture());
    const previous = await repo.read(); now = new Date("2026-09-24T02:00:00Z");
    const next: any = fixture();
    if (kind === "digest") next.people[0].displayName = "Changed without digest";
    if (kind === "schema") next.people[0].phone = "synthetic-private-field";
    if (kind === "reference") next.units.pop();
    if (kind === "duplicate") next.units.push(next.units[0]);
    if (kind === "cycle") next.units[0].parentUnitId = next.units[1].id;
    if (kind === "identity") next.people[1].identityRefs = next.people[0].identityRefs;
    if (kind === "date") next.people[0].startedOn = "2026-02-30";
    if (kind === "future") next.units[0].effectiveFrom = "2026-09-25";
    if (kind === "counts") next.counts.people = 999;
    if (!["schema", "digest", "counts"].includes(kind)) {
      next.counts = { units: next.units.length, positions: next.positions.length, people: next.people.length };
      next.version = contentVersion(next);
    }
    expect(await repo.synchronize(asOf, async () => next)).toMatchObject({ result: "FAILED", errorCategory: "contract_validation" });
    expect(await repo.read()).toEqual(previous);
  });

  it("does not bootstrap from an invalid snapshot or move business date backwards", async () => {
    expect((await repo.synchronize(asOf, async () => ({})))?.result).toBe("FAILED");
    expect(await repo.read()).toBeNull();
    await repo.synchronize(asOf, async () => fixture());
    const older = changed((s) => { s.asOf = "2026-09-23"; });
    expect(await repo.synchronize(older.asOf, async () => older)).toMatchObject({ result: "FAILED", errorCategory: "source_regression" });
    expect((await repo.read())?.snapshot.asOf).toBe(asOf);
  });

  it("rejects older same-date revisions in canonical tuple order, never orders digests", async () => {
    const first = fixture();
    await repo.synchronize(asOf, async () => first);
    const newer = changed((s) => { s.source.publishedAt = "2026-09-02T01:00:00.000Z"; });
    expect((await repo.synchronize(asOf, async () => newer))?.result).toBe("APPLIED");
    expect(await repo.synchronize(asOf, async () => first)).toMatchObject({ result: "FAILED", errorCategory: "source_regression" });
    expect((await repo.read())?.snapshot.version).toBe(newer.version);
  });

  it("serializes before network fetch across workers and exposes only committed snapshots", async () => {
    await repo.synchronize(asOf, async () => fixture());
    let unblock!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const next = changed((s) => { s.people[0]!.active = false; });
    const pending = repo.synchronize(asOf, async () => { entered(); await blocked; return next; });
    await enteredPromise;
    try {
      const other = new PgOrganizationDirectory(pool);
      let fetched = false;
      expect(await other.synchronize(asOf, async () => { fetched = true; return fixture(); })).toBeNull();
      expect(fetched).toBe(false);
      expect((await other.read())?.snapshot).toEqual(fixture());
    } finally { unblock(); }
    expect((await pending)?.result).toBe("APPLIED");
    expect((await repo.read())?.snapshot).toEqual(next);
  });

  it("rolls back projection plus success metadata on a database failure then recovers", async () => {
    await repo.synchronize(asOf, async () => fixture());
    const previous = await repo.read();
    // Fail AFTER projection update when recording success, proving transaction rollback.
    await pool.query(`CREATE FUNCTION directory_test_fail_success() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.result <> 'FAILED' THEN RAISE EXCEPTION 'synthetic test failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER directory_test_fail BEFORE INSERT ON organization_directory_sync_attempts
      FOR EACH ROW EXECUTE FUNCTION directory_test_fail_success()`);
    const next = changed((s) => { s.people[0]!.active = false; });
    try {
      expect(await repo.synchronize(asOf, async () => next)).toMatchObject({ result: "FAILED", errorCategory: "storage" });
      expect(await repo.read()).toEqual(previous);
    } finally {
      await pool.query("DROP TRIGGER directory_test_fail ON organization_directory_sync_attempts; DROP FUNCTION directory_test_fail_success()");
    }
    expect((await repo.synchronize(asOf, async () => next))?.result).toBe("APPLIED");
  });

  it("retains LKG across source outage, records only safe metadata, and recovers by full pull", async () => {
    await repo.synchronize(asOf, async () => fixture());
    const previous = await repo.read();
    expect(await repo.synchronize(asOf, async () => { throw new DirectorySyncError("source_unavailable"); })).toMatchObject({ result: "FAILED", errorCategory: "source_unavailable" });
    expect(await repo.read()).toEqual(previous);
    expect((await repo.synchronize(asOf, async () => fixture()))?.result).toBe("UNCHANGED");
    const audit = JSON.stringify((await pool.query("SELECT * FROM organization_directory_sync_attempts")).rows);
    expect(audit).not.toMatch(/Pegawai|DEMO-001|opaque-demo-subject|identityRefs/);
  });
});
