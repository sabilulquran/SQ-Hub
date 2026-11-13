import type { WorkspaceApplication } from "@/types";

/** Browser contract for `/api/sekretariat/*` and `/api/admin/sekretariat/*` (SEK-IMPL-001 §9). */

export interface SekretariatContext {
  displayName: string;
  orang: { id: string; nama: string } | null;
  directoryTersedia: boolean;
  pengelola: boolean;
  peran: { disposisi: boolean; penerbitIds: string[] } | null;
}

export interface KotakRingkas {
  id: string;
  jenis: "yayasan" | "penerbit";
  penerbit: { id: string; kode: string | null; nama: string | null } | null;
  baru: number;
  disposisiTerbuka: number;
}

export interface SuratMasukRingkas {
  id: string;
  kanal: "email" | "fisik";
  dari: string;
  perihal: string;
  diterimaPada: string;
  status: "baru" | "didisposisi" | "selesai" | "spam";
}

export interface Berkas {
  id: string;
  nama: string;
  mime: string;
  ukuran: number;
  sha256: string;
  terkunci: boolean;
}

export interface SuratMasukDetail extends SuratMasukRingkas {
  kotak: { id: string; jenis: "yayasan" | "penerbit" };
  isiTeks: string;
  dicatatOleh: string | null;
  berkas: Berkas[];
  disposisi: Array<{
    id: string;
    catatan: string;
    tenggatPada: string | null;
    oleh: string;
    pada: string;
    selesaiPada: string | null;
    selesaiKeterangan: string | null;
    kePenerbit: { kode: string | null; nama: string | null } | null;
  }>;
  balasan: Array<{ id: string; status: string; nomor: string | null }>;
}

export interface SuratKeluar {
  id: string;
  penerbitId: string;
  jenisKode: string;
  nomor: string | null;
  perihal: string;
  tujuan: string;
  penandatangan: string;
  status: "draf" | "terbit" | "dibatalkan";
  retroaktif: boolean;
  tanggalAsli: string | null;
  balasanAtas: string | null;
  dibuatPada: string;
  terbitPada: string | null;
}

export interface RegisterItem {
  id: string;
  nomor: string;
  jenis: { kode: string; nama: string | null };
  penerbit: string;
  tanggal: string;
  perihal: string;
  tujuan: string;
  status: "terpakai" | "dibatalkan";
  sumber: string;
  dibatalkanAlasan: string | null;
}

export interface Jenis {
  kode: string;
  nama: string;
  aktif: boolean;
}

export interface Penerbit {
  id: string;
  kode: string;
  nama: string;
  kelompok: string;
  unitId: string | null;
  berakhirPada: string | null;
  aktif: boolean;
  petugasAktif: number;
}

export class SekretariatRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SekretariatRequestError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function request<T>(base: string, path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new SekretariatRequestError(response.status, payload.error ?? "unknown", payload.message ?? "Permintaan gagal.");
  }
  return (await response.json()) as T;
}

/** Same-origin JSON call; the session is the host-only `sq_sekretariat_session` cookie. */
export function sekretariatFetch<T>(path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> {
  return request<T>("/api/sekretariat", path, init);
}

export function sekretariatAdminFetch<T>(path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> {
  return request<T>("/api/admin/sekretariat", path, init);
}

/** One file per request; size and kind are checked by the server (§2 "Berkas"). */
export async function sekretariatUpload(path: string, file: File): Promise<Berkas> {
  const form = new FormData();
  form.append("berkas", file, file.name);
  const response = await fetch(`/api/sekretariat${path}`, { method: "POST", credentials: "same-origin", body: form, headers: { Accept: "application/json" } });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new SekretariatRequestError(response.status, payload.error ?? "unknown", payload.message ?? "Unggahan gagal.");
  }
  return (await response.json()) as Berkas;
}

export function berkasUrl(id: string, unduh = false): string {
  return `/api/sekretariat/berkas/${encodeURIComponent(id)}${unduh ? "?unduh=1" : ""}`;
}

/** HUB-IMPL-022: any failure returns null and the launcher shows the Sekretariat tile only. */
export async function loadSekretariatLauncher(): Promise<WorkspaceApplication[] | null> {
  try {
    const body = await sekretariatFetch<{ applications: WorkspaceApplication[] | null }>("/launcher");
    return Array.isArray(body.applications) ? body.applications : null;
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown, fallback = "Permintaan gagal. Coba lagi."): string {
  return error instanceof SekretariatRequestError ? error.message : fallback;
}

export function formatUkuran(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatTanggal(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", ...(iso.length > 10 ? { timeStyle: "short" } : {}), timeZone: "Asia/Jakarta" }).format(date);
}

export const STATUS_SURAT_MASUK: Record<SuratMasukRingkas["status"], string> = {
  baru: "Baru",
  didisposisi: "Didisposisi",
  selesai: "Selesai",
  spam: "Spam",
};
