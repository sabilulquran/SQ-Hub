import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { useDismiss } from "@/components/useDismiss";
import { organBadge } from "@/organ";
import type { WorkspaceUser } from "@/types";

interface AccountMenuProps {
  user: WorkspaceUser;
  platformAdministration?: boolean;
  onLogout?: () => void | Promise<void>;
  previewOpen?: boolean;
}

/**
 * The only place for account, role and sign-out (docs/design/sq-core-app-shell.md, item 5).
 * Opens as a dropdown from 768 px and as a bottom sheet on phones.
 */
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
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef, triggerRef);

  // A member of an Organ Yayasan may not be staff, so the organ replaces the default role label.
  const roleLabel = platformAdministration
    ? "Platform Administrator"
    : user.organ
      ? organBadge(user.organ)
      : "Pegawai";

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
        className="group flex min-h-11 items-center gap-2.5 rounded-full p-1 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:pr-2"
      >
        <Avatar initials={user.initials} />
        <span className="hidden min-w-0 flex-col md:flex">
          <span className="max-w-40 truncate text-xs font-bold leading-tight text-foreground">{user.displayName}</span>
          <span className="max-w-40 truncate text-[11px] leading-tight text-muted-foreground">{roleLabel}</span>
        </span>
        <ChevronDown
          className={["hidden h-4 w-4 text-muted-foreground transition-transform md:block", open ? "rotate-180" : ""].join(" ")}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={close}
            className="fixed inset-0 z-50 cursor-default bg-black/35 md:hidden"
          />
          <div
            role="menu"
            aria-label="Menu akun"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border border-border/80 bg-surface-raised p-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-raised)] md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-[calc(100%+0.5rem)] md:w-[19rem] md:rounded-2xl md:pb-2"
          >
            <span className="mx-auto mb-1 mt-1 block h-1 w-10 rounded-full bg-border md:hidden" aria-hidden="true" />
            <div className="flex items-center gap-3 px-3 pb-3 pt-2">
              <Avatar initials={user.initials} large />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{user.displayName}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {user.contextLabel ?? "Akun internal SQ"}
                </p>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  <span className="inline-flex rounded-full bg-brand-primary-pale px-2 py-0.5 text-[10px] font-bold text-brand-primary-deep">
                    {roleLabel}
                  </span>
                  {user.organ && platformAdministration ? (
                    <span className="inline-flex rounded-full bg-cat-pay-soft px-2 py-0.5 text-[10px] font-bold text-cat-pay">
                      {organBadge(user.organ)}
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
            <div className="my-1 h-px bg-border/70" aria-hidden="true" />
            <a
              href="/account"
              role="menuitem"
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserRound className="h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                Akun SQ
                <span className="text-xs font-normal text-muted-foreground">Profil, keamanan, dan sesi</span>
              </span>
            </a>
            <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5">
              <span className="text-sm font-semibold text-foreground">Tampilan</span>
              <ThemeToggle />
            </div>
            <div className="my-1 h-px bg-border/70" aria-hidden="true" />
            <button
              type="button"
              role="menuitem"
              disabled={!onLogout || loggingOut}
              onClick={() => void handleLogout()}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-destructive transition hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
            >
              <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
              {loggingOut ? "Keluar..." : "Keluar"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Avatar({ initials, large = false }: { initials: string; large?: boolean }) {
  return (
    <span
      className={[
        "flex shrink-0 items-center justify-center rounded-full bg-brand-primary font-bold text-brand-foreground shadow-[var(--shadow-button)]",
        large ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs",
      ].join(" ")}
    >
      {initials}
    </span>
  );
}
