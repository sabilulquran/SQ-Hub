import { describe, expect, it } from "vitest";

import type {
  HubOidcAction,
  HubOidcAuthorizationTransaction,
  HubOidcProviderLike,
} from "../src/modules/hub-auth/oidc-provider.js";
import type {
  HubAuthStore,
  HubRequestContext,
  HubSessionIdentity,
  HubSessionRecord,
} from "../src/modules/hub-auth/repository.js";
import {
  HUB_OIDC_TRANSACTION_COOKIE_NAME,
  HUB_SESSION_COOKIE_NAME,
  HubAuthService,
} from "../src/modules/hub-auth/service.js";
import { HubTokenVault } from "../src/modules/hub-auth/token-vault.js";
import type {
  HubWorkspaceApplication,
  HubWorkspaceApplicationSource,
} from "../src/modules/hub-auth/workspace-repository.js";

const context: HubRequestContext = {
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
};

class MemoryStore implements HubAuthStore {
  transaction: {
    tokenHash: string;
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  } | null = null;
  session: {
    tokenHash: string;
    identity: HubSessionIdentity;
    record: HubSessionRecord;
  } | null = null;
  revokedHash: string | null = null;
  rotatedCiphertext: string | null = null;

  async createTransaction(input: {
    tokenHash: string;
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  }) {
    this.transaction = input;
  }

  async consumeTransaction(tokenHash: string) {
    if (!this.transaction || this.transaction.tokenHash !== tokenHash) return null;
    const current = this.transaction;
    this.transaction = null;
    return {
      transaction: current.transaction,
      expiresAt: current.expiresAt,
    };
  }

  async createSession(input: {
    tokenHash: string;
    identity: HubSessionIdentity;
    accountRefreshTokenCiphertext: string | null;
    expiresAt: Date;
    context: HubRequestContext;
  }) {
    const record: HubSessionRecord = {
      sessionId: "session-001",
      issuer: input.identity.issuer,
      subject: input.identity.subject,
      displayName: input.identity.displayName,
      username: input.identity.username,
      email: input.identity.email,
      emailVerified: input.identity.emailVerified,
      accountRefreshTokenCiphertext: input.accountRefreshTokenCiphertext,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
    };
    this.session = { tokenHash: input.tokenHash, identity: input.identity, record };
    return record;
  }

  async getSession(tokenHash: string) {
    return this.session?.tokenHash === tokenHash ? this.session.record : null;
  }

  async updateAccountRefreshToken(sessionId: string, ciphertext: string) {
    if (this.session?.record.sessionId !== sessionId) return;
    this.rotatedCiphertext = ciphertext;
    this.session.record.accountRefreshTokenCiphertext = ciphertext;
  }

  async revokeSession(tokenHash: string) {
    this.revokedHash = tokenHash;
  }
}

class FakeOidcProvider implements HubOidcProviderLike {
  readonly transaction = {
    state: "state-001",
    codeVerifier: "verifier-001",
    nonce: "nonce-001",
  };
  completedWith: HubOidcAuthorizationTransaction | null = null;
  requestedAction: HubOidcAction | undefined;
  refreshInput: string | null = null;

  async createAuthorizationRequest(action?: HubOidcAction) {
    this.requestedAction = action;
    return {
      url: new URL("https://login.example.test/authorize"),
      transaction: this.transaction,
    };
  }

  async completeAuthorization(
    _currentUrl: URL,
    transaction: HubOidcAuthorizationTransaction,
  ) {
    this.completedWith = transaction;
    return {
      identity: {
        issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
        subject: "opaque-subject",
        displayName: "SQ Hub UAT",
        username: "19870001",
        email: "uat@example.test",
        emailVerified: true,
      },
      refreshToken: "refresh-token-plaintext",
    };
  }

  async refreshAccountAccess(refreshToken: string) {
    this.refreshInput = refreshToken;
    return {
      accessToken: "short-lived-account-access",
      refreshToken: "rotated-refresh-token",
    };
  }

  async buildLogoutUrl() {
    return new URL("https://login.example.test/logout");
  }
}

class FakeWorkspaceSource implements HubWorkspaceApplicationSource {
  applications: HubWorkspaceApplication[] = [
    {
      applicationKey: "hcis",
      name: "HCIS",
      canonicalUrl: "https://hcis-staging.sabilulquran.or.id",
    },
  ];

