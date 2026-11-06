import { maskPhone } from "../crypto.js";
import {
  ProviderOperationError,
  type ActionResult,
  type GroupContent,
  type KirimProvider,
  type ProviderContactPage,
  type ProviderDeviceStatus,
  type ParticipantUpdate,
  type ProviderGroup,
  type Recipient,
  type SendOptions,
  type SendResult,
  type ProviderGroupSettings,
  type ProviderJoinRequest,
} from "./types.js";

export type KirimLog = (entry: Record<string, unknown>, message: string) => void;

/**
 * Default provider (§3.2): opens no network connection and sends nothing. Messages are marked
 * handed over with `dry_run`. The log carries only the masked number and the body length.
 */
export class LogProvider implements KirimProvider {
  readonly name = "log" as const;

  constructor(private readonly log: KirimLog = () => undefined) {}

  async sendText(device: { kode: string }, to: Recipient, text: string, idempotencyKey: string, options?: SendOptions): Promise<SendResult> {
    this.log({ event: "kirim.log.send", device: device.kode, to: maskRecipient(to), length: text.length, tipe: "teks", ...extras(options) }, "kirim log provider (dry run)");
    return { ok: true, providerMessageId: `log:${idempotencyKey}`, dryRun: true };
  }

  async sendDocument(
    device: { kode: string },
    to: Recipient,
    file: { kind?: "document" | "image" | "sticker" },
    caption: string | null,
    idempotencyKey: string,
    options?: SendOptions,
  ): Promise<SendResult> {
    const tipe = file.kind === "image" ? "gambar" : "dokumen";
    this.log({ event: "kirim.log.send", device: device.kode, to: maskRecipient(to), length: caption?.length ?? 0, tipe, ...extras(options) }, "kirim log provider (dry run)");
    return { ok: true, providerMessageId: `log:${idempotencyKey}`, dryRun: true };
  }

  async deviceStatus(): Promise<ProviderDeviceStatus> {
    return { status: "tersambung", qr: null, phoneDigits: null, engineDeviceId: null };
  }

  async provision(): Promise<void> {}

  /** A `log` number is always considered connected; the admin route refuses pairing for it. */
  async startPairing(): Promise<never> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp session to pair");
  }

  async disconnect(): Promise<void> {}

  async resetSession(): Promise<void> {}

  async pullEvents() {
    return { events: [], nextCursor: 0, hasMore: false };
  }

  async downloadMedia(): Promise<Buffer | null> {
    return null;
  }

  async sendGroup(device: { kode: string }, _groupJid: string, content: GroupContent, idempotencyKey: string, options?: SendOptions): Promise<SendResult> {
    const length = "text" in content ? content.text.length : content.caption?.length ?? 0;
    this.log({ event: "kirim.log.send", device: device.kode, to: "grup", length, tipe: "text" in content ? "teks" : "dokumen", ...extras(options) }, "kirim log provider (dry run)");
    return { ok: true, providerMessageId: `log:${idempotencyKey}`, dryRun: true };
  }

  async markRead(): Promise<void> {}

  async listGroups(): Promise<ProviderGroup[]> {
    return [];
  }

  async listContacts(): Promise<ProviderContactPage> {
    return { contacts: [], hasMore: false };
  }

  async requestHistory(): Promise<never> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp history");
  }

  async historyStatus(): Promise<never> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp history");
  }

  async historyMessages(): Promise<never> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp history");
  }

  async listHistoryChats(): Promise<never> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp history");
  }

  async requestStoredHistory(): Promise<never> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp history");
  }

  /** KIRIM-IMPL-004 §5: actions on a message are a dry run like sends; nothing reaches WhatsApp. */
  async react(device: { kode: string }): Promise<ActionResult> {
    this.log({ event: "kirim.log.action", device: device.kode, aksi: "reaksi" }, "kirim log provider (dry run)");
    return { ok: true, dryRun: true };
  }

  async editMessage(device: { kode: string }, _target: unknown, text: string): Promise<ActionResult> {
    this.log({ event: "kirim.log.action", device: device.kode, aksi: "edit", length: text.length }, "kirim log provider (dry run)");
    return { ok: true, dryRun: true };
  }

  async deleteMessage(device: { kode: string }): Promise<ActionResult> {
    this.log({ event: "kirim.log.action", device: device.kode, aksi: "hapus" }, "kirim log provider (dry run)");
    return { ok: true, dryRun: true };
  }

  async profilePicture(): Promise<Buffer | null> {
    return null;
  }

  /** A `log` number has no WhatsApp account, so it cannot own a group. */
  async createGroup(): Promise<never> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async updateParticipants(): Promise<{ updates: ParticipantUpdate[]; group: ProviderGroup | null }> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async setGroupSubject(): Promise<void> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async setGroupDescription(): Promise<void> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async groupInviteCode(): Promise<string> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async revokeGroupInvite(): Promise<string> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async groupSettings(): Promise<ProviderGroupSettings> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async groupInfo(): Promise<ProviderGroup | null> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async setGroupSetting(): Promise<void> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async groupJoinRequests(): Promise<ProviderJoinRequest[]> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async answerJoinRequests(): Promise<ParticipantUpdate[]> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async setGroupPicture(): Promise<void> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }

  async leaveGroup(): Promise<void> {
    throw new ProviderOperationError("engine_rejected", "log provider has no WhatsApp groups");
  }
}

/** Only whether a send quotes or forwards reaches the log, never the quoted text or id. */
function extras(options: SendOptions | undefined): Record<string, boolean> {
  return {
    ...(options?.quoted ? { kutip: true } : {}),
    ...(options?.forwarded ? { diteruskan: true } : {}),
  };
}

/** Only the masked number reaches a log; a LID contact has no number to show. */
export function maskRecipient(to: Recipient): string {
  return "phoneDigits" in to ? maskPhone(`+${to.phoneDigits}`) : "lid";
}
