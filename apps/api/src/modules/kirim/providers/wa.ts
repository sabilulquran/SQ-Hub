import { JalurPesanProvider, type EngineMediaRefs } from "./jalurpesan.js";
import type { ProviderName } from "./types.js";

/**
 * KIRIM-IMPL-005 §6. Kirim SQ's own WhatsApp engine: the `kirim-wa` worker process shipped in the
 * SQ Hub release, reachable on loopback only.
 *
 * It is deliberately the JalurPesan adapter with another base URL and key. The worker implements
 * the same platform contract — the same paths, the same request bodies, the same status codes —
 * because that contract is what four Kirim SQ releases are written against and tested on. Sharing
 * the adapter is what lets one number move to this engine while the others stay where they are,
 * and lets it move back, without a line of Kirim SQ behaving differently.
 *
 * Only the name differs, and the name is what is written on every row: `kirim_devices.provider`,
 * `kirim_messages.provider`, `kirim_events.provider`, `kirim_media_engine_refs.provider`. That
 * keeps each engine's event cursor and media references in a space of its own (§8.3, §8.4).
 */
export class WaEngineProvider extends JalurPesanProvider {
  override readonly name: ProviderName = "wa";

  constructor(options: { baseUrl: string; platformKey: string; timeoutMs?: number; imageWriteTimeoutMs?: number }, mediaRefs: EngineMediaRefs) {
    super(options, mediaRefs);
  }
}
