import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { IdentityRef } from "../application-access/types.js";
import {
  GovernanceService,
  PgGovernanceApplicationSource,
  type GovernanceLogEntry,
  type GovernanceObservationStore,
} from "../governance/service.js";
import { KeycloakTokenExchanger, type TokenExchanger } from "../governance/token-exchange.js";
import { HubOidcProvider } from "../hub-auth/oidc-provider.js";
import { PgHubAuthRepository } from "../hub-auth/repository.js";
import { HubAuthService, type HubAuthRuntime } from "../hub-auth/service.js";
import { HubTokenVault } from "../hub-auth/token-vault.js";
import { PgHubWorkspaceRepository, type HubWorkspaceApplicationSource } from "../hub-auth/workspace-repository.js";
import type { Organ } from "../organ-membership/repository.js";
import type { OrganPortalConfig } from "./config.js";
import {
  ORGAN_OIDC_TRANSACTION_COOKIE_NAME,
  ORGAN_SESSION_COOKIE_NAME,
  registerOrganAuthRoutes,
  registerOrganRoutes,
} from "./routes.js";

export interface OrganPortalModule {
  governance: GovernanceService;
  register(app: FastifyInstance): void;
}

/**
 * Wires the Portal Organ Yayasan (ORGAN-IMPL-001, ADR-0012 D2) into the SQ Hub API process:
 * no new process, the existing membership, registry and governance-summary code, and its own
 * OIDC client, cookies and token exchanges as `sq-organ`.
 */
export function createOrganPortalModule(input: {
  pool: Pool;
  config: OrganPortalConfig;
  keycloakIssuer: string;
  access: { checkAccess(identity: IdentityRef, applicationKey: string): Promise<{ allowed: boolean }> };
  memberships: { getEffective(identity: IdentityRef): Promise<{ organ: Organ; positionLabel: string | null } | null> };
  observations?: GovernanceObservationStore;
  workspaceApplications?: HubWorkspaceApplicationSource;
  secureCookies?: boolean;
  log?: (entry: GovernanceLogEntry) => void;
  /** Test seams. */
  auth?: HubAuthRuntime;
  exchanger?: TokenExchanger;
  fetch?: typeof fetch;
}): OrganPortalModule {
  const { pool, config } = input;

  const auth = input.auth ?? new HubAuthService(
    new PgHubAuthRepository(pool),
    new HubOidcProvider({
      issuer: input.keycloakIssuer,
      clientId: config.oidc.clientId,
      clientSecret: config.oidc.clientSecret,
      redirectUri: `${config.publicOrigin}/api/auth/callback`,
      postLogoutRedirectUri: `${config.publicOrigin}/`,
    }),
    input.workspaceApplications ?? new PgHubWorkspaceRepository(pool),
    {
      sessionIdleHours: 8,
      sessionMaxHours: 12,
      transactionTtlMinutes: 10,
      secureCookies: input.secureCookies ?? true,
      cookieNames: { session: ORGAN_SESSION_COOKIE_NAME, transaction: ORGAN_OIDC_TRANSACTION_COOKIE_NAME },
      sessionClientId: config.oidc.clientId,
    },
    new HubTokenVault(config.oidc.clientSecret),
  );

  // §3: summaries are fetched as the member, exchanged by `sq-organ`, so `azp` is the portal.
  const governance = new GovernanceService({
    memberships: input.memberships,
    applications: new PgGovernanceApplicationSource(pool),
    userAccessToken: async (sessionToken) => (await auth.getAccountAccess(sessionToken)).accessToken,
    exchanger: input.exchanger ?? new KeycloakTokenExchanger({
      issuer: input.keycloakIssuer,
      clientId: config.oidc.clientId,
      clientSecret: config.oidc.clientSecret,
    }),
    ...(input.observations ? { observations: input.observations } : {}),
    ...(input.log ? { log: input.log } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}),
  });

  const gate = { access: input.access, memberships: input.memberships, applicationKey: config.applicationKey };

  return {
    governance,
    register(app) {
      registerOrganAuthRoutes(app, { auth, publicOrigin: config.publicOrigin, gate });
      registerOrganRoutes(app, { auth, governance, publicOrigin: config.publicOrigin, gate });
    },
  };
}
