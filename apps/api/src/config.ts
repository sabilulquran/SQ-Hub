import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const foundationConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1),
  HCIS_CANONICAL_URL: z.string().url(),
  KEYCLOAK_ISSUER: z.string().url(),
  MACHINE_TOKEN_AUDIENCE: z.string().min(1),
  ALLOWED_MACHINE_CLIENTS: z.string().min(1),
});

const serverConfigSchema = foundationConfigSchema.extend({
  SQ_HUB_OIDC_CLIENT_ID: z.string().trim().min(1),
  SQ_HUB_OIDC_CLIENT_SECRET: z.string().min(1),
  SQ_HUB_OIDC_REDIRECT_URI: z.string().url(),
  SQ_HUB_OIDC_POST_LOGOUT_REDIRECT_URI: z.string().url(),
  HUB_SESSION_IDLE_HOURS: z.coerce.number().positive().max(8).default(8),
  HUB_SESSION_MAX_HOURS: z.coerce.number().positive().max(12).default(12),
  HUB_OIDC_TRANSACTION_TTL_MINUTES: z.coerce.number().positive().max(15).default(10),
  HUB_COOKIE_SECURE: booleanString.default("true"),
  KEYCLOAK_DIRECTORY_BASE_URL: z.string().url(),
  KEYCLOAK_DIRECTORY_REALM: z.string().trim().min(1).default("sq-staff-staging"),
  KEYCLOAK_DIRECTORY_CLIENT_ID: z.string().trim().min(1).default("sq-hub-directory-staging"),
  KEYCLOAK_DIRECTORY_CLIENT_SECRET: z.string().min(1),
});

export interface FoundationConfig {
  port: number;
  databaseUrl: string;
  hcisCanonicalUrl: string;
  keycloakIssuer: string;
  machineTokenAudience: string;
  allowedMachineClients: ReadonlySet<string>;
}

export interface AppConfig extends FoundationConfig {
  hubOidcClientId: string;
  hubOidcClientSecret: string;
  hubOidcRedirectUri: string;
  hubOidcPostLogoutRedirectUri: string;
  hubSessionIdleHours: number;
  hubSessionMaxHours: number;
  hubOidcTransactionTtlMinutes: number;
  hubCookieSecure: boolean;
  keycloakDirectoryBaseUrl: string;
  keycloakDirectoryRealm: string;
  keycloakDirectoryClientId: string;
  keycloakDirectoryClientSecret: string;
}

function foundationConfig(parsed: z.infer<typeof foundationConfigSchema>): FoundationConfig {
  const allowedMachineClients = new Set(
    parsed.ALLOWED_MACHINE_CLIENTS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (allowedMachineClients.size === 0) {
    throw new Error("ALLOWED_MACHINE_CLIENTS must contain at least one client id");
  }

  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    hcisCanonicalUrl: parsed.HCIS_CANONICAL_URL,
    keycloakIssuer: parsed.KEYCLOAK_ISSUER.replace(/\/$/, ""),
    machineTokenAudience: parsed.MACHINE_TOKEN_AUDIENCE,
    allowedMachineClients,
  };
}

export function loadFoundationConfig(env: NodeJS.ProcessEnv = process.env): FoundationConfig {
  return foundationConfig(foundationConfigSchema.parse(env));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = serverConfigSchema.parse(env);
  if (parsed.HUB_SESSION_IDLE_HOURS > parsed.HUB_SESSION_MAX_HOURS) {
    throw new Error("HUB_SESSION_IDLE_HOURS cannot exceed HUB_SESSION_MAX_HOURS");
  }

  return {
    ...foundationConfig(parsed),
    hubOidcClientId: parsed.SQ_HUB_OIDC_CLIENT_ID,
    hubOidcClientSecret: parsed.SQ_HUB_OIDC_CLIENT_SECRET,
    hubOidcRedirectUri: parsed.SQ_HUB_OIDC_REDIRECT_URI,
    hubOidcPostLogoutRedirectUri: parsed.SQ_HUB_OIDC_POST_LOGOUT_REDIRECT_URI,
    hubSessionIdleHours: parsed.HUB_SESSION_IDLE_HOURS,
    hubSessionMaxHours: parsed.HUB_SESSION_MAX_HOURS,
    hubOidcTransactionTtlMinutes: parsed.HUB_OIDC_TRANSACTION_TTL_MINUTES,
    hubCookieSecure: parsed.HUB_COOKIE_SECURE,
    keycloakDirectoryBaseUrl: parsed.KEYCLOAK_DIRECTORY_BASE_URL.replace(/\/$/, ""),
    keycloakDirectoryRealm: parsed.KEYCLOAK_DIRECTORY_REALM,
    keycloakDirectoryClientId: parsed.KEYCLOAK_DIRECTORY_CLIENT_ID,
    keycloakDirectoryClientSecret: parsed.KEYCLOAK_DIRECTORY_CLIENT_SECRET,
  };
}
