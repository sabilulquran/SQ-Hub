import { z } from "zod";

const httpsUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
});
const enabled = z.enum(["0", "1"]).default("0");

export function loadDirectoryConfig(env: NodeJS.ProcessEnv = process.env) {
  const syncEnabled = enabled.parse(env.ORG_DIRECTORY_SYNC_ENABLED) === "1";
  const readEnabled = enabled.parse(env.ORG_DIRECTORY_READ_ENABLED) === "1";
  const issuer = syncEnabled || readEnabled ? httpsUrl.parse(env.KEYCLOAK_ISSUER).replace(/\/$/, "") : "";
  const sync = syncEnabled ? {
    issuer,
    sourceUrl: httpsUrl.parse(env.ORG_DIRECTORY_HCIS_BASE_URL),
    clientId: z.string().trim().min(1).parse(env.ORG_DIRECTORY_CLIENT_ID),
    clientSecret: z.string().min(1).parse(env.ORG_DIRECTORY_CLIENT_SECRET),
  } : null;
  const read = readEnabled ? {
    issuer,
    audience: z.string().trim().min(1).parse(env.ORG_DIRECTORY_READ_AUDIENCE),
    allowedClients: new Set(z.string().min(1).parse(env.ORG_DIRECTORY_READ_CLIENTS).split(",").map((c) => c.trim()).filter(Boolean)),
    requiredScope: "organization-directory.read",
  } : null;
  if (read?.allowedClients.size === 0) throw new Error("Directory read client allowlist must not be empty");
  if (sync && [env.SQ_HUB_OIDC_CLIENT_ID, env.KEYCLOAK_DIRECTORY_CLIENT_ID].includes(sync.clientId)) {
    throw new Error("Organization Directory requires a dedicated machine client");
  }
  if (read && (read.allowedClients.has(env.SQ_HUB_OIDC_CLIENT_ID ?? "") || (sync && read.allowedClients.has(sync.clientId)))) {
    throw new Error("Directory consumer and producer identities must be separate");
  }
  return { sync, read };
}
