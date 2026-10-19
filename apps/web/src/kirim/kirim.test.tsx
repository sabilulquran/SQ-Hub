import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { kirimAntreanFixture, kirimNomorFixture } from "@/dev/kirimFixture";
import { AktivitasView, type AktivitasState } from "@/kirim/AktivitasPage";
import { AntreanView, type AntreanFilter } from "@/kirim/AntreanPage";
import { ImporView, type ImporState } from "@/kirim/ImporPage";
import { JanganHubungiView, type JanganHubungiState, type OptoutFilter } from "@/kirim/JanganHubungiPage";
import { KirimAppView } from "@/kirim/KirimApp";
import { NomorView, PairingContent } from "@/kirim/NomorPage";
import { isKirimHost, resolveKirimRoute } from "@/kirim/routes";

const noop = () => undefined;
const filter: AntreanFilter = { device: "", status: "", page: 1 };
const ready = { status: "ready" as const, context: { displayName: "Kepala HCM" } };

describe("Kirim SQ host routing (KIRIM-IMPL-001 §2, §8)", () => {
  it("serves Kirim SQ only on the kirim. host, with Nomor and Antrean", () => {
    expect(isKirimHost("kirim.sabilulquran.or.id")).toBe(true);
    expect(isKirimHost("hub.sabilulquran.or.id")).toBe(false);
    expect(resolveKirimRoute("/")).toBe("nomor");
    expect(resolveKirimRoute("/nomor/")).toBe("nomor");
    expect(resolveKirimRoute("/antrean")).toBe("antrean");
    expect(resolveKirimRoute("/inbox/spmb")).toBe("not-found");
  });

  it("shows the Kirim SQ lockup and both sections in the shell", () => {
    const html = renderToStaticMarkup(<KirimAppView state={ready} route="nomor" preview={{ nomor: kirimNomorFixture }} onLogout={noop} />);
    expect(html).toContain(">Kirim SQ</p>");
    expect(html).toContain('href="/nomor"');
    expect(html).toContain('href="/antrean"');
    expect(html).toContain("Keluar");
  });

  it("explains a 403 without Application Access or without the kirim_admin role", () => {
    expect(renderToStaticMarkup(<KirimAppView state={{ status: "forbidden", code: "kirim_admin_required" }} route="nomor" />)).toContain(
      "Anda belum ditetapkan sebagai pengelola Kirim SQ",
    );
    expect(renderToStaticMarkup(<KirimAppView state={{ status: "forbidden", code: "kirim_access_denied" }} route="nomor" />)).toContain(
      "Anda belum punya akses aplikasi Kirim SQ",
    );
  });
});

describe("Nomor screen (§8)", () => {
  it("renders loading, error, forbidden and empty states", () => {
    expect(renderToStaticMarkup(<NomorView state={{ status: "loading" }} onOpen={noop} onRetry={noop} />)).toContain('data-state="loading"');
    expect(renderToStaticMarkup(<NomorView state={{ status: "error" }} onOpen={noop} onRetry={noop} />)).toContain("Nomor belum dapat dimuat");
    expect(renderToStaticMarkup(<NomorView state={{ status: "forbidden" }} onOpen={noop} onRetry={noop} />)).toContain("Anda belum ditetapkan sebagai pengelola Kirim SQ");
    const empty = renderToStaticMarkup(
      <NomorView state={{ ...kirimNomorFixture, list: { devices: [], peringatan: { terputus: [], webhook_habis: 0 } } } as typeof kirimNomorFixture} onOpen={noop} onRetry={noop} />,
    );
    expect(empty).toContain("Belum ada nomor");
    expect(empty).not.toContain('role="status"');
  });

  it("shows each number with owner, provider badge, colored status, masked number and queue", () => {
    const html = renderToStaticMarkup(<NomorView state={kirimNomorFixture} onOpen={noop} onRetry={noop} />);
    expect(html).toContain("SPMB resmi");
    expect(html).toContain("milik spmb");
    expect(html).toContain("Uji — tidak mengirim");
    expect(html).toContain("bg-danger-soft text-danger-ink");
    expect(html).toContain("Terputus");
    expect(html).toContain("+62 812-••••-7890");
    expect(html).toContain("12 antre · 1 gagal hari ini");
    expect(html).toContain("Nomor terputus:");
    expect(html).toContain("gagal dikirim ke modul pemakai setelah 8 percobaan");
    expect(html).toContain("Pasang");
    expect(html).toContain("Putuskan");
    expect(html).toContain("Nonaktifkan");
  });

  it("shows a QR with the linking instruction and a pairing code, and confirms the connection", () => {
    const qr = renderToStaticMarkup(<PairingContent view={{ step: "qr", qr: "data:image/png;base64,UVJD", secondsLeft: 118 }} phone="" onPhone={noop} onStart={noop} />);
    expect(qr).toContain('src="data:image/png;base64,UVJD"');
    expect(qr).toContain("WhatsApp → Perangkat tertaut → Tautkan perangkat");
    expect(qr).toContain("118 detik lagi");
    const code = renderToStaticMarkup(<PairingContent view={{ step: "kode", code: "ABCD-EFGH", secondsLeft: 60 }} phone="" onPhone={noop} onStart={noop} />);
    expect(code).toContain("ABCD-EFGH");
    const done = renderToStaticMarkup(<PairingContent view={{ step: "connected", nomor: "+62 812-••••-7890" }} phone="" onPhone={noop} onStart={noop} />);
    expect(done).toContain("Tersambung · +62 812-••••-7890");
  });
});

