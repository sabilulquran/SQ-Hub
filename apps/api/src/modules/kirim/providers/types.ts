/** KIRIM-IMPL-001 §3.2 internal provider contract, extended by KIRIM-IMPL-002 §5.3. */

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

/**
 * A private chat: international digits without `+` (JalurPesan `PHONE_PATTERN`), or, for a
 * contact WhatsApp only knows by its LID, the individual JID (KIRIM-IMPL-002 §5.1).
 */
export type Recipient = { phoneDigits: string } | { jid: string };

export interface MediaFile {
  mediaId: string;
  mime: string;
  filename: string;
  /** Engine upload type; PDF is `document`, JPEG/PNG is `image` (KIRIM-IMPL-002 §5.3). */
  kind?: "document" | "image";
  data: () => Promise<Buffer>;
}

export type GroupContent = { text: string } | { file: MediaFile; caption: string | null };

export interface ProviderGroup {
  jid: string;
  name: string;
  size: number | null;
  participants: Array<{ jid: string; admin: boolean }>;
}

export interface ProviderContact {
  jid: string;
  /** Phone-number JID when the engine knows it, else the LID JID itself. */
  canonicalJid: string;
  displayName: string | null;
}

export interface ProviderContactPage {
  contacts: ProviderContact[];
  hasMore: boolean;
}

export interface ReadReceiptKey {
  remoteJid: string;
  whatsappMessageId: string;
}

/** A message from the engine's history store (J-2) or from an engine event. */
export interface ProviderHistoryMessage {
  whatsappMessageId: string;
  direction: "inbound" | "outbound";
  chatJid: string;
  senderJid: string | null;
  messageType: string;
  body: string | null;
  occurredAt: string;
  media: { id: string; mimeType: string; sizeBytes: number; sha256: string | null } | null;
}

export type ProviderHistoryStatus =
  | { status: "awaiting" }
  | { status: "completed" }
  | { status: "failed"; reason: string };

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
  sendGroup(device: DeviceRef, groupJid: string, content: GroupContent, idempotencyKey: string): Promise<SendResult>;
  /** Private chats only; the engine has no group read receipts. At most 100 keys per call. */
  markRead(device: DeviceRef, messages: ReadReceiptKey[]): Promise<void>;
  listGroups(device: DeviceRef): Promise<ProviderGroup[]>;
  listContacts(device: DeviceRef, page: number): Promise<ProviderContactPage>;
  /** J-2. Throws `ProviderOperationError("engine_rejected")` when the engine has no platform route yet. */
  requestHistory(device: DeviceRef, chatJid: string, maxMessages: number): Promise<{ importId: string }>;
  historyStatus(device: DeviceRef, importId: string): Promise<ProviderHistoryStatus>;
  historyMessages(device: DeviceRef, importId: string, page: number): Promise<{ messages: ProviderHistoryMessage[]; hasMore: boolean }>;
}

/** WhatsApp JID of a private recipient, for read receipts and history requests. */
export function recipientJid(to: Recipient): string {
  return "jid" in to ? to.jid : `${to.phoneDigits}@s.whatsapp.net`;
}
