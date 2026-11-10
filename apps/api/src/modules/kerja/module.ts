import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { ApplicationAccessService } from "../application-access/service.js";
import { HubOidcProvider } from "../hub-auth/oidc-provider.js";
import { PgHubAuthRepository } from "../hub-auth/repository.js";
import { HubAuthService, type HubAuthRuntime } from "../hub-auth/service.js";
import { HubTokenVault } from "../hub-auth/token-vault.js";
import { PgHubWorkspaceRepository, type HubWorkspaceApplicationSource } from "../hub-auth/workspace-repository.js";
import { KerjaSearch } from "./cari.js";
import type { KerjaConfig } from "./config.js";
import { KerjaDirectory, type KerjaDirectorySource } from "./directory.js";
import { KerjaCards } from "./kartu.js";
import { assertMediaRoot, KerjaAttachments } from "./lampiran.js";
import { KerjaBoards } from "./papan.js";
import { KerjaReminders } from "./pengingat.js";
import { jakartaDate, jakartaHour, KerjaRooms } from "./ruang.js";
import { KERJA_OIDC_TRANSACTION_COOKIE_NAME, KERJA_SESSION_COOKIE_NAME, registerKerjaAuthRoutes, registerKerjaRoutes } from "./routes.js";

export type KerjaLog = (entry: Record<string, unknown>, message: string) => void;

/**
 * Wires the Kerja SQ module (KERJA-IMPL-001, ADR-0011 pattern). It imports only auth, Application
 * Access and the Organization Directory reader from the rest of SQ Hub, so it can be extracted
 * later. No new process: the reminder worker and the daily jobs are timers in the API process.
 */
export interface KerjaModule {
  rooms: KerjaRooms;
  boards: KerjaBoards;
  cards: KerjaCards;
  attachments: KerjaAttachments;
  search: KerjaSearch;
  reminders: KerjaReminders;
  directory: KerjaDirectory;
  register(app: FastifyInstance): void;
  runDaily(now?: Date): Promise<{ usulan: number | null; ruangBerakhir: number; berkasDibuang: number }>;
  start(log: KerjaLog): Promise<() => Promise<void>>;
}

