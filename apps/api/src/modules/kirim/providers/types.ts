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
  /** Engine upload type; PDF is `document`, JPEG/PNG is `image` (KIRIM-IMPL-002 §5.3), WebP is `sticker`. */
  kind?: "document" | "image" | "sticker";
  data: () => Promise<Buffer>;
}

export type GroupContent = { text: string } | { file: MediaFile; caption: string | null };

/** KIRIM-IMPL-004 §3 / JalurPesan K3.2 §A: the message a send quotes. */
export interface QuotedMessage {
  /** WhatsApp message id of the quoted message. */
  id: string;
  /** The quoted message was sent by this number. */
  fromMe: boolean;
  /** JID of the quoted message's sender; required in groups when `fromMe` is false. */
  participant?: string;
  /** Text or caption of the quoted message, for the preview on the recipient's phone. */
  text?: string;
  messageType?: "text" | "image" | "video" | "audio" | "document" | "sticker";
}

/** JalurPesan K3.2 §A: optional extras on a send; both are part of the engine's idempotency fingerprint. */
export interface SendOptions {
  quoted?: QuotedMessage;
  forwarded?: boolean;
  /** Group members @-mentioned, as JIDs (JalurPesan #23). */
  mentions?: string[];
}

export interface ProviderGroupParticipant {
  jid: string;
  admin: boolean;
  /** JalurPesan K3.2 §E: the member's phone-number JID and LID when the engine knows them. */
  phoneJid?: string | null;
  lidJid?: string | null;
}

export interface ProviderGroup {
  jid: string;
  name: string;
  size: number | null;
  participants: ProviderGroupParticipant[];
}

/** WhatsApp's group settings (JalurPesan `settings`); null where WhatsApp did not say. */
export interface ProviderGroupSettings {
  /** Only admins send messages. */
  announce: boolean | null;
  /** Only admins edit the group info. */
  restrict: boolean | null;
  /** Every member may add others. */
  memberAddMode: boolean | null;
  /** New members wait for an admin. */
  joinApprovalMode: boolean | null;
}

export type ProviderGroupSetting =
  | "announcement" | "not_announcement" | "locked" | "unlocked"
  | "member_add_all" | "member_add_admin" | "approval_on" | "approval_off";

/** A WhatsApp Business quick reply of the number (§11). */
export interface ProviderQuickReply {
  waId: string;
  shortcut: string;
  message: string;
  deleted: boolean;
  updatedAt: string;
}

/** A product of the number's WhatsApp Business catalog; `price` in thousandths of the currency. */
export interface ProviderCatalogProduct {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string | null;
  url: string | null;
  hidden: boolean;
  imageUrl: string | null;
}

/** A request to join a group that waits for an admin. */
export interface ProviderJoinRequest {
  jid: string;
  phoneJid: string | null;
  requestedAt: string | null;
}

/** The chat an action on an existing message is addressed to (JalurPesan K3.2 §B: exactly one of to, toJid, groupJid). */
export type ActionChat = Recipient | { groupJid: string };

export interface ActionTarget {
  chat: ActionChat;
  whatsappMessageId: string;
}

export type ActionResult =
  | { ok: true; dryRun: boolean }
  | { ok: false; code: "engine_unavailable" | "engine_rejected" | "engine_conflict" | "device_disconnected" }
  | { ok: false; code: "rate_limited"; reason: string | null };

/** JalurPesan K3.2 §E participant update: `status` is WhatsApp's code ("200", "403", "409", "408", …). */
export interface ParticipantUpdate {
  jid: string;
  status: string;
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

/** One private chat of the engine's initial history copy (JalurPesan `GET /history-chats`). */
export interface ProviderHistoryChat {
  chatJid: string;
  /** International digits when the engine knows the number of a LID chat (or of a number chat). */
  phoneDigits: string | null;
  messageCount: number;
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
    public readonly code:
      | "engine_unavailable"
      | "engine_rejected"
      | "engine_capacity"
      | "device_not_found"
      | "session_reset_required"
      | "group_not_found"
      | "not_group_admin"
      | "not_connected",
    message: string,
  ) {
    super(message);
    this.name = "ProviderOperationError";
  }
}

