import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceShell } from "@/WorkspaceShell";
import type { WorkspaceSnapshot } from "@/types";

const workspace: WorkspaceSnapshot = {
  user: {
    displayName: "Pegawai Sintetis",
    initials: "PS",
    contextLabel: "Unit Contoh",
  },
  applications: [
    {
      key: "hcis",
      name: "HCIS",
      description: "Aplikasi kepegawaian",
      canonicalUrl: "https://hcis.example.test",
    },
  ],
  capabilities: {
    platformAdministration: false,
  },
};

describe("SQ Hub workspace shell", () => {
  it("renders the HCIS-aligned YSQ brand lockup and responsive account triggers", () => {
    const html = renderToStaticMarkup(<WorkspaceShell workspace={workspace} preview />);

    expect(html).toContain("SQ Hub");
    expect(html).toContain("Yayasan Sabilul Qur&#x27;an");
    expect(html).toContain("h-11 w-11 shrink-0 object-contain");
    expect(html).toContain("h-9 w-9 shrink-0 object-contain");
    expect(html).not.toContain("h-8 w-8 object-contain");
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(2);
    expect(html).toContain("Administrasi SQ");
    expect(html).toContain("Preview desain");
  });

  it("renders only applications supplied by the authorized workspace boundary", () => {
    const html = renderToStaticMarkup(<WorkspaceShell workspace={workspace} />);

    expect(html).toContain("HCIS");
    expect(html).toContain("https://hcis.example.test");
    expect(html).not.toContain("Finance");
    expect(html).not.toContain("SPMB");
  });

  it("does not expose an enabled Admin Center entry to an ordinary user", () => {
    const html = renderToStaticMarkup(<WorkspaceShell workspace={workspace} />);

    expect(html).not.toContain('href="/admin"');
  });

  it("activates Administrasi SQ navigation only for a server-authorized admin capability", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell
        workspace={{
          ...workspace,
          capabilities: { platformAdministration: true },
        }}
      />,
    );

    expect(html).toContain('href="/admin"');
    expect(html).toContain("Administrasi SQ");
  });

  it("renders the protected read-only Admin Center overview", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell
        workspace={{ ...workspace, capabilities: { platformAdministration: true } }}
        view="admin"
        adminState={{
          status: "authorized",
          context: {
            authorized: true,
            displayName: "Pegawai Sintetis",
            capabilities: { platformAdministration: true },
            overview: {
              applications: { total: 2, active: 1, inactive: 1 },
              applicationAccess: { total: 3, active: 2, revoked: 1 },
              auditEventsLast24Hours: 4,
            },
          },
        }}
      />,
    );

    expect(html).toContain("Fondasi administrasi platform");
    expect(html).toContain("Ringkasan platform");
    expect(html).toContain("Akses Aplikasi");
    expect(html).toContain("Audit 24 jam");
    expect(html).not.toContain("opaque-subject");
  });

  it("shows a safe privileged reauthentication state without a password form", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell
        workspace={workspace}
        view="admin"
        adminState={{ status: "reauth_required" }}
      />,
    );

    expect(html).toContain("Masuk ulang untuk Administrasi SQ");
    expect(html).toContain("Keluar dan masuk kembali");
    expect(html).not.toContain('type="password"');
  });

  it("shows a safe empty state when the workspace contains no authorized applications", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell workspace={{ ...workspace, applications: [] }} />,
    );

    expect(html).toContain("Belum ada aplikasi");
    expect(html).toContain("Application Access aktif");
  });
});
