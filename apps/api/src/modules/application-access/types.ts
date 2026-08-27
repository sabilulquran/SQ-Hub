export interface IdentityRef {
  issuer: string;
  subject: string;
}

export type ActorKind = "human" | "service" | "system";

export interface ActorRef {
  kind: ActorKind;
  ref: string;
}

export type ApplicationStatus = "active" | "inactive";
export type AccessStatus = "active" | "revoked";

export interface ApplicationRecord {
  id: string;
  applicationKey: string;
  name: string;
  canonicalUrl: string;
  status: ApplicationStatus;
}

export interface AccessRecord {
  id: string;
  identity: IdentityRef;
  applicationKey: string;
  status: AccessStatus;
  reason: string | null;
  actor: ActorRef;
  grantedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
}

export type AccessDecisionCode =
  | "active_grant"
  | "NO_GRANT"
  | "GRANT_REVOKED"
  | "APPLICATION_INACTIVE"
  | "UNKNOWN_APPLICATION";

export interface AccessDecision {
  allowed: boolean;
  applicationKey: string;
  decision: AccessDecisionCode;
}

export interface AuditRecord {
  id: string;
  actor: ActorRef;
  action: string;
  targetType: string;
  targetRef: string;
  outcome: "succeeded" | "failed" | "noop";
  payload: Record<string, unknown>;
  occurredAt: string;
}
