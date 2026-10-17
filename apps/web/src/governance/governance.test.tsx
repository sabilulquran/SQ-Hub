import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountMenu } from "@/components/AccountMenu";
import { AppLauncher } from "@/components/AppLauncher";
import { MobileNavigation } from "@/components/MobileNavigation";
import { navigationItems } from "@/components/shellNavigation";
import { emptyGovernanceFixture, governanceFixture, governanceWorkspaceFixture } from "@/dev/governanceFixture";
import {
  CHART_PALETTE,
  changeTone,
  formatValue,
  legendFor,
  lineSegments,
  seriesColors,
  tableFor,
  tooltipFor,
} from "@/governance/chartModel";
import { GovernanceChartView } from "@/governance/GovernanceChartView";
import { GovernancePageView } from "@/governance/GovernancePage";
import { resolveHubRoute } from "@/routes";
import type { GovernanceChart, GovernanceSummary } from "@/types";

const charts: GovernanceChart[] = governanceFixture.cards.flatMap((card) =>
  card.state === "ready" ? card.summary.charts ?? [] : [],
);

describe("Chart model (HUB-IMPL-021 §3 chart rules)", () => {
  it("covers all five chart kinds in the preview data", () => {
    expect(new Set(charts.map((chart) => chart.kind))).toEqual(new Set(["trend", "ranking", "composition", "stages", "target"]));
  });

  it("shows the same values in the tooltip and in Lihat tabel for every kind (AC 12)", () => {
    for (const chart of charts) {
      const table = tableFor(chart);
      table.rows.forEach((row, index) => {
        const tooltip = tooltipFor(chart, index)!;
        expect(tooltip.title).toBe(row.label);
        expect(tooltip.lines).toEqual(row.cells.map((cell, cellIndex) => `${table.columns[cellIndex + 1]}: ${cell}`));
      });
    }
  });

  it("keeps a series colour when another series is absent (AC 14)", () => {
    const both = seriesColors(["active", "joined"]);
    expect(seriesColors(["joined"]).joined).toBe(both.joined);
    expect(seriesColors(["active"]).active).toBe(both.active);
    expect(seriesColors(["joined", "active"])).toEqual(both);
    expect(new Set(Object.values(seriesColors(["good", "minor", "major"]))).size).toBe(3);
    for (const color of Object.values(both)) expect(CHART_PALETTE).toContain(color);
  });

  it("leaves a gap for a null point instead of drawing zero", () => {
    expect(lineSegments([1, 2, null, 4, 5]).map((segment) => segment.points.map((point) => point.index))).toEqual([[0, 1], [3, 4]]);
    expect(formatValue(null, "orang")).toBe("Belum tersedia");
  });

  it("formats units and colours a change by its good direction", () => {
    expect(formatValue(182, "orang")).toBe("182 orang");
    expect(formatValue(86.4, "persen")).toBe("86,4%");
    expect(formatValue(1500000, "rupiah")).toBe("Rp1.500.000");
    expect(changeTone({ value: 3, unit: "orang", direction: "up", good: "up" })).toBe("success");
    expect(changeTone({ value: 1, unit: "poin", direction: "down", good: "up" })).toBe("warning");
    expect(changeTone({ value: 1, unit: "poin", direction: "down" })).toBe("neutral");
  });

  it("shows a legend whenever a chart has two or more series", () => {
    for (const chart of charts) {
      const expected = chart.kind === "trend" ? chart.series.length >= 2 : chart.kind === "composition" || chart.kind === "target";
      expect(legendFor(chart).length > 0).toBe(expected);
    }
  });
});

describe("Chart rendering (AC 12)", () => {
  it("draws every kind from contract data alone, with hover targets and a Lihat tabel control", () => {
    for (const chart of charts) {
      const html = renderToStaticMarkup(<GovernanceChartView chart={chart} />);
      expect(html).toContain(`data-chart-kind="${chart.kind}"`);
      expect(html).toContain("Lihat tabel");
      expect(html).toContain('tabindex="0"');
      const firstTooltip = tooltipFor(chart, 0)!;
      expect(html).toContain(firstTooltip.title);
    }
  });

  it("renders the table view with the same rows", () => {
    const chart = charts.find((item) => item.kind === "composition")!;
    const html = renderToStaticMarkup(<GovernanceChartView chart={chart} initialTable />);
    expect(html).toContain("<table");
    for (const row of tableFor(chart).rows) {
      expect(html).toContain(row.label);
      for (const cell of row.cells) expect(html).toContain(cell);
    }
  });
});