  async listAuthorizedApplications() {
    return this.applications;
  }
}

function service(platformAdministration = false) {
  const store = new MemoryStore();
  const provider = new FakeOidcProvider();
  const workspace = new FakeWorkspaceSource();
  const vault = new HubTokenVault("synthetic-client-secret-for-tests");
  const auth = new HubAuthService(
    store,
    provider,
    workspace,
    {
      sessionIdleHours: 8,
      sessionMaxHours: 12,
      transactionTtlMinutes: 10,
      secureCookies: true,
    },
    vault,
    {
      canUseAdmin: async () => platformAdministration,
    },
  );
  return { auth, store, provider, vault };
}

function cookieValue(setCookie: string, name: string) {
  const first = setCookie.split(";", 1)[0] ?? "";
  const prefix = `${name}=`;
  if (!first.startsWith(prefix)) throw new Error(`missing ${name} cookie`);
  return first.slice(prefix.length);
}

describe("HubAuthService", () => {
  it("keeps OIDC transaction material server-side behind an opaque secure cookie", async () => {
    const { auth, store } = service();
    const result = await auth.beginLogin(undefined, "/account");
    const rawCookie = cookieValue(result.setCookie, HUB_OIDC_TRANSACTION_COOKIE_NAME);

    expect(result.authorizationUrl.href).toBe("https://login.example.test/authorize");
    expect(result.setCookie).toContain("HttpOnly");
    expect(result.setCookie).toContain("SameSite=Lax");
    expect(result.setCookie).toContain("Secure");
    expect(result.setCookie).not.toContain("state-001");
    expect(result.setCookie).not.toContain("verifier-001");
    expect(store.transaction?.transaction.returnPath).toBe("/account");
    expect(store.transaction?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.transaction?.tokenHash).not.toBe(rawCookie);
  });

  it("passes only typed account actions into the OIDC provider", async () => {
    const { auth, provider } = service();

    await auth.beginLogin("UPDATE_PASSWORD", "/account");

    expect(provider.requestedAction).toBe("UPDATE_PASSWORD");
  });

  it("encrypts delegated refresh token at rest and returns only opaque Hub cookies", async () => {
    const { auth, store, provider, vault } = service();
    const begin = await auth.beginLogin(undefined, "/account");
    const transactionToken = cookieValue(begin.setCookie, HUB_OIDC_TRANSACTION_COOKIE_NAME);

    const completed = await auth.completeLogin(
      new URL("https://hub-staging.sabilulquran.or.id/auth/callback?code=opaque&state=state-001"),
      transactionToken,
      context,
    );

    expect(provider.completedWith?.returnPath).toBe("/account");
    expect(store.transaction).toBeNull();
    expect(store.session?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.session?.identity.subject).toBe("opaque-subject");
    expect(store.session?.identity.username).toBe("19870001");
    expect(store.session?.record.accountRefreshTokenCiphertext).toBeTruthy();
    expect(store.session?.record.accountRefreshTokenCiphertext).not.toContain(
      "refresh-token-plaintext",
    );
    expect(
      vault.open(store.session!.record.accountRefreshTokenCiphertext!),
    ).toBe("refresh-token-plaintext");
    expect(completed.returnPath).toBe("/account");
    expect(completed.setCookies[0]).toContain(`${HUB_SESSION_COOKIE_NAME}=`);
    expect(completed.setCookies[0]).toContain("HttpOnly");
    expect(completed.setCookies[0]).not.toContain("opaque-subject");
    expect(completed.setCookies.join(";")).not.toContain("refresh-token-plaintext");

    await expect(
      auth.completeLogin(
        new URL("https://hub-staging.sabilulquran.or.id/auth/callback"),
        transactionToken,
        context,
      ),
    ).rejects.toMatchObject({ code: "OIDC_TRANSACTION_EXPIRED" });
  });

  it("preserves the native account return path when a provider action fails", async () => {
    const { auth, provider } = service();
    const begin = await auth.beginLogin("UPDATE_PASSWORD", "/account");
    const transactionToken = cookieValue(begin.setCookie, HUB_OIDC_TRANSACTION_COOKIE_NAME);
    provider.completeAuthorization = async () => {
      throw new Error("synthetic provider cancellation");
    };

    await expect(
      auth.completeLogin(
        new URL("https://hub-staging.sabilulquran.or.id/auth/callback?error=access_denied"),
        transactionToken,
        context,
      ),
    ).rejects.toMatchObject({
      code: "OIDC_COMPLETION_FAILED",
      returnPath: "/account",
    });
  });

  it("refreshes delegated account access server-side and persists rotated refresh token encrypted", async () => {
    const { auth, store, provider, vault } = service();
    const begin = await auth.beginLogin(undefined, "/account");
    const transactionToken = cookieValue(begin.setCookie, HUB_OIDC_TRANSACTION_COOKIE_NAME);
    const completed = await auth.completeLogin(
      new URL("https://hub-staging.sabilulquran.or.id/auth/callback"),
      transactionToken,
      context,
    );
    const sessionToken = cookieValue(completed.setCookies[0]!, HUB_SESSION_COOKIE_NAME);

    const delegated = await auth.getAccountAccess(sessionToken);

    expect(delegated.accessToken).toBe("short-lived-account-access");
    expect(provider.refreshInput).toBe("refresh-token-plaintext");
    expect(store.rotatedCiphertext).toBeTruthy();
    expect(store.rotatedCiphertext).not.toContain("rotated-refresh-token");
    expect(vault.open(store.rotatedCiphertext!)).toBe("rotated-refresh-token");
  });

  it("requires reauthentication when an older Hub session has no delegated refresh token", async () => {
    const { auth, store } = service();
    const begin = await auth.beginLogin();
    const transactionToken = cookieValue(begin.setCookie, HUB_OIDC_TRANSACTION_COOKIE_NAME);
    const completed = await auth.completeLogin(
      new URL("https://hub-staging.sabilulquran.or.id/auth/callback"),
      transactionToken,
      context,
    );
    const sessionToken = cookieValue(completed.setCookies[0]!, HUB_SESSION_COOKIE_NAME);
    store.session!.record.accountRefreshTokenCiphertext = null;

    await expect(auth.getAccountAccess(sessionToken)).rejects.toMatchObject({
      statusCode: 428,
      code: "ACCOUNT_REAUTH_REQUIRED",
    });
  });

  it("returns a browser workspace without exposing delegated identity material", async () => {
    const { auth } = service(true);
    const begin = await auth.beginLogin();
    const transactionToken = cookieValue(begin.setCookie, HUB_OIDC_TRANSACTION_COOKIE_NAME);
    const completed = await auth.completeLogin(
      new URL("https://hub-staging.sabilulquran.or.id/auth/callback"),
      transactionToken,
      context,
    );
    const sessionToken = cookieValue(completed.setCookies[0]!, HUB_SESSION_COOKIE_NAME);

    const workspace = await auth.getWorkspace(sessionToken);
    expect(workspace).toEqual({
      user: { displayName: "SQ Hub UAT", initials: "SH" },
      applications: [
        {
          key: "hcis",
          name: "HCIS",
          canonicalUrl: "https://hcis-staging.sabilulquran.or.id",
        },
      ],
      capabilities: { platformAdministration: true },
    });
    expect(JSON.stringify(workspace)).not.toContain("opaque-subject");
    expect(JSON.stringify(workspace)).not.toContain("refresh-token");
  });

  it("rejects a missing Hub session and revokes an authenticated session on logout", async () => {
    const { auth, store } = service();
    await expect(auth.getWorkspace(null)).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHENTICATED",
    });

    const begin = await auth.beginLogin();
    const transactionToken = cookieValue(begin.setCookie, HUB_OIDC_TRANSACTION_COOKIE_NAME);
    const completed = await auth.completeLogin(
      new URL("https://hub-staging.sabilulquran.or.id/auth/callback"),
      transactionToken,
      context,
    );
    const sessionToken = cookieValue(completed.setCookies[0]!, HUB_SESSION_COOKIE_NAME);
    const result = await auth.logout(sessionToken, context);

    expect(store.revokedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.revokedHash).not.toBe(sessionToken);
    expect(result.clearCookie).toContain("Max-Age=0");
    expect(result.logoutUrl?.href).toBe("https://login.example.test/logout");
  });
});
