import { AppWindow, ChevronDown, LogOut, ShieldEllipsis, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WorkspaceUser } from "@/types";

interface AccountMenuProps {
  user: WorkspaceUser;
  platformAdministration?: boolean;
  onLogout?: () => void | Promise<void>;
  previewOpen?: boolean;
}

export function AccountMenu({
  user,
  platformAdministration = false,
  onLogout,
  previewOpen = false,
}: AccountMenuProps) {
  const [open, setOpen] = useState(previewOpen);
  const [loggingOut, setLoggingOut] = useState(false);
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

  const handleLogout = async () => {
    if (!onLogout) return;
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu akun ${user.displayName}`}
        onClick={() => setOpen((value) => !value)}
        className="group flex min-h-11 items-center gap-2 rounded-full p-1 pr-1.5 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:pr-2"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white shadow-[var(--shadow-button)]">
          {user.initials}
        </span>
        <span className="hidden max-w-40 truncate text-xs font-bold text-foreground md:block">
          {user.displayName}
        </span>
        <ChevronDown
          className={["hidden h-4 w-4 text-muted-foreground transition-transform sm:block", open ? "rotate-180" : ""].join(" ")}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Menu akun"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(19rem,calc(100vw-1.5rem))] rounded-2xl border border-border/80 bg-white p-2 shadow-[var(--shadow-raised)]"
        >
          <div className="px-3 pb-2 pt-2">
            <p className="truncate text-sm font-bold text-foreground">{user.displayName}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {user.contextLabel ?? "Akun internal SQ"}
            </p>
          </div>
          <div className="my-1 h-px bg-border/70" aria-hidden="true" />
          <MenuLink href="/account" icon={UserRound} label="Kelola Akun SQ" />
          <MenuLink href="/apps" icon={AppWindow} label="Buka semua aplikasi" />
          {platformAdministration ? (
            <MenuLink href="/admin" icon={ShieldEllipsis} label="Administrasi SQ" />
          ) : null}
          <div className="my-1 h-px bg-border/70" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            disabled={!onLogout || loggingOut}
            onClick={() => void handleLogout()}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-destructive transition hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            {loggingOut ? "Keluar..." : "Keluar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof UserRound;
  label: string;
}) {
  return (
    <a
      href={href}
      role="menuitem"
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />
      {label}
    </a>
  );
}
