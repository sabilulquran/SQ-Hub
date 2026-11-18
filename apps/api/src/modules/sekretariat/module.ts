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
import { SekretariatCrypto } from "./crypto.js";
import { SekretariatKotak } from "./kotak.js";
import { ImapMailFetcher, probeImapMailbox } from "./mail-imap.js";
import { LogMailFetcher, SekretariatMail, type MailFetcher } from "./mail.js";
import { classifyMailboxFailure, SekretariatMailbox, type MailboxProbe } from "./mailbox.js";
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
  mailbox: SekretariatMailbox;
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
  mailboxProbe?: MailboxProbe;
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
  // SEK-IMPL-002: without SEKRETARIAT_DATA_KEYS there is no safe place for a password, so the
  // screen says so and the env path (M-5) keeps working untouched.
  const mailbox = new SekretariatMailbox(
    pool,
    config.dataKeys ? new SekretariatCrypto(config.dataKeys) : null,
    input.mailboxProbe ?? probeImapMailbox,
  );
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
    mailbox,
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
        mailbox,
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
        // M-6: the list is read every round, so adding or parking a mailbox needs no restart.
        // M-5: an empty table means the env still decides, which is how R1 is running today.
        const runtimes = await mailbox.aktif();
        // M-5 is about an empty TABLE. With rows that are merely deactivated or parked, falling
        // back to the env would quietly resume pulling mail the admin just switched off.
        const kosong = runtimes.length === 0 && (await mailbox.jumlah()) === 0;
        let baru = 0;
        let gagal: boolean;
        if (kosong) {
          const result = await mail.runOnce();
          baru = result.baru;
          gagal = result.gagal;
        } else {
          let gagalCount = 0;
          for (const runtime of runtimes) {
            // M-7: each mailbox stands alone; one refusal must not silence the others.
            const result = await mail.runFor(
              new ImapMailFetcher({ host: runtime.host, port: runtime.port, user: runtime.pengguna, pass: runtime.sandi }),
              runtime.kotakId,
              runtime.alamat,
              runtime.id,
            );
            baru += result.baru;
            if (result.gagal) {
              gagalCount += 1;
              await mailbox.catatGagal(runtime.id, classifyMailboxFailure(result.error));
            } else {
              await mailbox.catatSukses(runtime.id);
            }
          }
          gagal = runtimes.length > 0 && gagalCount === runtimes.length;
        }
        backoffRounds = gagal ? Math.min(backoffRounds === 0 ? 1 : backoffRounds * 2, Math.ceil(3_600_000 / config.mailIntervalMs)) : 0;
        skip = backoffRounds;
        if (baru > 0) startLog({ event: "sekretariat.mail", baru }, "sekretariat mail ingested");
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
