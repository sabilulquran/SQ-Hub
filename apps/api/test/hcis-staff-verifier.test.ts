import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHcisEmployeeVerifier,
  EmployeeVerificationError,
} from "../src/modules/staff-lifecycle/hcis-client.js";

const config = {
  issuer: "https://login.example.test/realms/staff",
  hcisBaseUrl: "https://hcis.example.test/api/",
  clientId: "sq-hub-staff-lifecycle",
  clientSecret: "synthetic-secret",
};

const employee = {
  employeeId: "hcis:employee:00000000-0000-4000-8000-000000000001",
  employeeNumber: "19870001",
  displayName: "Synthetic Staff",
  email: "staff@example.test",
  status: "active",
  verifiedAt: "2026-10-02T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HCIS staff verification client", () => {
  it("uses dedicated client credentials and the API prefix without exposing credentials in the employee request", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push({ url: target, init });
      if (target.endsWith("/protocol/openid-connect/token")) {
        return new Response(JSON.stringify({ access_token: "synthetic-token", token_type: "Bearer", expires_in: 60 }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (target === "https://hcis.example.test/api/internal/v1/staff-identity/verify-employee") {
        return Response.json(employee);
      }
      throw new Error(`unexpected request ${target}`);
    }));

    const result = await createHcisEmployeeVerifier(config)(employee.employeeNumber);
    expect(result).toEqual(employee);
    expect(calls).toHaveLength(2);
    expect(String(calls[0]?.init?.body)).toContain("staff-identity.verify");
    expect(calls[1]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ employeeNumber: employee.employeeNumber });
    expect(String(calls[1]?.init?.body)).not.toContain(config.clientSecret);
    expect(calls[1]?.init?.redirect).toBe("error");
  });

  it("fails closed when HCIS returns a different employee number", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => String(url).endsWith("/token")
      ? Response.json({ access_token: "synthetic-token", token_type: "Bearer", expires_in: 60 })
      : Response.json({ ...employee, employeeNumber: "other" })));
    await expect(createHcisEmployeeVerifier(config)(employee.employeeNumber)).rejects.toMatchObject<Partial<EmployeeVerificationError>>({ code: "UNAVAILABLE" });
  });

  it("rejects an oversized HCIS response before parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => String(url).endsWith("/token")
      ? Response.json({ access_token: "synthetic-token", token_type: "Bearer", expires_in: 60 })
      : new Response("x".repeat(8193), { headers: { "content-type": "application/json" } })));
    await expect(createHcisEmployeeVerifier(config)(employee.employeeNumber)).rejects.toMatchObject<Partial<EmployeeVerificationError>>({ code: "UNAVAILABLE" });
  });
});
