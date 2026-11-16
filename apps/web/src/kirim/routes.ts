/** Kirim SQ pages on the kirim. host (KIRIM-IMPL-001 §8, KIRIM-IMPL-002 §12). */
export type KirimRoute = "nomor" | "antrean" | "jangan-hubungi" | "aktivitas" | "impor" | "dokumentasi-api" | "not-found";

export function resolveKirimRoute(pathname: string): KirimRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/nomor") return "nomor";
  if (path === "/antrean") return "antrean";
  if (path === "/jangan-hubungi") return "jangan-hubungi";
  if (path === "/aktivitas") return "aktivitas";
  if (path === "/impor") return "impor";
  // ADR-0011 amendment 2026-11-17: the API guide for applications outside SQ Suite; public, no sign-in.
  if (path === "/dokumentasi-api") return "dokumentasi-api";
  return "not-found";
}

/** True on `kirim.sabilulquran.or.id`; the same web bundle then shows only Kirim SQ (§2). */
export function isKirimHost(hostname: string): boolean {
  return hostname === "kirim.sabilulquran.or.id" || hostname.startsWith("kirim.");
}
