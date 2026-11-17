import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { WaConfig } from "./config.js";
import type { ContactStore } from "./store/contacts.js";
import type { PgDeviceRegistry } from "./store/device-registry.js";
import type { EventStore } from "./store/events.js";
import { HistoryImportStore, MessageIndex, type IndexedMessage } from "./store/messages.js";
import type { MediaStore, StoredMediaRecord } from "./store/media.js";
import type { PhoneStateStore } from "./store/phone-state.js";
import { DeviceManager } from "./wa/device-manager.js";
import type { ProviderChangeEvent } from "./wa/message-changes.js";
import type { WhatsAppServiceFactory } from "./wa/device-manager.js";
import { createNativeReadAwareWhatsAppServiceFactory, type DeviceSentMessage } from "./wa/native-read-service-factory.js";
import { DEFAULT_SEND_SAFETY_CONFIG, PerDeviceSendSafety } from "./wa/send-safety.js";
import type {
  HistoryMessage,
  InboundMessage,
  OutboundMessageReceipt,
  WhatsAppHistoryEvent,
  WhatsAppMetadataEvent,
} from "./wa/service.js";

export type WaLog = (entry: Record<string, unknown>, message: string) => void;

/**
 * KIRIM-IMPL-005 §3 and §5. The seam between the WhatsApp layer carried over from JalurPesan and
 * this worker's own store: everything the sockets hear becomes a row in the event log that Kirim
 * SQ pulls by cursor, in exactly the payload shapes `apps/api/src/modules/kirim/ingest.ts` reads.
 *
 * Nothing here logs a number, a message body, a QR or a pairing code (§12).
 */

export interface EngineStores {
  devices: PgDeviceRegistry;
  events: EventStore;
  media: MediaStore;
  messages: MessageIndex;
  imports: HistoryImportStore;
  contacts: ContactStore;
  phoneState: PhoneStateStore;
}

/** How long an inbound media file may be before the engine stops downloading it. */
const INBOUND_MEDIA_MAX_BYTES = 64 * 1024 * 1024;
/** JalurPesan's own window: the phone is asked for its quick replies at most once an hour. */
const QUICK_REPLY_RESYNC_INTERVAL_MS = 3_600_000;

export class WaEngine {
  readonly devices: DeviceManager;
  readonly sendSafety: PerDeviceSendSafety;

  constructor(
    private readonly config: WaConfig,
    private readonly stores: EngineStores,
    private readonly log: WaLog = () => undefined,
    /** Test seam: production builds the real Baileys-backed factory below. */
    serviceFactory?: WhatsAppServiceFactory,
  ) {
    // JalurPesan's own values, kept as they are: Kirim SQ already paces sends per number
    // (`rate_per_menit`, safe hours), so this is the engine's last-resort guard and production
    // behaviour should not change the day a number moves here.
    this.sendSafety = new PerDeviceSendSafety(DEFAULT_SEND_SAFETY_CONFIG);
    const factory = createNativeReadAwareWhatsAppServiceFactory(
      () => undefined,
      (deviceId, message) => void this.onDeviceSent(deviceId, message).catch((error: unknown) => this.failed("device_sent", deviceId, error)),
      (deviceId, change) => void this.onChange(deviceId, change).catch((error: unknown) => this.failed("change", deviceId, error)),
      // KIRIM-IMPL-002 §10.3: the copy WhatsApp pushes at link time is kept for every number, so
      // "import from the stored copy" works without asking WhatsApp again.
      () => true,
    );
    this.devices = new DeviceManager(
      this.stores.devices,
      // The legacy single-folder slot never applies here; it is given a folder of its own so the
      // ported safety check in `clearCredentials` still has two distinct roots to compare.
      `${config.authRoot}-legacy-unused`,
      config.authRoot,
      serviceFactory ?? factory,
      (deviceId, message) => this.onInbound(deviceId, message).catch((error: unknown) => this.failed("inbound", deviceId, error)),
      (deviceId, receipt) => void this.onReceipt(deviceId, receipt).catch((error: unknown) => this.failed("receipt", deviceId, error)),
      (deviceId, event) => void this.onMetadata(deviceId, event).catch((error: unknown) => this.failed("metadata", deviceId, error)),
      (deviceId, event) => void this.onHistory(deviceId, event).catch((error: unknown) => this.failed("history", deviceId, error)),
      { maxActiveDevices: config.maxDevices, connectStaggerMs: config.connectStaggerMs },
    );
  }

