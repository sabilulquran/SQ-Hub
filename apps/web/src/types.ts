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

export interface AdminOverview {
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

export interface AdminContext {
  authorized: true;
  displayName: string;
  capabilities: {
    platformAdministration: true;
  };
  overview: AdminOverview;
}

export type AdminAccessState =
  | { status: "authorized"; context: AdminContext }
  | { status: "forbidden" }
  | { status: "reauth_required" };
