/**
 * WhatsApp adapter layer (Baileys).
 * One isolated device instance: filesystem auth storage, QR pairing, and live state.
 * Route files must not talk to Baileys directly.
 */
import { Boom } from "@hapi/boom";
import makeWASocket, {
  areJidsSameUser,
  Browsers,
  downloadMediaMessage,
  DisconnectReason,
  getBinaryNodeChild,
  getBinaryNodeChildren,
  getUrlFromDirectPath,
  isHostedLidUser,
  isHostedPnUser,
  isJidGroup,
  isLidUser,
  isPnUser,
  normalizeMessageContent,
  proto,
  useMultiFileAuthState,
  WAMessageStatus,
  type BinaryNode,
  type WAMessage,
  type MessageUserReceiptUpdate,
  type WAMessageUpdate,
  type WASocket,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { normalizeMimeType, type MediaType, type OutboundMediaType } from "./media-types.js";
import { isSupportedIndividualJid } from "./identity.js";

export type DeviceStatus = "disconnected" | "connecting" | "qr" | "connected";

export interface DeviceState {
  status: DeviceStatus;
  /** Data-URL PNG of the current Baileys QR, only while status === "qr". */
  qr: string | null;
  /** Real identity reported by Baileys once connected. */
  jid: string | null;
  name: string | null;
  connectedAt: string | null;
  lastDisconnectReason: string | null;
  lastDisconnectCode: number | null;
  lastDisconnectedAt: string | null;
  loggedOut: boolean;
  requiresReset: boolean;
  reconnectAttempts: number;
}

/** The message being quoted; `text` is its preview (text or caption) as the sender saw it. */
export type QuotedMessageType = "text" | "image" | "video" | "audio" | "document" | "sticker";
export interface QuotedMessageRef {
  id: string;
  fromMe: boolean;
  /** Sender JID of the quoted message; needed in groups when it was not sent by this account. */
  participant: string | null;
  text: string | null;
  messageType: QuotedMessageType;
}

/** Optional WhatsApp presentation for an outbound message. */
export interface SendOptions {
  quoted?: QuotedMessageRef;
  /** Shows WhatsApp's "Forwarded" label; the content itself is supplied by the caller. */
  forwarded?: boolean;
  /**
   * Group members @-mentioned (contextInfo.mentionedJid). The text carries "@<digits>" for each, which WhatsApp shows as
   * the member's name and notifies them.
   */
  mentions?: string[];
}

/** A reaction, edit, or revoke of a message that already exists in `chatJid`. */
export type MessageAction =
  | {
      kind: "reaction";
      chatJid: string;
      target: { id: string; fromMe: boolean; participant: string | null };
      emoji: string;
    }
  | { kind: "edit"; chatJid: string; target: { id: string }; text: string }
  | { kind: "delete"; chatJid: string; target: { id: string } };

export const PROFILE_PICTURE_MAX_BYTES = 256 * 1024;

export interface SendTextResult {
  messageId: string | null;
  /** Defensible provider metadata snapshot taken immediately before a group send. */
  groupParticipantCount?: number;
}

export interface OutboundMedia {
  mediaType: OutboundMediaType;
  mimeType: string;
  originalFilename: string | null;
  caption: string | null;
  data: Readable;
}

/** Provider-neutral representation of a joined WhatsApp group. */
export interface WhatsAppGroupMetadata {
  id: string;
  subject: string;
  owner: string | null;
  description: string | null;
  size: number | null;
  participants: Array<{
    jid: string;
    admin: "admin" | "superadmin" | null;
    /** The member's other identities when WhatsApp sent them (LID-addressed groups). */
    phoneJid?: string | null;
    lidJid?: string | null;
  }>;
  /** WhatsApp's group settings as admins see them; null when WhatsApp did not say. */
  settings?: {
    /** Only admins send messages. */
    announce: boolean | null;
    /** Only admins edit the group info. */
    restrict: boolean | null;
    /** Every member may add others (false: only admins). */
    memberAddMode: boolean | null;
    /** New members wait for an admin's approval. */
    joinApprovalMode: boolean | null;
  };
}

/** One product of the WhatsApp Business catalog. `price` is in the currency's thousandths, as WhatsApp keeps it. */
export interface WhatsAppCatalogProduct {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string | null;
  url: string | null;
  retailerId: string | null;
  hidden: boolean;
  imageUrl: string | null;
  /** WhatsApp's review of the product (e.g. "APPROVED", "PENDING", "REJECTED"), when WhatsApp says. */
  reviewStatus?: string | null;
}

/** One page of the catalog; `catalog` "missing" when WhatsApp knows no catalog for the number (see listCatalog). */
export interface WhatsAppCatalogPage {
  products: WhatsAppCatalogProduct[];
  nextCursor: string | null;
  catalog: "present" | "missing";
}

/** A product as a platform writes it. `price` in the currency's thousandths; null price leaves the product unpriced. */
export interface CatalogProductInput {
  name: string;
  /** null keeps the product's current description (a change only). */
  description: string | null;
  price: number | null;
  currency: string | null;
  url: string | null;
  retailerId: string | null;
  hidden: boolean;
  /** JPEG/PNG files; null keeps the product's current images (a change only). */
  images: Buffer[] | null;
  /** ISO 3166 alpha-2 country of origin; null marks the product exempt (create only). */
  originCountryCode: string | null;
}

/** A product write: the product as WhatsApp answered it, and whether that matches what was sent. */
export interface CatalogProductWrite {
  product: WhatsAppCatalogProduct;
  verified: boolean;
}

/** The number's own WhatsApp Business profile as WhatsApp keeps it. */
export interface WhatsAppBusinessProfile {
  jid: string;
  /** Business name (verified or push name); read only. */
  name: string | null;
  description: string;
  address: string | null;
  email: string | null;
  websites: string[];
  categories: Array<{ id: string | null; name: string }>;
  hours: {
    timezone: string | null;
    days: Array<{ day: string; mode: string; openMinutes: number | null; closeMinutes: number | null }>;
  } | null;
  profilePictureUrl: string | null;
  coverPhoto: { id: string; url: string | null } | null;
}

/** Profile fields a platform may change; a field left out stays as it is. The business name is never written. */
export interface BusinessProfileUpdate {
  description?: string;
  address?: string;
  email?: string;
  websites?: string[];
}

/** A request to join a group that waits for an admin (join approval on). */
export interface WhatsAppGroupJoinRequest {
  jid: string;
  phoneJid: string | null;
  requestedAt: string | null;
}

export type WhatsAppGroupParticipantAction = "add" | "remove" | "promote" | "demote";
export type WhatsAppGroupSetting =
  | "announcement"
  | "not_announcement"
  | "locked"
  | "unlocked"
  | "member_add_all"
  | "member_add_admin"
  | "approval_on"
  | "approval_off";

export interface WhatsAppGroupParticipantUpdate {
  jid: string;
  status: string;
}

export type DeviceStateListener = (state: DeviceState) => void;

/** Provider-neutral inbound text emitted after Baileys-specific normalization. */
export interface InboundTextMessage {
  whatsappMessageId: string;
  chatJid: string;
  /** Baileys v7 alternate peer identity (typically PN for a LID chat). */
  peerJidAlt: string | null;
  senderJid: string;
  /** Provider-normalized display name advertised with this inbound message. */
  senderDisplayName?: string | null;
  recipientJid: string | null;
  recipientType: "individual" | "group";
  body: string;
  /** JIDs @-mentioned in the message (WhatsApp contextInfo.mentionedJid). */
  mentionedJids?: string[];
  /** The message this one replies to, when the sender quoted one. */
  quoted?: { id: string; participant: string | null } | null;
  forwarded?: boolean;
  receivedAt: string;
}

export interface InboundMediaMessage {
  whatsappMessageId: string;
  chatJid: string;
  /** Baileys v7 alternate peer identity (typically PN for a LID chat). */
  peerJidAlt: string | null;
  senderJid: string;
  /** Provider-normalized display name advertised with this inbound message. */
  senderDisplayName?: string | null;
  recipientJid: string | null;
  recipientType: "individual" | "group";
  mediaType: MediaType;
  mimeType: string;
  originalFilename: string | null;
  caption: string | null;
  declaredSizeBytes: number | undefined;
  /** JIDs @-mentioned in the caption (WhatsApp contextInfo.mentionedJid). */
  mentionedJids?: string[];
  quoted?: { id: string; participant: string | null } | null;
  forwarded?: boolean;
  receivedAt: string;
  download: () => Promise<Readable>;
}

export type InboundMessage = InboundTextMessage | InboundMediaMessage;
export type InboundMessageListener = (message: InboundMessage) => void | Promise<void>;

export type HistoryMessage =
  | (InboundTextMessage & { direction: "inbound" })
  | (InboundMediaMessage & { direction: "inbound" })
  | ((Omit<InboundTextMessage, "receivedAt" | "recipientJid"> & {
      recipientJid: string;
      sentAt: string;
    }) & {
      direction: "outbound";
    })
  | ((Omit<InboundMediaMessage, "receivedAt" | "recipientJid"> & {
      recipientJid: string;
      sentAt: string;
    }) & {
      direction: "outbound";
    });

export type WhatsAppHistoryEvent =
  | {
      type: "messages";
      providerRequestId: string | null;
      providerMessageCount: number;
      messages: HistoryMessage[];
      progress: number | null;
    }
  | { type: "status"; status: "complete" | "paused" }
  | {
      /** A pairing-time history sync chunk (initial bootstrap, recent, full, ...), opt-in per device. */
      type: "bootstrap";
      syncType: string;
      providerMessageCount: number;
      messages: HistoryMessage[];
    };
export type WhatsAppHistoryListener = (event: WhatsAppHistoryEvent) => void | Promise<void>;

export interface OutboundMessageReceipt {
  whatsappMessageId: string;
  status: "delivered" | "read";
  occurredAt: string;
  /** Present only for Baileys' per-user group receipt event. */
  groupParticipantJid?: string;
}

export interface InboundReadReceiptKey {
  remoteJid: string;
  whatsappMessageId: string;
}

export type OutboundReceiptListener = (receipt: OutboundMessageReceipt) => void;

export type WhatsAppMetadataEvent =
  | { type: "lid-mapping"; lid: string; pn: string }
  | { type: "contact"; identities: string[]; displayName: string | null; displayPriority: number }
  | { type: "group"; jid: string; subject: string | null }
  /** A WhatsApp Business quick reply added, changed or removed on the phone (app-state "quick_reply"). */
  | { type: "quick-reply"; waId: string; shortcut: string; message: string; deleted: boolean }
  /** A WhatsApp Business label made, renamed or deleted (app-state "label_edit"). */
  | ({ type: "label" } & WhatsAppLabel)
  /** A label put on or taken off a chat (app-state "label_jid"). */
  | { type: "chat-label"; labelId: string; chatJid: string; labeled: boolean }
  /** A whole snapshot of app-state "regular" landed; what was not heard since `startedAt` is gone from the phone. */
  | { type: "labels-snapshot"; startedAt: string };
export type WhatsAppMetadataListener = (event: WhatsAppMetadataEvent) => void;

export interface WhatsAppLabel {
  id: string;
  name: string;
  /** One of WhatsApp's 20 label colors, 0–19. */
  color: number;
  deleted: boolean;
  predefinedId: string | null;
}

/** What the engine knows of the phone's labels, read afresh while a label change runs. */
export interface WhatsAppLabelStore {
  /** A whole snapshot was read since the number was linked: the list below is complete. */
  synced(): boolean;
  /** Every label, deleted ones too. */
  labels(): WhatsAppLabel[];
  /** The labels on the chat known by any of these JIDs. */
  chatLabels(chatJids: string[]): Array<{ labelId: string; chatJid: string }>;
}

export type BusinessHoursDayName = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
/** One day of WhatsApp Business hours; a day left out is closed. Minutes count from midnight, 1440 is midnight after. */
export type BusinessHoursDay =
  | { day: BusinessHoursDayName; mode: "specific_hours"; openMinutes: number; closeMinutes: number }
  | { day: BusinessHoursDayName; mode: "open_24h" | "appointment_only" };
export interface BusinessHours {
  /** IANA time zone, e.g. Asia/Jakarta. */
  timezone: string;
  days: BusinessHoursDay[];
}

/** Silent logger compatible with the pino-like interface Baileys expects. */
type BaileysLogger = {
  level: string;
  child: () => BaileysLogger;
  trace: () => void;
  debug: () => void;
  info: () => void;
  warn: () => void;
  error: () => void;
  fatal: () => void;
};

const noop = () => {};
export const silentLogger: BaileysLogger = {
  level: "silent",
  child: () => silentLogger,
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
};

/**
 * Silent like [silentLogger], but hands each app-state sync action Baileys traces ("processing sync action") to
 * `onAction`: quick replies have no Baileys event, and this is the only place they surface.
 */
export function syncSpyLogger(onAction: (action: { index: unknown; value: unknown }) => void): BaileysLogger {
  const spy: BaileysLogger = {
    // Level stays "silent": Baileys hex-dumps every frame when the level is "trace", while this trace line is called
    // without a level check.
    ...silentLogger,
    child: () => spy,
    trace: ((obj?: unknown, msg?: unknown) => {
      if (msg !== "processing sync action" || !obj || typeof obj !== "object") return;
      const mutation = (obj as { syncAction?: { syncAction?: { value?: unknown }; index?: unknown } }).syncAction;
      if (!mutation) return;
      try {
        onAction({ index: mutation.index, value: mutation.syncAction?.value });
      } catch {
        // Never let a listener break Baileys' sync.
      }
    }) as () => void,
  };
  return spy;
}

export const MAX_AUTO_RECONNECT_ATTEMPTS = 3;
const AUTO_RECONNECT_DELAYS_MS = [1_000, 3_000, 10_000] as const;

export interface WhatsAppServiceDependencies {
  createSocket: typeof makeWASocket;
  loadAuthState: typeof useMultiFileAuthState;
  qrToDataUrl: typeof QRCode.toDataURL;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => string;
  downloadMedia?: typeof downloadMediaMessage;
  /** Used only to download profile pictures from WhatsApp's media host. */
  fetch?: typeof fetch;
  /**
   * When true, the socket accepts every pairing-time history sync chunk (including FULL) and
   * forwards its messages as `bootstrap` history events. Off by default: other devices keep
   * Baileys' default and their pairing history is not stored.
   */
  storeBootstrapHistory?: () => boolean;
}

const defaultDependencies: WhatsAppServiceDependencies = {
  createSocket: makeWASocket,
  loadAuthState: useMultiFileAuthState,
  qrToDataUrl: QRCode.toDataURL,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => new Date().toISOString(),
  downloadMedia: downloadMediaMessage,
};

export interface DisconnectDiagnostic {
  reason: string;
  code: number | null;
  requiresReset: boolean;
  autoReconnect: boolean;
  loggedOut: boolean;
}

export function classifyDisconnect(code: number | null): DisconnectDiagnostic {
  switch (code) {
    case DisconnectReason.loggedOut:
      return terminalDisconnect("logged_out", code, true);
    case DisconnectReason.badSession:
      return terminalDisconnect("bad_session", code, false);
    case DisconnectReason.multideviceMismatch:
      return terminalDisconnect("multi_device_mismatch", code, false);
    case DisconnectReason.forbidden:
      return terminalDisconnect("forbidden", code, false);
    case DisconnectReason.connectionReplaced:
      return {
        reason: "connection_replaced",
        code,
        requiresReset: false,
        autoReconnect: false,
        loggedOut: false,
      };
    case DisconnectReason.restartRequired:
      return recoverableDisconnect("restart_required", code);
    case DisconnectReason.connectionClosed:
      return recoverableDisconnect("connection_closed", code);
    case DisconnectReason.connectionLost:
      return recoverableDisconnect("connection_lost", code);
    case DisconnectReason.unavailableService:
      return recoverableDisconnect("service_unavailable", code);
    default:
      return recoverableDisconnect("connection_lost", code);
  }
}

function terminalDisconnect(
  reason: string,
  code: number,
  loggedOut: boolean,
): DisconnectDiagnostic {
  return { reason, code, requiresReset: true, autoReconnect: false, loggedOut };
}

function recoverableDisconnect(reason: string, code: number | null): DisconnectDiagnostic {
  return { reason, code, requiresReset: false, autoReconnect: true, loggedOut: false };
}

export class WhatsAppService {
  private socket: WASocket | null = null;
  private starting = false;
  private generation = 0;
  private autoReconnectPromise: Promise<void> | null = null;
  private autoReconnectEpoch = 0;
  private pendingAutoReconnect = false;
  private readonly handledCloseGenerations = new Set<number>();
  /** The cover photo this engine set last, for removing it when the profile read does not name one. */
  private coverPhotoId: string | null = null;
  private state: DeviceState = {
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

  constructor(
    private readonly authDir: string,
    private readonly onStateChange: DeviceStateListener = () => undefined,
    private readonly dependencies: WhatsAppServiceDependencies = defaultDependencies,
    private readonly onInboundMessage: InboundMessageListener = () => undefined,
    private readonly onOutboundReceipt: OutboundReceiptListener = () => undefined,
    private readonly onMetadata: WhatsAppMetadataListener = () => undefined,
    private readonly onHistory: WhatsAppHistoryListener = () => undefined,
  ) {}

  getState(): DeviceState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.socket !== null && this.state.status === "connected";
  }

  hasActiveSocket(): boolean {
    return this.socket !== null || this.starting;
  }

  hasStoredCredentials(): boolean {
    return existsSync(join(this.authDir, "creds.json"));
  }

  /**
   * Send a real text message through the connected socket.
   * `phone` must be digits only (international format, no "+").
   */
  async sendText(phone: string, message: string, options?: SendOptions): Promise<SendTextResult> {
    if (!this.socket || this.state.status !== "connected") {
      throw new WhatsAppNotConnectedError();
    }
    const jid = `${phone}@s.whatsapp.net`;
    const result = await this.socket.sendMessage(
      jid,
      { text: message, ...forwardedContext(options) },
      quotedOption(jid, options),
    );
    return { messageId: result?.key?.id ?? null };
  }

  /** Baileys rc14 accepts a concrete individual PN/LID JID as a sendMessage destination. */
  async sendTextToJid(jid: string, message: string, options?: SendOptions): Promise<SendTextResult> {
    if (!isValidIndividualJid(jid)) throw new InvalidWhatsAppIndividualJidError(jid);
    const socket = this.requireConnectedSocket();
    const result = await socket.sendMessage(
      jid,
      { text: message, ...forwardedContext(options) },
      quotedOption(jid, options),
    );
    return { messageId: result?.key?.id ?? null };
  }

  /**
   * Reacts to, edits, or revokes ("delete for everyone") an existing message. WhatsApp enforces
   * its own time limits for edits and revokes; callers keep their own window as well.
   */
  async sendMessageAction(action: MessageAction): Promise<SendTextResult> {
    const chatJid = action.chatJid.trim().toLowerCase();
    const isGroup = isValidGroupJid(chatJid);
    if (!isGroup && !isValidIndividualJid(chatJid)) {
      throw new InvalidWhatsAppIndividualJidError(chatJid);
    }
    const socket = this.requireConnectedSocket();
    if (isGroup) await this.getGroupMetadata(chatJid);
    const fromMe = action.kind === "reaction" ? action.target.fromMe : true;
    const participant =
      action.kind === "reaction" && isGroup && !fromMe ? action.target.participant : null;
    const key = {
      remoteJid: chatJid,
      id: action.target.id,
      fromMe,
      ...(participant ? { participant } : {}),
    };
    const content =
      action.kind === "reaction"
        ? { react: { text: action.emoji, key } }
        : action.kind === "edit"
          ? { text: action.text, edit: key }
          : { delete: key };
    const result = await socket.sendMessage(chatJid, content);
    return { messageId: result?.key?.id ?? null };
  }

  /**
   * The WhatsApp preview-size profile picture of a contact or group, or null when none is set or
   * the person's privacy settings hide it from this account.
   */
  async getProfilePicture(jid: string): Promise<Buffer | null> {
    const target = jid.trim().toLowerCase();
    if (!isValidGroupJid(target) && !isValidIndividualJid(target)) {
      throw new InvalidWhatsAppIndividualJidError(target);
    }
    const socket = this.requireConnectedSocket();
    let url: string | undefined;
    try {
      url = await socket.profilePictureUrl(target, "preview", 10_000);
    } catch (error) {
      if (isProfilePictureUnavailable(error)) return null;
      throw error;
    }
    if (!url) return null;
    return downloadProfilePicture(url, this.dependencies.fetch ?? fetch);
  }

  async markMessagesRead(messages: InboundReadReceiptKey[]): Promise<void> {
    if (messages.length === 0) return;
    const socket = this.requireConnectedSocket();
    await socket.readMessages(
      messages.map((message) => ({
        remoteJid: message.remoteJid,
        id: message.whatsappMessageId,
        fromMe: false,
      })),
    );
  }

  async sendMedia(phone: string, media: OutboundMedia, options?: SendOptions): Promise<SendTextResult> {
    return this.sendMediaToJid(`${phone}@s.whatsapp.net`, media, options);
  }

  async sendMediaToIndividualJid(
    jid: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    if (!isValidIndividualJid(jid)) throw new InvalidWhatsAppIndividualJidError(jid);
    return this.sendMediaToJid(jid, media, options);
  }

  /**
   * Starts a phone-number pairing flow for this live, concrete device socket.
   * The code is returned to the caller only; JalurPesan never stores it.
   */
  async requestPairingCode(phone: string): Promise<string> {
    if (!this.socket || this.state.status === "connected") {
      throw new WhatsAppPairingUnavailableError();
    }
    return this.socket.requestPairingCode(phone);
  }

  async listJoinedGroups(): Promise<WhatsAppGroupMetadata[]> {
    const socket = this.requireConnectedSocket();
    const groups = await socket.groupFetchAllParticipating();
    return Object.values(groups)
      .filter((group) => isValidGroupJid(group.id))
      .map(normalizeGroupMetadata)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async getGroupMetadata(groupJid: string): Promise<WhatsAppGroupMetadata> {
    if (!isValidGroupJid(groupJid)) throw new InvalidWhatsAppGroupJidError(groupJid);
    const socket = this.requireConnectedSocket();
    // A metadata query alone is not a membership check. Fetching joined groups first
    // keeps this API limited to groups available to the concrete device session.
    const joined = await socket.groupFetchAllParticipating();
    if (!Object.hasOwn(joined, groupJid)) throw new WhatsAppGroupNotFoundError(groupJid);
    return normalizeGroupMetadata(await socket.groupMetadata(groupJid));
  }

  async createGroup(subject: string, participants: string[]): Promise<WhatsAppGroupMetadata> {
    assertValidGroupParticipants(participants);
    const socket = this.requireConnectedSocket();
    return normalizeGroupMetadata(await socket.groupCreate(subject, participants));
  }

  async updateGroupParticipants(
    groupJid: string,
    participants: string[],
    action: WhatsAppGroupParticipantAction,
  ): Promise<WhatsAppGroupParticipantUpdate[]> {
    assertValidGroupParticipants(participants);
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    const result = await socket.groupParticipantsUpdate(groupJid, participants, action);
    return result.flatMap((item) =>
      typeof item.jid === "string"
        ? [{ jid: item.jid, status: String(item.status ?? "200") }]
        : [],
    );
  }

  async updateGroupSubject(groupJid: string, subject: string): Promise<WhatsAppGroupMetadata> {
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    await socket.groupUpdateSubject(groupJid, subject);
    return this.getGroupMetadata(groupJid);
  }

  async updateGroupDescription(
    groupJid: string,
    description: string | undefined,
  ): Promise<WhatsAppGroupMetadata> {
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    await socket.groupUpdateDescription(groupJid, description);
    return this.getGroupMetadata(groupJid);
  }

  async updateGroupSetting(groupJid: string, setting: WhatsAppGroupSetting): Promise<void> {
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    if (setting === "member_add_all" || setting === "member_add_admin") {
      await socket.groupMemberAddMode(groupJid, setting === "member_add_all" ? "all_member_add" : "admin_add");
    } else if (setting === "approval_on" || setting === "approval_off") {
      await socket.groupJoinApprovalMode(groupJid, setting === "approval_on" ? "on" : "off");
    } else {
      await socket.groupSettingUpdate(groupJid, setting);
    }
  }

  async listGroupJoinRequests(groupJid: string): Promise<WhatsAppGroupJoinRequest[]> {
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    const rows = await socket.groupRequestParticipantsList(groupJid);
    return rows.flatMap((row) => {
      const jid = typeof row.jid === "string" ? row.jid : null;
      if (!jid) return [];
      const at = Number(row.request_time);
      return [{
        jid,
        phoneJid: isPnUser(jid) ? jid : (nonEmpty(row.phone_number) ?? null),
        requestedAt: Number.isFinite(at) && at > 0 ? new Date(at * 1000).toISOString() : null,
      }];
    });
  }

  async updateGroupJoinRequests(
    groupJid: string,
    participants: string[],
    action: "approve" | "reject",
  ): Promise<WhatsAppGroupParticipantUpdate[]> {
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    const result = await socket.groupRequestParticipantsUpdate(groupJid, participants, action);
    return result.flatMap((item) =>
      typeof item.jid === "string" ? [{ jid: item.jid, status: String(item.status ?? "200") }] : [],
    );
  }

  async updateGroupPicture(groupJid: string, image: Buffer | null): Promise<void> {
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    if (image) await socket.updateProfilePicture(groupJid, image);
    else await socket.removeProfilePicture(groupJid);
  }

  async getGroupInviteCode(groupJid: string): Promise<string | null> {
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    return (await socket.groupInviteCode(groupJid)) ?? null;
  }

  async revokeGroupInvite(groupJid: string): Promise<string | null> {
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    return (await socket.groupRevokeInvite(groupJid)) ?? null;
  }

  async leaveGroup(groupJid: string): Promise<void> {
    const socket = this.requireConnectedSocket();
    await this.getGroupMetadata(groupJid);
    await socket.groupLeave(groupJid);
  }

  async sendGroupText(
    groupJid: string,
    message: string,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    const socket = this.requireConnectedSocket();
    const metadata = await this.getGroupMetadata(groupJid);
    const result = await socket.sendMessage(
      groupJid,
      { text: message, ...forwardedContext(options) },
      quotedOption(groupJid, options),
    );
    return {
      messageId: result?.key?.id ?? null,
      ...groupParticipantSnapshot(metadata, socket.user?.id),
    };
  }

  async sendGroupMedia(
    groupJid: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    const socket = this.requireConnectedSocket();
    const metadata = await this.getGroupMetadata(groupJid);
    const result = await this.sendMediaToJid(groupJid, media, options);
    return { ...result, ...groupParticipantSnapshot(metadata, socket.user?.id) };
  }

  /** Requests bounded history before a concrete provider message anchor. */
  async requestMessageHistory(input: {
    count: number;
    remoteJid: string;
    whatsappMessageId: string;
    fromMe: boolean;
    timestampMs: number;
  }): Promise<string> {
    const socket = this.requireConnectedSocket();
    return socket.fetchMessageHistory(
      input.count,
      {
        remoteJid: input.remoteJid,
        id: input.whatsappMessageId,
        fromMe: input.fromMe,
      },
      input.timestampMs,
    );
  }

  /** Idempotent: repeated calls never create a second socket. */
  async connect(): Promise<DeviceState> {
    if (this.socket || this.starting) return this.getState();
    if (this.state.requiresReset && this.hasStoredCredentials()) {
      throw new WhatsAppSessionResetRequiredError();
    }
    this.cancelAutoReconnect();
    this.starting = true;
    this.updateState({ loggedOut: false, status: "connecting", reconnectAttempts: 0 });
    try {
      await this.start();
    } finally {
      this.starting = false;
    }
    return this.getState();
  }

  /** Called at boot: only reconnects when credentials already exist on disk. */
  async restoreIfAuthenticated(): Promise<void> {
    if (!this.hasStoredCredentials()) return;
    await this.connect();
  }

  /** Replaces the live socket while preserving the stored credentials. */
  async reconnect(): Promise<DeviceState> {
    if (this.state.requiresReset && this.hasStoredCredentials()) {
      throw new WhatsAppSessionResetRequiredError();
    }
    await this.stop("manual_reconnect");
    return this.connect();
  }

  /** Unlinks this device from WhatsApp. Credential removal is owned by DeviceManager. */
  async logout(): Promise<DeviceState> {
    this.cancelAutoReconnect();
    if (!this.socket && this.hasStoredCredentials()) await this.connect();
    const socket = this.socket;
    if (socket) await socket.logout();

    this.generation += 1;
    this.socket = null;
    this.starting = false;
    this.updateState({
      status: "disconnected",
      qr: null,
      jid: null,
      name: null,
      connectedAt: null,
      lastDisconnectReason: "logged_out",
      lastDisconnectCode: DisconnectReason.loggedOut,
      lastDisconnectedAt: this.dependencies.now(),
      loggedOut: true,
      requiresReset: false,
      reconnectAttempts: 0,
    });
    return this.getState();
  }

  /** Terminates this process's socket without unlinking the WhatsApp account. */
  async stop(reason = "stopped"): Promise<DeviceState> {
    this.cancelAutoReconnect();
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.starting = false;
    socket?.end(new Error(reason));
    this.updateState({
      status: "disconnected",
      qr: null,
      jid: null,
      name: null,
      connectedAt: null,
      lastDisconnectReason: reason,
      lastDisconnectCode: null,
      lastDisconnectedAt: this.dependencies.now(),
      requiresReset: false,
      reconnectAttempts: 0,
    });
    return this.getState();
  }

  private async start(): Promise<void> {
    const generation = ++this.generation;
    const { state: authState, saveCreds } = await this.dependencies.loadAuthState(this.authDir);
    let storeBootstrap = false;
    try {
      storeBootstrap = this.dependencies.storeBootstrapHistory?.() === true;
    } catch {
      storeBootstrap = false;
    }

    const socket = this.dependencies.createSocket({
      auth: authState,
      // Silent, except that it hears the app-state sync actions Baileys has no event for (quick replies).
      logger: syncSpyLogger((action) => this.onSyncAction(action)) as never,
      printQRInTerminal: false,
      // Phone-number pairing registers the browser tuple with WhatsApp as part
      // of its companion handshake. Use Baileys' canonical supported identity
      // instead of an application/version tuple so QR and code pairing agree.
      browser: Browsers.macOS("Chrome"),
      // Pairing asks the phone for its full history (`requireFullSync`); Baileys' default then
      // drops FULL chunks. Opted-in devices keep every chunk so their chats can be stored.
      ...(storeBootstrap ? { syncFullHistory: true, shouldSyncHistoryMessage: () => true } : {}),
    });
    this.socket = socket;

    socket.ev.on("creds.update", async () => {
      // Baileys keeps the pairing code in its in-memory auth state while the
      // companion handshake is active. Persist all other credentials, but never
      // serialize the human-entered pairing code into the auth directory.
      const pairingCode = authState.creds.pairingCode;
      if (pairingCode !== undefined) authState.creds.pairingCode = undefined;
      try {
        await saveCreds();
      } finally {
        if (pairingCode !== undefined) authState.creds.pairingCode = pairingCode;
      }
    });

    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (generation !== this.generation) return;
      if (type !== "notify") return;
      for (const message of messages) {
        const inbound = normalizeInboundMessage(
          message,
          socket.user?.id ?? null,
          this.dependencies.now(),
          async () => {
            const downloader = this.dependencies.downloadMedia ?? downloadMediaMessage;
            return downloader(
              message,
              "stream",
              {},
              {
                reuploadRequest: socket.updateMediaMessage,
                logger: silentLogger as never,
              },
            );
          },
        );
        if (!inbound) continue;
        try {
          if (generation !== this.generation) continue;
          if (inbound.peerJidAlt || !isLidUser(inbound.chatJid)) {
            void Promise.resolve(this.onInboundMessage(inbound)).catch(() => undefined);
          } else {
            void this.resolveInboundLidMapping(socket, inbound)
              .then((resolved) => {
                if (generation !== this.generation) return;
                return this.onInboundMessage(resolved);
              })
              .catch(() => undefined);
          }
        } catch {
          // Synchronous listener errors are isolated from Baileys too.
        }
      }
    });

    socket.ev.on("lid-mapping.update", ({ lid, pn }) => {
      if (generation !== this.generation) return;
      this.emitMetadata({ type: "lid-mapping", lid, pn });
    });
    socket.ev.on(
      "messaging-history.set",
      ({ contacts, lidPnMappings, messages, syncType, peerDataRequestSessionId, progress }) => {
        if (generation !== this.generation) return;
        for (const mapping of lidPnMappings ?? []) {
          this.emitMetadata({ type: "lid-mapping", lid: mapping.lid, pn: mapping.pn });
        }
        for (const contact of contacts) this.emitContactMetadata(contact);
        if (syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND) {
          if (!storeBootstrap) return;
          // Text of individual chats only: pairing history can hold years of media, which the
          // host must not download in bulk. Media and group messages are counted as skipped.
          const stored = messages.flatMap((message) => {
            const history = normalizeHistoryMessage(
              message,
              socket.user?.id ?? null,
              this.dependencies.now(),
              () => Promise.reject(new Error("Bootstrap history media is not downloaded")),
            );
            return history && history.recipientType === "individual" && !("mediaType" in history)
              ? [history]
              : [];
          });
          void Promise.resolve(
            this.onHistory({
              type: "bootstrap",
              syncType: proto.HistorySync.HistorySyncType[syncType ?? -1] ?? String(syncType),
              providerMessageCount: messages.length,
              messages: stored,
            }),
          ).catch(() => undefined);
          return;
        }
        const normalized = messages.flatMap((message) => {
          const history = normalizeHistoryMessage(
            message,
            socket.user?.id ?? null,
            this.dependencies.now(),
            async () => {
              const downloader = this.dependencies.downloadMedia ?? downloadMediaMessage;
              return downloader(
                message,
                "stream",
                {},
                { reuploadRequest: socket.updateMediaMessage, logger: silentLogger as never },
              );
            },
          );
          return history ? [history] : [];
        });
        void Promise.resolve(
          this.onHistory({
            type: "messages",
            providerRequestId: peerDataRequestSessionId ?? null,
            providerMessageCount: messages.length,
            messages: normalized,
            progress: progress ?? null,
          }),
        ).catch(() => undefined);
      },
    );
    socket.ev.on("messaging-history.status", ({ syncType, status }) => {
      if (
        generation !== this.generation ||
        syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND
      )
        return;
      void Promise.resolve(this.onHistory({ type: "status", status })).catch(() => undefined);
    });
    socket.ev.on("contacts.upsert", (contacts) => {
      if (generation !== this.generation) return;
      for (const contact of contacts) this.emitContactMetadata(contact);
    });
    socket.ev.on("contacts.update", (contacts) => {
      if (generation !== this.generation) return;
      for (const contact of contacts) this.emitContactMetadata(contact);
    });
    socket.ev.on("groups.upsert", (groups) => {
      if (generation !== this.generation) return;
      for (const group of groups) this.emitGroupMetadata(group);
    });
    socket.ev.on("groups.update", (groups) => {
      if (generation !== this.generation) return;
      for (const group of groups) this.emitGroupMetadata(group);
    });
    // WhatsApp Business labels (app-state "regular"): the labels themselves and which chats carry them.
    socket.ev.on("labels.edit", (label) => {
      if (generation !== this.generation) return;
      const event = labelMetadata(label);
      if (event) this.emitMetadata(event);
    });
    socket.ev.on("labels.association", ({ type, association }) => {
      if (generation !== this.generation) return;
      if (association?.type !== "label_jid" || typeof association.labelId !== "string" || typeof association.chatId !== "string") return;
      if (!association.labelId || association.labelId.length > 64 || !association.chatId || association.chatId.length > 128) return;
      this.emitMetadata({ type: "chat-label", labelId: association.labelId, chatJid: association.chatId, labeled: type === "add" });
    });

    socket.ev.on("messages.update", (updates) => {
      if (generation !== this.generation) return;
      for (const update of updates) {
        const receipt = normalizeOutboundReceipt(update, this.dependencies.now());
        if (!receipt) continue;
        try {
          this.onOutboundReceipt(receipt);
        } catch {
          // Persistence errors are reported by the composition-layer listener.
          // They must not tear down the live Baileys socket event loop.
        }
      }
    });
    socket.ev.on("message-receipt.update", (updates) => {
      if (generation !== this.generation) return;
      for (const update of updates) {
        const receipt = normalizeGroupOutboundReceipt(update, this.dependencies.now());
        if (!receipt) continue;
        try {
          this.onOutboundReceipt(receipt);
        } catch {
          // See the individual receipt handler above. Socket processing must continue.
        }
      }
    });

    socket.ev.on("connection.update", (update) => {
      if (generation !== this.generation) return;
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        void this.dependencies.qrToDataUrl(qr).then((dataUrl) => {
          if (generation !== this.generation) return;
          this.updateState({ qr: dataUrl, status: "qr" });
        });
      }

      if (connection === "connecting" && this.state.status !== "qr") {
        this.updateState({ status: "connecting" });
      }

      if (connection === "open") {
        this.updateState({
          status: "connected",
          qr: null,
          jid: socket.user?.id ?? null,
          name: socket.user?.name ?? null,
          connectedAt: this.dependencies.now(),
          lastDisconnectReason: null,
          lastDisconnectCode: null,
          lastDisconnectedAt: null,
          loggedOut: false,
          requiresReset: false,
          reconnectAttempts: 0,
        });
        // A group cache is presentation metadata. A failed query must never
        // interfere with restoring the authenticated WhatsApp session.
        void Promise.resolve()
          .then(() => socket.groupFetchAllParticipating())
          .then((groups) => {
            if (generation !== this.generation) return;
            for (const group of Object.values(groups)) this.emitGroupMetadata(group);
          })
          .catch(() => undefined);
      }

      if (connection === "close") {
        if (this.handledCloseGenerations.has(generation)) return;
        this.handledCloseGenerations.add(generation);
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const diagnostic = classifyDisconnect(statusCode ?? null);

        this.socket = null;
        this.updateState({
          status: diagnostic.autoReconnect ? "connecting" : "disconnected",
          qr: null,
          jid: null,
          name: null,
          connectedAt: null,
          lastDisconnectReason: diagnostic.reason,
          lastDisconnectCode: diagnostic.code,
          lastDisconnectedAt: this.dependencies.now(),
          loggedOut: diagnostic.loggedOut,
          requiresReset: diagnostic.requiresReset,
        });

        if (diagnostic.autoReconnect) {
          void this.requestAutoReconnect();
        } else {
          this.cancelAutoReconnect();
        }
      }
    });
  }

  private requestAutoReconnect(): Promise<void> {
    if (this.autoReconnectPromise) {
      this.pendingAutoReconnect = true;
      return this.autoReconnectPromise;
    }
    const epoch = this.autoReconnectEpoch;
    this.autoReconnectPromise = this.runAutoReconnect(epoch).finally(() => {
      this.autoReconnectPromise = null;
      if (this.pendingAutoReconnect) {
        this.pendingAutoReconnect = false;
        void this.requestAutoReconnect();
      }
    });
    return this.autoReconnectPromise;
  }

  private async runAutoReconnect(epoch: number): Promise<void> {
    while (
      epoch === this.autoReconnectEpoch &&
      !this.socket &&
      !this.starting &&
      !this.state.requiresReset &&
      this.state.reconnectAttempts < MAX_AUTO_RECONNECT_ATTEMPTS
    ) {
      const attempt = this.state.reconnectAttempts + 1;
      this.updateState({ status: "connecting", reconnectAttempts: attempt });
      await this.dependencies.sleep(AUTO_RECONNECT_DELAYS_MS[attempt - 1] ?? 10_000);
      if (
        epoch !== this.autoReconnectEpoch ||
        this.socket ||
        this.starting ||
        this.state.requiresReset
      ) {
        return;
      }

      this.starting = true;
      try {
        await this.start();
        return;
      } catch {
        if (attempt >= MAX_AUTO_RECONNECT_ATTEMPTS) {
          this.updateState({ status: "disconnected" });
        }
      } finally {
        this.starting = false;
      }
    }

    if (!this.socket && this.state.reconnectAttempts >= MAX_AUTO_RECONNECT_ATTEMPTS) {
      this.updateState({ status: "disconnected" });
    }
  }

  private cancelAutoReconnect(): void {
    this.autoReconnectEpoch += 1;
    this.pendingAutoReconnect = false;
  }

  private requireConnectedSocket(): WASocket {
    if (!this.socket || this.state.status !== "connected") {
      throw new WhatsAppNotConnectedError();
    }
    return this.socket;
  }

  private async sendMediaToJid(
    jid: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<SendTextResult> {
    const socket = this.requireConnectedSocket();
    const upload = { stream: media.data };
    let content;
    switch (media.mediaType) {
      case "image":
        content = { image: upload, mimetype: media.mimeType, caption: media.caption ?? undefined };
        break;
      case "video":
        content = { video: upload, mimetype: media.mimeType, caption: media.caption ?? undefined };
        break;
      case "audio":
        content = { audio: upload, mimetype: media.mimeType };
        break;
      case "document":
        content = {
          document: upload,
          mimetype: media.mimeType,
          fileName: media.originalFilename ?? "document",
          caption: media.caption ?? undefined,
        };
        break;
      case "sticker":
        content = { sticker: upload };
        break;
    }
    const result = await socket.sendMessage(
      jid,
      { ...content, ...forwardedContext(options) },
      quotedOption(jid, options),
    );
    return { messageId: result?.key?.id ?? null };
  }

  private async resolveInboundLidMapping(
    socket: WASocket,
    message: InboundMessage,
  ): Promise<InboundMessage> {
    if (message.peerJidAlt || !isLidUser(message.chatJid)) return message;
    const pn = await socket.signalRepository.lidMapping.getPNForLID(message.chatJid);
    if (!pn) return message;
    this.emitMetadata({ type: "lid-mapping", lid: message.chatJid, pn });
    return { ...message, peerJidAlt: pn };
  }

  private emitContactMetadata(contact: {
    id?: string;
    lid?: string;
    phoneNumber?: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
  }): void {
    const identities = [contact.id, contact.lid, contact.phoneNumber].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (identities.length === 0) return;
    const display = bestContactDisplay(contact.name, contact.notify, contact.verifiedName);
    this.emitMetadata({
      type: "contact",
      identities,
      displayName: display?.value ?? null,
      displayPriority: display?.priority ?? 1,
    });
  }

  private emitGroupMetadata(group: { id?: string; subject?: string }): void {
    if (!group.id) return;
    this.emitMetadata({ type: "group", jid: group.id, subject: group.subject ?? null });
  }

  /** A quick reply from the phone's WhatsApp Business (Baileys only logs it). */
  private onSyncAction(action: { index: unknown; value: unknown }): void {
    const value = action.value as { quickReplyAction?: { shortcut?: unknown; message?: unknown; deleted?: unknown } } | null;
    const qr = value?.quickReplyAction;
    const index = Array.isArray(action.index) ? action.index : [];
    if (!qr || index[0] !== "quick_reply" || typeof index[1] !== "string") return;
    this.emitMetadata({
      type: "quick-reply",
      waId: index[1].slice(0, 64),
      shortcut: typeof qr.shortcut === "string" ? qr.shortcut.slice(0, 100) : "",
      message: typeof qr.message === "string" ? qr.message.slice(0, 4096) : "",
      deleted: qr.deleted === true,
    });
  }

  /**
   * The number's own WhatsApp Business catalog, one page of up to 100 products. `catalog` says whether WhatsApp knows
   * one: for a number that never made a catalog WhatsApp does not answer the catalog query at all (seen on production
   * 2026-11-09), so a first page without an answer in [CATALOG_READ_TIMEOUT_MS] is an empty, `missing` catalog. A later
   * page without an answer is an error (408), never a hang.
   */
  async listCatalog(cursor: string | null): Promise<WhatsAppCatalogPage> {
    const socket = this.requireConnectedSocket();
    const page = await readCatalogPage(socket, ownPhoneJid(socket), cursor);
    if (page) return { ...page, catalog: "present" };
    if (cursor) throw new Boom("WhatsApp did not answer the catalog page", { statusCode: 408 });
    return { products: [], nextCursor: null, catalog: "missing" };
  }

  /** Adds or changes a WhatsApp Business quick reply; `waId` null makes a new one. Returns its id. */
  async upsertQuickReply(waId: string | null, shortcut: string, message: string): Promise<string> {
    return this.inQuickReplyQueue(async () => {
      const socket = this.requireConnectedSocket();
      // Milliseconds plus three random digits: two new ones in the same millisecond never share an id.
      const id = waId ?? `${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
      await (socket as unknown as { addOrEditQuickReply: (q: object) => Promise<void> }).addOrEditQuickReply({ timestamp: id, shortcut, message });
      this.emitMetadata({ type: "quick-reply", waId: id, shortcut, message, deleted: false });
      return id;
    });
  }

  private lastQuickReplyResync = 0;
  /** Quick-reply writes and the read-again run one at a time: a write encoded against a dropped state would fail. */
  private quickReplyQueue: Promise<unknown> = Promise.resolve();

  private inQuickReplyQueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.quickReplyQueue.then(work, work);
    this.quickReplyQueue = run.catch(() => undefined);
    return run;
  }

  /**
   * Reads the phone's quick replies again from WhatsApp's own record. WhatsApp only sends app-state changes, so replies
   * made before this engine listened are never heard until edited; dropping the stored version of the "regular"
   * collection makes Baileys fetch it whole (a snapshot), and each reply in it passes the same sync-action path as a
   * live change. At most once per five minutes per number after a read that landed. False when skipped, or when
   * Baileys gave up on the snapshot (it does so quietly, e.g. a missing key): the previous version is then put back so
   * live changes keep arriving.
   */
  async resyncQuickReplies(): Promise<boolean> {
    this.requireConnectedSocket();
    if (Date.now() - this.lastQuickReplyResync < 5 * 60_000) return false;
    return this.inQuickReplyQueue(async () => {
      if (Date.now() - this.lastQuickReplyResync < 5 * 60_000) return false;
      return this.readRegularSnapshot();
    });
  }

  /**
   * Reads app-state "regular" (quick replies, labels and the chats they are on) whole; see [resyncQuickReplies]. Runs
   * inside the quick-reply queue. A snapshot that landed is told as "labels-snapshot", so labels it no longer carries
   * are forgotten and the label list counts as complete.
   */
  private async readRegularSnapshot(): Promise<boolean> {
    const s = this.requireConnectedSocket() as unknown as {
      authState: {
        creds?: { me?: { id?: string } };
        keys: {
          get: (type: string, ids: string[]) => Promise<Record<string, unknown>> | Record<string, unknown>;
          set: (data: Record<string, Record<string, unknown>>) => Promise<void> | void;
          transaction?: <T>(work: () => Promise<T>, key: string) => Promise<T>;
        };
      };
      resyncAppState: (collections: string[], isInitialSync: boolean) => Promise<void>;
    };
    const startedAt = new Date().toISOString();
    // Dropping the version and reading the snapshot hold Baileys' app-state lock together (the key resyncAppState
    // uses): otherwise a resync already running (a server_sync notice) commits its version over the dropped one, the
    // "snapshot" is then only a few patches, and the labels it did not repeat would be taken as gone.
    const keys = s.authState.keys;
    const locked = <T>(work: () => Promise<T>) =>
      keys.transaction ? keys.transaction(work, s.authState.creds?.me?.id || "resync-app-state") : work();
    const landed = await locked(async () => {
      const before = (await keys.get("app-state-sync-version", ["regular"]))?.regular ?? null;
      await keys.set({ "app-state-sync-version": { regular: null } });
      let done = false;
      try {
        await s.resyncAppState(["regular"], false);
        done = Boolean((await keys.get("app-state-sync-version", ["regular"]))?.regular);
      } finally {
        if (!done && before) await keys.set({ "app-state-sync-version": { regular: before } });
      }
      return done;
    });
    if (landed) {
      this.lastQuickReplyResync = Date.now();
      this.emitMetadata({ type: "labels-snapshot", startedAt });
    } else {
      this.lastFailedSnapshot = Date.now();
    }
    return landed;
  }

  /** When a snapshot last failed to land; label changes wait a minute before asking WhatsApp for one again. */
  private lastFailedSnapshot = 0;

  /**
   * Puts the platform's labels on one chat and takes off the ones it manages but no longer wants, leaving every other
   * label alone. `managed` names every label the platform owns, `wanted` the subset this chat should carry; names
   * compare without regard to case or surrounding spaces. A wanted label missing on the phone is made first, with a
   * color picked from its name. The first time, the phone's labels are read whole (a snapshot) so an existing label is
   * never made twice. Runs one at a time with quick-reply changes (same app-state collection). Returns the managed
   * names (as the platform spelled them) now on the chat.
   */
  async applyChatLabels(
    input: { chatJids: string[]; managed: string[]; wanted: string[] },
    store: WhatsAppLabelStore,
  ): Promise<string[]> {
    this.requireConnectedSocket();
    return this.inQuickReplyQueue(async () => {
      const socket = this.requireConnectedSocket() as unknown as {
        addLabel: (jid: string, label: { id: string; name: string; color: number; deleted: boolean }) => Promise<void>;
        addChatLabel: (jid: string, labelId: string) => Promise<void>;
        removeChatLabel: (jid: string, labelId: string) => Promise<void>;
        resyncAppState: (collections: string[], isInitialSync: boolean) => Promise<void>;
      };
      if (!store.synced()) {
        if (Date.now() - this.lastFailedSnapshot < 60_000 || !(await this.readRegularSnapshot())) throw new WhatsAppLabelsUnreadError();
      } else {
        // Hear the phone's latest label changes before choosing ids and names, so a label just made there is not
        // made again (or overwritten by a new id).
        await socket.resyncAppState(["regular"], false);
      }
      const all = store.labels();
      const live = all.filter((label) => !label.deleted);
      const byId = new Map(live.map((label) => [label.id, label]));
      const managedKeys = new Map(input.managed.map((name) => [labelKey(name), name]));
      const wantedKeys = new Set(input.wanted.map(labelKey));
      const attached = store.chatLabels(input.chatJids).filter((a) => byId.has(a.labelId));
      // A new label goes on the chat as the phone already knows it (by its LID or its number), else the first JID.
      const target = attached[0]?.chatJid ?? input.chatJids[0]!;
      const now = new Set<string>();
      for (const association of attached) {
        const key = labelKey(byId.get(association.labelId)!.name);
        if (!managedKeys.has(key)) continue;
        if (wantedKeys.has(key)) {
          now.add(key);
          continue;
        }
        await socket.removeChatLabel(association.chatJid, association.labelId);
        this.emitMetadata({ type: "chat-label", labelId: association.labelId, chatJid: association.chatJid, labeled: false });
      }
      let nextId = Math.max(0, ...all.map((label) => (/^\d{1,9}$/.test(label.id) ? Number(label.id) : 0))) + 1;
      for (const name of input.wanted) {
        const key = labelKey(name);
        if (now.has(key)) continue;
        let label = live.filter((l) => labelKey(l.name) === key).sort(compareLabelIds)[0];
        if (!label) {
          label = { id: String(nextId++), name: name.trim(), color: labelColor(key), deleted: false, predefinedId: null };
          await socket.addLabel("", { id: label.id, name: label.name, color: label.color, deleted: false });
          this.emitMetadata({ type: "label", ...label });
        }
        await socket.addChatLabel(target, label.id);
        this.emitMetadata({ type: "chat-label", labelId: label.id, chatJid: target, labeled: true });
        now.add(key);
      }
      return [...managedKeys].filter(([key]) => now.has(key)).map(([, name]) => name);
    });
  }

  /**
   * Sets the hours on the number's WhatsApp Business profile (days left out are closed), then reads the profile back.
   * `verified` is false when WhatsApp keeps something else, null when the read-back was not possible.
   */
  async updateBusinessHours(hours: BusinessHours): Promise<{ verified: boolean | null }> {
    const socket = this.requireConnectedSocket() as WASocket & {
      updateBussinesProfile: (args: object) => Promise<unknown>;
      getBusinessProfile: (jid: string) => Promise<{ business_hours?: { timezone?: string; business_config?: Array<Record<string, unknown>> } } | undefined>;
    };
    const days = hours.days.map((d) =>
      d.mode === "specific_hours"
        ? { day: d.day, mode: d.mode, openTimeInMinutes: String(d.openMinutes), closeTimeInMinutes: String(d.closeMinutes) }
        : { day: d.day, mode: d.mode },
    );
    await socket.updateBussinesProfile({ hours: { timezone: hours.timezone, days } });
    const own = socket.user?.id;
    if (!own) return { verified: null };
    try {
      const profile = await socket.getBusinessProfile(`${own.split(":")[0]!.split("@")[0]}@s.whatsapp.net`);
      const read = profile?.business_hours;
      if (!read?.business_config) return { verified: null };
      const shape = (day: unknown, mode: unknown, open: unknown, close: unknown) =>
        mode === "specific_hours" ? `${String(day)}|${String(mode)}|${String(open)}|${String(close)}` : `${String(day)}|${String(mode)}`;
      const sent = days.map((d) => shape(d.day, d.mode, "openTimeInMinutes" in d ? d.openTimeInMinutes : null, "closeTimeInMinutes" in d ? d.closeTimeInMinutes : null)).sort();
      const kept = read.business_config.map((c) => shape(c.day_of_week, c.mode, c.open_time, c.close_time)).sort();
      return { verified: read.timezone === hours.timezone && JSON.stringify(sent) === JSON.stringify(kept) };
    } catch {
      return { verified: null };
    }
  }

  /**
   * The number's own WhatsApp Business profile, read whole (every website and category; Baileys' own reader keeps only
   * the first). The profile photo URL is null when there is none; the name comes from the session (never written).
   */
  async getBusinessProfile(): Promise<WhatsAppBusinessProfile> {
    const socket = this.requireConnectedSocket();
    const jid = ownPhoneJid(socket);
    const profile = await readBusinessProfileNode(socket, jid);
    let profilePictureUrl: string | null;
    try {
      profilePictureUrl = (await socket.profilePictureUrl(jid, "image", 10_000)) ?? null;
    } catch {
      // No photo, or privacy hides it: the profile is still readable without one.
      profilePictureUrl = null;
    }
    const user = socket.user as { verifiedName?: string; name?: string; notify?: string } | undefined;
    const name = user?.verifiedName || user?.name || user?.notify || null;
    return { jid, name: name ? name.slice(0, 200) : null, ...profile, profilePictureUrl };
  }

  /**
   * Changes the given profile fields (a delta: others stay), then reads the profile back. `verified` is false when
   * WhatsApp keeps something else than sent, null when the read-back was not possible.
   */
  async updateBusinessProfile(update: BusinessProfileUpdate): Promise<{ verified: boolean | null; profile: WhatsAppBusinessProfile | null }> {
    const socket = this.requireConnectedSocket() as WASocket & { updateBussinesProfile: (args: object) => Promise<unknown> };
    // Baileys answers a time-out with nothing instead of an error: no answer is an unknown outcome, never a success.
    if ((await whatsappWrite(() => socket.updateBussinesProfile({ ...update }))) === undefined) throw new WhatsAppOutcomeUnknownError();
    let profile: WhatsAppBusinessProfile;
    try {
      profile = await this.getBusinessProfile();
    } catch {
      return { verified: null, profile: null };
    }
    const same = (sent: string | undefined, kept: string | null) => sent === undefined || sent === (kept ?? "");
    const verified =
      same(update.description, profile.description) &&
      same(update.address, profile.address) &&
      same(update.email, profile.email) &&
      (update.websites === undefined || JSON.stringify(update.websites) === JSON.stringify(profile.websites));
    return { verified, profile };
  }

  /**
   * Sets (or with null removes) the number's own profile photo. Baileys shrinks it with sharp or jimp; where neither is
   * installed a JPEG is sent as it is. `verified`: a photo is (or is no longer) there when read back; null: unknown.
   */
  async updateOwnProfilePicture(image: Buffer | null): Promise<{ verified: boolean | null }> {
    const socket = this.requireConnectedSocket();
    const jid = ownPhoneJid(socket);
    if (image) {
      await whatsappWrite(async () => {
        try {
          await socket.updateProfilePicture(jid, image);
        } catch (error) {
          const jpeg = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
          if (!jpeg || !/No image processing library/i.test(String((error as Error)?.message))) throw error;
          await socket.query({
            tag: "iq",
            attrs: { to: "s.whatsapp.net", type: "set", xmlns: "w:profile:picture" },
            content: [{ tag: "picture", attrs: { type: "image" }, content: image }],
          });
        }
      });
    } else {
      await whatsappWrite(() => socket.removeProfilePicture(jid));
    }
    try {
      const url = await socket.profilePictureUrl(jid, "preview", 10_000);
      return { verified: Boolean(url) === Boolean(image) };
    } catch (error) {
      return { verified: isProfilePictureUnavailable(error) ? !image : null };
    }
  }

  /** Sets the WhatsApp Business cover photo; returns its id and whether the profile now names it (null: not said). */
  async updateCoverPhoto(image: Buffer): Promise<{ id: string; verified: boolean | null }> {
    const socket = this.requireConnectedSocket() as WASocket & { updateCoverPhoto: (photo: Buffer) => Promise<number | string> };
    const id = String(await whatsappWrite(() => socket.updateCoverPhoto(image)));
    this.coverPhotoId = id;
    try {
      const read = await readBusinessProfileNode(socket, ownPhoneJid(socket));
      return { id, verified: read.coverPhoto ? read.coverPhoto.id === id : null };
    } catch {
      return { id, verified: null };
    }
  }

  /**
   * Removes the cover photo: `id` as given, else as the profile names it, else the one this engine set last.
   * Throws [WhatsAppCoverPhotoUnknownError] when none is known.
   */
  async removeCoverPhoto(id: string | null): Promise<{ id: string }> {
    const socket = this.requireConnectedSocket() as WASocket & { removeCoverPhoto: (id: string) => Promise<unknown> };
    let target = id;
    if (!target) {
      try {
        target = (await readBusinessProfileNode(socket, ownPhoneJid(socket))).coverPhoto?.id ?? null;
      } catch {
        target = null;
      }
    }
    target ??= this.coverPhotoId;
    if (!target) throw new WhatsAppCoverPhotoUnknownError();
    if ((await whatsappWrite(() => socket.removeCoverPhoto(target))) === undefined) throw new WhatsAppOutcomeUnknownError();
    if (this.coverPhotoId === target) this.coverPhotoId = null;
    return { id: target };
  }

  /** Adds a product to the number's catalog; WhatsApp may review it before customers see it (`reviewStatus`). */
  async createCatalogProduct(input: CatalogProductInput): Promise<CatalogProductWrite> {
    return this.writeCatalogProduct(null, input);
  }

  /** Replaces a product's fields; images stay when `images` is null. */
  async updateCatalogProduct(productId: string, input: CatalogProductInput): Promise<CatalogProductWrite> {
    return this.writeCatalogProduct(productId, input);
  }

  async deleteCatalogProduct(productId: string): Promise<{ deleted: number }> {
    const socket = this.requireConnectedSocket() as WASocket & { productDelete: (ids: string[]) => Promise<{ deleted: number }> };
    const result = await whatsappWrite(() => socket.productDelete([productId]));
    return { deleted: Number(result?.deleted ?? 0) };
  }

  /**
   * The catalog IQ written here rather than through Baileys' productCreate/productUpdate: those drop the product link
   * (`url`) and require a price. Images are uploaded from bytes only (never fetched from a URL).
   */
  private async writeCatalogProduct(productId: string | null, input: CatalogProductInput): Promise<CatalogProductWrite> {
    const socket = this.requireConnectedSocket();
    // A first product needs a catalog: on a number without one, nothing is written (the owner makes the catalog once
    // in the WhatsApp Business app). Whether WhatsApp would make one remotely is not known, so it is never tried.
    if (productId === null && !(await readCatalogPage(socket, ownPhoneJid(socket), null))) throw new WhatsAppCatalogMissingError();
    const imageUrls = input.images ? await uploadProductImages(socket, input.images) : null;
    const op = productId === null ? "product_catalog_add" : "product_catalog_edit";
    const result = await whatsappWrite(() => socket.query({
      tag: "iq",
      attrs: { to: "s.whatsapp.net", type: "set", xmlns: "w:biz:catalog" },
      content: [{
        tag: op,
        attrs: { v: "1" },
        content: [
          productNode(productId, input, imageUrls),
          { tag: "width", attrs: {}, content: "100" },
          { tag: "height", attrs: {}, content: "100" },
        ],
      }],
    }));
    const node = getBinaryNodeChild(getBinaryNodeChild(result, op), "product");
    const product = node ? parseProductNode(node) : null;
    // WhatsApp accepted the IQ but its answer names no product: it may well exist now.
    if (!product) throw new WhatsAppOutcomeUnknownError();
    const verified =
      product.name === input.name &&
      (input.description === null || product.description === input.description) &&
      product.hidden === input.hidden &&
      (input.price === null || (product.price === input.price && product.currency === input.currency)) &&
      (input.url === null || product.url === input.url) &&
      (input.retailerId === null || product.retailerId === input.retailerId);
    return { product, verified };
  }

  async removeQuickReply(waId: string): Promise<void> {
    return this.inQuickReplyQueue(async () => {
      const socket = this.requireConnectedSocket();
      await (socket as unknown as { removeQuickReply: (t: string) => Promise<void> }).removeQuickReply(waId);
      this.emitMetadata({ type: "quick-reply", waId, shortcut: "", message: "", deleted: true });
    });
  }

  private emitMetadata(event: WhatsAppMetadataEvent): void {
    try {
      this.onMetadata(event);
    } catch {
      // Metadata is a cache; it must not break the WhatsApp event loop.
    }
  }

  private updateState(update: Partial<DeviceState>): void {
    this.state = { ...this.state, ...update };
    this.onStateChange(this.getState());
  }
}

function normalizeInboundMessage(
  message: WAMessage,
  ownJid: string | null,
  receivedAt: string,
  download: () => Promise<Readable>,
): InboundMessage | null {
  if (message.key.fromMe === true) return null;

  const whatsappMessageId = nonEmpty(message.key.id);
  const chatJid = nonEmpty(message.key.remoteJid);
  if (!whatsappMessageId || !chatJid) return null;

  const addressing = inboundAddressing(message, ownJid, chatJid);
  if (!addressing) return null;
  const peerJidAlt = nonEmpty(message.key.remoteJidAlt);
  const senderDisplayName = normalizedProviderDisplayName(message.pushName);
  const mentions = mentionedJids(message);
  const reply = replyContext(message);
  const media = inboundMediaMetadata(message);
  if (media) {
    return {
      whatsappMessageId,
      chatJid,
      peerJidAlt,
      senderDisplayName,
      ...addressing,
      ...media,
      ...(mentions.length ? { mentionedJids: mentions } : {}),
      ...reply,
      receivedAt,
      download,
    };
  }
  const body = textBody(message);
  if (!body || body.trim().length === 0) return null;
  return {
    whatsappMessageId,
    chatJid,
    peerJidAlt,
    senderDisplayName,
    ...addressing,
    body,
    ...(mentions.length ? { mentionedJids: mentions } : {}),
    ...reply,
    receivedAt,
  };
}

export function normalizeHistoryMessage(
  message: WAMessage,
  ownJid: string | null,
  fallbackTimestamp: string,
  download: () => Promise<Readable>,
): HistoryMessage | null {
  const occurredAt = providerMessageTimestamp(message, fallbackTimestamp);
  if (message.key.fromMe !== true) {
    const inbound = normalizeInboundMessage(message, ownJid, occurredAt, download);
    return inbound ? { ...inbound, direction: "inbound" } : null;
  }
  const whatsappMessageId = nonEmpty(message.key.id);
  const chatJid = nonEmpty(message.key.remoteJid);
  if (!whatsappMessageId || !chatJid) return null;
  const recipientType: "group" | "individual" = isJidGroup(chatJid) ? "group" : "individual";
  if (recipientType === "individual" && !isValidIndividualJid(chatJid)) return null;
  const recipientJid = chatJid;
  const common = {
    direction: "outbound" as const,
    whatsappMessageId,
    chatJid,
    peerJidAlt: nonEmpty(message.key.remoteJidAlt),
    senderJid: ownJid ?? "",
    recipientJid,
    recipientType,
    sentAt: occurredAt,
  };
  const media = inboundMediaMetadata(message);
  if (media) return { ...common, ...media, download };
  const body = textBody(message);
  return body?.trim() ? { ...common, body } : null;
}

function providerMessageTimestamp(message: WAMessage, fallback: string): string {
  const seconds = Number(message.messageTimestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  const timestamp = new Date(seconds * 1_000);
  return Number.isNaN(timestamp.getTime()) ? fallback : timestamp.toISOString();
}

function inboundAddressing(message: WAMessage, ownJid: string | null, chatJid: string) {
  if (isJidGroup(chatJid)) {
    const senderJid =
      nonEmpty(message.key.participant) ??
      nonEmpty(message.key.participantAlt) ??
      nonEmpty(message.participant);
    if (!senderJid || (ownJid && areJidsSameUser(senderJid, ownJid))) return null;
    return {
      senderJid,
      recipientJid: chatJid,
      recipientType: "group" as const,
    };
  }

  if (!isValidIndividualJid(chatJid) || (ownJid && areJidsSameUser(chatJid, ownJid))) return null;
  return {
    senderJid: chatJid,
    recipientJid: nonEmpty(ownJid),
    recipientType: "individual" as const,
  };
}

function inboundMediaMetadata(
  message: WAMessage,
): Omit<
  InboundMediaMessage,
  | "whatsappMessageId"
  | "chatJid"
  | "peerJidAlt"
  | "senderJid"
  | "recipientJid"
  | "recipientType"
  | "receivedAt"
  | "download"
> | null {
  const content = normalizeMessageContent(message.message);
  const candidates = [
    ["image", content?.imageMessage],
    ["video", content?.videoMessage],
    ["audio", content?.audioMessage],
    ["document", content?.documentMessage],
    ["sticker", content?.stickerMessage],
  ] as const;
  const match = candidates.find(([, value]) => value);
  if (!match) return null;
  const [mediaType, value] = match;
  if (!value) return null;
  const fallbackMime = {
    image: "image/jpeg",
    video: "video/mp4",
    audio: "audio/ogg",
    document: "application/octet-stream",
    sticker: "image/webp",
  }[mediaType];
  const mimeType = normalizeMimeType(value.mimetype) ?? fallbackMime;
  const caption = "caption" in value ? nonEmpty(value.caption) : null;
  const originalFilename = mediaType === "document" ? nonEmpty(value.fileName) : null;
  const declared =
    value.fileLength === null || value.fileLength === undefined
      ? undefined
      : Number(value.fileLength);
  return {
    mediaType,
    mimeType,
    originalFilename,
    caption,
    declaredSizeBytes:
      declared !== undefined && Number.isSafeInteger(declared) && declared >= 0
        ? declared
        : undefined,
  };
}

function messageContextInfo(message: WAMessage): proto.IContextInfo | null {
  const content = normalizeMessageContent(message.message);
  return (
    content?.extendedTextMessage?.contextInfo ??
    content?.imageMessage?.contextInfo ??
    content?.videoMessage?.contextInfo ??
    content?.documentMessage?.contextInfo ??
    content?.audioMessage?.contextInfo ??
    content?.stickerMessage?.contextInfo ??
    null
  );
}

/** Quote and forward markers set by the sender's WhatsApp client. */
export function replyContext(message: WAMessage): {
  quoted: { id: string; participant: string | null } | null;
  forwarded: boolean;
} {
  const context = messageContextInfo(message);
  const quotedId = nonEmpty(context?.stanzaId);
  return {
    quoted: quotedId
      ? {
          id: quotedId.slice(0, 200),
          participant: nonEmpty(context?.participant)?.toLowerCase() ?? null,
        }
      : null,
    forwarded: context?.isForwarded === true,
  };
}

/** At most 256 normalized JIDs from the message's contextInfo, for "was this number mentioned". */
export function mentionedJids(message: WAMessage): string[] {
  const content = normalizeMessageContent(message.message);
  const context =
    content?.extendedTextMessage?.contextInfo ??
    content?.imageMessage?.contextInfo ??
    content?.videoMessage?.contextInfo ??
    content?.documentMessage?.contextInfo ??
    content?.audioMessage?.contextInfo ??
    null;
  const raw = context?.mentionedJid ?? [];
  return [
    ...new Set(
      raw.flatMap((jid) =>
        typeof jid === "string" && jid.trim() ? [jid.trim().toLowerCase()] : [],
      ),
    ),
  ].slice(0, 256);
}

function forwardedContext(options: SendOptions | undefined) {
  const contextInfo = {
    ...(options?.forwarded ? { isForwarded: true, forwardingScore: 1 } : {}),
    ...(options?.mentions?.length ? { mentionedJid: options.mentions } : {}),
  };
  return Object.keys(contextInfo).length ? { contextInfo } : {};
}

/**
 * Baileys builds the quote (contextInfo.stanzaId/participant/quotedMessage) from a WAMessage.
 * The key's remoteJid is the destination chat itself, so WhatsApp never treats it as a
 * cross-chat quote.
 */
function quotedOption(jid: string, options: SendOptions | undefined) {
  const quoted = options?.quoted;
  if (!quoted) return undefined;
  const participant = isJidGroup(jid) && !quoted.fromMe ? quoted.participant : null;
  const caption = quoted.text ?? undefined;
  const message: proto.IMessage =
    quoted.messageType === "image"
      ? { imageMessage: { caption } }
      : quoted.messageType === "video"
        ? { videoMessage: { caption } }
        : quoted.messageType === "audio"
          ? { audioMessage: {} }
          : quoted.messageType === "document"
            ? { documentMessage: { caption } }
            : quoted.messageType === "sticker"
              ? { stickerMessage: {} }
              : { conversation: quoted.text ?? "" };
  return {
    quoted: {
      key: {
        remoteJid: jid,
        id: quoted.id,
        fromMe: quoted.fromMe,
        ...(participant ? { participant } : {}),
      },
      ...(participant ? { participant } : {}),
      message,
    } as WAMessage,
  };
}

function isProfilePictureUnavailable(error: unknown): boolean {
  const data = (error as { data?: unknown } | null)?.data;
  const status = (error as { output?: { statusCode?: number } } | null)?.output?.statusCode;
  return [401, 403, 404].includes(Number(data)) || status === 404;
}

/** Downloads only from WhatsApp's own HTTPS media hosts, capped at the preview size limit. */
async function downloadProfilePicture(url: string, fetcher: typeof fetch): Promise<Buffer | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !/(^|\.)whatsapp\.net$/i.test(parsed.hostname)) return null;
  const response = await fetcher(parsed, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`profile picture download returned ${response.status}`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > PROFILE_PICTURE_MAX_BYTES) {
      await response.body.cancel().catch(() => undefined);
      throw new Error("profile picture is larger than the preview limit");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function textBody(message: WAMessage): string | null {
  const conversation = message.message?.conversation;
  if (typeof conversation === "string") return conversation;
  const extendedText = message.message?.extendedTextMessage?.text;
  return typeof extendedText === "string" ? extendedText : null;
}

export function isValidIndividualJid(jid: string): boolean {
  const normalized = jid.trim().toLowerCase();
  const concreteLid = /^\d{5,25}(?::\d+)?@(?:lid|hosted\.lid)$/.test(normalized);
  return Boolean(
    isSupportedIndividualJid(jid) &&
    (isPnUser(jid) ||
      isHostedPnUser(jid) ||
      (concreteLid && (isLidUser(jid) || isHostedLidUser(jid)))),
  );
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizedProviderDisplayName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 200);
  return normalized || null;
}

function bestContactDisplay(
  name: string | null | undefined,
  notify: string | null | undefined,
  verifiedName: string | null | undefined,
): { value: string; priority: number } | null {
  for (const [value, priority] of [
    [name, 3],
    [notify, 2],
    [verifiedName, 1],
  ] as const) {
    if (typeof value === "string" && value.trim().length > 0) {
      return { value, priority };
    }
  }
  return null;
}

/** Maps only unequivocal one-to-one outbound delivery/read updates from Baileys v7. */
export function normalizeOutboundReceipt(
  messageUpdate: WAMessageUpdate,
  occurredAt: string,
): OutboundMessageReceipt | null {
  if (messageUpdate.key.fromMe !== true) return null;
  // Baileys v7 emits per-user/aggregate group updates through the same event.
  // They are not one-to-one delivery/read receipts, so group semantics stay deferred.
  if (isJidGroup(messageUpdate.key.remoteJid ?? undefined)) return null;
  const whatsappMessageId = nonEmpty(messageUpdate.key.id);
  if (!whatsappMessageId) return null;
  if (messageUpdate.update.status === WAMessageStatus.DELIVERY_ACK) {
    return { whatsappMessageId, status: "delivered", occurredAt };
  }
  if (messageUpdate.update.status === WAMessageStatus.READ) {
    return { whatsappMessageId, status: "read", occurredAt };
  }
  return null;
}

/** Maps only Baileys rc14's participant-specific outbound group receipt event. */
export function normalizeGroupOutboundReceipt(
  update: MessageUserReceiptUpdate,
  fallbackOccurredAt: string,
): OutboundMessageReceipt | null {
  if (update.key.fromMe !== true || !isJidGroup(update.key.remoteJid ?? undefined)) return null;
  const whatsappMessageId = nonEmpty(update.key.id);
  const groupParticipantJid = nonEmpty(update.receipt.userJid)?.toLowerCase();
  if (!whatsappMessageId || !groupParticipantJid || !isSupportedIndividualJid(groupParticipantJid))
    return null;
  if (update.receipt.readTimestamp !== null && update.receipt.readTimestamp !== undefined) {
    return {
      whatsappMessageId,
      status: "read",
      occurredAt: receiptOccurredAt(update.receipt.readTimestamp, fallbackOccurredAt),
      groupParticipantJid,
    };
  }
  if (update.receipt.receiptTimestamp !== null && update.receipt.receiptTimestamp !== undefined) {
    return {
      whatsappMessageId,
      status: "delivered",
      occurredAt: receiptOccurredAt(update.receipt.receiptTimestamp, fallbackOccurredAt),
      groupParticipantJid,
    };
  }
  return null;
}

function receiptOccurredAt(
  value: number | { toNumber(): number },
  fallbackOccurredAt: string,
): string {
  const seconds = typeof value === "number" ? value : value.toNumber();
  if (!Number.isFinite(seconds) || seconds <= 0) return fallbackOccurredAt;
  const timestamp = new Date(seconds * 1_000);
  return Number.isNaN(timestamp.valueOf()) ? fallbackOccurredAt : timestamp.toISOString();
}

function groupParticipantSnapshot(
  metadata: WhatsAppGroupMetadata,
  ownJid: string | undefined,
): { groupParticipantCount: number } | Record<string, never> {
  if (!ownJid) return {};
  const participants = [...new Set(metadata.participants.map((participant) => participant.jid))];
  const includesSender = participants.some((participant) => areJidsSameUser(participant, ownJid));
  return includesSender ? { groupParticipantCount: Math.max(0, participants.length - 1) } : {};
}

/** A WhatsApp group JID must be a numeric group identifier, not merely an @g.us suffix. */
export function isValidGroupJid(jid: string): boolean {
  return Boolean(isJidGroup(jid) && /^\d{5,22}(?:-\d{5,22})?@g\.us$/.test(jid));
}

function assertValidGroupParticipants(participants: string[]): void {
  if (participants.length === 0) throw new InvalidWhatsAppIndividualJidError("");
  const invalid = participants.find((jid) => !isValidIndividualJid(jid));
  if (invalid !== undefined) throw new InvalidWhatsAppIndividualJidError(invalid);
}

function normalizeGroupMetadata(group: {
  id: string;
  subject: string;
  owner: string | undefined;
  desc?: string;
  size?: number;
  announce?: boolean;
  restrict?: boolean;
  memberAddMode?: boolean;
  joinApprovalMode?: boolean;
  participants: Array<{
    id?: string;
    admin?: "admin" | "superadmin" | null;
    phoneNumber?: string;
    lid?: string;
  }>;
}): WhatsAppGroupMetadata {
  return {
    id: group.id,
    subject: group.subject,
    owner: group.owner ?? null,
    description: group.desc ?? null,
    size: group.size ?? null,
    settings: {
      announce: typeof group.announce === "boolean" ? group.announce : null,
      restrict: typeof group.restrict === "boolean" ? group.restrict : null,
      memberAddMode: typeof group.memberAddMode === "boolean" ? group.memberAddMode : null,
      joinApprovalMode: typeof group.joinApprovalMode === "boolean" ? group.joinApprovalMode : null,
    },
    participants: group.participants.flatMap((participant) =>
      typeof participant.id === "string"
        ? [
            {
              jid: participant.id,
              admin: participant.admin ?? null,
              phoneJid: isPnUser(participant.id)
                ? participant.id
                : (nonEmpty(participant.phoneNumber) ?? null),
              lidJid: isLidUser(participant.id)
                ? participant.id
                : (nonEmpty(participant.lid) ?? null),
            },
          ]
        : [],
    ),
  };
}

export class InvalidWhatsAppGroupJidError extends Error {
  constructor(readonly groupJid: string) {
    super("Invalid WhatsApp group JID");
    this.name = "InvalidWhatsAppGroupJidError";
  }
}

export class InvalidWhatsAppIndividualJidError extends Error {
  constructor(readonly jid: string) {
    super("Invalid WhatsApp individual JID");
    this.name = "InvalidWhatsAppIndividualJidError";
  }
}

export class WhatsAppGroupNotFoundError extends Error {
  constructor(readonly groupJid: string) {
    super("WhatsApp group was not found for this device");
    this.name = "WhatsAppGroupNotFoundError";
  }
}

export class WhatsAppPairingUnavailableError extends Error {
  constructor() {
    super("WhatsApp pairing code can only be requested for an unpaired live device");
    this.name = "WhatsAppPairingUnavailableError";
  }
}

/** Raised when a send is attempted while WhatsApp is not connected. */
export class WhatsAppNotConnectedError extends Error {
  constructor() {
    super("WhatsApp is not connected");
    this.name = "WhatsAppNotConnectedError";
  }
}

export class WhatsAppSessionResetRequiredError extends Error {
  constructor() {
    super("The WhatsApp session is invalid and must be reset before reconnecting");
    this.name = "WhatsAppSessionResetRequiredError";
  }
}

/**
 * A WhatsApp Business write whose outcome is not known: the IQ timed out or the connection closed after it was sent,
 * or WhatsApp's answer could not be read. The change may have happened; the platform must check before trying again.
 */
export class WhatsAppOutcomeUnknownError extends Error {
  constructor() {
    super("WhatsApp did not confirm this change; it may have been applied");
    this.name = "WhatsAppOutcomeUnknownError";
  }
}

/** The number has no WhatsApp Business catalog yet; the owner makes it once in the WhatsApp Business app. */
export class WhatsAppCatalogMissingError extends Error {
  constructor() {
    super("This number has no WhatsApp Business catalog yet");
    this.name = "WhatsAppCatalogMissingError";
  }
}

/** No cover photo is known to remove: the profile does not name one and this engine did not set one. */
export class WhatsAppCoverPhotoUnknownError extends Error {
  constructor() {
    super("No WhatsApp Business cover photo is known for this number");
    this.name = "WhatsAppCoverPhotoUnknownError";
  }
}

/** The phone's labels could not be read whole yet, so a label change could make a label twice; try again later. */
export class WhatsAppLabelsUnreadError extends Error {
  constructor() {
    super("WhatsApp labels could not be read yet");
    this.name = "WhatsAppLabelsUnreadError";
  }
}

/** Label names compare without case or surrounding spaces. */
function labelKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** One of WhatsApp's 20 label colors, always the same for a name (FNV-1a of its key). */
export function labelColor(key: string): number {
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 20;
}

function compareLabelIds(left: WhatsAppLabel, right: WhatsAppLabel): number {
  const a = /^\d+$/.test(left.id) ? Number(left.id) : Number.MAX_SAFE_INTEGER;
  const b = /^\d+$/.test(right.id) ? Number(right.id) : Number.MAX_SAFE_INTEGER;
  return a - b || left.id.localeCompare(right.id);
}

/** A Baileys `labels.edit` as label metadata; null when it is not one this engine can keep. */
function labelMetadata(label: { id?: unknown; name?: unknown; color?: unknown; deleted?: unknown; predefinedId?: unknown }): WhatsAppMetadataEvent | null {
  if (typeof label?.id !== "string" || !label.id || label.id.length > 64) return null;
  const color = typeof label.color === "number" && Number.isInteger(label.color) && label.color >= 0 && label.color < 100 ? label.color : 0;
  return {
    type: "label",
    id: label.id,
    name: typeof label.name === "string" ? label.name.slice(0, 100) : "",
    color,
    deleted: label.deleted === true,
    predefinedId: typeof label.predefinedId === "string" && label.predefinedId ? label.predefinedId.slice(0, 32) : null,
  };
}

/** The number's own phone-number JID (the device part and server dropped). */
function ownPhoneJid(socket: WASocket): string {
  const own = socket.user?.id;
  if (!own) throw new WhatsAppNotConnectedError();
  return `${own.split(":")[0]!.split("@")[0]}@s.whatsapp.net`;
}

/** Text content of a binary node (WhatsApp sends it as bytes or as a string). */
function nodeText(node: BinaryNode | undefined): string | null {
  const content = node?.content;
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return Buffer.from(content).toString("utf8");
  return null;
}

function minutesOf(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 1440 ? n : null;
}

/** The w:biz business_profile IQ (as Baileys' getBusinessProfile sends it), parsed whole. */
async function readBusinessProfileNode(socket: WASocket, jid: string): Promise<Omit<WhatsAppBusinessProfile, "jid" | "name" | "profilePictureUrl">> {
  const result = await socket.query({
    tag: "iq",
    attrs: { to: "s.whatsapp.net", xmlns: "w:biz", type: "get" },
    content: [{ tag: "business_profile", attrs: { v: "244" }, content: [{ tag: "profile", attrs: { jid } }] }],
  }, CATALOG_READ_TIMEOUT_MS);
  // Baileys answers its own time-out with nothing: that is "no answer" (503), not "not a business" (422).
  if (!result) throw new Boom("WhatsApp did not answer the business profile", { statusCode: 408 });
  const profile = getBinaryNodeChild(getBinaryNodeChild(result, "business_profile"), "profile");
  if (!profile) throw new Boom("WhatsApp returned no business profile", { statusCode: 404, data: 404 });
  const text = (tag: string) => nodeText(getBinaryNodeChild(profile, tag));
  const hoursNode = getBinaryNodeChild(profile, "business_hours");
  const cover = getBinaryNodeChild(profile, "cover_photo");
  const coverId = typeof cover?.attrs?.id === "string" && cover.attrs.id ? cover.attrs.id : null;
  return {
    description: text("description") ?? "",
    address: text("address"),
    email: text("email"),
    websites: getBinaryNodeChildren(profile, "website").flatMap((w) => {
      const url = nodeText(w);
      return url ? [url] : [];
    }),
    categories: getBinaryNodeChildren(getBinaryNodeChild(profile, "categories"), "category").flatMap((c) => {
      const name = nodeText(c);
      return name ? [{ id: typeof c.attrs?.id === "string" ? c.attrs.id : null, name }] : [];
    }),
    hours: hoursNode
      ? {
          timezone: typeof hoursNode.attrs?.timezone === "string" ? hoursNode.attrs.timezone : null,
          days: getBinaryNodeChildren(hoursNode, "business_hours_config").map(({ attrs }) => ({
            day: String(attrs?.day_of_week ?? ""),
            mode: String(attrs?.mode ?? ""),
            openMinutes: minutesOf(attrs?.open_time),
            closeMinutes: minutesOf(attrs?.close_time),
          })),
        }
      : null,
    coverPhoto: coverId ? { id: coverId, url: typeof cover?.attrs?.url === "string" ? cover.attrs.url : nodeText(getBinaryNodeChild(cover, "url")) } : null,
  };
}

/** Uploads product images to WhatsApp's media servers (as Baileys' uploadingNecessaryImages does) and returns their URLs. */
async function uploadProductImages(socket: WASocket, images: Buffer[]): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "jp-product-"));
  try {
    const urls: string[] = [];
    for (const [index, image] of images.entries()) {
      const filePath = join(dir, `img${index}`);
      await writeFile(filePath, image);
      const sha = createHash("sha256").update(image).digest("base64");
      const { directPath } = await socket.waUploadToServer(filePath, {
        mediaType: "product-catalog-image",
        fileEncSha256B64: sha,
        timeoutMs: 30_000,
      });
      if (!directPath) throw new Boom("WhatsApp did not take the product image", { statusCode: 502 });
      urls.push(getUrlFromDirectPath(directPath));
    }
    return urls;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A catalog product node in WhatsApp's shape (Baileys' toProductNode, plus the product link). */
function productNode(productId: string | null, input: CatalogProductInput, imageUrls: string[] | null): BinaryNode {
  const attrs: Record<string, string> = { is_hidden: String(input.hidden) };
  const field = (tag: string, value: string): BinaryNode => ({ tag, attrs: {}, content: Buffer.from(value) });
  const content: BinaryNode[] = [];
  if (productId !== null) content.push(field("id", productId));
  content.push(field("name", input.name));
  if (input.description !== null) content.push(field("description", input.description));
  if (input.retailerId !== null) content.push(field("retailer_id", input.retailerId));
  if (input.url !== null) content.push(field("url", input.url));
  if (imageUrls && imageUrls.length > 0) {
    content.push({
      tag: "media",
      attrs: {},
      content: imageUrls.map((url) => ({ tag: "image", attrs: {}, content: [field("url", url)] })),
    });
  }
  if (input.price !== null && input.currency !== null) content.push(field("price", String(input.price)), field("currency", input.currency));
  if (productId === null) {
    if (input.originCountryCode) {
      content.push({ tag: "compliance_info", attrs: {}, content: [field("country_code_origin", input.originCountryCode)] });
    } else {
      attrs.compliance_category = "COUNTRY_ORIGIN_EXEMPT";
    }
  }
  return { tag: "product", attrs, content };
}

/** A product node WhatsApp answered with, in the engine's shape. */
function parseProductNode(node: BinaryNode): WhatsAppCatalogProduct | null {
  const text = (tag: string) => nodeText(getBinaryNodeChild(node, tag));
  const id = text("id");
  const name = text("name");
  if (!id || name === null) return null;
  const image = getBinaryNodeChild(getBinaryNodeChild(node, "media"), "image");
  const imageUrl = nodeText(getBinaryNodeChild(image, "request_image_url")) ?? nodeText(getBinaryNodeChild(image, "original_image_url"));
  const price = text("price");
  return {
    id,
    name: name.slice(0, 200),
    description: (text("description") ?? "").slice(0, 2000),
    price: price !== null && /^\d+$/.test(price) ? Number(price) : null,
    currency: text("currency"),
    url: text("url"),
    retailerId: text("retailer_id"),
    hidden: node.attrs?.is_hidden === "true",
    imageUrl,
    reviewStatus: nodeText(getBinaryNodeChild(getBinaryNodeChild(node, "status_info"), "status")),
  };
}

/**
 * Runs a WhatsApp Business write; a Baileys time-out (408) or closed connection (428) that is not an IQ error from
 * WhatsApp (which carries its code as a number in `data`) becomes [WhatsAppOutcomeUnknownError].
 */
async function whatsappWrite<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const value = error as { output?: { statusCode?: unknown }; data?: unknown } | null;
    const status = value?.output?.statusCode;
    if ((status === 408 || status === 428) && typeof value?.data !== "number") throw new WhatsAppOutcomeUnknownError();
    throw error;
  }
}

/** WhatsApp reads (catalog page, business profile) answer within this, under the platform's own 15 s limit. */
const CATALOG_READ_TIMEOUT_MS = 10_000;

/**
 * One page of the number's own catalog, read with the IQ Baileys' getCatalog sends; null when WhatsApp does not answer
 * in [CATALOG_READ_TIMEOUT_MS] or answers "item not found" (404): the number has no catalog. Other IQ errors throw.
 */
async function readCatalogPage(socket: WASocket, jid: string, cursor: string | null): Promise<{ products: WhatsAppCatalogProduct[]; nextCursor: string | null } | null> {
  const params: BinaryNode[] = [
    { tag: "limit", attrs: {}, content: Buffer.from("100") },
    { tag: "width", attrs: {}, content: Buffer.from("100") },
    { tag: "height", attrs: {}, content: Buffer.from("100") },
    ...(cursor ? [{ tag: "after", attrs: {}, content: cursor }] : []),
  ];
  let result: BinaryNode | undefined;
  try {
    result = await socket.query({
      tag: "iq",
      attrs: { to: "s.whatsapp.net", type: "get", xmlns: "w:biz:catalog" },
      content: [{ tag: "product_catalog", attrs: { jid, allow_shop_source: "true" }, content: params }],
    }, CATALOG_READ_TIMEOUT_MS);
  } catch (error) {
    const value = error as { output?: { statusCode?: unknown }; data?: unknown } | null;
    if (value?.data === 404) return null;
    if (value?.output?.statusCode === 408 && typeof value.data !== "number") return null;
    throw error;
  }
  const catalog = getBinaryNodeChild(result, "product_catalog");
  if (!catalog) return null;
  const after = nodeText(getBinaryNodeChild(getBinaryNodeChild(catalog, "paging"), "after"));
  return {
    products: getBinaryNodeChildren(catalog, "product").flatMap((node) => {
      const product = parseProductNode(node);
      return product ? [product] : [];
    }),
    nextCursor: after ? after : null,
  };
}
