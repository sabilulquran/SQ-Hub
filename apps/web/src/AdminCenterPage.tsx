import { AdminCenterPage as ExistingAdminCenterPage } from "@/AdminCenterPageView";
import { HcisRolesPage } from "@/HcisRolesPage";
import { OrganMembershipPage } from "@/OrganMembershipPage";
import { PlatformAdministratorsPage } from "@/PlatformAdministratorsPage";
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

  const path = window.location.pathname.replace(/\/+$/, "");
  const shared = {
    workspace: props.workspace,
    ...(props.onLogout ? { onLogout: props.onLogout } : {}),
    ...(props.onAuthorizationDenied ? { onAuthorizationDenied: props.onAuthorizationDenied } : {}),
  };
  if (path === "/admin/hcis-roles") return <HcisRolesPage {...shared} />;
  if (path === "/admin/platform-administrators") return <PlatformAdministratorsPage {...shared} />;

  if (path === "/admin/organ") {
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
