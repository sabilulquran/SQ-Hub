import { AdminCenterPage as ExistingAdminCenterPage } from "@/AdminCenterPageView";
import { OrganMembershipPage } from "@/OrganMembershipPage";
import { StaffLifecyclePage } from "@/StaffLifecyclePage";
import type { AdminApplication, OrganMembershipOverview, WorkspaceSnapshot } from "@/types";

interface AdminCenterPageProps {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  previewApplications?: AdminApplication[];
  onAuthorizationDenied?: (reason: "forbidden" | "reauth") => void;
  previewOrganOverview?: OrganMembershipOverview;
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

  if (window.location.pathname.replace(/\/+$/, "") === "/admin/organ") {
    return (
      <OrganMembershipPage
        workspace={props.workspace}
        {...(props.onLogout ? { onLogout: props.onLogout } : {})}
        {...(props.onAuthorizationDenied ? { onAuthorizationDenied: props.onAuthorizationDenied } : {})}
        {...(props.previewOrganOverview ? { previewOverview: props.previewOrganOverview } : {})}
      />
    );
  }

  return (
    <ExistingAdminCenterPage {...props} />
  );
}
