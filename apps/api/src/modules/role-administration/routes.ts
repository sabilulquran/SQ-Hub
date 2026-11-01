import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { HUB_SESSION_COOKIE_NAME, HubAuthError, readCookie, type HubAuthRuntime } from "../hub-auth/service.js";
import { IdentityDirectoryError, type IdentityDirectory } from "../identity-directory/client.js";
import { PlatformAdminAuthorizationError, type PlatformAdminService } from "../platform-admin/service.js";
import { RoleAdministrationError, type RoleAdministrationService } from "./service.js";

export const HCIS_ROLES_PREFIX = "/admin/hcis-roles";

const subjectSchema = z.string().trim().min(1).max(512);
const staffParamsSchema = z.object({ subject: subjectSchema });
const assignmentParamsSchema = z.object({ subject: subjectSchema, assignmentId: z.string().uuid() });
const pageQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(1000).optional().default(1) });

// The browser picks the requestId once per submitted form, so a double submit is one action
// that HCIS refuses as a replay instead of two assignments (AC 5).
const grantBodySchema = z
  .object({
    requestId: z.string().uuid(),
    roleId: z.string().uuid(),
    scopeType: z.enum(["own", "unit", "organization"]),
    organizationalUnitId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().max(1000).nullable().optional(),
    startsOn: z.iso.date().nullable().optional(),
    endsOn: z.iso.date().nullable().optional(),
  })
  .strict();

const revokeBodySchema = z.object({ requestId: z.string().uuid() }).strict();

class AdminOriginError extends Error {
  readonly statusCode = 403;
  readonly code = "ADMIN_ORIGIN_FORBIDDEN";
}

class StaffNotFoundError extends Error {}

/**
 * HUB-IMPL-023 browser contract. Every route resolves the session and runs H-0 (Platform
 * Administrator) before it reads anything else; the service repeats H-0 so no future caller can
 * reach the exchange without it. The person is always named by their Akun SQ subject and checked
 * in the directory; HCIS ids are resolved server-side and never typed by the operator.
 */
export function registerRoleAdministrationRoutes(
  app: FastifyInstance,
  input: {
    hubAuth: HubAuthRuntime;
    platformAdmin: Pick<PlatformAdminService, "authorize">;
    service: RoleAdministrationService;
    identityDirectory: IdentityDirectory;
    allowedOrigin?: string;
  },
) {
  async function authorized(cookie: string | undefined) {
    const sessionToken = readCookie(cookie, HUB_SESSION_COOKIE_NAME);
    const session = await input.hubAuth.getSession(sessionToken);
    await input.platformAdmin.authorize(session);
    return { session, sessionToken };
  }

  function requireSameOrigin(origin: string | undefined) {
    if (!input.allowedOrigin || origin !== input.allowedOrigin) throw new AdminOriginError();
  }

  async function staff(subject: string) {
    const found = await input.identityDirectory.inspect(subject);
    if (!found) throw new StaffNotFoundError();
    return found;
  }

  app.get(`${HCIS_ROLES_PREFIX}/catalog`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { session, sessionToken } = await authorized(request.headers.cookie);
      return reply.send(await input.service.catalog(session, sessionToken));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get(`${HCIS_ROLES_PREFIX}/staff/:subject`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { session, sessionToken } = await authorized(request.headers.cookie);
      const params = staffParamsSchema.parse(request.params);
      const query = pageQuerySchema.parse(request.query);
      const person = await staff(params.subject);
      const lookup = await input.service.lookup(session, sessionToken, person.identity, query.page);
      return reply.send({
        staff: { subject: person.identity.subject, displayName: person.displayName, username: person.username },
        ...lookup,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post(`${HCIS_ROLES_PREFIX}/staff/:subject/assignments`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { session, sessionToken } = await authorized(request.headers.cookie);
      requireSameOrigin(request.headers.origin);
      const params = staffParamsSchema.parse(request.params);
      const body = grantBodySchema.parse(request.body);
      const person = await staff(params.subject);
      const created = await input.service.grant(session, sessionToken, person.identity, {
        requestId: body.requestId,
        roleId: body.roleId,
        scopeType: body.scopeType,
        organizationalUnitId: body.organizationalUnitId ?? null,
        reason: body.reason || null,
        startsOn: body.startsOn ?? null,
        endsOn: body.endsOn ?? null,
      });
      return reply.status(201).send(created);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete(`${HCIS_ROLES_PREFIX}/staff/:subject/assignments/:assignmentId`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { session, sessionToken } = await authorized(request.headers.cookie);
      requireSameOrigin(request.headers.origin);
      const params = assignmentParamsSchema.parse(request.params);
      const body = revokeBodySchema.parse(request.body);
      const person = await staff(params.subject);
      await input.service.revoke(session, sessionToken, person.identity, { assignmentId: params.assignmentId, requestId: body.requestId });
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof HubAuthError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof PlatformAdminAuthorizationError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof AdminOriginError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: "INVALID_REQUEST" });
  if (error instanceof StaffNotFoundError) return reply.status(404).send({ error: "STAFF_NOT_FOUND" });
  if (error instanceof IdentityDirectoryError) return reply.status(503).send({ error: "IDENTITY_DIRECTORY_UNAVAILABLE" });
  if (error instanceof RoleAdministrationError) {
    return reply.status(error.statusCode).send({ error: error.code, ...(error.detail ? { message: error.detail } : {}) });
  }
  return reply.status(503).send({ error: "ROLE_ADMIN_CHANNEL_UNAVAILABLE" });
}
