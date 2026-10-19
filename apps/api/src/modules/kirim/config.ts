import { z } from "zod";

/** KIRIM-IMPL-001 §11 and KIRIM-IMPL-002 §13. Secrets live only in the production env, never in the repository or database. */
export interface KirimConfig {
  tokenAudience: string;
  dataKeys: Array<{ kid: string; key: Buffer }>;
  lookupKey: Buffer;
  mediaRoot: string;
  inboundMediaMaxBytes: number;
  workerIntervalMs: number;
  eventPullIntervalMs: number;
  jalurpesan: { baseUrl: string; platformKey: string; webhookSecret: string | null } | null;
  admin: { clientId: string; clientSecret: string; publicOrigin: string } | null;
  /** KIRIM-IMPL-002 §13; omitted values take the documented defaults. */
  groupRefreshIntervalMs?: number;
  contactRefreshIntervalMs?: number;
  replyDefaultTtlHours?: number;
  historyImportEnabled?: boolean;
}

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalNonempty = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const envSchema = z.object({
  KIRIM_ENABLED: booleanString.default("false"),
  KIRIM_TOKEN_AUDIENCE: z.string().trim().min(1).default("sq-hub-kirim"),
  KIRIM_DATA_KEYS: optionalNonempty(z.string().min(1)),
  KIRIM_LOOKUP_KEY: optionalNonempty(z.string().min(1)),
  KIRIM_MEDIA_ROOT: optionalNonempty(z.string().min(1)),
  KIRIM_INBOUND_MEDIA_MAX_BYTES: z.coerce.number().int().min(1).max(64 * 1024 * 1024).default(16 * 1024 * 1024),
  KIRIM_WORKER_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  KIRIM_EVENT_PULL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
  KIRIM_GROUP_REFRESH_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
  KIRIM_CONTACT_REFRESH_INTERVAL_MS: z.coerce.number().int().min(60_000).max(604_800_000).default(21_600_000),
  KIRIM_REPLY_DEFAULT_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(72),
  KIRIM_HISTORY_IMPORT_ENABLED: booleanString.default("false"),
  JALURPESAN_BASE_URL: optionalNonempty(z.string().url()),
  JALURPESAN_PLATFORM_KEY: optionalNonempty(z.string().min(1)),
  JALURPESAN_WEBHOOK_SECRET: optionalNonempty(z.string().min(1)),
  KIRIM_OIDC_CLIENT_ID: optionalNonempty(z.string().trim().min(1)),
  KIRIM_OIDC_CLIENT_SECRET: optionalNonempty(z.string().min(1)),
  KIRIM_PUBLIC_ORIGIN: optionalNonempty(z.string().url()),
});

/** Returns null when KIRIM_ENABLED is not true: routes are not registered and the worker does not run. */
export function loadKirimConfig(env: NodeJS.ProcessEnv = process.env): KirimConfig | null {
  const parsed = envSchema.parse(env);
  if (!parsed.KIRIM_ENABLED) return null;
  if (!parsed.KIRIM_DATA_KEYS || !parsed.KIRIM_LOOKUP_KEY || !parsed.KIRIM_MEDIA_ROOT) {
    throw new Error("KIRIM_DATA_KEYS, KIRIM_LOOKUP_KEY and KIRIM_MEDIA_ROOT are required when KIRIM_ENABLED=true");
  }
  const jalurpesanParts = [parsed.JALURPESAN_BASE_URL, parsed.JALURPESAN_PLATFORM_KEY];
  if (jalurpesanParts.some(Boolean) && !jalurpesanParts.every(Boolean)) {
    throw new Error("JALURPESAN_BASE_URL and JALURPESAN_PLATFORM_KEY must be configured together");
  }
  const adminParts = [parsed.KIRIM_OIDC_CLIENT_ID, parsed.KIRIM_OIDC_CLIENT_SECRET, parsed.KIRIM_PUBLIC_ORIGIN];
  if (adminParts.some(Boolean) && !adminParts.every(Boolean)) {
    throw new Error("KIRIM_OIDC_CLIENT_ID, KIRIM_OIDC_CLIENT_SECRET and KIRIM_PUBLIC_ORIGIN must be configured together");
  }
  const lookupKey = Buffer.from(parsed.KIRIM_LOOKUP_KEY, "base64");
  if (lookupKey.length < 32) throw new Error("KIRIM_LOOKUP_KEY must be base64 of at least 32 bytes");

  return {
    tokenAudience: parsed.KIRIM_TOKEN_AUDIENCE,
    dataKeys: parseDataKeys(parsed.KIRIM_DATA_KEYS),
    lookupKey,
    mediaRoot: parsed.KIRIM_MEDIA_ROOT,
    inboundMediaMaxBytes: parsed.KIRIM_INBOUND_MEDIA_MAX_BYTES,
    workerIntervalMs: parsed.KIRIM_WORKER_INTERVAL_MS,
    eventPullIntervalMs: parsed.KIRIM_EVENT_PULL_INTERVAL_MS,
    groupRefreshIntervalMs: parsed.KIRIM_GROUP_REFRESH_INTERVAL_MS,
    contactRefreshIntervalMs: parsed.KIRIM_CONTACT_REFRESH_INTERVAL_MS,
    replyDefaultTtlHours: parsed.KIRIM_REPLY_DEFAULT_TTL_HOURS,
    historyImportEnabled: parsed.KIRIM_HISTORY_IMPORT_ENABLED,
    jalurpesan: parsed.JALURPESAN_BASE_URL && parsed.JALURPESAN_PLATFORM_KEY
      ? {
          baseUrl: parsed.JALURPESAN_BASE_URL.replace(/\/$/, ""),
          platformKey: parsed.JALURPESAN_PLATFORM_KEY,
          webhookSecret: parsed.JALURPESAN_WEBHOOK_SECRET ?? null,
        }
      : null,
    admin: parsed.KIRIM_OIDC_CLIENT_ID && parsed.KIRIM_OIDC_CLIENT_SECRET && parsed.KIRIM_PUBLIC_ORIGIN
      ? {
          clientId: parsed.KIRIM_OIDC_CLIENT_ID,
          clientSecret: parsed.KIRIM_OIDC_CLIENT_SECRET,
          publicOrigin: new URL(parsed.KIRIM_PUBLIC_ORIGIN).origin,
        }
      : null,
  };
}

/** `kid:base64(32 bytes)` entries, comma separated; the first key writes, all keys read (§4.1). */
export function parseDataKeys(value: string): Array<{ kid: string; key: Buffer }> {
  const entries = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("KIRIM_DATA_KEYS must contain at least one key");
  const seen = new Set<string>();
  return entries.map((entry) => {
    const separator = entry.indexOf(":");
    const kid = separator > 0 ? entry.slice(0, separator) : "";
    const key = Buffer.from(entry.slice(separator + 1), "base64");
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw new Error("KIRIM_DATA_KEYS key id must match [A-Za-z0-9_-]{1,32}");
    if (key.length !== 32) throw new Error(`KIRIM_DATA_KEYS key ${kid} must be base64 of exactly 32 bytes`);
    if (seen.has(kid)) throw new Error(`KIRIM_DATA_KEYS key id ${kid} is duplicated`);
    seen.add(kid);
    return { kid, key };
  });
}
