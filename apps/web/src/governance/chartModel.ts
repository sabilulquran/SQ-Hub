import type { GovernanceChart, GovernanceTrend, GovernanceUnit } from "@/types";

/**
 * One categorical palette in fixed order, taken from the SQ Core design system C category
 * colours (docs/design/sq-core-design-system-c.md). The CSS variables switch for dark mode.
 */
export const CHART_PALETTE = [
  "var(--cat-attendance)",
  "var(--cat-leave)",
  "var(--cat-service)",
  "var(--cat-task)",
  "var(--cat-pay)",
] as const;

function slotFor(key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % CHART_PALETTE.length;
}

/**
 * A series colour follows its key, never its position, so a series keeps its colour when
 * another series is absent (HUB-IMPL-021 AC 14). Keys that collide inside one chart take the
 * next free colour, resolved in key order so the result does not depend on input order.
 */
export function seriesColors(keys: string[]): Record<string, string> {
  const colors: Record<string, string> = {};
  const used = new Set<number>();
  for (const key of [...keys].sort()) {
    let slot = slotFor(key);
    for (let step = 0; step < CHART_PALETTE.length && used.has(slot); step += 1) slot = (slot + 1) % CHART_PALETTE.length;
    used.add(slot);
    colors[key] = CHART_PALETTE[slot]!;
  }
  return colors;
}

const integer = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

export function formatValue(value: number | null, unit?: GovernanceUnit | "poin"): string {
  if (value === null) return "Belum tersedia";
  const number = Number.isInteger(value) ? integer.format(value) : decimal.format(value);
  switch (unit) {
    case "persen":
      return `${number}%`;
    case "rupiah":
      return `Rp${number}`;
    case undefined:
      return number;
    default:
      return `${number} ${unit}`;
  }
}

export type ChangeTone = "success" | "warning" | "neutral";

export function changeTone(change: NonNullable<GovernanceTrend["change"]>): ChangeTone {
  if (!change.good || change.direction === "flat") return "neutral";
  return change.direction === change.good ? "success" : "warning";
}

export function formatChange(change: NonNullable<GovernanceTrend["change"]>): string {
  const sign = change.direction === "up" ? "+" : change.direction === "down" ? "−" : "±";
  return `${sign}${formatValue(Math.abs(change.value), change.unit)}`;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function formatPeriod(period: string): string {
  const [year, month] = period.split("-");
  const name = monthNames[Number(month) - 1];
  return name ? `${name} ${year}` : period;
}

export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  mark: "line" | "bar" | "marker";
}

/** Legend whenever a chart has two or more series. */
export function legendFor(chart: GovernanceChart): LegendEntry[] {
  if (chart.kind === "trend") {
    if (chart.series.length < 2) return [];
    const colors = seriesColors(chart.series.map((series) => series.key));
    return chart.series.map((series) => ({ key: series.key, label: series.label, color: colors[series.key]!, mark: series.mark }));
  }
  if (chart.kind === "composition") {
    const colors = seriesColors(chart.parts.map((part) => part.key));
    return chart.parts.map((part) => ({ key: part.key, label: part.label, color: colors[part.key]!, mark: "bar" }));
  }
  if (chart.kind === "target") {
    return [
      { key: "actual", label: "Realisasi", color: CHART_PALETTE[0], mark: "bar" },
      { key: "target", label: "Target", color: "var(--foreground)", mark: "marker" },
    ];
  }
  return [];
}

export interface ChartTable {
  columns: string[];
  rows: Array<{ label: string; cells: string[] }>;
}

/** "Lihat tabel": the same values as the chart, so nothing relies on colour alone. */
export function tableFor(chart: GovernanceChart): ChartTable {
  switch (chart.kind) {
    case "trend":
      return {
        columns: ["Periode", ...chart.series.map((series) => series.label)],
        rows: chart.periods.map((period, index) => ({
          label: formatPeriod(period),
          cells: chart.series.map((series) => formatValue(series.values[index] ?? null, chart.unit)),
        })),
      };
    case "ranking":
    case "stages":
      return {
        columns: [chart.kind === "stages" ? "Tahap" : "Kelompok", "Nilai"],
        rows: chart.items.map((item) => ({ label: item.label, cells: [formatValue(item.value, chart.unit)] })),
      };
    case "composition":
      return {
        columns: ["Kelompok", ...chart.parts.map((part) => part.label), "Jumlah"],
        rows: chart.items.map((item) => ({
          label: item.label,
          cells: [
            ...item.values.map((value) => formatValue(value, chart.unit)),
            formatValue(item.values.reduce((sum, value) => sum + value, 0), chart.unit),
          ],
        })),
      };
    case "target":
      return {
        columns: ["Kelompok", "Realisasi", "Target"],
        rows: chart.items.map((item) => ({
          label: item.label,
          cells: [formatValue(item.actual, chart.unit), formatValue(item.target, chart.unit)],
        })),
      };
  }
}

/** Hover tooltip for one row/period: exactly the values of the matching table row. */
export function tooltipFor(chart: GovernanceChart, index: number): { title: string; lines: string[] } | null {
  const table = tableFor(chart);
  const row = table.rows[index];
  if (!row) return null;
  return {
    title: row.label,
    lines: row.cells.map((cell, cellIndex) => `${table.columns[cellIndex + 1]}: ${cell}`),
  };
}

export interface LineSegment {
  points: Array<{ index: number; value: number }>;
}

/** Splits a line at null points: a missing value leaves a gap, never a zero. */
export function lineSegments(values: Array<number | null>): LineSegment[] {
  const segments: LineSegment[] = [];
  let current: LineSegment | null = null;
  values.forEach((value, index) => {
    if (value === null) {
      current = null;
      return;
    }
    if (!current) {
      current = { points: [] };
      segments.push(current);
    }
    current.points.push({ index, value });
  });
  return segments;
}

/** A rounded upper bound for a value axis that starts at zero. */
export function niceMax(values: number[]): number {
  const max = Math.max(0, ...values);
  if (max === 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => max <= candidate * magnitude) ?? 10;
  return step * magnitude;
}
