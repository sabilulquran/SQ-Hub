import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { JalurPesanProvider, type EngineMediaRefs } from "../src/modules/kirim/providers/jalurpesan.js";
import { LogProvider } from "../src/modules/kirim/providers/log.js";
import { ProviderOperationError } from "../src/modules/kirim/providers/types.js";
import { JalurPesanStub } from "./kirim.fixture.js";

const stub = new JalurPesanStub();
const device = { id: "11111111-1111-4111-8111-111111111111", kode: "spmb", providerRef: "spmb" };
const to = { phoneDigits: "6281234567890" };

function memoryRefs(): EngineMediaRefs & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(mediaId, deviceId) {
      return store.get(`${mediaId}:${deviceId}`) ?? null;
    },
    async put(mediaId, deviceId, value) {
      store.set(`${mediaId}:${deviceId}`, value);
    },
    async remove(mediaId, deviceId) {
      store.delete(`${mediaId}:${deviceId}`);
    },
  };
}

let provider: JalurPesanProvider;
let refs: ReturnType<typeof memoryRefs>;

beforeAll(async () => {
  await stub.start();
});
afterAll(async () => {
  await stub.stop();
});
beforeEach(() => {
  stub.reset();
  stub.addTenant("spmb");
  refs = memoryRefs();
  provider = new JalurPesanProvider({ baseUrl: stub.baseUrl, platformKey: "platform-key", timeoutMs: 300 }, refs);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("KIRIM-IMPL-001 §3.2 log provider", () => {
  it("makes no network call, marks dry_run and logs only a masked number and length", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const entries: Array<Record<string, unknown>> = [];
    const log = new LogProvider((entry) => entries.push(entry));
    await expect(log.sendText(device, to, "Kode Anda 123456", "kirim:abc")).resolves.toEqual({ ok: true, providerMessageId: "log:kirim:abc", dryRun: true });
    await expect(log.deviceStatus()).resolves.toMatchObject({ status: "tersambung" });
    await expect(log.pullEvents()).resolves.toEqual({ events: [], nextCursor: 0, hasMore: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("6281234567890");
    expect(serialized).not.toContain("123456");
    expect(entries[0]).toMatchObject({ to: "+62 812-••••-7890", length: 16 });
  });
});

describe("KIRIM-IMPL-001 §3.2 JalurPesan send mapping", () => {
  it("maps 200 to a hand-over and sends the outbox idempotency key", async () => {
    const result = await provider.sendText(device, to, "Halo", "kirim:outbox-1");
    expect(result).toMatchObject({ ok: true, dryRun: false });
    const sent = stub.requests.find((request) => request.path.endsWith("/messages"));
    expect(sent?.idempotencyKey).toBe("kirim:outbox-1");
    expect(JSON.parse(sent!.body)).toEqual({ to: "6281234567890", message: "Halo" });
  });

  it.each([
    [{ status: 400, body: { success: false, error: "Invalid recipient: provide exactly one international phone number" } }, { ok: false, kind: "rejected", code: "invalid_number" }],
    [{ status: 404, body: { success: false, error: "Tenant device not found" } }, { ok: false, kind: "device", code: "device_disconnected" }],
    [{ status: 409, body: { success: false, code: "idempotency_key_conflict" } }, { ok: false, kind: "rejected", code: "engine_conflict" }],
    [{ status: 409, body: { success: false, code: "idempotency_request_in_progress" } }, { ok: false, kind: "device", code: "device_disconnected" }],
    [{ status: 409, body: { success: false, recoveryAction: "reset" } }, { ok: false, kind: "device", code: "device_disconnected" }],
    [{ status: 502, body: { success: false } }, { ok: false, kind: "retryable", code: "engine_unavailable" }],
    [{ status: 503, body: { success: false } }, { ok: false, kind: "retryable", code: "engine_unavailable" }],
  ])("maps %j", async (response, expected) => {
    stub.sendQueue.push(response);
    await expect(provider.sendText(device, to, "Halo", "kirim:k")).resolves.toEqual(expected);
  });

  it("maps a timeout to retryable engine_unavailable", async () => {
    stub.sendQueue.push("hang");
    await expect(provider.sendText(device, to, "Halo", "kirim:k")).resolves.toEqual({ ok: false, kind: "retryable", code: "engine_unavailable" });
  });

  it("uploads a document once per number and reuses the engine mediaId", async () => {
    const file = { mediaId: "m1", mime: "application/pdf", filename: "m1.pdf", data: async () => Buffer.from("%PDF-1.7") };
    await expect(provider.sendDocument(device, to, file, "Slip", "kirim:o1")).resolves.toMatchObject({ ok: true });
    await expect(provider.sendDocument(device, to, file, null, "kirim:o2")).resolves.toMatchObject({ ok: true });
    expect(stub.uploads).toBe(1);
    const sends = stub.requests.filter((request) => request.path.endsWith("/messages")).map((request) => JSON.parse(request.body));
    expect(sends[0].mediaId).toBe(sends[1].mediaId);
    expect(sends[0].caption).toBe("Slip");
    expect(sends[1].caption).toBeUndefined();
  });
});

describe("KIRIM-IMPL-001 §3.2 JalurPesan device lifecycle", () => {
  it("maps device states, including connecting before and after a first connection", async () => {
    stub.tenants.get("spmb")!.live = "connected";
    await expect(provider.deviceStatus(device)).resolves.toMatchObject({ status: "tersambung", phoneDigits: "6281200001111" });
    stub.tenants.get("spmb")!.live = "qr";
    await expect(provider.deviceStatus(device)).resolves.toMatchObject({ status: "menunggu_pairing", qr: expect.stringMatching(/^data:image/) });
    stub.tenants.get("spmb")!.live = "connecting";
    await expect(provider.deviceStatus(device)).resolves.toMatchObject({ status: "terputus" });
    stub.tenants.get("spmb")!.everConnected = false;
    await expect(provider.deviceStatus(device)).resolves.toMatchObject({ status: "menunggu_pairing" });
    stub.tenants.get("spmb")!.live = "disconnected";
    await expect(provider.deviceStatus(device)).resolves.toMatchObject({ status: "terputus" });
    await expect(provider.deviceStatus({ ...device, providerRef: "unknown" })).resolves.toMatchObject({ status: "belum_dipasang" });
  });

  it("reports the device capacity cap on provision", async () => {
    stub.provisionResponse = { status: 409, body: { success: false, error: "Configured active device safety cap reached" } };
    await expect(provider.provision({ ...device, providerRef: "hcis" }, "HCIS")).rejects.toMatchObject({ code: "engine_capacity" });
  });

  it("returns QR or pairing code for pairing", async () => {
    await expect(provider.startPairing(device, "qr")).resolves.toEqual({ mode: "qr", qr: "data:image/png;base64,UVJDT0RF" });
    await expect(provider.startPairing(device, { phone: "62812-0000-1111" })).resolves.toEqual({ mode: "kode", pairingCode: "ABCD-EFGH" });
    expect(JSON.parse(stub.requests.at(-1)!.body)).toEqual({ phone: "6281200001111" });
  });

  it("raises device_not_found when pulling events for an unknown tenant", async () => {
    await expect(provider.pullEvents({ ...device, providerRef: "unknown" }, 0, 100)).rejects.toBeInstanceOf(ProviderOperationError);
  });

  it("stops copying inbound media above the size limit", async () => {
    stub.media.set("big", Buffer.alloc(2048, 1));
    stub.media.set("small", Buffer.from("%PDF-1.7"));
    await expect(provider.downloadMedia(device, "big", 1024)).resolves.toBeNull();
    await expect(provider.downloadMedia(device, "small", 1024)).resolves.toEqual(Buffer.from("%PDF-1.7"));
  });
});