describe("Antrean screen (§8)", () => {
  it("renders loading, error, forbidden and empty states", () => {
    const view = (state: Parameters<typeof AntreanView>[0]["state"]) =>
      renderToStaticMarkup(<AntreanView state={state} filter={filter} busy={false} actionError={null} onFilter={noop} onRetry={noop} onCancel={noop} onReload={noop} />);
    expect(view({ status: "loading" })).toContain("Memuat antrean");
    expect(view({ status: "error" })).toContain("Antrean belum dapat dimuat");
    expect(view({ status: "forbidden" })).toContain("Anda belum ditetapkan sebagai pengelola Kirim SQ");
    if (kirimAntreanFixture.status !== "ready") throw new Error("fixture");
    expect(view({ ...kirimAntreanFixture, queue: { ...kirimAntreanFixture.queue, items: [] } })).toContain("Antrean kosong");
  });

  it("lists rows with Indonesian error labels and offers retry or cancel only where allowed", () => {
    const html = renderToStaticMarkup(
      <AntreanView state={kirimAntreanFixture} filter={filter} busy={false} actionError={null} onFilter={noop} onRetry={noop} onCancel={noop} onReload={noop} />,
    );
    expect(html).toContain("24 jam terakhir");
    expect(html).toContain("Mesin tidak tersedia");
    expect(html).toContain("Nomor minta tidak dihubungi");
    expect(html).toContain("spmb:lead-123:link:v1");
    expect(html).toContain("+62 812-••••-7890");
    // One retry (engine_unavailable) and none for optout; one cancel for the queued code.
    expect(html.match(/Coba ulang/g)).toHaveLength(1);
    expect(html.match(/Batalkan/g)).toHaveLength(1);
  });
});

describe("Edge defense (§10)", () => {
  it("never proxies the consumer API through the web entry point", async () => {
    const nginx = await readFile(fileURLToPath(new URL("../../nginx.conf", import.meta.url)), "utf8");
    expect(nginx).toMatch(/location \^~ \/api\/internal\/kirim\/ \{\s*return 404;\s*\}/);
    expect(nginx.indexOf("/api/internal/kirim/")).toBeLessThan(nginx.indexOf("location /api/ {"));
  });
});

