import { afterEach, expect, it, vi } from "vitest";
import { createDirectoryPull } from "../src/modules/organization-directory/client.js";
import { startDirectoryScheduler } from "../src/modules/organization-directory/scheduler.js";
import { fixture } from "./organization-directory.fixture.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const config = { issuer: "https://identity.example.test/realms/demo", sourceUrl: "https://hcis.example.test", clientId: "sq-hub-organization-directory", clientSecret: "synthetic-test-only" };
const tokenResponse = () => Response.json({ access_token: "synthetic-service-token", token_type: "Bearer", expires_in: 300 });

it("uses client_credentials with dedicated client and scope, then bounded non-redirecting snapshot GET", async () => {
  const transport = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json(fixture()));
  vi.stubGlobal("fetch", transport);
  expect(await createDirectoryPull(config)("2026-09-24", "synthetic-correlation")).toEqual(fixture());
  const tokenCall = transport.mock.calls[0]!;
  expect(String(tokenCall[0])).toBe(`${config.issuer}/protocol/openid-connect/token`);
  const form = new URLSearchParams(tokenCall[1].body.toString());
  expect(form.get("grant_type")).toBe("client_credentials");
  expect(form.get("client_id")).toBe(config.clientId);
  expect(form.get("scope")).toBe("organization-directory.read");
  const sourceCall = transport.mock.calls[1]!;
  expect(String(sourceCall[0])).toBe("https://hcis.example.test/internal/v1/organization-directory/snapshot?asOf=2026-09-24");
  expect(sourceCall[1]).toMatchObject({ redirect: "error", headers: { authorization: "Bearer synthetic-service-token", "x-request-id": "synthetic-correlation" } });
  expect(sourceCall[1].signal).toBeInstanceOf(AbortSignal);
});

it.each([[401, "source_auth"], [403, "source_auth"], [400, "source_request"], [404, "source_request"], [429, "source_unavailable"], [503, "source_unavailable"]])("categorizes HTTP %s without exposing body or an immediate retry", async (status, category) => {
  const transport = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response("private synthetic body", { status: Number(status) }));
  vi.stubGlobal("fetch", transport);
  await expect(createDirectoryPull(config)("2026-09-24", "attempt")).rejects.toMatchObject({ category, message: category });
  expect(transport).toHaveBeenCalledTimes(2);
});

it("rejects malformed and oversized JSON without retaining/logging payload", async () => {
  for (const response of [new Response("{bad", { headers: { "content-type": "application/json" } }), new Response(" ".repeat(16 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } })]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(response));
    await expect(createDirectoryPull(config)("2026-09-24", "attempt")).rejects.toMatchObject({ category: "contract_validation" });
  }
});

it("recovers on the next full pull after timeout without retaining the failed token", async () => {
  const transport = vi.fn().mockResolvedValueOnce(tokenResponse()).mockRejectedValueOnce(new DOMException("synthetic", "TimeoutError"))
    .mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json(fixture()));
  vi.stubGlobal("fetch", transport);
  const pull = createDirectoryPull(config);
  await expect(pull("2026-09-24", "attempt-1")).rejects.toMatchObject({ category: "source_unavailable" });
  expect(await pull("2026-09-24", "attempt-2")).toEqual(fixture());
  expect(transport).toHaveBeenCalledTimes(4);
});

it("schedules serial 5-minute reconciliation and drains on shutdown", async () => {
  vi.useFakeTimers();
  const reconcile = vi.fn().mockResolvedValue(null);
  const stop = startDirectoryScheduler({ reconcile, report: vi.fn(), now: () => new Date("2026-09-23T17:00:00Z") });
  await vi.advanceTimersByTimeAsync(299_999);
  expect(reconcile).toHaveBeenCalledExactlyOnceWith("2026-09-24");
  await vi.advanceTimersByTimeAsync(1);
  expect(reconcile).toHaveBeenCalledTimes(2);
  await stop(); await vi.advanceTimersByTimeAsync(600_000);
  expect(reconcile).toHaveBeenCalledTimes(2);
});

it.each(["source_auth", "contract_validation", "source_request"])("does not aggressively retry %s", async (errorCategory) => {
  vi.useFakeTimers();
  const reconcile = vi.fn().mockResolvedValue({ result: "FAILED", errorCategory });
  const stop = startDirectoryScheduler({ reconcile, report: vi.fn() });
  await vi.advanceTimersByTimeAsync(299_999);
  expect(reconcile).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(reconcile).toHaveBeenCalledTimes(errorCategory === "source_request" ? 1 : 2);
  await stop();
});
