/** Portal Organ Yayasan pages on the organ. host (ORGAN-IMPL-001 §3, §4). */
export type OrganRoute = { name: "ringkasan" } | { name: "keputusan" } | { name: "not-found" };

export function resolveOrganRoute(pathname: string): OrganRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "ringkasan" };
  if (path === "/keputusan") return { name: "keputusan" };
  return { name: "not-found" };
}

export function isOrganHost(hostname: string): boolean {
  return hostname === "organ.sabilulquran.or.id" || hostname.startsWith("organ.");
}
