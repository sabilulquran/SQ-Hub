export interface WorkspaceUser {
  displayName: string;
  initials: string;
  contextLabel?: string;
  /** HUB-IMPL-021: organ of an effective Organ Yayasan membership. */
  organ?: Organ;
}

export interface WorkspaceApplication {
  key: string;
  name: string;
  description?: string;
  canonicalUrl: string;
}

export interface WorkspaceCapabilities {
  platformAdministration: boolean;
  /** HUB-IMPL-021: show Ringkasan Yayasan (effective Organ Yayasan membership). */
  governanceView?: boolean;
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
  /** HUB-IMPL-021 §2: path on the canonical origin; null when the app publishes no governance summary. */
  governanceSummaryPath?: string | null;
  governanceAudience?: string | null;
  governanceOrder?: number;
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

export type Organ = "pembina" | "pengurus" | "pengawas";

export interface OrganMembershipView {
  id: string;
  /** Opaque mutation handle only; never displayed. */
  subject: string;
  displayName: string | null;
  username: string | null;
  email: string | null;
  enabled: boolean | null;
  organ: Organ;
  positionLabel: string | null;
  termStart: string;
  termEnd: string | null;
  status: "active" | "ended";
  reason: string;
  provisioningPath: "existing_staff" | "organ_identity";
  updatedAt: string;
  endedAt: string | null;
}

export interface OrganMembershipOverview {
  active: OrganMembershipView[];
  endingSoon: OrganMembershipView[];
  recentlyEnded: OrganMembershipView[];
  governanceApplications: Array<{ key: string; name: string }>;
  capabilities: { addNewIdentity: boolean; endNewIdentity: boolean };
}

export interface OrganOperationStep {
  step: string;
  target: string;
  status: "succeeded" | "noop" | "failed";
  message: string;
}

export interface OrganOperationResult {
  outcome: "succeeded" | "partial_failure" | "failed";
  membership: OrganMembershipView | null;
  steps: OrganOperationStep[];
  domainRoleReminders: Array<{ key: string; name: string }>;
}

export interface OrganMembershipDetail {
  membership: OrganMembershipView;
  security: { totpConfigured: boolean | null };
  governanceApplications: Array<{
    key: string;
    name: string;
    access: "active" | "revoked" | "none";
    /** Last result Hub observed when this member opened Ringkasan Yayasan (status only, never the summary). */
    summary?: { outcome: "ready" | "forbidden" | "not_found" | "dropped" | "failed"; observedAt: string } | null;
  }>;
}

export interface OrganMembershipEndPreview {
  path: "existing_staff" | "organ_identity";
  membership: OrganMembershipView;
  domainRoleReminders: Array<{ key: string; name: string }>;
  offboarding: null | {
    activeApplications: Array<{ key: string; name: string }>;
    platformAdministrator: boolean;
    globalIdentityEnabled: boolean;
  };
}

// HUB-IMPL-021 §3 governance summary contract v1, as validated and forwarded by the Hub API.
export type GovernanceUnit = "orang" | "unit" | "item" | "persen" | "rupiah" | "hari";

export interface GovernanceTrend {
  points: Array<{ period: string; value: number | null }>;
  change?: { value: number; unit: GovernanceUnit | "poin"; direction: "up" | "down" | "flat"; good?: "up" | "down" };
}

export interface GovernanceMetric {
  key: string;
  label: string;
  value: number | null;
  unit?: GovernanceUnit;
  tone?: "normal" | "attention";
  headline?: boolean;
  trend?: GovernanceTrend;
}

interface GovernanceChartBase {
  key: string;
  title: string;
  unit: GovernanceUnit;
  dataAsOf: string;
}

export type GovernanceChart = GovernanceChartBase & (
  | { kind: "trend"; periods: string[]; series: Array<{ key: string; label: string; mark: "line" | "bar"; values: Array<number | null> }> }
  | { kind: "ranking"; items: Array<{ label: string; value: number }> }
  | { kind: "composition"; parts: Array<{ key: string; label: string }>; items: Array<{ label: string; values: number[] }> }
  | { kind: "stages"; items: Array<{ label: string; value: number }> }
  | { kind: "target"; items: Array<{ label: string; target: number; actual: number }> }
);

export interface GovernanceSummary {
  contractVersion: 1;
  applicationKey: string;
  title: string;
  dataAsOf: string;
  metrics: GovernanceMetric[];
  charts?: GovernanceChart[];
  attention?: Array<{ label: string; count: number; href: string }>;
  detailUrl: string;
}

export type GovernanceCard =
  | { applicationKey: string; state: "ready"; summary: GovernanceSummary }
  | { applicationKey: string; state: "failed"; name: string };

export interface GovernanceSnapshot {
  membership: { organ: Organ; positionLabel?: string };
  cards: GovernanceCard[];
  generatedAt: string;
}
