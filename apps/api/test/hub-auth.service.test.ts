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
    expiresAt: Date;
    context: HubRequestContext;
  }) {
    const record: HubSessionRecord = {
      sessionId: "session-001",
      issuer: input.identity.issuer,
      subject: input.identity.subject,
      displayName: input.identity.displayName,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
    };
    this.session = { tokenHash: input.tokenHash, identity: input.identity, record };
    return record;
  }

  async getSession(tokenHash: string) {
    return this.session?.tokenHash === tokenHash ? this.session.record : null;
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
      issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
      subject: "opaque-subject",
      displayName: "SQ Hub UAT",
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
    {
      canUseAdmin: async () => platformAdministration,
    },
  );
  return { auth, store, provider };
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
    const result = await auth.beginLogin();
    const rawCookie = cookieValue(result.setCookie, HUB_OIDC_TRANSACTION_COOKIE_NAME);

    expect(result.authorizationUrl.href).toBe("https://login.example.test/authorize");
    expect(result.setCookie).toContain("HttpOnly");
    expect(result.setCookie).toContain("SameSite=Lax");
    expect(result.setCookie).toContain("Secure");
    expect(result.setCookie).not.toContain("state-001");
    expect(result.setCookie).not.toContain("verifier-001");
    expect(store.transaction?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.transaction?.tokenHash).not.toBe(rawCookie);
  });

  it("passes only typed account actions into the OIDC provider", async () => {
    const { auth, provider } = service();

    await auth.beginLogin("UPDATE_PASSWORD");

    expect(provider.requestedAction).toBe("UPDATE_PASSWORD");
  });

  it("consumes the transaction once and creates only an opaque Hub session cookie", async () => {
    const { auth, store, provider } = service();
    const begin = await auth.beginLogin();
    const transactionToken = cookieValue(begin.setCookie, HUB_OIDC_TRANSACTION_COOKIE_NAME);

    const completed = await auth.completeLogin(
      new URL("https://hub-staging.sabilulquran.or.id/auth/callback?code=opaque&state=state-001"),
      transactionToken,
      context,
    );

    expect(provider.completedWith).toEqual(provider.transaction);
    expect(store.transaction).toBeNull();
    expect(store.session?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.session?.identity.subject).toBe("opaque-subject");
    expect(completed.setCookies[0]).toContain(`${HUB_SESSION_COOKIE_NAME}=`);
    expect(completed.setCookies[0]).toContain("HttpOnly");
    expect(completed.setCookies[0]).not.toContain("opaque-subject");
    expect(completed.setCookies[1]).toContain(`${HUB_OIDC_TRANSACTION_COOKIE_NAME}=`);
    expect(completed.setCookies[1]).toContain("Max-Age=0");

    await expect(
      auth.completeLogin(new URL("https://hub-staging.sabilulquran.or.id/auth/callback"), transactionToken, context),
    ).rejects.toMatchObject({ code: "OIDC_TRANSACTION_EXPIRED" });
  });

  it("returns a browser workspace without exposing the opaque OIDC subject", async () => {
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
