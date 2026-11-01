import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { HUB_SESSION_COOKIE_NAME, HubAuthError, readCookie, type HubAuthRuntime } from "../hub-auth/service.js";
import { PlatformAdminAuthorizationError, type PlatformAdminService } from "../platform-admin/service.js";
import { RoleAdministrationError, type RoleAdministrationService } from "./service.js";

export const HCIS_ROLES_PREFIX = "/admin/hcis-roles";

const accountParamsSchema = z.object({ accountId: z.string().uuid() });
const assignmentParamsSchema = z.object({ assignmentId: z.string().uuid() });

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

/**
 * HUB-IMPL-023 browser contract. Every route resolves the session and runs H-0 (Platform
 * Administrator) before it reads anything else; the service repeats H-0 so no future caller can
 * reach the exchange without it.
 */
export function registerRoleAdministrationRoutes(
  app: FastifyInstance,
  input: {
    hubAuth: HubAuthRuntime;
    platformAdmin: Pick<PlatformAdminService, "authorize">;
    service: RoleAdministrationService;
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

  app.get(`${HCIS_ROLES_PREFIX}/catalog`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { session, sessionToken } = await authorized(request.headers.cookie);
      return reply.send(await input.service.catalog(session, sessionToken));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post(`${HCIS_ROLES_PREFIX}/accounts/:accountId/assignments`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { session, sessionToken } = await authorized(request.headers.cookie);
      requireSameOrigin(request.headers.origin);
      const params = accountParamsSchema.parse(request.params);
      const body = grantBodySchema.parse(request.body);
      const created = await input.service.grant(session, sessionToken, {
        accountId: params.accountId,
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

  app.delete(`${HCIS_ROLES_PREFIX}/assignments/:assignmentId`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { session, sessionToken } = await authorized(request.headers.cookie);
      requireSameOrigin(request.headers.origin);
      const params = assignmentParamsSchema.parse(request.params);
      const body = revokeBodySchema.parse(request.body);
      await input.service.revoke(session, sessionToken, { assignmentId: params.assignmentId, requestId: body.requestId });
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
  if (error instanceof RoleAdministrationError) {
    return reply.status(error.statusCode).send({ error: error.code, ...(error.detail ? { message: error.detail } : {}) });
  }
  return reply.status(503).send({ error: "ROLE_ADMIN_CHANNEL_UNAVAILABLE" });
}
