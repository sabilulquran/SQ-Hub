import { AppWindow, Grid2X2, Home, ShieldEllipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WorkspaceApplication } from "@/types";

interface AppLauncherProps {
  applications: WorkspaceApplication[];
  platformAdministration: boolean;
  previewOpen?: boolean;
}

export function AppLauncher({
  applications,
  platformAdministration,
  previewOpen = false,
}: AppLauncherProps) {
  const [open, setOpen] = useState(previewOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

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
        <Grid2X2 className="h-5 w-5" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Peluncur aplikasi SQ"
          className="fixed inset-x-3 top-[4.5rem] z-50 max-h-[min(70dvh,34rem)] overflow-y-auto rounded-2xl border border-border/80 bg-white p-3 shadow-[var(--shadow-raised)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[24rem]"
        >
          <div className="grid grid-cols-2 gap-2">
            <LauncherLink href="/" icon={Home} label="Beranda" />
            <LauncherLink href="/apps" icon={AppWindow} label="Semua aplikasi" />
            {platformAdministration ? (
              <LauncherLink href="/admin" icon={ShieldEllipsis} label="Administrasi SQ" />
            ) : null}
          </div>

          <div className="my-3 h-px bg-border/70" aria-hidden="true" />
          <p className="px-1 text-xs font-semibold text-muted-foreground">Aplikasi Anda</p>

          {applications.length > 0 ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {applications.map((application) => (
                <a
                  key={application.key}
                  href={application.canonicalUrl}
                  className="group flex min-h-24 flex-col rounded-xl border border-transparent p-3 transition hover:border-border hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
                    <AppWindow className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="mt-2 line-clamp-2 text-sm font-bold text-foreground">
                    {application.name}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-xl bg-muted/55 px-3 py-4 text-sm leading-5 text-muted-foreground">
              Belum ada aplikasi yang tersedia untuk akun ini.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function LauncherLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Home;
  label: string;
}) {
  return (
    <a
      href={href}
      className="flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-4 w-4 text-brand-primary-deep" aria-hidden="true" />
      {label}
    </a>
  );
}
