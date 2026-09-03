import { ChevronDown, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WorkspaceUser } from "@/types";

interface AccountMenuProps {
  user: WorkspaceUser;
  variant: "header" | "sidebar";
  onLogout?: () => void | Promise<void>;
}

export function AccountMenu({ user, variant, onLogout }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
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
    try { await onLogout(); } finally { setLoggingOut(false); }
  };

  const header = variant === "header";
  return (
    <div ref={rootRef} className={variant === "sidebar" ? "relative w-full" : "relative"}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={header ? `Menu akun ${user.displayName}` : undefined}
        onClick={() => setOpen((value) => !value)}
        className={[
          "group flex items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          header
            ? "gap-2 rounded-2xl border border-border/70 bg-white p-1.5 shadow-[var(--shadow-soft)] sm:pr-3"
            : "w-full gap-3 rounded-3xl border border-border/70 bg-white p-3.5 shadow-[var(--shadow-soft)]",
        ].join(" ")}
      >
        <span className={["flex shrink-0 items-center justify-center bg-brand-primary font-bold text-white shadow-[var(--shadow-button)]", header ? "h-8 w-8 rounded-xl text-xs" : "h-11 w-11 rounded-2xl text-sm"].join(" ")}>{user.initials}</span>
        <span className={header ? "hidden min-w-0 max-w-40 sm:block" : "min-w-0"}>
          <span className={header ? "block truncate text-xs font-bold" : "block truncate text-sm font-bold"}>{user.displayName}</span>
          <span className={header ? "block truncate text-[10px] text-muted-foreground" : "block truncate text-[11px] text-muted-foreground"}>{user.contextLabel ?? "Akun internal SQ"}</span>
        </span>
        <ChevronDown className={["h-4 w-4 shrink-0 text-muted-foreground transition-transform", open ? "rotate-180" : "", header ? "hidden sm:block" : ""].join(" ")} aria-hidden="true" />
      </button>

      {open ? (
        <div role="menu" aria-label="Menu akun" className={["absolute z-50 w-[min(18.5rem,calc(100vw-2rem))] rounded-2xl border border-border/80 bg-white p-2 shadow-[var(--shadow-raised)]", header ? "right-0 top-full mt-2" : "bottom-full left-0 mb-2"].join(" ")}>
          <div className="px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-bold text-foreground">{user.displayName}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.contextLabel ?? "Akun internal SQ"}</p>
          </div>
          <div className="my-1 h-px bg-border/70" aria-hidden="true" />
          <div role="menuitem" aria-disabled="true" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground">
            <UserRound className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block font-semibold text-foreground/70">Akun Saya</span><span className="block text-[11px] leading-4">Akun SQ</span></span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Segera</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground" aria-hidden="true">
            <ShieldCheck className="h-[18px] w-[18px] shrink-0" />
            <span className="text-[11px] leading-4">Keamanan akun dikelola oleh Akun SQ</span>
          </div>
          <button type="button" role="menuitem" disabled={!onLogout || loggingOut} onClick={() => void handleLogout()} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-destructive transition-colors hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45">
            <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {loggingOut ? "Keluar..." : "Keluar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
