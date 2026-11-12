import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { governanceFixture } from "@/dev/governanceFixture";
import { collectDecisions } from "@/organ-portal/decisions";
import { OrganAppView } from "@/organ-portal/OrganApp";
import { isOrganHost, resolveOrganRoute } from "@/organ-portal/routes";
import type { GovernanceSnapshot } from "@/types";

// ORGAN-IMPL-001 R1, web side. Synthetic data only.
const session = { user: { displayName: "Anggota Sintetis" }, membership: { organ: "pengurus" as const, positionLabel: "Ketua Pengurus" } };

function withDecisions(): GovernanceSnapshot {
  return {
    ...governanceFixture,
    cards: governanceFixture.cards.map((card, index) =>
      card.state === "ready" && index === 0
        ? { ...card, summary: { ...card.summary, decisions: [{ label: "Cuti menunggu keputusan Anda", count: 2, oldestAgeDays: 3, href: "https://hcis.example.test/board" }] } }
        : card,
    ),
  };
}

function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
}

describe("Portal Organ Yayasan routes", () => {
  it("recognises the organ host and its two pages", () => {
    expect(isOrganHost("organ.sabilulquran.or.id")).toBe(true);
    expect(isOrganHost("hub.sabilulquran.or.id")).toBe(false);
    expect(resolveOrganRoute("/")).toEqual({ name: "ringkasan" });
    expect(resolveOrganRoute("/keputusan/")).toEqual({ name: "keputusan" });
    expect(resolveOrganRoute("/admin")).toEqual({ name: "not-found" });
  });
});

describe("Portal Organ Yayasan view", () => {
  it("shows the overview without the staff app grid, with the decisions card first", () => {
    const snapshot = withDecisions();
    const html = renderToStaticMarkup(<OrganAppView route={{ name: "ringkasan" }} state={{ status: "ready", session, snapshot }} />);
    const visible = text(html);
    expect(visible).toContain("Portal Organ Yayasan");
    expect(visible).toContain("Assalamu'alaikum, Anggota Sintetis");
    expect(visible).toContain("Menunggu keputusan Anda");
    expect(visible).toContain("Cuti menunggu keputusan Anda");
    expect(visible).not.toContain("Aplikasi Anda");
    expect(html).toContain('href="https://hcis.example.test/board"');
    expect(visible.indexOf("Menunggu keputusan Anda")).toBeLessThan(visible.indexOf("Perlu perhatian"));
  });

  it("leaves the decisions card out of the overview when nothing waits, but says so on the Keputusan page", () => {
    const overview = text(renderToStaticMarkup(<OrganAppView route={{ name: "ringkasan" }} state={{ status: "ready", session, snapshot: governanceFixture }} />));
    expect(overview).not.toContain("Menunggu keputusan Anda");
    const page = text(renderToStaticMarkup(<OrganAppView route={{ name: "keputusan" }} state={{ status: "ready", session, snapshot: governanceFixture }} />));
    expect(page).toContain("Tidak ada pengajuan yang menunggu keputusan Anda.");
  });

  it("collects decisions from every ready card with the application name", () => {
    expect(collectDecisions(withDecisions().cards)).toEqual([
      expect.objectContaining({ count: 2, oldestAgeDays: 3, application: governanceFixture.cards[0]!.state === "ready" ? governanceFixture.cards[0]!.summary.title : "" }),
    ]);
  });

  it.each([
    ["organ_membership_required", "Portal ini khusus Organ Yayasan"],
    ["organ_access_denied", "Akses portal belum diberikan"],
  ])("explains a %s refusal without navigation or account data", (code, title) => {
    const visible = text(renderToStaticMarkup(<OrganAppView route={{ name: "ringkasan" }} state={{ status: "refused", code }} />));
    expect(visible).toContain(title);
    expect(visible).not.toContain("Keputusan");
    expect(visible).not.toContain("Keluar");
  });
});
