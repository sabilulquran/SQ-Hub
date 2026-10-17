import { AlertTriangle, ArrowUpRight, Landmark, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AppShell, type ShellPreviewMode } from "@/components/AppShell";
import { ApplicationCard } from "@/components/ApplicationCard";
import { GovernanceChartView } from "@/governance/GovernanceChartView";
import { changeTone, formatChange, formatValue, lineSegments } from "@/governance/chartModel";
import { organBadge } from "@/organ";
import type { GovernanceCard, GovernanceMetric, GovernanceSnapshot, GovernanceSummary, WorkspaceSnapshot } from "@/types";

export type GovernanceViewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "reauth" }
  | { status: "ready"; snapshot: GovernanceSnapshot };

type ReadyCard = Extract<GovernanceCard, { state: "ready" }>;
type FailedCard = Extract<GovernanceCard, { state: "failed" }>;

/** Loads `/api/governance/summaries` for the Ringkasan Yayasan route (HUB-IMPL-021 §5). */
export function GovernanceRoute({ workspace, onLogout }: { workspace: WorkspaceSnapshot; onLogout?: () => void | Promise<void> }) {
  const [state, setState] = useState<GovernanceViewState>({ status: "loading" });
  const [retrying, setRetrying] = useState<string[]>([]);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/governance/summaries", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (response.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (response.status === 403) {
        // No effective membership: the ordinary Beranda is the landing page.
        window.location.replace("/");
        return;
      }
      if (response.status === 428) {
        setState({ status: "reauth" });
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: "ready", snapshot: (await response.json()) as GovernanceSnapshot });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const retryCard = useCallback(async (applicationKey: string) => {
    setRetrying((current) => [...current, applicationKey]);
    try {
      const response = await fetch(`/api/governance/summaries/${encodeURIComponent(applicationKey)}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const body = (await response.json()) as { card: GovernanceCard | null };
      setState((current) => {
        if (current.status !== "ready") return current;
        const cards = body.card
          ? current.snapshot.cards.map((card) => (card.applicationKey === applicationKey ? body.card! : card))
          : current.snapshot.cards.filter((card) => card.applicationKey !== applicationKey);
        return { status: "ready", snapshot: { ...current.snapshot, cards } };
      });
    } finally {
      setRetrying((current) => current.filter((key) => key !== applicationKey));
    }
  }, []);

  return <GovernancePageView workspace={workspace} state={state} retrying={retrying} onRetryCard={retryCard} onReload={load} {...(onLogout ? { onLogout } : {})} />;
}

export function GovernancePageView({
  workspace,
  state,
  retrying = [],
  onRetryCard,
  onReload,
  onLogout,
  previewMode,
}: {
  workspace: WorkspaceSnapshot;
  state: GovernanceViewState;
  retrying?: string[];
  onRetryCard?: (applicationKey: string) => void;
  onReload?: () => void;
  onLogout?: () => void | Promise<void>;
  previewMode?: ShellPreviewMode;
}) {
  return (
    <AppShell workspace={workspace} space="workspace" active="yayasan" onLogout={onLogout} previewMode={previewMode}>
      {state.status === "loading" ? (
        <StatusPanel icon={<LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />} title="Memuat Ringkasan Yayasan" body="SQ Hub sedang meminta ringkasan dari setiap aplikasi." />
      ) : null}
      {state.status === "error" ? (
        <StatusPanel
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title="Ringkasan Yayasan belum dapat dimuat"
          body="Coba lagi beberapa saat."
          action={onReload ? { label: "Coba lagi", onClick: onReload } : undefined}
        />
      ) : null}
      {state.status === "reauth" ? (
        <StatusPanel
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title="Masuk ulang diperlukan"
          body="Sesi Anda perlu diperbarui sebelum ringkasan dapat diminta. Keluar lalu masuk kembali melalui Akun SQ."
          action={onLogout ? { label: "Keluar dan masuk kembali", onClick: () => void onLogout() } : undefined}
        />
      ) : null}
      {state.status === "ready" ? (
        <ReadyView workspace={workspace} snapshot={state.snapshot} retrying={retrying} onRetryCard={onRetryCard} />
      ) : null}
    </AppShell>
  );
}

function ReadyView({
  workspace,
  snapshot,
  retrying,
  onRetryCard,
}: {
  workspace: WorkspaceSnapshot;
  snapshot: GovernanceSnapshot;
  retrying: string[];
  onRetryCard?: (applicationKey: string) => void;
}) {
  const ready = snapshot.cards.filter((card): card is ReadyCard => card.state === "ready");
  const failed = snapshot.cards.filter((card): card is FailedCard => card.state === "failed");
  const oldest = ready.map((card) => card.summary.dataAsOf).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const headlines = ready
    .map((card) => ({ card, metric: card.summary.metrics.find((metric) => metric.headline) }))
    .filter((item): item is { card: ReadyCard; metric: GovernanceMetric } => Boolean(item.metric))
    .slice(0, 4);
  const attention = ready.flatMap((card) => (card.summary.attention ?? []).map((item) => ({ ...item, application: card.summary.title })));

  return (
    <>
      <section aria-labelledby="yayasan-heading">
        <p className="text-sm font-semibold text-brand-primary-deep">Ringkasan Yayasan</p>
        <h1 id="yayasan-heading" className="mt-1 font-display text-3xl font-bold tracking-[-0.03em] text-brand-heading sm:text-4xl">
          Assalamu&apos;alaikum, {workspace.user.displayName}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-cat-pay-soft px-2.5 py-1 text-xs font-bold text-cat-pay">
            <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
            {organBadge(snapshot.membership.organ)}
            {snapshot.membership.positionLabel ? ` · ${snapshot.membership.positionLabel}` : ""}
          </span>
          {oldest ? <span>Data per {formatDateTime(oldest)}</span> : null}
        </div>
      </section>

      {snapshot.cards.length === 0 ? (
        <div className="mt-7 rounded-2xl border border-dashed border-border bg-surface-raised px-5 py-9 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Landmark className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="mt-3 font-display text-lg font-bold text-brand-heading">Belum ada ringkasan</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
            Belum ada aplikasi yang menghubungkan ringkasan untuk akun Anda. Ringkasan muncul setelah aplikasi memberi akun Anda peran Yayasan.
          </p>
        </div>
      ) : null}

      {headlines.length > 0 ? (
        <section aria-label="Angka utama" className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {headlines.map(({ card, metric }) => <HeadlineTile key={card.applicationKey} summary={card.summary} metric={metric} />)}
        </section>
      ) : null}

      {attention.length > 0 || failed.length > 0 ? (
        <section aria-labelledby="attention-heading" className="mt-7 rounded-2xl border border-warning-ink/15 bg-warning-soft/45 p-4">
          <h2 id="attention-heading" className="font-display text-lg font-bold text-brand-heading">Perlu perhatian</h2>
          <ul className="mt-2 divide-y divide-warning-ink/10">
            {attention.map((item, index) => (
              <li key={`${item.href}-${index}`}>
                <a href={item.href} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="min-w-0"><span className="font-semibold text-foreground">{item.label}</span><span className="block text-xs text-muted-foreground">{item.application}</span></span>
                  <span className="shrink-0 rounded-full bg-surface-raised px-2.5 py-0.5 text-sm font-bold tabular-nums text-warning-ink">{formatValue(item.count)}</span>
                </a>
              </li>
            ))}
            {failed.map((card) => (
              <li key={card.applicationKey} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
                <span><span className="font-semibold text-foreground">{card.name}</span><span className="block text-xs text-muted-foreground">Tidak dapat dimuat</span></span>
                <button
                  type="button"
                  disabled={!onRetryCard || retrying.includes(card.applicationKey)}
                  onClick={() => onRetryCard?.(card.applicationKey)}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 text-xs font-bold text-brand-primary-deep disabled:opacity-50"
                >
                  <RefreshCw className={["h-3.5 w-3.5", retrying.includes(card.applicationKey) ? "animate-spin" : ""].join(" ")} aria-hidden="true" />
                  Coba lagi
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ready.map((card) => <ModuleSection key={card.applicationKey} summary={card.summary} />)}

      <section className="mt-9" aria-labelledby="your-apps-heading">
        <h2 id="your-apps-heading" className="font-display text-xl font-bold text-brand-heading sm:text-2xl">Aplikasi Anda</h2>
        {workspace.applications.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {workspace.applications.map((application) => <ApplicationCard key={application.key} application={application} />)}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Belum ada akses aplikasi aktif untuk akun ini.</p>
        )}
      </section>
    </>
  );
}

function HeadlineTile({ summary, metric }: { summary: GovernanceSummary; metric: GovernanceMetric }) {
  const change = metric.trend?.change;
  const tone = change ? changeTone(change) : "neutral";
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-surface-raised p-3.5 shadow-[var(--shadow-soft)] sm:p-4">
      <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{summary.title}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{metric.label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-brand-heading">{formatValue(metric.value, metric.unit)}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        {change ? (
          <span className={["text-xs font-bold tabular-nums", tone === "success" ? "text-success-ink" : tone === "warning" ? "text-warning-ink" : "text-muted-foreground"].join(" ")} data-tone={tone}>
            {formatChange(change)}
          </span>
        ) : <span />}
        {metric.trend ? <Sparkline values={metric.trend.points.map((point) => point.value)} /> : null}
      </div>
    </div>
  );
}

export function Sparkline({ values }: { values: Array<number | null> }) {
  const width = 72;
  const height = 24;
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const x = (index: number) => (values.length === 1 ? width / 2 : (index / (values.length - 1)) * (width - 4) + 2);
  const y = (value: number) => height - 3 - ((value - min) / span) * (height - 6);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-6 w-[4.5rem] shrink-0" aria-hidden="true">
      {lineSegments(values).map((segment, index) =>
        segment.points.length === 1 ? (
          <circle key={index} cx={x(segment.points[0]!.index)} cy={y(segment.points[0]!.value)} r={1.5} fill="var(--cat-attendance)" />
        ) : (
          <polyline
            key={index}
            points={segment.points.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")}
            fill="none"
            stroke="var(--cat-attendance)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}

function ModuleSection({ summary }: { summary: GovernanceSummary }) {
  const metrics = summary.metrics.filter((metric) => !metric.headline);
  return (
    <section className="mt-9" aria-labelledby={`module-${summary.applicationKey}`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={`module-${summary.applicationKey}`} className="font-display text-xl font-bold text-brand-heading sm:text-2xl">{summary.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Data per {formatDateTime(summary.dataAsOf)}</p>
        </div>
        <a href={summary.detailUrl} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-brand-primary-deep hover:bg-brand-primary-pale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Lihat rincian
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
      {summary.charts && summary.charts.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {summary.charts.map((chart) => <GovernanceChartView key={chart.key} chart={chart} />)}
        </div>
      ) : null}
      {metrics.length > 0 ? (
        <dl className="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 lg:grid-cols-3">
          {metrics.map((metric) => (
            <div
              key={metric.key}
              className={metric.tone === "attention" ? "rounded-xl border border-warning-ink/15 bg-warning-soft/50 px-3.5 py-3" : "rounded-xl border border-border/70 bg-surface-raised px-3.5 py-3"}
            >
              <dt className="text-xs text-muted-foreground">{metric.label}{metric.tone === "attention" ? <span className="ml-1.5 font-bold text-warning-ink">· Perlu perhatian</span> : null}</dt>
              <dd className={metric.value === null ? "mt-1 text-sm font-semibold text-muted-foreground" : "mt-1 font-display text-lg font-bold tabular-nums text-brand-heading"}>
                {formatValue(metric.value, metric.unit)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function StatusPanel({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: { label: string; onClick: () => void } | undefined }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-surface-raised p-6 text-center shadow-[var(--shadow-soft)]" role="status">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">{icon}</span>
      <h1 className="mt-3 font-display text-xl font-bold text-brand-heading">{title}</h1>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
      {action ? (
        <button type="button" onClick={action.onClick} className="mt-4 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-brand-foreground shadow-[var(--shadow-button)]">
          {action.label}
        </button>
      ) : null}
    </section>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date);
}
