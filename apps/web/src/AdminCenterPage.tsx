import { AdminCenterPage as ExistingAdminCenterPage } from "@/AdminCenterPageView";
import { StaffLifecyclePage } from "@/StaffLifecyclePage";
import { OrganizationalUnitsPage } from "@/OrganizationalUnitsPage";
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

  if (window.location.pathname === "/admin/organization") {
    return (
      <OrganizationalUnitsPage
        workspace={props.workspace}
        {...(props.onLogout ? { onLogout: props.onLogout } : {})}
        {...(props.onAuthorizationDenied ? { onAuthorizationDenied: props.onAuthorizationDenied } : {})}
      />
    );
  }

  return (
    <>
      <ExistingAdminCenterPage {...props} />
      <nav className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2" aria-label="Proposal Admin Center">
        <a
          href="/admin/lifecycle"
          className="rounded-xl border border-brand-primary/15 bg-white px-3.5 py-2.5 text-xs font-bold text-brand-primary-deep shadow-[var(--shadow-raised)] transition hover:bg-brand-primary-pale"
        >
          Lifecycle Staff · Go 5C proposal
        </a>
        <a
          href="/admin/organization"
          className="rounded-xl border border-brand-primary/15 bg-white px-3.5 py-2.5 text-xs font-bold text-brand-primary-deep shadow-[var(--shadow-raised)] transition hover:bg-brand-primary-pale"
        >
          Organization Master · proposal
        </a>
      </nav>
    </>
  );
}
