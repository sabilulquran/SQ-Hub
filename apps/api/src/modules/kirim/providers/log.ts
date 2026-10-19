import { maskPhone } from "../crypto.js";
import {
  ProviderOperationError,
  type GroupContent,
  type KirimProvider,
  type ProviderContactPage,
  type ProviderDeviceStatus,
  type ProviderGroup,
  type Recipient,
  type SendResult,
} from "./types.js";

export type KirimLog = (entry: Record<string, unknown>, message: string) => void;

/**
 * Default provider (§3.2): opens no network connection and sends nothing. Messages are marked
 * handed over with `dry_run`. The log carries only the masked number and the body length.
 */
export class LogProvider implements KirimProvider {
  readonly name = "log" as const;

  constructor(private readonly log: KirimLog = () => undefined) {}

  async sendText(device: { kode: string }, to: Recipient, text: string, idempotencyKey: string): Promise<SendResult> {
    this.log({ event: "kirim.log.send", device: device.kode, to: maskRecipient(to), length: text.length, tipe: "teks" }, "kirim log provider (dry run)");
    return { ok: true, providerMessageId: `log:${idempotencyKey}`, dryRun: true };
  }

  async sendDocument(
    device: { kode: string },
    to: Recipient,
    file: { kind?: "document" | "image" },
    caption: string | null,
    idempotencyKey: string,
  ): Promise<SendResult> {
    const tipe = file.kind === "image" ? "gambar" : "dokumen";
    this.log({ event: "kirim.log.send", device: device.kode, to: maskRecipient(to), length: caption?.length ?? 0, tipe }, "kirim log provider (dry run)");
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

  async pullEvents() {
    return { events: [], nextCursor: 0, hasMore: false };
  }

  async downloadMedia(): Promise<Buffer | null> {
    return null;
  }

  async sendGroup(device: { kode: string }, _groupJid: string, content: GroupContent, idempotencyKey: string): Promise<SendResult> {
    const length = "text" in content ? content.text.length : content.caption?.length ?? 0;
    this.log({ event: "kirim.log.send", device: device.kode, to: "grup", length, tipe: "text" in content ? "teks" : "dokumen" }, "kirim log provider (dry run)");
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
}

/** Only the masked number reaches a log; a LID contact has no number to show. */
export function maskRecipient(to: Recipient): string {
  return "phoneDigits" in to ? maskPhone(`+${to.phoneDigits}`) : "lid";
}
