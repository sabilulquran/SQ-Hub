/** Kirim SQ pages on the kirim. host (KIRIM-IMPL-001 §8). */
export type KirimRoute = "nomor" | "antrean" | "not-found";

export function resolveKirimRoute(pathname: string): KirimRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/nomor") return "nomor";
  if (path === "/antrean") return "antrean";
  return "not-found";
}

/** True on `kirim.sabilulquran.or.id`; the same web bundle then shows only Kirim SQ (§2). */
export function isKirimHost(hostname: string): boolean {
  return hostname === "kirim.sabilulquran.or.id" || hostname.startsWith("kirim.");
}
