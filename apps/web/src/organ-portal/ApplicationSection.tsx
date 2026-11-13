import { ChevronRight } from "lucide-react";

import { GovernanceChartView } from "@/governance/GovernanceChartView";
import { changeTone, formatChange, formatValue } from "@/governance/chartModel";
import { formatStamp } from "@/organ-portal/format";
import { detailHref } from "@/organ-portal/routes";
import type { GovernanceMetric, GovernanceSummary } from "@/types";

/** The figures a section leads with: the headline first, then the calm ones, up to four. */
export function leadFigures(summary: GovernanceSummary, limit = 4): GovernanceMetric[] {
  const headline = summary.metrics.filter((metric) => metric.headline);
  const rest = summary.metrics.filter((metric) => !metric.headline && metric.tone !== "attention");
  return [...headline, ...rest].slice(0, limit);
}

/** What needs a look: metrics marked attention plus the application's own attention items. */
export function attentionRows(summary: GovernanceSummary) {
  return [
    ...summary.metrics
      .filter((metric) => metric.tone === "attention")
      .map((metric) => ({ key: `metric-${metric.key}`, label: metric.label, value: formatValue(metric.value, metric.unit), href: null as string | null })),
    ...(summary.attention ?? []).map((item, index) => ({ key: `item-${index}`, label: item.label, value: formatValue(item.count), href: item.href })),
  ];
}

export function SectionStamp({ value }: { value: string }) {
  return <span className="font-mono text-xs tabular-nums text-muted-foreground">Data per {formatStamp(value)}</span>;
}

/** One row of report figures, separated by hairlines rather than boxed into separate cards. */
const BAND_COLUMNS = ["lg:grid-cols-1", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4"] as const;

export function FigureBand({ metrics }: { metrics: GovernanceMetric[] }) {
  const columns = Math.min(metrics.length, 4);
  return (
    <dl className={["grid overflow-hidden rounded-xl border border-border bg-surface-raised", columns === 1 ? "grid-cols-1" : "grid-cols-2", BAND_COLUMNS[columns]].join(" ")}>
      {metrics.map((metric, index) => {
        const change = metric.trend?.change;
        const tone = change ? changeTone(change) : "neutral";
        return (
          <div
            key={metric.key}
            className={[
              "min-w-0 px-5 py-5",
              index % 2 === 1 ? "border-l border-border" : "",
              index >= 2 ? "border-t border-border lg:border-t-0" : "",
              index % columns !== 0 ? "lg:border-l" : "lg:border-l-0",
            ].join(" ")}
          >
            <dt className="truncate text-[13px] text-muted-foreground">{metric.label}</dt>
            <dd className="mt-2 text-[28px] font-semibold leading-none tabular-nums tracking-[-0.01em] text-brand-heading">
              {metric.value === null ? <span className="text-base font-normal text-muted-foreground">Belum tersedia</span> : formatValue(metric.value, metric.unit)}
            </dd>
            {change ? (
              <p className={["mt-2 text-xs tabular-nums", tone === "success" ? "text-success-ink" : tone === "warning" ? "text-warning-ink" : "text-muted-foreground"].join(" ")}>
                {formatChange(change)} dibanding tahun lalu
              </p>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}

export function AttentionList({ summary, emptyText = "Tidak ada yang perlu perhatian" }: { summary: GovernanceSummary; emptyText?: string }) {
  const rows = attentionRows(summary);
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-5">
      <h3 className="text-sm font-medium text-brand-heading">Perlu perhatian</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-start justify-between gap-4 py-3 text-sm">
              <span className="flex min-w-0 items-start gap-2.5">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent-orange" />
                <span className="text-foreground">{row.label}</span>
              </span>
              <span className="shrink-0 tabular-nums font-medium text-brand-heading">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One application on the overview: its lead figures, its main chart beside what needs a look, and
 * a way into its Rincian page on the organ host.
 */
export function ApplicationSection({ summary }: { summary: GovernanceSummary }) {
  const charts = summary.charts ?? [];
  const leads = leadFigures(summary);
  return (
    <section className="mt-12" aria-labelledby={`aplikasi-${summary.applicationKey}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id={`aplikasi-${summary.applicationKey}`} className="text-xl font-semibold text-brand-heading">{summary.title}</h2>
          <SectionStamp value={summary.dataAsOf} />
        </div>
        <a
          href={detailHref(summary.applicationKey)}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-brand-primary-deep transition-colors hover:bg-brand-primary-pale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Rincian {summary.title}
          <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </a>
      </div>
      {leads.length > 0 ? <div className="mt-4"><FigureBand metrics={leads} /></div> : null}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {charts[0] ? <GovernanceChartView chart={charts[0]} /> : <div className="hidden lg:block" />}
        <AttentionList summary={summary} />
      </div>
      {charts[1] ? <div className="mt-4"><GovernanceChartView chart={charts[1]} /></div> : null}
    </section>
  );
}
