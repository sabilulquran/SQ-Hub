import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { VerifyMachineToken } from "../application-access/machine-auth.js";
import type { ApplicationAccessService } from "../application-access/service.js";
import { HubOidcProvider } from "../hub-auth/oidc-provider.js";
import { PgHubAuthRepository } from "../hub-auth/repository.js";
import { HubAuthService, type HubAuthRuntime } from "../hub-auth/service.js";
import { HubTokenVault } from "../hub-auth/token-vault.js";
import { PgHubWorkspaceRepository, type HubWorkspaceApplicationSource } from "../hub-auth/workspace-repository.js";
import { KerjaDirectory, type KerjaDirectorySource } from "../kerja/directory.js";
import { assertMediaRoot, SekretariatBerkas } from "./berkas.js";
import { SekretariatBuku } from "./buku.js";
import type { SekretariatConfig } from "./config.js";
import { SekretariatKotak } from "./kotak.js";
import { LogMailFetcher, SekretariatMail, type MailFetcher } from "./mail.js";
import { SekretariatPengaturan } from "./pengaturan.js";
import { registerSekretariatInternalRoutes } from "./routes-internal.js";
import {
  registerSekretariatAuthRoutes,
  registerSekretariatRoutes,
  SEKRETARIAT_OIDC_TRANSACTION_COOKIE_NAME,
  SEKRETARIAT_SESSION_COOKIE_NAME,
} from "./routes.js";
import { SekretariatSurat } from "./surat.js";

export type SekretariatLog = (entry: Record<string, unknown>, message: string) => void;

/**
 * Wires the Sekretariat module (SEK-IMPL-001, the ADR-0011 pattern). It imports only auth,
 * Application Access and the Organization Directory reader, so it can be extracted later. No new
 * process: the mail fetcher and the daily file purge are timers in the API process.
 */
export interface SekretariatModule {
  buku: SekretariatBuku;
  surat: SekretariatSurat;
  kotak: SekretariatKotak;
  berkas: SekretariatBerkas;
  pengaturan: SekretariatPengaturan;
  mail: SekretariatMail;
  register(app: FastifyInstance): void;
  start(log: SekretariatLog): Promise<() => Promise<void>>;
}

export function createSekretariatModule(input: {
  pool: Pool;
  config: SekretariatConfig;
  keycloakIssuer: string;
  access: Pick<ApplicationAccessService, "checkAccess">;
  directorySource: KerjaDirectorySource;
  /** Verifies service-account tokens on /internal/sekretariat; absent = no machine route. */
  verifyMachineToken?: VerifyMachineToken;
  workspaceApplications?: HubWorkspaceApplicationSource;
  hubOrigin?: string;
  secureCookies?: boolean;
  /** Test seams. */
  auth?: HubAuthRuntime;
  mailFetcher?: MailFetcher;
  now?: () => Date;
  freeBytes?: (path: string) => Promise<number>;
  log?: SekretariatLog;
}): SekretariatModule {
  const { pool, config } = input;
  const log: SekretariatLog = (entry, message) => input.log?.(entry, message);
  const directory = new KerjaDirectory(input.directorySource, input.now);
  const berkas = new SekretariatBerkas(pool, {
    mediaRoot: config.mediaRoot,
    maxUploadBytes: config.maxUploadBytes,
    minFreeDiskBytes: config.minFreeDiskBytes,
    ...(input.freeBytes ? { freeBytes: input.freeBytes } : {}),
  });
  const buku = new SekretariatBuku(pool, input.now ?? (() => new Date()));
  const surat = new SekretariatSurat(pool, buku, berkas);
  const kotak = new SekretariatKotak(pool, berkas);
  const pengaturan = new SekretariatPengaturan(pool);
  const fetcher = input.mailFetcher ?? new LogMailFetcher();
  const mail = new SekretariatMail(pool, fetcher, berkas, config.maxUploadBytes, log);
  const workspaceApplications = input.workspaceApplications ?? new PgHubWorkspaceRepository(pool);

  const auth = input.auth ?? new HubAuthService(
    new PgHubAuthRepository(pool),
    new HubOidcProvider({
      issuer: input.keycloakIssuer,
      clientId: config.oidc.clientId,
      clientSecret: config.oidc.clientSecret,
      redirectUri: `${config.publicOrigin}/api/auth/callback`,
      postLogoutRedirectUri: `${config.publicOrigin}/`,
    }),
    workspaceApplications,
    {
      sessionIdleHours: 8,
      sessionMaxHours: 12,
      transactionTtlMinutes: 10,
      secureCookies: input.secureCookies ?? true,
      cookieNames: { session: SEKRETARIAT_SESSION_COOKIE_NAME, transaction: SEKRETARIAT_OIDC_TRANSACTION_COOKIE_NAME },
    },
    new HubTokenVault(config.oidc.clientSecret),
  );

  return {
    buku,
    surat,
    kotak,
    berkas,
    pengaturan,
    mail,
    register(app) {
      registerSekretariatAuthRoutes(app, { auth, publicOrigin: config.publicOrigin });
      registerSekretariatRoutes(app, {
        pool,
        auth,
        access: input.access,
        directory,
        buku,
        surat,
        kotak,
        berkas,
        pengaturan,
        mail,
        publicOrigin: config.publicOrigin,
        launcher: { applications: workspaceApplications, ...(input.hubOrigin ? { hubOrigin: input.hubOrigin } : {}) },
        log,
      });
      // §14 langkah 9: present only when the allowlist is set (server.ts builds the verifier).
      if (input.verifyMachineToken) {
        registerSekretariatInternalRoutes(app, { buku, verifyMachineToken: input.verifyMachineToken, log });
      }
    },
    async start(startLog) {
      await assertMediaRoot(config.mediaRoot);
      // §7 nomor 5: a failing round backs off up to an hour and never stops the module.
      let backoffRounds = 0;
      let skip = 0;
      const mailTick = async () => {
        if (skip > 0) {
          skip -= 1;
          return;
        }
        const result = await mail.runOnce();
        const state = await mail.status();
        const failing = state.items.some((item) => item.galatTerakhir !== null);
        backoffRounds = failing ? Math.min(backoffRounds === 0 ? 1 : backoffRounds * 2, Math.ceil(3_600_000 / config.mailIntervalMs)) : 0;
        skip = backoffRounds;
        if (result.baru > 0) startLog({ event: "sekretariat.mail", baru: result.baru }, "sekretariat mail ingested");
      };
      const daily = async () => {
        const dibuang = await berkas.purgeDeleted();
        if (dibuang > 0) startLog({ event: "sekretariat.berkas_dibuang", dibuang }, "sekretariat deleted files purged");
      };
      const timers = [loop(mailTick, config.mailIntervalMs, startLog, "sekretariat.mail"), loop(daily, 6 * 3_600_000, startLog, "sekretariat.daily")];
      return async () => {
        await Promise.all(timers.map((stop) => stop()));
      };
    },
  };
}

/** One round at a time per loop; a failed round is logged without content and retried next tick. */
function loop(run: () => Promise<unknown>, intervalMs: number, log: SekretariatLog, name: string): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (stopped || running) return;
    running = run()
      .then(() => undefined)
      .catch((error: unknown) => log({ event: `${name}.failed`, errorType: error instanceof Error ? error.name : "unknown" }, "sekretariat round failed"))
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
