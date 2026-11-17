import type { Pool } from "pg";

/**
 * KIRIM-IMPL-005 §4.2. The device manager ported from JalurPesan reads its devices synchronously,
 * because JalurPesan kept them in SQLite. Here they live in `kirim_wa_devices` in the SQ Hub
 * database, so the registry is held in memory and written through: reads never wait, and a write
 * that fails is retried on the next change rather than losing the socket that is already open.
 *
 * There are at most a handful of numbers, so the whole table fits in memory by design.
 */

export interface DeviceRecord {
  /** The Kirim SQ number code; also the tenant id and the auth folder name (§4.1). */
  id: string;
  name: string;
  platformId: string | null;
  externalTenantId: string | null;
  whatsappJid: string | null;
  whatsappPhone: string | null;
  whatsappDisplayName: string | null;
  pairedAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectReason: string | null;
  lastDisconnectCode: number | null;
  lastDisconnectedAt: string | null;
  requiresSessionReset: boolean;
  /** KIRIM-IMPL-005 §9: held down on purpose; this worker must not open its socket. */
  parked: boolean;
  /** Kept for the ported device manager; this worker never uses the legacy slot. */
  authStorageSlot: "legacy" | "isolated";
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeviceInput {
  id: string;
  name: string;
  platformId?: string | null;
  externalTenantId?: string | null;
}

export interface DeviceConnectionMetadata {
  whatsappJid: string | null;
  whatsappPhone: string | null;
  whatsappDisplayName: string | null;
  connectedAt: string;
}

export interface DeviceDisconnectMetadata {
  reason: string | null;
  code: number | null;
  disconnectedAt: string;
  requiresSessionReset: boolean;
}

export interface ProvisionTenantDeviceResult {
  device: DeviceRecord;
  created: boolean;
}

export interface DeviceRepository {
  create(input: CreateDeviceInput): DeviceRecord;
  findById(id: string): DeviceRecord | null;
  findActiveByTenant(platformId: string, externalTenantId: string): DeviceRecord | null;
  getRequiredForTenant(platformId: string, externalTenantId: string): DeviceRecord;
  provisionForTenant(input: CreateDeviceInput & { platformId: string; externalTenantId: string }): ProvisionTenantDeviceResult;
  getRequired(id: string): DeviceRecord;
  list(): DeviceRecord[];
  updateConnected(id: string, metadata: DeviceConnectionMetadata): DeviceRecord;
  updateDisconnected(id: string, metadata: DeviceDisconnectMetadata): DeviceRecord;
  clearIdentity(id: string): DeviceRecord;
  softDelete(id: string): void;
  setParked(id: string, parked: boolean): DeviceRecord;
}

export const DEVICE_CODE_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

export class DeviceNotFoundError extends Error {
  constructor(readonly deviceId: string) {
    super(`Device not found: ${deviceId}`);
    this.name = "DeviceNotFoundError";
  }
}

export class TenantDeviceNotFoundError extends Error {
  constructor(
    readonly platformId: string,
    readonly externalTenantId: string,
  ) {
    super(`Active device not found for platform tenant ${platformId}/${externalTenantId}`);
    this.name = "TenantDeviceNotFoundError";
  }
}

export class InvalidDeviceCodeError extends Error {
  constructor(readonly deviceId: string) {
    super("Device code must match ^[a-z][a-z0-9-]{1,30}$");
    this.name = "InvalidDeviceCodeError";
  }
}

type WriteLog = (entry: Record<string, unknown>, message: string) => void;

export class PgDeviceRegistry implements DeviceRepository {
  private readonly devices = new Map<string, DeviceRecord>();
  /** Codes whose last write to PostgreSQL did not land; retried on the next flush. */
  private readonly dirty = new Set<string>();
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly log: WriteLog = () => undefined,
  ) {}

  /** Reads the table once at start; nothing else reads it afterwards. */
  async load(): Promise<void> {
    const result = await this.pool.query<DeviceRow>(`SELECT ${COLUMNS} FROM kirim_wa_devices WHERE deleted_at IS NULL ORDER BY kode`);
    this.devices.clear();
    for (const row of result.rows) this.devices.set(row.id, fromRow(row));
  }

