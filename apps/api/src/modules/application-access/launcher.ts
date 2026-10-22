import type { HubWorkspaceApplicationSource } from "../hub-auth/workspace-repository.js";

/**
 * HUB-IMPL-022: the application list every SQ Core app shows in its header launcher.
 * Same rows as GET /api/workspace (active application + active grant, ordered by name),
 * minus SQ Hub itself, because each app renders the SQ Hub row on its own.
 */
export const HUB_APPLICATION_KEY = "sq-hub";

export interface LauncherApplication {
  key: string;
  name: string;
  canonicalUrl: string;
}

export async function listLauncherApplications(
  source: HubWorkspaceApplicationSource,
  identity: { issuer: string; subject: string },
  hubOrigin?: string,
): Promise<LauncherApplication[]> {
  const rows = await source.listAuthorizedApplications(identity);
  return rows
    .filter((row) => row.applicationKey !== HUB_APPLICATION_KEY && !(hubOrigin && sameOrigin(row.canonicalUrl, hubOrigin)))
    .map((row) => ({ key: row.applicationKey, name: row.name, canonicalUrl: row.canonicalUrl }));
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
