import type { ReactNode } from "react";

import { AccountMenu } from "@/components/AccountMenu";
import { AppLauncher } from "@/components/AppLauncher";
import { BrandLockup } from "@/components/BrandLockup";
import { MobileNavigation } from "@/components/MobileNavigation";
import { navigationBySpace, type HubNavKey } from "@/components/shellNavigation";
import { SpaceSwitcher, type HubSpace } from "@/components/SpaceSwitcher";
import type { WorkspaceSnapshot } from "@/types";

export type ShellPreviewMode = "launcher" | "account-menu" | "more" | undefined;

interface AppShellProps {
  workspace: WorkspaceSnapshot;
  space: HubSpace;
  active: HubNavKey;
  /** Breadcrumb trail; admin pages start with "Administrasi". */
  breadcrumb?: string[];
  onLogout?: () => void | Promise<void>;
  previewMode?: ShellPreviewMode;
  children: ReactNode;
}

/**
 * SQ Core app shell (docs/design/sq-core-app-shell.md): header with logo, Pindah ruang,
 * launcher and account menu; a navigation-only sidebar (icon rail at 768–1023 px);
 * bottom navigation on phones.
 */
export function AppShell({
  workspace,
  space,
  active,
  breadcrumb,
  onLogout,
  previewMode,
  children,
}: AppShellProps) {
  const platformAdministration = workspace.capabilities.platformAdministration;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-surface-raised">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4 md:h-16 lg:px-5">
          <a
            href={space === "admin" ? "/admin" : "/"}
            aria-label={space === "admin" ? "Beranda Administrasi SQ Hub" : "Beranda SQ Hub"}
            className="min-w-0 shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-[13.5rem]"
          >
            <BrandLockup compact />
          </a>
          {platformAdministration ? <SpaceSwitcher space={space} className="hidden md:flex" /> : null}

          <div className="ml-auto flex items-center gap-1">
            <AppLauncher applications={workspace.applications} previewOpen={previewMode === "launcher"} />
            <AccountMenu
              user={workspace.user}
              platformAdministration={platformAdministration}
              onLogout={onLogout}
              previewOpen={previewMode === "account-menu"}
            />
          </div>
        </div>
      </header>

      <Sidebar space={space} active={active} />

      <div className="md:pl-14 lg:pl-[248px]">
        <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 sm:px-6 sm:pt-8 md:pb-12 lg:px-8">
          {breadcrumb && breadcrumb.length > 0 ? (
            <nav aria-label="Breadcrumb" className="mb-3">
              <ol className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                {breadcrumb.map((crumb, index) => (
                  <li key={`${crumb}-${index}`} className="flex items-center gap-1.5">
                    {index > 0 ? <span aria-hidden="true">/</span> : null}
                    <span aria-current={index === breadcrumb.length - 1 ? "page" : undefined}>{crumb}</span>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          {children}
        </main>
      </div>

      <MobileNavigation
        space={space}
        active={active}
        platformAdministration={platformAdministration}
        previewMoreOpen={previewMode === "more"}
      />
    </div>
  );
}

function Sidebar({ space, active }: { space: HubSpace; active: HubNavKey }) {
  return (
    <aside className="fixed bottom-0 left-0 top-16 z-30 hidden w-14 overflow-y-auto border-r border-border bg-sidebar px-2 py-4 md:block lg:w-[248px] lg:px-3">
      <nav aria-label={space === "admin" ? "Navigasi Administrasi" : "Navigasi SQ Hub"}>
        {navigationBySpace[space].map((group) => (
          <div key={group.label} className="mb-5">
            <p className="mb-1.5 hidden px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground lg:block">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const current = item.key === active;
                return (
                  <li key={item.key}>
                    <a
                      href={item.href}
                      title={item.label}
                      aria-current={current ? "page" : undefined}
                      className={[
                        "flex min-h-10 items-center justify-center gap-3 rounded-xl px-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:justify-start lg:px-3",
                        current
                          ? "bg-brand-primary-pale font-bold text-brand-primary-deep"
                          : "font-semibold text-muted-foreground hover:bg-muted hover:text-foreground",
                      ].join(" ")}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                      <span className="sr-only lg:not-sr-only lg:truncate">{item.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
