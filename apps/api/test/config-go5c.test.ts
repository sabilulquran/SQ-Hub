import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const baseEnv: NodeJS.ProcessEnv = {
  PORT: "3100",
  DATABASE_URL: "postgresql://example.invalid/sqhub",
  HCIS_CANONICAL_URL: "https://hcis.example.test",
  KEYCLOAK_ISSUER: "https://login.example.test/realms/staff",
  MACHINE_TOKEN_AUDIENCE: "sq-hub-api",
  ALLOWED_MACHINE_CLIENTS: "hcis-api",
  SQ_HUB_OIDC_CLIENT_ID: "sq-hub",
  SQ_HUB_OIDC_CLIENT_SECRET: "oidc-secret",
  SQ_HUB_OIDC_REDIRECT_URI: "https://hub.example.test/auth/callback",
  SQ_HUB_OIDC_POST_LOGOUT_REDIRECT_URI: "https://hub.example.test/",
  KEYCLOAK_DIRECTORY_BASE_URL: "https://login.example.test",
  KEYCLOAK_DIRECTORY_REALM: "staff",
  KEYCLOAK_DIRECTORY_CLIENT_ID: "sq-hub-directory",
  KEYCLOAK_DIRECTORY_CLIENT_SECRET: "directory-secret",
};

describe("Go 5C identity-management configuration", () => {
  it("keeps Go 5C disabled when dedicated credentials are absent", () => {
    const config = loadConfig(baseEnv);
    expect(config.keycloakIdentityManagementClientId).toBeUndefined();
    expect(config.keycloakIdentityManagementClientSecret).toBeUndefined();
  });

  it("requires client id and secret as a pair", () => {
    expect(() => loadConfig({ ...baseEnv, KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID: "sq-hub-go5c" })).toThrow(/configured together/);
  });

  it("rejects silently reusing the read-only directory service principal", () => {
    expect(() => loadConfig({
      ...baseEnv,
      KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID: "sq-hub-directory",
      KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_SECRET: "different-secret-same-client",
    })).toThrow(/distinct from the read-only directory client/);
  });
});
