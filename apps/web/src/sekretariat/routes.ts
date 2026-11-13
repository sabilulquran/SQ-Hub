/** Sekretariat pages on the sekretariat. host (SEK-IMPL-001 §9). */
export type SekretariatRoute =
  | { name: "ringkasan" }
  | { name: "kotak"; kotakId: string }
  | { name: "surat-masuk"; suratMasukId: string }
  | { name: "penerbit-surat"; penerbitId: string }
  | { name: "surat"; suratId: string }
  | { name: "buku" }
  | { name: "pengaturan" }
  | { name: "not-found" };

const ID = "([0-9a-f-]{36})";

export function resolveSekretariatRoute(pathname: string): SekretariatRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/ringkasan") return { name: "ringkasan" };
  if (path === "/buku") return { name: "buku" };
  if (path === "/pengaturan") return { name: "pengaturan" };
  const match = (pattern: string) => new RegExp(`^${pattern}$`, "i").exec(path)?.[1];
  const kotak = match(`/kotak/${ID}`);
  if (kotak) return { name: "kotak", kotakId: kotak };
  const suratMasuk = match(`/surat-masuk/${ID}`);
  if (suratMasuk) return { name: "surat-masuk", suratMasukId: suratMasuk };
  const penerbit = match(`/penerbit/${ID}/surat`);
  if (penerbit) return { name: "penerbit-surat", penerbitId: penerbit };
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