describe("Ringkasan Yayasan page (HUB-IMPL-021 §5, AC 11)", () => {
  const ready = { status: "ready" as const, snapshot: governanceFixture };

  it("has its own route", () => {
    expect(resolveHubRoute("/yayasan")).toBe("yayasan");
  });

  it("shows greeting, organ badge, data time, headline strip, sections, attention and Aplikasi Anda", () => {
    const html = renderToStaticMarkup(<GovernancePageView workspace={governanceWorkspaceFixture} state={ready} />);
    expect(html).toContain("Assalamu&#x27;alaikum, Pengurus Sintetis");
    expect(html).toContain("Pengurus Yayasan");
    expect(html).toContain("Ketua Pengurus");
    expect(html).toContain("Data per");
    expect(html).toContain('aria-label="Angka utama"');
    expect(html).toContain("grid-cols-2 gap-3 lg:grid-cols-4");
    expect(html).toContain("Perlu perhatian");
    expect(html).toContain("Permintaan formasi menunggu persetujuan Yayasan");
    expect(html).toContain('href="https://karir.example/yayasan/requests"');
    expect(html).toContain("Lihat rincian");
    expect(html).toContain('href="https://hcis.example/board"');
    expect(html).toContain("Aplikasi Anda");
    expect(html).toContain("Belum tersedia");
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('data-tone="success"');
  });

  it("lists a failed application in Perlu perhatian with a retry button", () => {
    const html = renderToStaticMarkup(<GovernancePageView workspace={governanceWorkspaceFixture} state={ready} onRetryCard={() => undefined} />);
    const attention = html.slice(html.indexOf("attention-heading"));
    expect(attention).toContain("Keuangan");
    expect(attention).toContain("Tidak dapat dimuat");
    expect(attention).toContain("Coba lagi");
  });

  it("explains the empty state and still shows Aplikasi Anda", () => {
    const html = renderToStaticMarkup(
      <GovernancePageView workspace={governanceWorkspaceFixture} state={{ status: "ready", snapshot: emptyGovernanceFixture }} />,
    );
    expect(html).toContain("Belum ada aplikasi yang menghubungkan ringkasan untuk akun Anda");
    expect(html).toContain("Aplikasi Anda");
    expect(html).not.toContain("Angka utama");
  });

  it("has loading, error and re-authentication states", () => {
    expect(renderToStaticMarkup(<GovernancePageView workspace={governanceWorkspaceFixture} state={{ status: "loading" }} />)).toContain("Memuat Ringkasan Yayasan");
    expect(renderToStaticMarkup(<GovernancePageView workspace={governanceWorkspaceFixture} state={{ status: "error" }} onReload={() => undefined} />)).toContain("Coba lagi");
    expect(renderToStaticMarkup(<GovernancePageView workspace={governanceWorkspaceFixture} state={{ status: "reauth" }} />)).toContain("Masuk ulang diperlukan");
  });

  it("renders strings as text, never as HTML", () => {
    const hostile = governanceFixture.cards[0]!.state === "ready" ? governanceFixture.cards[0]!.summary : null;
    const summary: GovernanceSummary = { ...hostile!, title: "<img src=x onerror=alert(1)>" };
    const html = renderToStaticMarkup(
      <GovernancePageView
        workspace={governanceWorkspaceFixture}
        state={{ status: "ready", snapshot: { ...governanceFixture, cards: [{ applicationKey: "hcis", state: "ready", summary }] } }}
      />,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("orders the headline strip by card order and caps it at four", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      applicationKey: `app-${index}`,
      state: "ready" as const,
      summary: { ...(governanceFixture.cards[0] as { summary: GovernanceSummary }).summary, applicationKey: `app-${index}`, title: `Modul ${index}` },
    }));
    const html = renderToStaticMarkup(
      <GovernancePageView workspace={governanceWorkspaceFixture} state={{ status: "ready", snapshot: { ...governanceFixture, cards: many } }} />,
    );
    const strip = html.slice(html.indexOf('aria-label="Angka utama"'), html.indexOf("</section>", html.indexOf('aria-label="Angka utama"')));
    expect(strip).toContain("Modul 0");
    expect(strip).toContain("Modul 3");
    expect(strip).not.toContain("Modul 4");
  });
});

describe("Shell for members", () => {
  it("offers Ringkasan Yayasan first in the sidebar, launcher and phone navigation", () => {
    expect(navigationItems("workspace", { governanceView: true }).map((item) => item.href)).toEqual(["/yayasan", "/", "/apps", "/account"]);
    expect(navigationItems("workspace").map((item) => item.href)).toEqual(["/", "/apps", "/account"]);

    const launcher = renderToStaticMarkup(<AppLauncher applications={governanceWorkspaceFixture.applications} governanceView previewOpen />);
    expect(launcher.indexOf("Ringkasan Yayasan")).toBeLessThan(launcher.indexOf("Beranda semua aplikasi Anda"));

    const phone = renderToStaticMarkup(<MobileNavigation space="workspace" active="yayasan" platformAdministration={false} governanceView />);
    expect(phone).toContain('href="/yayasan"');
    expect(phone).toContain("Ringkasan");
    expect(phone).not.toContain("Lainnya");
  });

  it("shows the organ badge in the account menu", () => {
    const menu = renderToStaticMarkup(<AccountMenu user={governanceWorkspaceFixture.user} onLogout={() => undefined} previewOpen />);
    expect(menu).toContain("Pengurus Yayasan");
    expect(menu).not.toContain(">Pegawai<");
  });
});
