import * as oidc from "openid-client";
import { DirectorySyncError } from "./validation.js";

const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const DIRECTORY_SCOPE = "organization-directory.read";

export function createDirectoryPull(config: { issuer: string; sourceUrl: string; clientId: string; clientSecret: string }) {
  const issuer = config.issuer.replace(/\/$/, "");
  // Standard library grant against the configured Keycloak issuer; no human token reuse.
  const oauth = new oidc.Configuration({ issuer, token_endpoint: `${issuer}/protocol/openid-connect/token` }, config.clientId, config.clientSecret);
  oauth.timeout = 10;
  return async (asOf: string, attemptId: string): Promise<unknown> => {
    let token: string;
    try {
      token = (await oidc.clientCredentialsGrant(oauth, { scope: DIRECTORY_SCOPE })).access_token;
    } catch (error) {
      const transient = error instanceof oidc.ResponseBodyError && error.status >= 500;
      const unavailable = transient || error instanceof TypeError || (error instanceof oidc.ClientError && error.code === "OAUTH_TIMEOUT");
      throw new DirectorySyncError(unavailable ? "source_unavailable" : "source_auth");
    }
    const url = new URL("/internal/v1/organization-directory/snapshot", config.sourceUrl);
    url.searchParams.set("asOf", asOf);
    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json", "x-request-id": attemptId },
        redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new DirectorySyncError(response.status === 401 || response.status === 403 ? "source_auth"
          : response.status === 429 || response.status >= 500 ? "source_unavailable" : "source_request");
      }
      if (!response.headers.get("content-type")?.includes("application/json") || !response.body) {
        await response.body?.cancel();
        throw new DirectorySyncError("contract_validation");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_SNAPSHOT_BYTES) throw new DirectorySyncError("contract_validation");
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new DirectorySyncError("contract_validation"); }
    } catch (error) {
      if (error instanceof DirectorySyncError) throw error;
      throw new DirectorySyncError("source_unavailable");
    }
  };
}