export function createKerjaModule(input: {
  pool: Pool;
  config: KerjaConfig;
  keycloakIssuer: string;
  access: Pick<ApplicationAccessService, "checkAccess">;
  directorySource: KerjaDirectorySource;
  workspaceApplications?: HubWorkspaceApplicationSource;
  hubOrigin?: string;
  secureCookies?: boolean;
  /** Test seams. */
  auth?: HubAuthRuntime;
  now?: () => Date;
  freeBytes?: (path: string) => Promise<number>;
  log?: KerjaLog;
}): KerjaModule {
  const { pool, config } = input;
  const log: KerjaLog = (entry, message) => input.log?.(entry, message);
  const directory = new KerjaDirectory(input.directorySource, input.now);
  const rooms = new KerjaRooms(pool, directory, { roomQuotaBytes: config.roomQuotaBytes, ...(input.now ? { now: input.now } : {}) });
  const attachments = new KerjaAttachments(pool, directory, {
    mediaRoot: config.mediaRoot,
    maxUploadBytes: config.maxUploadBytes,
    roomQuotaBytes: config.roomQuotaBytes,
    minFreeDiskBytes: config.minFreeDiskBytes,
    ...(input.freeBytes ? { freeBytes: input.freeBytes } : {}),
  });
  const boards = new KerjaBoards(pool, directory, attachments);
  const cards = new KerjaCards(pool, directory);
  let searchConfig: string | null = null;
  const search = new KerjaSearch(pool, directory, async () => {
    if (!searchConfig) {
      const row = (await pool.query<{ cfg: string }>("SELECT nilai->>'konfigurasi' AS cfg FROM kerja_status WHERE kunci = 'pencarian'")).rows[0];
      searchConfig = row?.cfg === "indonesian" ? "indonesian" : "simple";
    }
    return searchConfig;
  });
  const reminders = new KerjaReminders(pool);
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
      cookieNames: { session: KERJA_SESSION_COOKIE_NAME, transaction: KERJA_OIDC_TRANSACTION_COOKIE_NAME },
    },
    new HubTokenVault(config.oidc.clientSecret),
  );

  async function runDaily(now: Date = input.now?.() ?? new Date()) {
    const comparison = await rooms.compareWithDirectory();
    if (comparison.skipped) log({ event: "kerja.directory_compare.skipped", reason: comparison.skipped }, "kerja directory comparison skipped");
    const ruangBerakhir = await rooms.expireCommittees();
    const berkasDibuang = await attachments.purgeDeleted();
    await removeStaleTemporaryFiles(config.mediaRoot, now);
    await pool.query(
      `INSERT INTO kerja_status (kunci, nilai) VALUES ('harian', $1) ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, diperbarui_pada = now()`,
      [JSON.stringify({ tanggal: jakartaDate(now) })],
    );
    return { usulan: comparison.skipped ? null : comparison.created, ruangBerakhir, berkasDibuang };
  }

  return {
    rooms,
    boards,
    cards,
    attachments,
    search,
    reminders,
    directory,
    runDaily,
    register(app) {
      registerKerjaAuthRoutes(app, { auth, publicOrigin: config.publicOrigin });
      registerKerjaRoutes(app, {
        pool,
        auth,
        access: input.access,
        directory,
        rooms,
        boards,
        cards,
        attachments,
        search,
        publicOrigin: config.publicOrigin,
        launcher: { applications: workspaceApplications, ...(input.hubOrigin ? { hubOrigin: input.hubOrigin } : {}) },
        log,
      });
    },
    async start(startLog) {
      // Refuse to start without a writable media root instead of failing on the first upload.
      await assertMediaRoot(config.mediaRoot);
      const daily = async () => {
        const now = input.now?.() ?? new Date();
        if (jakartaHour(now) < config.directorySyncHour) return;
        const last = (await pool.query<{ tanggal: string }>("SELECT nilai->>'tanggal' AS tanggal FROM kerja_status WHERE kunci = 'harian'")).rows[0]?.tanggal;
        if (last === jakartaDate(now)) return;
        const result = await runDaily(now);
        startLog({ event: "kerja.daily", ...result }, "kerja daily jobs ran");
      };
      const timers = [
        loop(async () => {
          const sent = await reminders.runOnce(input.now?.() ?? new Date());
          if (sent > 0) startLog({ event: "kerja.reminders", sent }, "kerja reminders sent");
        }, config.reminderIntervalMs, startLog, "kerja.reminders"),
        loop(daily, 600_000, startLog, "kerja.daily"),
      ];
      return async () => {
        await Promise.all(timers.map((stop) => stop()));
      };
    },
  };
}

/** Temporary upload files older than a day belong to interrupted uploads. */
async function removeStaleTemporaryFiles(mediaRoot: string, now: Date) {
  const dir = join(mediaRoot, ".tmp");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info && now.getTime() - info.mtimeMs > 86_400_000) await rm(path, { force: true });
  }
}

/** One round at a time per loop; a failed round is logged without content and retried next tick. */
function loop(run: () => Promise<unknown>, intervalMs: number, log: KerjaLog, name: string): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (stopped || running) return;
    const started = performance.now();
    running = run()
      .then(() => {
        const durationMs = Math.round(performance.now() - started);
        // §13 gate: p95 of a reminder round under 200 ms.
        if (durationMs > 200) log({ event: `${name}.slow`, durationMs }, "kerja round slower than 200 ms");
      })
      .catch((error: unknown) => log({ event: `${name}.failed`, errorType: error instanceof Error ? error.name : "unknown" }, "kerja round failed"))
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
