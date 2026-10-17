import type { DeviceStatus, OutboxStatus } from "@/kirim/api";

export const deviceStatusLabel: Record<DeviceStatus, string> = {
  tersambung: "Tersambung",
  menunggu_pairing: "Menunggu pairing",
  terputus: "Terputus",
  nonaktif: "Nonaktif",
  belum_dipasang: "Belum dipasang",
};

/** Status chip colors use the semantic SQ tokens: success, warning, danger, neutral. */
export const deviceStatusTone: Record<DeviceStatus, string> = {
  tersambung: "bg-success-soft text-success-ink",
  menunggu_pairing: "bg-warning-soft text-warning-ink",
  terputus: "bg-danger-soft text-danger-ink",
  nonaktif: "bg-muted text-muted-foreground",
  belum_dipasang: "bg-info-soft text-info-ink",
};

export const outboxStatusLabel: Record<OutboxStatus, string> = {
  antre: "Antre",
  diserahkan: "Diserahkan",
  terkirim: "Terkirim",
  dibaca: "Dibaca",
  gagal: "Gagal",
  dibatalkan: "Dibatalkan",
};

export const outboxStatusTone: Record<OutboxStatus, string> = {
  antre: "bg-info-soft text-info-ink",
  diserahkan: "bg-muted text-foreground",
  terkirim: "bg-success-soft text-success-ink",
  dibaca: "bg-success-soft text-success-ink",
  gagal: "bg-danger-soft text-danger-ink",
  dibatalkan: "bg-muted text-muted-foreground",
};

/** KIRIM-IMPL-001 §5.3 stable error codes, in Indonesian for the Antrean screen (§8). */
export const errorCodeLabel: Record<string, string> = {
  optout: "Nomor minta tidak dihubungi",
  route_denied: "Rute tidak mengizinkan",
  quota_exceeded: "Di luar kuota harian",
  device_inactive: "Nomor nonaktif",
  invalid_number: "Nomor tujuan tidak sah",
  media_invalid: "Berkas tidak sah",
  expired: "Kedaluwarsa sebelum terkirim",
  engine_unavailable: "Mesin tidak tersedia",
  engine_rejected: "Ditolak mesin",
  engine_conflict: "Kunci kiriman bentrok di mesin",
  cancelled: "Dibatalkan admin",
};

/** Retry cannot fix these (§6.4). */
export const notRetryable = new Set(["optout", "route_denied", "expired"]);

export function errorLabel(code: string | null): string {
  if (!code) return "—";
  return errorCodeLabel[code] ?? code;
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
}

export function formatBytes(value: number | null): string {
  if (value === null) return "tidak diketahui";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}
