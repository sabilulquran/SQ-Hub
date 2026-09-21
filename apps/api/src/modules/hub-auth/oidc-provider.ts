import * as oidc from "openid-client";

export interface HubOidcProviderOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
}

export type HubOidcAction =
  | "UPDATE_PASSWORD"
  | "CONFIGURE_TOTP"
  | "CONFIGURE_RECOVERY_AUTHN_CODES";

export interface HubOidcAuthorizationTransaction {
  state: string;
  codeVerifier: string;
  nonce: string;
}

export interface HubOidcIdentity {
  issuer: string;
  subject: string;
  displayName: string;
}

export interface HubOidcProviderLike {
  createAuthorizationRequest(action?: HubOidcAction): Promise<{
    url: URL;
    transaction: HubOidcAuthorizationTransaction;
  }>;
  completeAuthorization(
    currentUrl: URL,
    transaction: HubOidcAuthorizationTransaction,
  ): Promise<HubOidcIdentity>;
  buildLogoutUrl(): Promise<URL>;
}

export class HubOidcProvider implements HubOidcProviderLike {
  private configurationPromise: Promise<oidc.Configuration> | null = null;
  private readonly issuer: string;

  constructor(private readonly options: HubOidcProviderOptions) {
    this.issuer = options.issuer.replace(/\/$/, "");
  }

  async createAuthorizationRequest(action?: HubOidcAction): Promise<{
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
      scope: "openid profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
      ...(action ? { kc_action: action } : {}),
    });

    return {
      url,
      transaction: { state, codeVerifier, nonce },
    };
  }

  async completeAuthorization(
    currentUrl: URL,
    transaction: HubOidcAuthorizationTransaction,
  ): Promise<HubOidcIdentity> {
    const configuration = await this.getConfiguration();
    const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
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

    return {
      issuer: this.issuer,
      subject: claims.sub,
      displayName,
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
