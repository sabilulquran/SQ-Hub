import { LogOut } from "lucide-react";
import { useState, type ReactNode } from "react";

import ysqMark from "@/assets/brand/ysq-mark.png";
import type { OrganRoute } from "@/organ-portal/routes";

const NAV = [
  { key: "ringkasan", label: "Ringkasan", href: "/" },
  { key: "keputusan", label: "Keputusan", href: "/keputusan" },
] as const;

function activeKey(route: OrganRoute): string {
  return route.name === "aplikasi" ? "ringkasan" : route.name;
}

/**
 * The portal frame: the Yayasan mark and name, two plain tabs, the member and sign-out. Quiet on
 * purpose; the figures carry the page.
 */
export function OrganShell({
  route,
  displayName,
  onLogout,
  children,
}: {
  route: OrganRoute;
  displayName?: string | undefined;
  onLogout?: (() => void | Promise<void>) | undefined;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const active = activeKey(route);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-4 px-4 sm:px-8">
          <a href="/" className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Portal Organ Yayasan Sabilul Qur'an">
            <img src={ysqMark} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 object-contain" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-semibold text-brand-heading">Portal Organ Yayasan</span>
              <span className="block truncate text-xs text-muted-foreground">Yayasan Sabilul Qur'an</span>
            </span>
          </a>
          {displayName ? (
            <nav aria-label="Navigasi portal" className="ml-6 hidden h-16 items-stretch gap-6 md:flex">
              {NAV.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  aria-current={active === item.key ? "page" : undefined}
                  className={[
                    "flex items-center border-b-2 text-sm transition-colors",
                    active === item.key ? "border-brand-primary font-medium text-brand-heading" : "border-transparent text-muted-foreground hover:text-brand-heading",
                  ].join(" ")}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          ) : null}
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {displayName ? <span className="hidden max-w-[16rem] truncate text-sm text-muted-foreground lg:inline">{displayName}</span> : null}
            {onLogout ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void Promise.resolve(onLogout()).finally(() => setBusy(false));
                }}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-brand-heading transition-colors hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LogOut className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                Keluar
              </button>
            ) : null}
          </div>
        </div>
        {displayName ? (
          <nav aria-label="Navigasi portal" className="mx-auto flex w-full max-w-[1200px] gap-6 px-4 md:hidden">
            {NAV.map((item) => (
              <a
                key={item.key}
                href={item.href}
                aria-current={active === item.key ? "page" : undefined}
                className={[
                  "flex h-11 items-center border-b-2 text-sm",
                  active === item.key ? "border-brand-primary font-medium text-brand-heading" : "border-transparent text-muted-foreground",
                ].join(" ")}
              >
                {item.label}
              </a>
            ))}
          </nav>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-8 sm:pt-10">{children}</main>
    </div>
  );
}
