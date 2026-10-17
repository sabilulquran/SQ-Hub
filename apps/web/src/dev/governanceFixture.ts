import type { GovernanceSnapshot, WorkspaceSnapshot } from "@/types";

import { workspaceFixture } from "@/dev/workspaceFixture";

// Synthetic preview data only. Figures are invented and describe no real unit or person.
const periods = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const asOf = "2026-10-17T07:00:00+07:00";

export const governanceWorkspaceFixture: WorkspaceSnapshot = {
  ...workspaceFixture,
  user: { displayName: "Pengurus Sintetis", initials: "PS", organ: "pengurus" },
  capabilities: { platformAdministration: false, governanceView: true },
};

export const governanceFixture: GovernanceSnapshot = {
  membership: { organ: "pengurus", positionLabel: "Ketua Pengurus" },
  generatedAt: asOf,
  cards: [
    {
      applicationKey: "hcis",
      state: "ready",
      summary: {
        contractVersion: 1,
        applicationKey: "hcis",
        title: "SDM",
        dataAsOf: asOf,
        detailUrl: "https://hcis.example/board",
        metrics: [
          {
            key: "active",
            label: "Pegawai aktif",
            value: 181,
            unit: "orang",
            headline: true,
            trend: {
              points: periods.map((period, index) => ({ period, value: index === 4 ? null : 168 + index + (index % 3) })),
              change: { value: 3, unit: "orang", direction: "up", good: "up" },
            },
          },
          { key: "contracts", label: "Kontrak berakhir 30 hari", value: 4, unit: "orang", tone: "attention" },
          { key: "units", label: "Unit organisasi", value: 14, unit: "unit" },
        ],
        charts: [
          {
            key: "headcount",
            kind: "trend",
            title: "Pegawai aktif per bulan",
            unit: "orang",
            dataAsOf: asOf,
            periods,
            series: [
              { key: "active", label: "Pegawai aktif", mark: "line", values: periods.map((_, index) => (index === 4 ? null : 168 + index + (index % 3))) },
              { key: "joined", label: "Pegawai masuk", mark: "bar", values: [3, 2, 4, 1, 0, 2, 5, 3, 2, 1, 4, 3] },
            ],
          },
          {
            key: "by-unit",
            kind: "ranking",
            title: "Pegawai per unit",
            unit: "orang",
            dataAsOf: asOf,
            items: [
              { label: "SD", value: 58 },
              { label: "SMP", value: 46 },
              { label: "SMA", value: 38 },
              { label: "Asrama", value: 22 },
              { label: "Lainnya", value: 18 },
            ],
          },
        ],
        attention: [{ label: "Kontrak berakhir dalam 30 hari", count: 4, href: "https://hcis.example/board/contracts" }],
      },
    },
    {
      applicationKey: "aset-sq",
      state: "ready",
      summary: {
        contractVersion: 1,
        applicationKey: "aset-sq",
        title: "Aset",
        dataAsOf: "2026-10-16T17:00:00+07:00",
        detailUrl: "https://aset.example/governance",
        metrics: [
          {
            key: "good",
            label: "Aset kondisi baik",
            value: 86.4,
            unit: "persen",
            headline: true,
            trend: {
              points: periods.slice(6).map((period, index) => ({ period, value: 84 + index * 0.5 })),
              change: { value: 0.8, unit: "poin", direction: "down", good: "up" },
            },
          },
          { key: "repair", label: "Menunggu perbaikan", value: 12, unit: "item", tone: "attention" },
          { key: "value", label: "Nilai buku", value: null },
        ],
        charts: [
          {
            key: "condition",
            kind: "composition",
            title: "Kondisi aset per kategori",
            unit: "unit",
            dataAsOf: "2026-10-16T17:00:00+07:00",
            parts: [
              { key: "good", label: "Baik" },
              { key: "minor", label: "Rusak ringan" },
              { key: "major", label: "Rusak berat" },
            ],
            items: [
              { label: "Elektronik", values: [140, 12, 4] },
              { label: "Mebel", values: [320, 30, 9] },
              { label: "Kendaraan", values: [6, 1, 0] },
            ],
          },
        ],
      },
    },
    {
      applicationKey: "karir-sq",
      state: "ready",
      summary: {
        contractVersion: 1,
        applicationKey: "karir-sq",
        title: "Rekrutmen",
        dataAsOf: asOf,
        detailUrl: "https://karir.example/yayasan",
        metrics: [
          { key: "open", label: "Lowongan terbuka", value: 5, unit: "item", headline: true },
          { key: "requests", label: "Permintaan formasi menunggu", value: 2, unit: "item", tone: "attention" },
        ],
        charts: [
          {
            key: "selection",
            kind: "stages",
            title: "Kandidat per tahap seleksi",
            unit: "orang",
            dataAsOf: asOf,
            items: [
              { label: "Melamar", value: 64 },
              { label: "Seleksi berkas", value: 31 },
              { label: "Wawancara", value: 12 },
              { label: "Diterima", value: 4 },
            ],
          },
          {
            key: "formation",
            kind: "target",
            title: "Formasi terisi per unit",
            unit: "orang",
            dataAsOf: asOf,
            items: [
              { label: "SD", target: 60, actual: 58 },
              { label: "SMP", target: 44, actual: 46 },
              { label: "SMA", target: 40, actual: 38 },
            ],
          },
        ],
        attention: [{ label: "Permintaan formasi menunggu persetujuan Yayasan", count: 2, href: "https://karir.example/yayasan/requests" }],
      },
    },
    { applicationKey: "keuangan", state: "failed", name: "Keuangan" },
  ],
};

export const emptyGovernanceFixture: GovernanceSnapshot = { ...governanceFixture, cards: [] };
