import { z } from "zod";

/**
 * Governance summary contract v1 (HUB-IMPL-021 §3). Unknown fields are stripped, so nothing an
 * application adds beyond the contract (colours, markup, options) ever reaches the browser.
 */

export const UNITS = ["orang", "unit", "item", "persen", "rupiah", "hari"] as const;
const unit = z.enum(UNITS);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
const label = z.string().trim().min(1).max(120);
const title = z.string().trim().min(1).max(80);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const timestamp = z.string().datetime({ offset: true });
const finite = z.number().finite();
const count = finite.nonnegative();

function ascendingPeriods(periods: string[]): boolean {
  return periods.every((value, index) => index === 0 || value > periods[index - 1]!);
}

function uniqueKeys(items: Array<{ key: string }>): boolean {
  return new Set(items.map((item) => item.key)).size === items.length;
}

const trendSchema = z
  .object({
    points: z.array(z.object({ period, value: finite.nullable() })).min(6).max(12),
    change: z
      .object({
        value: finite,
        unit: z.union([unit, z.literal("poin")]),
        direction: z.enum(["up", "down", "flat"]),
        good: z.enum(["up", "down"]).optional(),
      })
      .optional(),
  })
  .refine((trend) => ascendingPeriods(trend.points.map((point) => point.period)), "periods must be oldest first");

const metricSchema = z.object({
  key,
  label,
  value: finite.nullable(),
  unit: unit.optional(),
  tone: z.enum(["normal", "attention"]).optional(),
  headline: z.boolean().optional(),
  // Parsed separately: an invalid trend drops only the sparkline, never the metric.
  trend: z.unknown().optional(),
});

const chartBase = { key, title, unit, dataAsOf: timestamp };

const trendChart = z
  .object({
    ...chartBase,
    kind: z.literal("trend"),
    periods: z.array(period).min(6).max(12),
    series: z
      .array(z.object({ key, label, mark: z.enum(["line", "bar"]), values: z.array(finite.nullable()) }))
      .min(1)
      .max(2),
  })
  .refine((chart) => ascendingPeriods(chart.periods), "periods must be oldest first")
  .refine((chart) => uniqueKeys(chart.series), "series keys must be unique")
  .refine((chart) => chart.series.every((series) => series.values.length === chart.periods.length), "one value per period");

const rankingChart = z.object({
  ...chartBase,
  kind: z.literal("ranking"),
  items: z.array(z.object({ label, value: count })).min(1).max(8),
});

const compositionChart = z
  .object({
    ...chartBase,
    kind: z.literal("composition"),
    parts: z.array(z.object({ key, label })).min(2).max(3),
    items: z.array(z.object({ label, values: z.array(count) })).min(1).max(6),
  })
  .refine((chart) => uniqueKeys(chart.parts), "part keys must be unique")
  .refine((chart) => chart.items.every((item) => item.values.length === chart.parts.length), "one value per part");

const stagesChart = z.object({
  ...chartBase,
  kind: z.literal("stages"),
  items: z.array(z.object({ label, value: count })).min(2).max(6),
});

const targetChart = z.object({
  ...chartBase,
  kind: z.literal("target"),
  items: z.array(z.object({ label, target: count, actual: count })).min(1).max(8),
});

const chartSchema = z.union([trendChart, rankingChart, compositionChart, stagesChart, targetChart]);

const summarySchema = z
  .object({
    contractVersion: z.literal(1),
    applicationKey: z.string().min(1).max(63),
    title,
    dataAsOf: timestamp,
    metrics: z.array(z.unknown()).min(1).max(6),
    charts: z.unknown().optional(),
    attention: z
      .array(z.object({ label, count: z.number().int().nonnegative(), href: z.string().url().max(2048) }))
      .max(3)
      .optional(),
    detailUrl: z.string().url().max(2048),
  });

export type GovernanceUnit = (typeof UNITS)[number];
export type GovernanceChart = z.infer<typeof chartSchema>;
export type GovernanceTrend = z.infer<typeof trendSchema>;
export type GovernanceMetric = Omit<z.infer<typeof metricSchema>, "trend"> & { trend?: GovernanceTrend };

export interface GovernanceSummaryV1 {
  contractVersion: 1;
  applicationKey: string;
  title: string;
  dataAsOf: string;
  metrics: GovernanceMetric[];
  charts?: GovernanceChart[];
  attention?: Array<{ label: string; count: number; href: string }>;
  detailUrl: string;
}

export type SummaryValidation =
  | { ok: true; summary: GovernanceSummaryV1 }
  | { ok: false; reason: "invalid_body" | "application_mismatch" | "foreign_origin" };

/**
 * Validates a response against contract v1 for one registered application. Invalid charts and
 * invalid sparklines are dropped on their own; anything else invalid fails the whole card.
 */
export function validateGovernanceSummary(
  body: unknown,
  expected: { applicationKey: string; canonicalUrl: string },
): SummaryValidation {
  const parsed = summarySchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "invalid_body" };

  const metrics: GovernanceMetric[] = [];
  for (const raw of parsed.data.metrics) {
    const metric = metricSchema.safeParse(raw);
    if (!metric.success) return { ok: false, reason: "invalid_body" };
    const { trend: rawTrend, ...rest } = metric.data;
    const trend = rawTrend === undefined ? undefined : trendSchema.safeParse(rawTrend);
    metrics.push(trend?.success ? { ...rest, trend: trend.data } : rest);
  }
  if (!uniqueKeys(metrics)) return { ok: false, reason: "invalid_body" };
  if (metrics.filter((metric) => metric.headline).length > 1) return { ok: false, reason: "invalid_body" };

  if (parsed.data.applicationKey !== expected.applicationKey) return { ok: false, reason: "application_mismatch" };

  const origin = new URL(expected.canonicalUrl).origin;
  const links = [parsed.data.detailUrl, ...(parsed.data.attention ?? []).map((item) => item.href)];
  if (!links.every((link) => sameOrigin(link, origin))) return { ok: false, reason: "foreign_origin" };

  const rawCharts = Array.isArray(parsed.data.charts) ? parsed.data.charts.slice(0, 2) : [];
  const charts: GovernanceChart[] = [];
  for (const raw of rawCharts) {
    const chart = chartSchema.safeParse(raw);
    if (chart.success) charts.push(chart.data);
  }

  return {
    ok: true,
    summary: {
      contractVersion: 1,
      applicationKey: parsed.data.applicationKey,
      title: parsed.data.title,
      dataAsOf: parsed.data.dataAsOf,
      metrics,
      ...(charts.length > 0 ? { charts } : {}),
      ...(parsed.data.attention && parsed.data.attention.length > 0 ? { attention: parsed.data.attention } : {}),
      detailUrl: parsed.data.detailUrl,
    },
  };
}

function sameOrigin(link: string, origin: string): boolean {
  try {
    const url = new URL(link);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}
