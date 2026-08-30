import type { ActorRef, IdentityRef } from "../application-access/types.js";

export type PlatformAdminStatus = "active" | "revoked";

export interface PlatformAdminRecord {
  id: string;
  identity: IdentityRef;
  status: PlatformAdminStatus;
  reason: string | null;
  actor: ActorRef;
  grantedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
}

export type PlatformAdminAuthorization =
  | { status: "authorized" }
  | { status: "forbidden" }
  | { status: "reauth_required" };

export interface PlatformAdminOverview {
  applications: {
    total: number;
    active: number;
    inactive: number;
  };
  applicationAccess: {
    total: number;
    active: number;
    revoked: number;
  };
  auditEventsLast24Hours: number;
}
