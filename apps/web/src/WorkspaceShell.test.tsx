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

  it("launcher lists SQ Hub first, then only authorized applications, with no admin entry", () => {
    const html = renderToStaticMarkup(<AppLauncher applications={workspace.applications} previewOpen />);
    expect(html).toContain("Beranda semua aplikasi Anda");
    expect(html.indexOf("SQ Hub")).toBeLessThan(html.indexOf("HCIS"));
    expect(html).toContain("Portal Contoh");
    expect(html).not.toContain("Finance");
    expect(html).not.toContain('href="/admin"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="true"');
  });

  it("account menu holds identity, Akun SQ, Tampilan and Keluar only", () => {
    const ordinary = renderToStaticMarkup(
      <AccountMenu user={workspace.user} onLogout={() => undefined} previewOpen />,
    );
    expect(ordinary).toContain('href="/account"');
    expect(ordinary).toContain("Akun SQ");
    expect(ordinary).toContain("Tampilan");
    expect(ordinary).toContain("Terang");
    expect(ordinary).toContain("Gelap");
    expect(ordinary).toContain("Sistem");
    expect(ordinary).toContain("Keluar");
    expect(ordinary).not.toContain('href="/apps"');
    expect(ordinary).not.toContain('href="/admin"');
    expect(ordinary).not.toContain("SQ Identity");

    const admin = renderToStaticMarkup(
      <AccountMenu user={workspace.user} platformAdministration onLogout={() => undefined} previewOpen />,
    );
    expect(admin).toContain("Platform Administrator");
    expect(admin).not.toContain('href="/admin"');
  });

  it("space switcher is the only admin entry and appears only for platform administrators", () => {
    const ordinary = renderToStaticMarkup(<WorkspaceShell workspace={workspace} route="home" />);
    expect(ordinary).not.toContain("Pindah ruang");
    expect(ordinary).not.toContain('href="/admin"');

    const adminWorkspace = { ...workspace, capabilities: { platformAdministration: true } };
    const admin = renderToStaticMarkup(<WorkspaceShell workspace={adminWorkspace} route="home" />);
    expect(admin).toContain('role="tablist" aria-label="Pindah ruang"');
    expect(admin.match(/href="\/admin"/g)).toHaveLength(1);
    expect(admin).toContain('aria-selected="true"');
  });

  it("sidebar is navigation only: no account menu, avatar or sign-out inside it", () => {
    const html = renderToStaticMarkup(<WorkspaceShell workspace={workspace} route="home" />);
    const sidebar = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
    expect(sidebar).toContain('href="/"');
    expect(sidebar).toContain('href="/apps"');
    expect(sidebar).toContain('href="/account"');
    expect(sidebar).not.toContain("Keluar");
    expect(sidebar).not.toContain("Menu akun");
    expect(sidebar).not.toContain(workspace.user.initials);
  });

  it("phone navigation marks the active route and adds Lainnya only when there is more", () => {
    const ordinary = renderToStaticMarkup(
      <MobileNavigation space="workspace" active="apps" platformAdministration={false} />,
    );
    expect(ordinary).toContain('href="/"');
    expect(ordinary).toContain('href="/apps"');
    expect(ordinary).toContain('href="/account"');
    expect(ordinary).not.toContain("Lainnya");
    expect(ordinary).toContain('aria-current="page"');

    const adminSheet = renderToStaticMarkup(
      <MobileNavigation space="admin" active="admin-access" platformAdministration previewMoreOpen />,
    );
    expect(adminSheet).toContain("Lainnya");
    expect(adminSheet).toContain('href="/admin/lifecycle"');
    expect(adminSheet).toContain("Pindah ruang");
    expect(adminSheet).toContain("Ruang pegawai");
  });
});
