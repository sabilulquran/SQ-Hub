import * as oidc from "openid-client";

export interface HubOidcProviderOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
}

declare const providerCredentialActionBrand: unique symbol;

export type ProviderCredentialAction = string & {
  readonly [providerCredentialActionBrand]: true;
};

const RESERVED_PROVIDER_CREDENTIAL_ACTIONS = new Set([
  "delete_account",
  "update_email",
]);

export function providerCredentialAction(
  value: string,
): ProviderCredentialAction | null {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) return null;
  if (RESERVED_PROVIDER_CREDENTIAL_ACTIONS.has(value.toLowerCase())) return null;
  return value as ProviderCredentialAction;
}

export type HubOidcAction =
  | "UPDATE_PASSWORD"
  | "UPDATE_EMAIL"
  | "CONFIGURE_TOTP"
  | "CONFIGURE_RECOVERY_AUTHN_CODES"
  | `idp_link:${string}`
  | `delete_credential:${string}`
  | ProviderCredentialAction;

/**
 * ADR-0012 D4: a decision in the Portal Organ Yayasan needs proof of TOTP that is both recent and
 * carried in the token, not merely a session that began with TOTP some hours ago. The request asks
 * Keycloak for a Level of Authentication and a maximum age, and the callback checks that what came
 * back actually meets them.
 */
export interface HubOidcStepUp {
  acr: string;
  maxAgeSeconds: number;
}

export interface HubOidcAuthorizationTransaction {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnPath?: "/" | "/account";
  replaceSessionTokenHash?: string;
  expectedIssuer?: string;
  expectedSubject?: string;
  stepUp?: HubOidcStepUp;
}

export interface HubOidcIdentity {
  issuer: string;
  subject: string;
  displayName: string;
  username: string | null;
  email: string | null;
  emailVerified: boolean | null;
}

export interface HubOidcCompletion {
  identity: HubOidcIdentity;
  refreshToken: string | null;
  /** The Level of Authentication the ID token reports, when it reports one. */
  acr: string | null;
  /** `auth_time` in seconds, the moment the realm says the person actually authenticated. */
  authTime: number | null;
}

export interface HubOidcProviderLike {
  createAuthorizationRequest(action?: HubOidcAction, stepUp?: HubOidcStepUp): Promise<{
    url: URL;
    transaction: HubOidcAuthorizationTransaction;
  }>;
  completeAuthorization(
    currentUrl: URL,
    transaction: HubOidcAuthorizationTransaction,
  ): Promise<HubOidcCompletion>;
  refreshAccountAccess(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
  }>;
  buildLogoutUrl(): Promise<URL>;
}

export class HubOidcProvider implements HubOidcProviderLike {
  private configurationPromise: Promise<oidc.Configuration> | null = null;
  private readonly issuer: string;

  constructor(private readonly options: HubOidcProviderOptions) {
    this.issuer = options.issuer.replace(/\/$/, "");
  }

  async createAuthorizationRequest(action?: HubOidcAction, stepUp?: HubOidcStepUp): Promise<{
    url: URL;
    transaction: HubOidcAuthorizationTransaction;
  }> {
    const configuration = await this.getConfiguration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.options.redirectUri,
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
      ...(action ? { kc_action: action } : {}),
      // `max_age` makes Keycloak re-authenticate when the session is older than the window,
      // and `acr_values` asks for the level TOTP reaches. Both are requests; the callback is
      // where they are enforced, because a realm is free to answer with less.
      ...(stepUp ? { acr_values: stepUp.acr, max_age: String(stepUp.maxAgeSeconds) } : {}),
    });

    return {
      url,
      transaction: { state, codeVerifier, nonce, ...(stepUp ? { stepUp } : {}) },
    };
  }

  async completeAuthorization(
    currentUrl: URL,
    transaction: HubOidcAuthorizationTransaction,
  ): Promise<HubOidcCompletion> {
    const configuration = await this.getConfiguration();
    const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
      // openid-client checks `auth_time` against this itself and refuses a stale one, so a
      // realm that ignores max_age cannot pass a long-standing session off as a fresh login.
      ...(transaction.stepUp ? { maxAge: transaction.stepUp.maxAgeSeconds } : {}),
    });
    const claims = tokens.claims();

    if (!claims || claims.iss !== this.issuer || typeof claims.sub !== "string" || !claims.sub) {
      throw new Error("OIDC identity claims are invalid");
    }

    const claimValues = claims as Record<string, unknown>;
    const name = typeof claimValues.name === "string" ? claimValues.name.trim() : "";
    const preferredUsername =
      typeof claimValues.preferred_username === "string"
        ? claimValues.preferred_username.trim()
        : "";
    const displayName = name || preferredUsername;
    if (!displayName) throw new Error("OIDC profile display name is missing");

    const email =
      typeof claimValues.email === "string" && claimValues.email.trim()
        ? claimValues.email.trim()
        : null;
    const emailVerified =
      typeof claimValues.email_verified === "boolean"
        ? claimValues.email_verified
        : null;

    return {
      identity: {
        issuer: this.issuer,
        subject: claims.sub,
        displayName,
        username: preferredUsername || null,
        email,
        emailVerified,
      },
      acr: typeof claimValues.acr === "string" ? claimValues.acr : null,
      authTime: typeof claimValues.auth_time === "number" ? claimValues.auth_time : null,
      refreshToken:
        typeof tokens.refresh_token === "string" && tokens.refresh_token
          ? tokens.refresh_token
          : null,
    };
  }

  async refreshAccountAccess(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
  }> {
    const configuration = await this.getConfiguration();
    const tokens = await oidc.refreshTokenGrant(configuration, refreshToken);
    if (typeof tokens.access_token !== "string" || !tokens.access_token) {
      throw new Error("OIDC refresh response did not contain an access token");
    }

    return {
      accessToken: tokens.access_token,
      refreshToken:
        typeof tokens.refresh_token === "string" && tokens.refresh_token
          ? tokens.refresh_token
          : null,
    };
  }

  async buildLogoutUrl(): Promise<URL> {
    const configuration = await this.getConfiguration();
    return oidc.buildEndSessionUrl(configuration, {
      post_logout_redirect_uri: this.options.postLogoutRedirectUri,
    });
  }

  private async getConfiguration(): Promise<oidc.Configuration> {
    if (!this.configurationPromise) {
      this.configurationPromise = oidc
        .discovery(new URL(this.issuer), this.options.clientId, this.options.clientSecret)
        .catch((error: unknown) => {
          this.configurationPromise = null;
          throw error;
        });
    }
    return this.configurationPromise;
  }
}
