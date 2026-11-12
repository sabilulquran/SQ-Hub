import { AlertTriangle, ArrowUpRight, ClipboardCheck, Landmark, LoaderCircle, LogOut } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BrandLockup } from "@/components/BrandLockup";
import { GovernanceOverview, StatusPanel } from "@/governance/GovernancePage";
import { collectDecisions } from "@/organ-portal/decisions";
import { resolveOrganRoute, type OrganRoute } from "@/organ-portal/routes";
import type { DecisionRow } from "@/organ-portal/decisions";
import type { GovernanceCard, GovernanceSnapshot, Organ } from "@/types";

interface OrganSession {
  user: { displayName: string };
  membership: { organ: Organ; positionLabel?: string };
}

export type OrganViewState =
  | { status: "loading" }
  | { status: "refused"; code: string }
  | { status: "error" }
  | { status: "ready"; session: OrganSession; snapshot: GovernanceSnapshot | null };

function startupRefusal(): string | null {
  return new URLSearchParams(window.location.search).get("authError");
}

/** Portal Organ Yayasan on `organ.sabilulquran.or.id` (ORGAN-IMPL-001 R1). */
export function OrganApp() {
  const route = resolveOrganRoute(window.location.pathname);
  const [state, setState] = useState<OrganViewState>(() => {
    const refusal = startupRefusal();
    return refusal ? { status: "refused", code: refusal } : { status: "loading" };
  });
  const [retrying, setRetrying] = useState<string[]>([]);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/organ/session", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (response.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (response.status === 403) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setState({ status: "refused", code: body.error ?? "organ_access_denied" });
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const session = (await response.json()) as OrganSession;
      setState({ status: "ready", session, snapshot: null });
      const summaries = await fetch("/api/organ/summaries", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!summaries.ok) throw new Error(String(summaries.status));
      const snapshot = (await summaries.json()) as GovernanceSnapshot;
      setState({ status: "ready", session, snapshot });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    document.title = "Portal Organ Yayasan · Sabilul Qur'an";
    if (state.status === "loading") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryCard = useCallback(async (applicationKey: string) => {
    setRetrying((current) => [...current, applicationKey]);
    try {
      const response = await fetch(`/api/organ/summaries/${encodeURIComponent(applicationKey)}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const body = (await response.json()) as { card: GovernanceCard | null };
      setState((current) => {
        if (current.status !== "ready" || !current.snapshot) return current;
        const cards = body.card
          ? current.snapshot.cards.map((card) => (card.applicationKey === applicationKey ? body.card! : card))
          : current.snapshot.cards.filter((card) => card.applicationKey !== applicationKey);
        return { ...current, snapshot: { ...current.snapshot, cards } };
      });
    } finally {
      setRetrying((current) => current.filter((key) => key !== applicationKey));
    }
  }, []);

  const logout = useCallback(async () => {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
    const body = (await response.json().catch(() => ({}))) as { logoutUrl?: string | null };
    window.location.assign(body.logoutUrl ?? "/");
  }, []);

  return <OrganAppView route={route} state={state} retrying={retrying} onRetryCard={retryCard} onReload={load} onLogout={logout} />;
}

export function OrganAppView({
  route,
  state,
  retrying = [],
  onRetryCard,
  onReload,
  onLogout,
}: {
  route: OrganRoute;
  state: OrganViewState;
  retrying?: string[];
  onRetryCard?: (applicationKey: string) => void;
  onReload?: () => void;
  onLogout?: () => void | Promise<void>;
}) {
  const ready = state.status === "ready" ? state : null;
  return (
    <OrganShell route={route} displayName={ready?.session.user.displayName} onLogout={ready ? onLogout : undefined}>
      {state.status === "loading" || (ready && !ready.snapshot) ? (
        <StatusPanel icon={<LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />} title="Memuat ringkasan" body="Portal sedang meminta ringkasan dari setiap aplikasi." />
      ) : null}
      {state.status === "error" ? (
        <StatusPanel
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title="Portal belum dapat dimuat"
          body="Coba lagi beberapa saat."
          action={onReload ? { label: "Coba lagi", onClick: onReload } : undefined}
        />
      ) : null}
      {state.status === "refused" ? <Refusal code={state.code} /> : null}
      {ready?.snapshot && route.name === "ringkasan" ? (
        <GovernanceOverview
          eyebrow="Portal Organ Yayasan"
          displayName={ready.session.user.displayName}
          snapshot={ready.snapshot}
          retrying={retrying}
          onRetryCard={onRetryCard}
          before={<DecisionsCard rows={collectDecisions(ready.snapshot.cards)} compact />}
        />
      ) : null}
      {ready?.snapshot && route.name === "keputusan" ? (
        <section aria-labelledby="keputusan-heading">
          <p className="text-sm font-semibold text-brand-primary-deep">Portal Organ Yayasan</p>
          <h1 id="keputusan-heading" className="mt-1 font-display text-3xl font-bold tracking-[-0.03em] text-brand-heading">Keputusan</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Pengajuan yang menunggu keputusan Anda. Keputusan diambil di aplikasi asalnya, yang tetap mencatat aturan dan riwayatnya.
          </p>
          <DecisionsCard rows={collectDecisions(ready.snapshot.cards)} />
        </section>
      ) : null}
      {route.name === "not-found" && state.status !== "refused" ? (
        <StatusPanel icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />} title="Halaman tidak ditemukan" body="Kembali ke Ringkasan." action={{ label: "Ke Ringkasan", onClick: () => window.location.assign("/") }} />
      ) : null}
    </OrganShell>
  );
}

function DecisionsCard({ rows, compact = false }: { rows: DecisionRow[]; compact?: boolean }) {
  if (compact && rows.length === 0) return null;
  return (
    <section aria-label="Menunggu keputusan Anda" className="mt-7 rounded-2xl border border-brand-primary/15 bg-brand-primary-pale/40 p-4">
      <h2 className="font-display text-lg font-bold text-brand-heading">Menunggu keputusan Anda</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Tidak ada pengajuan yang menunggu keputusan Anda.</p>
      ) : (
        <ul className="mt-2 divide-y divide-brand-primary/10">
          {rows.map((row, index) => (
            <li key={`${row.href}-${index}`}>
              <a href={row.href} className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0">
                  <span className="font-semibold text-foreground">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.application} · {row.oldestAgeDays === 0 ? "diajukan hari ini" : `tertua ${row.oldestAgeDays} hari`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-surface-raised px-2.5 py-0.5 text-sm font-bold tabular-nums text-brand-primary-deep">{row.count}</span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const REFUSALS: Record<string, { title: string; body: string }> = {
  organ_membership_required: {
    title: "Portal ini khusus Organ Yayasan",
    body: "Akun Anda tidak tercatat sebagai Pembina, Pengurus, atau Pengawas yang sedang menjabat. Bila ini keliru, hubungi Admin Platform.",
  },
  organ_access_denied: {
    title: "Akses portal belum diberikan",
    body: "Keanggotaan Organ Yayasan Anda belum disertai akses ke portal. Hubungi Admin Platform.",
  },
  identity_unavailable: { title: "Akun Sabilul Qur'an belum dapat dihubungi", body: "Coba lagi beberapa saat." },
  oidc_failed: { title: "Proses masuk belum selesai", body: "Proses masuk melalui Akun Sabilul Qur'an belum dapat diselesaikan. Silakan coba lagi." },
};

function Refusal({ code }: { code: string }) {
  const text = REFUSALS[code] ?? REFUSALS.organ_access_denied!;
  const retryable = code === "identity_unavailable" || code === "oidc_failed";
  return (
    <div className="rounded-2xl border border-border bg-surface-raised px-5 py-9 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Landmark className="h-5 w-5" aria-hidden="true" />
      </span>
      <h1 className="mt-3 font-display text-xl font-bold text-brand-heading">{text.title}</h1>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{text.body}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {retryable ? (
          <a href="/api/auth/oidc/start" className="inline-flex min-h-10 items-center rounded-xl bg-brand-primary px-4 text-sm font-bold text-brand-foreground">Masuk lagi</a>
        ) : null}
        <a href="https://hub.sabilulquran.or.id/" className="inline-flex min-h-10 items-center rounded-xl border border-border px-4 text-sm font-bold text-brand-primary-deep">Ke SQ Hub</a>
      </div>
    </div>
  );
}

function OrganShell({
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
  const items = [
    { key: "ringkasan", label: "Ringkasan", href: "/", icon: Landmark },
    { key: "keputusan", label: "Keputusan", href: "/keputusan", icon: ClipboardCheck },
  ] as const;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-surface-raised">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:h-16 sm:px-6 lg:px-8">
          <a href="/" className="min-w-0 shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Ringkasan Portal Organ">
            <BrandLockup compact appName="Portal Organ" />
          </a>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {displayName ? <span className="hidden max-w-[14rem] truncate text-sm font-semibold text-muted-foreground md:inline">{displayName}</span> : null}
            {onLogout ? (
              <button
                type="button"
                disabled={busy}
                aria-label="Keluar"
                onClick={() => {
                  setBusy(true);
                  void Promise.resolve(onLogout()).finally(() => setBusy(false));
                }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-bold text-brand-primary-deep disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Keluar</span>
              </button>
            ) : null}
          </div>
        </div>
        {displayName ? (
          <nav aria-label="Navigasi Portal Organ" className="mx-auto flex w-full max-w-6xl gap-1 px-4 pb-2 sm:px-6 lg:px-8">
            {items.map((item) => {
              const Icon = item.icon;
              const active = route.name === item.key;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm sm:flex-none",
                    active ? "bg-brand-primary-pale font-bold text-brand-primary-deep" : "font-semibold text-muted-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </a>
              );
            })}
          </nav>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
