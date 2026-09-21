import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { KeycloakAccountSelfService } from "./modules/account-self-service/client.js";
import { createKeycloakMachineTokenVerifier } from "./modules/application-access/machine-auth.js";
import { PgApplicationAccessRepository } from "./modules/application-access/repository.js";
import { ApplicationAccessService } from "./modules/application-access/service.js";
import { HubOidcProvider } from "./modules/hub-auth/oidc-provider.js";
import { PgHubAuthRepository } from "./modules/hub-auth/repository.js";
import { HubAuthService } from "./modules/hub-auth/service.js";
import { HubTokenVault } from "./modules/hub-auth/token-vault.js";
import { PgHubWorkspaceRepository } from "./modules/hub-auth/workspace-repository.js";
import { KeycloakIdentityDirectory } from "./modules/identity-directory/client.js";
import { PgPlatformAdminRepository } from "./modules/platform-admin/repository.js";
import { PlatformAdminService } from "./modules/platform-admin/service.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const repository = new PgApplicationAccessRepository(pool);
const accessService = new ApplicationAccessService(repository);
const platformAdmin = new PlatformAdminService(new PgPlatformAdminRepository(pool));
const identityDirectory = new KeycloakIdentityDirectory({
  baseUrl: config.keycloakDirectoryBaseUrl,
  realm: config.keycloakDirectoryRealm,
  issuer: config.keycloakIssuer,
  clientId: config.keycloakDirectoryClientId,
  clientSecret: config.keycloakDirectoryClientSecret,
});
const verifyMachineToken = createKeycloakMachineTokenVerifier({
  issuer: config.keycloakIssuer,
  audience: config.machineTokenAudience,
  allowedClients: config.allowedMachineClients,
});

const hubOidcProvider = new HubOidcProvider({
  issuer: config.keycloakIssuer,
  clientId: config.hubOidcClientId,
  clientSecret: config.hubOidcClientSecret,
  redirectUri: config.hubOidcRedirectUri,
  postLogoutRedirectUri: config.hubOidcPostLogoutRedirectUri,
});
const accountSelfService = new KeycloakAccountSelfService(config.keycloakIssuer);
const hubAuth = new HubAuthService(
  new PgHubAuthRepository(pool),
  hubOidcProvider,
  new PgHubWorkspaceRepository(pool),
  {
    sessionIdleHours: config.hubSessionIdleHours,
    sessionMaxHours: config.hubSessionMaxHours,
    transactionTtlMinutes: config.hubOidcTransactionTtlMinutes,
    secureCookies: config.hubCookieSecure,
  },
  new HubTokenVault(config.hubOidcClientSecret),
  platformAdmin,
);

const app = buildApp({
  accessService,
  verifyMachineToken,
  hubAuth,
  hubRedirectUri: config.hubOidcRedirectUri,
  adminAllowedOrigin: new URL(config.hubOidcRedirectUri).origin,
  platformAdmin,
  adminApplicationRegistry: accessService,
  adminApplicationAccess: accessService,
  identityDirectory,
  accountSelfService,
  logger: true,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
