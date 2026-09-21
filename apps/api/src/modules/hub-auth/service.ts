import { createHash, randomBytes } from "node:crypto";

import type { HubOidcAction, HubOidcProviderLike } from "./oidc-provider.js";
import type {
  HubAuthStore,
  HubRequestContext,
  HubSessionRecord,
} from "./repository.js";
import { HubTokenVault } from "./token-vault.js";
import type { HubWorkspaceApplicationSource } from "./workspace-repository.js";

export const HUB_SESSION_COOKIE_NAME = "sq_hub_session";
export const HUB_OIDC_TRANSACTION_COOKIE_NAME = "sq_hub_oidc_tx";

export interface HubWorkspaceSnapshot {
  user: {
    displayName: string;
    initials: string;
  };
  applications: Array<{
    key: string;
    name: string;
    canonicalUrl: string;
  }>;
  capabilities: {
    platformAdministration: boolean;
  };
}

export class HubAuthError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly returnPath?: "/" | "/account",
  ) {
    super(message);
    this.name = "HubAuthError";
  }
}

export interface HubAuthRuntime {
  beginLogin(
    action?: HubOidcAction,
    returnPath?: "/" | "/account",
  ): Promise<{ authorizationUrl: URL; setCookie: string }>;
  completeLogin(
    callbackUrl: URL,
    transactionToken: string | null,
    context: HubRequestContext,
  ): Promise<{ setCookies: string[]; returnPath: "/" | "/account" }>;
  getWorkspace(sessionToken: string | null): Promise<HubWorkspaceSnapshot>;
  getSession(sessionToken: string | null): Promise<HubSessionRecord>;
  getAccountAccess(sessionToken: string | null): Promise<{
    session: HubSessionRecord;
    accessToken: string;
  }>;
  logout(
    sessionToken: string | null,
    context: HubRequestContext,
  ): Promise<{ clearCookie: string; logoutUrl: URL | null }>;
  clearTransactionCookie(): string;
}

export interface HubPlatformAdminCapabilitySource {
  canUseAdmin(session: HubSessionRecord): Promise<boolean>;
}

export class HubAuthService implements HubAuthRuntime {
  private readonly idleSeconds: number;
  private readonly maxSeconds: number;
  private readonly transactionTtlMs: number;
  private readonly secureCookies: boolean;

  constructor(
    private readonly repository: HubAuthStore,
    private readonly oidcProvider: HubOidcProviderLike,
    private readonly workspaceApplications: HubWorkspaceApplicationSource,
    options: {
      sessionIdleHours: number;
      sessionMaxHours: number;
      transactionTtlMinutes: number;
      secureCookies: boolean;
    },
    private readonly tokenVault: HubTokenVault,
    private readonly platformAdmin?: HubPlatformAdminCapabilitySource,
  ) {
    this.idleSeconds = options.sessionIdleHours * 60 * 60;
    this.maxSeconds = options.sessionMaxHours * 60 * 60;
    this.transactionTtlMs = options.transactionTtlMinutes * 60 * 1000;
    this.secureCookies = options.secureCookies;
  }

  async beginLogin(
    action?: HubOidcAction,
    returnPath: "/" | "/account" = "/",
  ): Promise<{ authorizationUrl: URL; setCookie: string }> {
    const request = await this.oidcProvider.createAuthorizationRequest(action);
    const transactionToken = generateOpaqueToken();
    await this.repository.createTransaction({
      tokenHash: hashOpaqueToken(transactionToken),
      transaction: {
        ...request.transaction,
        returnPath,
      },
      expiresAt: new Date(Date.now() + this.transactionTtlMs),
    });

    return {
      authorizationUrl: request.url,
      setCookie: buildCookie(
        HUB_OIDC_TRANSACTION_COOKIE_NAME,
        transactionToken,
        Math.floor(this.transactionTtlMs / 1000),
        this.secureCookies,
      ),
    };
  }

