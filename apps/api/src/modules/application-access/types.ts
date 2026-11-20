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
  /** HUB-IMPL-021: path on the canonical_url origin; null when the app publishes no governance summary. */
  governanceSummaryPath: string | null;
  /** Keycloak client ID used as the token-exchange audience; required with the path. */
  governanceAudience: string | null;
  governanceOrder: number;
  /** ORGAN-IMPL-001 §4.2: path on the canonical_url origin where this application takes decisions. */
  decisionPath: string | null;
  /** The token-exchange audience for decisions; never the summary audience, and required with the path. */
  decisionAudience: string | null;
  /** ADR-0011 amendment 2026-11-16: `modul` is an SQ Core module, `luar` an application outside SQ Core. A label only. */
  kind: ApplicationKind;
  /** KIRIM-IMPL-003 K-2: the application gets a Kirim SQ card and may send WhatsApp through it. */
  whatsappCapable: boolean;
  /** The Keycloak machine client (service account) the application calls SQ Hub with; required with `whatsappCapable`. */
  machineClientId: string | null;
}

export type ApplicationKind = "modul" | "luar";

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
