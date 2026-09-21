import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  AccountSelfServiceError,
  type KeycloakAccountSelfService,
} from "../account-self-service/client.js";
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

const profileUpdateSchema = z
  .object({
    fields: z.record(z.string().min(1).max(120), z.array(z.string().max(1000)).max(20)),
  })
  .strict();

const credentialLabelSchema = z
  .object({ label: z.string().trim().min(1).max(80) })
  .strict();

function requestContext(request: FastifyRequest): HubRequestContext {
  return {
    ipAddress: request.ip || null,
    userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
  };
}

function normalizedIssuer(value: string): string {
  return value.replace(/\/$/, "");
}

function requireSameOrigin(request: FastifyRequest, allowedOrigin: string): boolean {
  return request.headers.origin === allowedOrigin;
}

function sendAccountError(reply: FastifyReply, error: unknown) {
  if (error instanceof HubAuthError) {
    return reply.status(error.statusCode).send({ error: error.code });
  }
  if (error instanceof AccountSelfServiceError) {
    return reply.status(error.statusCode).send({ error: error.code });
  }
  throw error;
}

function securityState(credentials: Array<{ type: string; credentials: unknown[] }>) {
  const configured = (matcher: (type: string) => boolean) =>
    credentials.some((item) => matcher(item.type) && item.credentials.length > 0);
  return {
    totpConfigured: configured((type) => type === "otp" || type.includes("totp")),
    recoveryCodesConfigured: configured((type) => type.includes("recovery")),
  };
}

