import type { FastifyInstance } from "fastify";

import type { ApplicationAccessService } from "../application-access/service.js";
import {
  HUB_SESSION_COOKIE_NAME,
  HubAuthError,
  readCookie,
  type HubAuthRuntime,
} from "../hub-auth/service.js";
import {
  PlatformAdminAuthorizationError,
  type PlatformAdminService,
} from "./service.js";

export function registerPlatformAdminRoutes(
  app: FastifyInstance,
  input: {
    hubAuth: HubAuthRuntime;
    platformAdmin: Pick<PlatformAdminService, "authorize">;
    applicationRegistry: Pick<ApplicationAccessService, "listApplications">;
  },
) {
  app.get("/admin/context", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await input.hubAuth.getSession(
        readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME),
      );
      await input.platformAdmin.authorize(session);
      return reply.send({
        authorized: true,
        displayName: session.displayName,
        capabilities: {
          platformAdministration: true,
        },
      });
    } catch (error) {
      return sendAdminError(reply, error);
    }
  });

  app.get("/admin/applications", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await input.hubAuth.getSession(
        readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME),
      );
      await input.platformAdmin.authorize(session);
      const applications = await input.applicationRegistry.listApplications();
      return reply.send({
        applications: applications.map((application) => ({
          key: application.applicationKey,
          name: application.name,
          canonicalUrl: application.canonicalUrl,
          status: application.status,
        })),
      });
    } catch (error) {
      return sendAdminError(reply, error);
    }
  });
}

function sendAdminError(
  reply: {
    status(code: number): { send(payload: { error: string }): unknown };
  },
  error: unknown,
) {
  if (error instanceof HubAuthError) {
    return reply.status(error.statusCode).send({ error: error.code });
  }
  if (error instanceof PlatformAdminAuthorizationError) {
    return reply.status(error.statusCode).send({ error: error.code });
  }
  return reply.status(503).send({ error: "ADMIN_VERIFICATION_UNAVAILABLE" });
}
