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
