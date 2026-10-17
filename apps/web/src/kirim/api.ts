/** Browser contract for `/api/admin/kirim/*` (KIRIM-IMPL-001 §6.4). No message bodies or full numbers. */

export type DeviceStatus = "belum_dipasang" | "menunggu_pairing" | "tersambung" | "terputus" | "nonaktif";
export type OutboxStatus = "antre" | "diserahkan" | "terkirim" | "dibaca" | "gagal" | "dibatalkan";

export interface KirimContext {
  displayName: string;
}

export interface KirimDevice {
  kode: string;
  label: string;
  pemilik: string;
  provider: "log" | "jalurpesan";
  provider_ref: string | null;
  status: DeviceStatus;
  nomor_tersamar: string | null;
  antrean_dijeda: boolean;
  rate_per_menit: number;
  jam_kirim_mulai: string;
  jam_kirim_selesai: string;
  status_berubah_at: string;
  antrean?: { antre: number; gagal_hari_ini: number };
}

export interface KirimDeviceList {
  devices: KirimDevice[];
  peringatan: { terputus: string[]; webhook_habis: number };
}

export interface KirimConsumer {
  nama: string;
  client_id: string;
  webhook_url: string | null;
  kuota_harian: number;
  aktif: boolean;
}

export interface KirimQueueItem {
  id: string;
  pemakai: string;
  ref: string | null;
  jenis: "notifikasi" | "kode";
  nomor: string;
  tujuan: string;
  status: OutboxStatus;
  percobaan: number;
  error_code: string | null;
  dry_run: boolean;
  created_at: string;
  updated_at: string;
}

export interface KirimQueuePage {
  items: KirimQueueItem[];
  page: number;
  has_more: boolean;
}

export interface KirimQueueSummary {
  per_nomor: Array<{ nomor: string } & Record<OutboxStatus, number>>;
  webhook_habis: number;
  ukuran: { tabel_kirim_messages: number; tabel_kirim_media: number; folder_media: number; disk_bebas: number | null };
}

export type PairingResult = { mode: "qr"; qr: string | null } | { mode: "kode"; pairing_code: string };

export interface LiveStatus {
  status: DeviceStatus;
  nomor_tersamar: string | null;
  qr: string | null;
}

export class KirimRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KirimRequestError";
  }
}

/** Same-origin JSON call; the session is the host-only `sq_kirim_session` cookie. */
export async function kirimFetch<T>(path: string, init: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/admin/kirim${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new KirimRequestError(response.status, payload.error?.code ?? "unknown", payload.error?.message ?? "Permintaan gagal.");
  }
  return (await response.json()) as T;
}
