import { afterEach, describe, expect, it, vi } from "vitest";

import { KeycloakIdentityDirectory } from "../src/modules/identity-directory/client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function makeDirectory() {
  return new KeycloakIdentityDirectory({
    baseUrl: "http://sq-identity-directory-staging:8080",
    realm: "sq-staff-staging",
    issuer: "https://login.example.test/realms/sq-staff-staging",
    clientId: "sq-hub-directory-staging",
    clientSecret: "test-secret-not-production",
  });
}

describe("KeycloakIdentityDirectory", () => {
  it("returns browser-safe user metadata and MFA readiness booleans", async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/protocol/openid-connect/token")) {
        expect(String(init?.body)).toContain("grant_type=client_credentials");
        return new Response(JSON.stringify({ access_token: "opaque-machine-token", expires_in: 60 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/users?") && url.includes("search=synthetic")) {
        return new Response(
          JSON.stringify([
            {
              id: "opaque-subject-001",
              username: "19870001",
              email: "synthetic@example.test",
              emailVerified: true,
              firstName: "Synthetic",
              lastName: "Staff",
              enabled: true,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/users/opaque-subject-001/credentials")) {
        return new Response(JSON.stringify([{ type: "otp" }, { type: "recovery-authn-codes" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const results = await makeDirectory().search("synthetic");

    expect(results).toEqual([
      {
        identity: {
          issuer: "https://login.example.test/realms/sq-staff-staging",
          subject: "opaque-subject-001",
        },
        username: "19870001",
        email: "synthetic@example.test",
        emailVerified: true,
        displayName: "Synthetic Staff",
        enabled: true,
        security: { totpConfigured: true, recoveryCodesConfigured: true },
      },
    ]);
    expect(JSON.stringify(results)).not.toContain("opaque-machine-token");
  });

  it("bounds search results and caches the client-credentials token", async () => {
    let tokenCalls = 0;
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/protocol/openid-connect/token")) {
        tokenCalls += 1;
        return new Response(JSON.stringify({ access_token: "opaque-machine-token", expires_in: 60 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/users?")) {
        expect(url).toContain("max=10");
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const directory = makeDirectory();
    await directory.search("one", 100);
    await directory.search("two", 100);

    expect(tokenCalls).toBe(1);
  });
});
