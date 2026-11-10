import { createHash } from "node:crypto";

import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import { listLauncherApplications } from "../application-access/launcher.js";
import type { ApplicationAccessService } from "../application-access/service.js";
import { HubAuthError, readCookie, type HubAuthRuntime } from "../hub-auth/service.js";
import type { HubWorkspaceApplicationSource } from "../hub-auth/workspace-repository.js";
import type { Viewer } from "./access.js";
import { searchQuerySchema, type KerjaSearch } from "./cari.js";
import { KerjaError } from "./db.js";
import type { KerjaDirectory } from "./directory.js";
import { checklistSchema, commentSchema, commentUpdateSchema, itemCreateSchema, itemUpdateSchema, type KerjaCards } from "./kartu.js";
import type { KerjaAttachments, OwnerKind } from "./lampiran.js";
import {
  boardSchema, cardCreateSchema, cardUpdateSchema, closeSchema, columnSchema, columnUpdateSchema, copySchema, labelSchema,
  labelsSchema, labelUpdateSchema, moveSchema, peopleSchema, tasksQuerySchema, type KerjaBoards,
} from "./papan.js";
import {
  adminRoomSchema, candidateQuerySchema, createRoomSchema, memberSchema, memberUpdateSchema, reasonSchema, updateRoomSchema, type KerjaRooms,
} from "./ruang.js";

/** KERJA-IMPL-001 §2: browser paths `/api/kerja/*` and `/api/admin/kerja/*`; the edge strips `/api`. */
export const KERJA_PREFIX = "/kerja";
export const KERJA_ADMIN_PREFIX = "/admin/kerja";
export const KERJA_APPLICATION_KEY = "kerja-sq";
export const KERJA_SESSION_COOKIE_NAME = "sq_kerja_session";
export const KERJA_OIDC_TRANSACTION_COOKIE_NAME = "sq_kerja_oidc_tx";

export interface KerjaRouteDeps {
  pool: Pool;
  auth: HubAuthRuntime;
  access: Pick<ApplicationAccessService, "checkAccess">;
  directory: KerjaDirectory;
  rooms: KerjaRooms;
  boards: KerjaBoards;
  cards: KerjaCards;
  attachments: KerjaAttachments;
  search: KerjaSearch;
  publicOrigin: string;
  launcher?: { applications: HubWorkspaceApplicationSource; hubOrigin?: string };
  log?: (entry: Record<string, unknown>, message: string) => void;
}

interface SessionContext {
  identity: { issuer: string; subject: string };
  displayName: string;
}

export function sendKerjaError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).header("Cache-Control", "no-store").send({ error: code, message });
}

export async function isKerjaAdmin(pool: Pool, identity: { issuer: string; subject: string }): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM kerja_admins WHERE identity_issuer = $1 AND identity_subject = $2 AND revoked_at IS NULL",
    [identity.issuer.replace(/\/$/, ""), identity.subject],
  );
  return (result.rowCount ?? 0) > 0;
}

