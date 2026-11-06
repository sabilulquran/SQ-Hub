import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { reactionSchema } from "../src/modules/kirim/actions.js";
import { KIRIM_K32_DEFAULTS, loadKirimConfig } from "../src/modules/kirim/config.js";
import { addLimitRetry, memberStatus } from "../src/modules/kirim/groups-admin.js";
import { readCall, readChange } from "../src/modules/kirim/ingest.js";
import { ENGINE_TYPE_BY_TIPE, jidFromCanonical } from "../src/modules/kirim/message-refs.js";
import { changedByItem, nextReactions } from "../src/modules/kirim/message-state.js";
import { JalurPesanProvider, mapActionResponse, readGroup } from "../src/modules/kirim/providers/jalurpesan.js";
import { LogProvider } from "../src/modules/kirim/providers/log.js";
import { ProviderOperationError } from "../src/modules/kirim/providers/types.js";
import { JalurPesanStub } from "./kirim.fixture.js";

/** KIRIM-IMPL-004 §14: pure parts of K3.2 and R3, and the JalurPesan adapter against the stub. */

describe("reactions (§5.5)", () => {
  const base = { k: "abc", dari: "kontak" as const, at: "2026-11-05T01:00:00.000Z" };

  it("keeps one reaction per reactor, replaces it, and removes it on an empty emoji", () => {
    const first = nextReactions([], { ...base, emoji: "👍" });
    expect(first).toEqual({ reactions: [{ ...base, emoji: "👍" }], changed: true });
    const replaced = nextReactions(first.reactions, { ...base, emoji: "❤️" });
    expect(replaced.reactions).toEqual([{ ...base, emoji: "❤️" }]);
    expect(nextReactions(replaced.reactions, { ...base, emoji: "❤️" }).changed).toBe(false);
    expect(nextReactions(replaced.reactions, { ...base, emoji: "" })).toEqual({ reactions: [], changed: true });
    expect(nextReactions([], { ...base, emoji: "" }).changed).toBe(false);
  });

  it("keeps the officer an API reaction recorded when the engine echoes it", () => {
    const own = { k: "nomor_ini", dari: "nomor_ini" as const, at: base.at, emoji: "🙏" };
    const echoed = nextReactions(nextReactions([], { ...own, petugas: "iss sub" }).reactions, own);
    expect(echoed.reactions[0]!.petugas).toBe("iss sub");
  });

  it("accepts only the allow-list, normalises the plain heart and allows an empty emoji", () => {
    const atas_nama = { issuer: "iss", sub: "sub" };
    for (const emoji of ["👍", "❤️", "😂", "😮", "😢", "🙏", ""]) expect(reactionSchema.safeParse({ emoji, atas_nama }).success).toBe(true);
    expect(reactionSchema.parse({ emoji: "❤", atas_nama }).emoji).toBe("❤️");
    expect(reactionSchema.safeParse({ emoji: "🔥", atas_nama }).success).toBe(false);
  });
});

describe("who changed a message", () => {
  it("names officers by issuer and sub, and the fixed actors by word", () => {
    expect(changedByItem("https://akun/realms/sq-staff abc-123")).toEqual({ jenis: "petugas", petugas: { issuer: "https://akun/realms/sq-staff", sub: "abc-123" } });
    expect(changedByItem("pengirim")).toEqual({ jenis: "pengirim", petugas: null });
    expect(changedByItem("admin_grup")).toEqual({ jenis: "admin_grup", petugas: null });
    expect(changedByItem("hp")).toEqual({ jenis: "hp", petugas: null });
    expect(changedByItem(null)).toBeNull();
  });

  it("maps canonical contacts to JIDs and Kirim types to quote types", () => {
    expect(jidFromCanonical("pn:+6281234567890")).toBe("6281234567890@s.whatsapp.net");
    expect(jidFromCanonical("lid:123@lid")).toBe("123@lid");
    expect(ENGINE_TYPE_BY_TIPE.gambar).toBe("image");
    expect(ENGINE_TYPE_BY_TIPE.panggilan).toBeUndefined();
  });
});

