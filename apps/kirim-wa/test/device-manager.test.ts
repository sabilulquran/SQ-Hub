import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DeviceCapacityError,
  DeviceManager,
  DeviceParkedError,
  UnsafeAuthRootError,
  type ManagedWhatsAppService,
} from "../src/wa/device-manager.js";
import {
  DeviceNotFoundError,
  TenantDeviceNotFoundError,
  type CreateDeviceInput,
  type DeviceConnectionMetadata,
  type DeviceDisconnectMetadata,
  type DeviceRecord,
  type DeviceRepository,
  type ProvisionTenantDeviceResult,
} from "../src/store/device-registry.js";
import type { DeviceState } from "../src/wa/service.js";

/**
 * Adapted from JalurPesan `server/test/device-manager.test.ts` (KIRIM-IMPL-005 §13), against this
 * worker's own registry rather than SQLite, and extended for what is new here: one auth folder per
 * number code (§4.1) and parking a number so the other engine may hold it (§9).
 */

const disconnected: DeviceState = {
  status: "disconnected",
  qr: null,
  jid: null,
  name: null,
  connectedAt: null,
  lastDisconnectReason: null,
  lastDisconnectCode: null,
  lastDisconnectedAt: null,
  loggedOut: false,
  requiresReset: false,
  reconnectAttempts: 0,
};

/** The registry the ported device manager reads synchronously, without a database. */
class MemoryRegistry implements DeviceRepository {
  private readonly devices = new Map<string, DeviceRecord>();

  create(input: CreateDeviceInput): DeviceRecord {
    const now = new Date().toISOString();
    const device: DeviceRecord = {
      id: input.id,
      name: input.name,
      platformId: input.platformId ?? null,
      externalTenantId: input.externalTenantId ?? null,
      whatsappJid: null,
      whatsappPhone: null,
      whatsappDisplayName: null,
      pairedAt: null,
      lastConnectedAt: null,
      lastDisconnectReason: null,
      lastDisconnectCode: null,
      lastDisconnectedAt: null,
      requiresSessionReset: false,
      parked: false,
      authStorageSlot: "isolated",
      createdAt: now,
      updatedAt: now,
    };
    this.devices.set(device.id, device);
    return device;
  }

  findById(id: string): DeviceRecord | null {
    return this.devices.get(id) ?? null;
  }

  getRequired(id: string): DeviceRecord {
    const device = this.devices.get(id);
    if (!device) throw new DeviceNotFoundError(id);
    return device;
  }

  findActiveByTenant(platformId: string, externalTenantId: string): DeviceRecord | null {
    return [...this.devices.values()].find((d) => d.platformId === platformId && d.externalTenantId === externalTenantId) ?? null;
  }

  getRequiredForTenant(platformId: string, externalTenantId: string): DeviceRecord {
    const device = this.findActiveByTenant(platformId, externalTenantId);
    if (!device) throw new TenantDeviceNotFoundError(platformId, externalTenantId);
    return device;
  }

  provisionForTenant(input: CreateDeviceInput & { platformId: string; externalTenantId: string }): ProvisionTenantDeviceResult {
    const existing = this.findActiveByTenant(input.platformId, input.externalTenantId);
    if (existing) return { device: existing, created: false };
    return { device: this.create(input), created: true };
  }

  list(): DeviceRecord[] {
    return [...this.devices.values()];
  }

  updateConnected(id: string, metadata: DeviceConnectionMetadata): DeviceRecord {
    return this.put(id, { ...metadata, pairedAt: metadata.connectedAt, lastConnectedAt: metadata.connectedAt, requiresSessionReset: false });
  }

  updateDisconnected(id: string, metadata: DeviceDisconnectMetadata): DeviceRecord {
    return this.put(id, {
      lastDisconnectReason: metadata.reason,
      lastDisconnectCode: metadata.code,
      lastDisconnectedAt: metadata.disconnectedAt,
      requiresSessionReset: metadata.requiresSessionReset,
    });
  }

  clearIdentity(id: string): DeviceRecord {
    return this.put(id, { whatsappJid: null, whatsappPhone: null, pairedAt: null, requiresSessionReset: false });
  }

  setParked(id: string, parked: boolean): DeviceRecord {
    return this.put(id, { parked });
  }

  softDelete(id: string): void {
    this.getRequired(id);
    this.devices.delete(id);
  }

  private put(id: string, patch: Partial<DeviceRecord>): DeviceRecord {
    const next = { ...this.getRequired(id), ...patch, updatedAt: new Date().toISOString() };
    this.devices.set(id, next);
    return next;
  }
}

