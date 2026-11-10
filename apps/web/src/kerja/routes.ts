/** Kerja pages on the kerja. host (KERJA-IMPL-001 §8). */
export type KerjaRoute =
  | { name: "tugas" }
  | { name: "ruang-daftar" }
  | { name: "ruang"; ruangId: string }
  | { name: "papan"; papanId: string }
  | { name: "kartu"; kartuId: string }
  | { name: "cari"; ruangId: string }
  | { name: "berkas"; ruangId: string }
  | { name: "arsip"; ruangId: string }
  | { name: "pengaturan"; ruangId: string }
  | { name: "admin" }
  | { name: "not-found" };

const ID = "([0-9a-f-]{36})";

export function resolveKerjaRoute(pathname: string): KerjaRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/tugas") return { name: "tugas" };
  if (path === "/ruang") return { name: "ruang-daftar" };
  if (path === "/pengelola") return { name: "admin" };
  const match = (pattern: string) => new RegExp(`^${pattern}$`, "i").exec(path)?.[1];
  const papan = match(`/papan/${ID}`);
  if (papan) return { name: "papan", papanId: papan };
  const kartu = match(`/kartu/${ID}`);
  if (kartu) return { name: "kartu", kartuId: kartu };
  for (const name of ["cari", "berkas", "arsip", "pengaturan"] as const) {
    const ruangId = match(`/ruang/${ID}/${name}`);
    if (ruangId) return { name, ruangId };
  }
  const ruang = match(`/ruang/${ID}`);
  if (ruang) return { name: "ruang", ruangId: ruang };
  return { name: "not-found" };
}

/** True on `kerja.sabilulquran.or.id`; the same web bundle then shows only Kerja (§2). */
export function isKerjaHost(hostname: string): boolean {
  return hostname === "kerja.sabilulquran.or.id" || hostname.startsWith("kerja.");
}

/** Client-side navigation without a router library: push the path and tell the app. */
export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