export function registerHubAuthRoutes(
  app: FastifyInstance,
  hubAuth: HubAuthRuntime,
  redirectUri: string,
  identityDirectory?: IdentityDirectory,
  accountSelfService?: KeycloakAccountSelfService,
) {
  const allowedOrigin = new URL(redirectUri).origin;

  app.get<{ Querystring: { returnTo?: string } }>("/auth/oidc/start", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const returnPath = request.query.returnTo === "account" ? "/account" : "/";
    try {
      const result = await hubAuth.beginLogin(undefined, returnPath);
      reply.header("Set-Cookie", result.setCookie);
      return reply.redirect(result.authorizationUrl.href);
    } catch {
      return reply.redirect(
        returnPath === "/account"
          ? "/account?authError=identity_unavailable"
          : "/?authError=identity_unavailable",
      );
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
      const result = await hubAuth.beginLogin(action, "/account");
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
    const callbackUrl = new URL(request.url, allowedOrigin);
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
      return reply.redirect(result.returnPath);
    } catch {
      reply.header("Set-Cookie", hubAuth.clearTransactionCookie());
      return reply.redirect(
        accountAction ? "/account?authError=oidc_failed" : "/?authError=oidc_failed",
      );
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
        fields: [] as Array<{
          name: string;
          label: string;
          required: boolean;
          readOnly: boolean;
          multivalued: boolean;
          values: string[];
          requiredAction: "UPDATE_EMAIL" | null;
        }>,
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
              fields: profile.fields,
            };
            security = identity.security;
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

      let management:
        | {
            available: true;
            reauthRequired: false;
            credentials: Awaited<ReturnType<KeycloakAccountSelfService["snapshot"]>>["credentials"];
            devices: Awaited<ReturnType<KeycloakAccountSelfService["snapshot"]>>["devices"];
            applications: Awaited<ReturnType<KeycloakAccountSelfService["snapshot"]>>["applications"];
            linkedAccounts: Awaited<ReturnType<KeycloakAccountSelfService["snapshot"]>>["linkedAccounts"];
            availableAccountLinks: Awaited<ReturnType<KeycloakAccountSelfService["snapshot"]>>["availableAccountLinks"];
            groups: Awaited<ReturnType<KeycloakAccountSelfService["snapshot"]>>["groups"];
          }
        | {
            available: false;
            reauthRequired: boolean;
            credentials: [];
            devices: [];
            applications: [];
            linkedAccounts: [];
            availableAccountLinks: [];
            groups: [];
          } = {
        available: false,
        reauthRequired: false,
        credentials: [],
        devices: [],
        applications: [],
        linkedAccounts: [],
        availableAccountLinks: [],
        groups: [],
      };

      if (accountSelfService) {
        try {
          const delegated = await hubAuth.getAccountAccess(sessionToken);
          const snapshot = await accountSelfService.snapshot(delegated.accessToken);
          profile = snapshot.profile;
          security = securityState(snapshot.credentials);
          management = {
            available: true,
            reauthRequired: false,
            credentials: snapshot.credentials,
            devices: snapshot.devices,
            applications: snapshot.applications,
            linkedAccounts: snapshot.linkedAccounts,
            availableAccountLinks: snapshot.availableAccountLinks,
            groups: snapshot.groups,
          };
        } catch (error) {
          const reauthRequired =
            error instanceof HubAuthError && error.code === "ACCOUNT_REAUTH_REQUIRED" ||
            error instanceof AccountSelfServiceError && error.code === "ACCOUNT_REAUTH_REQUIRED";
          request.log.warn(
            {
              event: "account.self_service.delegation_unavailable",
              reauthRequired,
            },
            "Native account management is using safe read-only fallback",
          );
          management = {
            available: false,
            reauthRequired,
            credentials: [],
            devices: [],
            applications: [],
            linkedAccounts: [],
            availableAccountLinks: [],
            groups: [],
          };
        }
      }

      return reply.send({
        profile,
        security,
        applications: workspace.applications,
        management,
      });
    } catch (error) {
      if (error instanceof HubAuthError) {
        return reply.status(error.statusCode).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post("/account/profile", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    const parsed = profileUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      await accountSelfService.updateProfile(delegated.accessToken, parsed.data.fields);
      return reply.send({ updated: true });
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });

  app.post<{ Params: { fieldName: string } }>("/account/profile/:fieldName/action", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      const action = await accountSelfService.resolveProfileAction(
        delegated.accessToken,
        request.params.fieldName,
      );
      const login = await hubAuth.beginLogin(action, "/account");
      reply.header("Set-Cookie", login.setCookie);
      return reply.send({ authorizationUrl: login.authorizationUrl.href });
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });

  app.delete<{ Params: { sessionId: string } }>("/account/sessions/:sessionId", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      await accountSelfService.logoutSession(delegated.accessToken, request.params.sessionId);
      return reply.send({ updated: true });
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });

  app.delete("/account/sessions", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      await accountSelfService.logoutOtherSessions(delegated.accessToken);
      return reply.send({ updated: true });
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });

  app.delete<{ Params: { clientId: string } }>("/account/applications/:clientId/consent", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      await accountSelfService.revokeConsent(delegated.accessToken, request.params.clientId);
      return reply.send({ updated: true });
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });

  app.delete<{ Params: { providerAlias: string } }>("/account/linked-accounts/:providerAlias", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      await accountSelfService.unlinkAccount(delegated.accessToken, request.params.providerAlias);
      return reply.send({ updated: true });
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });

  app.post<{ Params: { providerAlias: string } }>("/account/linked-accounts/:providerAlias/link", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      const action = await accountSelfService.resolveLinkAction(
        delegated.accessToken,
        request.params.providerAlias,
      );
      const login = await hubAuth.beginLogin(action, "/account");
      reply.header("Set-Cookie", login.setCookie);
      return reply.send({ authorizationUrl: login.authorizationUrl.href });
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });

  app.post<{
    Params: { credentialType: string; operation: "create" | "update" };
  }>("/account/credentials/:credentialType/:operation", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    if (
      request.params.operation !== "create" &&
      request.params.operation !== "update"
    ) {
      return reply.status(404).send({ error: "CREDENTIAL_ACTION_NOT_FOUND" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      const action = await accountSelfService.resolveCredentialAction(
        delegated.accessToken,
        {
          type: request.params.credentialType,
          operation: request.params.operation,
        },
      );
      const login = await hubAuth.beginLogin(action as HubOidcAction, "/account");
      reply.header("Set-Cookie", login.setCookie);
      return reply.send({ authorizationUrl: login.authorizationUrl.href });
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });

  app.post<{ Params: { credentialId: string } }>("/account/credentials/:credentialId/delete", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      const action = await accountSelfService.resolveDeleteCredentialAction(
        delegated.accessToken,
        request.params.credentialId,
      );
      const login = await hubAuth.beginLogin(action, "/account");
      reply.header("Set-Cookie", login.setCookie);
      return reply.send({ authorizationUrl: login.authorizationUrl.href });
    } catch (error) {
      return sendAccountError(reply, error);
    }
  });

  app.put<{ Params: { credentialId: string } }>("/account/credentials/:credentialId/label", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(request, allowedOrigin)) {
      return reply.status(403).send({ error: "ACCOUNT_ORIGIN_FORBIDDEN" });
    }
    const parsed = credentialLabelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST" });
    }
    if (!accountSelfService) {
      return reply.status(503).send({ error: "ACCOUNT_MANAGEMENT_UNAVAILABLE" });
    }
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const delegated = await hubAuth.getAccountAccess(sessionToken);
      await accountSelfService.setCredentialLabel(
        delegated.accessToken,
        request.params.credentialId,
        parsed.data.label,
      );
      return reply.send({ updated: true });
    } catch (error) {
      return sendAccountError(reply, error);
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
