import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../migrations/0004_organizational_unit_master_foundation.sql", import.meta.url),
  "utf8",
);

describe("Organizational Unit migration invariants", () => {
  it("has stable unique key, hierarchy guards, and PRE_CUTOVER state", () => {
    expect(sql).toMatch(/unit_key text NOT NULL UNIQUE/);
    expect(sql).toContain("organizational_unit_key_immutable");
    expect(sql).toContain("organizational_unit_cycle_guard");
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(sql).toContain("PRE_CUTOVER");
  });

  it("retains HCIS source references only in mapping table and has no cascade/delete synchronization", () => {
    expect(sql).toContain("organizational_unit_source_mappings");
    expect(sql).toContain("source_ref text NOT NULL");
    expect(sql).not.toContain("ON DELETE CASCADE");
    expect(sql).not.toMatch(/DELETE FROM organizational_units/i);
  });
});
