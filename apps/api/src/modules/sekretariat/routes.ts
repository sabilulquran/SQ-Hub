import { createHash } from "node:crypto";

import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import { listLauncherApplications } from "../application-access/launcher.js";
import type { ApplicationAccessService } from "../application-access/service.js";
import { HubAuthError, readCookie, type HubAuthRuntime } from "../hub-auth/service.js";
import type { HubWorkspaceApplicationSource } from "../hub-auth/workspace-repository.js";
import type { KerjaDirectory } from "../kerja/directory.js";
import { isSekretariatAdmin, loadPeran, type Viewer } from "./akses.js";
import type { SekretariatBerkas } from "./berkas.js";
import { batalSchema, nomorAwalSchema, registerQuerySchema, type SekretariatBuku } from "./buku.js";
import { SekretariatError } from "./db.js";
import { disposisiSchema, fisikSchema, selesaiSchema, type SekretariatKotak } from "./kotak.js";
import type { SekretariatMail } from "./mail.js";
import {
  cabutSchema, panitiaSchema, pemegangSchema, penerbitPatchSchema, petugasSchema, type SekretariatPengaturan,
} from "./pengaturan.js";
import { retroaktifSchema, suratBatalSchema, suratCreateSchema, type SekretariatSurat } from "./surat.js";

/** SEK-IMPL-001 §2: browser paths `/api/sekretariat/*` and `/api/admin/sekretariat/*`; the edge strips `/api`. */
export const SEKRETARIAT_PREFIX = "/sekretariat";
export const SEKRETARIAT_ADMIN_PREFIX = "/admin/sekretariat";
export const SEKRETARIAT_APPLICATION_KEY = "sekretariat-sq";
export const SEKRETARIAT_SESSION_COOKIE_NAME = "sq_sekretariat_session";
export const SEKRETARIAT_OIDC_TRANSACTION_COOKIE_NAME = "sq_sekretariat_oidc_tx";

export interface SekretariatRouteDeps {
  pool: Pool;
  auth: HubAuthRuntime;
  access: Pick<ApplicationAccessService, "checkAccess">;
  directory: KerjaDirectory;
  buku: SekretariatBuku;
  surat: SekretariatSurat;
  kotak: SekretariatKotak;
  berkas: SekretariatBerkas;
  pengaturan: SekretariatPengaturan;
  mail: SekretariatMail;
  publicOrigin: string;
  launcher?: { applications: HubWorkspaceApplicationSource; hubOrigin?: string };
  log?: (entry: Record<string, unknown>, message: string) => void;
}

interface SessionContext {
  identity: { issuer: string; subject: string };
  displayName: string;
}

export function sendSekretariatError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).header("Cache-Control", "no-store").send({ error: code, message });
}

