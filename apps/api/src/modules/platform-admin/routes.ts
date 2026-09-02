import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { UnknownApplicationError } from "../application-access/repository.js";
import {
  applicationKeySchema,
  type ApplicationAccessService,
} from "../application-access/service.js";
import type { AuditRecord } from "../application-access/types.js";
import {
  HUB_SESSION_COOKIE_NAME,
  HubAuthError,
  readCookie,
  type HubAuthRuntime,
} from "../hub-auth/service.js";
import {
  IdentityDirectoryError,
  type IdentityDirectory,
} from "../identity-directory/client.js";
import {
  PlatformAdminAuthorizationError,
  type PlatformAdminService,
} from "./service.js";

const applicationBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    canonicalUrl: z.string().url().max(2048),
    status: z.enum(["active", "inactive"]),
  })
  .strict();

const accessMutationSchema = z
  .object({
    subject: z.string().trim().min(1).max(512),
    applicationKey: applicationKeySchema,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

const staffQuerySchema = z.object({ q: z.string().trim().min(2).max(120) });
const auditQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

class AdminOriginError extends Error {
  readonly statusCode = 403;
  readonly code = "ADMIN_ORIGIN_FORBIDDEN";
}

export function registerPlatformAdminRoutes(
  app: FastifyInstance,
  input: {
    hubAuth: HubAuthRuntime;
    platformAdmin: Pick<PlatformAdminService, "authorize">;
    applicationRegistry: Pick<ApplicationAccessService, "listApplications" | "upsertApplication">;
    allowedOrigin?: string;
    applicationAccess?: Pick<
      ApplicationAccessService,
      "listApplications" | "getAccess" | "grant" | "revoke" | "listAudit"
    >;
    identityDirectory?: IdentityDirectory;
  },
) {
  app.get("/admin/context", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      return reply.send({
        authorized: true,
        displayName: session.displayName,
        capabilities: {
          platformAdministration: true,
          applicationAccessAdministration: Boolean(input.applicationAccess && input.identityDirectory),
        },
      });
    } catch (error) {
      return sendAdminError(reply, error);
    }
  });

  app.get("/admin/applications", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await authorizeSession(request.headers.cookie, input);
      const applications = await input.applicationRegistry.listApplications();
      return reply.send({ applications: applications.map(toBrowserApplication) });
    } catch (error) {
      return sendAdminError(reply, error);
    }
  });

  app.put("/admin/applications/:applicationKey", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const params = z.object({ applicationKey: applicationKeySchema }).parse(request.params);
      const body = applicationBodySchema.parse(request.body);
      const application = await input.applicationRegistry.upsertApplication({
        applicationKey: params.applicationKey,
        name: body.name,
        canonicalUrl: body.canonicalUrl,
        status: body.status,
        actor: actorForSession(session),
      });
      return reply.send({ application: toBrowserApplication(application) });
    } catch (error) {
      return sendAdminError(reply, error);
    }
  });

  app.get("/admin/staff", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await authorizeSession(request.headers.cookie, input);
      const directory = requireDirectory(input.identityDirectory);
      const query = staffQuerySchema.parse(request.query);
      const staff = await directory.search(query.q, 10);
      return reply.send({
        staff: staff.map((entry) => ({
          subject: entry.identity.subject,
          username: entry.username,
          email: entry.email,
          emailVerified: entry.emailVerified,
          displayName: entry.displayName,
          enabled: entry.enabled,
          security: entry.security,
        })),
      });
    } catch (error) {
      return sendAdminError(reply, error);
    }
  });

  app.get("/admin/staff/:subject/access", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await authorizeSession(request.headers.cookie, input);
      const directory = requireDirectory(input.identityDirectory);
      const accessService = requireAccessService(input.applicationAccess);
      const params = z.object({ subject: z.string().trim().min(1).max(512) }).parse(request.params);
      const staff = await directory.inspect(params.subject);
      if (!staff) return reply.status(404).send({ error: "STAFF_NOT_FOUND" });

      const applications = await accessService.listApplications();
      const access = await Promise.all(
        applications.map(async (application) => {
          const record = await accessService.getAccess(staff.identity, application.applicationKey);
          return {
            application: toBrowserApplication(application),
            status: record?.status ?? "none",
            reason: record?.reason ?? null,
            grantedAt: record?.grantedAt ?? null,
            revokedAt: record?.revokedAt ?? null,
            updatedAt: record?.updatedAt ?? null,
          };
        }),
      );
      return reply.send({
        staff: {
          subject: staff.identity.subject,
          username: staff.username,
          email: staff.email,
          emailVerified: staff.emailVerified,
          displayName: staff.displayName,
          enabled: staff.enabled,
          security: staff.security,
        },
        access,
      });
    } catch (error) {
      return sendAdminError(reply, error);
    }
  });

  app.post("/admin/application-access/grant", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const directory = requireDirectory(input.identityDirectory);
      const accessService = requireAccessService(input.applicationAccess);
      const body = accessMutationSchema.parse(request.body);
      const staff = await directory.inspect(body.subject);
      if (!staff) return reply.status(404).send({ error: "STAFF_NOT_FOUND" });
      const record = await accessService.grant({
        identity: staff.identity,
        applicationKey: body.applicationKey,
        reason: body.reason,
        actor: actorForSession(session),
      });
      return reply.send({ access: toBrowserAccess(record) });
    } catch (error) {
      return sendAdminError(reply, error);
    }
  });

  app.post("/admin/application-access/revoke", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorizeSession(request.headers.cookie, input);
      requireSameOrigin(request.headers.origin, input.allowedOrigin);
      const directory = requireDirectory(input.identityDirectory);
      const accessService = requireAccessService(input.applicationAccess);
      const body = accessMutationSchema.parse(request.body);
      const staff = await directory.inspect(body.subject);
      if (!staff) return reply.status(404).send({ error: "STAFF_NOT_FOUND" });
      const record = await accessService.revoke({
        identity: staff.identity,
        applicationKey: body.applicationKey,
        reason: body.reason,
        actor: actorForSession(session),
      });
      return reply.send({ access: toBrowserAccess(record) });
    } catch (error) {
      return sendAdminError(reply, error);
    }
  });

  app.get("/admin/audit", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await authorizeSession(request.headers.cookie, input);
      const accessService = requireAccessService(input.applicationAccess);
      const query = auditQuerySchema.parse(request.query);
      const records = await accessService.listAudit(undefined, query.limit);
      const safeRecords = records.map(toBrowserAudit);
      const needle = query.q.toLowerCase();
      const filtered = needle
        ? safeRecords.filter((record) => JSON.stringify(record).toLowerCase().includes(needle))
        : safeRecords;
      return reply.send({ audit: filtered });
    } catch (error) {
      return sendAdminError(reply, error);
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
  if (!allowedOrigin || origin !== allowedOrigin) throw new AdminOriginError();
}

