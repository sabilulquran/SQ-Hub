import { createHmac } from "node:crypto";

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import pg from "pg";

import { loadConfig, type WaConfig } from "./config.js";
import { WaCrypto } from "./crypto.js";
import { WaEngine, type EngineStores, type WaLog } from "./engine.js";
import { registerPlatformRoutes } from "./routes/platform.js";
import { ContactStore } from "./store/contacts.js";
import { PgDeviceRegistry } from "./store/device-registry.js";
import { EventStore } from "./store/events.js";
import { IdempotencyStore } from "./store/idempotency.js";
import { MediaStore } from "./store/media.js";
import { HistoryImportStore, MessageIndex } from "./store/messages.js";
import { PhoneStateStore } from "./store/phone-state.js";

/** KIRIM-IMPL-005 §2: the worker process. One Node process for every number, loopback only. */

const HOUSEKEEPING_INTERVAL_MS = 15 * 60 * 1000;
/** A send is given a minute by Baileys; a pending key older than this was left by a dead process. */
const STALE_IDEMPOTENCY_MINUTES = 10;

export async function startWorker(env: NodeJS.ProcessEnv = process.env): Promise<() => Promise<void>> {
  const config = loadConfig(env);
  const log: WaLog = (entry, message) => {
    if (config.logLevel === "silent") return;
    // JSON lines, and never a number, a body, a QR or a pairing code (§12).
    process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...entry, message })}\n`);
  };

  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2, application_name: "kirim-wa" });
  const crypto = new WaCrypto(config.dataKeys);
  const stores: EngineStores = {
    devices: new PgDeviceRegistry(pool, log),
    events: new EventStore(pool, crypto),
    media: new MediaStore(pool, crypto, config.mediaRoot),
    messages: new MessageIndex(pool, crypto),
    imports: new HistoryImportStore(pool),
    contacts: new ContactStore(pool, crypto),
    phoneState: new PhoneStateStore(pool, crypto, log),
  };
  const idempotency = new IdempotencyStore(pool, crypto);
  const engine = new WaEngine(config, stores, log);

  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 64 * 1024 * 1024, files: 1 } });
  await registerPlatformRoutes(app, { config, engine, stores, idempotency, log });

  await engine.start();

  // The push path (§5): a nudge so Kirim SQ pulls sooner. It is never the source of truth, so a
  // failed push is logged and forgotten; the cursor still carries the event.
  if (config.webhook) notifyOnAppend(stores, config.webhook, log);

  await app.listen({ port: config.port, host: config.host });
  log({ event: "kirim_wa.listening", port: config.port }, "kirim-wa is listening on loopback");

  const housekeeping = setInterval(() => {
    void (async () => {
      await idempotency.releaseStale(STALE_IDEMPOTENCY_MINUTES).catch(() => 0);
      await idempotency.prune(config.messageRetentionDays).catch(() => 0);
      await engine.housekeeping();
    })();
  }, HOUSEKEEPING_INTERVAL_MS);
  housekeeping.unref();

  return async () => {
    clearInterval(housekeeping);
    await app.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
  };
}

/**
 * Wraps the event store's append so each new event also pokes Kirim SQ. The signature is the one
 * `/internal/kirim/engine/jalurpesan/webhook` already checks, so one secret and one route serve
 * both engines and Kirim SQ needs no change (§5).
 */
function notifyOnAppend(stores: EngineStores, webhook: { url: string; secret: string }, log: WaLog): void {
  const append = stores.events.append.bind(stores.events);
  stores.events.append = async (input) => {
    const event = await append(input);
    void push(webhook, { eventId: event.eventId, deviceId: event.deviceId, type: event.type }, log);
    return event;
  };
}

async function push(webhook: { url: string; secret: string }, body: Record<string, unknown>, log: WaLog): Promise<void> {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = JSON.stringify(body);
    const signature = createHmac("sha256", webhook.secret).update(`${timestamp}.${payload}`).digest("hex");
    await fetch(webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jalurpesan-signature": `v1=${signature}`,
        "x-jalurpesan-timestamp": timestamp,
      },
      body: payload,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    log({ event: "kirim_wa.push.failed", errorType: error instanceof Error ? error.name : "unknown" }, "push to Kirim SQ failed; the cursor still carries the event");
  }
}

export type { WaConfig };