  // --------------------------------------------------------------------- inbound and events

  private async onInbound(deviceId: string, message: InboundMessage): Promise<void> {
    const media = "mediaType" in message ? await this.copyInboundMedia(deviceId, message) : null;
    const body = "body" in message ? message.body : message.caption;
    const indexed: IndexedMessage = {
      whatsappMessageId: message.whatsappMessageId,
      direction: "inbound",
      chatJid: message.chatJid,
      senderJid: message.senderJid,
      messageType: "mediaType" in message ? message.mediaType : "text",
      body: body ?? null,
      occurredAt: message.receivedAt,
      fromMe: false,
      media: media ? mediaRef(media) : null,
    };
    await this.stores.messages.record(deviceId, indexed);
    await this.stores.events.append({
      deviceId,
      type: "message.received",
      messageId: message.whatsappMessageId,
      occurredAt: message.receivedAt,
      payload: { message: messagePayload(message, "inbound", media) },
    });
  }

  /** J-1: a message typed on the number's own phone or on another linked device. */
  private async onDeviceSent(deviceId: string, message: DeviceSentMessage): Promise<void> {
    const media = "mediaType" in message ? await this.copyInboundMedia(deviceId, message) : null;
    await this.stores.messages.record(deviceId, {
      whatsappMessageId: message.whatsappMessageId,
      direction: "outbound",
      chatJid: message.chatJid,
      senderJid: message.senderJid,
      messageType: "mediaType" in message ? message.mediaType : "text",
      body: ("body" in message ? message.body : message.caption) ?? null,
      occurredAt: message.sentAt,
      fromMe: true,
      media: media ? mediaRef(media) : null,
    });
    await this.stores.events.append({
      deviceId,
      type: "message.sent",
      messageId: message.whatsappMessageId,
      occurredAt: message.sentAt,
      payload: { message: messagePayload(message, "outbound", media) },
    });
  }

  private async onReceipt(deviceId: string, receipt: OutboundMessageReceipt): Promise<void> {
    await this.stores.events.append({
      deviceId,
      type: receipt.status === "read" ? "message.read" : "message.delivered",
      messageId: receipt.whatsappMessageId,
      occurredAt: receipt.occurredAt,
      payload: {
        message: {
          id: receipt.whatsappMessageId,
          whatsappMessageId: receipt.whatsappMessageId,
          status: receipt.status,
          ...(receipt.groupParticipantJid ? { groupParticipantJid: receipt.groupParticipantJid } : {}),
        },
      },
    });
  }

  /** KIRIM-IMPL-004 §6.2: edits, deletions, reactions and call logs. */
  private async onChange(deviceId: string, event: ProviderChangeEvent): Promise<void> {
    if (event.type === "call") {
      await this.stores.events.append({
        deviceId,
        type: "call.logged",
        messageId: event.callId,
        occurredAt: event.endedAt,
        payload: {
          call: {
            callId: event.callId,
            chatJid: event.chatJid,
            fromJid: event.fromJid,
            callerPnJid: event.callerPnJid,
            isVideo: event.isVideo,
            isGroup: event.isGroup,
            groupJid: event.groupJid,
            fromMe: event.fromMe,
            revision: event.revision,
            outcome: event.outcome,
            startedAt: event.startedAt,
            answeredAt: event.answeredAt,
            endedAt: event.endedAt,
            durationSeconds: event.durationSeconds,
          },
        },
      });
      return;
    }
    const base = {
      whatsappMessageId: event.whatsappMessageId,
      chatJid: event.chatJid,
      senderJid: event.senderJid,
      peerJidAlt: event.peerJidAlt,
      fromMe: event.fromMe,
      recipientType: event.recipientType,
    };
    if (event.type === "reaction") {
      await this.stores.events.append({
        deviceId,
        type: "message.reaction",
        messageId: event.whatsappMessageId,
        occurredAt: event.occurredAt,
        payload: { reaction: { ...base, emoji: event.emoji, reactionKey: event.reactionKey, reactedAt: event.occurredAt } },
      });
      return;
    }
    await this.stores.events.append({
      deviceId,
      type: event.type === "edited" ? "message.edited" : "message.deleted",
      messageId: event.whatsappMessageId,
      occurredAt: event.occurredAt,
      payload: {
        change: {
          ...base,
          ...(event.type === "edited" ? { body: event.body, editedAt: event.occurredAt } : { deletedAt: event.occurredAt }),
        },
      },
    });
  }

