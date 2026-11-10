import type { JenisSelesai, Notifikasi, Peran, Warna } from "@/kerja/api";

/**
 * KERJA-001 §13: stored in UTC, shown in Asia/Jakarta, 24-hour clock. Jakarta has no daylight
 * saving, so a `datetime-local` value is read as +07:00 and never through the device's zone.
 */
const ZONE = "Asia/Jakarta";

export function formatTanggal(iso: string | null, withTime = true): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
  }).format(new Date(iso));
}

/** `2026-11-20T09:00` (WIB) for a `datetime-local` input. */
export function toWibInput(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** The reverse: a WIB `datetime-local` value to an ISO instant, or null when empty. */
export function fromWibInput(value: string): string | null {
  if (!value) return null;
  return `${value.length === 16 ? `${value}:00` : value}+07:00`;
}

/** The WIB calendar date of an instant, for "today" and "overdue" decisions. */
export function wibDate(iso: string): string {
  return toWibInput(iso).slice(0, 10);
}

export function relatifTenggat(iso: string | null, now = new Date()): { teks: string; nada: "lewat" | "dekat" | "biasa" } | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now.getTime();
  if (ms < 0) return { teks: `Lewat ${formatTanggal(iso)}`, nada: "lewat" };
  if (ms < 86_400_000) return { teks: `Tenggat ${formatTanggal(iso)}`, nada: "dekat" };
  return { teks: `Tenggat ${formatTanggal(iso)}`, nada: "biasa" };
}

export const JENIS_SELESAI: Record<JenisSelesai, string> = { tuntas: "Tuntas", batal: "Batal", ditunda: "Ditunda" };
export const PERAN: Record<Peran, string> = { pj: "Penanggung jawab", anggota: "Anggota", peninjau: "Peninjau" };

export const NOTIFIKASI: Record<Notifikasi["jenis"], string> = {
  mulai_h1hari: "Dimulai besok",
  mulai_h1jam: "Dimulai satu jam lagi",
  tenggat_h1hari: "Tenggat besok",
  tenggat_h1jam: "Tenggat satu jam lagi",
  penugasan: "Ditugaskan kepada Anda",
  sebutan: "Anda disebut",
};

export const RIWAYAT: Record<string, string> = {
  dibuat: "membuat kartu",
  disalin: "membuat kartu ini dari salinan",
  pindah_kolom: "memindah kartu",
  tambah_orang: "menugaskan",
  lepas_orang: "melepas",
  ubah_tenggat: "mengubah tenggat",
  ubah_mulai: "mengubah tanggal mulai",
  ubah_judul: "mengubah judul",
  ubah_uraian: "mengubah uraian",
  ditutup: "menutup kartu",
  dibuka: "membuka kembali kartu",
  diarsipkan: "mengarsipkan kartu",
  dipulihkan: "memulihkan kartu",
};

/** Label colours as token pairs that read in both themes. */
export const WARNA: Record<Warna, { nama: string; kelas: string }> = {
  abu: { nama: "Abu", kelas: "bg-muted text-foreground" },
  merah: { nama: "Merah", kelas: "bg-danger-soft text-danger-ink" },
  oranye: { nama: "Oranye", kelas: "bg-warning-soft text-warning-ink" },
  kuning: { nama: "Kuning", kelas: "bg-cat-leave-soft text-cat-leave" },
  hijau: { nama: "Hijau", kelas: "bg-success-soft text-success-ink" },
  teal: { nama: "Teal", kelas: "bg-cat-attendance-soft text-cat-attendance" },
  biru: { nama: "Biru", kelas: "bg-info-soft text-info-ink" },
  ungu: { nama: "Ungu", kelas: "bg-cat-task-soft text-cat-task" },
  "merah-muda": { nama: "Merah muda", kelas: "bg-cat-pay-soft text-cat-pay" },
};

export function ukuranBerkas(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2).replace(".", ",")} GB`;
}