export function registerKerjaRoutes(app: FastifyInstance, deps: KerjaRouteDeps) {
  async function session(request: FastifyRequest): Promise<SessionContext> {
    let record;
    try {
      record = await deps.auth.getSession(readCookie(request.headers.cookie, KERJA_SESSION_COOKIE_NAME));
    } catch (error) {
      if (error instanceof HubAuthError) throw new KerjaError(401, "unauthenticated", "Sesi Kerja tidak ada atau sudah berakhir.");
      throw error;
    }
    const identity = { issuer: record.issuer, subject: record.subject };
    // KERJA-IMPL-001 §7.2: Application Access `kerja-sq` first; any failure is a refusal.
    const access = await deps.access.checkAccess(identity, KERJA_APPLICATION_KEY);
    if (!access.allowed) throw new KerjaError(403, "kerja_access_denied", "Anda belum punya akses aplikasi Kerja.");
    return { identity, displayName: record.displayName };
  }

  async function viewer(request: FastifyRequest, mutation: boolean): Promise<Viewer> {
    const context = await session(request);
    if (mutation && request.headers.origin !== deps.publicOrigin) {
      throw new KerjaError(403, "origin_forbidden", "Permintaan harus dari halaman Kerja.");
    }
    const view = await deps.directory.view();
    if (!view) throw new KerjaError(503, "directory_belum_tersedia", "Organization Directory belum tersedia.");
    const person = view.personByIdentity(context.identity);
    if (!person || !person.aktif) {
      throw new KerjaError(403, "orang_belum_tercatat", "Akun Anda belum tercatat sebagai pegawai aktif di Organization Directory. Hubungi HCM.");
    }
    return { personId: person.id, actor: person.id, nama: person.nama };
  }

  async function admin(request: FastifyRequest, mutation: boolean): Promise<{ actor: string; displayName: string }> {
    const context = await session(request);
    if (!(await isKerjaAdmin(deps.pool, context.identity))) {
      throw new KerjaError(403, "kerja_admin_required", "Anda belum ditetapkan sebagai pengelola Kerja.");
    }
    if (mutation && request.headers.origin !== deps.publicOrigin) {
      throw new KerjaError(403, "origin_forbidden", "Permintaan harus dari halaman Kerja.");
    }
    const person = (await deps.directory.view())?.personByIdentity(context.identity);
    const actor = person ? person.id : `staff:${createHash("sha256").update(`${context.identity.issuer}\n${context.identity.subject}`).digest("hex")}`;
    return { actor, displayName: context.displayName };
  }

  function fail(reply: FastifyReply, error: unknown) {
    if (error instanceof KerjaError) return sendKerjaError(reply, error.statusCode, error.code, error.message);
    if (error instanceof z.ZodError) {
      return reply.status(400).header("Cache-Control", "no-store").send({
        error: "tidak_sah", message: "Isian tidak sah.", fields: error.issues.map((issue) => issue.path.join(".")),
      });
    }
    // Never the error text: it can carry SQL or card content (§10 nomor 5).
    deps.log?.({ event: "kerja.request_failed", errorType: error instanceof Error ? error.name : "unknown", code: (error as { code?: unknown }).code }, "kerja request failed");
    return sendKerjaError(reply, 503, "kerja_unavailable", "Kerja sedang tidak tersedia.");
  }

  const params = (request: FastifyRequest) => request.params as Record<string, string>;
  const adminPjSchema = z.object({ person_id: z.string().regex(/^hcis:employee:[0-9a-f-]{36}$/), alasan: z.string().trim().min(1).max(500) }).strict();
  const body = (request: FastifyRequest) => request.body ?? {};

  function get<T>(path: string, handler: (request: FastifyRequest, viewer: Viewer) => Promise<T>) {
    app.get(`${KERJA_PREFIX}${path}`, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return reply.send(await handler(request, await viewer(request, false)));
      } catch (error) {
        return fail(reply, error);
      }
    });
  }

  function write<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, handler: (request: FastifyRequest, viewer: Viewer) => Promise<T>, status = 200) {
    app.route({
      method,
      url: `${KERJA_PREFIX}${path}`,
      handler: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          return reply.status(status).send(await handler(request, await viewer(request, true)));
        } catch (error) {
          return fail(reply, error);
        }
      },
    });
  }

  // ---- context, launcher, notifications ----

  app.get(`${KERJA_PREFIX}/context`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const context = await session(request);
      const view = await deps.directory.view();
      const person = view?.personByIdentity(context.identity) ?? null;
      return reply.send({
        displayName: context.displayName,
        orang: person && person.aktif ? { id: person.id, nama: person.nama } : null,
        directoryTersedia: view !== null,
        pengelola: await isKerjaAdmin(deps.pool, context.identity),
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  const launcher = deps.launcher;
  if (launcher) {
    // HUB-IMPL-022 §5, as in Kirim SQ: the signed-in person's own applications; a failed read
    // falls back to the Kerja tile only.
    app.get(`${KERJA_PREFIX}/launcher`, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      let identity;
      try {
        const record = await deps.auth.getSession(readCookie(request.headers.cookie, KERJA_SESSION_COOKIE_NAME));
        identity = { issuer: record.issuer, subject: record.subject };
      } catch (error) {
        if (error instanceof HubAuthError) return sendKerjaError(reply, 401, "unauthenticated", "Sesi Kerja tidak ada atau sudah berakhir.");
        return reply.send({ applications: null, unavailable: true });
      }
      try {
        return reply.send({ applications: await listLauncherApplications(launcher.applications, identity, launcher.hubOrigin) });
      } catch {
        return reply.send({ applications: null, unavailable: true });
      }
    });
  }

  get("/tugas-saya", (request, v) => deps.boards.myTasks(v, tasksQuerySchema.parse(request.query)));
  get("/notifikasi", (_request, v) => deps.boards.notifications(v));
  write("POST", "/notifikasi/dibaca", (_request, v) => deps.boards.markRead(v, "semua"));
  write("POST", "/notifikasi/:id/dibaca", (request, v) => deps.boards.markRead(v, z.string().uuid().parse(params(request).id)));

  // ---- rooms and members ----

  get("/ruang", (_request, v) => deps.rooms.listMine(v));
  get("/ruang/:id", (request, v) => deps.rooms.get(v, params(request).id!));
  write("PATCH", "/ruang/:id", (request, v) => deps.rooms.update(v, params(request).id!, updateRoomSchema.parse(body(request))));
  write("POST", "/ruang/:id/anggota", (request, v) => deps.rooms.addMember(v, params(request).id!, memberSchema.parse(body(request))), 201);
  write("PATCH", "/ruang/:id/anggota/:person", (request, v) => deps.rooms.updateMember(v, params(request).id!, params(request).person!, memberUpdateSchema.parse(body(request))));
  write("DELETE", "/ruang/:id/anggota/:person", (request, v) => deps.rooms.removeMember(v, params(request).id!, params(request).person!, reasonSchema.parse(body(request))));
  get("/ruang/:id/calon", (request, v) => deps.rooms.candidates(v, params(request).id!, candidateQuerySchema.parse(request.query)));
  get("/ruang/:id/usulan", (request, v) => deps.rooms.proposals(v, params(request).id!));
  write("POST", "/usulan/:id/terima", (request, v) => deps.rooms.actOnProposal(v, z.string().uuid().parse(params(request).id), true, reasonSchema.parse(body(request))));
  write("POST", "/usulan/:id/tolak", (request, v) => deps.rooms.actOnProposal(v, z.string().uuid().parse(params(request).id), false, reasonSchema.parse(body(request))));
  get("/ruang/:id/yatim", (request, v) => deps.rooms.orphans(v, params(request).id!));
  get("/ruang/:id/arsip", (request, v) => deps.boards.archive(v, params(request).id!));
  get("/ruang/:id/berkas", (request, v) => deps.attachments.roomFiles(v, params(request).id!));
  get("/ruang/:id/cari", (request, v) => deps.search.search(v, params(request).id!, searchQuerySchema.parse(request.query)));
  write("POST", "/ruang/:id/papan", (request, v) => deps.boards.createBoard(v, params(request).id!, boardSchema.parse(body(request))), 201);

  // ---- boards, columns, labels ----

  get("/papan/:id", (request, v) => deps.boards.board(v, params(request).id!));
  write("PATCH", "/papan/:id", (request, v) => deps.boards.renameBoard(v, params(request).id!, boardSchema.parse(body(request))));
  write("POST", "/papan/:id/kolom", (request, v) => deps.boards.createColumn(v, params(request).id!, columnSchema.parse(body(request))), 201);
  write("PATCH", "/kolom/:id", (request, v) => deps.boards.updateColumn(v, params(request).id!, columnUpdateSchema.parse(body(request))));
  write("DELETE", "/kolom/:id", (request, v) => deps.boards.deleteColumn(v, params(request).id!));
  write("POST", "/papan/:id/label", (request, v) => deps.boards.createLabel(v, params(request).id!, labelSchema.parse(body(request))), 201);
  write("PATCH", "/label/:id", (request, v) => deps.boards.updateLabel(v, params(request).id!, labelUpdateSchema.parse(body(request))));
  write("DELETE", "/label/:id", (request, v) => deps.boards.deleteLabel(v, params(request).id!));

  // ---- cards ----

  write("POST", "/kolom/:id/kartu", (request, v) => deps.boards.createCard(v, params(request).id!, cardCreateSchema.parse(body(request))), 201);
  get("/kartu/:id", (request, v) => deps.cards.detail(v, params(request).id!));
  write("PATCH", "/kartu/:id", (request, v) => deps.boards.updateCard(v, params(request).id!, cardUpdateSchema.parse(body(request))));
  write("POST", "/kartu/:id/pindah", (request, v) => deps.boards.move(v, params(request).id!, moveSchema.parse(body(request))));
  write("POST", "/kartu/:id/tutup", (request, v) => deps.boards.close(v, params(request).id!, closeSchema.parse(body(request))));
  write("POST", "/kartu/:id/buka", (request, v) => deps.boards.reopen(v, params(request).id!));
  write("POST", "/kartu/:id/arsip", (request, v) => deps.boards.setArchived(v, params(request).id!, true));
  write("POST", "/kartu/:id/pulihkan", (request, v) => deps.boards.setArchived(v, params(request).id!, false));
  write("PUT", "/kartu/:id/orang", (request, v) => deps.boards.setPeople(v, params(request).id!, peopleSchema.parse(body(request))));
  write("PUT", "/kartu/:id/label", (request, v) => deps.boards.setLabels(v, params(request).id!, labelsSchema.parse(body(request))));
  write("POST", "/kartu/:id/salin", (request, v) => deps.boards.copy(v, params(request).id!, copySchema.parse(body(request))), 201);
  write("POST", "/kartu/:id/ceklis", (request, v) => deps.cards.createChecklist(v, params(request).id!, checklistSchema.parse(body(request))), 201);
  write("PATCH", "/ceklis/:id", (request, v) => deps.cards.updateChecklist(v, params(request).id!, checklistSchema.parse(body(request))));
  write("DELETE", "/ceklis/:id", (request, v) => deps.cards.deleteChecklist(v, params(request).id!));
  write("POST", "/ceklis/:id/butir", (request, v) => deps.cards.createItem(v, params(request).id!, itemCreateSchema.parse(body(request))), 201);
  write("PATCH", "/butir/:id", (request, v) => deps.cards.updateItem(v, params(request).id!, itemUpdateSchema.parse(body(request))));
  write("DELETE", "/butir/:id", (request, v) => deps.cards.deleteItem(v, params(request).id!));
  write("POST", "/kartu/:id/komentar", (request, v) => deps.cards.comment(v, params(request).id!, commentSchema.parse(body(request))), 201);
  write("PATCH", "/komentar/:id", (request, v) => deps.cards.editComment(v, params(request).id!, commentUpdateSchema.parse(body(request))));
  write("DELETE", "/komentar/:id", (request, v) => deps.cards.deleteComment(v, params(request).id!));

  // ---- attachments (§9) ----

  write("DELETE", "/lampiran/:id", (request, v) => deps.attachments.remove(v, params(request).id!));

  // Streams instead of returning JSON. `inline` only for PDF and images, under a sandbox CSP;
  // everything else is a download, and the stored name is never a disk path (§10 nomor 4).
  app.get(`${KERJA_PREFIX}/lampiran/:id`, async (request, reply) => {
    try {
      const file = await deps.attachments.open(await viewer(request, false), params(request).id!);
      const download = (request.query as Record<string, string | undefined>).unduh === "1" || !file.inline;
      const encoded = encodeURIComponent(file.nama).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      reply
        .header("Cache-Control", "private, no-store")
        .header("Content-Type", file.mime)
        .header("Content-Length", String(file.ukuran))
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
        .header("Content-Disposition", `${download ? "attachment" : "inline"}; filename="berkas"; filename*=UTF-8''${encoded}`);
      return reply.send(file.stream);
    } catch (error) {
      return fail(reply, error);
    }
  });

  // ---- kerja_admin (§7.2, D-2) ----

  function adminGet<T>(path: string, handler: (request: FastifyRequest) => Promise<T>) {
    app.get(`${KERJA_ADMIN_PREFIX}${path}`, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        await admin(request, false);
        return reply.send(await handler(request));
      } catch (error) {
        return fail(reply, error);
      }
    });
  }

  function adminWrite<T>(method: "POST" | "PATCH", path: string, handler: (request: FastifyRequest, actor: string) => Promise<T>, status = 200) {
    app.route({
      method,
      url: `${KERJA_ADMIN_PREFIX}${path}`,
      handler: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          const { actor } = await admin(request, true);
          return reply.status(status).send(await handler(request, actor));
        } catch (error) {
          return fail(reply, error);
        }
      },
    });
  }

  adminGet("/ruang", () => deps.rooms.adminList());
  adminGet("/unit", () => deps.rooms.adminUnits());
  adminGet("/orang", (request) => deps.rooms.adminPeople(candidateQuerySchema.parse(request.query).q));
  adminWrite("POST", "/ruang", (request, actor) => deps.rooms.adminCreate(actor, createRoomSchema.parse(body(request))), 201);
  adminWrite("PATCH", "/ruang/:id", (request, actor) => deps.rooms.adminUpdate(actor, z.string().uuid().parse(params(request).id), adminRoomSchema.parse(body(request))));
  adminWrite("POST", "/ruang/:id/pj", (request, actor) => deps.rooms.adminSetPj(actor, z.string().uuid().parse(params(request).id), adminPjSchema.parse(body(request))));

  void app.register(async (scope) => {
    scope.setErrorHandler((error, _request, reply) => {
      if ((error as { statusCode?: unknown }).statusCode === 413) {
        return sendKerjaError(reply, 413, "lampiran_terlalu_besar", `Lampiran melebihi batas ${Math.round(deps.attachments.maxUploadBytes / 1024 / 1024)} MB.`);
      }
      return sendKerjaError(reply, 400, "tidak_sah", "Unggahan tidak sah.");
    });
    await scope.register(multipart, {
      limits: { fileSize: deps.attachments.maxUploadBytes, files: 1, fields: 0, parts: 1, headerPairs: 50 },
    });
    const owners: Array<[string, OwnerKind]> = [["/kartu/:id/lampiran", "kartu"], ["/butir/:id/lampiran", "ceklis_item"], ["/ruang/:id/lampiran", "ruang"]];
    for (const [path, kind] of owners) {
      scope.post(`${KERJA_PREFIX}${path}`, { bodyLimit: deps.attachments.maxUploadBytes + 64 * 1024 }, async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          const v = await viewer(request, true);
          const ownerId = params(request).id!;
          const ruangId = await deps.attachments.authorizeUpload(v, kind, ownerId);
          await deps.attachments.assertDiskRoom();
          if (!request.isMultipart()) throw new KerjaError(400, "tidak_sah", "Gunakan multipart/form-data.");
          const part = await request.file();
          if (!part) throw new KerjaError(400, "tidak_sah", "Satu berkas wajib.");
          const stored = await deps.attachments.store(v, kind, ownerId, ruangId, {
            filename: part.filename,
            stream: part.file,
            truncated: () => part.file.truncated,
          });
          return reply.status(201).send(stored);
        } catch (error) {
          return fail(reply, error);
        }
      });
    }
  });
}

