export interface WorkspaceUser {
  displayName: string;
  initials: string;
  contextLabel?: string;
}

export interface WorkspaceApplication {
  key: string;
  name: string;
  description?: string;
  canonicalUrl: string;
}

export interface WorkspaceCapabilities {
  platformAdministration: boolean;
}

export interface WorkspaceSnapshot {
  user: WorkspaceUser;
  applications: WorkspaceApplication[];
  capabilities: WorkspaceCapabilities;
}

export interface AdminApplication {
  key: string;
  name: string;
  canonicalUrl: string;
  status: "active" | "inactive";
}

export interface AdminStaff {
  subject: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  enabled: boolean;
  security: {
    totpConfigured: boolean | null;
    recoveryCodesConfigured: boolean | null;
  };
}

export interface AdminStaffAccess {
  application: AdminApplication;
  status: "active" | "revoked" | "none";
  reason: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  updatedAt: string | null;
}

export interface AdminAuditRecord {
  id: string;
  actor: { kind: "human" | "service" | "system"; ref: string };
  action: string;
  targetType: string;
  outcome: "succeeded" | "failed" | "noop";
  payload: Record<string, unknown>;
  occurredAt: string;
}
