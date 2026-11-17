// SEK-IMPL-002 §7: the rules that need no database — the envelope, the key parser, and the
// failure classifier that decides whether a mailbox gets parked (M-8).

import { describe, expect, it } from "vitest";

import { mailboxAad, parseSekretariatDataKeys, SekretariatCrypto, SekretariatCryptoError } from "../src/modules/sekretariat/crypto.js";
import { classifyMailboxFailure } from "../src/modules/sekretariat/mailbox.js";

const KEY_A = { kid: "k1", key: Buffer.alloc(32, 1) };
const KEY_B = { kid: "k2", key: Buffer.alloc(32, 2) };
const ROW = "11111111-2222-4333-8444-555555555555";

describe("SEK-IMPL-002 amplop sandi mailbox (M-2)", () => {
  it("membuka kembali apa yang disegel", () => {
    const crypto = new SekretariatCrypto([KEY_A]);
    const sealed = crypto.seal("sandi-rahasia", mailboxAad(ROW));
    expect(crypto.open(sealed, mailboxAad(ROW))).toBe("sandi-rahasia");
  });

  it("tidak pernah menghasilkan ciphertext yang sama dua kali", () => {
    const crypto = new SekretariatCrypto([KEY_A]);
    const aad = mailboxAad(ROW);
    expect(crypto.seal("sandi-rahasia", aad)).not.toBe(crypto.seal("sandi-rahasia", aad));
  });

  it("menolak ciphertext milik baris lain", () => {
    const crypto = new SekretariatCrypto([KEY_A]);
    const sealed = crypto.seal("sandi-rahasia", mailboxAad(ROW));
    expect(() => crypto.open(sealed, mailboxAad("99999999-2222-4333-8444-555555555555"))).toThrow(SekretariatCryptoError);
  });

  it("menolak kunci yang salah tanpa menjelaskan apa pun", () => {
    const sealed = new SekretariatCrypto([KEY_A]).seal("sandi-rahasia", mailboxAad(ROW));
    const lain = new SekretariatCrypto([{ kid: "k1", key: Buffer.alloc(32, 9) }]);
    expect(() => lain.open(sealed, mailboxAad(ROW))).toThrow("envelope cannot be opened");
  });

  it("masih membaca baris lama setelah kunci baru ditaruh di depan (rotasi)", () => {
    const lama = new SekretariatCrypto([KEY_A]);
    const sealed = lama.seal("sandi-rahasia", mailboxAad(ROW));
    const baru = new SekretariatCrypto([KEY_B, KEY_A]);
    expect(baru.open(sealed, mailboxAad(ROW))).toBe("sandi-rahasia");
    expect(baru.seal("berikutnya", mailboxAad(ROW)).startsWith("v1.k2.")).toBe(true);
  });

  it("menolak kid yang tidak dikenal dan amplop yang cacat", () => {
    const crypto = new SekretariatCrypto([KEY_A]);
    const sealed = crypto.seal("sandi-rahasia", mailboxAad(ROW));
    expect(() => crypto.open(sealed.replace("v1.k1.", "v1.k9."), mailboxAad(ROW))).toThrow("unknown key id");
    expect(() => crypto.open("v1.k1.pendek", mailboxAad(ROW))).toThrow("invalid envelope");
    expect(() => crypto.seal("", mailboxAad(ROW))).toThrow("cannot encrypt an empty value");
  });

  it("tidak membocorkan sandi pada bentuk amplopnya", () => {
    const sealed = new SekretariatCrypto([KEY_A]).seal("sandi-rahasia", mailboxAad(ROW));
    expect(sealed).not.toContain("sandi-rahasia");
    expect(sealed.split(".")).toHaveLength(5);
  });
});

describe("SEK-IMPL-002 SEKRETARIAT_DATA_KEYS", () => {
  it("membaca daftar kunci dan mempertahankan urutannya", () => {
    const keys = parseSekretariatDataKeys(`k1:${Buffer.alloc(32, 1).toString("base64")}, k2:${Buffer.alloc(32, 2).toString("base64")}`);
    expect(keys.map((entry) => entry.kid)).toEqual(["k1", "k2"]);
    expect(keys[0]!.key).toHaveLength(32);
  });

  it("menolak kunci yang bukan 32 byte, kid ganda, dan daftar kosong", () => {
    expect(() => parseSekretariatDataKeys(`k1:${Buffer.alloc(16, 1).toString("base64")}`)).toThrow("32 bytes");
    const k = Buffer.alloc(32, 1).toString("base64");
    expect(() => parseSekretariatDataKeys(`k1:${k},k1:${k}`)).toThrow("must not repeat");
    expect(() => parseSekretariatDataKeys("   ")).toThrow("at least one key");
    expect(() => parseSekretariatDataKeys(k)).toThrow("<kid>:<base64 key>");
  });
});

describe("SEK-IMPL-002 sebab kegagalan sambungan (M-8)", () => {
  it("mengenali galat autentikasi imapflow yang sebenarnya, bukan teks karangan", () => {
    // Yang benar-benar dilempar imapflow saat login ditolak: pesannya generik, bendera ada di
    // objek galatnya (node_modules/imapflow/dist/cjs/commands/login.js).
    const imapflow = Object.assign(new Error("Command failed"), { authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED" });
    expect(classifyMailboxFailure(imapflow)).toBe("sandi_ditolak");
    expect(classifyMailboxFailure(Object.assign(new Error("Command failed"), { serverResponseCode: "AUTHENTICATIONFAILED" }))).toBe("sandi_ditolak");
  });

  it("masih mengenali kalimat penolakan dari server lain", () => {
    expect(classifyMailboxFailure(new Error("Invalid credentials (Failure)"))).toBe("sandi_ditolak");
    expect(classifyMailboxFailure(new Error("Authentication failed"))).toBe("sandi_ditolak");
    expect(classifyMailboxFailure(new Error("LOGIN failed"))).toBe("sandi_ditolak");
  });

  it("tidak tertipu bendera yang bukan true", () => {
    expect(classifyMailboxFailure(Object.assign(new Error("Command failed"), { authenticationFailed: false }))).toBe("lainnya");
    expect(classifyMailboxFailure(Object.assign(new Error("Command failed"), { authenticationFailed: "ya" }))).toBe("lainnya");
  });

  it("memisahkan nama host, sertifikat, dan waktu habis", () => {
    expect(classifyMailboxFailure(new Error("getaddrinfo ENOTFOUND mail.example"))).toBe("host_tidak_ditemukan");
    expect(classifyMailboxFailure(new Error("Hostname/IP does not match certificate's altnames"))).toBe("sertifikat");
    expect(classifyMailboxFailure(new Error("connect ETIMEDOUT 10.0.0.1:993"))).toBe("waktu_habis");
    expect(classifyMailboxFailure(new Error("connect ECONNREFUSED"))).toBe("waktu_habis");
  });

  it("menyebut sisanya lainnya, bukan menebak", () => {
    expect(classifyMailboxFailure(new Error("sesuatu yang aneh"))).toBe("lainnya");
    expect(classifyMailboxFailure("bukan Error")).toBe("lainnya");
  });
});