export function registerSekretariatRoutes(app: FastifyInstance, deps: SekretariatRouteDeps) {
  async function session(request: FastifyRequest): Promise<SessionContext> {
    let record;
    try {
      record = await deps.auth.getSession(readCookie(request.headers.cookie, SEKRETARIAT_SESSION_COOKIE_NAME));
    } catch (error) {
      if (error instanceof HubAuthError) throw new SekretariatError(401, "unauthenticated", "Sesi Sekretariat tidak ada atau sudah berakhir.");
      throw error;
    }
    const identity = { issuer: record.issuer, subject: record.subject };
    const access = await deps.access.checkAccess(identity, SEKRETARIAT_APPLICATION_KEY);
    if (!access.allowed) throw new SekretariatError(403, "sekretariat_access_denied", "Anda belum punya akses aplikasi Sekretariat.");
    return { identity, displayName: record.displayName };
  }

  async function viewer(request: FastifyRequest, mutation: boolean): Promise<{ v: Viewer; admin: boolean }> {
    const context = await session(request);
    if (mutation && request.headers.origin !== deps.publicOrigin) {
      throw new SekretariatError(403, "origin_forbidden", "Permintaan harus dari halaman Sekretariat.");
    }
    const view = await deps.directory.view();
    if (!view) throw new SekretariatError(503, "directory_belum_tersedia", "Organization Directory belum tersedia.");
    const person = view.personByIdentity(context.identity);
    if (!person || !person.aktif) {
      throw new SekretariatError(403, "orang_belum_tercatat", "Akun Anda belum tercatat sebagai pegawai aktif di Organization Directory. Hubungi HCM.");
    }
    const admin = await isSekretariatAdmin(deps.pool, context.identity);
    return { v: { personId: person.id, actor: person.id, nama: person.nama }, admin };
  }

  async function admin(request: FastifyRequest, mutation: boolean): Promise<{ actor: string }> {
    const context = await session(request);
    if (!(await isSekretariatAdmin(deps.pool, context.identity))) {
      throw new SekretariatError(403, "sekretariat_admin_required", "Anda belum ditetapkan sebagai pengelola Sekretariat.");
    }
    if (mutation && request.headers.origin !== deps.publicOrigin) {
      throw new SekretariatError(403, "origin_forbidden", "Permintaan harus dari halaman Sekretariat.");
    }
    const person = (await deps.directory.view())?.personByIdentity(context.identity);
    const actor = person ? person.id : `staff:${createHash("sha256").update(`${context.identity.issuer}\n${context.identity.subject}`).digest("hex")}`;
    return { actor };
  }

  function fail(reply: FastifyReply, error: unknown) {
    if (error instanceof SekretariatError) return sendSekretariatError(reply, error.statusCode, error.code, error.message);
    if (error instanceof z.ZodError) {
      return reply.status(400).header("Cache-Control", "no-store").send({
        error: "tidak_sah", message: "Isian tidak sah.", fields: error.issues.map((issue) => issue.path.join(".")),
      });
    }
    // Never the error text: it can carry SQL or letter content (§9).
    deps.log?.({ event: "sekretariat.request_failed", errorType: error instanceof Error ? error.name : "unknown", code: (error as { code?: unknown }).code }, "sekretariat request failed");
    return sendSekretariatError(reply, 503, "sekretariat_unavailable", "Sekretariat sedang tidak tersedia.");
  }

  const params = (request: FastifyRequest) => request.params as Record<string, string>;
  const body = (request: FastifyRequest) => request.body ?? {};
  const pageOf = (request: FastifyRequest) => z.object({ page: z.coerce.number().int().min(1).default(1) }).parse(request.query).page;

  function get<T>(path: string, handler: (request: FastifyRequest, v: Viewer, admin: boolean) => Promise<T>) {
    app.get(`${SEKRETARIAT_PREFIX}${path}`, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const context = await viewer(request, false);
        return reply.send(await handler(request, context.v, context.admin));
      } catch (error) {
        return fail(reply, error);
      }
    });
  }

  function write<T>(method: "POST" | "PATCH" | "DELETE", path: string, handler: (request: FastifyRequest, v: Viewer, admin: boolean) => Promise<T>, status = 200) {
    app.route({
      method,
      url: `${SEKRETARIAT_PREFIX}${path}`,
      handler: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          const context = await viewer(request, true);
          return reply.status(status).send(await handler(request, context.v, context.admin));
        } catch (error) {
          return fail(reply, error);
        }
      },
    });
  }

  // ---- context and launcher ----

  app.get(`${SEKRETARIAT_PREFIX}/context`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const context = await session(request);
      const view = await deps.directory.view();
      const person = view?.personByIdentity(context.identity) ?? null;
      const pengelola = await isSekretariatAdmin(deps.pool, context.identity);
      let peran = null;
      if (person && person.aktif) {
        const loaded = await loadPeran(deps.pool, { personId: person.id, actor: person.id, nama: person.nama }, pengelola);
        peran = { disposisi: loaded.disposisi, penerbitIds: [...loaded.penerbitIds] };
      }
      return reply.send({
        displayName: context.displayName,
        orang: person && person.aktif ? { id: person.id, nama: person.nama } : null,
        directoryTersedia: view !== null,
        pengelola,
        peran,
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  const launcher = deps.launcher;
  if (launcher) {
    app.get(`${SEKRETARIAT_PREFIX}/launcher`, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      let identity;
      try {
        const record = await deps.auth.getSession(readCookie(request.headers.cookie, SEKRETARIAT_SESSION_COOKIE_NAME));
        identity = { issuer: record.issuer, subject: record.subject };
      } catch (error) {
        if (error instanceof HubAuthError) return sendSekretariatError(reply, 401, "unauthenticated", "Sesi Sekretariat tidak ada atau sudah berakhir.");
        return reply.send({ applications: null, unavailable: true });
      }
      try {
        return reply.send({ applications: await listLauncherApplications(launcher.applications, identity, launcher.hubOrigin) });
      } catch {
        return reply.send({ applications: null, unavailable: true });
      }
    });
  }

  // ---- ringkasan, kotak masuk, disposisi ----

  get("/ringkasan", async (_request, v, isAdmin) => {
    const kotak = await deps.kotak.list(v, isAdmin);
    const mail = isAdmin ? await deps.mail.status() : null;
    return { kotak: kotak.items, peran: kotak.peran, mail };
  });

  get("/jenis", () => deps.buku.jenisList(true));
  get("/penerbit", () => deps.pengaturan.penerbitAktif());
  get("/kotak", (_request, v, isAdmin) => deps.kotak.list(v, isAdmin));
  get("/kotak/:id/surat", (request, v, isAdmin) =>
    deps.kotak.isi(v, isAdmin, params(request).id!, (request.query as Record<string, string | undefined>).status, pageOf(request)));
  write("POST", "/kotak/:id/surat", (request, v, isAdmin) => deps.kotak.catatFisik(v, isAdmin, params(request).id!, fisikSchema.parse(body(request))), 201);
  get("/surat-masuk/:id", (request, v, isAdmin) => deps.kotak.detail(v, isAdmin, params(request).id!));
  write("POST", "/surat-masuk/:id/disposisi", (request, v, isAdmin) => deps.kotak.disposisi(v, isAdmin, params(request).id!, disposisiSchema.parse(body(request))), 201);
  write("POST", "/surat-masuk/:id/spam", (request, v, isAdmin) => deps.kotak.tandaiSpam(v, isAdmin, params(request).id!));
  write("POST", "/disposisi/:id/selesai", (request, v, isAdmin) => deps.kotak.selesai(v, isAdmin, params(request).id!, selesaiSchema.parse(body(request)).keterangan));

  // ---- surat keluar dan buku nomor ----

  get("/penerbit/:id/surat", (request, v, isAdmin) => deps.surat.list(v, isAdmin, params(request).id!, pageOf(request)));
  write("POST", "/penerbit/:id/surat", (request, v, isAdmin) => deps.surat.create(v, isAdmin, params(request).id!, suratCreateSchema.parse(body(request))), 201);
  write("POST", "/penerbit/:id/retroaktif", (request, v, isAdmin) => deps.surat.retroaktif(v, isAdmin, params(request).id!, retroaktifSchema.parse(body(request))), 201);
  get("/surat/:id", (request, v, isAdmin) => deps.surat.detail(v, isAdmin, params(request).id!));
  write("POST", "/surat/:id/terbit", (request, v, isAdmin) => deps.surat.terbitkan(v, isAdmin, params(request).id!));
  write("POST", "/surat/:id/batal", (request, v, isAdmin) => deps.surat.batalkan(v, isAdmin, params(request).id!, suratBatalSchema.parse(body(request)).alasan));
  get("/register", (request, v, isAdmin) => deps.buku.register(v, isAdmin, registerQuerySchema.parse(request.query)));
  write("POST", "/nomor/:id/batal", async (request, v, isAdmin) => {
    const peran = await loadPeran(deps.pool, v, isAdmin);
    return deps.buku.void(v, peran, params(request).id!, batalSchema.parse(body(request)).alasan);
  });

  // ---- berkas: unggah dan unduh ----

  void app.register(async (scope) => {
    scope.setErrorHandler((error, _request, reply) => {
      if ((error as { statusCode?: unknown }).statusCode === 413) {
        return sendSekretariatError(reply, 413, "berkas_terlalu_besar", `Berkas melebihi batas ${Math.round(deps.berkas.maxUploadBytes / 1024 / 1024)} MiB.`);
      }
      return sendSekretariatError(reply, 400, "tidak_sah", "Unggahan tidak sah.");
    });
    await scope.register(multipart, {
      limits: { fileSize: deps.berkas.maxUploadBytes, files: 1, fields: 0, parts: 1, headerPairs: 50 },
    });
    const owners = [
      { path: "/surat/:id/berkas", jenis: "surat_keluar" as const, allow: "pdf" as const, authorize: (v: Viewer, isAdmin: boolean, id: string) => deps.surat.authorizeUpload(v, isAdmin, id) },
      { path: "/surat-masuk/:id/berkas", jenis: "surat_masuk" as const, allow: "pindaian" as const, authorize: (v: Viewer, isAdmin: boolean, id: string) => deps.kotak.authorizeUpload(v, isAdmin, id) },
    ];
    for (const owner of owners) {
      scope.post(`${SEKRETARIAT_PREFIX}${owner.path}`, { bodyLimit: deps.berkas.maxUploadBytes + 64 * 1024 }, async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          const context = await viewer(request, true);
          const ownerId = params(request).id!;
          await owner.authorize(context.v, context.admin, ownerId);
          await deps.berkas.assertDiskRoom();
          if (!request.isMultipart()) throw new SekretariatError(400, "tidak_sah", "Gunakan multipart/form-data.");
          const part = await request.file();
          if (!part) throw new SekretariatError(400, "tidak_sah", "Satu berkas wajib.");
          const stored = await deps.berkas.store(
            context.v.actor,
            { jenis: owner.jenis, id: ownerId },
            { filename: part.filename, stream: part.file, truncated: () => part.file.truncated },
            owner.allow,
          );
          return reply.status(201).send(stored);
        } catch (error) {
          return fail(reply, error);
        }
      });
    }
  });

  // Streams the file after the owner's own authorization; the stored name is never a disk path.
  app.get(`${SEKRETARIAT_PREFIX}/berkas/:id`, async (request, reply) => {
    try {
      const context = await viewer(request, false);
      const file = await deps.berkas.open(params(request).id!);
      if (file.pemilikJenis === "surat_keluar") await deps.surat.authorizeRead(context.v, context.admin, file.pemilikId);
      else await deps.kotak.authorizeRead(context.v, context.admin, file.pemilikId);
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

  // ---- sekretariat_admin (§8–§9) ----

  function adminGet<T>(path: string, handler: (request: FastifyRequest) => Promise<T>) {
    app.get(`${SEKRETARIAT_ADMIN_PREFIX}${path}`, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        await admin(request, false);
        return reply.send(await handler(request));
      } catch (error) {
        return fail(reply, error);
      }
    });
  }

  function adminWrite<T>(method: "POST" | "PATCH" | "DELETE", path: string, handler: (request: FastifyRequest, actor: string) => Promise<T>, status = 200) {
    app.route({
      method,
      url: `${SEKRETARIAT_ADMIN_PREFIX}${path}`,
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

  adminGet("/penerbit", () => deps.pengaturan.penerbitList());
  adminWrite("POST", "/penerbit", (request, actor) => deps.pengaturan.buatPanitia(actor, panitiaSchema.parse(body(request))), 201);
  adminWrite("PATCH", "/penerbit/:id", (request, actor) => deps.pengaturan.ubahPenerbit(actor, params(request).id!, penerbitPatchSchema.parse(body(request))));
  adminGet("/petugas", () => deps.pengaturan.petugasList());
  adminWrite("POST", "/petugas", (request, actor) => deps.pengaturan.tambahPetugas(actor, petugasSchema.parse(body(request))), 201);
  adminWrite("POST", "/petugas/:id/cabut", (request, actor) => deps.pengaturan.cabutPetugas(actor, params(request).id!, cabutSchema.parse(body(request)).alasan));
  adminGet("/disposisi-pemegang", () => deps.pengaturan.pemegangDisposisiList());
  adminWrite("POST", "/disposisi-pemegang", (request, actor) => deps.pengaturan.tambahPemegangDisposisi(actor, pemegangSchema.parse(body(request))), 201);
  adminWrite("POST", "/disposisi-pemegang/:id/cabut", (request, actor) => deps.pengaturan.cabutPemegangDisposisi(actor, params(request).id!, cabutSchema.parse(body(request)).alasan));
  adminGet("/jenis", () => deps.buku.jenisList(false));
  adminWrite("POST", "/nomor-awal", (request, actor) => deps.buku.raiseCounter(actor, nomorAwalSchema.parse(body(request))));
  adminGet("/mail", () => deps.mail.status());

  app.get(`${SEKRETARIAT_ADMIN_PREFIX}/register/export`, async (request, reply) => {
    try {
      const context = await viewer(request, false);
      if (!context.admin) throw new SekretariatError(403, "sekretariat_admin_required", "Anda belum ditetapkan sebagai pengelola Sekretariat.");
      const csv = await deps.buku.exportCsv(context.v, true, registerQuerySchema.parse(request.query));
      return reply
        .header("Cache-Control", "no-store")
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="register-nomor-surat.csv"')
        .send(csv);
    } catch (error) {
      return fail(reply, error);
    }
  });
}

/**
 * SEK-IMPL-001 §2: the `sekretariat-sq` client reuses the Hub auth code with its own
 * configuration and host-only `sq_sekretariat_session` cookie. Routes match only the
 * `sekretariat.` host — the kirim/kerja pattern.
 */
export function registerSekretariatAuthRoutes(app: FastifyInstance, input: { auth: HubAuthRuntime; publicOrigin: string }) {
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
        readCookie(request.headers.cookie, SEKRETARIAT_OIDC_TRANSACTION_COOKIE_NAME),
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
      return sendSekretariatError(reply, 403, "origin_forbidden", "Permintaan harus dari halaman Sekretariat.");
    }
    const result = await input.auth.logout(readCookie(request.headers.cookie, SEKRETARIAT_SESSION_COOKIE_NAME), {
      ipAddress: request.ip || null,
      userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
    });
    reply.header("Set-Cookie", result.clearCookie);
    return reply.send({ logoutUrl: result.logoutUrl?.href ?? null });
  });
}
