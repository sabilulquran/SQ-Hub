export type AdminRouteState = "loading" | "authorized" | "forbidden" | "reauth" | "unavailable";

export function adminRouteStateFromResponse(status: number, error?: string): AdminRouteState {
  if (status === 403) {
    return error === "ADMIN_REAUTH_REQUIRED" ? "reauth" : "forbidden";
  }
  return status >= 200 && status < 300 ? "authorized" : "unavailable";
}
