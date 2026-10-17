import { describe, expect, it } from "vitest";

import { validateGovernanceSummary } from "../src/modules/governance/contract.js";
import { compositionChart, periods, stagesChart, summaryFor, targetChart } from "./governance.fixture.js";

const origin = "https://hcis.example.test";
const expected = { applicationKey: "hcis", canonicalUrl: `${origin}/` };

describe("Governance summary contract v1", () => {
  it("accepts a full summary with every chart kind", () => {
    for (const chart of [compositionChart, stagesChart, targetChart]) {
      const result = validateGovernanceSummary(summaryFor("hcis", origin, { charts: [chart] }), expected);
      expect(result.ok && result.summary.charts?.[0]?.kind).toBe(chart.kind);
    }
    const result = validateGovernanceSummary(summaryFor("hcis", origin), expected);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.charts?.map((chart) => chart.kind)).toEqual(["trend", "ranking"]);
    expect(result.summary.metrics[0]?.trend?.points).toHaveLength(6);
  });

  it("drops an invalid chart on its own and keeps the rest of the card (AC 13)", () => {
    const wrongKind = { ...compositionChart, kind: "pie" };
    const tooMany = { ...stagesChart, items: Array.from({ length: 7 }, (_, index) => ({ label: `T${index}`, value: index })) };
    const mismatched = {
      ...summaryFor("hcis", origin).charts[0],
      series: [{ key: "active", label: "Aktif", mark: "line", values: [1, 2, 3] }],
    };
    for (const chart of [wrongKind, tooMany, mismatched, { ...compositionChart, items: [{ label: "X", values: [1, 2] }] }]) {
      const result = validateGovernanceSummary(summaryFor("hcis", origin, { charts: [chart, targetChart] }), expected);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.summary.charts?.map((item) => item.kind)).toEqual(["target"]);
      expect(result.summary.metrics).toHaveLength(3);
    }
  });

  it("drops only a non-conforming sparkline, not the metric", () => {
    const body = summaryFor("hcis", origin);
    body.metrics[0] = { ...body.metrics[0]!, trend: { points: periods.slice(0, 3).map((period) => ({ period, value: 1 })) } };
    const result = validateGovernanceSummary(body, expected);
    expect(result.ok && result.summary.metrics[0]?.trend).toBeUndefined();
    expect(result.ok && result.summary.metrics[0]?.value).toBe(182);
  });

  it("drops the card when applicationKey does not match (AC 6)", () => {
    expect(validateGovernanceSummary(summaryFor("aset", origin), expected)).toEqual({ ok: false, reason: "application_mismatch" });
  });

  it("drops the card when detailUrl or any attention link is on another origin (AC 6)", () => {
    expect(validateGovernanceSummary(summaryFor("hcis", origin, { detailUrl: "https://evil.example.test/board" }), expected))
      .toEqual({ ok: false, reason: "foreign_origin" });
    expect(validateGovernanceSummary(summaryFor("hcis", origin, {
      attention: [{ label: "Tautan", count: 1, href: "https://hcis.example.test.evil.example/x" }],
    }), expected)).toEqual({ ok: false, reason: "foreign_origin" });
    expect(validateGovernanceSummary(summaryFor("hcis", origin, { detailUrl: "javascript:alert(1)" }), expected).ok).toBe(false);
  });

  it("rejects bodies outside the contract limits", () => {
    const tooManyMetrics = summaryFor("hcis", origin, {
      metrics: Array.from({ length: 7 }, (_, index) => ({ key: `m${index}`, label: "Angka", value: index })),
    });
    const twoHeadlines = summaryFor("hcis", origin, {
      metrics: [
        { key: "a", label: "A", value: 1, headline: true },
        { key: "b", label: "B", value: 2, headline: true },
      ],
    });
    for (const body of [tooManyMetrics, twoHeadlines, summaryFor("hcis", origin, { contractVersion: 2 }), "<html>", null]) {
      expect(validateGovernanceSummary(body, expected)).toEqual({ ok: false, reason: "invalid_body" });
    }
  });

  it("strips anything beyond the contract, such as colours or markup options", () => {
    const body = summaryFor("hcis", origin, { theme: { color: "#ff0000" } });
    (body.charts[0] as Record<string, unknown>).color = "#ff0000";
    const result = validateGovernanceSummary(body, expected);
    expect(JSON.stringify(result)).not.toContain("#ff0000");
  });
});
