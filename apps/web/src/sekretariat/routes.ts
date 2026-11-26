/**
 * Sekretariat pages on the sekretariat. host (SEK-IMPL-001 §9, SEK-IMPL-003).
 *
 * The inbox is home, as in any mail client: `/` resolves to the first inbox the viewer may open.
 * A letter opens as a pop-up over its inbox (`/kotak/<id>?surat=<id>`); the old
 * `/surat-masuk/<id>` link still works and lands on that pop-up. Settings are one page per
 * concern instead of one long stack.
 */
export type PengaturanBagian = "kotak-masuk" | "penerbit" | "petugas" | "disposisi" | "nomor-awal";

export type SekretariatRoute =
  | { name: "beranda" }
  | { name: "kotak"; kotakId: string }
  | { name: "surat-masuk"; suratMasukId: string }
  | { name: "surat-keluar" }
  | { name: "penerbit-surat"; penerbitId: string }
  | { name: "surat"; suratId: string }
  /** SEK-IMPL-004: the step-by-step Asisten Surat flow over one draft; the step lives in `?langkah=`. */
  | { name: "asisten"; suratId: string }
  | { name: "buku" }
  | { name: "pengaturan"; bagian: PengaturanBagian }
  | { name: "not-found" };

const ID = "([0-9a-f-]{36})";
const BAGIAN: PengaturanBagian[] = ["kotak-masuk", "penerbit", "petugas", "disposisi", "nomor-awal"];

export function resolveSekretariatRoute(pathname: string): SekretariatRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/ringkasan") return { name: "beranda" };
  if (path === "/surat-keluar") return { name: "surat-keluar" };
  if (path === "/buku") return { name: "buku" };
  if (path === "/pengaturan") return { name: "pengaturan", bagian: "kotak-masuk" };
  const bagian = /^\/pengaturan\/([a-z-]+)$/.exec(path)?.[1];
  if (bagian && (BAGIAN as string[]).includes(bagian)) return { name: "pengaturan", bagian: bagian as PengaturanBagian };
  const match = (pattern: string) => new RegExp(`^${pattern}$`, "i").exec(path)?.[1];
  const kotak = match(`/kotak/${ID}`);
  if (kotak) return { name: "kotak", kotakId: kotak };
  const suratMasuk = match(`/surat-masuk/${ID}`);
  if (suratMasuk) return { name: "surat-masuk", suratMasukId: suratMasuk };
  const penerbit = match(`/penerbit/${ID}/surat`);
  if (penerbit) return { name: "penerbit-surat", penerbitId: penerbit };
  const asisten = match(`/surat/${ID}/asisten`);
  if (asisten) return { name: "asisten", suratId: asisten };
  const surat = match(`/surat/${ID}`);
  if (surat) return { name: "surat", suratId: surat };
  return { name: "not-found" };
}

/** True on `sekretariat.sabilulquran.or.id`; the same web bundle then shows only Sekretariat. */
export function isSekretariatHost(hostname: string): boolean {
  return hostname === "sekretariat.sabilulquran.or.id" || hostname.startsWith("sekretariat.");
}

/** Client-side navigation without a router library: push the path and tell the app. */
export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
