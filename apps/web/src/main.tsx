import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WorkspaceApp } from "@/WorkspaceApp";
import { WorkspaceShell } from "@/WorkspaceShell";
import { workspaceFixture } from "@/dev/workspaceFixture";
import "@/styles.css";

const previewEnabled = import.meta.env.DEV || import.meta.env.VITE_SQ_HUB_PREVIEW === "1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {previewEnabled ? <WorkspaceShell workspace={workspaceFixture} preview /> : <WorkspaceApp />}
  </StrictMode>,
);
