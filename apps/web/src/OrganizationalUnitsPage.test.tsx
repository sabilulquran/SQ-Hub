import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./OrganizationalUnitsPage.tsx", import.meta.url), "utf8");
describe("Organizational Unit Admin Center surface", () => {
  it("labels PRE-CUTOVER and HCIS write boundary", () => {
    expect(source).toContain("PRE-CUTOVER FOUNDATION");
    expect(source).toContain("never writes HCIS tables");
    expect(source).toContain("sourceRef → unitKey");
  });
  it("does not expose destructive import apply as casual UI", () => {
    expect(source).toContain("implicit deletions");
    expect(source).not.toContain('/api/admin/organizational-units/import/apply');
  });
});
