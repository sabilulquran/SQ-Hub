import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { applicationKeySchema } from "../application-access/service.js";
import type { IdentityRef } from "../application-access/types.js";
import { GovernanceForbiddenError, type GovernanceService } from "../governance/service.js";
import { HubAuthError, readCookie, type HubAuthRuntime } from "../hub-auth/service.js";
import type { Organ } from "../organ-membership/repository.js";

export const ORGAN_SESSION_COOKIE_NAME = "sq_organ_session";
export const ORGAN_OIDC_TRANSACTION_COOKIE_NAME = "sq_organ_oidc_tx";

export interface OrganGate {
  access: { checkAccess(identity: IdentityRef, applicationKey: string): Promise<{ allowed: boolean }> };
  memberships: { getEffective(identity: IdentityRef): Promise<{ organ: Organ; positionLabel: string | null } | null> };
  applicationKey: string;
}

class OrganPortalError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super(code);
  }
}

/**
 * ORGAN-IMPL-001 §1.2: an effective member with active Application Access to the portal. Checked
 * at the callback and again on every request, so a membership that ends mid-session stops at
 * once. Any failure of either source is a refusal.
 */
async function admit(gate: OrganGate, identity: IdentityRef) {
  const access = await gate.access.checkAccess(identity, gate.applicationKey).catch(() => ({ allowed: false }));
  if (!access.allowed) throw new OrganPortalError(403, "organ_access_denied");
  const membership = await gate.memberships.getEffective(identity).catch(() => null);
  if (!membership) throw new OrganPortalError(403, "organ_membership_required");
  return membership;
}

function hostConstraint(publicOrigin: string) {
  const origin = new URL(publicOrigin);
  return { host: new RegExp(`^${origin.hostname.replace(/\./g, "\\.")}(:\\d+)?$`) };
}

function context(request: FastifyRequest) {
  return { ipAddress: request.ip || null, userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null };
}

/**
 * §1.1, as Kirim D-1 and Kerja: the `sq-organ` client reuses the Hub auth code with its own
 * host-only cookies, and these routes match only the `organ.` host. The session is bound to the
 * client (§1.2), so a Hub session cookie under this name is refused.
 */
export function registerOrganAuthRoutes(
  app: FastifyInstance,
  input: { auth: HubAuthRuntime; publicOrigin: string; gate: OrganGate },
) {
  const constraints = hostConstraint(input.publicOrigin);

  app.get("/auth/oidc/start", { constraints }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const result = await input.auth.beginLogin(undefined, "/");
      reply.header("Set-Cookie", result.setCookie);
      return reply.redirect(result.authorizationUrl.href);
    } catch {
      return reply.redirect("/?authError=identity_unavailable");
    }
  });

  app.get("/auth/callback", { constraints, logLevel: "silent" }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
    const callbackUrl = new URL(`/api/auth/callback${query}`, input.publicOrigin);
    let result;
    try {
      result = await input.auth.completeLogin(callbackUrl, readCookie(request.headers.cookie, ORGAN_OIDC_TRANSACTION_COOKIE_NAME), context(request));
    } catch {
      reply.header("Set-Cookie", input.auth.clearTransactionCookie());
      return reply.redirect("/?authError=oidc_failed");
    }

    // §1.2: no session for anyone the gate refuses. The new session is revoked at once.
    const sessionToken = readCookie(result.setCookies.map((cookie) => cookie.split(";")[0]).join("; "), ORGAN_SESSION_COOKIE_NAME);
    try {
      const session = await input.auth.getSession(sessionToken);
      await admit(input.gate, { issuer: session.issuer, subject: session.subject });
    } catch (error) {
      const ended = await input.auth.logout(sessionToken, context(request)).catch(() => null);
      reply.raw.setHeader("Set-Cookie", [ended?.clearCookie ?? "", input.auth.clearTransactionCookie()].filter(Boolean));
      const code = error instanceof OrganPortalError ? error.code : "oidc_failed";
      return reply.redirect(`/?authError=${code}`);
    }
    reply.raw.setHeader("Set-Cookie", result.setCookies);
    return reply.redirect("/");
  });

  app.post("/auth/logout", { constraints }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (request.headers.origin !== input.publicOrigin) {
      return reply.status(403).send({ error: "origin_forbidden" });
    }
    const result = await input.auth.logout(readCookie(request.headers.cookie, ORGAN_SESSION_COOKIE_NAME), context(request));
    reply.header("Set-Cookie", result.clearCookie);
    return reply.send({ logoutUrl: result.logoutUrl?.href ?? null });
  });
}

/** §3, §4.1: the portal's browser API. Every route re-checks the gate before anything else. */
export function registerOrganRoutes(
  app: FastifyInstance,
  input: { auth: HubAuthRuntime; governance: GovernanceService; publicOrigin: string; gate: OrganGate },
) {
  const constraints = hostConstraint(input.publicOrigin);

  async function member(request: FastifyRequest) {
    const sessionToken = readCookie(request.headers.cookie, ORGAN_SESSION_COOKIE_NAME);
    let session;
    try {
      session = await input.auth.getSession(sessionToken);
    } catch (error) {
      if (error instanceof HubAuthError) throw new OrganPortalError(401, "unauthenticated");
      throw error;
    }
    const membership = await admit(input.gate, { issuer: session.issuer, subject: session.subject });
    return { session, sessionToken, membership };
  }

  app.get("/organ/session", { constraints }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { session, membership } = await member(request);
      return reply.send({
        user: { displayName: session.displayName },
        membership: { organ: membership.organ, ...(membership.positionLabel ? { positionLabel: membership.positionLabel } : {}) },
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get("/organ/summaries", { constraints }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { session, sessionToken } = await member(request);
      return reply.send(await input.governance.snapshot(session, sessionToken));
    } catch (error) {
      return fail(reply, error);
    }
  });

  // Retry for one failed card; bypasses the in-memory cache for that application only.
  app.get("/organ/summaries/:applicationKey", { constraints }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const params = z.object({ applicationKey: applicationKeySchema }).parse(request.params);
      const { session, sessionToken } = await member(request);
      const snapshot = await input.governance.snapshot(session, sessionToken, { only: params.applicationKey });
      return reply.send({ card: snapshot.cards[0] ?? null, generatedAt: snapshot.generatedAt });
    } catch (error) {
      return fail(reply, error);
    }
  });
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof OrganPortalError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof HubAuthError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof GovernanceForbiddenError) return reply.status(403).send({ error: "organ_membership_required" });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: "INVALID_REQUEST" });
  return reply.status(503).send({ error: "GOVERNANCE_UNAVAILABLE" });
}
