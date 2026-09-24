import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createKeycloakMachineTokenVerifier } from "../src/modules/application-access/machine-auth.js";

let server: Server;
let issuer: string;
let key: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true }); key = pair.privateKey;
  const jwk = { ...await exportJWK(pair.publicKey), kid: "directory-test", alg: "RS256", use: "sig" };
  server = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("no test port");
  issuer = `http://127.0.0.1:${address.port}/realms/synthetic`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); });

it.each(["valid", "audience", "issuer", "scope", "partial-scope", "client", "expired", "future", "no-exp", "conflicting-client", "client-id-only", "signature"])("enforces directory JWT policy: %s", async (kind) => {
  const verify = createKeycloakMachineTokenVerifier({ issuer, audience: "sq-hub-organization-directory", allowedClients: new Set(["aset-sq-directory"]), requiredScope: "organization-directory.read" });
  const payload: Record<string, unknown> = { azp: "aset-sq-directory", scope: "organization-directory.read" };
  if (kind === "client") payload.azp = "sq-hub-browser";
  if (kind === "scope") payload.scope = "openid";
  if (kind === "partial-scope") payload.scope = "prefix-organization-directory.read";
  if (kind === "conflicting-client") payload.client_id = "other-client";
  if (kind === "client-id-only") { delete payload.azp; payload.client_id = "aset-sq-directory"; }
  let jwt = new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "directory-test" })
    .setIssuer(kind === "issuer" ? "https://wrong.example.test" : issuer)
    .setAudience(kind === "audience" ? "hcis-organization-directory" : "sq-hub-organization-directory").setIssuedAt();
  if (kind !== "no-exp") jwt = jwt.setExpirationTime(kind === "expired" ? "-1m" : "5m");
  if (kind === "future") jwt = jwt.setNotBefore("5m");
  const signed = await jwt.sign(kind === "signature" ? (await generateKeyPair("RS256")).privateKey : key);
  if (kind === "valid" || kind === "client-id-only") await expect(verify(signed)).resolves.toEqual({ clientId: "aset-sq-directory" });
  else await expect(verify(signed)).rejects.toMatchObject({ code: ["scope", "partial-scope", "client", "conflicting-client"].includes(kind) ? "FORBIDDEN_CLIENT" : "INVALID_TOKEN" });
});
