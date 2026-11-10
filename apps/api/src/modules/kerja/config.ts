import { z } from "zod";

/** KERJA-IMPL-001 §11. The OIDC client secret lives only in the production env. */
export interface KerjaConfig {
  oidc: { clientId: string; clientSecret: string };
  publicOrigin: string;
  mediaRoot: string;
  maxUploadBytes: number;
  roomQuotaBytes: number;
  reminderIntervalMs: number;
  /** Hour (0–23, Asia/Jakarta) when the daily Directory comparison and committee expiry run. */
  directorySyncHour: number;
  minFreeDiskBytes: number;
}

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalNonempty = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const envSchema = z.object({
  KERJA_ENABLED: booleanString.prefault("false"),
  KERJA_OIDC_CLIENT_ID: optionalNonempty(z.string().trim().min(1)),
  KERJA_OIDC_CLIENT_SECRET: optionalNonempty(z.string().min(1)),
  KERJA_PUBLIC_ORIGIN: optionalNonempty(z.string().url()),
  KERJA_MEDIA_ROOT: optionalNonempty(z.string().min(1)),
  KERJA_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(100 * 1024 * 1024).default(25 * 1024 * 1024),
  KERJA_ROOM_QUOTA_BYTES: z.coerce.number().int().min(1024 * 1024).max(100 * 1024 * 1024 * 1024).default(1024 * 1024 * 1024),
  KERJA_REMINDER_INTERVAL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
  KERJA_DIRECTORY_SYNC_HOUR: z.coerce.number().int().min(0).max(23).default(5),
  KERJA_MIN_FREE_DISK_BYTES: z.coerce.number().int().min(0).default(10 * 1024 * 1024 * 1024),
});

/** Returns null when KERJA_ENABLED is not true: no route, no timer, no launcher tile. */
export function loadKerjaConfig(env: NodeJS.ProcessEnv = process.env): KerjaConfig | null {
  const parsed = envSchema.parse(env);
  if (!parsed.KERJA_ENABLED) return null;
  if (!parsed.KERJA_OIDC_CLIENT_ID || !parsed.KERJA_OIDC_CLIENT_SECRET || !parsed.KERJA_PUBLIC_ORIGIN || !parsed.KERJA_MEDIA_ROOT) {
    throw new Error("KERJA_OIDC_CLIENT_ID, KERJA_OIDC_CLIENT_SECRET, KERJA_PUBLIC_ORIGIN and KERJA_MEDIA_ROOT are required when KERJA_ENABLED=true");
  }
  return {
    oidc: { clientId: parsed.KERJA_OIDC_CLIENT_ID, clientSecret: parsed.KERJA_OIDC_CLIENT_SECRET },
    publicOrigin: parsed.KERJA_PUBLIC_ORIGIN.replace(/\/$/, ""),
    mediaRoot: parsed.KERJA_MEDIA_ROOT,
    maxUploadBytes: parsed.KERJA_MAX_UPLOAD_BYTES,
    roomQuotaBytes: parsed.KERJA_ROOM_QUOTA_BYTES,
    reminderIntervalMs: parsed.KERJA_REMINDER_INTERVAL_MS,
    directorySyncHour: parsed.KERJA_DIRECTORY_SYNC_HOUR,
    minFreeDiskBytes: parsed.KERJA_MIN_FREE_DISK_BYTES,
  };
}
