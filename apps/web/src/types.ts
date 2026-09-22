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

export interface AccountProfileField {
  name: string;
  label: string;
  required: boolean;
  readOnly: boolean;
  multivalued: boolean;
  values: string[];
  requiredAction: "UPDATE_EMAIL" | null;
}

export interface AccountCredential {
  id: string;
  label: string | null;
  createdAt: number | null;
}

export interface AccountCredentialType {
  type: string;
  category: string;
  label: string;
  helpText: string;
  canCreate: boolean;
  canUpdate: boolean;
  removeable: boolean;
  credentials: AccountCredential[];
}

export interface AccountSession {
  id: string;
  ipAddress: string | null;
  browser: string | null;
  startedAt: number | null;
  lastAccessAt: number | null;
  expiresAt: number | null;
  current: boolean;
  clients: string[];
}

export interface AccountDevice {
  id: string;
  device: string | null;
  os: string | null;
  osVersion: string | null;
  browser: string | null;
  ipAddress: string | null;
  lastAccessAt: number | null;
  current: boolean;
  mobile: boolean;
  sessions: AccountSession[];
}

export interface AccountIdentityApplication {
  clientId: string;
  name: string;
  description: string | null;
  effectiveUrl: string | null;
  inUse: boolean;
  userConsentRequired: boolean;
  offlineAccess: boolean;
  consent: null | {
    createdAt: number | null;
    lastUpdatedAt: number | null;
    scopes: Array<{ id: string; name: string; label: string }>;
  };
}

export interface AccountLinkedIdentity {
  connected: boolean;
  providerAlias: string;
  providerName: string;
  displayName: string;
  linkedUsername: string | null;
  social: boolean;
}

export interface AccountGroup {
  name: string;
  path: string;
}

export interface AccountSnapshot {
  profile: {
    displayName: string;
    username: string | null;
    email: string | null;
    emailVerified: boolean | null;
    fields: AccountProfileField[];
    supportedLocales: string[];
  };
  security: {
    totpConfigured: boolean | null;
    recoveryCodesConfigured: boolean | null;
  };
  applications: WorkspaceApplication[];
  management: {
    available: boolean;
    reauthRequired: boolean;
    credentials: AccountCredentialType[];
    devices: AccountDevice[];
    applications: AccountIdentityApplication[];
    linkedAccounts: AccountLinkedIdentity[];
    availableAccountLinks: AccountLinkedIdentity[];
    groups: AccountGroup[];
  };
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
    // The browser treats anything other than a positively verified true as caution/not verified.
    // The server-side directory model retains the nullable/unknown distinction.
    totpConfigured: boolean;
    recoveryCodesConfigured: boolean;
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
