import type { KartuDetail, KartuRingkas, KerjaContext, Notifikasi, Papan, RuangDetail, RuangRingkas, TugasSaya } from "@/kerja/api";

/**
 * Development preview only (`?preview=kerja` with VITE preview on): an in-memory `/api/kerja`
 * so the screens can be checked without Keycloak or a database. Synthetic people and rooms.
 */
const P = (n: number, nama: string) => ({ id: `hcis:employee:00000000-0000-4000-9000-00000000000${n}`, nama, aktif: true });
const KEPALA = P(1, "Kepala SMPIT");
const WAKA = P(2, "Wakasek Kurikulum");
const TU = P(3, "Operator TU");
const KABID = P(4, "Kepala Bidang Pendidikan");
const RUANG = "11111111-1111-4111-8111-111111111111";
const PAPAN = "22222222-2222-4222-8222-222222222222";
const K = (n: number) => `33333333-3333-4333-8333-00000000000${n}`;
const KOL = ["44444444-4444-4444-8444-000000000001", "44444444-4444-4444-8444-000000000002", "44444444-4444-4444-8444-000000000003"];
const LABEL_PENTING = { id: "55555555-5555-4555-8555-000000000001", nama: "Penting", warna: "merah" as const };
const LABEL_AKADEMIK = { id: "55555555-5555-4555-8555-000000000002", nama: "Akademik", warna: "biru" as const };

const day = (offset: number, hour = 9) => new Date(Date.UTC(2026, 10, 10 + offset, hour - 7)).toISOString();

function card(n: number, judul: string, kolom: number, extra: Partial<KartuRingkas> = {}): KartuRingkas {
  return {
    id: K(n), ruangId: RUANG, ruangNama: "SMPIT Tahfizh Sabilul Qur'an", papanId: PAPAN, papanNama: "Papan kerja", kolomId: KOL[kolom]!,
    kolomNama: ["Akan dikerjakan", "Sedang dikerjakan", "Selesai"][kolom]!, judul, mulaiPada: null, tenggatPada: null, selesaiJenis: null, arsip: false,
    posisi: String(n * 1024), label: [], orang: [], ceklis: { selesai: 0, total: 0 }, komentar: 0, lampiran: 0, ...extra,
  };
}

let cards: KartuRingkas[] = [
  card(1, "Susun jadwal ujian akhir semester", 0, { tenggatPada: day(4), label: [LABEL_AKADEMIK], orang: [WAKA], ceklis: { selesai: 1, total: 3 }, komentar: 2 }),
  card(2, "Rekap kehadiran guru bulan Oktober", 0, { tenggatPada: day(-2), label: [LABEL_PENTING], orang: [TU], lampiran: 1 }),
  card(3, "Siapkan berkas akreditasi tahap dua", 1, { tenggatPada: day(0, 15), label: [LABEL_PENTING, LABEL_AKADEMIK], orang: [KEPALA, WAKA, TU], ceklis: { selesai: 4, total: 6 } }),
  card(4, "Rapat wali kelas", 2, { selesaiJenis: "tuntas", orang: [WAKA] }),
];

function board(): Papan {
  return {
    id: PAPAN, nama: "Papan kerja", ruang: { id: RUANG, nama: "SMPIT Tahfizh Sabilul Qur'an", status: "aktif", peranSaya: "pj" },
    papanRuang: [{ id: PAPAN, nama: "Papan kerja" }], label: [LABEL_AKADEMIK, LABEL_PENTING],
    anggota: [{ ...KEPALA, peran: "pj" }, { ...WAKA, peran: "anggota" }, { ...TU, peran: "anggota" }, { ...KABID, peran: "peninjau" }],
    kolom: KOL.map((id, index) => ({ id, nama: ["Akan dikerjakan", "Sedang dikerjakan", "Selesai"][index]!, menandaiSelesai: index === 2, kartu: cards.filter((item) => item.kolomId === id) })),
  };
}

