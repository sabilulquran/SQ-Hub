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
};

describe("SQ Hub workspace shell", () => {
  it("renders the YSQ workspace identity and responsive account triggers", () => {
    const html = renderToStaticMarkup(<WorkspaceShell workspace={workspace} preview />);

    expect(html).toContain("SQ Hub");
    expect(html).toContain("Yayasan Sabilul Qur&#x27;an");
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

  it("shows a safe empty state when the workspace contains no authorized applications", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell workspace={{ ...workspace, applications: [] }} />,
    );

    expect(html).toContain("Belum ada aplikasi");
    expect(html).toContain("Application Access aktif");
  });
});
