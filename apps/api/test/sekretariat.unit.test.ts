import { describe, expect, it } from "vitest";

import { csvCell, formatUrut, jakartaParts, nomorLengkap, romawiBulan } from "../src/modules/sekretariat/buku.js";
import { loadSekretariatConfig } from "../src/modules/sekretariat/config.js";
import { eksporDoc003Schema } from "../src/modules/sekretariat/migrasi.js";

describe("SEK-IMPL-001 penomoran (pedoman Pasal 13)", () => {
  it("merakit contoh pedoman persis", () => {
    expect(nomorLengkap({ jenisKode: "01", urut: 1, penerbitKode: "PENG.YSQ", bulan: 1, tahun: 2026 })).toBe("01.001/PENG.YSQ/I/2026");
    expect(nomorLengkap({ jenisKode: "12", urut: 3, penerbitKode: "PAN.MILAD", bulan: 10, tahun: 2026 })).toBe("12.003/PAN.MILAD/X/2026");
    expect(nomorLengkap({ jenisKode: "08", urut: 34, penerbitKode: "SDITTSQ", bulan: 7, tahun: 2026 })).toBe("08.034/SDITTSQ/VII/2026");
  });

  it("urut tiga digit, lewat 999 lanjut tanpa padding", () => {
    expect(formatUrut(1)).toBe("001");
    expect(formatUrut(999)).toBe("999");
    expect(formatUrut(1000)).toBe("1000");
    expect(formatUrut(1001)).toBe("1001");
  });

  it("bulan Romawi I sampai XII", () => {
    expect(romawiBulan(1)).toBe("I");
    expect(romawiBulan(12)).toBe("XII");
    expect(() => romawiBulan(13)).toThrow();
  });

  it("pergantian tahun mengikuti Asia/Jakarta, bukan UTC", () => {
    // 2026-12-31T17:30Z = 2027-01-01 00:30 WIB: the counter year is already 2027.
    const afterMidnightWib = jakartaParts(new Date("2026-12-31T17:30:00Z"));
    expect(afterMidnightWib).toEqual({ tahun: 2027, bulan: 1, tanggal: "2027-01-01" });
    // 2026-12-31T16:30Z = 23:30 WIB: still 2026.
    const beforeMidnightWib = jakartaParts(new Date("2026-12-31T16:30:00Z"));
    expect(beforeMidnightWib).toEqual({ tahun: 2026, bulan: 12, tanggal: "2026-12-31" });
  });

  it("sel CSV dinetralkan dari formula", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+62")).toBe("'+62");
    expect(csvCell('a;b"c')).toBe('"a;b""c"');
    expect(csvCell("biasa")).toBe("biasa");
  });
});

describe("SEK-IMPL-001 konfigurasi (§10)", () => {
  it("mati secara bawaan", () => {
    expect(loadSekretariatConfig({})).toBeNull();
  });

  it("menuntut nilai inti saat dinyalakan", () => {
    expect(() => loadSekretariatConfig({ SEKRETARIAT_ENABLED: "true" })).toThrow(/required/);
  });

  it("menuntut kredensial IMAP hanya pada mode imap", () => {
    const base = {
      SEKRETARIAT_ENABLED: "true",
      SEKRETARIAT_OIDC_CLIENT_ID: "sekretariat-sq",
      SEKRETARIAT_OIDC_CLIENT_SECRET: "secret",
      SEKRETARIAT_PUBLIC_ORIGIN: "https://sekretariat.sabilulquran.or.id",
      SEKRETARIAT_MEDIA_ROOT: "/tmp/media",
    };
    const logMode = loadSekretariatConfig(base);
    expect(logMode?.mail).toEqual({ mode: "log" });
    expect(logMode?.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(() => loadSekretariatConfig({ ...base, SEKRETARIAT_MAIL_MODE: "imap" })).toThrow(/IMAP/);
    const imap = loadSekretariatConfig({
      ...base,
      SEKRETARIAT_MAIL_MODE: "imap",
      SEKRETARIAT_IMAP_HOST: "mail.example.test",
      SEKRETARIAT_IMAP_USER: "sekretariat@sabilulquran.or.id",
      SEKRETARIAT_IMAP_PASS: "p",
      SEKRETARIAT_ALLOWED_MACHINE_CLIENTS: "hcis-sekretariat, ",
    });
    expect(imap?.mail).toMatchObject({ mode: "imap", host: "mail.example.test", port: 993 });
    expect([...(imap?.allowedMachineClients ?? [])]).toEqual(["hcis-sekretariat"]);
  });
});

describe("SEK-IMPL-001 skema ekspor DOC-003 (§14 langkah 8)", () => {
  it("menerima bentuk ekspor dan menolak periode aneh", () => {
    const valid = eksporDoc003Schema.parse({
      types: [{ code: "UND", label: "Undangan" }],
      issuers: [{ code: "YSQ", name: "Yayasan", kind: "ORGANIZATION" }],
      counters: [{ issuerCode: "YSQ", typeCode: "UND", periodKey: "2026", lastSequence: 7 }],
      numbers: [{
        sourceId: "n1", issuerCode: "YSQ", typeCode: "UND", periodKey: "2026", sequence: 7,
        letterNumber: "UND.007/YSQ/XI/2026", letterDate: "2026-11-11", status: "ALLOCATED",
      }],
    });
    expect(valid.numbers[0]!.subject).toBe("");
    expect(() => eksporDoc003Schema.parse({ types: [], issuers: [], counters: [{ issuerCode: "YSQ", typeCode: "UND", periodKey: "26", lastSequence: 1 }], numbers: [] })).toThrow();
  });
});
