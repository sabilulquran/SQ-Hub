import { z } from "zod";

/** SEK-IMPL-001 §10. Mailbox credentials live only in the production env on Mi8. */
export interface SekretariatConfig {
  oidc: { clientId: string; clientSecret: string };
  publicOrigin: string;
  mediaRoot: string;
  maxUploadBytes: number;
  mail: { mode: "log" } | { mode: "imap"; host: string; port: number; user: string; pass: string };
  mailIntervalMs: number;
  /** Client ids allowed on /internal/sekretariat (D-3); empty until the HCIS cutover (§14 langkah 9). */
  allowedMachineClients: Set<string>;
  minFreeDiskBytes: number;
}

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalNonempty = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const envSchema = z.object({
  SEKRETARIAT_ENABLED: booleanString.prefault("false"),
  SEKRETARIAT_OIDC_CLIENT_ID: optionalNonempty(z.string().trim().min(1)),
  SEKRETARIAT_OIDC_CLIENT_SECRET: optionalNonempty(z.string().min(1)),
  SEKRETARIAT_PUBLIC_ORIGIN: optionalNonempty(z.string().url()),
  SEKRETARIAT_MEDIA_ROOT: optionalNonempty(z.string().min(1)),
  SEKRETARIAT_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(100 * 1024 * 1024).default(10 * 1024 * 1024),
  SEKRETARIAT_MAIL_MODE: z.enum(["log", "imap"]).default("log"),
  SEKRETARIAT_IMAP_HOST: optionalNonempty(z.string().trim().min(1)),
  SEKRETARIAT_IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
  SEKRETARIAT_IMAP_USER: optionalNonempty(z.string().trim().min(1)),
  SEKRETARIAT_IMAP_PASS: optionalNonempty(z.string().min(1)),
  SEKRETARIAT_MAIL_INTERVAL_MS: z.coerce.number().int().min(30_000).max(3_600_000).default(300_000),
  SEKRETARIAT_ALLOWED_MACHINE_CLIENTS: z.string().default(""),
  SEKRETARIAT_MIN_FREE_DISK_BYTES: z.coerce.number().int().min(0).default(5 * 1024 * 1024 * 1024),
});

/** Returns null when SEKRETARIAT_ENABLED is not true: no route, no timer, no launcher tile. */
export function loadSekretariatConfig(env: NodeJS.ProcessEnv = process.env): SekretariatConfig | null {
  const parsed = envSchema.parse(env);
  if (!parsed.SEKRETARIAT_ENABLED) return null;
  if (!parsed.SEKRETARIAT_OIDC_CLIENT_ID || !parsed.SEKRETARIAT_OIDC_CLIENT_SECRET || !parsed.SEKRETARIAT_PUBLIC_ORIGIN || !parsed.SEKRETARIAT_MEDIA_ROOT) {
    throw new Error(
      "SEKRETARIAT_OIDC_CLIENT_ID, SEKRETARIAT_OIDC_CLIENT_SECRET, SEKRETARIAT_PUBLIC_ORIGIN and SEKRETARIAT_MEDIA_ROOT are required when SEKRETARIAT_ENABLED=true",
    );
  }
  let mail: SekretariatConfig["mail"] = { mode: "log" };
  if (parsed.SEKRETARIAT_MAIL_MODE === "imap") {
    if (!parsed.SEKRETARIAT_IMAP_HOST || !parsed.SEKRETARIAT_IMAP_USER || !parsed.SEKRETARIAT_IMAP_PASS) {
      throw new Error("SEKRETARIAT_IMAP_HOST, SEKRETARIAT_IMAP_USER and SEKRETARIAT_IMAP_PASS are required when SEKRETARIAT_MAIL_MODE=imap");
    }
    mail = {
      mode: "imap",
      host: parsed.SEKRETARIAT_IMAP_HOST,
      port: parsed.SEKRETARIAT_IMAP_PORT,
      user: parsed.SEKRETARIAT_IMAP_USER,
      pass: parsed.SEKRETARIAT_IMAP_PASS,
    };
  }
  return {
    oidc: { clientId: parsed.SEKRETARIAT_OIDC_CLIENT_ID, clientSecret: parsed.SEKRETARIAT_OIDC_CLIENT_SECRET },
    publicOrigin: parsed.SEKRETARIAT_PUBLIC_ORIGIN.replace(/\/$/, ""),
    mediaRoot: parsed.SEKRETARIAT_MEDIA_ROOT,
    maxUploadBytes: parsed.SEKRETARIAT_MAX_UPLOAD_BYTES,
    mail,
    mailIntervalMs: parsed.SEKRETARIAT_MAIL_INTERVAL_MS,
    allowedMachineClients: new Set(
      parsed.SEKRETARIAT_ALLOWED_MACHINE_CLIENTS.split(",").map((value) => value.trim()).filter((value) => value.length > 0),
    ),
    minFreeDiskBytes: parsed.SEKRETARIAT_MIN_FREE_DISK_BYTES,
  };
}
