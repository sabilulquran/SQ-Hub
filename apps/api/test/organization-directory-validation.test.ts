import { describe, expect, it } from "vitest";
import { assertNoRegression, contentVersion, jakartaBusinessDate, validateSnapshot } from "../src/modules/organization-directory/validation.js";
import { loadDirectoryConfig } from "../src/modules/organization-directory/config.js";
import { changed, fixture } from "./organization-directory.fixture.js";

describe("pinned HCIS contract and effective date", () => {
  it("matches the real pinned producer's golden digest", () => {
    const s = fixture();
    expect(contentVersion(s)).toBe("sha256:3b14cbf84ed7634068053692288620675da8b3d16e6b458823cf3f696eaeca39");
    expect(validateSnapshot(s, s.asOf)).toEqual(s);
    expect(() => validateSnapshot(s, "2026-09-25")).toThrow();
  });
  it("keeps inclusive periods and does not shift Jakarta date to UTC", () => {
    expect(jakartaBusinessDate(new Date("2026-09-23T17:00:00Z"))).toBe("2026-09-24");
    const s = changed((s) => { s.units[0]!.effectiveFrom = s.asOf; s.units[0]!.effectiveTo = s.asOf; });
    expect(validateSnapshot(s, s.asOf).units[0]?.effectiveTo).toBe(s.asOf);
  });
  it.each(["effectiveOn", "publishedAt", "createdAt", "snapshotId"] as const)("uses %s in source revision tuple", (field) => {
    const old = fixture();
    const next = structuredClone(old);
    if (field === "effectiveOn") next.source.effectiveOn = "2026-09-02";
    if (field === "publishedAt") next.source.publishedAt = "2026-09-01T02:00:00Z";
    if (field === "createdAt") next.source.createdAt = "2026-08-25T02:00:00Z";
    if (field === "snapshotId") next.source.snapshotId = "00000000-0000-4000-8000-000000000999";
    expect(() => assertNoRegression(next, old)).not.toThrow();
    expect(() => assertNoRegression(old, next)).toThrow("source_regression");
  });
  it("defaults both activation gates OFF without credentials and rejects incomplete/insecure config", () => {
    expect(loadDirectoryConfig({})).toEqual({ sync: null, read: null });
    expect(() => loadDirectoryConfig({ ORG_DIRECTORY_SYNC_ENABLED: "1" })).toThrow();
    expect(() => loadDirectoryConfig({ ORG_DIRECTORY_READ_ENABLED: "1", KEYCLOAK_ISSUER: "http://example.test" })).toThrow();
    expect(() => loadDirectoryConfig({ ORG_DIRECTORY_READ_ENABLED: "1", KEYCLOAK_ISSUER: "https://example.test", ORG_DIRECTORY_READ_AUDIENCE: "directory", ORG_DIRECTORY_READ_CLIENTS: " , " })).toThrow();
  });
});