function actorForSession(session: { issuer: string; subject: string }) {
  const digest = createHash("sha256").update(`${session.issuer}\n${session.subject}`).digest("hex");
  return { kind: "human" as const, ref: `staff:${digest}` };
}

function requireDirectory(directory: IdentityDirectory | undefined): IdentityDirectory {
  if (!directory) throw new IdentityDirectoryError("Identity directory is unavailable");
  return directory;
}

function requireAccessService(
  service:
    | Pick<ApplicationAccessService, "listApplications" | "getAccess" | "grant" | "revoke" | "listAudit">
    | undefined,
) {
  if (!service) throw new Error("Application Access administration is unavailable");
  return service;
}

function toBrowserApplication(application: {
  applicationKey: string;
  name: string;
  canonicalUrl: string;
  status: "active" | "inactive";
}) {
  return {
    key: application.applicationKey,
    name: application.name,
    canonicalUrl: application.canonicalUrl,
    status: application.status,
  };
}

function toBrowserAccess(record: {
  applicationKey: string;
  status: "active" | "revoked";
  reason: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
}) {
  return {
    applicationKey: record.applicationKey,
    status: record.status,
    reason: record.reason,
    grantedAt: record.grantedAt,
    revokedAt: record.revokedAt,
    updatedAt: record.updatedAt,
  };
}

function toBrowserAudit(record: AuditRecord) {
  const safePayload: Record<string, unknown> = {};
  for (const key of ["applicationKey", "reason", "status", "canonicalUrl"]) {
    const value = record.payload[key];
    if (typeof value === "string" || value === null) safePayload[key] = value;
  }
  return {
    id: record.id,
    actor: record.actor,
    action: record.action,
    targetType: record.targetType,
    outcome: record.outcome,
    payload: safePayload,
    occurredAt: record.occurredAt,
  };
}

function sendAdminError(
  reply: { status(code: number): { send(payload: { error: string }): unknown } },
  error: unknown,
) {
  if (error instanceof HubAuthError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof PlatformAdminAuthorizationError) {
    return reply.status(error.statusCode).send({ error: error.code });
  }
  if (error instanceof AdminOriginError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: "INVALID_REQUEST" });
  if (error instanceof UnknownApplicationError) return reply.status(404).send({ error: "UNKNOWN_APPLICATION" });
  if (error instanceof IdentityDirectoryError) {
    return reply.status(503).send({ error: "IDENTITY_DIRECTORY_UNAVAILABLE" });
  }
  return reply.status(503).send({ error: "ADMIN_VERIFICATION_UNAVAILABLE" });
}
