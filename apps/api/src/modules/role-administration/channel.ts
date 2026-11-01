/**
 * HTTP leg of HUB-IMPL-023 §2: the HCIS role-administration channel. Every call carries two
 * proofs that never substitute for each other — a client-credentials token of the machine client
 * `sq-hub-role-administration` ("where from") and a one-use actor assertion ("who").
 *
 * Neither token is logged, stored or returned; this module only reports status and HCIS's error
 * code to its caller.
 */

/** Client scope that Keycloak puts on the machine client by default (K-2); HCIS requires it. */
export const MACHINE_SCOPE = "role-administration.manage";

export const CHANNEL_PREFIX = "internal/v1/role-administration";

const MAX_BODY_BYTES = 256 * 1024;

export interface ChannelRequest {
  method: "GET" | "POST" | "DELETE";
  /** Path below `/internal/v1/role-administration/`, already built from validated ids. */
  path: string;
  body?: Record<string, unknown>;
}

export interface ChannelResponse {
  status: number;
  body: unknown;
}

export interface RoleAdministrationChannel {
  machineToken(signal: AbortSignal): Promise<string>;
  send(request: ChannelRequest, proofs: { machineToken: string; actorAssertion: string }, signal: AbortSignal): Promise<ChannelResponse>;
}

export class ChannelUnavailableError extends Error {
  constructor(public readonly stage: "machine_token" | "network" | "invalid_body") {
    super(`HCIS role-administration channel unavailable (${stage})`);
    this.name = "ChannelUnavailableError";
  }
}

export class HcisRoleAdministrationChannel implements RoleAdministrationChannel {
  private readonly tokenEndpoint: string;
  private readonly baseUrl: string;

  constructor(
    private readonly config: {
      issuer: string;
      hcisBaseUrl: string;
      clientId: string;
      clientSecret: string;
      fetch?: typeof fetch;
    },
  ) {
    this.tokenEndpoint = `${config.issuer.replace(/\/+$/, "")}/protocol/openid-connect/token`;
    this.baseUrl = `${config.hcisBaseUrl.replace(/\/+$/, "")}/`;
  }

  async machineToken(signal: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(this.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: MACHINE_SCOPE,
        }),
        redirect: "error",
        signal,
      });
    } catch {
      throw new ChannelUnavailableError("machine_token");
    }
    if (!response.ok) throw new ChannelUnavailableError("machine_token");
    const parsed = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!parsed || typeof parsed.access_token !== "string" || !parsed.access_token) {
      throw new ChannelUnavailableError("machine_token");
    }
    return parsed.access_token;
  }

  async send(
    request: ChannelRequest,
    proofs: { machineToken: string; actorAssertion: string },
    signal: AbortSignal,
  ): Promise<ChannelResponse> {
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(new URL(`${CHANNEL_PREFIX}/${request.path}`, this.baseUrl), {
        method: request.method,
        headers: {
          Authorization: `Bearer ${proofs.machineToken}`,
          "X-SQ-Actor-Assertion": proofs.actorAssertion,
          Accept: "application/json",
          ...(request.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        redirect: "error",
        signal,
      });
    } catch {
      throw new ChannelUnavailableError("network");
    }
    if (response.status === 204) {
      await response.body?.cancel().catch(() => undefined);
      return { status: 204, body: null };
    }
    let body: unknown = null;
    if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      try {
        body = JSON.parse(await readLimited(response, MAX_BODY_BYTES));
      } catch {
        throw new ChannelUnavailableError("invalid_body");
      }
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
    return { status: response.status, body };
  }
}

async function readLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}
