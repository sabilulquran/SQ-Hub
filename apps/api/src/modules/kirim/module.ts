import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import { createKeycloakMachineTokenVerifier, type VerifyMachineToken } from "../application-access/machine-auth.js";
import type { ApplicationAccessService } from "../application-access/service.js";
import { HubOidcProvider } from "../hub-auth/oidc-provider.js";
import { PgHubAuthRepository } from "../hub-auth/repository.js";
import { HubAuthService, type HubAuthRuntime } from "../hub-auth/service.js";
import { HubTokenVault } from "../hub-auth/token-vault.js";
import { PgHubWorkspaceRepository, type HubWorkspaceApplicationSource } from "../hub-auth/workspace-repository.js";
import { KirimAdminService } from "./admin.js";
import type { KirimConfig } from "./config.js";
import { KirimConversations } from "./conversations.js";
import { KirimHistoryImport } from "./history-import.js";
import { KirimCrypto } from "./crypto.js";
import { KirimIngest } from "./ingest.js";
import { JalurPesanProvider, type EngineMediaRefs } from "./providers/jalurpesan.js";
import { LogProvider, type KirimLog } from "./providers/log.js";
import type { KirimProvider, ProviderName } from "./providers/types.js";
import {
  KIRIM_OIDC_TRANSACTION_COOKIE_NAME,
  KIRIM_SESSION_COOKIE_NAME,
  registerKirimAdminRoutes,
  registerKirimAuthRoutes,
} from "./routes-admin.js";
import { registerKirimInternalRoutes } from "./routes-internal.js";
import { KirimService, verifyKeyCanaries } from "./service.js";
import { KirimWebhookSender, type WebhookTransport } from "./webhooks.js";
import { KirimSendWorker } from "./worker.js";

/**
 * Wires the Kirim SQ module (ADR-0011). It imports only auth (hub-auth, machine-auth) and
 * Application Access from the rest of SQ Hub, so it can be extracted later. No new process:
 * the send worker, webhook sender and event puller are timers in the API process.
 */
export interface KirimModule {
  crypto: KirimCrypto;
  service: KirimService;
  conversations: KirimConversations;
  history: KirimHistoryImport;
  admin: KirimAdminService;
  worker: KirimSendWorker;
  webhooks: KirimWebhookSender;
  ingest?: KirimIngest;
  register(app: FastifyInstance): void;
  start(log: KirimLog): Promise<() => Promise<void>>;
}

export function pgEngineMediaRefs(pool: Pool): EngineMediaRefs {
  return {
    async get(mediaId, deviceId) {
      const result = await pool.query<{ ref: string }>(
        `SELECT provider_media_id AS ref FROM kirim_media_engine_refs WHERE media_id = $1 AND device_id = $2 AND provider = 'jalurpesan'`,
        [mediaId, deviceId],
      );
      return result.rows[0]?.ref ?? null;
    },
    async put(mediaId, deviceId, providerMediaId) {
      await pool.query(
        `INSERT INTO kirim_media_engine_refs (media_id, device_id, provider, provider_media_id) VALUES ($1, $2, 'jalurpesan', $3)
         ON CONFLICT (media_id, device_id, provider) DO UPDATE SET provider_media_id = EXCLUDED.provider_media_id, created_at = now()`,
        [mediaId, deviceId, providerMediaId],
      );
    },
    async remove(mediaId, deviceId) {
      await pool.query("DELETE FROM kirim_media_engine_refs WHERE media_id = $1 AND device_id = $2 AND provider = 'jalurpesan'", [mediaId, deviceId]);
    },
  };
}

