import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { navigationItems } from "@/components/shellNavigation";
import { workspaceFixture } from "@/dev/workspaceFixture";
import { HcisRolesPage } from "@/HcisRolesPage";
import { PlatformAdministratorsPage } from "@/PlatformAdministratorsPage";

describe("HUB-IMPL-023 admin screens", () => {
  it("are reachable from the admin sidebar", () => {
    const hrefs = navigationItems("admin").map((item) => item.href);
    expect(hrefs).toContain("/admin/hcis-roles");
    expect(hrefs).toContain("/admin/platform-administrators");
  });

  it("loads the role list from HCIS instead of carrying one (H-1)", () => {
    const html = renderToStaticMarkup(<HcisRolesPage workspace={workspaceFixture} />);
    expect(html).toContain("Memuat katalog peran dari HCIS");
    expect(html).toContain("tetap milik HCIS");
    expect(html).not.toContain("<option");
  });

  it("states the four-eyes rule where administrators are appointed (H-9)", () => {
    const html = renderToStaticMarkup(<PlatformAdministratorsPage workspace={workspaceFixture} />);
    expect(html).toContain("butuh dua orang");
  });
});
