import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import type { Label, Orang } from "@/kerja/api";
import { tanggalTile, WARNA } from "@/kerja/format";
import { CalendarDays } from "lucide-react";
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
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-border/80 px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
      <span className={`h-2 w-2 shrink-0 rounded-full ${WARNA[label.warna].titik}`} aria-hidden="true" />
      {label.nama}
    </span>
  );
}

/**
 * Signature of Kerja: a deadline reads like a torn agenda page, day over month. Overdue turns the
 * day danger red; due within a day turns it warning amber. Nothing else gets a colour.
 */
export function DateTile({ iso, nada, size = "md" }: { iso: string | null; nada?: "lewat" | "dekat" | "biasa" | "selesai"; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-10 w-10" : "h-12 w-12";
  if (!iso) {
    return <span className={`flex ${box} shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-border text-[11px] text-muted-foreground`} aria-label="Tanpa tenggat">—</span>;
  }
  const t = tanggalTile(iso);
  const ink = nada === "lewat" ? "text-danger-ink" : nada === "dekat" ? "text-warning-ink" : nada === "selesai" ? "text-muted-foreground" : "text-foreground";
  return (
    <span className={`flex ${box} shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-raised`} aria-label={`Tenggat ${t.hari} ${t.bulan} ${t.jam}`}>
      <span className="w-full border-b border-border bg-muted/70 text-center text-[10px] font-medium leading-4 text-muted-foreground">{t.bulan}</span>
      <span className={`flex-1 content-center text-base font-semibold leading-none tabular-nums ${ink}`}>{t.hari}</span>
    </span>
  );
}

/** Quiet deadline text for dense places like board cards: colour only when it is late or close. */
export function DueText({ iso, nada }: { iso: string; nada: "lewat" | "dekat" | "biasa" }) {
  const t = tanggalTile(iso);
  const ink = nada === "lewat" ? "text-danger-ink" : nada === "dekat" ? "text-warning-ink" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-xs tabular-nums ${ink}`}>
      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
      {nada === "lewat" ? "Lewat " : ""}{t.hari} {t.bulan}, {t.jam}
    </span>
  );
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
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-brand-heading">{title}</h1>
        {children}
      </div>
      {actions ? <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-nowrap">{actions}</div> : null}
    </div>
  );
}
