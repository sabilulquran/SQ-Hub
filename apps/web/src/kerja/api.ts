import type { WorkspaceApplication } from "@/types";

/** Browser contract for `/api/kerja/*` and `/api/admin/kerja/*` (KERJA-IMPL-001 §2, §8). */

export type Peran = "pj" | "anggota" | "peninjau";
export type JenisSelesai = "tuntas" | "batal" | "ditunda";
export type Warna = "abu" | "merah" | "oranye" | "kuning" | "hijau" | "teal" | "biru" | "ungu" | "merah-muda";

export interface Orang {
  id: string;
  nama: string;
  aktif: boolean;
}

export interface KerjaContext {
  displayName: string;
  orang: { id: string; nama: string } | null;
  directoryTersedia: boolean;
  pengelola: boolean;
}

export interface Label {
  id: string;
  nama: string;
  warna: Warna;
}

export interface KartuRingkas {
  id: string;
  ruangId: string;
  ruangNama: string;
  papanId: string;
  papanNama: string;
  kolomId: string;
  kolomNama: string;
  judul: string;
  mulaiPada: string | null;
  tenggatPada: string | null;
  selesaiJenis: JenisSelesai | null;
  arsip: boolean;
  posisi: string;
  label: Label[];
  orang: Orang[];
  ceklis: { selesai: number; total: number };
  komentar: number;
  lampiran: number;
}

export interface TugasSaya extends KartuRingkas {
  ditugaskanKeSaya: boolean;
  butirSaya: Array<{ id: string; nama: string; tenggatPada: string | null; selesai: boolean }>;
  tenggatEfektif: string | null;
  lewatTenggat: boolean;
}

export interface RuangRingkas {
  id: string;
  jenis: "tetap" | "panitia";
  nama: string;
  status: "aktif" | "arsip";
  berakhirPada: string | null;
  akanBerakhir: boolean;
  peran: Peran;
  kartuTerbuka: number;
  kartuLewatTenggat: number;
}

export interface RuangDetail {
  id: string;
  jenis: "tetap" | "panitia";
  nama: string;
  unit: { id: string; nama: string | null } | null;
  status: "aktif" | "arsip";
  berakhirPada: string | null;
  peranSaya: Peran;
  papan: Array<{ id: string; nama: string }>;
  anggota: Array<Orang & { peran: Peran }>;
  kuota: { terpakai: number; batas: number };
}

export interface Papan {
  id: string;
  nama: string;
  ruang: { id: string; nama: string; status: "aktif" | "arsip"; peranSaya: Peran };
  papanRuang: Array<{ id: string; nama: string }>;
  label: Label[];
  anggota: Array<Orang & { peran: Peran }>;
  kolom: Array<{ id: string; nama: string; menandaiSelesai: boolean; kartu: KartuRingkas[] }>;
}

export interface Lampiran {
  id: string;
  nama: string;
  mime: string;
  ukuran: number;
  diunggahOleh: Orang;
  diunggahPada: string;
  diArsip: boolean;
}

export interface Komentar {
  id: string;
  penulis: Orang;
  isi: string;
  dihapus: boolean;
  dibuatPada: string;
  disuntingPada: string | null;
  milikSaya: boolean;
}

export interface KartuDetail {
  id: string;
  ruang: { id: string; nama: string; peranSaya: Peran; status: "aktif" | "arsip" };
  papan: { id: string; nama: string };
  kolom: { id: string; nama: string };
  judul: string;
  uraian: string;
  mulaiPada: string | null;
  tenggatPada: string | null;
  selesai: { jenis: JenisSelesai; pada: string; oleh: Orang } | null;
  arsip: boolean;
  dibuatOleh: Orang;
  dibuatPada: string;
  label: Label[];
  orang: Orang[];
  ceklis: Array<{
    id: string;
    nama: string;
    kemajuan: { selesai: number; total: number };
    butir: Array<{ id: string; nama: string; tenggatPada: string | null; selesai: boolean; orang: Orang[]; lampiran: Lampiran[] }>;
  }>;
  komentar: Array<Komentar & { balasan: Komentar[] }>;
  lampiran: Lampiran[];
  riwayat: Array<{ aksi: string; aktor: Orang; pada: string; lama: Record<string, unknown> | null; baru: Record<string, unknown> | null }>;
}

export interface Notifikasi {
  id: string;
  jenis: "mulai_h1hari" | "mulai_h1jam" | "tenggat_h1hari" | "tenggat_h1jam" | "penugasan" | "sebutan";
  kartuId: string;
  judul: string;
  ruang: string;
  dibuatPada: string;
  dibaca: boolean;
  tenggatPada: string | null;
  mulaiPada: string | null;
}

export interface Calon {
  id: string;
  nama: string;
  unit: string | null;
  saran: Peran;
}

export class KerjaRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KerjaRequestError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

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
    throw new KerjaRequestError(response.status, payload.error ?? "unknown", payload.message ?? "Permintaan gagal.");
  }
  return (await response.json()) as T;
}

/** Same-origin JSON call; the session is the host-only `sq_kerja_session` cookie. */
export function kerjaFetch<T>(path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> {
  return request<T>("/api/kerja", path, init);
}

export function kerjaAdminFetch<T>(path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> {
  return request<T>("/api/admin/kerja", path, init);
}

/** §9: one file per request; size, kind and quota are checked by the server. */
export async function kerjaUpload(path: string, file: File): Promise<{ id: string; nama: string }> {
  const form = new FormData();
  form.append("berkas", file, file.name);
  const response = await fetch(`/api/kerja${path}`, { method: "POST", credentials: "same-origin", body: form, headers: { Accept: "application/json" } });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new KerjaRequestError(response.status, payload.error ?? "unknown", payload.message ?? "Unggahan gagal.");
  }
  return (await response.json()) as { id: string; nama: string };
}

export function lampiranUrl(id: string, unduh = false): string {
  return `/api/kerja/lampiran/${encodeURIComponent(id)}${unduh ? "?unduh=1" : ""}`;
}

/** HUB-IMPL-022: any failure returns null and the launcher shows the Kerja tile only. */
export async function loadKerjaLauncher(): Promise<WorkspaceApplication[] | null> {
  try {
    const body = await kerjaFetch<{ applications: WorkspaceApplication[] | null }>("/launcher");
    return Array.isArray(body.applications) ? body.applications : null;
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown, fallback = "Permintaan gagal. Coba lagi."): string {
  return error instanceof KerjaRequestError ? error.message : fallback;
}
