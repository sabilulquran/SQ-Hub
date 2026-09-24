import Fastify from "fastify";
import { z } from "zod";

import type { KeycloakAccountSelfService } from "./modules/account-self-service/client.js";
import {
  MachineAuthError,
  readBearerToken,
  type VerifyMachineToken,
} from "./modules/application-access/machine-auth.js";
import {
  applicationKeySchema,
  identityRefSchema,
  type ApplicationAccessService,
} from "./modules/application-access/service.js";
import { registerHubAuthRoutes } from "./modules/hub-auth/routes.js";
import type { HubAuthRuntime } from "./modules/hub-auth/service.js";
import type { IdentityDirectory } from "./modules/identity-directory/client.js";
import { registerPlatformAdminRoutes } from "./modules/platform-admin/routes.js";
import type { PlatformAdminService } from "./modules/platform-admin/service.js";
import { DIRECTORY_PREFIX, registerOrganizationDirectoryRoutes } from "./modules/organization-directory/routes.js";

const checkBodySchema = z
  .object({
    identity: identityRefSchema,
    applicationKey: applicationKeySchema,
  })
  .strict();

export function buildApp(input: {
  accessService: Pick<ApplicationAccessService, "checkAccess">;
  verifyMachineToken: VerifyMachineToken;
  hubAuth?: HubAuthRuntime;
  hubRedirectUri?: string;
  adminAllowedOrigin?: string;
  platformAdmin?: Pick<PlatformAdminService, "authorize">;
  adminApplicationRegistry?: Pick<ApplicationAccessService, "listApplications" | "upsertApplication">;
  adminApplicationAccess?: Pick<
    ApplicationAccessService,
    "listApplications" | "getAccess" | "grant" | "revoke" | "listAudit"
  >;
  identityDirectory?: IdentityDirectory;
  accountSelfService?: KeycloakAccountSelfService;
  logger?: boolean;
  organizationDirectory?: Parameters<typeof registerOrganizationDirectoryRoutes>[1];
}) {
  const app = Fastify({ logger: input.logger ? {
    serializers: {
      req(request) {
        return { method: request.method, url: request.url?.startsWith(DIRECTORY_PREFIX) ? DIRECTORY_PREFIX : request.url };
      },
    },
  } : false });

  if (input.organizationDirectory) registerOrganizationDirectoryRoutes(app, input.organizationDirectory);

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/internal/v1/application-access/check", async (request, reply) => {
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({ error: "UNAUTHENTICATED" });
    }

    try {
      await input.verifyMachineToken(token);
    } catch (error) {
      if (error instanceof MachineAuthError) {
        const status = error.code === "FORBIDDEN_CLIENT" ? 403 : 401;
        return reply.code(status).send({ error: error.code });
      }
      throw error;
    }

    const parsed = checkBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }

    const decision = await input.accessService.checkAccess(
      parsed.data.identity,
      parsed.data.applicationKey,
    );
    return reply.code(200).send(decision);
  });

  if (input.hubAuth) {
    if (!input.hubRedirectUri) {
      throw new Error("hubRedirectUri is required when Hub auth routes are enabled");
    }
    registerHubAuthRoutes(
      app,
      input.hubAuth,
      input.hubRedirectUri,
      input.identityDirectory,
      input.accountSelfService,
    );
  }

  if (input.hubAuth && input.platformAdmin && input.adminApplicationRegistry) {
    registerPlatformAdminRoutes(app, {
      hubAuth: input.hubAuth,
      platformAdmin: input.platformAdmin,
      applicationRegistry: input.adminApplicationRegistry,
      ...(input.adminAllowedOrigin ? { allowedOrigin: input.adminAllowedOrigin } : {}),
      ...(input.adminApplicationAccess ? { applicationAccess: input.adminApplicationAccess } : {}),
      ...(input.identityDirectory ? { identityDirectory: input.identityDirectory } : {}),
    });
  }

  return app;
}
