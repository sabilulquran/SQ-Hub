import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import type { Label, Orang } from "@/kerja/api";
import { WARNA } from "@/kerja/format";
import { navigate } from "@/kerja/routes";

// Shared SQ Core primitives already used by Kirim SQ; reused here rather than copied.
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

export function LabelChip({ label }: { label: Pick<Label, "nama" | "warna"> }) {
  return <span className={`inline-flex max-w-full items-center truncate rounded-md px-1.5 py-0.5 text-[11px] font-bold ${WARNA[label.warna].kelas}`}>{label.nama}</span>;
}

export function initials(nama: string): string {
  const words = nama.replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1]![0] : "")).toUpperCase();
}

export function Avatar({ orang, size = "sm" }: { orang: Orang; size?: "sm" | "md" }) {
  return (
    <span
      title={orang.aktif ? orang.nama : `${orang.nama} (tidak aktif)`}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-2 border-surface-raised font-bold ${size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs"} ${orang.aktif ? "bg-brand-primary-pale text-brand-primary-deep" : "bg-muted text-muted-foreground line-through"}`}
    >
      {initials(orang.nama)}
    </span>
  );
}

export function AvatarStack({ people, max = 3 }: { people: Orang[]; max?: number }) {
  if (people.length === 0) return null;
  return (
    <span className="flex -space-x-1.5" aria-label={`Penanggung jawab: ${people.map((p) => p.nama).join(", ")}`}>
      {people.slice(0, max).map((person) => <Avatar key={person.id} orang={person} />)}
      {people.length > max ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-raised bg-muted text-[10px] font-bold text-muted-foreground">+{people.length - max}</span> : null}
    </span>
  );
}

export type Loaded<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string; code?: string };

/** Loads once per key; `reload` keeps the old data visible while refreshing. */
export function useLoad<T>(load: () => Promise<T>, key: string, initial?: T): { state: Loaded<T>; reload: () => Promise<void>; setData: (data: T) => void } {
  const [state, setState] = useState<Loaded<T>>(initial === undefined ? { status: "loading" } : { status: "ready", data: initial });
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(async () => {
    try {
      const data = await loadRef.current();
      setState({ status: "ready", data });
    } catch (error) {
      const code = (error as { code?: string }).code;
      setState({ status: "error", message: error instanceof Error ? error.message : "Gagal memuat.", ...(code ? { code } : {}) });
    }
  }, []);
  const first = useRef(initial !== undefined);
  useEffect(() => {
    // Preview data renders without a request; later key changes load normally.
    if (first.current) {
      first.current = false;
      return;
    }
    setState({ status: "loading" });
    void run();
  }, [key, run]);
  return { state, reload: run, setData: (data: T) => setState({ status: "ready", data }) };
}

/** The signed-in person, so screens can mark what is their own (comments, uploads). */
export const ViewerContext = createContext<string | null>(null);
export function useViewerId(): string | null {
  return useContext(ViewerContext);
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
