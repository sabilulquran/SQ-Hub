import { Activity, AlertTriangle, Ban, ListOrdered, LoaderCircle, LogOut, ShieldAlert, Smartphone } from "lucide-react";
import { useState, type ReactNode } from "react";

import { BrandLockup } from "@/components/BrandLockup";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { KirimRoute } from "@/kirim/routes";


const navItems: Array<{ key: Exclude<KirimRoute, "not-found" | "impor">; label: string; href: string; icon: typeof Smartphone }> = [
  { key: "nomor", label: "Nomor", href: "/nomor", icon: Smartphone },
  { key: "antrean", label: "Antrean", href: "/antrean", icon: ListOrdered },
  { key: "jangan-hubungi", label: "Jangan hubungi", href: "/jangan-hubungi", icon: Ban },
  { key: "aktivitas", label: "Aktivitas", href: "/aktivitas", icon: Activity },
];

/**
 * SQ Core shell for Kirim SQ (KIRIM-IMPL-001 §8): "Kirim SQ" lockup, two sections, the same
 * design tokens and light/dark theme as Hub. Tabs stay in one row at 390 px.
 */
export function KirimShell({
  active,
  displayName,
  onLogout,
  children,
}: {
  active: KirimRoute;
  displayName?: string;
  onLogout?: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-surface-raised">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:h-16 sm:px-6 lg:px-8">
          <a href="/" aria-label="Beranda Kirim SQ" className="min-w-0 shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandLockup compact appName="Kirim SQ" />
          </a>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            {displayName ? <span className="hidden max-w-[12rem] truncate text-sm font-semibold text-muted-foreground md:inline">{displayName}</span> : null}
            {onLogout ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void Promise.resolve(onLogout()).finally(() => setBusy(false));
                }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-bold text-brand-primary-deep disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Keluar
              </button>
            ) : null}
          </div>
        </div>
        <nav aria-label="Navigasi Kirim SQ" className="mx-auto flex w-full max-w-6xl gap-1 px-4 pb-2 sm:px-6 lg:px-8">
          {navItems.map((item) => {
            const Icon = item.icon;
            // Impor riwayat is opened from a number's card, so Nomor stays highlighted.
            const current = item.key === active || (item.key === "nomor" && active === "impor");
            return (
              <a
                key={item.key}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={[
                  "inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-1.5 text-center text-xs leading-tight sm:flex-none sm:gap-2 sm:px-3 sm:text-sm",
                  current ? "bg-brand-primary-pale font-bold text-brand-primary-deep" : "font-semibold text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
                {item.label}
              </a>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border/70 bg-surface-raised p-4 shadow-[var(--shadow-soft)] sm:p-5 ${className}`}>{children}</section>;
}

export function Field({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-brand-heading">{label}</span>
      {children}
      {helper ? <span className="sq-admin-helper block">{helper}</span> : null}
    </label>
  );
}

export const primaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-brand-foreground shadow-[var(--shadow-button)] disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButton = "inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm font-bold text-brand-primary-deep disabled:cursor-not-allowed disabled:opacity-50";
export const dangerButton = "inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-danger-soft px-3 py-2 text-sm font-bold text-destructive disabled:cursor-not-allowed disabled:opacity-50";

/** Loading, empty, error and forbidden states share one card (§8: every screen checks them). */
export function StateCard({ kind, title, body, action }: { kind: "loading" | "empty" | "error" | "forbidden"; title: string; body?: string; action?: ReactNode }) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "forbidden" ? ShieldAlert : AlertTriangle;
  return (
    <Panel className="text-center" >
      <div className={`mx-auto flex h-11 w-11 items-center justify-center rounded-xl ${kind === "error" || kind === "forbidden" ? "bg-warning-soft text-warning-ink" : "bg-brand-primary-pale text-brand-primary-deep"}`}>
        <Icon className={`h-5 w-5 ${kind === "loading" ? "animate-spin" : ""}`} aria-hidden="true" />
      </div>
      <h2 className="mt-3 font-display text-lg font-bold text-brand-heading" data-state={kind}>{title}</h2>
      {body ? <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </Panel>
  );
}

/** Confirmation with a reason, for disconnect, pause/resume, deactivate, provider change and cancel (§8). */
export function ReasonDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  busy,
  error,
  reasonRequired = true,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  error: string | null;
  reasonRequired?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface-raised p-5 shadow-[var(--shadow-raised)] sm:rounded-2xl">
        <h2 className="font-display text-lg font-bold text-brand-heading">{title}</h2>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
        {children}
        <div className="mt-4">
          <Field label={reasonRequired ? "Alasan" : "Alasan (opsional)"}>
            <textarea className="sq-admin-input" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </div>
        {error ? <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">{error}</p> : null}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Batal</button>
          <button
            type="button"
            className={danger ? dangerButton : primaryButton}
            disabled={busy || (reasonRequired && !reason.trim())}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