function detail(id: string): KartuDetail {
  const summary = cards.find((item) => item.id === id) ?? cards[0]!;
  return {
    id: summary.id, ruang: { id: RUANG, nama: summary.ruangNama, peranSaya: "pj", status: "aktif" }, papan: { id: PAPAN, nama: "Papan kerja" },
    kolom: { id: summary.kolomId, nama: summary.kolomNama }, judul: summary.judul,
    uraian: `<p>Jadwal disusun per jenjang. Mohon <span data-sebut="${TU.id}">@${TU.nama}</span> menyiapkan daftar ruang.</p><ul><li>Kelas 7</li><li>Kelas 8 dan 9</li></ul>`,
    mulaiPada: summary.mulaiPada, tenggatPada: summary.tenggatPada,
    selesai: summary.selesaiJenis ? { jenis: summary.selesaiJenis, pada: day(-1), oleh: WAKA } : null, arsip: false,
    dibuatOleh: KEPALA, dibuatPada: day(-5), label: summary.label, orang: summary.orang,
    ceklis: [{ id: "66666666-6666-4666-8666-000000000001", nama: "Persiapan", kemajuan: { selesai: 1, total: 3 }, butir: [
      { id: "77777777-7777-4777-8777-000000000001", nama: "Kumpulkan kalender akademik", tenggatPada: day(1), selesai: true, orang: [WAKA], lampiran: [] },
      { id: "77777777-7777-4777-8777-000000000002", nama: "Daftar ruang ujian", tenggatPada: day(2), selesai: false, orang: [TU], lampiran: [] },
      { id: "77777777-7777-4777-8777-000000000003", nama: "Kirim ke kepala sekolah", tenggatPada: null, selesai: false, orang: [], lampiran: [] },
    ] }],
    komentar: [{ id: "88888888-8888-4888-8888-000000000001", penulis: KEPALA, isi: "<p>Usahakan selesai sebelum rapat Senin.</p>", dihapus: false, dibuatPada: day(-1, 10), disuntingPada: null, milikSaya: true,
      balasan: [{ id: "88888888-8888-4888-8888-000000000002", penulis: WAKA, isi: "<p>Siap, draf pertama Jumat.</p>", dihapus: false, dibuatPada: day(-1, 11), disuntingPada: null, milikSaya: false }] }],
    lampiran: [{ id: "99999999-9999-4999-8999-000000000001", nama: "Kalender akademik 2026-2027.pdf", mime: "application/pdf", ukuran: 482_000, diunggahOleh: WAKA, diunggahPada: day(-2), diArsip: false }],
    riwayat: [
      { aksi: "pindah_kolom", aktor: WAKA, pada: day(-1, 12), lama: { kolom: "Akan dikerjakan" }, baru: { kolom: summary.kolomNama } },
      { aksi: "tambah_orang", aktor: KEPALA, pada: day(-5), lama: null, baru: { orang: WAKA.nama } },
      { aksi: "dibuat", aktor: KEPALA, pada: day(-5), lama: null, baru: null },
    ],
  };
}

const context: KerjaContext = { displayName: KEPALA.nama, orang: { id: KEPALA.id, nama: KEPALA.nama }, directoryTersedia: true, pengelola: true };
const rooms: RuangRingkas[] = [
  { id: RUANG, jenis: "tetap", nama: "SMPIT Tahfizh Sabilul Qur'an", status: "aktif", berakhirPada: null, akanBerakhir: false, peran: "pj", kartuTerbuka: 3, kartuLewatTenggat: 1 },
  { id: "11111111-1111-4111-8111-111111111112", jenis: "panitia", nama: "Panitia SPMB 2027", status: "aktif", berakhirPada: "2026-12-01", akanBerakhir: true, peran: "anggota", kartuTerbuka: 7, kartuLewatTenggat: 0 },
];
const notifications: Notifikasi[] = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", jenis: "tenggat_h1hari", kartuId: K(3), judul: cards[2]!.judul, ruang: "SMPIT Tahfizh Sabilul Qur'an", dibuatPada: day(-1, 15), dibaca: false, tenggatPada: day(0, 15), mulaiPada: null },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002", jenis: "sebutan", kartuId: K(1), judul: cards[0]!.judul, ruang: "SMPIT Tahfizh Sabilul Qur'an", dibuatPada: day(-2), dibaca: true, tenggatPada: null, mulaiPada: null },
];

