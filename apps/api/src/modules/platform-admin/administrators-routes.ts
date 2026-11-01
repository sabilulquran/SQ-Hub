import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { IdentityRef } from "../application-access/types.js";
import { HUB_SESSION_COOKIE_NAME, HubAuthError, readCookie, type HubAuthRuntime } from "../hub-auth/service.js";
import { IdentityDirectoryError, type IdentityDirectory } from "../identity-directory/client.js";
import { PlatformAdminProposalError, type PlatformAdminProposal } from "./proposals.js";
import type { PlatformAdminMembership } from "./repository.js";
import { PlatformAdminAuthorizationError, type PlatformAdminService } from "./service.js";

export const PLATFORM_ADMINISTRATORS_PREFIX = "/admin/platform-administrators";

const subjectBodySchema = z
  .object({
    subject: z.string().trim().min(1).max(512),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const proposalParamsSchema = z.object({ proposalId: z.string().uuid() });
const auditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional().default(100) });

class AdminOriginError extends Error {
  readonly statusCode = 403;
  readonly code = "ADMIN_ORIGIN_FORBIDDEN";
}

interface Person {
  subject: string;
  displayName: string | null;
  username: string | null;
}

/**
 * HUB-IMPL-023 H-9 and H-11. Who the Platform Administrators are, who proposed and confirmed
 * each of them, and every change, readable in the Admin Center without database access. The
 * audit stores identities as hashes; this is the one place they are resolved back to people, and
 * only for a reader who is a Platform Administrator.
 */
