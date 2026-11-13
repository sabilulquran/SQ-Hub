import { BookText, Inbox, LogOut, Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AppLauncher } from "@/components/AppLauncher";
import { BrandLockup } from "@/components/BrandLockup";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { SekretariatRoute } from "@/sekretariat/routes";
import { Link } from "@/sekretariat/ui";
import type { WorkspaceApplication } from "@/types";

/** Sekretariat's own launcher tile when SQ Hub's list is unavailable (HUB-IMPL-022). */
const SEKRETARIAT_LAUNCHER_APPLICATION: WorkspaceApplication = { key: "sekretariat-sq", name: "Sekretariat", canonicalUrl: "/" };

type NavKey = "ringkasan" | "buku" | "pengaturan";

function navKey(route: SekretariatRoute): NavKey | null {
  if (route.name === "buku") return "buku";
  if (route.name === "pengaturan") return "pengaturan";
  if (route.name === "not-found") return null;
  return "ringkasan";
}

/**
 * SQ Core shell for Sekretariat (SEK-IMPL-001 §9): "Sekretariat" lockup — the full name, never
 * the abbreviation — with the same tokens and themes as Hub. Tabs stay in one row at 390 px.
 */
export function SekretariatShell({
  route,
  displayName,
  pengelola = false,
  launcherApplications,
  onLogout,
  children,
}: {
  route: SekretariatRoute;
  displayName?: string;
  pengelola?: boolean;
  launcherApplications?: WorkspaceApplication[] | null;
  onLogout?: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const active = navKey(route);
  const items: Array<{ key: NavKey; label: string; href: string; icon: typeof Inbox }> = [
    { key: "ringkasan", label: "Ringkasan", href: "/", icon: Inbox },
    { key: "buku", label: "Buku nomor", href: "/buku", icon: BookText },
    ...(pengelola ? [{ key: "pengaturan" as const, label: "Pengaturan", href: "/pengaturan", icon: Settings2 }] : []),
  ];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-surface-raised">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 md:h-16 sm:px-6 lg:px-8">
          <Link href="/" className="min-w-0 shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span aria-label="Beranda Sekretariat"><BrandLockup compact appName="Sekretariat" /></span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <AppLauncher
              applications={launcherApplications ?? []}
              current={launcherApplications?.find((application) => application.key === SEKRETARIAT_LAUNCHER_APPLICATION.key) ?? SEKRETARIAT_LAUNCHER_APPLICATION}
            />
            {displayName ? <span className="hidden max-w-[12rem] truncate text-sm font-semibold text-muted-foreground md:inline">{displayName}</span> : null}
            {onLogout ? (
              <button
                type="button"
                disabled={busy}
                aria-label="Keluar"
                onClick={() => {
                  setBusy(true);
                  void Promise.resolve(onLogout()).finally(() => setBusy(false));
                }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-bold text-brand-primary-deep disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Keluar</span>
              </button>
            ) : null}
          </div>
        </div>
        <nav aria-label="Navigasi Sekretariat" className="mx-auto flex w-full max-w-7xl gap-1 px-4 pb-2 sm:px-6 lg:px-8">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                ariaCurrent={item.key === active}
                className={[
                  "inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-center text-sm leading-tight sm:flex-none sm:px-3",
                  item.key === active ? "bg-brand-primary-pale font-bold text-brand-primary-deep" : "font-semibold text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