  list(): DeviceRecord[] {
    return [...this.devices.values()];
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
    for (const device of this.devices.values()) {
      if (device.platformId === platformId && device.externalTenantId === externalTenantId) return device;
    }
    return null;
  }

  getRequiredForTenant(platformId: string, externalTenantId: string): DeviceRecord {
    const device = this.findActiveByTenant(platformId, externalTenantId);
    if (!device) throw new TenantDeviceNotFoundError(platformId, externalTenantId);
    return device;
  }

  create(input: CreateDeviceInput): DeviceRecord {
    if (!DEVICE_CODE_PATTERN.test(input.id)) throw new InvalidDeviceCodeError(input.id);
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
    return this.put(device);
  }

  provisionForTenant(input: CreateDeviceInput & { platformId: string; externalTenantId: string }): ProvisionTenantDeviceResult {
    const existing = this.findActiveByTenant(input.platformId, input.externalTenantId);
    if (existing) {
      if (existing.name === input.name) return { device: existing, created: false };
      return { device: this.put({ ...existing, name: input.name }), created: false };
    }
    return { device: this.create(input), created: true };
  }

  updateConnected(id: string, metadata: DeviceConnectionMetadata): DeviceRecord {
    const device = this.getRequired(id);
    return this.put({
      ...device,
      whatsappJid: metadata.whatsappJid,
      whatsappPhone: metadata.whatsappPhone,
      whatsappDisplayName: metadata.whatsappDisplayName,
      pairedAt: device.pairedAt ?? metadata.connectedAt,
      lastConnectedAt: metadata.connectedAt,
      lastDisconnectReason: null,
      lastDisconnectCode: null,
      requiresSessionReset: false,
    });
  }

  updateDisconnected(id: string, metadata: DeviceDisconnectMetadata): DeviceRecord {
    const device = this.getRequired(id);
    return this.put({
      ...device,
      lastDisconnectReason: metadata.reason,
      lastDisconnectCode: metadata.code,
      lastDisconnectedAt: metadata.disconnectedAt,
      requiresSessionReset: metadata.requiresSessionReset,
    });
  }

  /**
   * The session is gone (logout or reset): the number this worker thought it held is no longer
   * necessarily the number that comes back, so nothing about the old identity is kept.
   */
  clearIdentity(id: string): DeviceRecord {
    const device = this.getRequired(id);
    return this.put({
      ...device,
      whatsappJid: null,
      whatsappPhone: null,
      whatsappDisplayName: null,
      pairedAt: null,
      lastConnectedAt: null,
      requiresSessionReset: false,
    });
  }

  setParked(id: string, parked: boolean): DeviceRecord {
    return this.put({ ...this.getRequired(id), parked });
  }

  softDelete(id: string): void {
    this.getRequired(id);
    this.devices.delete(id);
    void this.run(`UPDATE kirim_wa_devices SET deleted_at = now(), updated_at = now() WHERE kode = $1`, [id], id);
  }

  /**
   * Waits for the writes already queued, so a shutdown does not close the pool under them and
   * lose a number's last known state. Bounded: a database that is not answering must not stop
   * the process from exiting.
   */
  async drain(timeoutMs = 5_000): Promise<void> {
    await Promise.race([this.flushing ?? Promise.resolve(), new Promise((done) => setTimeout(done, timeoutMs))]);
  }

  private put(device: DeviceRecord): DeviceRecord {
    const stored = { ...device, updatedAt: new Date().toISOString() };
    this.devices.set(stored.id, stored);
    this.dirty.add(stored.id);
    void this.flush();
    return stored;
  }

