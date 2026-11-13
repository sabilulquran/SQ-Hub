import { z } from "zod";

/** ORGAN-IMPL-001 §1, §12. The OIDC client secret lives only in the production env. */
export interface OrganPortalConfig {
  oidc: { clientId: string; clientSecret: string };
  publicOrigin: string;
  /** Registry key of the portal itself; members need active Application Access to it (§1.2). */
  applicationKey: string;
}

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalNonempty = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const envSchema = z.object({
  PORTAL_ORGAN_ENABLED: booleanString.prefault("false"),
  ORGAN_OIDC_CLIENT_ID: optionalNonempty(z.string().trim().min(1)),
  ORGAN_OIDC_CLIENT_SECRET: optionalNonempty(z.string().min(1)),
  ORGAN_PUBLIC_ORIGIN: optionalNonempty(z.string().url()),
  ORGAN_APPLICATION_KEY: z.string().trim().min(1).max(63).default("organ"),
});

/** Returns null when PORTAL_ORGAN_ENABLED is not true: no route, no redirect from `/yayasan`. */
export function loadOrganPortalConfig(env: NodeJS.ProcessEnv = process.env): OrganPortalConfig | null {
  const parsed = envSchema.parse(env);
  if (!parsed.PORTAL_ORGAN_ENABLED) return null;
  if (!parsed.ORGAN_OIDC_CLIENT_ID || !parsed.ORGAN_OIDC_CLIENT_SECRET || !parsed.ORGAN_PUBLIC_ORIGIN) {
    throw new Error("ORGAN_OIDC_CLIENT_ID, ORGAN_OIDC_CLIENT_SECRET and ORGAN_PUBLIC_ORIGIN are required when PORTAL_ORGAN_ENABLED=true");
  }
  return {
    oidc: { clientId: parsed.ORGAN_OIDC_CLIENT_ID, clientSecret: parsed.ORGAN_OIDC_CLIENT_SECRET },
    publicOrigin: parsed.ORGAN_PUBLIC_ORIGIN.replace(/\/$/, ""),
    applicationKey: parsed.ORGAN_APPLICATION_KEY,
  };
}

/**
 * ORGAN-IMPL-001 §1.2: the portal's separation rests on its own client and its own host. Sharing
 * either with SQ Hub, Kirim or Kerja would silently merge sessions or let portal routes shadow
 * theirs, so startup refuses it.
 */
export function assertOrganPortalDistinct(
  config: OrganPortalConfig,
  others: { clientIds: Array<string | undefined>; origins: Array<string | undefined> },
): void {
  if (others.clientIds.some((clientId) => clientId === config.oidc.clientId)) {
    throw new Error("ORGAN_OIDC_CLIENT_ID must differ from the SQ Hub, Kirim and Kerja OIDC clients");
  }
  const host = new URL(config.publicOrigin).hostname;
  if (others.origins.some((origin) => origin !== undefined && new URL(origin).hostname === host)) {
    throw new Error("ORGAN_PUBLIC_ORIGIN must use its own host, not the SQ Hub, Kirim or Kerja host");
  }
}