export function createKirimModule(input: {
  pool: Pool;
  config: KirimConfig;
  keycloakIssuer: string;
  access: Pick<ApplicationAccessService, "checkAccess">;
  /** HUB-IMPL-022: the header launcher list; defaults to the Hub workspace rows in the same database. */
  workspaceApplications?: HubWorkspaceApplicationSource;
  /** Hub public origin, so a registry row for SQ Hub itself never shows twice in the launcher. */
  hubOrigin?: string;
  secureCookies?: boolean;
  /** Test seams; production uses Keycloak, the OIDC client and fetch. */
  verifyMachineToken?: VerifyMachineToken;
  adminAuth?: HubAuthRuntime;
  webhookTransport?: WebhookTransport;
  providers?: Partial<Record<ProviderName, KirimProvider>>;
  log?: KirimLog;
}): KirimModule {
  const { pool, config } = input;
  const crypto = new KirimCrypto(config.dataKeys, config.lookupKey);
  const service = new KirimService(pool, crypto, config.mediaRoot);
  const log: KirimLog = (entry, message) => input.log?.(entry, message);
  const providers: Record<ProviderName, KirimProvider | undefined> = {
    log: input.providers?.log ?? new LogProvider(log),
    jalurpesan: input.providers?.jalurpesan ?? (config.jalurpesan ? new JalurPesanProvider(config.jalurpesan, pgEngineMediaRefs(pool)) : undefined),
  };
  const ingest = providers.jalurpesan
    ? new KirimIngest(pool, crypto, service, providers.jalurpesan, { inboundMediaMaxBytes: config.inboundMediaMaxBytes, log })
    : undefined;
  const admin = new KirimAdminService(pool, crypto, service, providers, ingest);
  const history = new KirimHistoryImport(pool, crypto, service, providers, {
    enabled: config.historyImportEnabled ?? false,
    inboundMediaMaxBytes: config.inboundMediaMaxBytes,
    log,
  });
  const conversations = new KirimConversations(pool, crypto, service, providers, {
    ...(config.replyDefaultTtlHours ? { replyTtlHours: config.replyDefaultTtlHours } : {}),
    log,
  });
  const worker = new KirimSendWorker(pool, crypto, service, providers, { log });
  const webhooks = new KirimWebhookSender(pool, crypto, { ...(input.webhookTransport ? { transport: input.webhookTransport } : {}), log });

  const workspaceApplications = input.workspaceApplications ?? new PgHubWorkspaceRepository(pool);

  const verifyMachineToken = input.verifyMachineToken ?? createKeycloakMachineTokenVerifier({
    issuer: input.keycloakIssuer,
    audience: config.tokenAudience,
    allowedClients: "any",
  });

  const adminAuth = input.adminAuth ?? (config.admin
    ? new HubAuthService(
        new PgHubAuthRepository(pool),
        new HubOidcProvider({
          issuer: input.keycloakIssuer,
          clientId: config.admin.clientId,
          clientSecret: config.admin.clientSecret,
          redirectUri: `${config.admin.publicOrigin}/api/auth/callback`,
          postLogoutRedirectUri: `${config.admin.publicOrigin}/`,
        }),
        workspaceApplications,
        {
          sessionIdleHours: 8,
          sessionMaxHours: 12,
          transactionTtlMinutes: 10,
          secureCookies: input.secureCookies ?? true,
          cookieNames: { session: KIRIM_SESSION_COOKIE_NAME, transaction: KIRIM_OIDC_TRANSACTION_COOKIE_NAME },
        },
        new HubTokenVault(config.admin.clientSecret),
      )
    : undefined);

  return {
    crypto,
    service,
    conversations,
    history,
    admin,
    worker,
    webhooks,
    ...(ingest ? { ingest } : {}),
    register(app) {
      registerKirimInternalRoutes(app, {
        service,
        conversations,
        verifyMachineToken,
        ...(ingest ? { ingest } : {}),
        jalurpesanWebhookSecret: config.jalurpesan?.webhookSecret ?? null,
        log,
      });
      if (adminAuth && config.admin) {
        registerKirimAuthRoutes(app, { auth: adminAuth, publicOrigin: config.admin.publicOrigin });
        registerKirimAdminRoutes(app, {
          auth: adminAuth,
          access: input.access,
          admin,
          history,
          publicOrigin: config.admin.publicOrigin,
          launcher: { applications: workspaceApplications, ...(input.hubOrigin ? { hubOrigin: input.hubOrigin } : {}) },
        });
      }
    },
    async start(startLog) {
      await verifyKeyCanaries(pool, crypto);
      const timers = [
        loop(() => worker.runOnce(), config.workerIntervalMs, startLog, "kirim.worker"),
        loop(() => webhooks.runOnce(), config.workerIntervalMs, startLog, "kirim.webhooks"),
        ...(ingest
          ? [
              loop(() => ingest.runOnce(), config.eventPullIntervalMs, startLog, "kirim.ingest"),
              loop(() => ingest.refreshDirectory("groups"), config.groupRefreshIntervalMs ?? 900_000, startLog, "kirim.groups"),
              loop(() => ingest.refreshDirectory("contacts"), config.contactRefreshIntervalMs ?? 21_600_000, startLog, "kirim.contacts"),
            ]
          : []),
        ...(config.historyImportEnabled ? [loop(() => history.runOnce(), 10_000, startLog, "kirim.history")] : []),
      ];
      return async () => {
        await Promise.all(timers.map((stop) => stop()));
      };
    },
  };
}

/** One round at a time per loop; a failed round is logged without content and retried next tick. */
function loop(run: () => Promise<unknown>, intervalMs: number, log: KirimLog, name: string): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (stopped || running) return;
    const started = performance.now();
    running = run()
      .then(() => {
        const durationMs = Math.round(performance.now() - started);
        if (durationMs > 200) log({ event: `${name}.slow`, durationMs }, "kirim round slower than 200 ms");
      })
      .catch((error: unknown) => log({ event: `${name}.failed`, errorType: error instanceof Error ? error.name : "unknown" }, "kirim round failed"))
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
