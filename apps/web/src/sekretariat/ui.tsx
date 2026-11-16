import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { navigate } from "@/sekretariat/routes";

// Shared SQ Core primitives already used by Kirim SQ and Kerja; reused here rather than copied.
export { dangerButton, Field, Panel, primaryButton, ReasonDialog, secondaryButton, StateCard } from "@/kirim/KirimShell";

/** In-app link: plain `<a>` for middle-click and screen readers, history navigation for clicks. */
export function Link({ href, className, children, ariaCurrent, onNavigate }: { href: string; className?: string; children: ReactNode; ariaCurrent?: boolean; onNavigate?: () => void }) {
  return (
    <a
      href={href}
      className={className}
      aria-current={ariaCurrent ? "page" : undefined}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate?.();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

export type Loaded<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string; code?: string };

/** Loads once per key; `reload` keeps the old data visible while refreshing. */
export function useLoad<T>(load: () => Promise<T>, key: string): { state: Loaded<T>; reload: () => Promise<void> } {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const loadRef = useRef(load);
  loadRef.current = load;
  const latest = useRef(0);
  const run = useCallback(async () => {
    const request = ++latest.current;
    try {
      const data = await loadRef.current();
      if (request === latest.current) setState({ status: "ready", data });
    } catch (error) {
      if (request !== latest.current) return;
      const code = (error as { code?: string }).code;
      setState({ status: "error", message: error instanceof Error ? error.message : "Gagal memuat.", ...(code ? { code } : {}) });
    }
  }, []);
  useEffect(() => {
    setState({ status: "loading" });
    void run();
  }, [key, run]);
  return { state, reload: run };
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">{message}</p>;
}

export function PageHeader({ eyebrow, title, actions, children }: { eyebrow?: ReactNode; title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-semibold text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="font-display text-2xl font-bold text-brand-heading">{title}</h1>
        {children}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone: "biasa" | "baik" | "perhatian" | "bahaya" }) {
  const kelas =
    tone === "baik"
      ? "bg-brand-primary-pale text-brand-primary-deep"
      : tone === "perhatian"
        ? "bg-warning-soft text-warning-ink"
        : tone === "bahaya"
          ? "bg-danger-soft text-danger-ink"
          : "bg-muted text-muted-foreground";
  return <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold ${kelas}`}>{label}</span>;
}
