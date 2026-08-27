import Fastify from "fastify";
import { z } from "zod";

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

const checkBodySchema = z
  .object({
    identity: identityRefSchema,
    applicationKey: applicationKeySchema,
  })
  .strict();

export function buildApp(input: {
  accessService: Pick<ApplicationAccessService, "checkAccess">;
  verifyMachineToken: VerifyMachineToken;
  logger?: boolean;
}) {
  const app = Fastify({ logger: input.logger ?? false });

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

  return app;
}