describe("group add limit (§9.2)", () => {
  const now = new Date("2026-11-05T10:00:00Z");
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);

  it("allows up to the limit in a rolling hour", () => {
    expect(addLimitRetry([], now, 20, 20)).toBe(0);
    expect(addLimitRetry([{ at: at(10), jumlah: 19 }], now, 20, 1)).toBe(0);
  });

  it("says when enough additions age out, oldest first", () => {
    const rows = [{ at: at(50), jumlah: 5 }, { at: at(20), jumlah: 15 }];
    expect(addLimitRetry(rows, now, 20, 3)).toBe(10 * 60);
    expect(addLimitRetry(rows, now, 20, 10)).toBe(40 * 60);
  });

  it("refuses a request larger than the limit itself", () => {
    expect(addLimitRetry([], now, 20, 21)).toBeNull();
  });

  it("maps WhatsApp participant statuses", () => {
    expect(["200", "403", "409", "408", "500"].map((code) => memberStatus("add", code))).toEqual(["ditambahkan", "perlu_undangan", "sudah_anggota", "baru_keluar", "gagal"]);
    expect(["200", "404", null].map((code) => memberStatus("remove", code))).toEqual(["dikeluarkan", "bukan_anggota", "gagal"]);
  });
});

describe("engine payloads (§6.2)", () => {
  it("reads edits, deletes and reactions, and skips unknown shapes", () => {
    expect(readChange({ version: 1, change: { whatsappMessageId: "W1", chatJid: "x@g.us", senderJid: "62@s.whatsapp.net", peerJidAlt: "1@lid", fromMe: false, body: "baru", editedAt: "2026-11-05T01:00:00Z" } }, "change"))
      .toEqual({ whatsappMessageId: "W1", senderJid: "62@s.whatsapp.net", peerJidAlt: "1@lid", fromMe: false, group: true, body: "baru", at: "2026-11-05T01:00:00Z" });
    expect(readChange({ version: 1, reaction: { whatsappMessageId: "W1", emoji: "", reactedAt: "2026-11-05T01:00:00Z" } }, "reaction")).toMatchObject({ emoji: "", at: "2026-11-05T01:00:00Z" });
    expect(readChange({ version: 1, reaction: { whatsappMessageId: "W1", emoji: "x".repeat(17) } }, "reaction")).toBeNull();
    expect(readChange({ version: 1, change: { chatJid: "x" } }, "change")).toBeNull();
    expect(readChange(null, "change")).toBeNull();
  });

  it("reads calls with their direction and revision, and only final outcomes", () => {
    const call = { callId: "C1", chatJid: "62@s.whatsapp.net", fromJid: "62@s.whatsapp.net", isVideo: true, outcome: "rejected", startedAt: "2026-11-05T01:00:00Z", durationSeconds: 12.4 };
    expect(readCall({ call })).toMatchObject({ callId: "C1", isVideo: true, isGroup: false, fromMe: false, revision: 1, outcome: "rejected", durationSeconds: 12 });
    expect(readCall({ call: { ...call, fromMe: true, revision: 2 } })).toMatchObject({ fromMe: true, revision: 2 });
    expect(readCall({ call: { ...call, groupJid: "1@g.us" } })!.isGroup).toBe(true);
    expect(readCall({ call: { ...call, outcome: "ringing" } })).toBeNull();
    // An answered-elsewhere call has no known length: kept as null, never 0.
    expect(readCall({ call: { ...call, outcome: "answered_elsewhere", durationSeconds: null } })!.durationSeconds).toBeNull();
    expect(readCall({ call: { ...call, durationSeconds: undefined } })!.durationSeconds).toBeNull();
    expect(readCall({ call: { ...call, revision: 0 } })!.revision).toBe(1);
  });

  it("reads group participants with both identities", () => {
    expect(readGroup({ id: "1@g.us", subject: "Kelas", size: 2, participants: [{ jid: "1@lid", admin: "admin", phoneJid: "62@s.whatsapp.net", lidJid: "1@lid" }, { jid: "63@s.whatsapp.net", admin: null }] }))
      .toEqual({ jid: "1@g.us", name: "Kelas", size: 2, participants: [
        { jid: "1@lid", admin: true, phoneJid: "62@s.whatsapp.net", lidJid: "1@lid" },
        { jid: "63@s.whatsapp.net", admin: false, phoneJid: null, lidJid: null },
      ] });
    expect(readGroup({ subject: "tanpa id" })).toBeNull();
  });

  it("maps action answers to stable outcomes", () => {
    const map = (status: number, body: Record<string, unknown> = {}) => mapActionResponse({ status, body });
    expect(map(200, { success: true })).toEqual({ ok: true, dryRun: false });
    expect(map(409, { code: "idempotency_key_conflict" })).toEqual({ ok: false, code: "engine_conflict" });
    expect(map(409, { code: "idempotency_request_in_progress" })).toEqual({ ok: false, code: "engine_unavailable" });
    expect(map(429, { code: "hour_limit" })).toEqual({ ok: false, code: "rate_limited", reason: "hour_limit" });
    expect(map(404, { error: "Tenant device not found" })).toEqual({ ok: false, code: "device_disconnected" });
    expect(map(503)).toEqual({ ok: false, code: "device_disconnected" });
    expect(map(502)).toEqual({ ok: false, code: "engine_unavailable" });
    expect(map(400)).toEqual({ ok: false, code: "engine_rejected" });
  });
});

