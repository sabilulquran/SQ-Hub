import { ArrowUpRight, ChevronLeft, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { GovernanceChartView } from "@/governance/GovernanceChartView";
import { organBadge } from "@/organ";
import { ApplicationSection, AttentionList, FigureBand, SectionStamp } from "@/organ-portal/ApplicationSection";
import { collectDecisions, type DecisionRow } from "@/organ-portal/decisions";
import { EmployeeList } from "@/organ-portal/EmployeeList";
import { formatToday } from "@/organ-portal/format";
import { OrganShell } from "@/organ-portal/OrganShell";
import { resolveOrganRoute, type OrganRoute } from "@/organ-portal/routes";
import type { GovernanceCard, GovernanceSnapshot, GovernanceSummary, Organ } from "@/types";

interface OrganSession {
  user: { displayName: string };
  membership: { organ: Organ; positionLabel?: string };
}

export type OrganViewState =
  | { status: "loading" }
  | { status: "refused"; code: string }
  | { status: "error" }
  | { status: "ready"; session: OrganSession; snapshot: GovernanceSnapshot | null };

type ReadyCard = Extract<GovernanceCard, { state: "ready" }>;
type FailedCard = Extract<GovernanceCard, { state: "failed" }>;

function startupRefusal(): string | null {
  return new URLSearchParams(window.location.search).get("authError");
}

/** Portal Organ Yayasan on `organ.sabilulquran.or.id` (ORGAN-IMPL-001). */
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
      if (summaries.status === 401 || summaries.status === 428) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (summaries.status === 403) {
        const body = (await summaries.json().catch(() => ({}))) as { error?: string };
        setState({ status: "refused", code: body.error ?? "organ_access_denied" });
        return;
      }
      if (!summaries.ok) throw new Error(String(summaries.status));
      setState({ status: "ready", session, snapshot: (await summaries.json()) as GovernanceSnapshot });
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

  return (
    <OrganAppView
      route={route}
      state={state}
      retrying={retrying}
      onRetryCard={retryCard}
      onReload={load}
      onLogout={logout}
      detail={(applicationKey) => <EmployeeList applicationKey={applicationKey} />}
    />
  );
}

export function OrganAppView({
  route,
  state,
  retrying = [],
  onRetryCard,
  onReload,
  onLogout,
  detail,
  now,
}: {
  route: OrganRoute;
  state: OrganViewState;
  retrying?: string[];
  onRetryCard?: (applicationKey: string) => void;
  onReload?: () => void;
  onLogout?: () => void | Promise<void>;
  /** Extra content under an application's Rincian, such as the HCIS employee list. */
  detail?: (applicationKey: string) => ReactNode;
  now?: Date;
}) {
  const ready = state.status === "ready" ? state : null;
  return (
    <OrganShell route={route} displayName={ready?.session.user.displayName} onLogout={ready ? onLogout : undefined}>
      {state.status === "loading" || (ready && !ready.snapshot) ? <Pending text="Memuat ringkasan dari setiap aplikasi" /> : null}
      {state.status === "error" ? (
        <Notice title="Portal belum dapat dimuat" body="Coba lagi beberapa saat" action={onReload ? { label: "Coba lagi", onClick: onReload } : undefined} />
      ) : null}
      {state.status === "refused" ? <Refusal code={state.code} /> : null}
      {ready?.snapshot && route.name === "ringkasan" ? (
        <Overview session={ready.session} snapshot={ready.snapshot} retrying={retrying} onRetryCard={onRetryCard} now={now} />
      ) : null}
      {ready?.snapshot && route.name === "keputusan" ? <DecisionsPage rows={collectDecisions(ready.snapshot.cards)} /> : null}
      {ready?.snapshot && route.name === "aplikasi" ? (
        <DetailPage card={ready.snapshot.cards.find((card) => card.applicationKey === route.applicationKey)} detail={detail} />
      ) : null}
      {route.name === "not-found" && state.status !== "refused" ? (
        <Notice title="Halaman tidak ditemukan" body="Alamat ini tidak ada di Portal Organ" action={{ label: "Ke Ringkasan", onClick: () => window.location.assign("/") }} />
      ) : null}
    </OrganShell>
  );
}

