import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { ActorRef } from "../application-access/types.js";
import {
  HUB_SESSION_COOKIE_NAME,
  HubAuthError,
  readCookie,
  type HubAuthRuntime,
} from "../hub-auth/service.js";
import { IdentityDirectoryError } from "../identity-directory/client.js";
import { IdentityManagementError } from "../identity-management/client.js";
import {
  PlatformAdminAuthorizationError,
  type PlatformAdminService,
} from "../platform-admin/service.js";
import { OrganMembershipError, type OrganMembershipService } from "./service.js";

class OrganOriginError extends Error {
  readonly statusCode = 403;
  readonly code = "ADMIN_ORIGIN_FORBIDDEN";
}

const idParams = z.object({ id: z.string().trim().min(1).max(64) });

/**
 * HUB-IMPL-021 §1 "Organ Yayasan" in SQ Admin Center. Every route requires a Platform
 * Administrator whose session is newer than the latest admin grant; every mutation also
 * requires the exact Hub Origin and a reason, and the actor is derived server-side.
 */
export function registerOrganMembershipRoutes(
  app: FastifyInstance,
  input: {
    hubAuth: HubAuthRuntime;
    platformAdmin: Pick<PlatformAdminService, "authorize">;
    service: OrganMembershipService;
    allowedOrigin?: string;
  },
) {
  app.get("/admin/organ-memberships", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await authorizeSession(request.headers.cookie, input);
      const [overview, governanceApplications] = await Promise.all([
        input.service.overview(),
        input.service.governanceApplications(),
      ]);
      return reply.send({
        ...overview,
        governanceApplications,
        capabilities: {
          addNewIdentity: input.service.provisioningAvailable,
          endNewIdentity: input.service.pathBEndAvailable,
        },
      });
    } catch (error) {
      return sendOrganError(reply, error);
    }
  });

  app.get("/admin/organ-memberships/:id", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await authorizeSession(request.headers.cookie, input);
      const params = idParams.parse(request.params);
      return reply.send(await input.service.detail(params.id));
    } catch (error) {
      return sendOrganError(reply, error);
    }
  });

  app.post("/admin/organ-memberships/existing-staff", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const result = await input.service.addExistingStaff(request.body, actorForSession(session), session);
      return reply.status(result.outcome === "succeeded" ? 201 : 200).send(result);
    } catch (error) {
      return sendOrganError(reply, error);
    }
  });

  app.post("/admin/organ-memberships/new-identity", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const result = await input.service.addNewIdentity(request.body, actorForSession(session));
      return reply.status(result.outcome === "succeeded" ? 201 : 200).send(result);
    } catch (error) {
      return sendOrganError(reply, error);
    }
  });

  app.post("/admin/organ-memberships/:id/change", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const params = idParams.parse(request.params);
      return reply.send(await input.service.change(params.id, request.body, actorForSession(session), session));
    } catch (error) {
      return sendOrganError(reply, error);
    }
  });

  app.get("/admin/organ-memberships/:id/end-preview", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await authorizeSession(request.headers.cookie, input);
      const params = idParams.parse(request.params);
      return reply.send(await input.service.endPreview(params.id));
    } catch (error) {
      return sendOrganError(reply, error);
    }
  });

  app.post("/admin/organ-memberships/:id/end", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const params = idParams.parse(request.params);
      return reply.send(await input.service.end(params.id, request.body, actorForSession(session), session));
    } catch (error) {
      return sendOrganError(reply, error);
    }
  });

  app.post("/admin/organ-memberships/:id/resend-activation", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const params = idParams.parse(request.params);
      return reply.send(await input.service.resendActivation(params.id, request.body, actorForSession(session), session));
    } catch (error) {
      return sendOrganError(reply, error);
    }
  });
}

async function authorizeSession(
  cookie: string | undefined,
  input: { hubAuth: HubAuthRuntime; platformAdmin: Pick<PlatformAdminService, "authorize"> },
) {
  const session = await input.hubAuth.getSession(readCookie(cookie, HUB_SESSION_COOKIE_NAME));
  await input.platformAdmin.authorize(session);
  return session;
}

function requireSameOrigin(origin: string | undefined, allowedOrigin: string | undefined) {
  if (!allowedOrigin || origin !== allowedOrigin) throw new OrganOriginError();
}

function actorForSession(session: { issuer: string; subject: string }): ActorRef {
  const digest = createHash("sha256").update(`${session.issuer}\n${session.subject}`).digest("hex");
  return { kind: "human", ref: `staff:${digest}` };
}

function sendOrganError(reply: FastifyReply, error: unknown) {
  if (error instanceof HubAuthError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof PlatformAdminAuthorizationError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof OrganOriginError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof OrganMembershipError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: "INVALID_REQUEST" });
  if (error instanceof IdentityDirectoryError) return reply.status(503).send({ error: "IDENTITY_DIRECTORY_UNAVAILABLE" });
  if (error instanceof IdentityManagementError) {
    if (error.code === "DUPLICATE_USERNAME" || error.code === "DUPLICATE_EMAIL") {
      return reply.status(409).send({ error: "EMAIL_IN_USE_USE_EXISTING_STAFF" });
    }
    if (error.code === "STAFF_NOT_FOUND") return reply.status(404).send({ error: error.code });
    return reply.status(503).send({ error: "IDENTITY_MANAGEMENT_UNAVAILABLE" });
  }
  if (error instanceof Error && error.message === "LIFECYCLE_OPERATION_BUSY") {
    return reply.status(409).send({ error: "LIFECYCLE_OPERATION_BUSY" });
  }
  return reply.status(503).send({ error: "ORGAN_MEMBERSHIP_UNAVAILABLE" });
}
