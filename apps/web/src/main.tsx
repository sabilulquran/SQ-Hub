import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WorkspaceApp } from "@/WorkspaceApp";
import { WorkspaceShell } from "@/WorkspaceShell";
import { workspaceFixture } from "@/dev/workspaceFixture";
import type { AdminAccessState } from "@/types";
import "@/styles.css";

const previewEnabled = import.meta.env.DEV || import.meta.env.VITE_SQ_HUB_PREVIEW === "1";
const previewAdmin = previewEnabled && window.location.pathname.startsWith("/admin");
const previewAdminState: AdminAccessState = {
  status: "authorized",
  context: {
    authorized: true,
    displayName: workspaceFixture.user.displayName,
    capabilities: { platformAdministration: true },
    overview: {
      applications: { total: 3, active: 2, inactive: 1 },
      applicationAccess: { total: 12, active: 10, revoked: 2 },
      auditEventsLast24Hours: 7,
    },
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {previewEnabled ? (
      <WorkspaceShell
        workspace={workspaceFixture}
        preview
        view={previewAdmin ? "admin" : "workspace"}
        adminState={previewAdmin ? previewAdminState : undefined}
      />
    ) : (
      <WorkspaceApp />
    )}
  </StrictMode>,
);
