import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { KartuDetail, Papan } from "@/kerja/api";
import { formatTanggal, fromWibInput, toWibInput } from "@/kerja/format";
import { KartuPanel } from "@/kerja/KartuPanel";
import { KerjaAppView } from "@/kerja/KerjaApp";
import { PapanPage } from "@/kerja/PapanPage";
import { isKerjaHost, resolveKerjaRoute } from "@/kerja/routes";
import { RuangListPage, TugasPage } from "@/kerja/TugasPage";

const ID = "22222222-2222-4222-8222-222222222222";
const person = (n: number, nama: string) => ({ id: `hcis:employee:00000000-0000-4000-9000-00000000000${n}`, nama, aktif: true });
const KEPALA = person(1, "Kepala SMPIT");
const KABID = person(4, "Kepala Bidang");

const board = (peranSaya: "pj" | "anggota" | "peninjau"): Papan => ({
  id: ID, nama: "Papan kerja", ruang: { id: ID, nama: "SMPIT", status: "aktif", peranSaya }, papanRuang: [{ id: ID, nama: "Papan kerja" }],
  label: [{ id: "l1", nama: "Penting", warna: "merah" }], anggota: [{ ...KEPALA, peran: "pj" }, { ...KABID, peran: "peninjau" }],
  kolom: [
    { id: "k1", nama: "Akan dikerjakan", menandaiSelesai: false, kartu: [{
      id: "c1", ruangId: ID, ruangNama: "SMPIT", papanId: ID, papanNama: "Papan kerja", kolomId: "k1", kolomNama: "Akan dikerjakan", judul: "Susun jadwal ujian",
      mulaiPada: null, tenggatPada: "2026-11-20T02:00:00Z", selesaiJenis: null, arsip: false, posisi: "1024", label: [{ id: "l1", nama: "Penting", warna: "merah" }],
      orang: [KEPALA], ceklis: { selesai: 1, total: 3 }, komentar: 2, lampiran: 0,
    }] },
    { id: "k2", nama: "Selesai", menandaiSelesai: true, kartu: [] },
  ],
});

const detail = (peranSaya: "pj" | "peninjau"): KartuDetail => ({
  id: "c1", ruang: { id: ID, nama: "SMPIT", peranSaya, status: "aktif" }, papan: { id: ID, nama: "Papan kerja" }, kolom: { id: "k1", nama: "Akan dikerjakan" },
  judul: "Susun jadwal ujian", uraian: "<p>Per jenjang.</p>", mulaiPada: null, tenggatPada: "2026-11-20T02:00:00Z", selesai: null, arsip: false,
  dibuatOleh: KEPALA, dibuatPada: "2026-11-01T02:00:00Z", label: [], orang: [KEPALA], ceklis: [], komentar: [], lampiran: [],
  riwayat: [{ aksi: "dibuat", aktor: KEPALA, pada: "2026-11-01T02:00:00Z", lama: null, baru: null }],
});

describe("Kerja host routing (KERJA-IMPL-001 §2, §8)", () => {
  it("serves Kerja only on the kerja. host and resolves its pages", () => {
    expect(isKerjaHost("kerja.sabilulquran.or.id")).toBe(true);
    expect(isKerjaHost("kirim.sabilulquran.or.id")).toBe(false);
    expect(resolveKerjaRoute("/")).toEqual({ name: "tugas" });
    expect(resolveKerjaRoute("/ruang/")).toEqual({ name: "ruang-daftar" });
    expect(resolveKerjaRoute(`/papan/${ID}`)).toEqual({ name: "papan", papanId: ID });
    expect(resolveKerjaRoute(`/ruang/${ID}/pengaturan`)).toEqual({ name: "pengaturan", ruangId: ID });
    expect(resolveKerjaRoute("/papan/../../etc")).toEqual({ name: "not-found" });
  });
});

describe("Asia/Jakarta, 24-hour clock (KERJA-001 §13)", () => {
  it("round-trips a WIB input value and never shows AM/PM", () => {
    expect(fromWibInput("2026-11-20T09:00")).toBe("2026-11-20T09:00:00+07:00");
    expect(toWibInput("2026-11-20T02:00:00Z")).toBe("2026-11-20T09:00");
    expect(toWibInput("2026-11-19T17:30:00Z")).toBe("2026-11-20T00:30");
    expect(fromWibInput("")).toBeNull();
    const shown = formatTanggal("2026-11-20T13:30:00Z");
    // Indonesian style writes 20.30; either way the clock is 24-hour.
    expect(shown).toMatch(/20[.:]30/);
    expect(shown).not.toMatch(/AM|PM/);
  });
});

