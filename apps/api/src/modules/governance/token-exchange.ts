/**
 * Keycloak standard token exchange (RFC 8693, Keycloak "token-exchange-standard:v2") from the
 * user's Hub access token to a short-lived access token for one governance audience
 * (ADR-0009, HUB-IMPL-021 §4). No refresh token is requested; the exchanged token is used for
 * one server-side request and never stored, logged or sent to the browser.
 */
export interface TokenExchanger {
  exchange(subjectToken: string, audience: string, signal: AbortSignal): Promise<string>;
}

/**
 * The audience of each target application is made available to Hub through an optional
 * client scope with this prefix (see docs/operations/HUB-IMPL-021-token-exchange.md). Keycloak's
 * `audience` parameter only filters audiences, so the scope must be requested explicitly.
 */
export const GOVERNANCE_SCOPE_PREFIX = "sq-governance-";

export class TokenExchangeError extends Error {
  constructor(public readonly status: number | "network") {
    super(`token exchange failed (${status})`);
    this.name = "TokenExchangeError";
  }
}

export class KeycloakTokenExchanger implements TokenExchanger {
  private readonly tokenEndpoint: string;

  constructor(
    private readonly config: {
      issuer: string;
      clientId: string;
      clientSecret: string;
      fetch?: typeof fetch;
    },
  ) {
    this.tokenEndpoint = `${config.issuer.replace(/\/+$/, "")}/protocol/openid-connect/token`;
  }

  async exchange(subjectToken: string, audience: string, signal: AbortSignal): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      subject_token: subjectToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience,
      scope: `${GOVERNANCE_SCOPE_PREFIX}${audience}`,
    });
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(this.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        redirect: "error",
        signal,
      });
    } catch {
      throw new TokenExchangeError("network");
    }
    if (!response.ok) throw new TokenExchangeError(response.status);
    const parsed = (await response.json().catch(() => null)) as { access_token?: unknown; token_type?: unknown } | null;
    if (!parsed || typeof parsed.access_token !== "string" || !parsed.access_token) {
      throw new TokenExchangeError(502);
    }
    return parsed.access_token;
  }
}