export interface KirimProvider {
  readonly name: ProviderName;
  sendText(device: DeviceRef, to: Recipient, text: string, idempotencyKey: string, options?: SendOptions): Promise<SendResult>;
  sendDocument(device: DeviceRef, to: Recipient, file: MediaFile, caption: string | null, idempotencyKey: string, options?: SendOptions): Promise<SendResult>;
  deviceStatus(device: DeviceRef): Promise<ProviderDeviceStatus>;
  provision(device: DeviceRef, label: string): Promise<void>;
  startPairing(device: DeviceRef, mode: "qr" | { phone: string }): Promise<PairingResult>;
  disconnect(device: DeviceRef): Promise<void>;
  /**
   * KIRIM-IMPL-003 §11 "Sambungkan ulang": drops the stored WhatsApp session of this tenant and
   * starts a new QR session on the same tenant (JalurPesan `POST /device/reset`). Works where a
   * logout cannot: a phone that already unlinked the session, or a session marked for reset.
   */
  resetSession(device: DeviceRef): Promise<void>;
  pullEvents(device: DeviceRef, cursor: number, limit: number): Promise<ProviderEventPage>;
  /** Copies an inbound engine media file; `null` when it is larger than `maxBytes`. */
  downloadMedia(device: DeviceRef, providerMediaId: string, maxBytes: number): Promise<Buffer | null>;
  sendGroup(device: DeviceRef, groupJid: string, content: GroupContent, idempotencyKey: string, options?: SendOptions): Promise<SendResult>;
  /** JalurPesan K3.2 §B: reaction (`""` removes it), edit and delete-for-everyone. The Idempotency-Key is required. */
  react(device: DeviceRef, target: ActionTarget & { fromMe: boolean; participant?: string }, emoji: string, idempotencyKey: string): Promise<ActionResult>;
  editMessage(device: DeviceRef, target: ActionTarget, text: string, idempotencyKey: string): Promise<ActionResult>;
  deleteMessage(device: DeviceRef, target: ActionTarget, idempotencyKey: string): Promise<ActionResult>;
  /** JalurPesan K3.2 §D: the WhatsApp preview photo, or null when there is none or privacy hides it. */
  profilePicture(device: DeviceRef, jid: string): Promise<Buffer | null>;
  /** JalurPesan K3.2 §E group management; participants are international digits or JIDs. */
  createGroup(device: DeviceRef, subject: string, participants: string[]): Promise<ProviderGroup>;
  updateParticipants(
    device: DeviceRef,
    groupJid: string,
    action: "add" | "remove" | "promote" | "demote",
    participants: string[],
  ): Promise<{ updates: ParticipantUpdate[]; group: ProviderGroup | null }>;
  /** KIRIM-IMPL-004 §9.7: settings, join requests, photo and leaving, for admin parity with WhatsApp. */
  groupSettings(device: DeviceRef, groupJid: string): Promise<ProviderGroupSettings>;
  /** The group as the engine has it now (members and admins), to store right after a change. */
  groupInfo(device: DeviceRef, groupJid: string): Promise<ProviderGroup | null>;
  setGroupSetting(device: DeviceRef, groupJid: string, setting: ProviderGroupSetting): Promise<void>;
  groupJoinRequests(device: DeviceRef, groupJid: string): Promise<ProviderJoinRequest[]>;
  answerJoinRequests(device: DeviceRef, groupJid: string, participants: string[], approve: boolean): Promise<ParticipantUpdate[]>;
  /** `null` removes the photo. */
  setGroupPicture(device: DeviceRef, groupJid: string, jpeg: Buffer | null): Promise<void>;
  leaveGroup(device: DeviceRef, groupJid: string): Promise<void>;
  /** KIRIM-IMPL-004 §11: WhatsApp Business quick replies (both ways) and catalog (read). */
  listQuickReplies(device: DeviceRef): Promise<ProviderQuickReply[]>;
  upsertQuickReply(device: DeviceRef, waId: string | null, shortcut: string, message: string): Promise<string>;
  removeQuickReply(device: DeviceRef, waId: string): Promise<void>;
  listCatalog(device: DeviceRef, cursor: string | null): Promise<{ products: ProviderCatalogProduct[]; nextCursor: string | null }>;
  setGroupSubject(device: DeviceRef, groupJid: string, subject: string): Promise<void>;
  setGroupDescription(device: DeviceRef, groupJid: string, description: string): Promise<void>;
  groupInviteCode(device: DeviceRef, groupJid: string): Promise<string>;
  revokeGroupInvite(device: DeviceRef, groupJid: string): Promise<string>;
  /** Private chats only; the engine has no group read receipts. At most 100 keys per call. */
  markRead(device: DeviceRef, messages: ReadReceiptKey[]): Promise<void>;
  listGroups(device: DeviceRef): Promise<ProviderGroup[]>;
  listContacts(device: DeviceRef, page: number): Promise<ProviderContactPage>;
  /** J-2. Throws `ProviderOperationError("engine_rejected")` when the engine has no platform route yet. */
  requestHistory(device: DeviceRef, chatJid: string, maxMessages: number): Promise<{ importId: string }>;
  historyStatus(device: DeviceRef, importId: string): Promise<ProviderHistoryStatus>;
  historyMessages(device: DeviceRef, importId: string, page: number): Promise<{ messages: ProviderHistoryMessage[]; hasMore: boolean }>;
  /** KIRIM-IMPL-002 §10.3: private chats in the engine's initial history copy, newest first, 200 per page. */
  listHistoryChats(device: DeviceRef, page: number): Promise<{ chats: ProviderHistoryChat[]; hasMore: boolean }>;
  /**
   * §10.3: an import from the stored copy (`source: "stored"`), complete at once and without asking
   * WhatsApp; `null` when the chat has no stored message (`409 no_anchor`).
   */
  requestStoredHistory(device: DeviceRef, chatJid: string): Promise<{ importId: string } | null>;
}

/** WhatsApp JID of a private recipient, for read receipts and history requests. */
export function recipientJid(to: Recipient): string {
  return "jid" in to ? to.jid : `${to.phoneDigits}@s.whatsapp.net`;
}
