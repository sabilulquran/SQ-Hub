import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AccountPage } from "@/AccountPage";
import { AdminCenterPage } from "@/AdminCenterPage";
import { NotFoundPage, WorkspaceApp } from "@/WorkspaceApp";
import { WorkspaceShell } from "@/WorkspaceShell";
import {
  accountFixture,
  emptyWorkspaceFixture,
  ordinaryWorkspaceFixture,
  workspaceFixture,
} from "@/dev/workspaceFixture";
import { emptyGovernanceFixture, governanceFixture, governanceWorkspaceFixture } from "@/dev/governanceFixture";
import { organOverviewFixture } from "@/dev/organFixture";
import { GovernancePageView } from "@/governance/GovernancePage";
import { kirimAntreanFixture, kirimNomorFixture } from "@/dev/kirimFixture";
import { KirimApp, KirimAppView } from "@/kirim/KirimApp";
import { isKirimHost, resolveKirimRoute } from "@/kirim/routes";
import { resolveHubRoute } from "@/routes";
import { initThemePreference } from "@/theme";
import "@/styles.css";

initThemePreference();

const previewEnabled = import.meta.env.DEV || import.meta.env.VITE_SQ_HUB_PREVIEW === "1";
const route = resolveHubRoute(window.location.pathname);
const params = new URLSearchParams(window.location.search);
const previewMode =
  params.get("preview") === "launcher"
    ? "launcher"
    : params.get("preview") === "account-menu"
      ? "account-menu"
      : params.get("preview") === "more"
        ? "more"
        : undefined;
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

function renderKirimPreview() {
  const state = params.get("state");
  const route = resolveKirimRoute(window.location.pathname.replace(/^\/kirim/, "") || "/");
  if (state === "forbidden") return <KirimAppView state={{ status: "forbidden", code: "kirim_admin_required" }} route={route} />;
  const pageState = state === "loading" ? { status: "loading" as const } : state === "error" ? { status: "error" as const } : null;
  const nomor = pageState ?? (state === "empty" ? { ...kirimNomorFixture, list: { devices: [], peringatan: { terputus: [], webhook_habis: 0 } } } as typeof kirimNomorFixture : kirimNomorFixture);
  const antrean = pageState ?? (state === "empty" && kirimAntreanFixture.status === "ready" ? { ...kirimAntreanFixture, queue: { ...kirimAntreanFixture.queue, items: [] } } : kirimAntreanFixture);
  return (
    <KirimAppView
      state={{ status: "ready", context: { displayName: "Kepala HCM (pratinjau)" } }}
      route={route}
      onLogout={() => undefined}
      preview={{ nomor, antrean }}
    />
  );
}

function renderPreviewApp() {
  if (window.location.pathname === "/kirim" || window.location.pathname.startsWith("/kirim/")) return renderKirimPreview();
  if (route === "admin") {
    return <AdminCenterPage workspace={fixture} previewApplications={previewApplications} previewOrganOverview={organOverviewFixture} />;
  }
  if (route === "account") {
    return <AccountPage workspace={fixture} previewAccount={accountFixture} />;
  }
  if (route === "yayasan") {
    const state = params.get("state");
    return (
      <GovernancePageView
        workspace={governanceWorkspaceFixture}
        previewMode={previewMode}
        state={
          state === "loading"
            ? { status: "loading" }
            : state === "error"
              ? { status: "error" }
              : { status: "ready", snapshot: state === "empty" ? emptyGovernanceFixture : governanceFixture }
        }
      />
    );
  }
  if (route === "home" || route === "apps") {
    return (
      <WorkspaceShell
        workspace={fixture}
        route={route}
        previewMode={previewMode}
        onLogout={() => undefined}
      />
    );
  }
  return <NotFoundPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isKirimHost(window.location.hostname) ? <KirimApp /> : previewEnabled ? renderPreviewApp() : <WorkspaceApp />}</StrictMode>,
);

if (previewEnabled) {
  window.setTimeout(() => {
    document.body.dataset.previewHorizontalOverflow = String(
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );

    if (params.get("exercise") !== "escape") return;

    const selector =
      previewMode === "launcher"
        ? '[aria-label="Buka peluncur aplikasi"]'
        : previewMode === "account-menu"
          ? '[aria-label^="Menu akun "]'
          : null;
    const trigger = selector ? document.querySelector<HTMLButtonElement>(selector) : null;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    window.setTimeout(() => {
      document.body.dataset.previewEscapeRestored = String(
        Boolean(trigger) &&
          trigger?.getAttribute("aria-expanded") === "false" &&
          document.activeElement === trigger,
      );
    }, 50);
  }, 200);
}
