import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { MachineAuthError } from "../src/modules/application-access/machine-auth.js";
import type { HubWorkspaceApplication } from "../src/modules/hub-auth/workspace-repository.js";

// HUB-IMPL-022: POST /internal/v1/application-access/launcher.
const URL_PATH = "/internal/v1/application-access/launcher";
const identity = {
  issuer: "https://login.sabilulquran.or.id/realms/sq-staff",
  subject: "launcher-subject-001",
};

const rows: HubWorkspaceApplication[] = [
  { applicationKey: "aset-sq", name: "Aset SQ", canonicalUrl: "https://aset.sabilulquran.or.id" },
  { applicationKey: "hcis", name: "HCIS", canonicalUrl: "https://hcis.sabilulquran.or.id" },
  { applicationKey: "sq-hub", name: "SQ Hub", canonicalUrl: "https://hub.sabilulquran.or.id" },
  { applicationKey: "hub-alias", name: "Beranda", canonicalUrl: "https://hub.sabilulquran.or.id/" },
];

function appWith(input: {
  verify?: (token: string) => Promise<{ clientId: string }>;
  list?: (identity: { issuer: string; subject: string }) => Promise<HubWorkspaceApplication[]>;
  logLines?: string[];
} = {}) {
  return buildApp({
    accessService: { checkAccess: async () => ({ allowed: true, applicationKey: "hcis", decision: "active_grant" }) },
    verifyMachineToken: input.verify ?? (async () => ({ clientId: "hcis-api" })),
    launcher: {
      applications: { listAuthorizedApplications: input.list ?? (async () => rows) },
      hubOrigin: "https://hub.sabilulquran.or.id",
    },
    ...(input.logLines
      ? {
          logStream: new Writable({
            write(chunk, _encoding, callback) {
              input.logLines!.push(String(chunk));
              callback();
            },
          }),
        }
      : {}),
  });
}

async function post(app: ReturnType<typeof buildApp>, payload: unknown, authorization: string | null = "Bearer allowed") {
  const response = await app.inject({
    method: "POST",
    url: URL_PATH,
    ...(authorization ? { headers: { authorization } } : {}),
    payload: payload as Record<string, unknown>,
  });
  await app.close();
  return response;
}

describe("POST /internal/v1/application-access/launcher", () => {
  it("requires a bearer token", async () => {
    const response = await post(appWith(), { identity }, null);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHENTICATED" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects an invalid token", async () => {
    const response = await post(
      appWith({ verify: async () => { throw new MachineAuthError("INVALID_TOKEN", "bad"); } }),
      { identity },
      "Bearer invalid",
    );
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "INVALID_TOKEN" });
  });

  it("rejects a client outside the allowlist", async () => {
    const response = await post(
      appWith({ verify: async () => { throw new MachineAuthError("FORBIDDEN_CLIENT", "wrong client"); } }),
      { identity },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "FORBIDDEN_CLIENT" });
  });

  it("checks the token before reading the body or the list", async () => {
    let listed = false;
    const response = await post(
      appWith({
        verify: async () => { throw new MachineAuthError("FORBIDDEN_CLIENT", "wrong client"); },
        list: async () => { listed = true; return rows; },
      }),
      { nonsense: true },
    );
    expect(response.statusCode).toBe(403);
    expect(listed).toBe(false);
  });

  it("rejects extra fields, a missing identity and a malformed issuer without echoing values", async () => {
    const lines: string[] = [];
    const extra = await post(appWith({ logLines: lines }), { identity, applicationKey: "hcis" });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toEqual({ error: "INVALID_REQUEST", fields: ["applicationKey"] });

    const missing = await post(appWith(), {});
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe("INVALID_REQUEST");

    const extraIdentityKey = await post(appWith({ logLines: lines }), { identity: { ...identity, name: "Siti Aisyah Rahmawati" } });
    expect(extraIdentityKey.statusCode).toBe(400);
    expect(extraIdentityKey.json()).toEqual({ error: "INVALID_REQUEST", fields: ["identity.name"] });
    expect(extraIdentityKey.body).not.toContain("Siti Aisyah");

    const badIssuer = await post(appWith(), { identity: { issuer: "not a url", subject: "x" } });
    expect(badIssuer.statusCode).toBe(400);
    expect(badIssuer.headers["cache-control"]).toBe("no-store");

    const logged = lines.join("\n");
    expect(logged).toContain("internal_invalid_request");
    expect(logged).not.toContain("Siti Aisyah");
    expect(logged).not.toContain(identity.subject);
  });

  it("returns the workspace rows for the identity, without SQ Hub itself, in source order", async () => {
    const asked: Array<{ issuer: string; subject: string }> = [];
    const response = await post(appWith({ list: async (value) => { asked.push(value); return rows; } }), { identity });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(asked).toEqual([identity]);
    expect(response.json()).toEqual({
      applications: [
        { key: "aset-sq", name: "Aset SQ", canonicalUrl: "https://aset.sabilulquran.or.id" },
        { key: "hcis", name: "HCIS", canonicalUrl: "https://hcis.sabilulquran.or.id" },
      ],
    });
  });

  it("answers an unknown identity with an empty list", async () => {
    const response = await post(appWith({ list: async () => [] }), { identity: { ...identity, subject: "unknown" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ applications: [] });
  });

  it("keeps identity values out of the request log on success", async () => {
    const lines: string[] = [];
    const response = await post(appWith({ logLines: lines }), { identity });
    expect(response.statusCode).toBe(200);
    const logged = lines.join("\n");
    expect(logged).not.toContain(identity.subject);
    expect(logged).not.toContain("realms/sq-staff");
  });

  it("does not exist when no launcher source is wired", async () => {
    const app = buildApp({
      accessService: { checkAccess: async () => ({ allowed: true, applicationKey: "hcis", decision: "active_grant" }) },
      verifyMachineToken: async () => ({ clientId: "hcis-api" }),
    });
    const response = await app.inject({ method: "POST", url: URL_PATH, headers: { authorization: "Bearer allowed" }, payload: { identity } });
    await app.close();
    expect(response.statusCode).toBe(404);
  });
});
