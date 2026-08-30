import type { ActorRef, IdentityRef } from "../application-access/types.js";
import type { HubSessionRecord } from "../hub-auth/repository.js";
import type {
  PlatformAdminMutationResult,
  PlatformAdminRepository,
} from "./repository.js";
import type {
  PlatformAdminAuthorization,
  PlatformAdminOverview,
  PlatformAdminRecord,
} from "./types.js";

export interface PlatformAdminRuntime {
  getMembership(identity: IdentityRef): Promise<PlatformAdminRecord | null>;
  grant(input: {
    identity: IdentityRef;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult>;
  revoke(input: {
    identity: IdentityRef;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult>;
  authorizeSession(session: HubSessionRecord): Promise<PlatformAdminAuthorization>;
  getOverview(): Promise<PlatformAdminOverview>;
}

export class PlatformAdminService implements PlatformAdminRuntime {
  constructor(private readonly repository: PlatformAdminRepository) {}

  getMembership(identity: IdentityRef): Promise<PlatformAdminRecord | null> {
    return this.repository.getMembership(normalizeIdentity(identity));
  }

  grant(input: {
    identity: IdentityRef;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult> {
    return this.repository.setMembership({
      identity: normalizeIdentity(input.identity),
      status: "active",
      reason: requiredText(input.reason, "reason"),
      actor: normalizeActor(input.actor),
    });
  }

  revoke(input: {
    identity: IdentityRef;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult> {
    return this.repository.setMembership({
      identity: normalizeIdentity(input.identity),
      status: "revoked",
      reason: requiredText(input.reason, "reason"),
      actor: normalizeActor(input.actor),
    });
  }

  authorizeSession(session: HubSessionRecord): Promise<PlatformAdminAuthorization> {
    return this.repository.authorizeSession({
      identity: { issuer: session.issuer, subject: session.subject },
      sessionCreatedAt: session.createdAt,
    });
  }

  getOverview(): Promise<PlatformAdminOverview> {
    return this.repository.getOverview();
  }
}

function normalizeIdentity(identity: IdentityRef): IdentityRef {
  return {
    issuer: requiredText(identity.issuer, "issuer").replace(/\/$/, ""),
    subject: requiredText(identity.subject, "subject"),
  };
}

function normalizeActor(actor: ActorRef): ActorRef {
  if (!(["human", "service", "system"] as const).includes(actor.kind)) {
    throw new Error("actor kind must be human, service, or system");
  }
  return { kind: actor.kind, ref: requiredText(actor.ref, "actor ref") };
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}
