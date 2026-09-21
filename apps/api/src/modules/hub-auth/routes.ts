import type { FastifyInstance, FastifyRequest } from "fastify";

import type { IdentityDirectory } from "../identity-directory/client.js";
import { IdentityDirectoryError } from "../identity-directory/client.js";
import type { HubOidcAction } from "./oidc-provider.js";
import type { HubRequestContext } from "./repository.js";
import {
  HUB_OIDC_TRANSACTION_COOKIE_NAME,
  HUB_SESSION_COOKIE_NAME,
  HubAuthError,
  readCookie,
  type HubAuthRuntime,
} from "./service.js";

const ACCOUNT_ACTIONS = {
  password: "UPDATE_PASSWORD",
  totp: "CONFIGURE_TOTP",
  "recovery-codes": "CONFIGURE_RECOVERY_AUTHN_CODES",
} as const satisfies Record<string, HubOidcAction>;

function requestContext(request: FastifyRequest): HubRequestContext {
  return {
    ipAddress: request.ip || null,
    userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
  };
}

function normalizedIssuer(value: string): string {
  return value.replace(/\/$/, "");
}

export function registerHubAuthRoutes(
  app: FastifyInstance,
  hubAuth: HubAuthRuntime,
  redirectUri: string,
  identityDirectory?: IdentityDirectory,
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

  app.get<{ Params: { action: string } }>("/auth/oidc/action/:action", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const action = ACCOUNT_ACTIONS[request.params.action as keyof typeof ACCOUNT_ACTIONS];
    if (!action) {
      return reply.status(404).send({ error: "ACCOUNT_ACTION_NOT_FOUND" });
    }

    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      await hubAuth.getSession(sessionToken);
      const result = await hubAuth.beginLogin(action);
      reply.header("Set-Cookie", result.setCookie);
      return reply.redirect(result.authorizationUrl.href);
    } catch (error) {
      if (error instanceof HubAuthError) {
        return reply.status(error.statusCode).send({ error: error.code });
      }
      return reply.redirect("/account?authError=identity_unavailable");
    }
  });

  app.get("/auth/callback", { logLevel: "silent" }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const callbackUrl = new URL(request.url, new URL(redirectUri).origin);
    const transactionToken = readCookie(
      request.headers.cookie,
      HUB_OIDC_TRANSACTION_COOKIE_NAME,
    );
    const accountAction = callbackUrl.searchParams.has("kc_action");

    try {
      const result = await hubAuth.completeLogin(
        callbackUrl,
        transactionToken,
        requestContext(request),
      );
      reply.raw.setHeader("Set-Cookie", result.setCookies);
      return reply.redirect(accountAction ? "/account" : "/");
    } catch {
      reply.header("Set-Cookie", hubAuth.clearTransactionCookie());
      return reply.redirect(accountAction ? "/account?authError=oidc_failed" : "/?authError=oidc_failed");
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

  app.get("/account", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const [session, workspace] = await Promise.all([
        hubAuth.getSession(sessionToken),
        hubAuth.getWorkspace(sessionToken),
      ]);

      let profile = {
        displayName: session.displayName,
        username: session.username,
        email: session.email,
        emailVerified: session.emailVerified,
      };
      let security = {
        totpConfigured: null as boolean | null,
        recoveryCodesConfigured: null as boolean | null,
      };

      if (identityDirectory) {
        try {
          const identity = await identityDirectory.inspect(session.subject);
          if (
            identity &&
            normalizedIssuer(identity.identity.issuer) === normalizedIssuer(session.issuer)
          ) {
            profile = {
              displayName: identity.displayName,
              username: identity.username,
              email: identity.email,
              emailVerified: identity.emailVerified,
            };
            security = identity.security;
          } else {
            request.log.warn(
              { event: "account.identity_directory.not_available_for_session" },
              "Native account is using session profile fallback",
            );
          }
        } catch (error) {
          request.log.warn(
            {
              event: "account.identity_directory.unavailable",
              errorType: error instanceof IdentityDirectoryError ? "IdentityDirectoryError" : "UnknownError",
            },
            "Native account is using session profile fallback",
          );
        }
      }

      return reply.send({
        profile,
        security,
        applications: workspace.applications,
      });
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
