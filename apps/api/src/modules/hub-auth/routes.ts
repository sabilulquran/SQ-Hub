import type { FastifyInstance, FastifyRequest } from "fastify";

import type { HubRequestContext } from "./repository.js";
import {
  HUB_OIDC_TRANSACTION_COOKIE_NAME,
  HUB_SESSION_COOKIE_NAME,
  HubAuthError,
  readCookie,
  type HubAuthRuntime,
} from "./service.js";

function requestContext(request: FastifyRequest): HubRequestContext {
  return {
    ipAddress: request.ip || null,
    userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
  };
}

export function registerHubAuthRoutes(
  app: FastifyInstance,
  hubAuth: HubAuthRuntime,
  redirectUri: string,
) {
  app.get("/auth/oidc/start", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const result = await hubAuth.beginLogin();
      reply.header("Set-Cookie", result.setCookie);
      return reply.redirect(result.authorizationUrl.href);
    } catch {
      return reply.redirect("/?authError=identity_unavailable");
    }
  });

  app.get("/auth/callback", { logLevel: "silent" }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const callbackUrl = new URL(request.url, new URL(redirectUri).origin);
    const transactionToken = readCookie(
      request.headers.cookie,
      HUB_OIDC_TRANSACTION_COOKIE_NAME,
    );

    try {
      const result = await hubAuth.completeLogin(
        callbackUrl,
        transactionToken,
        requestContext(request),
      );
      reply.raw.setHeader("Set-Cookie", result.setCookies);
      return reply.redirect("/");
    } catch {
      reply.header("Set-Cookie", hubAuth.clearTransactionCookie());
      return reply.redirect("/?authError=oidc_failed");
    }
  });

  app.get("/workspace", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      return reply.send(await hubAuth.getWorkspace(sessionToken));
    } catch (error) {
      if (error instanceof HubAuthError) {
        return reply.status(error.statusCode).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    const result = await hubAuth.logout(sessionToken, requestContext(request));
    reply.header("Set-Cookie", result.clearCookie);
    return reply.send({ logoutUrl: result.logoutUrl?.href ?? null });
  });
}