export function registerPlatformAdministratorRoutes(
  app: FastifyInstance,
  input: {
    hubAuth: HubAuthRuntime;
    service: Pick<PlatformAdminService, "authorize" | "overview" | "adminAudit" | "propose" | "confirm" | "cancel" | "revokeBySession">;
    identityDirectory: IdentityDirectory;
    allowedOrigin?: string;
  },
) {
  async function authorized(cookie: string | undefined) {
    const session = await input.hubAuth.getSession(readCookie(cookie, HUB_SESSION_COOKIE_NAME));
    await input.service.authorize(session);
    return session;
  }

  function requireSameOrigin(origin: string | undefined) {
    if (!input.allowedOrigin || origin !== input.allowedOrigin) throw new AdminOriginError();
  }

  const identityFor = (subject: string): IdentityRef => ({ issuer: input.identityDirectory.issuer, subject });

  app.get(PLATFORM_ADMINISTRATORS_PREFIX, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorized(request.headers.cookie);
      const overview = await input.service.overview(session);
      const people = await resolvePeople(input.identityDirectory, [
        ...overview.memberships.map((membership) => membership.identity),
        ...overview.proposals.flatMap(proposalIdentities),
      ]);
      return reply.send({
        viewer: { subject: session.subject },
        administrators: overview.memberships.map((membership) => toBrowserMembership(membership, people)),
        proposals: overview.proposals.map((proposal) => toBrowserProposal(proposal, people)),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get(`${PLATFORM_ADMINISTRATORS_PREFIX}/audit`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorized(request.headers.cookie);
      const query = auditQuerySchema.parse(request.query);
      const [overview, records] = await Promise.all([input.service.overview(session), input.service.adminAudit(session, query.limit)]);
      const known = [
        ...overview.memberships.map((membership) => membership.identity),
        ...overview.proposals.flatMap(proposalIdentities),
      ];
      const people = await resolvePeople(input.identityDirectory, known);
      const byDigest = new Map(known.map((identity) => [digest(identity), people.get(key(identity)) ?? null]));
      const resolve = (ref: unknown): Person | null => {
        if (typeof ref !== "string") return null;
        const match = /^(?:staff|platform-admin):([0-9a-f]{64})$/.exec(ref);
        return match ? byDigest.get(match[1]!) ?? null : null;
      };
      return reply.send({
        audit: records.map((record) => ({
          id: record.id,
          action: record.action,
          outcome: record.outcome,
          occurredAt: record.occurredAt.toISOString(),
          reason: typeof record.payload.reason === "string" ? record.payload.reason : null,
          // A ref that is not a staff digest (CLI bootstrap, system) is shown as written.
          actor: resolve(record.actor.ref) ?? { ref: record.actor.ref },
          target: resolve(record.targetRef),
          proposedBy: resolve(record.payload.proposedBy),
        })),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post(`${PLATFORM_ADMINISTRATORS_PREFIX}/proposals`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorized(request.headers.cookie);
      requireSameOrigin(request.headers.origin);
      const body = subjectBodySchema.parse(request.body);
      const staff = await input.identityDirectory.inspect(body.subject);
      if (!staff) return reply.status(404).send({ error: "STAFF_NOT_FOUND" });
      const proposal = await input.service.propose(session, { identity: staff.identity, reason: body.reason });
      const people = await resolvePeople(input.identityDirectory, proposalIdentities(proposal));
      return reply.status(201).send({ proposal: toBrowserProposal(proposal, people) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post(`${PLATFORM_ADMINISTRATORS_PREFIX}/proposals/:proposalId/confirm`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorized(request.headers.cookie);
      requireSameOrigin(request.headers.origin);
      const params = proposalParamsSchema.parse(request.params);
      const result = await input.service.confirm(session, params.proposalId);
      const people = await resolvePeople(input.identityDirectory, proposalIdentities(result.proposal));
      return reply.send({ proposal: toBrowserProposal(result.proposal, people) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post(`${PLATFORM_ADMINISTRATORS_PREFIX}/proposals/:proposalId/cancel`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorized(request.headers.cookie);
      requireSameOrigin(request.headers.origin);
      const params = proposalParamsSchema.parse(request.params);
      const proposal = await input.service.cancel(session, params.proposalId);
      const people = await resolvePeople(input.identityDirectory, proposalIdentities(proposal));
      return reply.send({ proposal: toBrowserProposal(proposal, people) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post(`${PLATFORM_ADMINISTRATORS_PREFIX}/revoke`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const session = await authorized(request.headers.cookie);
      requireSameOrigin(request.headers.origin);
      const body = subjectBodySchema.parse(request.body);
      const result = await input.service.revokeBySession(session, { identity: identityFor(body.subject), reason: body.reason });
      return reply.send({ outcome: result.outcome, status: result.membership?.status ?? null });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

function proposalIdentities(proposal: PlatformAdminProposal): IdentityRef[] {
  return [proposal.identity, proposal.proposer, ...(proposal.decidedBy ? [proposal.decidedBy] : [])];
}

function key(identity: IdentityRef) {
  return `${identity.issuer}\n${identity.subject}`;
}

function digest(identity: IdentityRef) {
  return createHash("sha256").update(key(identity)).digest("hex");
}

/** Directory lookups are best effort: a person the directory cannot name is still shown by subject. */
async function resolvePeople(directory: IdentityDirectory, identities: IdentityRef[]): Promise<Map<string, Person>> {
  const unique = new Map(identities.map((identity) => [key(identity), identity]));
  const people = new Map<string, Person>();
  await Promise.all(
    [...unique.values()].slice(0, 100).map(async (identity) => {
      let displayName: string | null = null;
      let username: string | null = null;
      if (identity.issuer === directory.issuer) {
        try {
          const staff = await directory.inspect(identity.subject);
          displayName = staff?.displayName ?? null;
          username = staff?.username ?? null;
        } catch {
          // Leave the name empty; the subject still identifies the person.
        }
      }
      people.set(key(identity), { subject: identity.subject, displayName, username });
    }),
  );
  return people;
}

function person(people: Map<string, Person>, identity: IdentityRef): Person {
  return people.get(key(identity)) ?? { subject: identity.subject, displayName: null, username: null };
}

function toBrowserMembership(membership: PlatformAdminMembership, people: Map<string, Person>) {
  return {
    person: person(people, membership.identity),
    status: membership.status,
    reason: membership.reason,
    grantedAt: membership.grantedAt?.toISOString() ?? null,
    revokedAt: membership.revokedAt?.toISOString() ?? null,
  };
}

function toBrowserProposal(proposal: PlatformAdminProposal, people: Map<string, Person>) {
  const expired = proposal.status === "pending" && proposal.expiresAt.getTime() <= Date.now();
  return {
    id: proposal.id,
    person: person(people, proposal.identity),
    proposedBy: person(people, proposal.proposer),
    decidedBy: proposal.decidedBy ? person(people, proposal.decidedBy) : null,
    reason: proposal.reason,
    status: expired ? "expired" : proposal.status,
    createdAt: proposal.createdAt.toISOString(),
    expiresAt: proposal.expiresAt.toISOString(),
    decidedAt: proposal.decidedAt?.toISOString() ?? null,
  };
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof HubAuthError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof PlatformAdminAuthorizationError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof AdminOriginError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof PlatformAdminProposalError) return reply.status(error.statusCode).send({ error: error.code });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: "INVALID_REQUEST" });
  if (error instanceof IdentityDirectoryError) return reply.status(503).send({ error: "IDENTITY_DIRECTORY_UNAVAILABLE" });
  return reply.status(503).send({ error: "ADMIN_VERIFICATION_UNAVAILABLE" });
}