function Overview({
  session,
  snapshot,
  retrying,
  onRetryCard,
  now,
}: {
  session: OrganSession;
  snapshot: GovernanceSnapshot;
  retrying: string[];
  onRetryCard?: ((applicationKey: string) => void) | undefined;
  now?: Date | undefined;
}) {
  const ready = snapshot.cards.filter((card): card is ReadyCard => card.state === "ready");
  const failed = snapshot.cards.filter((card): card is FailedCard => card.state === "failed");
  const decisions = collectDecisions(snapshot.cards);
  const role = `${organBadge(session.membership.organ)}${session.membership.positionLabel ? `, ${session.membership.positionLabel}` : ""}`;
  return (
    <>
      <header>
        <p className="text-sm text-muted-foreground">Assalamu&apos;alaikum, {session.user.displayName} · {role}</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.01em] text-brand-heading sm:text-[32px]">Ringkasan Yayasan</h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatToday(now)}</p>
      </header>

      {decisions.length > 0 ? <DecisionsPanel rows={decisions} /> : null}

      {failed.length > 0 ? (
        <ul className="mt-6 space-y-2">
          {failed.map((card) => (
            <li key={card.applicationKey} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-5 py-3 text-sm">
              <span className="text-muted-foreground"><span className="font-medium text-brand-heading">{card.name}</span> belum dapat dimuat</span>
              <button
                type="button"
                disabled={!onRetryCard || retrying.includes(card.applicationKey)}
                onClick={() => onRetryCard?.(card.applicationKey)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-primary-deep transition-colors hover:bg-brand-primary-pale disabled:opacity-50"
              >
                <RefreshCw className={["h-4 w-4", retrying.includes(card.applicationKey) ? "animate-spin" : ""].join(" ")} strokeWidth={1.5} aria-hidden="true" />
                Coba lagi
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {ready.length === 0 && failed.length === 0 ? (
        <Notice title="Belum ada ringkasan" body="Belum ada aplikasi yang menghubungkan ringkasan untuk akun Anda. Ringkasan muncul setelah aplikasi memberi akun Anda peran Yayasan." />
      ) : null}

      {ready.map((card) => <ApplicationSection key={card.applicationKey} summary={card.summary} />)}
    </>
  );
}

function DetailPage({ card, detail }: { card: GovernanceCard | undefined; detail?: ((applicationKey: string) => ReactNode) | undefined }) {
  if (!card || card.state !== "ready") {
    return (
      <Notice
        title={card ? `${card.name} belum dapat dimuat` : "Rincian tidak ditemukan"}
        body={card ? "Coba lagi beberapa saat" : "Aplikasi ini tidak menerbitkan ringkasan untuk akun Anda"}
        action={{ label: "Ke Ringkasan", onClick: () => window.location.assign("/") }}
      />
    );
  }
  const summary: GovernanceSummary = card.summary;
  return (
    <>
      <a href="/" className="inline-flex h-8 items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground transition-colors hover:text-brand-heading">
        <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" /> Ringkasan
      </a>
      <header className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em] text-brand-heading sm:text-[32px]">Rincian {summary.title}</h1>
        <SectionStamp value={summary.dataAsOf} />
      </header>
      <div className="mt-6"><FigureBand metrics={summary.metrics.filter((metric) => metric.tone !== "attention")} /></div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          {(summary.charts ?? []).map((chart) => <GovernanceChartView key={chart.key} chart={chart} />)}
        </div>
        <AttentionList summary={summary} />
      </div>
      {detail?.(summary.applicationKey)}
    </>
  );
}

function DecisionsPage({ rows }: { rows: DecisionRow[] }) {
  return (
    <>
      <header>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em] text-brand-heading sm:text-[32px]">Keputusan</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Pengajuan yang menunggu keputusan Anda. Keputusan diambil di aplikasi asalnya, yang mencatat aturan dan riwayatnya.
        </p>
      </header>
      <DecisionsPanel rows={rows} />
    </>
  );
}

function DecisionsPanel({ rows }: { rows: DecisionRow[] }) {
  return (
    <section aria-label="Menunggu keputusan Anda" className="mt-8 rounded-xl border border-border bg-surface-raised">
      <h2 className="border-b border-border px-5 py-3 text-sm font-medium text-brand-heading">Menunggu keputusan Anda</h2>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Tidak ada pengajuan yang menunggu keputusan Anda.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row, index) => (
            <li key={`${row.href}-${index}`}>
              <a href={row.href} className="flex min-h-14 items-center justify-between gap-4 px-5 py-3 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="min-w-0">
                  <span className="block font-medium text-brand-heading">{row.label}</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {row.application} · {row.oldestAgeDays === 0 ? "diajukan hari ini" : `tertua ${row.oldestAgeDays} hari`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-[20px] font-semibold tabular-nums text-brand-heading">{row.count}</span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Pending({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
      <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" /> {text}
    </p>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } | undefined }) {
  return (
    <div className="mt-6 rounded-xl border border-border bg-surface-raised px-6 py-10 text-center">
      <h1 className="text-lg font-semibold text-brand-heading">{title}</h1>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? (
        <button type="button" onClick={action.onClick} className="mt-4 inline-flex h-9 items-center rounded-lg bg-brand-primary px-4 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-primary-deep">
          {action.label}
        </button>
      ) : null}
    </div>
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
    <div className="mt-6 rounded-xl border border-border bg-surface-raised px-6 py-10 text-center">
      <h1 className="text-xl font-semibold text-brand-heading">{text.title}</h1>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{text.body}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {retryable ? (
          <a href="/api/auth/oidc/start" className="inline-flex h-9 items-center rounded-lg bg-brand-primary px-4 text-sm font-medium text-brand-foreground">Masuk lagi</a>
        ) : null}
        <a href="https://hub.sabilulquran.or.id/" className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm text-brand-heading">Ke SQ Hub</a>
      </div>
    </div>
  );
}
