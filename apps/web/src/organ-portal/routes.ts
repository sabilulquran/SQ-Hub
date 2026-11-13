/** Portal Organ Yayasan pages on the organ. host (ORGAN-IMPL-001 §3, §4). */
export type OrganRoute =
  | { name: "ringkasan" }
  | { name: "keputusan" }
  | { name: "aplikasi"; applicationKey: string }
  | { name: "not-found" };

export function resolveOrganRoute(pathname: string): OrganRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "ringkasan" };
  if (path === "/keputusan") return { name: "keputusan" };
  const application = /^\/aplikasi\/([a-z0-9][a-z0-9_-]{0,62})$/.exec(path)?.[1];
  if (application) return { name: "aplikasi", applicationKey: application };
  return { name: "not-found" };
}

/** Rincian of one application stays on the organ host (owner, 2026-11-13). */
export function detailHref(applicationKey: string): string {
  return `/aplikasi/${encodeURIComponent(applicationKey)}`;
}

export function isOrganHost(hostname: string): boolean {
  return hostname === "organ.sabilulquran.or.id" || hostname.startsWith("organ.");
}
