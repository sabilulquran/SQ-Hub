import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { adminRouteStateFromResponse } from "@/admin-route-state";
import { NotFoundPage } from "@/WorkspaceApp";

describe("SQ Hub admin route boundary", () => {
  it("maps an ordinary authenticated admin denial to the generic not-found state", () => {
    expect(adminRouteStateFromResponse(403, "ADMIN_FORBIDDEN")).toBe("forbidden");
    expect(adminRouteStateFromResponse(403)).toBe("forbidden");
  });

  it("keeps the stale-session reauthentication response distinct from an ordinary denial", () => {
    expect(adminRouteStateFromResponse(403, "ADMIN_REAUTH_REQUIRED")).toBe("reauth");
  });

  it("does not disclose Admin Center content on the generic not-found page", () => {
    const html = renderToStaticMarkup(<NotFoundPage />);

    expect(html).toContain("Halaman tidak ditemukan");
    expect(html).not.toContain("Administrasi SQ");
    expect(html).not.toContain("Platform Administrator");
    expect(html).not.toContain("Application Registry");
  });
});
