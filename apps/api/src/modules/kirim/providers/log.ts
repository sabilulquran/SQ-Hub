import { maskPhone } from "../crypto.js";
import { ProviderOperationError, type KirimProvider, type ProviderDeviceStatus, type SendResult } from "./types.js";

export type KirimLog = (entry: Record<string, unknown>, message: string) => void;

/**
 * Default provider (§3.2): opens no network connection and sends nothing. Messages are marked
 * handed over with `dry_run`. The log carries only the masked number and the body length.
 */
export class LogProvider implements KirimProvider {
  readonly name = "log" as const;

  constructor(private readonly log: KirimLog = () => undefined) {}

  async sendText(device: { kode: string }, to: { phoneDigits: string }, text: string, idempotencyKey: string): Promise<SendResult> {
    this.log({ event: "kirim.log.send", device: device.kode, to: maskPhone(`+${to.phoneDigits}`), length: text.length, tipe: "teks" }, "kirim log provider (dry run)");
    return { ok: true, providerMessageId: `log:${idempotencyKey}`, dryRun: true };
  }

  async sendDocument(
    device: { kode: string },
    to: { phoneDigits: string },
    _file: unknown,
    caption: string | null,
    idempotencyKey: string,
  ): Promise<SendResult> {
    this.log({ event: "kirim.log.send", device: device.kode, to: maskPhone(`+${to.phoneDigits}`), length: caption?.length ?? 0, tipe: "dokumen" }, "kirim log provider (dry run)");
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
}
