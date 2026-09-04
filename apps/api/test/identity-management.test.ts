import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentityManagementError, KeycloakIdentityManagement } from "../src/modules/identity-management/client.js";

const config = {
  baseUrl: "https://login.example.test",
  realm: "staff",
  issuer: "https://login.example.test/realms/staff",
  clientId: "sq-hub-identity-management-staging",
  clientSecret: "never-browser-secret",
};

afterEach(() => vi.unstubAllGlobals());

describe("KeycloakIdentityManagement", () => {
  it("creates a profile-complete Staff identity with required action and no credential value", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url); calls.push({ url: target, init });
      if (target.endsWith("/protocol/openid-connect/token")) return new Response(JSON.stringify({ access_token: "opaque-admin-token", expires_in: 60 }), { status: 200 });
      if (target.includes("/users?username=") || target.includes("/users?email=")) return new Response("[]", { status: 200 });
      if (target.endsWith("/admin/realms/staff/users") && init?.method === "POST") return new Response(null, { status: 201, headers: { location: `${target}/subject-001` } });
      if (target.endsWith("/users/subject-001") && !init?.method) return new Response(JSON.stringify({ id: "subject-001", username: "19870001", email: "staff@example.test", emailVerified: true, firstName: "Synthetic", lastName: "Staff", enabled: true }), { status: 200 });
      throw new Error(`unexpected request ${target}`);
    }));
    const client = new KeycloakIdentityManagement(config);
    const result = await client.createStaff({ username: "19870001", email: "staff@example.test", emailVerified: true, firstName: "Synthetic", lastName: "Staff", enabled: true });
    const createCall = calls.find((call) => call.url.endsWith("/admin/realms/staff/users") && call.init?.method === "POST");
    const payload = JSON.parse(String(createCall?.init?.body)) as Record<string, unknown>;
    expect(payload.requiredActions).toEqual(["UPDATE_PASSWORD"]);
    expect(payload).not.toHaveProperty("credentials");
    expect(JSON.stringify(result)).not.toContain("opaque-admin-token");
    expect(JSON.stringify(result)).not.toContain(config.clientSecret);
  });

  it("rejects duplicate email before user creation", async () => {
    let created = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/protocol/openid-connect/token")) return new Response(JSON.stringify({ access_token: "opaque", expires_in: 60 }), { status: 200 });
      if (target.includes("/users?username=")) return new Response("[]", { status: 200 });
      if (target.includes("/users?email=")) return new Response(JSON.stringify([{ id: "existing", email: "staff@example.test" }]), { status: 200 });
      if (target.endsWith("/users") && init?.method === "POST") created = true;
      return new Response(null, { status: 500 });
    }));
    const client = new KeycloakIdentityManagement(config);
    await expect(client.createStaff({ username: "19870001", email: "staff@example.test", emailVerified: true, firstName: "Synthetic", lastName: "Staff", enabled: true })).rejects.toMatchObject<Partial<IdentityManagementError>>({ code: "DUPLICATE_EMAIL" });
    expect(created).toBe(false);
  });

  it("uses only UPDATE_PASSWORD for credential initialization", async () => {
    let body = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/protocol/openid-connect/token")) return new Response(JSON.stringify({ access_token: "opaque", expires_in: 60 }), { status: 200 });
      if (target.endsWith("/users/subject-001") && !init?.method) return new Response(JSON.stringify({ id: "subject-001", username: "19870001", email: "staff@example.test", emailVerified: true, firstName: "Synthetic", lastName: "Staff", enabled: true }), { status: 200 });
      if (target.endsWith("/execute-actions-email") && init?.method === "PUT") { body = String(init.body); return new Response(null, { status: 204 }); }
      throw new Error(`unexpected request ${target}`);
    }));
    await new KeycloakIdentityManagement(config).sendPasswordInitialization("subject-001");
    expect(JSON.parse(body)).toEqual(["UPDATE_PASSWORD"]);
  });

  it("does not write when enabled state is already correct", async () => {
    let putCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/protocol/openid-connect/token")) return new Response(JSON.stringify({ access_token: "opaque", expires_in: 60 }), { status: 200 });
      if (target.endsWith("/users/subject-001") && !init?.method) return new Response(JSON.stringify({ id: "subject-001", username: "19870001", email: "staff@example.test", emailVerified: true, firstName: "Synthetic", lastName: "Staff", enabled: false }), { status: 200 });
      if (init?.method === "PUT") putCount += 1;
      return new Response(null, { status: 204 });
    }));
    const result = await new KeycloakIdentityManagement(config).setEnabled("subject-001", false);
    expect(result.changed).toBe(false); expect(putCount).toBe(0);
  });
});
