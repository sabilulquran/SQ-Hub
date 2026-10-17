import { BarChart3, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  CHART_PALETTE,
  formatPeriod,
  formatValue,
  legendFor,
  lineSegments,
  niceMax,
  seriesColors,
  tableFor,
  tooltipFor,
} from "@/governance/chartModel";
import type { GovernanceChart } from "@/types";

type Activate = (index: number | null) => void;

/**
 * Draws one governance chart from contract data alone (HUB-IMPL-021 §3 "Chart rules"):
 * fixed palette, thin marks, recessive grid, legend for two or more series, hover/focus
 * tooltip with exact values, and "Lihat tabel" with the same values.
 */
export function GovernanceChartView({ chart, initialTable = false }: { chart: GovernanceChart; initialTable?: boolean }) {
  const [showTable, setShowTable] = useState(initialTable);
  const [active, setActive] = useState<number | null>(null);
  const tooltip = active === null ? null : tooltipFor(chart, active);
  const legend = legendFor(chart);

  return (
    <figure className="min-w-0 rounded-2xl border border-border/70 bg-surface-raised p-4 shadow-[var(--shadow-soft)]" data-chart-kind={chart.kind}>
      <figcaption className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-brand-heading">{chart.title}</span>
          <span className="block text-xs text-muted-foreground">Satuan: {chart.unit}</span>
        </span>
        <button
          type="button"
          aria-pressed={showTable}
          onClick={() => setShowTable((value) => !value)}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold text-brand-primary-deep hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showTable ? <BarChart3 className="h-4 w-4" aria-hidden="true" /> : <Table2 className="h-4 w-4" aria-hidden="true" />}
          {showTable ? "Lihat grafik" : "Lihat tabel"}
        </button>
      </figcaption>

      {legend.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legenda">
          {legend.map((entry) => (
            <li key={entry.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className={entry.mark === "line" ? "h-0.5 w-4 rounded-full" : entry.mark === "marker" ? "h-3 w-0.5" : "h-2.5 w-2.5 rounded-sm"}
                style={{ background: entry.color }}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      ) : null}

      {showTable ? (
        <ChartTableView chart={chart} />
      ) : (
        <div className="relative mt-3" onMouseLeave={() => setActive(null)}>
          {chart.kind === "trend" ? <TrendChart chart={chart} active={active} onActivate={setActive} /> : null}
          {chart.kind === "ranking" || chart.kind === "stages" ? <BarList chart={chart} active={active} onActivate={setActive} /> : null}
          {chart.kind === "composition" ? <CompositionChart chart={chart} active={active} onActivate={setActive} /> : null}
          {chart.kind === "target" ? <TargetChart chart={chart} active={active} onActivate={setActive} /> : null}
          {tooltip ? (
            <div role="status" className="pointer-events-none absolute right-0 top-0 z-10 max-w-[14rem] rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs shadow-[var(--shadow-raised)]">
              <p className="font-bold text-foreground">{tooltip.title}</p>
              {tooltip.lines.map((line) => <p key={line} className="text-muted-foreground">{line}</p>)}
            </div>
          ) : null}
        </div>
      )}
    </figure>
  );
}

function ChartTableView({ chart }: { chart: GovernanceChart }) {
  const table = tableFor(chart);
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{chart.title}</caption>
        <thead className="text-muted-foreground">
          <tr>{table.columns.map((column) => <th key={column} scope="col" className="px-2 py-1.5 font-semibold">{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {table.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="px-2 py-1.5 font-semibold text-foreground">{row.label}</th>
              {row.cells.map((cell, index) => <td key={`${row.label}-${index}`} className="px-2 py-1.5 tabular-nums">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function hoverProps(index: number, label: string, onActivate: Activate) {
  return {
    tabIndex: 0,
    "aria-label": label,
    onMouseEnter: () => onActivate(index),
    onFocus: () => onActivate(index),
    onBlur: () => onActivate(null),
  };
}

function tooltipText(chart: GovernanceChart, index: number): string {
  const tooltip = tooltipFor(chart, index);
  return tooltip ? `${tooltip.title}: ${tooltip.lines.join(", ")}` : "";
}

function TrendChart({ chart, active, onActivate }: { chart: Extract<GovernanceChart, { kind: "trend" }>; active: number | null; onActivate: Activate }) {
  const width = 320;
  const height = 150;
  const left = 34;
  const right = 6;
  const top = 8;
  const bottom = 22;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const count = chart.periods.length;
  const band = innerWidth / count;
  const max = niceMax(chart.series.flatMap((series) => series.values.filter((value): value is number => value !== null)));
  const y = (value: number) => top + innerHeight - (value / max) * innerHeight;
  const x = (index: number) => left + band * (index + 0.5);
  const colors = seriesColors(chart.series.map((series) => series.key));
  const bars = chart.series.filter((series) => series.mark === "bar");
  const barWidth = Math.min(14, (band * 0.6) / Math.max(1, bars.length));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={chart.title}>
      {[0, 0.5, 1].map((fraction) => (
        <g key={fraction}>
          <line x1={left} x2={width - right} y1={y(max * fraction)} y2={y(max * fraction)} stroke="var(--border)" strokeWidth={1} />
          <text x={left - 4} y={y(max * fraction) + 3} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">
            {formatValue(max * fraction)}
          </text>
        </g>
      ))}
      {bars.map((series, seriesIndex) =>
        series.values.map((value, index) =>
          value === null ? null : (
            <rect
              key={`${series.key}-${index}`}
              x={x(index) - (barWidth * bars.length) / 2 + seriesIndex * barWidth}
              y={y(value)}
              width={barWidth - 1}
              height={Math.max(0, top + innerHeight - y(value))}
              rx={1.5}
              fill={colors[series.key]}
              opacity={active === null || active === index ? 0.85 : 0.45}
            />
          ),
        ),
      )}
      {chart.series.filter((series) => series.mark === "line").map((series) =>
        lineSegments(series.values).map((segment, segmentIndex) =>
          segment.points.length === 1 ? (
            <circle key={`${series.key}-${segmentIndex}`} cx={x(segment.points[0]!.index)} cy={y(segment.points[0]!.value)} r={2.5} fill={colors[series.key]} />
          ) : (
            <polyline
              key={`${series.key}-${segmentIndex}`}
              points={segment.points.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")}
              fill="none"
              stroke={colors[series.key]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              data-series={series.key}
            />
          ),
        ),
      )}
      {chart.periods.map((period, index) =>
        count <= 6 || (count - 1 - index) % 2 === 0 ? (
          <text key={period} x={x(index)} y={height - 6} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
            {formatPeriod(period).replace(/ \d{2}(\d{2})$/, " $1")}
          </text>
        ) : null,
      )}
      {active !== null ? <line x1={x(active)} x2={x(active)} y1={top} y2={top + innerHeight} stroke="var(--muted-foreground)" strokeWidth={0.75} strokeDasharray="2 2" /> : null}
      {chart.periods.map((period, index) => (
        <rect
          key={`hit-${period}`}
          x={left + band * index}
          y={top}
          width={band}
          height={innerHeight}
          fill="transparent"
          {...hoverProps(index, tooltipText(chart, index), onActivate)}
        />
      ))}
    </svg>
  );
}

function Row({ children, index, label, active, onActivate }: { children: ReactNode; index: number; label: string; active: number | null; onActivate: Activate }) {
  return (
    <li
      {...hoverProps(index, label, onActivate)}
      className={["rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active === index ? "bg-muted/60" : ""].join(" ")}
    >
      {children}
    </li>
  );
}

function BarList({ chart, active, onActivate }: { chart: Extract<GovernanceChart, { kind: "ranking" | "stages" }>; active: number | null; onActivate: Activate }) {
  const max = Math.max(1, ...chart.items.map((item) => item.value));
  return (
    <ol className="space-y-1.5">
      {chart.items.map((item, index) => (
        <Row key={`${item.label}-${index}`} index={index} label={tooltipText(chart, index)} active={active} onActivate={onActivate}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-semibold text-foreground">{chart.kind === "stages" ? `${index + 1}. ` : ""}{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatValue(item.value, chart.unit)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full" style={{ width: `${(item.value / max) * 100}%`, background: CHART_PALETTE[0] }} />
          </div>
        </Row>
      ))}
    </ol>
  );
}

function CompositionChart({ chart, active, onActivate }: { chart: Extract<GovernanceChart, { kind: "composition" }>; active: number | null; onActivate: Activate }) {
  const colors = seriesColors(chart.parts.map((part) => part.key));
  const max = Math.max(1, ...chart.items.map((item) => item.values.reduce((sum, value) => sum + value, 0)));
  return (
    <ol className="space-y-1.5">
      {chart.items.map((item, index) => {
        const total = item.values.reduce((sum, value) => sum + value, 0);
        return (
          <Row key={`${item.label}-${index}`} index={index} label={tooltipText(chart, index)} active={active} onActivate={onActivate}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-semibold text-foreground">{item.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatValue(total, chart.unit)}</span>
            </div>
            <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-muted" style={{ width: `${(total / max) * 100}%` }}>
              {chart.parts.map((part, partIndex) => (
                <div key={part.key} style={{ width: total ? `${((item.values[partIndex] ?? 0) / total) * 100}%` : "0%", background: colors[part.key] }} data-part={part.key} />
              ))}
            </div>
          </Row>
        );
      })}
    </ol>
  );
}

function TargetChart({ chart, active, onActivate }: { chart: Extract<GovernanceChart, { kind: "target" }>; active: number | null; onActivate: Activate }) {
  const max = Math.max(1, ...chart.items.flatMap((item) => [item.actual, item.target]));
  return (
    <ol className="space-y-1.5">
      {chart.items.map((item, index) => (
        <Row key={`${item.label}-${index}`} index={index} label={tooltipText(chart, index)} active={active} onActivate={onActivate}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-semibold text-foreground">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatValue(item.actual, chart.unit)} / {formatValue(item.target, chart.unit)}</span>
          </div>
          <div className="relative mt-1 h-2.5 rounded-full bg-muted">
            <div className="h-2.5 rounded-full" style={{ width: `${(item.actual / max) * 100}%`, background: CHART_PALETTE[0] }} />
            <span aria-hidden="true" className="absolute -top-0.5 h-3.5 w-0.5 rounded bg-foreground" style={{ left: `calc(${(item.target / max) * 100}% - 1px)` }} />
          </div>
        </Row>
      ))}
    </ol>
  );
}