/**
 * KERJA-IMPL-001 §7.1, as KIRIM D-1: the `kerja-sq` client reuses the Hub auth code with its own
 * configuration and host-only `sq_kerja_session` cookie. Routes match only the `kerja.` host.
 */
export function registerKerjaAuthRoutes(app: FastifyInstance, input: { auth: HubAuthRuntime; publicOrigin: string }) {
  const origin = new URL(input.publicOrigin);
  const host = new RegExp(`^${origin.hostname.replace(/\./g, "\\.")}(:\\d+)?$`);
  const constraints = { host };

  app.get("/auth/oidc/start", { constraints }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const result = await input.auth.beginLogin(undefined, "/");
      reply.header("Set-Cookie", result.setCookie);
      return reply.redirect(result.authorizationUrl.href);
    } catch {
      return reply.redirect("/?authError=identity_unavailable");
    }
  });

  app.get("/auth/callback", { constraints, logLevel: "silent" }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const callbackUrl = new URL(`/api/auth/callback${request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : ""}`, input.publicOrigin);
    try {
      const result = await input.auth.completeLogin(
        callbackUrl,
        readCookie(request.headers.cookie, KERJA_OIDC_TRANSACTION_COOKIE_NAME),
        { ipAddress: request.ip || null, userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null },
      );
      reply.raw.setHeader("Set-Cookie", result.setCookies);
      return reply.redirect("/");
    } catch {
      reply.header("Set-Cookie", input.auth.clearTransactionCookie());
      return reply.redirect("/?authError=oidc_failed");
    }
  });

  app.post("/auth/logout", { constraints }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (request.headers.origin !== input.publicOrigin) {
      return sendKerjaError(reply, 403, "origin_forbidden", "Permintaan harus dari halaman Kerja.");
    }
    const result = await input.auth.logout(readCookie(request.headers.cookie, KERJA_SESSION_COOKIE_NAME), {
      ipAddress: request.ip || null,
      userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
    });
    reply.header("Set-Cookie", result.clearCookie);
    return reply.send({ logoutUrl: result.logoutUrl?.href ?? null });
  });
}
