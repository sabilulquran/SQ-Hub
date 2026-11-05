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
import { KirimShell } from "@/kirim/KirimShell";
import type { KirimDevice } from "@/kirim/api";
import { DeactivateDialog, DeactivateWarning, ModuleCard, NomorView, PairingContent, TambahDialog } from "@/kirim/NomorPage";
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

describe("WhatsApp modul screen (KIRIM-IMPL-003)", () => {
  it("renders loading, error, forbidden and empty states", () => {
    expect(renderToStaticMarkup(<NomorView state={{ status: "loading" }} onOpen={noop} onRetry={noop} />)).toContain('data-state="loading"');
    expect(renderToStaticMarkup(<NomorView state={{ status: "error" }} onOpen={noop} onRetry={noop} />)).toContain("Modul belum dapat dimuat");
    expect(renderToStaticMarkup(<NomorView state={{ status: "forbidden" }} onOpen={noop} onRetry={noop} />)).toContain("Anda belum ditetapkan sebagai pengelola Kirim SQ");
    const empty = renderToStaticMarkup(
      <NomorView state={{ ...kirimNomorFixture, list: { modules: [], devices: [], peringatan: { terputus: [], webhook_habis: 0 } } } as typeof kirimNomorFixture} onOpen={noop} onRetry={noop} />,
    );
    expect(empty).toContain("Belum ada modul yang memakai WhatsApp");
    expect(empty).not.toContain('role="status"');
  });

  it("shows one card per module: empty with + Tambah WhatsApp, owner of a shared number, and user of it", () => {
    const html = renderToStaticMarkup(<NomorView state={kirimNomorFixture} onOpen={noop} onRetry={noop} />);
    expect(html).toContain("Keuangan");
    expect(html).toContain("Belum memakai WhatsApp");
    expect(html).toContain("Tambah WhatsApp");
    expect(html).toContain("Dipakai juga oleh <strong>Karir SQ</strong>");
    expect(html).toContain("Memakai nomor milik HCIS");
    expect(html).toContain("Putuskan dari Karir SQ");
    expect(html).toContain("notifikasi, kode verifikasi");
    // A number no card owns stays visible below the cards.
    expect(html).toContain("Nomor tanpa kartu modul");
    expect(html).toContain("Nomor uji");
    expect(html).not.toContain("Tambah nomor");
  });

  it("offers a new number or an active one, with nothing technical to type", () => {
    const card = kirimNomorFixture.status === "ready" ? kirimNomorFixture.list.modules.find((item) => item.application_key === "keuangan")! : null!;
    const numbers = kirimNomorFixture.status === "ready" ? kirimNomorFixture.list.devices : [];
    const html = renderToStaticMarkup(<TambahDialog card={card} numbers={numbers} editing={false} busy={false} error={null} onClose={noop} onNewNumber={noop} onUseNumber={noop} />);
    expect(html).toContain("Sambungkan nomor baru");
    expect(html).toContain("Pakai nomor yang sudah aktif");
    expect(html).toContain("Buat nomor Keuangan");
    expect(html).not.toMatch(/<input[^>]*type="text"/);
  });

  it("shows each number with provider badge, colored status, masked number and queue", () => {
    const html = renderToStaticMarkup(<NomorView state={kirimNomorFixture} onOpen={noop} onRetry={noop} />);
    expect(html).toContain("Pemilik SPMB resmi");
    expect(html).toContain("Uji — tidak mengirim");
    expect(html).toContain("bg-danger-soft text-danger-ink");
    expect(html).toContain("Terputus");
    expect(html).toContain("+62 812-••••-7890");
    expect(html).toContain("12 antre · 1 gagal hari ini");
    expect(html).toContain("Nomor terputus:");
    expect(html).toContain("gagal dikirim ke modul pemakai setelah 8 percobaan");
    // KIRIM-IMPL-003 §11.1: a number paired before gets Sambungkan ulang, not Pasang.
    expect(html).toContain("Sambungkan ulang");
    expect(html).toContain("Pakai <strong>Sambungkan ulang</strong> di kartunya");
    expect(html).toContain("Putuskan");
    expect(html).toContain("Nonaktifkan");
  });

  it("offers Pasang only for a number never paired, and Sambungkan ulang for terputus, menunggu_pairing and tersambung", () => {
    const base = kirimNomorFixture.status === "ready" ? kirimNomorFixture.list.modules.find((item) => item.application_key === "spmb-sq")! : null!;
    const render = (status: KirimDevice["status"]) =>
      renderToStaticMarkup(<ModuleCard card={{ ...base, nomor: { ...base.nomor!, status } }} onOpen={noop} />);
    expect(render("belum_dipasang")).toContain("Pasang");
    expect(render("belum_dipasang")).not.toContain("Sambungkan ulang");
    for (const status of ["terputus", "menunggu_pairing", "tersambung"] as const) {
      expect(render(status)).toContain("Sambungkan ulang");
      expect(render(status)).not.toContain("> Pasang");
    }
    expect(render("nonaktif")).not.toContain("Sambungkan ulang");
  });

  it("explains Sambungkan ulang keeps the number, asks a reason, warns when connected, and retries while the engine restarts", () => {
    const device = kirimNomorFixture.status === "ready" ? kirimNomorFixture.list.devices.find((item) => item.kode === "spmb")! : null!;
    const reconnect = (status: KirimDevice["status"], alasan = "") => ({ device: { ...device, status }, alasan, onAlasan: noop, perangkatBaru: false, onPerangkatBaru: noop });
    const choose = renderToStaticMarkup(<PairingContent view={{ step: "choose" }} phone="" onPhone={noop} onStart={noop} reconnect={reconnect("terputus")} />);
    expect(choose).toContain("Kode nomor, percakapan, kartu modul, dan rute tetap sama");
    expect(choose).toContain("Tidak ada nomor baru yang dibuat");
    expect(choose).toContain("Pakai perangkat mesin baru");
    expect(choose).toMatch(/<button[^>]*disabled=""[^>]*>.*Pindai kode QR/);
    expect(choose).not.toContain("Sesi yang berjalan dilepas");
    const connected = renderToStaticMarkup(<PairingContent view={{ step: "choose" }} phone="" onPhone={noop} onStart={noop} reconnect={reconnect("tersambung", "QR gagal")} />);
    expect(connected).toContain("Sesi yang berjalan dilepas");
    expect(connected).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Pindai kode QR/);
    const retry = renderToStaticMarkup(<PairingContent view={{ step: "retry", secondsLeft: 12, attempt: 1 }} phone="" onPhone={noop} onStart={noop} />);
    expect(retry).toContain("Mesin WhatsApp sedang dinyalakan ulang");
    expect(retry).toContain("12 detik (percobaan 1 dari 3)");
    expect(retry).toContain("Jangan Nonaktifkan nomor ini");
    const failed = renderToStaticMarkup(<PairingContent view={{ step: "error", message: "Mesin WhatsApp sedang tidak tersedia", retry: true }} phone="" onPhone={noop} onStart={noop} onRetry={noop} />);
    expect(failed).toContain("Coba lagi");
  });

  it("warns before Nonaktifkan with the cards and routes still on the number, and points to Sambungkan ulang", () => {
    const device = kirimNomorFixture.status === "ready" ? kirimNomorFixture.list.devices.find((item) => item.kode === "spmb")! : null!;
    const html = renderToStaticMarkup(
      <DeactivateWarning device={device} usage={{ kartu: ["SPMB SQ"], rute: [{ modul: "SPMB SQ", jenis: "kode" }] }} paham={false} onPaham={noop} onReconnect={noop} />,
    );
    expect(html).toContain("Kartu yang dikosongkan: <strong>SPMB SQ</strong>");
    expect(html).toContain("SPMB SQ (kode verifikasi)");
    expect(html).toContain("Sambungkan ulang</button> saja");
    expect(html).toContain("Jangan membuat nomor baru untuk WhatsApp yang sama");
    expect(html).toContain('type="checkbox"');
    // The tick box is the browser's only guard: Nonaktifkan stays disabled until it is ticked.
    const dialog = renderToStaticMarkup(<DeactivateDialog device={device} sharers={[]} busy={false} error={null} onClose={noop} onConfirm={noop} />);
    expect(dialog).toMatch(/<button[^>]*disabled=""[^>]*>Nonaktifkan<\/button>/);
  });

  it("offers the module's old number first and asks before a new number for an emptied card", () => {
    const card = kirimNomorFixture.status === "ready" ? kirimNomorFixture.list.modules.find((item) => item.application_key === "keuangan")! : null!;
    const html = renderToStaticMarkup(
      <TambahDialog
        card={{ ...card, nomor_lama: [{ kode: "keuangan", label: "Nomor Keuangan", status: "nonaktif", nomor_tersamar: "+62 812-••••-7890" }] }}
        numbers={[]}
        editing={false}
        busy={false}
        error={null}
        onClose={noop}
        onNewNumber={noop}
        onUseNumber={noop}
      />,
    );
    expect(html).toContain("Pakai nomor lama Keuangan");
    expect(html).toContain("Nomor Keuangan · +62 812-••••-7890 · Nonaktif");
    expect(html.indexOf("Pakai nomor lama Keuangan")).toBeLessThan(html.indexOf("Sambungkan nomor baru"));
    expect(html).toMatch(/<button[^>]*>.*Pakai nomor lama<\/button>/);
  });

  it("flags a number whose WhatsApp already has a number and offers Pakai nomor yang ada", () => {
    if (kirimNomorFixture.status !== "ready") throw new Error("fixture");
    const spmb = kirimNomorFixture.list.modules.find((item) => item.application_key === "spmb-sq")!;
    const held = { ...spmb, nomor: { ...spmb.nomor!, kode: "spmb-2", nomor_ganda: { kode: "spmb", label: "SPMB resmi" } } };
    const html = renderToStaticMarkup(<ModuleCard card={held} onOpen={noop} />);
    expect(html).toContain("WhatsApp di nomor ini sama dengan <strong>SPMB resmi</strong>");
    expect(html).toContain("Pakai nomor yang ada");
    const done = renderToStaticMarkup(<PairingContent view={{ step: "connected", nomor: "+62 812-••••-7890", sama: { kode: "spmb", label: "SPMB resmi" } }} phone="" onPhone={noop} onStart={noop} onDuplicate={noop} />);
    expect(done).toContain("WhatsApp ini sudah punya nomor di Kirim SQ: <strong>SPMB resmi</strong>");
    const warn = renderToStaticMarkup(
      <NomorView state={{ ...kirimNomorFixture, list: { ...kirimNomorFixture.list, peringatan: { terputus: [], webhook_habis: 0, nomor_ganda: ["spmb-2"] } } }} onOpen={noop} onRetry={noop} />,
    );
    expect(warn).toContain("<strong>Nomor ganda:</strong> spmb-2");
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
    expect(html).toContain("Pilih nomor dari halaman Modul");
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
    expect(html).toMatch(/disabled=""[^>]*>.*Impor semua dari salinan awal/);
  });

  it("offers Impor semua dari salinan awal and labels stored-copy rows (KIRIM-IMPL-002 §10.3)", () => {
    const state: ImporState = {
      status: "ready",
      kode: "spmb",
      imports: {
        impor_perangkat_tersedia: true,
        impor_salinan_tersedia: true,
        ringkasan: { antre: 2900, berjalan: 1, selesai: 40, gagal: 0, dimasukkan: 1200, ganda: 3, dilewati: 0 },
        impor: [{ id: "y", jalur: "salinan", status: "selesai", dimasukkan: 30, ganda: 0, dilewati: 0, galat: null, dibuat: "2026-11-05T15:00:00Z", selesai: "2026-11-05T15:00:01Z" }],
      },
    };
    const html = renderToStaticMarkup(<ImporView state={state} busy={false} error={null} notice={null} onReload={noop} onDeviceImport={noop} onStoredImport={noop} onPreview={async () => null} onImport={async () => true} />);
    expect(html).toContain("Dari salinan awal");
    expect(html).toContain("termasuk chat yang belum pernah aktif di Kirim SQ");
    expect(html).not.toMatch(/disabled=""[^>]*>.*Impor semua dari salinan awal/);
    expect(html).toContain("Salinan awal</span> · Selesai");
    expect(html).toContain("2901 berjalan");
  });

  it("links each active number to its history import", () => {
    expect(renderToStaticMarkup(<NomorView state={kirimNomorFixture} onOpen={noop} onRetry={noop} />)).toContain('href="/impor?nomor=spmb"');
  });
});