describe("Kerja shell and pages", () => {
  it("shows the Kerja lockup without the SQ abbreviation, and Pengelola only to kerja_admin", () => {
    const ready = { status: "ready" as const, context: { displayName: "Kepala SMPIT", orang: { id: KEPALA.id, nama: KEPALA.nama }, directoryTersedia: true, pengelola: false } };
    const html = renderToStaticMarkup(<KerjaAppView state={ready} route={{ name: "not-found" }} />);
    expect(html).toContain(">Kerja</p>");
    expect(html).not.toContain("Kerja SQ");
    expect(html).toContain('href="/ruang"');
    expect(html).not.toContain('href="/pengelola"');
    const admin = renderToStaticMarkup(<KerjaAppView state={{ ...ready, context: { ...ready.context, pengelola: true } }} route={{ name: "not-found" }} />);
    expect(admin).toContain('href="/pengelola"');
  });

  it("explains a refusal and a missing Directory person instead of showing empty pages", () => {
    expect(renderToStaticMarkup(<KerjaAppView state={{ status: "forbidden", code: "kerja_access_denied", message: "" }} route={{ name: "tugas" }} />)).toContain("Anda belum punya akses aplikasi Kerja");
    const html = renderToStaticMarkup(<KerjaAppView state={{ status: "ready", context: { displayName: "X", orang: null, directoryTersedia: true, pengelola: false } }} route={{ name: "tugas" }} />);
    expect(html).toContain("belum tercatat di Organization Directory");
  });

  it("puts overdue tasks first and gives an empty state with a first step", () => {
    const base = board("pj").kolom[0]!.kartu[0]!;
    const html = renderToStaticMarkup(<TugasPage preview={{ ruang: [], items: [
      { ...base, id: "a", judul: "Lewat", ditugaskanKeSaya: true, butirSaya: [], tenggatEfektif: "2026-11-01T02:00:00Z", lewatTenggat: true },
      { ...base, id: "b", judul: "Nanti", ditugaskanKeSaya: false, butirSaya: [{ id: "i", nama: "Bagian saya", tenggatPada: null, selesai: false }], tenggatEfektif: null, lewatTenggat: false },
    ] }} />);
    expect(html.indexOf("Lewat tenggat")).toBeLessThan(html.indexOf("Nanti"));
    expect(html).toContain("Bagian saya");
    const empty = renderToStaticMarkup(<TugasPage preview={{ ruang: [], items: [] }} />);
    expect(empty).toContain("buat kartu pertama");
    expect(renderToStaticMarkup(<RuangListPage preview={{ items: [] }} />)).toContain("Anda belum menjadi anggota ruang mana pun");
  });

  it("lets pj and anggota add cards but keeps the board read-only for a reviewer", () => {
    const pj = renderToStaticMarkup(<PapanPage papanId={ID} preview={board("pj")} />);
    expect(pj).toContain("Susun jadwal ujian");
    expect(pj).toContain("Tambah kartu");
    expect(pj).toContain("Pengaturan");
    const reviewer = renderToStaticMarkup(<PapanPage papanId={ID} preview={board("peninjau")} />);
    expect(reviewer).not.toContain("Tambah kartu");
    expect(reviewer).not.toContain("Pengaturan");
  });

  it("shows card actions by role", () => {
    const pj = renderToStaticMarkup(<KartuPanel kartuId="c1" preview={{ detail: detail("pj"), papan: board("pj") }} />);
    expect(pj).toContain("Tutup kartu");
    expect(pj).toContain("Kirim komentar");
    expect(pj).toContain("Unggah lampiran");
    const reviewer = renderToStaticMarkup(<KartuPanel kartuId="c1" preview={{ detail: detail("peninjau"), papan: board("peninjau") }} />);
    expect(reviewer).toContain("kartu hanya bisa dibaca");
    expect(reviewer).not.toContain("Tutup kartu");
    expect(reviewer).not.toContain("Kirim komentar");
  });
});
