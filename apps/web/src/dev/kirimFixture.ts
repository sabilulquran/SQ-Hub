import type { AntreanState } from "@/kirim/AntreanPage";
import type { NomorState } from "@/kirim/NomorPage";

/** Synthetic Kirim SQ data for previews and tests; numbers are masked, no message bodies exist here. */
export const kirimNomorFixture: NomorState = {
  status: "ready",
  consumers: [
    { nama: "hcis", client_id: "hcis-api", webhook_url: "https://hcis.sabilulquran.or.id/api/kirim/webhook", kuota_harian: 500, aktif: true },
    { nama: "spmb", client_id: "spmb-api", webhook_url: "http://127.0.0.1:3303/kirim/webhook", kuota_harian: 500, aktif: true },
  ],
  list: {
    peringatan: { terputus: ["spmb"], webhook_habis: 2 },
    devices: [
      {
        kode: "hcis", label: "HCIS", pemilik: "hcis", provider: "log", provider_ref: null, status: "tersambung",
        nomor_tersamar: null, antrean_dijeda: false, rate_per_menit: 10, jam_kirim_mulai: "06:00", jam_kirim_selesai: "21:00",
        status_berubah_at: "2026-10-17T02:00:00.000Z", antrean: { antre: 3, gagal_hari_ini: 0 },
      },
      {
        kode: "spmb", label: "SPMB resmi", pemilik: "spmb", provider: "jalurpesan", provider_ref: "spmb", status: "terputus",
        nomor_tersamar: "+62 812-••••-7890", antrean_dijeda: false, rate_per_menit: 10, jam_kirim_mulai: "06:00", jam_kirim_selesai: "21:00",
        status_berubah_at: "2026-10-17T05:30:00.000Z", antrean: { antre: 12, gagal_hari_ini: 1 },
      },
    ],
  },
};

export const kirimAntreanFixture: AntreanState = {
  status: "ready",
  devices: ["hcis", "spmb"],
  summary: {
    per_nomor: [
      { nomor: "hcis", antre: 3, diserahkan: 40, terkirim: 0, dibaca: 0, gagal: 0, dibatalkan: 0 },
      { nomor: "spmb", antre: 12, diserahkan: 5, terkirim: 31, dibaca: 18, gagal: 1, dibatalkan: 1 },
    ],
    webhook_habis: 2,
    ukuran: { tabel_kirim_messages: 3_400_000, tabel_kirim_media: 120_000, folder_media: 48_000_000, disk_bebas: 22_000_000_000 },
  },
  queue: {
    page: 1,
    has_more: false,
    items: [
      { id: "7a3d5f40-0000-4000-8000-000000000001", pemakai: "spmb", ref: "spmb:lead-123:link:v1", jenis: "notifikasi", nomor: "spmb", tujuan: "+62 812-••••-7890", status: "gagal", percobaan: 4, error_code: "engine_unavailable", dry_run: false, created_at: "2026-10-17T03:00:00.000Z", updated_at: "2026-10-17T03:40:00.000Z" },
      { id: "7a3d5f40-0000-4000-8000-000000000002", pemakai: "spmb", ref: "spmb:lead-124:link:v1", jenis: "notifikasi", nomor: "spmb", tujuan: "+62 813-••••-1122", status: "gagal", percobaan: 1, error_code: "optout", dry_run: false, created_at: "2026-10-17T03:05:00.000Z", updated_at: "2026-10-17T03:05:00.000Z" },
      { id: "7a3d5f40-0000-4000-8000-000000000003", pemakai: "keluarga", ref: "kel:otp:9", jenis: "kode", nomor: "spmb", tujuan: "+62 857-••••-3344", status: "antre", percobaan: 0, error_code: null, dry_run: false, created_at: "2026-10-17T03:10:00.000Z", updated_at: "2026-10-17T03:10:00.000Z" },
      { id: "7a3d5f40-0000-4000-8000-000000000004", pemakai: "hcis", ref: "hcis:slip:2026-10", jenis: "notifikasi", nomor: "hcis", tujuan: "+62 821-••••-5566", status: "diserahkan", percobaan: 1, error_code: null, dry_run: true, created_at: "2026-10-17T03:12:00.000Z", updated_at: "2026-10-17T03:12:05.000Z" },
    ],
  },
};
