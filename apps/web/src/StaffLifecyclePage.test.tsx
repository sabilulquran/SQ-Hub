import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./StaffLifecyclePage.tsx", import.meta.url), "utf8");

describe("Go 5C Admin Center surface", () => {
  it("keeps credential material out of administrator UI", () => {
    expect(source).not.toContain('type="password"');
    expect(source).not.toContain("passwordHash");
    expect(source).not.toContain("totpSeed");
    expect(source).not.toContain("recoveryCodes:");
    expect(source).not.toContain("clientSecret:");
  });

  it("labels HCIS employee-state boundary and explicit global-disable choice", () => {
    expect(source).toContain("Status pegawai, terminasi, reporting line, serta hak bisnis HCIS tidak dibaca");
    expect(source).toContain("Juga nonaktifkan identitas global");
    expect(source).toContain("tidak dibaca / tidak diinfer");
  });

  it("uses existing Administrasi SQ admin namespace", () => {
    expect(source).toContain("/api/admin/staff-lifecycle/");
    expect(source).toContain('href="/admin"');
    expect(source).not.toContain("/keycloak-admin");
  });
});
