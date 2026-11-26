import { describe, expect, it } from "vitest";

import { parseSender, tanggalRingkas } from "@/sekretariat/format";
import { isSekretariatHost, resolveSekretariatRoute } from "@/sekretariat/routes";

describe("Sekretariat routes (SEK-IMPL-001 §9, SEK-IMPL-003)", () => {
  it("resolves every page", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(resolveSekretariatRoute("/")).toEqual({ name: "beranda" });
    expect(resolveSekretariatRoute("/ringkasan")).toEqual({ name: "beranda" });
    expect(resolveSekretariatRoute("/surat-keluar")).toEqual({ name: "surat-keluar" });
    expect(resolveSekretariatRoute("/buku")).toEqual({ name: "buku" });
    expect(resolveSekretariatRoute(`/kotak/${id}`)).toEqual({ name: "kotak", kotakId: id });
    expect(resolveSekretariatRoute(`/surat-masuk/${id}`)).toEqual({ name: "surat-masuk", suratMasukId: id });
    expect(resolveSekretariatRoute(`/penerbit/${id}/surat`)).toEqual({ name: "penerbit-surat", penerbitId: id });
    expect(resolveSekretariatRoute(`/surat/${id}`)).toEqual({ name: "surat", suratId: id });
    expect(resolveSekretariatRoute("/lainnya")).toEqual({ name: "not-found" });
  });

  it("opens Asisten Surat on its own page, over one draft (SEK-IMPL-004)", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(resolveSekretariatRoute(`/surat/${id}/asisten`)).toEqual({ name: "asisten", suratId: id });
    // The step lives in the query (UX-FLOW-001 rule 2), so the path alone still resolves.
    expect(resolveSekretariatRoute(`/surat/${id}/asisten/`)).toEqual({ name: "asisten", suratId: id });
    expect(resolveSekretariatRoute(`/surat/${id}/asisten/lain`)).toEqual({ name: "not-found" });
  });

  it("gives every settings concern its own page instead of one long stack", () => {
    expect(resolveSekretariatRoute("/pengaturan")).toEqual({ name: "pengaturan", bagian: "kotak-masuk" });
    for (const bagian of ["kotak-masuk", "penerbit", "petugas", "disposisi", "nomor-awal"] as const) {
      expect(resolveSekretariatRoute(`/pengaturan/${bagian}`)).toEqual({ name: "pengaturan", bagian });
    }
    expect(resolveSekretariatRoute("/pengaturan/rahasia")).toEqual({ name: "not-found" });
  });

  it("matches only the sekretariat host", () => {
    expect(isSekretariatHost("sekretariat.sabilulquran.or.id")).toBe(true);
    expect(isSekretariatHost("kerja.sabilulquran.or.id")).toBe(false);
    expect(isSekretariatHost("hub.sabilulquran.or.id")).toBe(false);
  });
});

describe("Sekretariat inbox rows read like a mail client (SEK-IMPL-003)", () => {
  it("splits a sender into name and address", () => {
    expect(parseSender("\"cPanel on sabilulquran.or.id\" <cpanel@sabilulquran.or.id>")).toEqual({ nama: "cPanel on sabilulquran.or.id", alamat: "cpanel@sabilulquran.or.id" });
    expect(parseSender("Dinas Pendidikan <dinas@example.go.id>")).toEqual({ nama: "Dinas Pendidikan", alamat: "dinas@example.go.id" });
    expect(parseSender("<tanpa.nama@example.id>")).toEqual({ nama: "tanpa.nama@example.id", alamat: "tanpa.nama@example.id" });
  });

  it("keeps a typed sender of a physical letter as it is", () => {
    expect(parseSender("Kantor Kemenag Kota")).toEqual({ nama: "Kantor Kemenag Kota", alamat: null });
    expect(parseSender("  ")).toEqual({ nama: "(tanpa pengirim)", alamat: null });
  });

  it("dates rows by time today, day and month this year, a short date before that", () => {
    const now = new Date("2026-11-18T08:00:00Z"); // 15.00 WIB
    expect(tanggalRingkas("2026-11-18T02:30:00Z", now)).toMatch(/^09[.:]30$/);
    expect(tanggalRingkas("2026-10-22T03:37:00Z", now)).toMatch(/^22 Okt/);
    expect(tanggalRingkas("2025-12-31T03:00:00Z", now)).toBe("31/12/25");
  });

  it("uses the Jakarta calendar day, not the browser's", () => {
    // 18.00 UTC on the 17th is already 01.00 WIB on the 18th, so it is "today".
    expect(tanggalRingkas("2026-11-17T18:00:00Z", new Date("2026-11-18T08:00:00Z"))).toMatch(/^01[.:]00$/);
  });
});
