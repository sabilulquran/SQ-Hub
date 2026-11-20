import type { KotakRingkas } from "@/sekretariat/api";

/** SEK-IMPL-003: plain helpers for reading the inbox, kept apart from the components. */

export function kotakLabel(kotak: KotakRingkas): string {
  return kotak.jenis === "yayasan" ? "Kotak yayasan" : kotak.penerbit?.nama ?? kotak.penerbit?.kode ?? "Kotak penerbit";
}

/**
 * `"cPanel on sabilulquran.or.id" <cpanel@sabilulquran.or.id>` → name and address apart, the way a
 * mail client shows a sender. A bare address or a typed name for a physical letter stays as is.
 */
export function parseSender(dari: string): { nama: string; alamat: string | null } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(dari);
  if (match) {
    const nama = match[1]!.trim();
    const alamat = match[2]!.trim();
    return { nama: nama || alamat, alamat };
  }
  return { nama: dari.trim() || "(tanpa pengirim)", alamat: null };
}

const JAKARTA = "Asia/Jakarta";
const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA }).format(date);

/** Like a mail list: the time for today, day and month this year, a short date before that (WIB). */
export function tanggalRingkas(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (dayKey(date) === dayKey(now)) {
    return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: JAKARTA }).format(date);
  }
  const sameYear = dayKey(date).slice(0, 4) === dayKey(now).slice(0, 4);
  return new Intl.DateTimeFormat("id-ID", sameYear
    ? { day: "numeric", month: "short", timeZone: JAKARTA }
    : { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: JAKARTA }).format(date);
}
