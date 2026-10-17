import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { applicationKeySchema } from "../application-access/service.js";
import { HUB_SESSION_COOKIE_NAME, HubAuthError, readCookie, type HubAuthRuntime } from "../hub-auth/service.js";
import { GovernanceForbiddenError, type GovernanceService } from "./service.js";

/**
 * Browser contract (HUB-IMPL-021 §4). Requires a Hub session and an effective organ membership;
 * responses are never cached by the browser or intermediaries.
 */
export function registerGovernanceRoutes(app: FastifyInstance, input: { hubAuth: HubAuthRuntime; service: GovernanceService }) {
  app.get("/governance/summaries", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const session = await input.hubAuth.getSession(sessionToken);
      return reply.send(await input.service.snapshot(session, sessionToken));
    } catch (error) {
      return sendGovernanceError(reply, error);
    }
  });

  // Retry for one failed card; bypasses the in-memory cache for that application only.
  app.get("/governance/summaries/:applicationKey", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const sessionToken = readCookie(request.headers.cookie, HUB_SESSION_COOKIE_NAME);
    try {
      const params = z.object({ applicationKey: applicationKeySchema }).parse(request.params);
      const session = await input.hubAuth.getSession(sessionToken);
      const snapshot = await input.service.snapshot(session, sessionToken, { only: params.applicationKey });
      return reply.send({ card: snapshot.cards[0] ?? null, generatedAt: snapshot.generatedAt });
    } catch (error) {
      return sendGovernanceError(reply, error);
    }
  });
}

function sendGovernanceError(reply: FastifyReply, error: unknown) {
  if (error instanceof HubAuthError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof GovernanceForbiddenError) return reply.status(403).send({ error: error.code });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: "INVALID_REQUEST" });
  return reply.status(503).send({ error: "GOVERNANCE_UNAVAILABLE" });
}
