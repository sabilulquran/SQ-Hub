import { createServer, type Server } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createKeycloakMachineTokenVerifier,
  MACHINE_VERIFICATION_DEADLINE_MS,
} from "../src/modules/application-access/machine-auth.js";

let server: Server;
let issuer: string;
let privateKey: CryptoKey;
let keys: object[];
let mode: "healthy" | "unavailable" | "invalid-json";
let requests: number;
const audience = "sq-hub-api-staging";

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  keys = [{ ...jwk, kid: "original", alg: "RS256", use: "sig" }];
});

// One fixture per test, on its own port, as in machine-auth-recovery: a socket
// left pooled by one test must never be able to carry another test's request.
beforeEach(async () => {
  mode = "healthy";
  requests = 0;
  server = createServer((_request, response) => {
    requests++;
    if (mode === "unavailable") {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(mode === "invalid-json" ? "{" : JSON.stringify({ keys }));
  });
  server.keepAliveTimeout = 0; // nor may the fixture drop an idle socket mid-test
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind");
  issuer = `http://127.0.0.1:${address.port}/realms/test`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function verifier() {
  return createKeycloakMachineTokenVerifier({ issuer, audience, allowedClients: new Set(["hcis-api-staging"]) });
}

async function token(input: { aud?: string; azp?: string; key?: CryptoKey } = {}) {
  return new SignJWT({ azp: input.azp ?? "hcis-api-staging" })
    .setProtectedHeader({ alg: "RS256", kid: "original" })
    .setIssuer(issuer).setAudience(input.aud ?? audience)
    .setIssuedAt().setExpirationTime("5m").sign(input.key ?? privateKey);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Explicit fault injection for a request that dies before any response exists:
// what undici reports when a keep-alive socket closed by the peer is written to.
function failNextFetchInTransport() {
  return vi.spyOn(globalThis, "fetch")
    .mockImplementationOnce(() => Promise.reject(new TypeError("fetch failed")));
}

describe("machine verification survives a JWKS connection closed by the peer", () => {
  it("resends once and accepts a valid token the first attempt never reached the server with", async () => {
    const verify = verifier();
    const signed = await token();
    const fetches = failNextFetchInTransport();

    await expect(verify(signed)).resolves.toEqual({ clientId: "hcis-api-staging" });

    expect(fetches).toHaveBeenCalledTimes(2); // the lost request and its resend
    expect(requests).toBe(1); // only the resend arrived at Keycloak
  });

  it("resends exactly once, then still fails closed", async () => {
    const verify = verifier();
    const signed = await token();
    const fetches = vi.spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.reject(new TypeError("fetch failed")));

    await expect(verify(signed)).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    expect(fetches).toHaveBeenCalledTimes(2);
    expect(requests).toBe(0);
  });

  it("rejects an invalid token without resending anything", async () => {
    const verify = verifier();
    const fetches = vi.spyOn(globalThis, "fetch");
    const otherKey = (await generateKeyPair("RS256")).privateKey;

    await expect(verify(await token())).resolves.toEqual({ clientId: "hcis-api-staging" });
    await expect(verify(await token({ aud: "wrong" }))).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await expect(verify(await token({ key: otherKey }))).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await expect(verify(await token({ azp: "other-client" }))).rejects.toMatchObject({ code: "FORBIDDEN_CLIENT" });

    // A rejected token costs Keycloak one key load, not one per presentation.
    expect(fetches).toHaveBeenCalledTimes(1);
    expect(requests).toBe(1);
  });

  it.each(["unavailable", "invalid-json"] as const)("does not resend a request the server answered with %s", async (failure) => {
    const verify = verifier();
    const signed = await token();
    mode = failure;
    const fetches = vi.spyOn(globalThis, "fetch");

    await expect(verify(signed)).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    expect(fetches).toHaveBeenCalledTimes(1);
    expect(requests).toBe(1);
    mode = "healthy";
    await expect(verify(signed)).resolves.toEqual({ clientId: "hcis-api-staging" });
  });

  it("keeps both attempts inside the verification deadline and resends nothing after it", async () => {
    const verify = verifier();
    const signed = await token();
    const entered = deferred<void>();
    const stalled = deferred<Response>();
    const fetches = failNextFetchInTransport().mockImplementationOnce(() => {
      entered.resolve();
      return stalled.promise; // the resend hangs; it deliberately ignores its signal
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const outcome = expect(verify(signed)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await entered.promise;
    expect(fetches).toHaveBeenCalledTimes(2); // the resend is immediate, on no new budget
    await vi.advanceTimersByTimeAsync(MACHINE_VERIFICATION_DEADLINE_MS);
    await outcome;

    // The deadline aborted this generation's transport, so its late failure
    // is not a resend opportunity.
    stalled.reject(new TypeError("fetch failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toHaveBeenCalledTimes(2);
  });
});