describe("Kirim SQ header launcher (HUB-IMPL-022)", () => {
  const applications = [
    { key: "aset-sq", name: "Aset SQ", canonicalUrl: "https://aset.sabilulquran.or.id" },
    { key: "hcis", name: "HCIS", canonicalUrl: "https://hcis.sabilulquran.or.id" },
    { key: "kirim-sq", name: "Kirim SQ", canonicalUrl: "https://kirim.sabilulquran.or.id" },
  ];

  function shell(launcherApplications: typeof applications | null) {
    return renderToStaticMarkup(
      <KirimShell active="nomor" displayName="Kepala HCM" onLogout={noop} launcherApplications={launcherApplications} launcherPreviewOpen>
        <p>isi</p>
      </KirimShell>,
    );
  }

  it("shows SQ Hub first, then the user's applications, with Kirim SQ marked Di sini", () => {
    const html = shell(applications);
    expect(html).toContain('href="https://hub.sabilulquran.or.id"');
    expect(html).toContain("Beranda semua aplikasi Anda");
    expect(html.indexOf("Beranda semua aplikasi Anda")).toBeLessThan(html.indexOf("Aset SQ"));
    expect(html.indexOf("Aset SQ")).toBeLessThan(html.indexOf(">HCIS<"));
    expect(html).toContain('href="https://hub.sabilulquran.or.id/apps"');
    expect(html).toContain("Lihat semua aplikasi");
    // Only Kirim SQ is the current page; SQ Hub is not.
    expect(html.match(/aria-current="page"/g)?.length).toBe(2); // nav tab + launcher tile
    const dialog = html.slice(html.indexOf('role="dialog"'));
    const currentTile = dialog.slice(dialog.indexOf('aria-current="page"'));
    expect(currentTile.slice(0, currentTile.indexOf("</a>"))).toMatch(/Kirim SQ.*Di sini/);
    expect(html.match(/Di sini/g)?.length).toBe(1);
  });

  it("puts the launcher between the theme toggle and the account controls", () => {
    const html = shell(applications);
    expect(html.indexOf("Buka peluncur aplikasi")).toBeLessThan(html.indexOf("Kepala HCM"));
    expect(html.indexOf("Buka peluncur aplikasi")).toBeLessThan(html.indexOf("Keluar"));
  });

  it("falls back to the Kirim SQ tile only when the list is unavailable", () => {
    const html = shell(null);
    expect(html).toContain("Beranda semua aplikasi Anda");
    expect(html).toContain("Di sini");
    expect(html).not.toContain("Belum ada aplikasi yang tersedia");
    expect(html).not.toContain("HCIS");
  });

  it("still shows Kirim SQ when the list leaves it out", () => {
    const html = shell(applications.filter((application) => application.key !== "kirim-sq"));
    expect(html).toContain("HCIS");
    expect(html.match(/Di sini/g)?.length).toBe(1);
    expect(html.indexOf("Kirim SQ</span>")).toBeLessThan(html.indexOf("Aset SQ"));
  });
});
