import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AdminCenterPage.tsx", import.meta.url), "utf8");

describe("next-wave Admin Center integration", () => {
  it("keeps both proposal destinations reachable", () => {
    expect(source).toContain('window.location.pathname === "/admin/lifecycle"');
    expect(source).toContain('window.location.pathname === "/admin/organization"');
    expect(source).toContain('href="/admin/lifecycle"');
    expect(source).toContain('href="/admin/organization"');
  });
});
