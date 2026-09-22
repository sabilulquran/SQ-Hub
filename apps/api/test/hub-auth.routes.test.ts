import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { KeycloakAccountSelfService } from "../src/modules/account-self-service/client.js";
import type { HubOidcAction } from "../src/modules/hub-auth/oidc-provider.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import {
  IdentityDirectoryError,
  type IdentityDirectory,
} from "../src/modules/identity-directory/client.js";

const accountIssuer = "https://login.example.test/realms/staff";

const identityDirectory: IdentityDirectory = {
  issuer: accountIssuer,
  search: async () => [],
  inspect: async () => ({
    identity: { issuer: accountIssuer, subject: "synthetic-subject" },
    username: "19870001",
    email: "synthetic@example.test",
    emailVerified: true,
    displayName: "Ahmad Fikri",
    enabled: true,
    security: {
      totpConfigured: true,
      recoveryCodesConfigured: null,
    },
  }),
};

function appWithHub(
  hubAuth: HubAuthRuntime,
  directory: IdentityDirectory | undefined = identityDirectory,
  accountSelfService?: KeycloakAccountSelfService,
) {
  return buildApp({
    accessService: {
      checkAccess: async () => ({
        allowed: true,
        applicationKey: "hcis",
        decision: "active_grant",
      }),
    },
    verifyMachineToken: async () => ({ clientId: "hcis-api-staging" }),
    hubAuth,
    hubRedirectUri: "https://hub-staging.sabilulquran.or.id/auth/callback",
    identityDirectory: directory,
    accountSelfService,
  });
}

