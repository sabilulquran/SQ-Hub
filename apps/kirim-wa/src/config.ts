import { parseDataKeys } from "./crypto.js";

/**
 * KIRIM-IMPL-005 §11. The worker reads the same environment file as the SQ Hub API, so there is
 * one file to edit on Mi8, but it only looks at `KIRIM_WA_*` and `DATABASE_URL`.
 */
export interface WaConfig {
  port: number;
  host: string;
  databaseUrl: string;
  platformKey: string;
  /** The one platform this worker serves; it is not multi-tenant like JalurPesan. */
  platformId: string;
  authRoot: string;
  mediaRoot: string;
  dataKeys: Array<{ kid: string; key: Buffer }>;
  maxDevices: number;
  connectStaggerMs: number;
  mediaTtlHours: number;
  messageRetentionDays: number;
  webhook: { url: string; secret: string } | null;
  /** Written to stdout as JSON lines; never contains a number, a body, a QR or a pairing code. */
  logLevel: "silent" | "info";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WaConfig {
  const databaseUrl = required(env, "DATABASE_URL");
  const platformKey = required(env, "KIRIM_WA_PLATFORM_KEY");
  if (platformKey.length < 24) throw new ConfigError("KIRIM_WA_PLATFORM_KEY must be at least 24 characters");
  const webhookUrl = optional(env, "KIRIM_WA_WEBHOOK_URL");
  const webhookSecret = optional(env, "KIRIM_WA_WEBHOOK_SECRET");
  if (Boolean(webhookUrl) !== Boolean(webhookSecret)) {
    throw new ConfigError("KIRIM_WA_WEBHOOK_URL and KIRIM_WA_WEBHOOK_SECRET must be configured together");
  }
  return {
    // 3310, not 3307: on Mi8 the WordPress stack's MariaDB listens on 3307, and it answers a
    // TCP connection without speaking HTTP, so a health probe there looks like "nothing is
    // running" rather than "taken". 0 asks the operating system for a free port; only tests
    // pass it.
    port: integer(env, "KIRIM_WA_PORT", 3310, 0, 65_535),
    // Loopback only (§12). Overridable for tests, never for production.
    host: optional(env, "KIRIM_WA_HOST") ?? "127.0.0.1",
    databaseUrl,
    platformKey,
    platformId: optional(env, "KIRIM_WA_PLATFORM_ID") ?? "sq-hub",
    authRoot: required(env, "KIRIM_WA_AUTH_ROOT"),
    mediaRoot: required(env, "KIRIM_WA_MEDIA_ROOT"),
    dataKeys: parseDataKeys(required(env, "KIRIM_WA_DATA_KEYS")),
    maxDevices: integer(env, "KIRIM_WA_MAX_DEVICES", 6, 1, 32),
    connectStaggerMs: integer(env, "KIRIM_WA_CONNECT_STAGGER_MS", 3_000, 0, 60_000),
    mediaTtlHours: integer(env, "KIRIM_WA_MEDIA_TTL_HOURS", 72, 1, 8_760),
    messageRetentionDays: integer(env, "KIRIM_WA_MESSAGE_RETENTION_DAYS", 400, 7, 3_650),
    webhook: webhookUrl && webhookSecret ? { url: webhookUrl, secret: webhookSecret } : null,
    logLevel: optional(env, "KIRIM_WA_LOG_LEVEL") === "silent" ? "silent" : "info",
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = optional(env, name);
  if (!value) throw new ConfigError(`${name} is required`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = optional(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}
