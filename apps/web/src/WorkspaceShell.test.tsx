import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountMenu } from "@/components/AccountMenu";
import { AppLauncher } from "@/components/AppLauncher";
import { MobileNavigation } from "@/components/MobileNavigation";
import { WorkspaceShell } from "@/WorkspaceShell";
import { filterApplications } from "@/application-filter";
import type { WorkspaceSnapshot } from "@/types";

const workspace: WorkspaceSnapshot = {
  user: { displayName: "Ahmad Fikri", initials: "AF", contextLabel: "UAT-HCIS-001 · Pegawai sintetis" },
  applications: [
    { key: "hcis", name: "HCIS", description: "Aplikasi kepegawaian", canonicalUrl: "https://hcis.example.test" },
    { key: "portal-contoh", name: "Portal Contoh", description: "Fixture visual sintetis", canonicalUrl: "https://portal.example" },
  ],
  capabilities: { platformAdministration: false },
};

describe("SQ Hub navigation experience", () => {
  it("renders Beranda with the authorized application list and a link to all apps", () => {
    const html = renderToStaticMarkup(<WorkspaceShell workspace={workspace} route="home" />);
    expect(html).toContain("Assalamu&#x27;alaikum, Ahmad Fikri");
    expect(html).toContain("Aplikasi Anda");
    expect(html).toContain('href="/apps"');
    expect(html).toContain("HCIS");
    expect(html).toContain("https://hcis.example.test");
    expect(html).not.toContain("w-72");
    expect(html).not.toContain("Application Access");
  });

  it("renders the all-apps route and client-side search filters only the supplied snapshot", () => {
    const html = renderToStaticMarkup(<WorkspaceShell workspace={workspace} route="apps" />);
    expect(html).toContain("Semua aplikasi");
    expect(html).toContain('id="application-search"');
    expect(filterApplications(workspace.applications, "kepegawaian").map((item) => item.key)).toEqual(["hcis"]);
    expect(filterApplications(workspace.applications, "tidak-ada")).toEqual([]);
  });

  it("keeps empty workspace distinct from a no-result search", () => {
    const empty = renderToStaticMarkup(
      <WorkspaceShell workspace={{ ...workspace, applications: [] }} route="apps" />,
    );
    expect(empty).toContain("Belum ada aplikasi");
    expect(empty).not.toContain("Aplikasi tidak ditemukan");

    expect(filterApplications(workspace.applications, "tidak-ada")).toHaveLength(0);
  });

  it("launcher contains only authorized applications and gates Administration SQ", () => {
    const ordinary = renderToStaticMarkup(
      <AppLauncher
        applications={workspace.applications}
        platformAdministration={false}
        previewOpen
      />,
    );
    expect(ordinary).toContain("HCIS");
    expect(ordinary).toContain("Portal Contoh");
    expect(ordinary).not.toContain("Finance");
    expect(ordinary).not.toContain("Administrasi SQ");
    expect(ordinary).toContain('aria-haspopup="dialog"');
    expect(ordinary).toContain('aria-expanded="true"');

    const admin = renderToStaticMarkup(
      <AppLauncher
        applications={workspace.applications}
        platformAdministration
        previewOpen
      />,
    );
    expect(admin).toContain('href="/admin"');
  });

  it("account menu links to Akun SQ, all apps, conditional admin, and official logout action", () => {
    const ordinary = renderToStaticMarkup(
      <AccountMenu user={workspace.user} onLogout={() => undefined} previewOpen />,
    );
    expect(ordinary).toContain('href="/account"');
    expect(ordinary).toContain("Kelola Akun SQ");
    expect(ordinary).toContain('href="/apps"');
    expect(ordinary).not.toContain('href="/admin"');
    expect(ordinary).toContain("Keluar");
    expect(ordinary).not.toContain("Segera");

    const admin = renderToStaticMarkup(
      <AccountMenu
        user={workspace.user}
        platformAdministration
        onLogout={() => undefined}
        previewOpen
      />,
    );
    expect(admin).toContain('href="/admin"');
  });

  it("mobile navigation marks the active route and conditionally exposes Admin", () => {
    const ordinary = renderToStaticMarkup(
      <MobileNavigation active="apps" platformAdministration={false} />,
    );
    expect(ordinary).toContain('href="/"');
    expect(ordinary).toContain('href="/apps"');
    expect(ordinary).toContain('href="/account"');
    expect(ordinary).not.toContain('href="/admin"');
    expect(ordinary).toContain('aria-current="page"');

    const admin = renderToStaticMarkup(
      <MobileNavigation active="admin" platformAdministration />,
    );
    expect(admin).toContain('href="/admin"');
  });
});
