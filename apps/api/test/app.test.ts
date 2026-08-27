import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { MachineAuthError } from "../src/modules/application-access/machine-auth.js";
import type { AccessDecision } from "../src/modules/application-access/types.js";

const body = {
  identity: {
    issuer: "https://login-staging.sabilulquran.or.id/realms/sq-staff-staging",
    subject: "user-001",
  },
  applicationKey: "hcis",
};

function appWith(input: {
  decision?: AccessDecision;
  verify?: (token: string) => Promise<{ clientId: string }>;
}) {
  return buildApp({
    accessService: {
      checkAccess: async () =>
        input.decision ?? {
          allowed: true,
          applicationKey: "hcis",
          decision: "active_grant",
        },
    },
    verifyMachineToken:
      input.verify ?? (async () => ({ clientId: "hcis-api-staging" })),
  });
}

describe("POST /internal/v1/application-access/check", () => {
  it("requires a bearer token", async () => {
    const app = appWith({});
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/check",
      payload: body,
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("rejects an invalid token", async () => {
    const app = appWith({
      verify: async () => {
        throw new MachineAuthError("INVALID_TOKEN", "bad token");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/check",
      headers: { authorization: "Bearer invalid" },
      payload: body,
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "INVALID_TOKEN" });
  });

  it("rejects a valid token from a forbidden client", async () => {
    const app = appWith({
      verify: async () => {
        throw new MachineAuthError("FORBIDDEN_CLIENT", "wrong client");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/check",
      headers: { authorization: "Bearer valid-but-forbidden" },
      payload: body,
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "FORBIDDEN_CLIENT" });
  });

  it("rejects unexpected fields instead of accepting domain permission payloads", async () => {
    const app = appWith({});
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/check",
      headers: { authorization: "Bearer allowed" },
      payload: {
        ...body,
        permission: "payroll.admin",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  it("returns the access decision from the platform service", async () => {
    const app = appWith({
      decision: {
        allowed: false,
        applicationKey: "hcis",
        decision: "GRANT_REVOKED",
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/application-access/check",
      headers: { authorization: "Bearer allowed" },
      payload: body,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      allowed: false,
      applicationKey: "hcis",
      decision: "GRANT_REVOKED",
    });
  });
});
