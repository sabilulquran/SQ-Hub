import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AccountTransitionPage } from "@/AccountTransitionPage";
import { AdminCenterPage } from "@/AdminCenterPage";
import { NotFoundPage, WorkspaceApp } from "@/WorkspaceApp";
import { WorkspaceShell } from "@/WorkspaceShell";
import {
  emptyWorkspaceFixture,
  ordinaryWorkspaceFixture,
  workspaceFixture,
} from "@/dev/workspaceFixture";
import { resolveHubRoute } from "@/routes";
import "@/styles.css";

const previewEnabled = import.meta.env.DEV || import.meta.env.VITE_SQ_HUB_PREVIEW === "1";
const route = resolveHubRoute(window.location.pathname);
const params = new URLSearchParams(window.location.search);
const previewMode =
  params.get("preview") === "launcher"
    ? "launcher"
    : params.get("preview") === "account-menu"
      ? "account-menu"
      : undefined;
if (previewEnabled) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.body.dataset.previewHorizontalOverflow = String(
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
    });
  });

  if (params.get("exercise") === "escape") {
    window.setTimeout(() => {
      const selector =
        previewMode === "launcher"
          ? '[aria-label="Buka peluncur aplikasi"]'
          : previewMode === "account-menu"
            ? '[aria-label^="Menu akun "]'
            : null;
      const trigger = selector ? document.querySelector<HTMLButtonElement>(selector) : null;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      window.requestAnimationFrame(() => {
        document.body.dataset.previewEscapeRestored = String(
          Boolean(trigger) &&
            trigger?.getAttribute("aria-expanded") === "false" &&
            document.activeElement === trigger,
        );
      });
    }, 120);
  }
}

const fixture =
  params.get("state") === "empty"
    ? emptyWorkspaceFixture
    : params.get("state") === "ordinary"
      ? ordinaryWorkspaceFixture
      : workspaceFixture;

const previewApplications = [
  {
    key: "hcis",
    name: "HCIS",
    canonicalUrl: "https://hcis.example",
    status: "active" as const,
  },
];

function renderPreviewApp() {
  if (route === "admin") {
    return <AdminCenterPage workspace={fixture} previewApplications={previewApplications} />;
  }
  if (route === "account") {
    return <AccountTransitionPage workspace={fixture} preview />;
  }
  if (route === "home" || route === "apps") {
    return (
      <WorkspaceShell
        workspace={fixture}
        route={route}
        previewMode={previewMode}
      />
    );
  }
  return <NotFoundPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{previewEnabled ? renderPreviewApp() : <WorkspaceApp />}</StrictMode>,
);
