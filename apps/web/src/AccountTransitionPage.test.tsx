import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountTransitionPage } from "@/AccountTransitionPage";
import type { WorkspaceSnapshot } from "@/types";

const workspace: WorkspaceSnapshot = {
  user: { displayName: "Ahmad Fikri", initials: "AF", contextLabel: "UAT-HCIS-001" },
  applications: [],
  capabilities: { platformAdministration: false },
};

describe("Akun SQ transition route", () => {
  it("uses only the stable internal account endpoint and exposes no arbitrary redirect target", () => {
    const html = renderToStaticMarkup(<AccountTransitionPage workspace={workspace} preview />);

    expect(html).toContain("Membuka Akun SQ");
    expect(html).toContain('href="/api/account"');
    expect(html).not.toContain("redirect=");
    expect(html).not.toContain("target=");
    expect(html).not.toContain("login.sabilulquran.or.id");
  });

  it("marks Akun as the active mobile destination", () => {
    const html = renderToStaticMarkup(<AccountTransitionPage workspace={workspace} preview />);
    expect(html).toContain('href="/account"');
    expect(html).toContain('aria-current="page"');
  });
});
