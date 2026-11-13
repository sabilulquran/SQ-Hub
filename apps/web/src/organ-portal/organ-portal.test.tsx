import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { governanceFixture } from "@/dev/governanceFixture";
import { collectDecisions } from "@/organ-portal/decisions";
import { EmployeeListView } from "@/organ-portal/EmployeeList";
import { OrganAppView } from "@/organ-portal/OrganApp";
import { detailHref, isOrganHost, resolveOrganRoute } from "@/organ-portal/routes";
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
    expect(resolveOrganRoute("/aplikasi/hcis")).toEqual({ name: "aplikasi", applicationKey: "hcis" });
    expect(resolveOrganRoute("/aplikasi/../admin")).toEqual({ name: "not-found" });
    expect(detailHref("hcis")).toBe("/aplikasi/hcis");
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

  it("links each section's Rincian to the organ host, not the application", () => {
    const html = renderToStaticMarkup(<OrganAppView route={{ name: "ringkasan" }} state={{ status: "ready", session, snapshot: governanceFixture }} />);
    const ready = governanceFixture.cards.find((card) => card.state === "ready");
    expect(html).toContain(`href="/aplikasi/${ready!.applicationKey}"`);
    expect(html).not.toMatch(/href="https?:\/\/[^"]*\/board"/);
  });

  it("renders the Rincian page with the employee list slot", () => {
    const ready = governanceFixture.cards.find((card) => card.state === "ready")!;
    const visible = text(renderToStaticMarkup(
      <OrganAppView
        route={{ name: "aplikasi", applicationKey: ready.applicationKey }}
        state={{ status: "ready", session, snapshot: governanceFixture }}
        detail={(key) => <p>daftar {key}</p>}
      />,
    ));
    expect(visible).toContain(`daftar ${ready.applicationKey}`);
    const missing = text(renderToStaticMarkup(<OrganAppView route={{ name: "aplikasi", applicationKey: "tidak-ada" }} state={{ status: "ready", session, snapshot: governanceFixture }} />));
    expect(missing).toContain("Rincian tidak ditemukan");
  });
});

describe("Daftar pegawai (ORG-014)", () => {
  const page = {
    items: [{ fullName: "Pegawai Sintetis", employeeNumber: "2020001", unitName: "Unit Sintetis", position: "Guru Kelas", employmentStatus: "Tetap", startedOn: "2020-01-01" }],
    pagination: { page: 2, pageSize: 25, total: 26, pageCount: 2 },
    units: [{ id: "00000000-0000-4000-8000-000000000001", name: "Unit Sintetis" }],
  };

  it("shows the six permitted fields and where the page sits", () => {
    const visible = text(renderToStaticMarkup(<EmployeeListView state={{ status: "ready", page }} filters={{ page: 2, q: "", unitId: "" }} />));
    for (const value of ["Pegawai Sintetis", "2020001", "Unit Sintetis", "Guru Kelas", "Tetap", "Mulai bekerja"]) expect(visible).toContain(value);
    expect(visible).toContain("26–26 dari 26 pegawai");
  });

  it("says so when nothing matches", () => {
    const empty = { ...page, items: [], pagination: { page: 1, pageSize: 25, total: 0, pageCount: 0 } };
    expect(text(renderToStaticMarkup(<EmployeeListView state={{ status: "ready", page: empty }} filters={{ page: 1, q: "zz", unitId: "" }} />))).toContain("Tidak ada pegawai yang cocok");
  });
});
