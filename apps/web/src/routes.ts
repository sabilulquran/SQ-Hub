export type HubRoute = "home" | "apps" | "account" | "admin" | "not-found";

export function resolveHubRoute(pathname: string): HubRoute {
  if (pathname === "/") return "home";
  if (pathname === "/apps" || pathname === "/apps/") return "apps";
  if (pathname === "/account" || pathname === "/account/") return "account";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return "not-found";
}