describe("configuration (§11)", () => {
  const required = { KIRIM_ENABLED: "true", KIRIM_DATA_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`, KIRIM_LOOKUP_KEY: Buffer.alloc(32, 2).toString("base64"), KIRIM_MEDIA_ROOT: "/tmp/kirim" };

  it("uses the DRAFT defaults and accepts overrides within bounds", () => {
    expect(loadKirimConfig(required)).toMatchObject(KIRIM_K32_DEFAULTS);
    expect(loadKirimConfig({ ...required, KIRIM_EDIT_WINDOW_MINUTES: "10", KIRIM_DELETE_WINDOW_HOURS: "24", KIRIM_GROUP_ADD_LIMIT_PER_HOUR: "10" }))
      .toMatchObject({ editWindowMinutes: 10, deleteWindowHours: 24, groupAddLimitPerHour: 10 });
    expect(() => loadKirimConfig({ ...required, KIRIM_GROUP_ADD_LIMIT_PER_HOUR: "0" })).toThrow();
  });
});

describe("JalurPesan adapter K3.2 (§3)", () => {
  const stub = new JalurPesanStub();
  const device = { id: "11111111-1111-4111-8111-111111111111", kode: "spmb", providerRef: "spmb" };
  const refs = { get: async () => null, put: async () => undefined, remove: async () => undefined };
  let provider: JalurPesanProvider;

  beforeAll(async () => {
    await stub.start();
  });
  afterAll(async () => {
    await stub.stop();
  });
  beforeEach(() => {
    stub.reset();
    stub.addTenant("spmb");
    provider = new JalurPesanProvider({ baseUrl: stub.baseUrl, platformKey: "platform-key", timeoutMs: 500 }, refs);
  });

  it("adds quoted and forwarded only when set", async () => {
    await provider.sendText(device, { phoneDigits: "6281234567890" }, "halo", "k1");
    await provider.sendText(device, { jid: "1@lid" }, "halo", "k2", { quoted: { id: "W1", fromMe: true, text: "asal", messageType: "text" }, forwarded: true });
    const bodies = stub.requests.filter((request) => request.path.endsWith("/messages")).map((request) => JSON.parse(request.body) as unknown);
    expect(bodies).toEqual([
      { to: "6281234567890", message: "halo" },
      { toJid: "1@lid", message: "halo", quoted: { id: "W1", fromMe: true, text: "asal", messageType: "text" }, forwarded: true },
    ]);
  });

  it("sends actions with exactly one target and the Idempotency-Key", async () => {
    await expect(provider.react(device, { chat: { groupJid: "1@g.us" }, whatsappMessageId: "W1", fromMe: false, participant: "62@s.whatsapp.net" }, "👍", "a1")).resolves.toEqual({ ok: true, dryRun: false });
    await provider.editMessage(device, { chat: { phoneDigits: "62812" }, whatsappMessageId: "W2" }, "baru", "a2");
    await provider.deleteMessage(device, { chat: { jid: "1@lid" }, whatsappMessageId: "W3" }, "a3");
    expect(stub.actions.map((action) => [action.action, action.whatsappMessageId, action.idempotencyKey, action.body])).toEqual([
      ["reaction", "W1", "a1", { groupJid: "1@g.us", fromMe: false, participant: "62@s.whatsapp.net", emoji: "👍" }],
      ["edit", "W2", "a2", { to: "62812", message: "baru" }],
      ["delete", "W3", "a3", { toJid: "1@lid" }],
    ]);
  });

  it("returns the photo, null when unavailable, and throws when the engine has no route", async () => {
    stub.profilePictures.set("62@s.whatsapp.net", Buffer.from([0xff, 0xd8, 0xff, 1]));
    expect((await provider.profilePicture(device, "62@s.whatsapp.net"))?.length).toBe(4);
    expect(await provider.profilePicture(device, "63@s.whatsapp.net")).toBeNull();
    stub.profilePictureRoute = false;
    await expect(provider.profilePicture(device, "62@s.whatsapp.net")).rejects.toBeInstanceOf(ProviderOperationError);
  });

  it("creates and manages a group", async () => {
    const group = await provider.createGroup(device, "Kelas 1A", ["6281200000001"]);
    expect(group.participants.map((participant) => participant.jid)).toContain("6281200000001@s.whatsapp.net");
    stub.participantStatus.set("6281200000002", "403");
    expect((await provider.updateParticipants(device, group.jid, "add", ["6281200000002"])).updates).toEqual([{ jid: "6281200000002@s.whatsapp.net", status: "403" }]);
    await provider.setGroupSubject(device, group.jid, "Kelas 1B");
    expect(await provider.groupInviteCode(device, group.jid)).toBe("KODEAWAL");
    expect(await provider.revokeGroupInvite(device, group.jid)).not.toBe("KODEAWAL");
    await expect(provider.setGroupDescription(device, "999@g.us", "x")).rejects.toMatchObject({ code: "group_not_found" });
  });

  it("log provider: actions are a dry run and groups are refused", async () => {
    const log = new LogProvider();
    await expect(log.editMessage(device, {}, "x")).resolves.toEqual({ ok: true, dryRun: true });
    await expect(log.profilePicture()).resolves.toBeNull();
    await expect(log.createGroup()).rejects.toBeInstanceOf(ProviderOperationError);
  });
});

describe("katalog: gambar produk (§17)", () => {
  const device = { id: "d1", kode: "spmb", status: "aktif", provider: "jalurpesan" };
  const product = (imageUrl: string) => ({ products: [{ id: "p", name: "P", description: "", price: null, currency: null, url: null, hidden: false, imageUrl }], nextCursor: null });
  const make = async (imageUrl: string, response: Response) => {
    const { KirimBusiness } = await import("../src/modules/kirim/business.js");
    const provider = { listCatalog: async () => product(imageUrl) };
    const business = new KirimBusiness({} as never, { ownedDevice: async () => device } as never, { jalurpesan: provider } as never, undefined,
      { fetchImpl: (async () => response) as never });
    await business.catalog({} as never, "spmb", null);
    return business;
  };
  const jpeg = (headers: Record<string, string>) => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers });

  it("serves a JPEG from WhatsApp's CDN", async () => {
    const business = await make("https://mmg.whatsapp.net/p.jpg", jpeg({ "content-type": "image/jpeg" }));
    expect((await business.catalogImage({} as never, "spmb", "p")).mime).toBe("image/jpeg");
  });

  it("refuses SVG, a declared size over 2 MiB, and other hosts", async () => {
    const svg = await make("https://mmg.whatsapp.net/p.svg", new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
    await expect(svg.catalogImage({} as never, "spmb", "p")).rejects.toMatchObject({ statusCode: 404 });
    const big = await make("https://mmg.whatsapp.net/p.jpg", jpeg({ "content-type": "image/jpeg", "content-length": String(3 * 1024 * 1024) }));
    await expect(big.catalogImage({} as never, "spmb", "p")).rejects.toMatchObject({ statusCode: 404 });
    const elsewhere = await make("https://whatsapp.net.evil.example/p.jpg", jpeg({ "content-type": "image/jpeg" }));
    await expect(elsewhere.catalogImage({} as never, "spmb", "p")).rejects.toMatchObject({ statusCode: 404 });
  });
});
