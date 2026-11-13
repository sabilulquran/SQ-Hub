import { governanceFixture } from "@/dev/governanceFixture";
import type { GovernanceSnapshot } from "@/types";

/**
 * Development preview of the Portal Organ Yayasan with synthetic data: `?preview=organ` on any
 * portal path. Names and numbers are invented; nothing is fetched from a real application.
 */
const units = [
  { id: "00000000-0000-4000-8000-0000000000a1", name: "SDIT Tahfizh" },
  { id: "00000000-0000-4000-8000-0000000000a2", name: "Pesantren Tahfizh" },
  { id: "00000000-0000-4000-8000-0000000000a3", name: "General Affair" },
  { id: "00000000-0000-4000-8000-0000000000a4", name: "Taman Tahfizh" },
];

const given = ["Ahmad", "Aisyah", "Bilal", "Fatimah", "Hasan", "Khadijah", "Muhammad", "Nur", "Rahmat", "Siti", "Umar", "Zainab"];
const family = ["Fauzi", "Hidayat", "Kurniawan", "Lestari", "Maulana", "Nurhaliza", "Pratama", "Rahmawati", "Saputra", "Wahyuni"];
const positions = ["Guru Kelas", "Guru Tahfizh", "Wali Kelas", "Staf Administrasi", "Musyrif", "Kepala Unit"];
const statuses = ["Tetap", "Masa percobaan", "Kontrak"];

const employees = Array.from({ length: 97 }, (_, index) => ({
  fullName: `${given[index % given.length]} ${family[(index * 7) % family.length]}`,
  employeeNumber: `2${String(20140 + index * 13).padStart(6, "0")}`,
  unitName: units[index % units.length]!.name,
  position: positions[(index * 5) % positions.length]!,
  employmentStatus: statuses[index % 7 === 0 ? 1 : index % 5 === 0 ? 2 : 0]!,
  startedOn: `${2012 + (index % 13)}-${String(1 + (index % 12)).padStart(2, "0")}-01`,
})).sort((a, b) => a.fullName.localeCompare(b.fullName));

export const organPreviewSnapshot: GovernanceSnapshot = {
  ...governanceFixture,
  cards: governanceFixture.cards.map((card, index) =>
    card.state === "ready" && index === 0
      ? { ...card, summary: { ...card.summary, decisions: [{ label: "Cuti menunggu keputusan Anda", count: 2, oldestAgeDays: 3, href: "/keputusan" }] } }
      : card,
  ),
};

export function installOrganPreview(): void {
  const original = window.fetch.bind(window);
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  window.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (url.pathname === "/api/organ/session") {
      return json({ user: { displayName: "Anggota Sintetis" }, membership: { organ: "pengurus", positionLabel: "Sekretaris" } });
    }
    if (url.pathname === "/api/organ/summaries") return json(organPreviewSnapshot);
    const list = /^\/api\/organ\/applications\/([^/]+)\/employees$/.exec(url.pathname);
    if (list) {
      if (list[1] !== organPreviewSnapshot.cards[0]?.applicationKey) return json({ error: "not_found" }, 404);
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const unitId = url.searchParams.get("unitId");
      const unitName = units.find((unit) => unit.id === unitId)?.name;
      const filtered = employees.filter((employee) =>
        (!q || employee.fullName.toLowerCase().includes(q) || employee.employeeNumber.includes(q)) && (!unitName || employee.unitName === unitName));
      const page = Number(url.searchParams.get("page") ?? 1);
      const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
      return json({
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, pageSize, total: filtered.length, pageCount: Math.max(1, Math.ceil(filtered.length / pageSize)) },
        units,
      });
    }
    if (url.pathname === "/api/auth/logout") return json({ logoutUrl: "/" });
    return original(input, init);
  };
}
