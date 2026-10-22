import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import type { KeycloakAccountSelfService } from "./modules/account-self-service/client.js";
import { invalidRequestFields, invalidRequestIssues } from "./invalid-request.js";
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
import { listLauncherApplications } from "./modules/application-access/launcher.js";
import { registerHubAuthRoutes } from "./modules/hub-auth/routes.js";
import type { HubWorkspaceApplicationSource } from "./modules/hub-auth/workspace-repository.js";
import type { KirimModule } from "./modules/kirim/module.js";
import { KIRIM_ADMIN_PREFIX } from "./modules/kirim/routes-admin.js";
import { KIRIM_INTERNAL_PREFIX } from "./modules/kirim/routes-internal.js";
import type { HubAuthRuntime } from "./modules/hub-auth/service.js";
import type { IdentityDirectory } from "./modules/identity-directory/client.js";
import { registerGovernanceRoutes } from "./modules/governance/routes.js";
import type { GovernanceService } from "./modules/governance/service.js";
import { registerOrganMembershipRoutes } from "./modules/organ-membership/routes.js";
import type { OrganMembershipService } from "./modules/organ-membership/service.js";
import { registerPlatformAdminRoutes } from "./modules/platform-admin/routes.js";
import type { PlatformAdminService } from "./modules/platform-admin/service.js";
import { DIRECTORY_PREFIX, registerOrganizationDirectoryRoutes } from "./modules/organization-directory/routes.js";
import { registerStaffLifecycleRoutes } from "./modules/staff-lifecycle/routes.js";
import type { StaffLifecycleService } from "./modules/staff-lifecycle/service.js";

const checkBodySchema = z
  .object({
    identity: identityRefSchema,
    applicationKey: applicationKeySchema,
  })
  .strict();

// HUB-IMPL-022 §3: identity only; an extra key is rejected the same way as on /check.
const launcherBodySchema = z
  .object({
    identity: identityRefSchema,
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
  staffLifecycle?: StaffLifecycleService;
  organMemberships?: OrganMembershipService;
  governance?: GovernanceService;
  logger?: boolean;
  /** Test seam: write request logs to this stream instead of stdout. */
  logStream?: NodeJS.WritableStream;
  organizationDirectory?: Parameters<typeof registerOrganizationDirectoryRoutes>[1];
  kirim?: Pick<KirimModule, "register">;
  /** HUB-IMPL-022: source of POST /internal/v1/application-access/launcher (same rows as /api/workspace). */
  launcher?: { applications: HubWorkspaceApplicationSource; hubOrigin?: string };
}) {
  const app = Fastify({ logger: input.logger || input.logStream ? {
    ...(input.logStream ? { stream: input.logStream } : {}),
    serializers: {
      req(request) {
        return { method: request.method, url: safeLogUrl(request.url) };
      },
    },
  } : false });

  if (input.organizationDirectory) registerOrganizationDirectoryRoutes(app, input.organizationDirectory);
  // KIRIM-IMPL-001 §11: KIRIM_ENABLED=false means the module is not passed and no route exists.
  if (input.kirim) input.kirim.register(app);

  app.get("/health", async () => ({ status: "ok" }));

  /** One machine-token check for every Application Access internal route; false means already answered. */
  async function machineAuthorized(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      await reply.code(401).send({ error: "UNAUTHENTICATED" });
      return false;
    }

    try {
      await input.verifyMachineToken(token);
      return true;
    } catch (error) {
      if (error instanceof MachineAuthError) {
        const status = error.code === "FORBIDDEN_CLIENT" ? 403 : 401;
        await reply.code(status).send({ error: error.code });
        return false;
      }
      throw error;
    }
  }

  app.post("/internal/v1/application-access/check", async (request, reply) => {
    if (!(await machineAuthorized(request, reply))) return reply;

    const parsed = checkBodySchema.safeParse(request.body);
    if (!parsed.success) {
      // Paths and issue codes only: an identity body can carry personal data, so the
      // submitted values go neither into the answer nor into the log.
      request.log.warn(
        { category: "internal_invalid_request", issues: invalidRequestIssues(parsed.error) },
        "application access check body rejected",
      );
      return reply.code(400).send({ error: "INVALID_REQUEST", fields: invalidRequestFields(parsed.error) });
    }

    const decision = await input.accessService.checkAccess(
      parsed.data.identity,
      parsed.data.applicationKey,
    );
    return reply.code(200).send(decision);
  });

  const launcher = input.launcher;
  if (launcher) {
    // HUB-IMPL-022: the header launcher list for one staff identity, asked server-to-server by an app.
    app.post("/internal/v1/application-access/launcher", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!(await machineAuthorized(request, reply))) return reply;

      const parsed = launcherBodySchema.safeParse(request.body);
      if (!parsed.success) {
        // Paths and issue codes only, as on /check: identity values stay out of answer and log.
        request.log.warn(
          { category: "internal_invalid_request", issues: invalidRequestIssues(parsed.error) },
          "application launcher body rejected",
        );
        return reply.code(400).send({ error: "INVALID_REQUEST", fields: invalidRequestFields(parsed.error) });
      }

      // An unknown identity has no grants, so it gets an empty list rather than an error.
      const applications = await listLauncherApplications(launcher.applications, parsed.data.identity, launcher.hubOrigin);
      return reply.code(200).send({ applications });
    });
  }

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

  if (input.hubAuth && input.platformAdmin && input.staffLifecycle) {
    registerStaffLifecycleRoutes(app, {
      hubAuth: input.hubAuth,
      platformAdmin: input.platformAdmin,
      service: input.staffLifecycle,
      ...(input.adminAllowedOrigin ? { allowedOrigin: input.adminAllowedOrigin } : {}),
    });
  }

  if (input.hubAuth && input.governance) {
    registerGovernanceRoutes(app, { hubAuth: input.hubAuth, service: input.governance });
  }

  if (input.hubAuth && input.platformAdmin && input.organMemberships) {
    registerOrganMembershipRoutes(app, {
      hubAuth: input.hubAuth,
      platformAdmin: input.platformAdmin,
      service: input.organMemberships,
      ...(input.adminAllowedOrigin ? { allowedOrigin: input.adminAllowedOrigin } : {}),
    });
  }

  return app;
}

/**
 * Request logs never carry a query string for Kirim SQ routes (KIRIM-IMPL-001 §10); bodies and
 * headers are not logged by the serializer at all.
 */
export function safeLogUrl(url: string): string {
  if (url.startsWith(DIRECTORY_PREFIX)) return DIRECTORY_PREFIX;
  if (url.startsWith(KIRIM_INTERNAL_PREFIX) || url.startsWith(KIRIM_ADMIN_PREFIX)) return url.split("?", 1)[0] ?? url;
  return url;
}