function tasks(): { items: TugasSaya[]; ruang: Array<{ id: string; nama: string }> } {
  const mine = cards.filter((item) => !item.selesaiJenis);
  return {
    ruang: rooms.map((room) => ({ id: room.id, nama: room.nama })),
    items: mine.map((item) => ({ ...item, ditugaskanKeSaya: true, butirSaya: [], tenggatEfektif: item.tenggatPada, lewatTenggat: item.tenggatPada !== null && Date.parse(item.tenggatPada) < Date.now() }))
      .sort((a, b) => Number(b.lewatTenggat) - Number(a.lewatTenggat) || (a.tenggatEfektif ?? "9").localeCompare(b.tenggatEfektif ?? "9")),
  };
}

function roomDetail(): RuangDetail {
  return { id: RUANG, jenis: "tetap", nama: "SMPIT Tahfizh Sabilul Qur'an", unit: { id: "hcis:org-node:x", nama: "SMPIT" }, status: "aktif", berakhirPada: null, peranSaya: "pj", papan: [{ id: PAPAN, nama: "Papan kerja" }], anggota: board().anggota, kuota: { terpakai: 182_000_000, batas: 1_073_741_824 } };
}

export function installKerjaPreview(): void {
  const original = window.fetch.bind(window);
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  window.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (!url.pathname.startsWith("/api/kerja") && !url.pathname.startsWith("/api/admin/kerja")) return original(input, init);
    const path = url.pathname.replace(/^\/api(\/admin)?\/kerja/, "");
    const method = init?.method ?? "GET";
    if (path === "/context") return json(context);
    if (path === "/launcher") return json({ applications: [{ key: "kerja-sq", name: "Kerja", canonicalUrl: "/" }, { key: "hcis", name: "HCIS", canonicalUrl: "https://hcis.sabilulquran.or.id" }] });
    if (path === "/tugas-saya") return json(tasks());
    if (path.startsWith("/notifikasi")) return json({ belumDibaca: notifications.filter((item) => !item.dibaca).length, items: notifications });
    if (path === "/ruang" && method === "GET") return json(url.pathname.includes("/admin/") ? { items: [] } : { items: rooms });
    if (path === `/ruang/${RUANG}`) return json(roomDetail());
    if (path === `/papan/${PAPAN}`) return json(board());
    const pindah = /^\/kartu\/([0-9a-f-]{36})\/pindah$/.exec(path);
    if (pindah && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { kolom_id: string; indeks: number; selesai_jenis?: "tuntas" | "batal" | "ditunda" };
      const moving = cards.find((item) => item.id === pindah[1]);
      if (!moving) return json({ error: "tidak_ditemukan", message: "Tidak ditemukan." }, 404);
      const others = cards.filter((item) => item.id !== moving.id);
      const column = others.filter((item) => item.kolomId === body.kolom_id);
      const updated = { ...moving, kolomId: body.kolom_id, kolomNama: board().kolom.find((item) => item.id === body.kolom_id)?.nama ?? "", ...(body.selesai_jenis ? { selesaiJenis: body.selesai_jenis } : {}) };
      column.splice(Math.min(body.indeks, column.length), 0, updated);
      cards = [...others.filter((item) => item.kolomId !== body.kolom_id), ...column];
      return json({ id: moving.id });
    }
    const kartu = /^\/kartu\/([0-9a-f-]{36})$/.exec(path);
    if (kartu) return json(detail(kartu[1]!));
    if (path === "/unit") return json({ items: [], directory: { stale: false } });
    return json({ error: "tidak_ditemukan", message: "Pratinjau tidak punya data ini." }, 404);
  };
}
