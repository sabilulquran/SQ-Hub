import { createServer, type Server } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createKeycloakMachineTokenVerifier } from "../src/modules/application-access/machine-auth.js";

let server: Server;
let issuer: string;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
const audience = "sq-hub-api-staging";
const kid = "test-key";

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  Object.assign(jwk, { kid, alg: "RS256", use: "sig" });

  server = createServer((request, response) => {
    if (request.url?.endsWith("/protocol/openid-connect/certs")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind TCP port");
  issuer = `http://127.0.0.1:${address.port}/realms/test`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function token(input: { aud?: string; azp?: string; iss?: string } = {}) {
  return new SignJWT({ azp: input.azp ?? "hcis-api-staging" })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(input.iss ?? issuer)
    .setAudience(input.aud ?? audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("Keycloak machine token verifier", () => {
  it("accepts an allowed client with expected issuer and audience", async () => {
    const verify = createKeycloakMachineTokenVerifier({
      issuer,
      audience,
      allowedClients: new Set(["hcis-api-staging"]),
    });

    await expect(verify(await token())).resolves.toEqual({ clientId: "hcis-api-staging" });
  });

  it("rejects the wrong audience as an invalid token", async () => {
    const verify = createKeycloakMachineTokenVerifier({
      issuer,
      audience,
      allowedClients: new Set(["hcis-api-staging"]),
    });

    await expect(verify(await token({ aud: "other-api" }))).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
  });

  it("rejects a valid token from a non-allowlisted client", async () => {
    const verify = createKeycloakMachineTokenVerifier({
      issuer,
      audience,
      allowedClients: new Set(["hcis-api-staging"]),
    });

    await expect(verify(await token({ azp: "unknown-client" }))).rejects.toMatchObject({
      code: "FORBIDDEN_CLIENT",
    });
  });
});
