import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AdminCenterPage } from "@/AdminCenterPage";
import { WorkspaceApp } from "@/WorkspaceApp";
import { WorkspaceShell } from "@/WorkspaceShell";
import { workspaceFixture } from "@/dev/workspaceFixture";
import "@/styles.css";

const previewEnabled = import.meta.env.DEV || import.meta.env.VITE_SQ_HUB_PREVIEW === "1";
const previewAdmin = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
const previewApplications = [
  {
    key: "hcis",
    name: "HCIS",
    canonicalUrl: "https://hcis-staging.sabilulquran.or.id",
    status: "active" as const,
  },
];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {previewEnabled ? (
      previewAdmin ? (
        <AdminCenterPage workspace={workspaceFixture} previewApplications={previewApplications} />
      ) : (
        <WorkspaceShell workspace={workspaceFixture} preview />
      )
    ) : (
      <WorkspaceApp />
    )}
  </StrictMode>,
);
