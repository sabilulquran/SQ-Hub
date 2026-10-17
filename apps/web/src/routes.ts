export type HubRoute = "home" | "apps" | "account" | "admin" | "yayasan" | "not-found";

export function resolveHubRoute(pathname: string): HubRoute {
  if (pathname === "/") return "home";
  if (pathname === "/apps" || pathname === "/apps/") return "apps";
  if (pathname === "/account" || pathname === "/account/") return "account";
  if (pathname === "/yayasan" || pathname === "/yayasan/") return "yayasan";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return "not-found";
}
