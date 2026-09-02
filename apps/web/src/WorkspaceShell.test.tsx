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
    expect(html).toContain("Preview desain");
  });

  it("shows actionable Administrasi SQ navigation only for a server-authorized capability", () => {
    const ordinary = renderToStaticMarkup(<WorkspaceShell workspace={workspace} />);
    expect(ordinary).not.toContain('href="/admin"');

    const admin = renderToStaticMarkup(
      <WorkspaceShell
        workspace={{
          ...workspace,
          capabilities: { platformAdministration: true },
        }}
      />,
    );
    expect(admin).toContain("Administrasi SQ");
    expect(admin.match(/href="\/admin"/g)).toHaveLength(2);
  });

  it("renders only applications supplied by the authorized workspace boundary", () => {
    const html = renderToStaticMarkup(<WorkspaceShell workspace={workspace} />);

    expect(html).toContain("HCIS");
    expect(html).toContain("https://hcis.example.test");
    expect(html).not.toContain("Finance");
    expect(html).not.toContain("SPMB");
  });

  it("shows a safe empty state when the workspace contains no authorized applications", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell workspace={{ ...workspace, applications: [] }} />,
    );

    expect(html).toContain("Belum ada aplikasi");
    expect(html).toContain("Application Access aktif");
  });
});
