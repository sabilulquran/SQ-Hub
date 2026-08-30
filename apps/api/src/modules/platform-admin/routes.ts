import type { FastifyInstance } from "fastify";

import {
  HUB_SESSION_COOKIE_NAME,
  HubAuthError,
  readCookie,
  type HubAuthRuntime,
} from "../hub-auth/service.js";
import type { PlatformAdminRuntime } from "./service.js";

export function registerPlatformAdminRoutes(
  app: FastifyInstance,
  hubAuth: HubAuthRuntime,
  platformAdmin: PlatformAdminRuntime,
) {
  app.get("/admin/context", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);

    let session;
    try {
      session = await hubAuth.getAuthenticatedSession(sessionToken);
    } catch (error) {
      if (error instanceof HubAuthError) {
        return reply.status(error.statusCode).send({ error: error.code });
      }
      throw error;
    }

    const authorization = await platformAdmin.authorizeSession(session);
    if (authorization.status === "forbidden") {
      return reply.status(403).send({ error: "ADMIN_FORBIDDEN" });
    }
    if (authorization.status === "reauth_required") {
      return reply.status(403).send({ error: "ADMIN_REAUTH_REQUIRED" });
    }

    const overview = await platformAdmin.getOverview();
    return reply.send({
      authorized: true,
      displayName: session.displayName,
      capabilities: {
        platformAdministration: true,
      },
      overview,
    });
  });
}