  /** One writer at a time; a failed row stays dirty and is written again by the next change. */
  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const run = (async () => {
      while (this.dirty.size > 0) {
        const codes = [...this.dirty];
        this.dirty.clear();
        for (const code of codes) {
          const device = this.devices.get(code);
          if (!device) continue;
          const ok = await this.run(UPSERT_SQL, [
            device.id,
            device.name,
            device.platformId,
            device.externalTenantId,
            device.whatsappJid,
            device.whatsappPhone,
            device.whatsappDisplayName,
            device.pairedAt,
            device.lastConnectedAt,
            device.lastDisconnectReason,
            device.lastDisconnectCode,
            device.lastDisconnectedAt,
            device.requiresSessionReset,
            device.parked,
          ], code);
          if (!ok) this.dirty.add(code);
        }
        if (this.dirty.size > 0) await new Promise((done) => setTimeout(done, 1_000));
      }
    })().finally(() => {
      this.flushing = null;
    });
    this.flushing = run;
    return run;
  }

  private async run(sql: string, values: unknown[], code: string): Promise<boolean> {
    try {
      await this.pool.query(sql, values);
      return true;
    } catch (error) {
      // No number, no WhatsApp identity: only the code and the kind of failure.
      this.log({ event: "kirim_wa.devices.write_failed", device: code, errorType: error instanceof Error ? error.name : "unknown" }, "device row not written; retrying");
      return false;
    }
  }
}

const COLUMNS = `
  kode AS id,
  label AS name,
  platform_id AS "platformId",
  external_tenant_id AS "externalTenantId",
  wa_jid AS "whatsappJid",
  wa_phone AS "whatsappPhone",
  wa_display_name AS "whatsappDisplayName",
  paired_at AS "pairedAt",
  last_connected_at AS "lastConnectedAt",
  last_disconnect_reason AS "lastDisconnectReason",
  last_disconnect_code AS "lastDisconnectCode",
  last_disconnected_at AS "lastDisconnectedAt",
  requires_reset AS "requiresSessionReset",
  parked,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const UPSERT_SQL = `
  INSERT INTO kirim_wa_devices (
    kode, label, platform_id, external_tenant_id, wa_jid, wa_phone, wa_display_name,
    paired_at, last_connected_at, last_disconnect_reason, last_disconnect_code, last_disconnected_at,
    requires_reset, parked, updated_at, deleted_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), NULL)
  ON CONFLICT (kode) DO UPDATE SET
    label = EXCLUDED.label,
    platform_id = EXCLUDED.platform_id,
    external_tenant_id = EXCLUDED.external_tenant_id,
    wa_jid = EXCLUDED.wa_jid,
    wa_phone = EXCLUDED.wa_phone,
    wa_display_name = EXCLUDED.wa_display_name,
    paired_at = EXCLUDED.paired_at,
    last_connected_at = EXCLUDED.last_connected_at,
    last_disconnect_reason = EXCLUDED.last_disconnect_reason,
    last_disconnect_code = EXCLUDED.last_disconnect_code,
    last_disconnected_at = EXCLUDED.last_disconnected_at,
    requires_reset = EXCLUDED.requires_reset,
    parked = EXCLUDED.parked,
    updated_at = now(),
    deleted_at = NULL
`;

interface DeviceRow {
  id: string;
  name: string;
  platformId: string | null;
  externalTenantId: string | null;
  whatsappJid: string | null;
  whatsappPhone: string | null;
  whatsappDisplayName: string | null;
  pairedAt: Date | string | null;
  lastConnectedAt: Date | string | null;
  lastDisconnectReason: string | null;
  lastDisconnectCode: number | null;
  lastDisconnectedAt: Date | string | null;
  requiresSessionReset: boolean;
  parked: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function fromRow(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    name: row.name,
    platformId: row.platformId,
    externalTenantId: row.externalTenantId,
    whatsappJid: row.whatsappJid,
    whatsappPhone: row.whatsappPhone,
    whatsappDisplayName: row.whatsappDisplayName,
    pairedAt: iso(row.pairedAt),
    lastConnectedAt: iso(row.lastConnectedAt),
    lastDisconnectReason: row.lastDisconnectReason,
    lastDisconnectCode: row.lastDisconnectCode,
    lastDisconnectedAt: iso(row.lastDisconnectedAt),
    requiresSessionReset: Boolean(row.requiresSessionReset),
    parked: Boolean(row.parked),
    authStorageSlot: "isolated",
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}
