import { createServer, type Server } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import {
  createKeycloakMachineTokenVerifier,
  MACHINE_VERIFICATION_DEADLINE_MS,
} from "../src/modules/application-access/machine-auth.js";

let server: Server;
let issuer: string;
let privateKey: CryptoKey;
let keys: object[];
let mode: "healthy" | "headers-stall" | "body-stall" | "unavailable" | "invalid-json";
let requests: number;
const audience = "sq-hub-api-staging";
const nativeFetch = globalThis.fetch;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  keys = ["original", "rotated"].map((kid) => ({ ...jwk, kid, alg: "RS256", use: "sig" }));
  server = createServer((_request, response) => {
    requests++;
    if (mode === "headers-stall") return;
    if (mode === "unavailable") {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    if (mode === "body-stall") {
      response.flushHeaders();
      response.write('{"keys":[');
      return;
    }
    response.end(mode === "invalid-json" ? "{" : JSON.stringify({ keys }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind");
  issuer = `http://127.0.0.1:${address.port}/realms/test`;
});

beforeEach(() => { mode = "healthy"; requests = 0; });
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  server.closeAllConnections();
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function verifier() {
  return createKeycloakMachineTokenVerifier({ issuer, audience, allowedClients: new Set(["hcis-api-staging"]) });
}

async function token(input: { iss?: string; aud?: string; azp?: string; kid?: string; key?: CryptoKey } = {}) {
  return new SignJWT({ azp: input.azp ?? "hcis-api-staging" })
    .setProtectedHeader({ alg: "RS256", kid: input.kid ?? "original" })
    .setIssuer(input.iss ?? issuer).setAudience(input.aud ?? audience)
    .setIssuedAt().setExpirationTime("5m").sign(input.key ?? privateKey);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Explicit pathological-transport fault injection, not a claimed reproduction
// of the unknown historical JOSE trigger. Real JWT crypto still executes.
function stallNextFetch() {
  const entered = deferred<void>();
  const pending = deferred<Response>();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => {
    entered.resolve();
    return pending.promise; // deliberately ignores AbortSignal
  });
  return { entered: entered.promise, pending, fetch };
}

describe("bounded machine verification and resolver recovery", () => {
  it("verifies signatures and rejects wrong claims without evicting healthy keys", async () => {
    const verify = verifier();
    await expect(verify(await token())).resolves.toEqual({ clientId: "hcis-api-staging" });
    for (const claims of [{ iss: `${issuer}/wrong` }, { aud: "wrong" }]) {
      await expect(verify(await token(claims))).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    }
    const otherKey = (await generateKeyPair("RS256")).privateKey;
    await expect(verify(await token({ key: otherKey }))).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await expect(verify(await token({ azp: "other-client" }))).rejects.toMatchObject({ code: "FORBIDDEN_CLIENT" });
    await expect(verify(await token({ kid: "absent" }))).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect(requests).toBe(1); // retain JOSE cache/cooldown for invalid tokens
  });

  it.each(["headers-stall", "body-stall"] as const)("bounds a real HTTP %s and recovers", async (failure) => {
    const verify = verifier();
    const signed = await token();
    mode = failure;
    const started = performance.now();
    await expect(verify(signed)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect(performance.now() - started).toBeLessThan(4_000);
    expect(requests).toBe(1);
    mode = "healthy";
    await expect(verify(signed)).resolves.toEqual({ clientId: "hcis-api-staging" });
    expect(requests).toBe(2);
  });

  it.each(["unavailable", "invalid-json"] as const)("recovers immediately after %s", async (failure) => {
    const verify = verifier();
    const signed = await token();
    mode = failure;
    await expect(verify(signed)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    mode = "healthy";
    await expect(verify(signed)).resolves.toEqual({ clientId: "hcis-api-staging" });
    expect(requests).toBe(2);
  });

  it.each(["resolve", "reject"] as const)("bounds concurrent stuck calls; stale %s cannot poison the new generation", async (completion) => {
    const signed = await token();
    const verify = verifier();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stall = stallNextFetch();
    const calls = Array.from({ length: 4 }, () => verify(signed));
    const outcomes = Promise.allSettled(calls);
    await stall.entered;
    expect(stall.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MACHINE_VERIFICATION_DEADLINE_MS);
    for (const result of await outcomes) {
      expect(result).toMatchObject({ status: "rejected", reason: { code: "INVALID_TOKEN" } });
    }
    stall.fetch.mockImplementation(nativeFetch);
    await expect(verify(signed)).resolves.toEqual({ clientId: "hcis-api-staging" });
    if (completion === "resolve") stall.pending.resolve(new Response(JSON.stringify({ keys })));
    else stall.pending.reject(new TypeError("synthetic transport failure"));
    await vi.advanceTimersByTimeAsync(0);
    await expect(verify(signed)).resolves.toEqual({ clientId: "hcis-api-staging" });
    expect(stall.fetch).toHaveBeenCalledTimes(2);
  });

  it("an older concurrent caller's later deadline cannot discard recovered state", async () => {
    const signed = await token();
    const verify = verifier();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stall = stallNextFetch();
    const first = expect(verify(signed)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await stall.entered;
    await vi.advanceTimersByTimeAsync(500);
    const second = expect(verify(signed)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await vi.advanceTimersByTimeAsync(MACHINE_VERIFICATION_DEADLINE_MS - 500);
    await first;
    stall.fetch.mockImplementation(nativeFetch);
    await expect(verify(signed)).resolves.toEqual({ clientId: "hcis-api-staging" });
    await vi.advanceTimersByTimeAsync(500);
    await second;
    await expect(verify(signed)).resolves.toEqual({ clientId: "hcis-api-staging" });
    expect(stall.fetch).toHaveBeenCalledTimes(2);
    stall.pending.reject(new TypeError("old transport failed"));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("discards a stuck unknown-kid refresh and permits a clean subsequent refresh", async () => {
    const signed = await token();
    const rotated = await token({ kid: "rotated" });
    const verify = verifier();
    const allKeys = keys;
    keys = allKeys.slice(0, 1);
    try {
      await verify(signed);
    } finally { keys = allKeys; }
    const future = Date.now() + 31_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(future); // expire JOSE cooldown, not the token
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stall = stallNextFetch();
    const outcome = expect(verify(rotated)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await stall.entered;
    clock.mockRestore(); // do not shift the HTTP client's connection clock
    await vi.advanceTimersByTimeAsync(MACHINE_VERIFICATION_DEADLINE_MS);
    await outcome;
    vi.useRealTimers(); // restore HTTP keep-alive scheduling before recovery
    stall.fetch.mockImplementation(nativeFetch);
    await expect(verify(rotated)).resolves.toEqual({ clientId: "hcis-api-staging" });
    stall.pending.reject(new TypeError("old refresh failed"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(verify(rotated)).resolves.toEqual({ clientId: "hcis-api-staging" });
    expect(stall.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns a bounded route error, then reaches strict body validation without DB access", async () => {
    const signed = await token();
    const checkAccess = vi.fn();
    const app = buildApp({ accessService: { checkAccess }, verifyMachineToken: verifier() });
    await app.ready();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stall = stallNextFetch();
    const request = {
      method: "POST" as const, url: "/internal/v1/application-access/check",
      headers: { authorization: `Bearer ${signed}` },
      payload: { identity: { issuer, subject: "synthetic" }, applicationKey: "hcis", extra: true },
    };
    try {
      const pending = app.inject(request);
      await stall.entered;
      await vi.advanceTimersByTimeAsync(MACHINE_VERIFICATION_DEADLINE_MS);
      const response = await pending;
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "INVALID_TOKEN" });
      stall.fetch.mockImplementation(nativeFetch);
      const recovered = await app.inject(request);
      expect(recovered.statusCode).toBe(400);
      expect(recovered.json()).toEqual({ error: "INVALID_REQUEST" });
      expect(checkAccess).not.toHaveBeenCalled();
      stall.pending.reject(new TypeError("old transport failed"));
      await vi.advanceTimersByTimeAsync(0);
    } finally { await app.close(); }
  });
});
