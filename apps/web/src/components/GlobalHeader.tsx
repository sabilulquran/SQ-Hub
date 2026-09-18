import { AccountMenu } from "@/components/AccountMenu";
import { AppLauncher } from "@/components/AppLauncher";
import { BrandLockup } from "@/components/BrandLockup";
import type { WorkspaceSnapshot } from "@/types";

export type HeaderPreviewMode = "launcher" | "account-menu" | undefined;

interface GlobalHeaderProps {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  previewMode?: HeaderPreviewMode;
}

export function GlobalHeader({ workspace, onLogout, previewMode }: GlobalHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:px-5 lg:px-8">
        <a
          href="/"
          aria-label="Beranda SQ Hub"
          className="min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandLockup compact />
        </a>

        <div className="flex items-center gap-1">
          <AppLauncher
            applications={workspace.applications}
            platformAdministration={workspace.capabilities.platformAdministration}
            previewOpen={previewMode === "launcher"}
          />
          <AccountMenu
            user={workspace.user}
            platformAdministration={workspace.capabilities.platformAdministration}
            onLogout={onLogout}
            previewOpen={previewMode === "account-menu"}
          />
        </div>
      </div>
    </header>
  );
}