class FakeService implements ManagedWhatsAppService {
  connected = false;
  stopped: string[] = [];
  credentials = false;
  constructor(readonly authDirectory: string) {}
  getState(): DeviceState {
    return { ...disconnected, status: this.connected ? "connected" : "disconnected" };
  }
  hasActiveSocket(): boolean {
    return this.connected;
  }
  hasStoredCredentials(): boolean {
    return this.credentials;
  }
  async connect(): Promise<DeviceState> {
    this.connected = true;
    return this.getState();
  }
  async reconnect(): Promise<DeviceState> {
    return this.getState();
  }
  async logout(): Promise<DeviceState> {
    this.connected = false;
    return this.getState();
  }
  async stop(reason?: string): Promise<DeviceState> {
    this.stopped.push(reason ?? "");
    this.connected = false;
    return this.getState();
  }
  async sendText() {
    return { messageId: "x" };
  }
  async sendTextToJid() {
    return { messageId: "x" };
  }
  async sendMedia() {
    return { messageId: "x" };
  }
  async sendMediaToIndividualJid() {
    return { messageId: "x" };
  }
  async requestPairingCode(): Promise<string> {
    return "12345678";
  }
  async listJoinedGroups() {
    return [];
  }
  async getGroupMetadata(): Promise<never> {
    throw new Error("not used");
  }
  async sendGroupText() {
    return { messageId: "x" };
  }
  async sendGroupMedia() {
    return { messageId: "x" };
  }
  async requestMessageHistory(): Promise<string> {
    return "request-1";
  }
}

describe("device manager", () => {
  let root: string;
  const services = new Map<string, FakeService>();

  const manager = (registry: MemoryRegistry, options: { maxActiveDevices?: number } = {}) =>
    new DeviceManager(
      registry,
      `${root}-legacy`,
      root,
      (deviceId, authDirectory) => {
        const service = new FakeService(authDirectory);
        // Stored credentials are a file on disk, exactly as Baileys sees them.
        service.credentials = existsSync(join(authDirectory, "creds.json"));
        services.set(deviceId, service);
        return service;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      options,
    );

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kirim-wa-dm-"));
    services.clear();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}-legacy`, { recursive: true, force: true });
  });

  it("gives every number a folder named after its own code", () => {
    const registry = new MemoryRegistry();
    const devices = manager(registry);
    devices.provisionTenantDevice("sq-hub", "spmb", "Nomor SPMB");
    devices.provisionTenantDevice("sq-hub", "hcis", "Nomor HCIS");

    expect(devices.authDirectoryFor("spmb")).toBe(resolve(join(root, "spmb")));
    expect(devices.authDirectoryFor("hcis")).toBe(resolve(join(root, "hcis")));
    // Separate folders: one number's keys can never be read as another's.
    expect(devices.authDirectoryFor("spmb")).not.toBe(devices.authDirectoryFor("hcis"));
  });

  it("makes the tenant id the device id, so one number is one row and one folder", () => {
    const registry = new MemoryRegistry();
    const devices = manager(registry);
    const first = devices.provisionTenantDevice("sq-hub", "luar", "Aplikasi luar");
    const again = devices.provisionTenantDevice("sq-hub", "luar", "Aplikasi luar");

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(first.device.id).toBe("luar");
    expect(registry.list()).toHaveLength(1);
  });

  it("refuses an auth root that is not a directory of its own", () => {
    expect(() => new DeviceManager(new MemoryRegistry(), root, root)).toThrow(UnsafeAuthRootError);
  });

  it("parks a number without logging it out, and refuses to connect it while parked", async () => {
    const registry = new MemoryRegistry();
    const devices = manager(registry);
    devices.provisionTenantDevice("sq-hub", "luar", "Aplikasi luar");
    await devices.connectDevice("luar");

    await devices.parkDevice("luar");

    expect(registry.getRequired("luar").parked).toBe(true);
    // Stopped, not logged out: the credentials are still there for the other engine.
    expect(services.get("luar")!.stopped).toEqual(["parked"]);
    expect(services.get("luar")!.connected).toBe(false);
    await expect(devices.connectDevice("luar")).rejects.toBeInstanceOf(DeviceParkedError);

    devices.unparkDevice("luar");
    await expect(devices.connectDevice("luar")).resolves.toMatchObject({ status: "connected" });
  });

  it("leaves a parked number alone when it restores the others after a restart", async () => {
    const registry = new MemoryRegistry();
    const devices = manager(registry, {});
    devices.provisionTenantDevice("sq-hub", "spmb", "Nomor SPMB");
    devices.provisionTenantDevice("sq-hub", "luar", "Aplikasi luar");
    for (const id of ["spmb", "luar"]) {
      await mkdir(join(root, id), { recursive: true });
      await writeFile(join(root, id, "creds.json"), "{}", "utf8");
    }
    // Credentials exist for both; one is parked because the other engine holds it.
    registry.setParked("luar", true);

    const restored = await devices.restoreIfAuthenticated();

    expect(restored.restoredDeviceIds).toEqual(["spmb"]);
    expect(services.get("luar")?.connected ?? false).toBe(false);
  });

  it("enforces the configured cap on how many numbers may be live at once", async () => {
    const registry = new MemoryRegistry();
    const devices = manager(registry, { maxActiveDevices: 1 });
    devices.provisionTenantDevice("sq-hub", "spmb", "Nomor SPMB");
    devices.provisionTenantDevice("sq-hub", "hcis", "Nomor HCIS");

    await devices.connectDevice("spmb");
    await expect(devices.connectDevice("hcis")).rejects.toBeInstanceOf(DeviceCapacityError);
  });
});
