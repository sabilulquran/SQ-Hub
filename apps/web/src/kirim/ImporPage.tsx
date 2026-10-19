import { FileUp, History, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { kirimFetch, KirimRequestError, type KirimExportPreview, type KirimHistoryImports } from "@/kirim/api";
import { formatTime } from "@/kirim/labels";
import { Field, Panel, primaryButton, secondaryButton, StateCard } from "@/kirim/KirimShell";

export type ImporState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "missing" }
  | { status: "ready"; kode: string; imports: KirimHistoryImports };

/** KIRIM-IMPL-002 §10.2: an export file is at most 10 MiB and is read in the browser as text. */
export const EXPORT_MAX_BYTES = 10 * 1024 * 1024;

const STATUS_LABEL: Record<string, string> = { antre: "Antre", menunggu_mesin: "Menunggu WhatsApp", memasukkan: "Memasukkan", selesai: "Selesai", gagal: "Gagal" };

function kodeFromLocation(): string | null {
  const value = new URLSearchParams(window.location.search).get("nomor");
  return value && /^[a-z][a-z0-9-]{1,30}$/.test(value) ? value : null;
}

/** Impor riwayat per nomor (KIRIM-IMPL-002 §10, §12), opened from the number's card. */
export function ImporPage({ preview }: { preview?: ImporState }) {
  const [kode] = useState(() => (preview ? (preview.status === "ready" ? preview.kode : null) : kodeFromLocation()));
  const [state, setState] = useState<ImporState>(preview ?? (kode ? { status: "loading" } : { status: "missing" }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview || !kode) return;
    try {
      setState({ status: "ready", kode, imports: await kirimFetch<KirimHistoryImports>(`/devices/${kode}/history-imports`) });
    } catch (failure) {
      setState(failure instanceof KirimRequestError && failure.status === 403 ? { status: "forbidden" } : { status: "error" });
    }
  }, [kode, preview]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async <T,>(task: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await task();
      await load();
      return result;
    } catch (failure) {
      setError(failure instanceof KirimRequestError ? failure.message : "Kirim SQ sedang tidak dapat dihubungi.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <ImporView
      state={state}
      busy={busy}
      error={error}
      notice={notice}
      onReload={() => { setState({ status: "loading" }); void load(); }}
      onDeviceImport={() =>
        void act(() => kirimFetch<{ percakapan: number }>(`/devices/${kode}/history-imports`, { method: "POST", body: { jumlah_per_percakapan: 200 } })).then((result) => {
          if (result) setNotice(`Impor dimulai untuk ${result.percakapan} percakapan. Kemajuan tampil di bawah.`);
        })
      }
      onPreview={(nomor, teks) => act(() => kirimFetch<KirimExportPreview>(`/devices/${kode}/history-exports/preview`, { method: "POST", body: { nomor, teks } }))}
      onImport={(nomor, teks, namaYayasan) =>
        act(() => kirimFetch<{ dimasukkan: number; ganda: number; dilewati: number }>(`/devices/${kode}/history-exports`, { method: "POST", body: { nomor, teks, nama_yayasan: namaYayasan } })).then((result) => {
          if (result) setNotice(`${result.dimasukkan} pesan dimasukkan, ${result.ganda} sudah ada, ${result.dilewati} dilewati.`);
          return result !== null;
        })
      }
    />
  );
}

export function ImporView({
  state,
  busy,
  error,
  notice,
  onReload,
  onDeviceImport,
  onPreview,
  onImport,
}: {
  state: ImporState;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onReload: () => void;
  onDeviceImport: () => void;
  onPreview: (nomor: string, teks: string) => Promise<KirimExportPreview | null>;
  onImport: (nomor: string, teks: string, namaYayasan: string) => Promise<boolean>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <a href="/nomor" className="text-sm font-bold text-brand-primary-deep">← Nomor</a>
        <h1 className="mt-1 font-display text-2xl font-bold text-brand-heading">Impor riwayat{state.status === "ready" ? ` · ${state.kode}` : ""}</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Memindahkan chat lama nomor ini ke Kirim SQ. Pesan hasil impor ditandai &ldquo;impor&rdquo; dan tidak memicu pemberitahuan atau balasan otomatis.
        </p>
      </div>
      {state.status === "missing" ? <StateCard kind="empty" title="Pilih nomor dari halaman Nomor" action={<a className={secondaryButton} href="/nomor">Ke Nomor</a>} /> : null}
      {state.status === "loading" ? <StateCard kind="loading" title="Memuat riwayat impor" /> : null}
      {state.status === "forbidden" ? <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Kirim SQ" /> : null}
      {state.status === "error" ? (
        <StateCard kind="error" title="Riwayat impor belum dapat dimuat" body="Kirim SQ sedang tidak dapat dihubungi." action={<button type="button" className={secondaryButton} onClick={onReload}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Coba lagi</button>} />
      ) : null}
      {state.status === "ready" ? (
        <>
          {notice ? <p role="status" className="rounded-xl bg-success-soft px-3 py-2 text-sm text-success-ink">{notice}</p> : null}
          {error ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">{error}</p> : null}
          <Panel>
            <h2 className="font-display text-base font-bold text-brand-heading">Dari WhatsApp</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Meminta riwayat ke WhatsApp untuk setiap percakapan yang sudah dikenal Kirim SQ, paling banyak 200 pesan per percakapan. Chat yang tidak pernah aktif lagi sejak nomor ditautkan tidak bisa diminta; pakai berkas ekspor chat untuk itu.
            </p>
            <button type="button" className={`${primaryButton} mt-3`} disabled={busy || !state.imports.impor_perangkat_tersedia} onClick={onDeviceImport}>
              <History className="h-4 w-4" aria-hidden="true" /> Impor dari WhatsApp
            </button>
            {!state.imports.impor_perangkat_tersedia ? (
              <p className="sq-admin-helper mt-2">Belum tersedia: mesin WhatsApp nomor ini belum mendukung permintaan riwayat.</p>
            ) : null}
          </Panel>
          <ExportForm busy={busy} onPreview={onPreview} onImport={onImport} />
          <Panel>
            <h2 className="font-display text-base font-bold text-brand-heading">Riwayat impor</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.imports.ringkasan.selesai} selesai · {state.imports.ringkasan.gagal} gagal · {state.imports.ringkasan.antre + state.imports.ringkasan.berjalan} berjalan ·{" "}
              {state.imports.ringkasan.dimasukkan} pesan dimasukkan · {state.imports.ringkasan.ganda} sudah ada
            </p>
            {state.imports.impor.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Belum pernah ada impor untuk nomor ini.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border/60">
                {state.imports.impor.slice(0, 50).map((row) => (
                  <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span>
                      <span className="font-bold">{row.jalur === "perangkat" ? "WhatsApp" : "Ekspor chat"}</span> · {STATUS_LABEL[row.status] ?? row.status}
                      {row.status === "selesai" ? ` · ${row.dimasukkan} masuk, ${row.ganda} sudah ada` : ""}
                      {row.galat ? ` · ${row.galat}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatTime(row.dibuat)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function ExportForm({
  busy,
  onPreview,
  onImport,
}: {
  busy: boolean;
  onPreview: (nomor: string, teks: string) => Promise<KirimExportPreview | null>;
  onImport: (nomor: string, teks: string, namaYayasan: string) => Promise<boolean>;
}) {
  const [nomor, setNomor] = useState("");
  const [teks, setTeks] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<KirimExportPreview | null>(null);
  const [namaYayasan, setNamaYayasan] = useState("");

  const readFile = (file: File | undefined) => {
    setPreview(null);
    setTeks(null);
    setFileError(null);
    if (!file) return;
    if (file.size > EXPORT_MAX_BYTES) {
      setFileError("Berkas lebih dari 10 MiB.");
      return;
    }
    void file.text().then(setTeks, () => setFileError("Berkas tidak bisa dibaca."));
  };

  return (
    <Panel>
      <h2 className="font-display text-base font-bold text-brand-heading">Dari berkas ekspor chat</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Di HP nomor ini: buka chat → Lainnya → Ekspor chat → <strong>Tanpa media</strong>. Unggah berkas <code>.txt</code> itu di sini, satu percakapan per berkas.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Nomor lawan bicara" helper="Berkas ekspor hanya memuat nama, jadi nomornya diketik di sini.">
          <input className="sq-admin-input" inputMode="tel" autoComplete="off" maxLength={40} value={nomor} onChange={(event) => setNomor(event.target.value)} />
        </Field>
        <Field label="Berkas .txt">
          <input className="sq-admin-input" type="file" accept=".txt,text/plain" onChange={(event) => readFile(event.target.files?.[0])} />
        </Field>
      </div>
      {fileError ? <p role="alert" className="mt-2 text-sm text-danger-ink">{fileError}</p> : null}
      <button
        type="button"
        className={`${secondaryButton} mt-3`}
        disabled={busy || !teks || !nomor.trim()}
        onClick={() => void onPreview(nomor, teks!).then((result) => { setPreview(result); setNamaYayasan(result?.nama[0]?.nama ?? ""); })}
      >
        Lihat pratinjau
      </button>
      {preview ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm">{preview.pesan} pesan terbaca, {preview.dilewati} baris dilewati (pesan sistem, media, atau pesan dihapus).</p>
          <Field label="Nama nomor yayasan di berkas ini" helper="Pesan dari nama ini dicatat sebagai pesan keluar.">
            <select className="sq-admin-input" value={namaYayasan} onChange={(event) => setNamaYayasan(event.target.value)}>
              {preview.nama.map((row) => <option key={row.nama} value={row.nama}>{row.nama} ({row.jumlah})</option>)}
            </select>
          </Field>
          <ol className="max-h-64 space-y-1 overflow-y-auto rounded-xl bg-muted/50 p-3 text-sm">
            {preview.pratinjau.map((row, index) => (
              <li key={`${row.waktu}-${index}`} className={row.nama === namaYayasan ? "text-right" : ""}>
                <span className="text-xs text-muted-foreground">{formatTime(row.waktu)} · {row.nama}</span>
                <p className="whitespace-pre-wrap break-words">{row.isi}</p>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className={primaryButton}
            disabled={busy || !namaYayasan}
            onClick={() => void onImport(nomor, teks!, namaYayasan).then((done) => { if (done) { setPreview(null); setTeks(null); } })}
          >
            <FileUp className="h-4 w-4" aria-hidden="true" /> Masukkan ke Kirim SQ
          </button>
        </div>
      ) : null}
    </Panel>
  );
}
