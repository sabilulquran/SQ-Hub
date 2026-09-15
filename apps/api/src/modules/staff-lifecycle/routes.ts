import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ActorRef } from "../application-access/types.js";
import {
  HUB_SESSION_COOKIE_NAME,
  HubAuthError,
  readCookie,
  type HubAuthRuntime,
} from "../hub-auth/service.js";
import { IdentityManagementError } from "../identity-management/client.js";
import {
  PlatformAdminAuthorizationError,
  type PlatformAdminService,
} from "../platform-admin/service.js";
import {
  credentialActionSchema,
  offboardingSchema,
  provisionStaffSchema,
  statusMutationSchema,
  type StaffLifecycleService,
} from "./service.js";

class LifecycleOriginError extends Error {
  readonly statusCode = 403;
  readonly code = "ADMIN_ORIGIN_FORBIDDEN";
}

class LifecycleSelfMutationError extends Error {
  readonly statusCode = 409;
  readonly code = "ADMIN_SELF_OFFBOARD_FORBIDDEN";
}

export function registerStaffLifecycleRoutes(
  app: FastifyInstance,
  input: {
    hubAuth: HubAuthRuntime;
    platformAdmin: Pick<PlatformAdminService, "authorize">;
    service: StaffLifecycleService;
    allowedOrigin?: string;
  },
) {
  app.post("/admin/staff-lifecycle/provision", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const body = provisionStaffSchema.parse(request.body);
      const result = await input.service.provision(body, actorForSession(session));
      return reply.status(201).send(result);
    } catch (error) {
      return sendLifecycleError(reply, error);
    }
  });

  app.post("/admin/staff-lifecycle/status", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const body = statusMutationSchema.parse(request.body);
      if (!body.enabled && body.subject === session.subject) throw new LifecycleSelfMutationError();
      return reply.send(await input.service.setEnabled(body, actorForSession(session)));
    } catch (error) {
      return sendLifecycleError(reply, error);
    }
  });

  app.post("/admin/staff-lifecycle/password-initialization", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const body = credentialActionSchema.parse(request.body);
      return reply.send(await input.service.sendPasswordInitialization(body, actorForSession(session)));
    } catch (error) {
      return sendLifecycleError(reply, error);
    }
  });

  app.get("/admin/staff-lifecycle/:subject/offboarding-preview", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await authorizeSession(request.headers.cookie, input);
      const params = z.object({ subject: z.string().trim().min(1).max(512) }).parse(request.params);
      return reply.send({ preview: await input.service.previewOffboarding(params.subject) });
    } catch (error) {
      return sendLifecycleError(reply, error);
    }
  });

  app.post("/admin/staff-lifecycle/offboard", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const body = offboardingSchema.parse(request.body);
      if (body.subject === session.subject) throw new LifecycleSelfMutationError();
      return reply.send(await input.service.offboard(body, actorForSession(session)));
    } catch (error) {
      return sendLifecycleError(reply, error);
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
  if (!allowedOrigin || origin !== allowedOrigin) throw new LifecycleOriginError();
}

function actorForSession(session: { issuer: string; subject: string }): ActorRef {
  const digest = createHash("sha256").update(`${session.issuer}\n${session.subject}`).digest("hex");
  return { kind: "human", ref: `staff:${digest}` };
}

function sendLifecycleError(
  reply: { status(code: number): { send(payload: { error: string }): unknown } },
  error: unknown,
) {
  if (error instanceof HubAuthError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof PlatformAdminAuthorizationError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof LifecycleOriginError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof LifecycleSelfMutationError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: "INVALID_REQUEST" });
  if (error instanceof IdentityManagementError) {
    if (error.code === "DUPLICATE_USERNAME" || error.code === "DUPLICATE_EMAIL") {
      return reply.status(409).send({ error: error.code });
    }
    if (error.code === "STAFF_NOT_FOUND") return reply.status(404).send({ error: error.code });
    return reply.status(503).send({ error: "IDENTITY_MANAGEMENT_UNAVAILABLE" });
  }
  if (error instanceof Error && error.name === "StaffLifecycleNotFoundError") {
    return reply.status(404).send({ error: "STAFF_NOT_FOUND" });
  }
  return reply.status(503).send({ error: "STAFF_LIFECYCLE_UNAVAILABLE" });
}
