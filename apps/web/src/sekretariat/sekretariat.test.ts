import { describe, expect, it } from "vitest";

import { isSekretariatHost, resolveSekretariatRoute } from "@/sekretariat/routes";

describe("Sekretariat routes (SEK-IMPL-001 §9)", () => {
  it("resolves every page", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(resolveSekretariatRoute("/")).toEqual({ name: "ringkasan" });
    expect(resolveSekretariatRoute("/buku")).toEqual({ name: "buku" });
    expect(resolveSekretariatRoute("/pengaturan")).toEqual({ name: "pengaturan" });
    expect(resolveSekretariatRoute(`/kotak/${id}`)).toEqual({ name: "kotak", kotakId: id });
    expect(resolveSekretariatRoute(`/surat-masuk/${id}`)).toEqual({ name: "surat-masuk", suratMasukId: id });
    expect(resolveSekretariatRoute(`/penerbit/${id}/surat`)).toEqual({ name: "penerbit-surat", penerbitId: id });
    expect(resolveSekretariatRoute(`/surat/${id}`)).toEqual({ name: "surat", suratId: id });
    expect(resolveSekretariatRoute("/lainnya")).toEqual({ name: "not-found" });
  });

  it("matches only the sekretariat host", () => {
    expect(isSekretariatHost("sekretariat.sabilulquran.or.id")).toBe(true);
    expect(isSekretariatHost("kerja.sabilulquran.or.id")).toBe(false);
    expect(isSekretariatHost("hub.sabilulquran.or.id")).toBe(false);
  });
});
