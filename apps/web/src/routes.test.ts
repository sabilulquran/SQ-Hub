import { describe, expect, it } from "vitest";

import { resolveHubRoute } from "@/routes";

describe("SQ Hub route resolver", () => {
  it("maps the accepted navigation contract without inventing application detail routes", () => {
    expect(resolveHubRoute("/")).toBe("home");
    expect(resolveHubRoute("/apps")).toBe("apps");
    expect(resolveHubRoute("/account")).toBe("account");
    expect(resolveHubRoute("/admin")).toBe("admin");
    expect(resolveHubRoute("/admin/audit")).toBe("admin");
    expect(resolveHubRoute("/apps/hcis")).toBe("not-found");
    expect(resolveHubRoute("/help")).toBe("not-found");
  });
});
