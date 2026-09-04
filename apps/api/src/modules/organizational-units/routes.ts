import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ActorRef } from "../application-access/types.js";
import { HUB_SESSION_COOKIE_NAME, HubAuthError, readCookie, type HubAuthRuntime } from "../hub-auth/service.js";
import { PlatformAdminAuthorizationError, type PlatformAdminService } from "../platform-admin/service.js";
import { OrganizationalUnitNotFoundError } from "./repository.js";
import { applyImportSchema, createUnitSchema, inspectImportSchema, OrganizationalUnitService, OrganizationalUnitValidationError, previewImportSchema, unitStatusSchema, updateUnitSchema } from "./service.js";

class OrganizationalUnitOriginError extends Error { readonly statusCode = 403; readonly code = "ADMIN_ORIGIN_FORBIDDEN"; }

export function registerOrganizationalUnitRoutes(app: FastifyInstance, input: { hubAuth: HubAuthRuntime; platformAdmin: Pick<PlatformAdminService, "authorize">; service: OrganizationalUnitService; allowedOrigin?: string }) {
  app.get("/admin/organizational-units", async (request, reply) => guarded(reply, async () => { await authorize(request.headers.cookie, input); return { units: await input.service.list(), ownershipState: "PRE_CUTOVER" }; }));
  app.get("/admin/organizational-units/hierarchy", async (request, reply) => guarded(reply, async () => { await authorize(request.headers.cookie, input); return { hierarchy: await input.service.hierarchy(), ownershipState: "PRE_CUTOVER" }; }));

  app.post("/admin/organizational-units", async (request, reply) => guarded(reply, async () => {
    const session = await authorize(request.headers.cookie, input); sameOrigin(request.headers.origin, input.allowedOrigin); const body = createUnitSchema.parse(request.body);
    reply.status(201); return { unit: await input.service.create(body, actor(session)), ownershipState: "PRE_CUTOVER" };
  }));

  app.patch("/admin/organizational-units/:id", async (request, reply) => guarded(reply, async () => {
    const session = await authorize(request.headers.cookie, input); sameOrigin(request.headers.origin, input.allowedOrigin); const params = z.object({ id: z.string().uuid() }).parse(request.params); const body = updateUnitSchema.parse(request.body);
    return { unit: await input.service.update(params.id, body, actor(session)), ownershipState: "PRE_CUTOVER" };
  }));

  app.post("/admin/organizational-units/:id/status", async (request, reply) => guarded(reply, async () => {
    const session = await authorize(request.headers.cookie, input); sameOrigin(request.headers.origin, input.allowedOrigin); const params = z.object({ id: z.string().uuid() }).parse(request.params); const body = unitStatusSchema.parse(request.body);
    return { ...(await input.service.setActive(params.id, body, actor(session))), ownershipState: "PRE_CUTOVER" };
  }));

  app.post("/admin/organizational-units/import/inspect", async (request, reply) => guarded(reply, async () => {
    await authorize(request.headers.cookie, input); const body = inspectImportSchema.parse(request.body); return { inspection: input.service.inspectImport(body) };
  }));

  app.post("/admin/organizational-units/import/preview", async (request, reply) => guarded(reply, async () => {
    await authorize(request.headers.cookie, input); const body = previewImportSchema.parse(request.body); return { preview: await input.service.previewImport(body) };
  }));

  app.post("/admin/organizational-units/import/apply", async (request, reply) => guarded(reply, async () => {
    const session = await authorize(request.headers.cookie, input); sameOrigin(request.headers.origin, input.allowedOrigin); const body = applyImportSchema.parse(request.body);
    return { result: await input.service.applyImport(body, actor(session)), ownershipState: "PRE_CUTOVER" };
  }));
}

async function authorize(cookie: string | undefined, input: { hubAuth: HubAuthRuntime; platformAdmin: Pick<PlatformAdminService, "authorize"> }) { const session = await input.hubAuth.getSession(readCookie(cookie, HUB_SESSION_COOKIE_NAME)); await input.platformAdmin.authorize(session); return session; }
function sameOrigin(origin: string | undefined, allowed: string | undefined) { if (!allowed || origin !== allowed) throw new OrganizationalUnitOriginError(); }
function actor(session: { issuer: string; subject: string }): ActorRef { return { kind: "human", ref: `staff:${createHash("sha256").update(`${session.issuer}\n${session.subject}`).digest("hex")}` }; }

async function guarded(reply: { header(name: string, value: string): unknown; status(code: number): unknown; code(code: number): { send(payload: unknown): unknown }; send(payload: unknown): unknown }, task: () => Promise<unknown>) {
  reply.header("Cache-Control", "no-store");
  try { return reply.send(await task()); }
  catch (error) {
    if (error instanceof HubAuthError) return reply.code(error.statusCode).send({ error: error.code });
    if (error instanceof PlatformAdminAuthorizationError) return reply.code(error.statusCode).send({ error: error.code });
    if (error instanceof OrganizationalUnitOriginError) return reply.code(error.statusCode).send({ error: error.code });
    if (error instanceof OrganizationalUnitValidationError) return reply.code(409).send({ error: error.code, issues: error.issues });
    if (error instanceof OrganizationalUnitNotFoundError || (error instanceof Error && error.name === "OrganizationalUnitNotFoundError")) return reply.code(404).send({ error: "ORGANIZATIONAL_UNIT_NOT_FOUND" });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "INVALID_REQUEST" });
    return reply.code(503).send({ error: "ORGANIZATIONAL_UNIT_UNAVAILABLE" });
  }
}
