import { AdminCenterPage as ExistingAdminCenterPage } from "@/AdminCenterPageView";
import { StaffLifecyclePage } from "@/StaffLifecyclePage";
import type { AdminApplication, WorkspaceSnapshot } from "@/types";

interface AdminCenterPageProps {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  previewApplications?: AdminApplication[];
  onAuthorizationDenied?: (reason: "forbidden" | "reauth") => void;
}

export function AdminCenterPage(props: AdminCenterPageProps) {
  if (window.location.pathname === "/admin/lifecycle") {
    return (
      <StaffLifecyclePage
        workspace={props.workspace}
        {...(props.onLogout ? { onLogout: props.onLogout } : {})}
        {...(props.onAuthorizationDenied ? { onAuthorizationDenied: props.onAuthorizationDenied } : {})}
      />
    );
  }

  return (
    <ExistingAdminCenterPage {...props} />
  );
}
