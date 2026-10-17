/** KIRIM-IMPL-001 §3.2 internal provider contract. `markRead` arrives in R2. */

export type ProviderName = "log" | "jalurpesan";

export type KirimErrorCode =
  | "optout"
  | "route_denied"
  | "quota_exceeded"
  | "device_inactive"
  | "invalid_number"
  | "media_invalid"
  | "expired"
  | "engine_unavailable"
  | "engine_rejected"
  | "engine_conflict"
  | "cancelled";

export interface DeviceRef {
  id: string;
  kode: string;
  /** JalurPesan tenant id; null for `log`. */
  providerRef: string | null;
}

/** International digits without `+`, as JalurPesan `PHONE_PATTERN` expects. */
export interface Recipient {
  phoneDigits: string;
}

export interface MediaFile {
  mediaId: string;
  mime: string;
  filename: string;
  data: () => Promise<Buffer>;
}

export type SendResult =
  | { ok: true; providerMessageId: string; dryRun: boolean }
  | { ok: false; kind: "rejected"; code: KirimErrorCode }
  | { ok: false; kind: "retryable"; code: KirimErrorCode }
  | { ok: false; kind: "device"; code: "device_disconnected" };

export type DeviceStatus = "belum_dipasang" | "menunggu_pairing" | "tersambung" | "terputus";

export interface ProviderDeviceStatus {
  status: DeviceStatus;
  /** QR data-URL while waiting; passed to the admin screen only, never stored or logged. */
  qr: string | null;
  /** Number of the linked WhatsApp account once connected, international digits. */
  phoneDigits: string | null;
  /** Engine-side device id, used to route engine webhooks to a Kirim SQ device. */
  engineDeviceId: string | null;
}

export type PairingResult = { mode: "qr"; qr: string | null } | { mode: "kode"; pairingCode: string };

export interface ProviderEvent {
  eventId: string;
  cursor: number;
  type: string;
  engineDeviceId: string;
  messageId: string | null;
  occurredAt: string;
  payload: unknown;
}

export interface ProviderEventPage {
  events: ProviderEvent[];
  nextCursor: number;
  hasMore: boolean;
}

export class ProviderOperationError extends Error {
  constructor(
    public readonly code: "engine_unavailable" | "engine_rejected" | "engine_capacity" | "device_not_found" | "session_reset_required",
    message: string,
  ) {
    super(message);
    this.name = "ProviderOperationError";
  }
}

export interface KirimProvider {
  readonly name: ProviderName;
  sendText(device: DeviceRef, to: Recipient, text: string, idempotencyKey: string): Promise<SendResult>;
  sendDocument(device: DeviceRef, to: Recipient, file: MediaFile, caption: string | null, idempotencyKey: string): Promise<SendResult>;
  deviceStatus(device: DeviceRef): Promise<ProviderDeviceStatus>;
  provision(device: DeviceRef, label: string): Promise<void>;
  startPairing(device: DeviceRef, mode: "qr" | { phone: string }): Promise<PairingResult>;
  disconnect(device: DeviceRef): Promise<void>;
  pullEvents(device: DeviceRef, cursor: number, limit: number): Promise<ProviderEventPage>;
  /** Copies an inbound engine media file; `null` when it is larger than `maxBytes`. */
  downloadMedia(device: DeviceRef, providerMediaId: string, maxBytes: number): Promise<Buffer | null>;
}
