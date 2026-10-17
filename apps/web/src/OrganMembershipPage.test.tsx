import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { navigationItems } from "@/components/shellNavigation";
import { organOverviewFixture } from "@/dev/organFixture";
import { workspaceFixture } from "@/dev/workspaceFixture";
import { OrganMembershipPage } from "@/OrganMembershipPage";

describe("Organ Yayasan admin section (HUB-IMPL-021 §1)", () => {
  it("is reachable from the admin sidebar", () => {
    expect(navigationItems("admin").map((item) => item.href)).toContain("/admin/organ");
  });

  it("lists active members, the 30-day ending list, and asks whether the person already has an Akun SQ", () => {
    const html = renderToStaticMarkup(<OrganMembershipPage workspace={workspaceFixture} previewOverview={organOverviewFixture} />);
    expect(html).toContain("Organ Yayasan");
    expect(html).toContain("Anggota aktif");
    expect(html).toContain("Pembina Sintetis");
    expect(html).toContain("Masa jabatan berakhir dalam 30 hari");
    expect(html).toContain("Apakah orang ini sudah memiliki Akun SQ sebagai staf?");
    expect(html).toContain("Sudah punya Akun SQ");
    expect(html).toContain("Belum punya Akun SQ");
    expect(html).toContain("Akun SQ khusus organ");
    // Raw OIDC subjects are mutation handles only and never rendered.
    expect(html).not.toContain("preview-subject-1");
  });

  it("disables the new-identity path when provisioning is unavailable", () => {
    const html = renderToStaticMarkup(
      <OrganMembershipPage
        workspace={workspaceFixture}
        previewOverview={{ ...organOverviewFixture, capabilities: { addNewIdentity: false, endNewIdentity: false } }}
      />,
    );
    expect(html).toContain("Pembuatan Akun SQ baru belum diaktifkan di lingkungan ini.");
  });
});