describe("Privacy in the browser (§12 web)", () => {
  it("never puts QR data or pairing codes into the URL or browser storage", async () => {
    const root = fileURLToPath(new URL(".", import.meta.url));
    for (const name of await readdir(root)) {
      if (name.endsWith(".test.tsx")) continue;
      const source = await readFile(join(root, name), "utf8");
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      expect(source).not.toMatch(/history\.(push|replace)State\([^)]*(qr|pairing|code)/i);
      expect(source).not.toMatch(/searchParams\.set\(\s*["'](qr|pairing|kode)/i);
    }
  });
});

describe("KIRIM-IMPL-002 §12 screens", () => {
  it("routes Jangan hubungi, Aktivitas and Impor riwayat, with four tabs in the shell", () => {
    expect(resolveKirimRoute("/jangan-hubungi")).toBe("jangan-hubungi");
    expect(resolveKirimRoute("/aktivitas/")).toBe("aktivitas");
    expect(resolveKirimRoute("/impor")).toBe("impor");
    const html = renderToStaticMarkup(<KirimAppView state={ready} route="impor" preview={{ impor: { status: "missing" } }} />);
    expect(html).toContain('href="/jangan-hubungi"');
    expect(html).toContain('href="/aktivitas"');
    expect(html).toMatch(/href="\/nomor"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/nomor"/);
    expect(html).toContain("Pilih nomor dari halaman Nomor");
  });

  it("lists opt-outs masked and lets the admin remove only its own", () => {
    const filterAll: OptoutFilter = { cakupan: "", sumber: "", page: 1 };
    const state: JanganHubungiState = {
      status: "ready",
      devices: ["spmb"],
      page: {
        page: 1,
        optouts: [
          { id: "a", nomor_tersamar: "+62 812-••••-7890", cakupan: "semua", nomor: null, modul: null, alasan: "Permintaan orang tua", sumber: "admin", dibuat: "2026-10-19T02:00:00Z", bisa_dihapus: true },
          { id: "b", nomor_tersamar: "+62 813-••••-1111", cakupan: "device", nomor: "spmb", modul: "spmb", alasan: "Dari SPMB", sumber: "consumer", dibuat: "2026-10-19T02:00:00Z", bisa_dihapus: false },
        ],
      },
    };
    const html = renderToStaticMarkup(<JanganHubungiView state={state} filter={filterAll} busy={false} error={null} onFilter={noop} onAdd={async () => true} onRemove={noop} onReload={noop} />);
    expect(html).toContain("+62 812-••••-7890");
    expect(html).toContain("Nomor spmb");
    expect(html).toContain("Dicabut oleh modulnya");
    expect(html.match(/>.*Hapus<\/button>/g)).toHaveLength(1);
    for (const status of ["loading", "error", "forbidden"] as const) {
      expect(renderToStaticMarkup(<JanganHubungiView state={{ status }} filter={filterAll} busy={false} error={null} onFilter={noop} onAdd={async () => true} onRemove={noop} onReload={noop} />)).toContain(`data-state="${status}"`);
    }
  });

  it("shows activity in Indonesian without bodies, and warns about duplicate conversations", () => {
    const state: AktivitasState = {
      status: "ready",
      page: { page: 1, aktivitas: [{ id: "1", aktor: { jenis: "service", ref: "spmb-api" }, petugas: "petugas:1a2b3c4d5e", aksi: "percakapan.baca", objek: { jenis: "percakapan", ref: "c0ffee00-0000-4000-8000-000000000000" }, hasil: "berhasil", metadata: {}, waktu: "2026-10-19T02:00:00Z" }] },
      summary: { harian: [{ hari: "2026-10-19", nomor: "spmb", modul: "spmb", otomatis: 3, petugas: 2, dari_hp: 1, masuk: 5, gagal: 0 }], akses_isi: [], percakapan_ganda: [{ nomor: "spmb", jumlah: 1 }] },
    };
    const html = renderToStaticMarkup(<AktivitasView state={state} filter={{ aksi: "", device: "", page: 1 }} onFilter={noop} onReload={noop} />);
    expect(html).toContain("Membuka isi percakapan");
    expect(html).toContain("petugas:1a2b3c4d5e");
    expect(html).toContain("percakapan ganda");
    expect(renderToStaticMarkup(<AktivitasView state={{ ...state, page: { page: 1, aktivitas: [] } }} filter={{ aksi: "", device: "", page: 1 }} onFilter={noop} onReload={noop} />)).toContain("Belum ada aktivitas");
  });

  it("explains when the engine cannot import history yet and offers the export file path", () => {
    const state: ImporState = {
      status: "ready",
      kode: "spmb",
      imports: { impor_perangkat_tersedia: false, ringkasan: { antre: 0, berjalan: 0, selesai: 1, gagal: 0, dimasukkan: 12, ganda: 0, dilewati: 2 }, impor: [{ id: "x", jalur: "ekspor", status: "selesai", dimasukkan: 12, ganda: 0, dilewati: 2, galat: null, dibuat: "2026-10-19T02:00:00Z", selesai: "2026-10-19T02:00:01Z" }] },
    };
    const html = renderToStaticMarkup(<ImporView state={state} busy={false} error={null} notice={null} onReload={noop} onDeviceImport={noop} onPreview={async () => null} onImport={async () => true} />);
    expect(html).toContain("Impor riwayat · spmb");
    expect(html).toMatch(/disabled=""[^>]*>.*Impor dari WhatsApp/);
    expect(html).toContain("Belum tersedia");
    expect(html).toContain("Tanpa media");
    expect(html).toContain("12 masuk");
  });

  it("links each active number to its history import", () => {
    expect(renderToStaticMarkup(<NomorView state={kirimNomorFixture} onOpen={noop} onRetry={noop} />)).toContain('href="/impor?nomor=spmb"');
  });
});
