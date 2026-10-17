// Synthetic governance summaries (contract v1). Figures are invented test data.
export const periods = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

export function summaryFor(applicationKey: string, origin: string, overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    applicationKey,
    title: applicationKey === "hcis" ? "SDM" : "Aset",
    dataAsOf: "2026-10-17T00:00:00+07:00",
    metrics: [
      {
        key: "active",
        label: "Pegawai aktif",
        value: 182,
        unit: "orang",
        headline: true,
        trend: {
          points: periods.map((period, index) => ({ period, value: index === 2 ? null : 170 + index * 2 })),
          change: { value: 2, unit: "orang", direction: "up", good: "up" },
        },
      },
      { key: "contracts", label: "Kontrak berakhir 30 hari", value: 4, unit: "orang", tone: "attention" },
      { key: "payroll", label: "Belum tersedia", value: null },
    ],
    charts: [
      {
        key: "headcount",
        kind: "trend",
        title: "Pegawai aktif per bulan",
        unit: "orang",
        dataAsOf: "2026-10-17T00:00:00+07:00",
        periods,
        series: [
          { key: "active", label: "Aktif", mark: "line", values: [170, 172, null, 176, 178, 182] },
          { key: "joined", label: "Masuk", mark: "bar", values: [3, 2, 4, 1, 2, 5] },
        ],
      },
      {
        key: "by-unit",
        kind: "ranking",
        title: "Pegawai per unit",
        unit: "orang",
        dataAsOf: "2026-10-17T00:00:00+07:00",
        items: [
          { label: "SD", value: 60 },
          { label: "SMP", value: 50 },
          { label: "Lainnya", value: 72 },
        ],
      },
    ],
    attention: [{ label: "Kontrak berakhir dalam 30 hari", count: 4, href: `${origin}/board/contracts` }],
    detailUrl: `${origin}/board`,
    ...overrides,
  };
}

export const compositionChart = {
  key: "condition",
  kind: "composition",
  title: "Kondisi aset per kategori",
  unit: "unit",
  dataAsOf: "2026-10-17T00:00:00+07:00",
  parts: [
    { key: "good", label: "Baik" },
    { key: "minor", label: "Rusak ringan" },
    { key: "major", label: "Rusak berat" },
  ],
  items: [
    { label: "Elektronik", values: [40, 5, 2] },
    { label: "Mebel", values: [120, 10, 4] },
  ],
};

export const stagesChart = {
  key: "selection",
  kind: "stages",
  title: "Kandidat per tahap seleksi",
  unit: "orang",
  dataAsOf: "2026-10-17T00:00:00+07:00",
  items: [
    { label: "Melamar", value: 40 },
    { label: "Wawancara", value: 12 },
    { label: "Diterima", value: 3 },
  ],
};

export const targetChart = {
  key: "budget",
  kind: "target",
  title: "Formasi terisi per unit",
  unit: "orang",
  dataAsOf: "2026-10-17T00:00:00+07:00",
  items: [
    { label: "SD", target: 30, actual: 28 },
    { label: "SMP", target: 20, actual: 21 },
  ],
};
