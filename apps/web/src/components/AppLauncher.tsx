import { Landmark } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import ysqMark from "@/assets/brand/ysq-mark.png";
import { applicationAppearance } from "@/components/applicationAppearance";
import { useDismiss } from "@/components/useDismiss";
import type { WorkspaceApplication } from "@/types";

/** App switcher glyph: a 3×3 grid of filled dots, the familiar "apps" launcher shape. */
function AppsDotsIcon({ className }: { className?: string }) {
  const centres = [5, 12, 19];
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      {centres.flatMap((cy) => centres.map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2.2} />))}
    </svg>
  );
}

/** SQ Hub's public address, for the launcher in apps on other hosts (HUB-IMPL-022). */
export const HUB_PUBLIC_URL = "https://hub.sabilulquran.or.id";

interface AppLauncherProps {
  applications: WorkspaceApplication[];
  /** HUB-IMPL-021 §5: members see Ringkasan Yayasan first, then Beranda and apps. */
  governanceView?: boolean;
  previewOpen?: boolean;
  /**
   * HUB-IMPL-022: the app this launcher sits in, when it is not SQ Hub. Its tile is marked
   * "Di sini" and is shown even when the list is empty or does not contain it.
   */
  current?: WorkspaceApplication;
}

/**
 * Same launcher in every SQ Core app: SQ Hub first, then the user's apps
 * (docs/design/sq-core-app-shell.md, item 4). Without `current`, SQ Hub is the current app.
 */
export function AppLauncher({ applications, governanceView = false, previewOpen = false, current }: AppLauncherProps) {
  const hubIsCurrent = !current;
  const hubHref = hubIsCurrent ? "/" : HUB_PUBLIC_URL;
  const allAppsHref = hubIsCurrent ? "/apps" : `${HUB_PUBLIC_URL}/apps`;
  const tiles = current && !applications.some((application) => application.key === current.key)
    ? [current, ...applications]
    : applications;
  const [open, setOpen] = useState(previewOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef, triggerRef);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Buka peluncur aplikasi"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <AppsDotsIcon className="h-5 w-5" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Peluncur aplikasi SQ"
          className="fixed inset-x-3 top-16 z-50 max-h-[min(70dvh,34rem)] overflow-y-auto rounded-2xl border border-border/80 bg-surface-raised p-3 shadow-[var(--shadow-raised)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[22rem]"
        >
          {governanceView ? (
            <a
              href="/yayasan"
              className="mb-1.5 flex min-h-14 items-center gap-3 rounded-xl p-2.5 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
                <Landmark className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-bold text-foreground">Ringkasan Yayasan</span>
                <span className="truncate text-xs text-muted-foreground">Ringkasan semua aplikasi untuk Organ Yayasan</span>
              </span>
            </a>
          ) : null}
          <a
            href={hubHref}
            aria-current={hubIsCurrent ? "page" : undefined}
            className={`flex min-h-14 items-center gap-3 rounded-xl p-2.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hubIsCurrent ? "bg-brand-primary-pale/70 hover:bg-brand-primary-pale" : "hover:bg-muted"}`}
          >
            <img src={ysqMark} alt="" className="h-10 w-10 shrink-0 object-contain" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-bold text-foreground">SQ Hub</span>
              <span className="truncate text-xs text-muted-foreground">Beranda semua aplikasi Anda</span>
            </span>
            {hubIsCurrent ? <HereBadge /> : null}
          </a>

          <p className="mt-3 px-1 text-xs font-semibold text-muted-foreground">Aplikasi Anda</p>

          {tiles.length > 0 ? (
            <div className="mt-2 grid grid-cols-3 gap-1">
              {tiles.map((application) => {
                const { icon: Icon, tile } = applicationAppearance(application.key);
                const here = application.key === current?.key;
                return (
                  <a
                    key={application.key}
                    href={application.canonicalUrl}
                    aria-current={here ? "page" : undefined}
                    className={`group relative flex min-h-24 flex-col items-center justify-start gap-2 rounded-xl p-2.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${here ? "bg-brand-primary-pale/70 hover:bg-brand-primary-pale" : "hover:bg-muted"}`}
                  >
                    <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tile}`}>
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <span className="line-clamp-2 text-xs font-semibold leading-tight text-foreground">
                      {application.name}
                    </span>
                    {here ? <HereBadge /> : null}
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 rounded-xl bg-muted/55 px-3 py-4 text-sm leading-5 text-muted-foreground">
              Belum ada aplikasi yang tersedia untuk akun ini.
            </p>
          )}

          <div className="mt-2 border-t border-border/70 pt-2">
            <a
              href={allAppsHref}
              className="flex min-h-11 items-center justify-center rounded-xl text-sm font-bold text-brand-primary-deep transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Lihat semua aplikasi
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HereBadge() {
  return (
    <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-bold text-brand-primary-deep">
      Di sini
    </span>
  );
}