  /** What WhatsApp tells us about contacts, groups, quick replies and labels; never an event for Kirim SQ. */
  private async onMetadata(deviceId: string, event: WhatsAppMetadataEvent): Promise<void> {
    if (event.type === "lid-mapping") {
      await this.stores.contacts.linkLid(deviceId, event.lid, event.pn);
      return;
    }
    if (event.type === "contact") {
      await this.stores.contacts.upsert(deviceId, {
        identities: event.identities,
        displayName: event.displayName,
        displayPriority: event.displayPriority,
      });
      return;
    }
    if (event.type === "quick-reply") {
      this.stores.phoneState.upsertQuickReply(deviceId, {
        waId: event.waId,
        shortcut: event.shortcut,
        message: event.message,
        deleted: event.deleted,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if (event.type === "label") {
      this.stores.phoneState.upsertLabel(deviceId, { id: event.id, name: event.name, color: event.color, deleted: event.deleted, predefinedId: event.predefinedId });
      return;
    }
    if (event.type === "chat-label") {
      this.stores.phoneState.setChatLabel(deviceId, event.labelId, event.chatJid, event.labeled);
      return;
    }
    if (event.type === "labels-snapshot") {
      this.stores.phoneState.markLabelsSnapshot(deviceId, event.startedAt);
    }
    // `group` metadata needs nothing stored: Kirim SQ asks for the group list on its own beat.
  }

  /**
   * History from WhatsApp: either the chunk pushed when the number was linked (`bootstrap`), or
   * the answer to a "fetch older messages" request. Both end up in the message index; the second
   * also finishes the import Kirim SQ is waiting on.
   */
  private async onHistory(deviceId: string, event: WhatsAppHistoryEvent): Promise<void> {
    if (event.type === "status") return;
    const bootstrap = event.type === "bootstrap";
    for (const message of event.messages) {
      await this.stores.messages.record(deviceId, indexHistoryMessage(message), bootstrap);
    }
    if (event.type !== "messages" || !event.providerRequestId) return;
    const record = await this.stores.imports.findByRequestId(event.providerRequestId);
    if (record) await this.stores.imports.complete(record.id);
  }

  // ----------------------------------------------------------------------------- media

  private async copyInboundMedia(deviceId: string, message: { mediaType: string; mimeType: string; originalFilename: string | null; download: () => Promise<Readable> }): Promise<StoredMediaRecord | null> {
    try {
      const stream = await message.download();
      return await this.stores.media.storeStream({
        kode: deviceId,
        source: "inbound",
        mediaType: message.mediaType as StoredMediaRecord["mediaType"],
        mimeType: message.mimeType,
        originalFilename: message.originalFilename,
        stream,
        maxBytes: INBOUND_MEDIA_MAX_BYTES,
      });
    } catch (error) {
      // The message is still delivered without its file; Kirim SQ records it as not copied.
      this.failed("media_download", deviceId, error);
      return null;
    }
  }

  // ----------------------------------------------------------------------------- lifecycle

  /** Reads what the worker knows before it serves anything; cheap, and awaited by the caller. */
  async load(): Promise<void> {
    await this.stores.devices.load();
    await this.stores.phoneState.load();
    await this.stores.media.init();
  }

  /**
   * Opens a socket for every number that has stored credentials. Slow and unbounded: one number
   * whose phone is unreachable holds its `connect()` for the Baileys timeout, so this is started
   * after the port is open (see `startWorker`), never before it.
   */
  async start(): Promise<void> {
    const restored = await this.devices.restoreIfAuthenticated();
    this.log(
      {
        event: "kirim_wa.restored",
        restored: restored.restoredDeviceIds.length,
        skippedCapacity: restored.skippedCapacityDeviceIds.length,
        skippedReset: restored.skippedResetRequiredDeviceIds.length,
      },
      "numbers restored from stored credentials",
    );
  }

  /** Housekeeping, on the slow beat; each step is independent and a failure is only logged. */
  async housekeeping(): Promise<void> {
    const steps: Array<[string, () => Promise<number>]> = [
      ["media", () => this.stores.media.expire(this.config.mediaTtlHours)],
      ["messages", () => this.stores.messages.prune(this.config.messageRetentionDays)],
      ["events", () => this.stores.events.prune(7)],
      ["imports", () => this.stores.imports.timeOutStale(15)],
    ];
    for (const [name, run] of steps) {
      try {
        await run();
      } catch (error) {
        this.failed(`housekeeping.${name}`, null, error);
      }
    }
  }

  /** Quick replies are read again from the phone at most once an hour (JalurPesan's own window). */
  mayResyncQuickReplies(deviceId: string): boolean {
    return this.stores.phoneState.mayResyncQuickReplies(deviceId, QUICK_REPLY_RESYNC_INTERVAL_MS);
  }

  private failed(stage: string, deviceId: string | null, error: unknown): void {
    this.log(
      { event: `kirim_wa.${stage}.failed`, ...(deviceId ? { device: deviceId } : {}), errorType: error instanceof Error ? error.name : "unknown" },
      "engine step failed",
    );
  }
}

function mediaRef(media: StoredMediaRecord): IndexedMessage["media"] {
  return { id: media.id, mimeType: media.mimeType, sizeBytes: media.sizeBytes, sha256: media.sha256 };
}

/**
 * One message as Kirim SQ's `ingest.ts` reads it. `id` is the WhatsApp message id: JalurPesan had
 * an id of its own and answered sends with the WhatsApp one, and Kirim SQ matches receipts on
 * either, so using the WhatsApp id for both is right and keeps the two engines interchangeable.
 */
function messagePayload(
  message: InboundMessage | DeviceSentMessage,
  direction: "inbound" | "outbound",
  media: StoredMediaRecord | null,
): Record<string, unknown> {
  const isMedia = "mediaType" in message;
  const at = direction === "inbound" ? (message as InboundMessage).receivedAt : (message as DeviceSentMessage).sentAt;
  return {
    id: message.whatsappMessageId,
    whatsappMessageId: message.whatsappMessageId,
    direction,
    chatJid: message.chatJid,
    peerJidAlt: message.peerJidAlt,
    senderJid: message.senderJid,
    senderDisplayName: message.senderDisplayName ?? null,
    recipientType: message.recipientType,
    messageType: isMedia ? (message as { mediaType: string }).mediaType : "text",
    body: (isMedia ? (message as { caption: string | null }).caption : (message as { body: string }).body) || null,
    ...(direction === "inbound" ? { receivedAt: at } : { sentAt: at }),
    mentionedJids: message.mentionedJids ?? [],
    forwarded: message.forwarded === true,
    ...(message.quoted ? { quoted: { id: message.quoted.id, participant: message.quoted.participant } } : {}),
    media: media ? { id: media.id, mimeType: media.mimeType, sizeBytes: media.sizeBytes, sha256: media.sha256 } : null,
  };
}

function indexHistoryMessage(message: HistoryMessage): IndexedMessage {
  const isMedia = "mediaType" in message;
  const occurredAt = message.direction === "inbound" ? message.receivedAt : message.sentAt;
  return {
    whatsappMessageId: message.whatsappMessageId,
    direction: message.direction,
    chatJid: message.chatJid,
    senderJid: message.senderJid,
    messageType: isMedia ? (message as { mediaType: string }).mediaType : "text",
    body: (isMedia ? (message as { caption: string | null }).caption : (message as { body: string }).body) || null,
    occurredAt,
    fromMe: message.direction === "outbound",
    media: null,
  };
}

/** Stable identity of a send, for the duplicate window in the ported send safety. */
export function sendIdentity(target: string, content: string): string {
  return createHash("sha256").update(`${target}\u0000${content}`).digest("hex");
}

export function bufferToStream(data: Buffer): Readable {
  return Readable.from([data]);
}
