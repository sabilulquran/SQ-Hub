import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { ApplicationAccessService } from "../application-access/service.js";
import { HubAuthError, readCookie, type HubAuthRuntime } from "../hub-auth/service.js";
import {
  createDeviceSchema,
  optionalReasonBodySchema,
  pairingSchema,
  queueQuerySchema,
  reasonBodySchema,
  updateDeviceSchema,
  type AdminActor,
  type KirimAdminService,
} from "./admin.js";
import { handleKirimError, sendKirimError } from "./routes-internal.js";
import { KirimApiError } from "./service.js";

/** KIRIM-IMPL-001 §6.4 and §7. Browser path `/api/admin/kirim/*`; the edge strips `/api`. */
export const KIRIM_ADMIN_PREFIX = "/admin/kirim";
export const KIRIM_APPLICATION_KEY = "kirim-sq";
export const KIRIM_SESSION_COOKIE_NAME = "sq_kirim_session";
export const KIRIM_OIDC_TRANSACTION_COOKIE_NAME = "sq_kirim_oidc_tx";

class AuthorizationFailure extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function registerKirimAdminRoutes(
  app: FastifyInstance,
  input: {
    auth: HubAuthRuntime;
    access: Pick<ApplicationAccessService, "checkAccess">;
    admin: KirimAdminService;
    publicOrigin: string;
  },
) {
  /**
   * Two conditions (§7.2): active Application Access for `kirim-sq` and an active
   * `kirim_admins` row. Mutations must also come from the `kirim.` origin.
   */
  async function authorize(request: FastifyRequest, mutation: boolean): Promise<{ actor: AdminActor; displayName: string }> {
    let session;
    try {
      session = await input.auth.getSession(readCookie(request.headers.cookie, KIRIM_SESSION_COOKIE_NAME));
    } catch (error) {
      if (error instanceof HubAuthError) throw new AuthorizationFailure(401, "unauthenticated", "Sesi Kirim SQ tidak ada atau sudah berakhir.");
      throw error;
    }
    const identity = { issuer: session.issuer, subject: session.subject };
    const access = await input.access.checkAccess(identity, KIRIM_APPLICATION_KEY);
    if (!access.allowed) throw new AuthorizationFailure(403, "kirim_access_denied", "Anda belum punya akses aplikasi Kirim SQ.");
    if (!(await input.admin.isAdmin(identity))) {
      throw new AuthorizationFailure(403, "kirim_admin_required", "Anda belum ditetapkan sebagai pengelola Kirim SQ.");
    }
    if (mutation && request.headers.origin !== input.publicOrigin) {
      throw new AuthorizationFailure(403, "origin_forbidden", "Permintaan harus dari halaman Kirim SQ.");
    }
    const digest = createHash("sha256").update(`${session.issuer}\n${session.subject}`).digest("hex");
    return { actor: { ref: `staff:${digest}` }, displayName: session.displayName };
  }

  function fail(reply: FastifyReply, error: unknown) {
    if (error instanceof AuthorizationFailure) return sendKirimError(reply, error.statusCode, error.code, error.message);
    if (error instanceof KirimApiError || error instanceof z.ZodError) return handleKirimError(reply, error);
    return sendKirimError(reply, 503, "kirim_unavailable", "Kirim SQ sedang tidak tersedia.");
  }

  function read<T>(path: string, handler: (request: FastifyRequest, actor: AdminActor, displayName: string) => Promise<T>) {
    app.get(`${KIRIM_ADMIN_PREFIX}${path}`, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const { actor, displayName } = await authorize(request, false);
        return reply.send(await handler(request, actor, displayName));
      } catch (error) {
        return fail(reply, error);
      }
    });
  }

  function write<T>(method: "POST" | "PATCH", path: string, handler: (request: FastifyRequest, actor: AdminActor) => Promise<T>, status = 200) {
    app.route({
      method,
      url: `${KIRIM_ADMIN_PREFIX}${path}`,
      handler: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          const { actor } = await authorize(request, true);
          return reply.status(status).send(await handler(request, actor));
        } catch (error) {
          return fail(reply, error);
        }
      },
    });
  }

  const params = (request: FastifyRequest) => request.params as Record<string, string>;
  const body = (request: FastifyRequest) => request.body ?? {};

  read("/context", async (_request, _actor, displayName) => ({
    displayName,
    capabilities: { nomor: true, antrean: true },
  }));
  read("/devices", () => input.admin.listDevices());
  write("POST", "/devices", (request, actor) => input.admin.createDevice(actor, createDeviceSchema.parse(body(request))), 201);
  write("PATCH", "/devices/:kode", (request, actor) => input.admin.updateDevice(actor, params(request).kode!, updateDeviceSchema.parse(body(request))));
  write("POST", "/devices/:kode/provision", (request, actor) => input.admin.provision(actor, params(request).kode!));
  write("POST", "/devices/:kode/pairing", (request, actor) => input.admin.startPairing(actor, params(request).kode!, pairingSchema.parse(body(request))));
  read("/devices/:kode/status", (request) => input.admin.liveStatus(params(request).kode!));
  write("POST", "/devices/:kode/disconnect", (request, actor) => input.admin.disconnect(actor, params(request).kode!, reasonBodySchema.parse(body(request)).alasan));
  write("POST", "/devices/:kode/pause", (request, actor) => input.admin.setPaused(actor, params(request).kode!, true, optionalReasonBodySchema.parse(body(request)).alasan));
  write("POST", "/devices/:kode/resume", (request, actor) => input.admin.setPaused(actor, params(request).kode!, false, optionalReasonBodySchema.parse(body(request)).alasan));
  write("POST", "/devices/:kode/deactivate", (request, actor) => input.admin.deactivate(actor, params(request).kode!, reasonBodySchema.parse(body(request)).alasan));
  read("/consumers", async () => ({ consumers: await input.admin.listConsumers() }));
  read("/routes", async () => ({ routes: await input.admin.listRoutes() }));
  read("/queue/summary", () => input.admin.queueSummary());
  read("/queue", (request) => input.admin.listQueue(queueQuerySchema.parse(request.query)));
  write("POST", "/queue/:id/retry", (request, actor) => input.admin.retry(actor, params(request).id!));
  write("POST", "/queue/:id/cancel", (request, actor) => input.admin.cancel(actor, params(request).id!, reasonBodySchema.parse(body(request)).alasan));
}

/**
 * D-1: the `kirim-sq` OIDC client reuses the Hub auth code with its own configuration and
 * host-only `sq_kirim_session` cookie. Routes match only the `kirim.` host, so Hub login on
 * `hub.` keeps its own routes and cookie.
 */
export function registerKirimAuthRoutes(app: FastifyInstance, input: { auth: HubAuthRuntime; publicOrigin: string }) {
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
        readCookie(request.headers.cookie, KIRIM_OIDC_TRANSACTION_COOKIE_NAME),
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
      return sendKirimError(reply, 403, "origin_forbidden", "Permintaan harus dari halaman Kirim SQ.");
    }
    const result = await input.auth.logout(readCookie(request.headers.cookie, KIRIM_SESSION_COOKIE_NAME), {
      ipAddress: request.ip || null,
      userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
    });
    reply.header("Set-Cookie", result.clearCookie);
    return reply.send({ logoutUrl: result.logoutUrl?.href ?? null });
  });
}
