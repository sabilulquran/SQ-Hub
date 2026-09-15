import { AdminCenterPage as ExistingAdminCenterPage } from "@/AdminCenterPageView";
import { OrganizationalUnitsPage } from "@/OrganizationalUnitsPage";
import type { AdminApplication, WorkspaceSnapshot } from "@/types";

interface Props { workspace: WorkspaceSnapshot; onLogout?: () => void | Promise<void>; previewApplications?: AdminApplication[]; onAuthorizationDenied?: (reason: "forbidden" | "reauth") => void; }

export function AdminCenterPage(props: Props) {
  if (window.location.pathname === "/admin/organization") return <OrganizationalUnitsPage workspace={props.workspace} {...(props.onLogout ? { onLogout: props.onLogout } : {})} {...(props.onAuthorizationDenied ? { onAuthorizationDenied: props.onAuthorizationDenied } : {})} />;
  return <><ExistingAdminCenterPage {...props} /><a href="/admin/organization" className="fixed bottom-5 right-5 z-40 rounded-xl border border-brand-primary/15 bg-white px-3.5 py-2.5 text-xs font-bold text-brand-primary-deep shadow-[var(--shadow-raised)]">Organization Master · proposal</a></>;
}