function fakeHub(overrides: Partial<HubAuthRuntime> = {}): HubAuthRuntime {
  return {
    beginLogin: async () => ({
      authorizationUrl: new URL("https://login.example.test/authorize"),
      setCookie: "sq_hub_oidc_tx=opaque; Path=/; HttpOnly; SameSite=Lax; Secure",
    }),
    completeLogin: async () => ({
      setCookies: [
        "sq_hub_session=opaque; Path=/; HttpOnly; SameSite=Lax; Secure",
        "sq_hub_oidc_tx=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
      ],
      returnPath: "/account",
    }),
    getWorkspace: async () => ({
      user: { displayName: "Ahmad Fikri", initials: "AF" },
      applications: [
        {
          key: "hcis",
          name: "HCIS",
          canonicalUrl: "https://hcis.example",
        },
      ],
      capabilities: { platformAdministration: false },
    }),
    getSession: async () => ({
      sessionId: "session-001",
      issuer: accountIssuer,
      subject: "synthetic-subject",
      displayName: "Ahmad Fikri",
      username: "19870001",
      email: "synthetic@example.test",
      emailVerified: true,
      accountRefreshTokenCiphertext: null,
      createdAt: new Date("2026-09-18T00:00:00Z"),
      expiresAt: new Date("2026-09-18T12:00:00Z"),
    }),
    getAccountAccess: async () => {
      throw new HubAuthError(428, "ACCOUNT_REAUTH_REQUIRED", "synthetic old session");
    },
    logout: async () => ({
      clearCookie: "sq_hub_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
      logoutUrl: new URL("https://login.example.test/logout"),
    }),
    clearTransactionCookie: () =>
      "sq_hub_oidc_tx=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SQ Hub browser auth routes", () => {
  it("starts OIDC with an opaque HttpOnly transaction cookie", async () => {
    const app = appWithHub(fakeHub());
    const response = await app.inject({ method: "GET", url: "/auth/oidc/start" });
    await app.close();

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://login.example.test/authorize");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
  });

  it("binds account reauthentication to the current Hub session", async () => {
    let replacementToken: string | null | undefined;
    const app = appWithHub(
      fakeHub({
        beginLogin: async (_action, _returnPath, replaceSessionToken) => {
          replacementToken = replaceSessionToken;
          return {
            authorizationUrl: new URL("https://login.example.test/authorize"),
            setCookie: "sq_hub_oidc_tx=opaque; Path=/; HttpOnly; SameSite=Lax; Secure",
          };
        },
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/auth/oidc/start?returnTo=account",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(302);
    expect(replacementToken).toBe("opaque");
  });

  it("returns the authorized workspace without an identity subject field", async () => {
    const app = appWithHub(fakeHub());
    const response = await app.inject({
      method: "GET",
      url: "/workspace",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { displayName: "Ahmad Fikri", initials: "AF" },
      applications: [{ key: "hcis", name: "HCIS" }],
      capabilities: { platformAdministration: false },
    });
    expect(response.body).not.toContain("subject");
  });

  it("uses 401 for a missing or expired Hub session", async () => {
    const app = appWithHub(
      fakeHub({
        getWorkspace: async () => {
          throw new HubAuthError(401, "UNAUTHENTICATED", "expired");
        },
      }),
    );
    const response = await app.inject({ method: "GET", url: "/workspace" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("serves native browser-safe account data instead of redirecting to provider Account Console", async () => {
    const app = appWithHub(fakeHub());
    const response = await app.inject({
      method: "GET",
      url: "/account",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers.location).toBeUndefined();
    expect(response.json()).toEqual({
      profile: {
        displayName: "Ahmad Fikri",
        username: "19870001",
        email: "synthetic@example.test",
        emailVerified: true,
        fields: [],
        supportedLocales: [],
      },
      security: {
        totpConfigured: true,
        recoveryCodesConfigured: null,
      },
      applications: [
        {
          key: "hcis",
          name: "HCIS",
          canonicalUrl: "https://hcis.example",
        },
      ],
      management: {
        available: false,
        reauthRequired: false,
        credentials: [],
        devices: [],
        applications: [],
        linkedAccounts: [],
        availableAccountLinks: [],
        groups: [],
      },
    });
    expect(response.body).not.toContain("synthetic-subject");
    expect(response.body).not.toContain("issuer");
    expect(response.body).not.toContain("/realms/");
  });

  it("requires a fresh delegated account session for older Hub sessions", async () => {
    const app = appWithHub(
      fakeHub(),
      identityDirectory,
      new KeycloakAccountSelfService(accountIssuer),
    );
    const response = await app.inject({
      method: "GET",
      url: "/account",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      management: {
        available: false,
        reauthRequired: true,
      },
    });
  });

  it("keeps native account usable when the identity directory is unavailable", async () => {
    const failingDirectory: IdentityDirectory = {
      issuer: accountIssuer,
      search: async () => [],
      inspect: async () => {
        throw new IdentityDirectoryError("synthetic directory outage");
      },
    };
    const app = appWithHub(fakeHub(), failingDirectory);
    const response = await app.inject({
      method: "GET",
      url: "/account",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      profile: {
        displayName: "Ahmad Fikri",
        username: "19870001",
        email: "synthetic@example.test",
        emailVerified: true,
        fields: [],
      },
      security: {
        totpConfigured: null,
        recoveryCodesConfigured: null,
      },
      applications: [
        {
          key: "hcis",
          name: "HCIS",
          canonicalUrl: "https://hcis.example",
        },
      ],
    });
  });

  it("keeps native account usable for an older session without optional profile claims", async () => {
    const app = appWithHub(
      fakeHub({
        getSession: async () => ({
          sessionId: "session-legacy",
          issuer: accountIssuer,
          subject: "synthetic-subject",
          displayName: "Ahmad Fikri",
          username: null,
          email: null,
          emailVerified: null,
          accountRefreshTokenCiphertext: null,
          createdAt: new Date("2026-09-18T00:00:00Z"),
          expiresAt: new Date("2026-09-18T12:00:00Z"),
        }),
      }),
      {
        issuer: accountIssuer,
        search: async () => [],
        inspect: async () => {
          throw new IdentityDirectoryError("synthetic directory outage");
        },
      },
    );
    const response = await app.inject({
      method: "GET",
      url: "/account",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      profile: {
        displayName: "Ahmad Fikri",
        username: null,
        email: null,
        emailVerified: null,
        fields: [],
      },
      security: {
        totpConfigured: null,
        recoveryCodesConfigured: null,
      },
    });
  });

  it("requires a valid Hub session before returning native account data", async () => {
    const app = appWithHub(
      fakeHub({
        getSession: async () => {
          throw new HubAuthError(401, "UNAUTHENTICATED", "expired");
        },
      }),
    );
    const response = await app.inject({ method: "GET", url: "/account" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("starts UPDATE_EMAIL only after same-origin and provider metadata validation", async () => {
    let requestedAction: HubOidcAction | undefined;
    const accountSelfService = new KeycloakAccountSelfService(accountIssuer);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            email: "synthetic@example.test",
            attributes: {},
            userProfileMetadata: {
              attributes: [
                {
                  name: "email",
                  displayName: "email",
                  readOnly: false,
                  required: true,
                  multivalued: false,
                  annotations: { "kc.required.action.supported": true },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const app = appWithHub(
      fakeHub({
        getAccountAccess: async () => ({
          session: await fakeHub().getSession("opaque"),
          accessToken: "short-lived-account-access",
        }),
        beginLogin: async (action) => {
          requestedAction = action;
          return {
            authorizationUrl: new URL("https://login.example.test/authorize"),
            setCookie: "sq_hub_oidc_tx=opaque; Path=/; HttpOnly; SameSite=Lax; Secure",
          };
        },
      }),
      identityDirectory,
      accountSelfService,
    );

    const forbidden = await app.inject({
      method: "POST",
      url: "/account/profile/email/action",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(requestedAction).toBeUndefined();

    const accepted = await app.inject({
      method: "POST",
      url: "/account/profile/email/action",
      headers: {
        cookie: "sq_hub_session=opaque",
        origin: "https://hub-staging.sabilulquran.or.id",
      },
    });
    await app.close();

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      authorizationUrl: "https://login.example.test/authorize",
    });
    expect(requestedAction).toBe("UPDATE_EMAIL");
  });

  it("starts only the allowlisted password account action", async () => {
    let requestedAction: HubOidcAction | undefined;
    let replacementToken: string | null | undefined;
    const app = appWithHub(
      fakeHub({
        beginLogin: async (action, _returnPath, replaceSessionToken) => {
          requestedAction = action;
          replacementToken = replaceSessionToken;
          return {
            authorizationUrl: new URL("https://login.example.test/authorize"),
            setCookie: "sq_hub_oidc_tx=opaque; Path=/; HttpOnly; SameSite=Lax; Secure",
          };
        },
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/auth/oidc/action/password",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://login.example.test/authorize");
    expect(requestedAction).toBe("UPDATE_PASSWORD");
    expect(replacementToken).toBe("opaque");
  });

  it("rejects arbitrary account actions before creating an OIDC transaction", async () => {
    let beginCalls = 0;
    const app = appWithHub(
      fakeHub({
        beginLogin: async () => {
          beginCalls += 1;
          return {
            authorizationUrl: new URL("https://login.example.test/authorize"),
            setCookie: "sq_hub_oidc_tx=opaque; Path=/; HttpOnly; SameSite=Lax; Secure",
          };
        },
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/auth/oidc/action/delete-account",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "ACCOUNT_ACTION_NOT_FOUND" });
    expect(beginCalls).toBe(0);
  });

  it("returns an account action callback to native Akun SQ", async () => {
    const app = appWithHub(fakeHub());
    const response = await app.inject({
      method: "GET",
      url: "/auth/callback?code=synthetic&state=synthetic&kc_action=UPDATE_PASSWORD&kc_action_status=success",
      headers: { cookie: "sq_hub_oidc_tx=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/account");
  });

  it("returns a failed account action to native Akun SQ even without kc_action in callback", async () => {
    const app = appWithHub(
      fakeHub({
        completeLogin: async () => {
          throw new HubAuthError(
            400,
            "OIDC_COMPLETION_FAILED",
            "synthetic cancellation",
            "/account",
          );
        },
      }),
    );
    const response = await app.inject({
      method: "GET",
      url: "/auth/callback?error=access_denied&state=synthetic",
      headers: { cookie: "sq_hub_oidc_tx=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/account?authError=oidc_failed");
  });

  it("clears the local session and returns the official OIDC logout URL", async () => {
    const app = appWithHub(fakeHub());
    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(response.json()).toEqual({ logoutUrl: "https://login.example.test/logout" });
  });
});