  async completeLogin(
    callbackUrl: URL,
    transactionToken: string | null,
    context: HubRequestContext,
  ): Promise<{ setCookies: string[]; returnPath: "/" | "/account" }> {
    if (!transactionToken) {
      throw new HubAuthError(400, "OIDC_TRANSACTION_MISSING", "Transaksi masuk tidak ditemukan.");
    }

    const stored = await this.repository.consumeTransaction(hashOpaqueToken(transactionToken));
    if (!stored || stored.expiresAt.getTime() <= Date.now()) {
      throw new HubAuthError(400, "OIDC_TRANSACTION_EXPIRED", "Transaksi masuk sudah berakhir.");
    }

    let completed;
    try {
      completed = await this.oidcProvider.completeAuthorization(
        callbackUrl,
        stored.transaction,
      );
    } catch {
      throw new HubAuthError(
        400,
        "OIDC_COMPLETION_FAILED",
        "Proses masuk Akun SQ belum dapat diselesaikan.",
        stored.transaction.returnPath ?? "/",
      );
    }
    const sessionToken = generateOpaqueToken();
    const encryptedRefreshToken = completed.refreshToken
      ? this.tokenVault.seal(completed.refreshToken)
      : null;

    await this.repository.createSession({
      tokenHash: hashOpaqueToken(sessionToken),
      identity: completed.identity,
      accountRefreshTokenCiphertext: encryptedRefreshToken,
      expiresAt: new Date(Date.now() + this.maxSeconds * 1000),
      context,
    });

    return {
      returnPath: stored.transaction.returnPath ?? "/",
      setCookies: [
        buildCookie(
          HUB_SESSION_COOKIE_NAME,
          sessionToken,
          this.maxSeconds,
          this.secureCookies,
        ),
        clearCookie(HUB_OIDC_TRANSACTION_COOKIE_NAME, this.secureCookies),
      ],
    };
  }

  async getWorkspace(sessionToken: string | null): Promise<HubWorkspaceSnapshot> {
    const session = await this.getRequiredSession(sessionToken);
    const applications = await this.workspaceApplications.listAuthorizedApplications({
      issuer: session.issuer,
      subject: session.subject,
    });
    const platformAdministration = this.platformAdmin
      ? await this.platformAdmin.canUseAdmin(session)
      : false;

    return {
      user: {
        displayName: session.displayName,
        initials: initialsFromDisplayName(session.displayName),
      },
      applications: applications.map((application) => ({
        key: application.applicationKey,
        name: application.name,
        canonicalUrl: application.canonicalUrl,
      })),
      capabilities: {
        platformAdministration,
      },
    };
  }

  getSession(sessionToken: string | null): Promise<HubSessionRecord> {
    return this.getRequiredSession(sessionToken);
  }

  async getAccountAccess(sessionToken: string | null): Promise<{
    session: HubSessionRecord;
    accessToken: string;
  }> {
    const session = await this.getRequiredSession(sessionToken);
    if (!session.accountRefreshTokenCiphertext) {
      throw new HubAuthError(
        428,
        "ACCOUNT_REAUTH_REQUIRED",
        "Masuk ulang diperlukan untuk mengelola Akun SQ.",
      );
    }

    let refreshToken: string;
    try {
      refreshToken = this.tokenVault.open(session.accountRefreshTokenCiphertext);
    } catch {
      throw new HubAuthError(
        428,
        "ACCOUNT_REAUTH_REQUIRED",
        "Sesi kelola akun tidak dapat digunakan lagi.",
      );
    }

    try {
      const refreshed = await this.oidcProvider.refreshAccountAccess(refreshToken);
      if (refreshed.refreshToken && refreshed.refreshToken !== refreshToken) {
        const ciphertext = this.tokenVault.seal(refreshed.refreshToken);
        await this.repository.updateAccountRefreshToken(session.sessionId, ciphertext);
      }
      return { session, accessToken: refreshed.accessToken };
    } catch {
      throw new HubAuthError(
        428,
        "ACCOUNT_REAUTH_REQUIRED",
        "Masuk ulang diperlukan untuk memperbarui izin kelola akun.",
      );
    }
  }

  async logout(
    sessionToken: string | null,
    context: HubRequestContext,
  ): Promise<{ clearCookie: string; logoutUrl: URL | null }> {
    if (sessionToken) {
      await this.repository.revokeSession(hashOpaqueToken(sessionToken), context);
    }

    const logoutUrl = await this.oidcProvider.buildLogoutUrl().catch(() => null);

    return {
      clearCookie: clearCookie(HUB_SESSION_COOKIE_NAME, this.secureCookies),
      logoutUrl,
    };
  }

  clearTransactionCookie(): string {
    return clearCookie(HUB_OIDC_TRANSACTION_COOKIE_NAME, this.secureCookies);
  }

  private async getRequiredSession(sessionToken: string | null): Promise<HubSessionRecord> {
    if (!sessionToken) {
      throw new HubAuthError(401, "UNAUTHENTICATED", "Sesi SQ Hub tidak ditemukan.");
    }
    const session = await this.repository.getSession(
      hashOpaqueToken(sessionToken),
      this.idleSeconds,
    );
    if (!session) {
      throw new HubAuthError(401, "UNAUTHENTICATED", "Sesi SQ Hub sudah berakhir.");
    }
    return session;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=") || null;
  }
  return null;
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function buildCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const securePart = secure ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${securePart}`;
}

function clearCookie(name: string, secure: boolean): string {
  const securePart = secure ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${securePart}`;
}

function initialsFromDisplayName(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "SQ";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}
