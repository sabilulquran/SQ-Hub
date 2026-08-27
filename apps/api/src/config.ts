import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1),
  HCIS_CANONICAL_URL: z.string().url(),
  KEYCLOAK_ISSUER: z.string().url(),
  MACHINE_TOKEN_AUDIENCE: z.string().min(1),
  ALLOWED_MACHINE_CLIENTS: z.string().min(1),
});

export interface AppConfig {
  port: number;
  databaseUrl: string;
  hcisCanonicalUrl: string;
  keycloakIssuer: string;
  machineTokenAudience: string;
  allowedMachineClients: ReadonlySet<string>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(env);
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
