import { AlertTriangle, History, Pause, Play, Plus, PlugZap, Power, QrCode, RefreshCw, Settings2, Unplug } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  kirimFetch,
  KirimRequestError,
  type KirimConsumer,
  type KirimDevice,
  type KirimDeviceList,
  type LiveStatus,
  type PairingResult,
} from "@/kirim/api";
import { deviceStatusLabel, deviceStatusTone, formatTime } from "@/kirim/labels";
import { dangerButton, Field, Panel, primaryButton, ReasonDialog, secondaryButton, StateCard } from "@/kirim/KirimShell";

export type NomorState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "ready"; list: KirimDeviceList; consumers: KirimConsumer[] };

type Dialog =
  | { kind: "disconnect" | "deactivate" | "pause" | "resume"; device: KirimDevice }
  | { kind: "edit"; device: KirimDevice }
  | { kind: "pair"; device: KirimDevice }
  | { kind: "add" };

const POLL_MS = 3_000;
const POLL_LIMIT_MS = 2 * 60_000;

function messageFor(error: unknown): string {
  if (error instanceof KirimRequestError) return error.message;
  return "Kirim SQ sedang tidak dapat dihubungi. Coba lagi.";
}

export function NomorPage({ preview }: { preview?: NomorState }) {
  const [state, setState] = useState<NomorState>(preview ?? { status: "loading" });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview) return;
    try {
      const [list, consumers] = await Promise.all([
        kirimFetch<KirimDeviceList>("/devices"),
        kirimFetch<{ consumers: KirimConsumer[] }>("/consumers"),
      ]);
      setState({ status: "ready", list, consumers: consumers.consumers });
    } catch (failure) {
      setState(failure instanceof KirimRequestError && failure.status === 403 ? { status: "forbidden" } : { status: "error" });
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      setDialog(null);
      await load();
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setDialog(null);
    setError(null);
  };

  return (
    <>
      <NomorView state={state} onOpen={(next) => { setError(null); setDialog(next); }} onRetry={() => { setState({ status: "loading" }); void load(); }} />
      {dialog?.kind === "disconnect" ? (
        <ReasonDialog title={`Putuskan ${dialog.device.label}?`} body="Sesi WhatsApp di mesin dilepas. Nomor perlu dipasang ulang sebelum bisa mengirim lagi." confirmLabel="Putuskan" danger busy={busy} error={error} onClose={close}
          onConfirm={(alasan) => void run(() => kirimFetch(`/devices/${dialog.device.kode}/disconnect`, { method: "POST", body: { alasan } }))} />
      ) : null}
      {dialog?.kind === "deactivate" ? (
        <ReasonDialog title={`Nonaktifkan ${dialog.device.label}?`} body="Permintaan kirim baru untuk nomor ini ditolak. Antrean yang ada tidak dihapus." confirmLabel="Nonaktifkan" danger busy={busy} error={error} onClose={close}
          onConfirm={(alasan) => void run(() => kirimFetch(`/devices/${dialog.device.kode}/deactivate`, { method: "POST", body: { alasan } }))} />
      ) : null}
      {dialog?.kind === "pause" || dialog?.kind === "resume" ? (
        <ReasonDialog
          title={dialog.kind === "pause" ? `Jeda antrean ${dialog.device.label}?` : `Lanjutkan antrean ${dialog.device.label}?`}
          body={dialog.kind === "pause" ? "Pesan tetap diterima dan menunggu di antrean sampai dilanjutkan." : "Pesan yang menunggu akan dikirim lagi sesuai jam kirim dan batas laju."}
          confirmLabel={dialog.kind === "pause" ? "Jeda antrean" : "Lanjutkan antrean"}
          busy={busy}
          error={error}
          reasonRequired={false}
          onClose={close}
          onConfirm={(alasan) => void run(() => kirimFetch(`/devices/${dialog.device.kode}/${dialog.kind}`, { method: "POST", body: alasan ? { alasan } : {} }))}
        />
      ) : null}
      {dialog?.kind === "edit" && state.status === "ready" ? (
        <EditDeviceDialog device={dialog.device} consumers={state.consumers} busy={busy} error={error} onClose={close}
          onSave={(body) => void run(() => kirimFetch(`/devices/${dialog.device.kode}`, { method: "PATCH", body }))} />
      ) : null}
      {dialog?.kind === "add" && state.status === "ready" ? (
        <AddDeviceDialog consumers={state.consumers} busy={busy} error={error} onClose={close}
          onSave={(body) => void run(() => kirimFetch("/devices", { method: "POST", body }))} />
      ) : null}
      {dialog?.kind === "pair" ? <PairingDialog device={dialog.device} onClose={() => { close(); void load(); }} /> : null}
    </>
  );
}

export function NomorView({ state, onOpen, onRetry }: { state: NomorState; onOpen: (dialog: Dialog) => void; onRetry: () => void }) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">Nomor WhatsApp</h1>
          <p className="mt-1 text-sm text-muted-foreground">Nomor milik modul, status sambungan, dan antrean otomatis.</p>
        </div>
        {state.status === "ready" ? (
          <button type="button" className={primaryButton} onClick={() => onOpen({ kind: "add" })}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Tambah nomor
          </button>
        ) : null}
      </div>

      <div className="mt-5 space-y-4">
        {state.status === "loading" ? <StateCard kind="loading" title="Memuat nomor" /> : null}
        {state.status === "error" ? (
          <StateCard kind="error" title="Nomor belum dapat dimuat" body="Kirim SQ sedang tidak dapat dihubungi." action={<button type="button" className={secondaryButton} onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Coba lagi</button>} />
        ) : null}
        {state.status === "forbidden" ? <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Kirim SQ" /> : null}
        {state.status === "ready" ? (
          <>
            <Warnings list={state.list} />
            {state.list.devices.length === 0 ? (
              <StateCard kind="empty" title="Belum ada nomor" body="Tambahkan nomor pertama, mulai dengan provider log supaya modul bisa menguji tanpa mengirim." />
            ) : (
              <ul className="grid gap-4 lg:grid-cols-2">
                {state.list.devices.map((device) => (
                  <li key={device.kode}><DeviceCard device={device} onOpen={onOpen} /></li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}

function Warnings({ list }: { list: KirimDeviceList }) {
  if (list.peringatan.terputus.length === 0 && list.peringatan.webhook_habis === 0) return null;
  return (
    <div role="status" className="flex gap-3 rounded-2xl border border-warning-ink/20 bg-warning-soft p-4 text-sm text-warning-ink">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        {list.peringatan.terputus.length > 0 ? <p><strong>Nomor terputus:</strong> {list.peringatan.terputus.join(", ")}. Antreannya berhenti sampai tersambung lagi.</p> : null}
        {list.peringatan.webhook_habis > 0 ? <p><strong>{list.peringatan.webhook_habis} event</strong> gagal dikirim ke modul pemakai setelah 8 percobaan.</p> : null}
      </div>
    </div>
  );
}

export function DeviceCard({ device, onOpen }: { device: KirimDevice; onOpen: (dialog: Dialog) => void }) {
  const inactive = device.status === "nonaktif";
  return (
    <Panel className="h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-bold text-brand-heading">{device.label}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <code>{device.kode}</code> · milik {device.pemilik}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${deviceStatusTone[device.status]}`}>{deviceStatusLabel[device.status]}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div><dt className="text-xs text-muted-foreground">Nomor</dt><dd className="font-semibold">{device.nomor_tersamar ?? "—"}</dd></div>
        <div>
          <dt className="text-xs text-muted-foreground">Provider</dt>
          <dd className="flex flex-wrap items-center gap-1.5 font-semibold">
            {device.provider}
            {device.provider === "log" ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning-ink">Uji — tidak mengirim</span> : null}
          </dd>
        </div>
        <div><dt className="text-xs text-muted-foreground">Antrean</dt><dd className="font-semibold">{device.antrean?.antre ?? 0} antre · {device.antrean?.gagal_hari_ini ?? 0} gagal hari ini{device.antrean_dijeda ? " · dijeda" : ""}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Jam kirim · laju</dt><dd className="font-semibold">{device.jam_kirim_mulai}–{device.jam_kirim_selesai} WIB · {device.rate_per_menit}/menit</dd></div>
        <div className="col-span-2"><dt className="text-xs text-muted-foreground">Status berubah</dt><dd>{formatTime(device.status_berubah_at)}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {device.provider === "jalurpesan" && !inactive && device.status !== "tersambung" ? (
          <button type="button" className={secondaryButton} onClick={() => onOpen({ kind: "pair", device })}><QrCode className="h-4 w-4" aria-hidden="true" /> Pasang</button>
        ) : null}
        <button type="button" className={secondaryButton} onClick={() => onOpen({ kind: "edit", device })}><Settings2 className="h-4 w-4" aria-hidden="true" /> Ubah</button>
        {!inactive ? (
          <a className={secondaryButton} href={`/impor?nomor=${encodeURIComponent(device.kode)}`}><History className="h-4 w-4" aria-hidden="true" /> Impor riwayat</a>
        ) : null}
        {!inactive ? (
          <button type="button" className={secondaryButton} onClick={() => onOpen({ kind: device.antrean_dijeda ? "resume" : "pause", device })}>
            {device.antrean_dijeda ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
            {device.antrean_dijeda ? "Lanjutkan antrean" : "Jeda antrean"}
          </button>
        ) : null}
        {device.provider === "jalurpesan" && !inactive && device.status !== "belum_dipasang" ? (
          <button type="button" className={dangerButton} onClick={() => onOpen({ kind: "disconnect", device })}><Unplug className="h-4 w-4" aria-hidden="true" /> Putuskan</button>
        ) : null}
        {!inactive ? (
          <button type="button" className={dangerButton} onClick={() => onOpen({ kind: "deactivate", device })}><Power className="h-4 w-4" aria-hidden="true" /> Nonaktifkan</button>
        ) : null}
      </div>
    </Panel>
  );
}

function DialogFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface-raised p-5 shadow-[var(--shadow-raised)] sm:rounded-2xl">
        <h2 className="font-display text-lg font-bold text-brand-heading">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function AddDeviceDialog({ consumers, busy, error, onClose, onSave }: { consumers: KirimConsumer[]; busy: boolean; error: string | null; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ kode: "", label: "", pemilik: consumers[0]?.nama ?? "", provider: "log", provider_ref: "" });
  const valid = /^[a-z][a-z0-9-]{1,30}$/.test(form.kode) && form.label.trim() && form.pemilik && (form.provider === "log" || form.provider_ref.trim());
  return (
    <DialogFrame title="Tambah nomor">
      <div className="mt-3 space-y-3">
        <Field label="Kode" helper="Huruf kecil, angka, atau tanda hubung. Contoh: hcis, spmb."><input className="sq-admin-input" value={form.kode} onChange={(event) => setForm({ ...form, kode: event.target.value.trim() })} /></Field>
        <Field label="Label"><input className="sq-admin-input" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></Field>
        <Field label="Modul pemilik">
          <select className="sq-admin-input" value={form.pemilik} onChange={(event) => setForm({ ...form, pemilik: event.target.value })}>
            {consumers.map((consumer) => <option key={consumer.nama} value={consumer.nama}>{consumer.nama}</option>)}
          </select>
        </Field>
        <Field label="Provider" helper="Mulai dengan log: tidak mengirim apa pun, aman untuk uji modul.">
          <select className="sq-admin-input" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
            <option value="log">log (uji, tidak mengirim)</option>
            <option value="jalurpesan">jalurpesan</option>
          </select>
        </Field>
        {form.provider === "jalurpesan" ? <Field label="Tenant JalurPesan"><input className="sq-admin-input" value={form.provider_ref} onChange={(event) => setForm({ ...form, provider_ref: event.target.value.trim() })} /></Field> : null}
      </div>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">{error}</p> : null}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Batal</button>
        <button type="button" className={primaryButton} disabled={busy || !valid} onClick={() => onSave({
          kode: form.kode, label: form.label.trim(), pemilik: form.pemilik, provider: form.provider,
          ...(form.provider === "jalurpesan" ? { provider_ref: form.provider_ref } : {}),
        })}>Simpan</button>
      </div>
    </DialogFrame>
  );
}

function EditDeviceDialog({ device, consumers, busy, error, onClose, onSave }: { device: KirimDevice; consumers: KirimConsumer[]; busy: boolean; error: string | null; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({
    label: device.label,
    pemilik: device.pemilik,
    jam_kirim_mulai: device.jam_kirim_mulai,
    jam_kirim_selesai: device.jam_kirim_selesai,
    rate_per_menit: String(device.rate_per_menit),
    provider: device.provider as string,
    provider_ref: device.provider_ref ?? "",
    alasan: "",
  });
  const providerChanged = form.provider !== device.provider || (form.provider === "jalurpesan" && form.provider_ref !== (device.provider_ref ?? ""));
  const rate = Number(form.rate_per_menit);
  const valid = form.label.trim() && form.jam_kirim_mulai < form.jam_kirim_selesai && Number.isInteger(rate) && rate >= 1 && rate <= 60
    && (!providerChanged || (form.alasan.trim() && (form.provider === "log" || form.provider_ref.trim())));
  return (
    <DialogFrame title={`Ubah ${device.label}`}>
      <div className="mt-3 space-y-3">
        <Field label="Label"><input className="sq-admin-input" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></Field>
        <Field label="Modul pemilik">
          <select className="sq-admin-input" value={form.pemilik} onChange={(event) => setForm({ ...form, pemilik: event.target.value })}>
            {consumers.map((consumer) => <option key={consumer.nama} value={consumer.nama}>{consumer.nama}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jam mulai (WIB)"><input className="sq-admin-input" type="time" value={form.jam_kirim_mulai} onChange={(event) => setForm({ ...form, jam_kirim_mulai: event.target.value })} /></Field>
          <Field label="Jam selesai (WIB)"><input className="sq-admin-input" type="time" value={form.jam_kirim_selesai} onChange={(event) => setForm({ ...form, jam_kirim_selesai: event.target.value })} /></Field>
        </div>
        <Field label="Laju (pesan per menit)" helper="Bawaan 10. Kode verifikasi ikut dihitung."><input className="sq-admin-input" inputMode="numeric" value={form.rate_per_menit} onChange={(event) => setForm({ ...form, rate_per_menit: event.target.value })} /></Field>
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-xs font-bold text-brand-heading">Ganti provider</legend>
          {!device.antrean_dijeda ? <p className="sq-admin-helper">Jeda antrean dulu sebelum mengganti provider. Mengganti mesin berarti nomor dipasang ulang.</p> : null}
          <div className="mt-2 space-y-3">
            <select className="sq-admin-input" disabled={!device.antrean_dijeda} value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
              <option value="log">log (uji, tidak mengirim)</option>
              <option value="jalurpesan">jalurpesan</option>
            </select>
            {form.provider === "jalurpesan" ? <Field label="Tenant JalurPesan"><input className="sq-admin-input" disabled={!device.antrean_dijeda} value={form.provider_ref} onChange={(event) => setForm({ ...form, provider_ref: event.target.value.trim() })} /></Field> : null}
            {providerChanged ? <Field label="Alasan"><textarea className="sq-admin-input" rows={2} maxLength={500} value={form.alasan} onChange={(event) => setForm({ ...form, alasan: event.target.value })} /></Field> : null}
          </div>
        </fieldset>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">{error}</p> : null}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Batal</button>
        <button type="button" className={primaryButton} disabled={busy || !valid} onClick={() => onSave({
          label: form.label.trim(),
          pemilik: form.pemilik,
          jam_kirim_mulai: form.jam_kirim_mulai,
          jam_kirim_selesai: form.jam_kirim_selesai,
          rate_per_menit: rate,
          ...(providerChanged ? { provider: form.provider, provider_ref: form.provider === "jalurpesan" ? form.provider_ref : null, alasan: form.alasan.trim() } : {}),
        })}>Simpan</button>
      </div>
    </DialogFrame>
  );
}

export type PairingView =
  | { step: "choose" }
  | { step: "working" }
  | { step: "qr"; qr: string | null; secondsLeft: number }
  | { step: "kode"; code: string; secondsLeft: number }
  | { step: "connected"; nomor: string | null }
  | { step: "expired" }
  | { step: "error"; message: string };

/**
 * QR and pairing codes live only in this component's state: never in the URL, storage or logs.
 * Status is polled every 3 seconds and polling stops after 2 minutes.
 */
function PairingDialog({ device, onClose }: { device: KirimDevice; onClose: () => void }) {
  const [view, setView] = useState<PairingView>({ step: "choose" });
  const [phone, setPhone] = useState("");
  const timer = useRef<number | null>(null);
  const deadline = useRef(0);

  const stop = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const poll = (mode: "qr" | "kode", code?: string) => {
    deadline.current = Date.now() + POLL_LIMIT_MS;
    stop();
    timer.current = window.setInterval(() => {
      const secondsLeft = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      if (secondsLeft === 0) {
        stop();
        setView({ step: "expired" });
        return;
      }
      void kirimFetch<LiveStatus>(`/devices/${device.kode}/status`).then((status) => {
        if (status.status === "tersambung") {
          stop();
          setView({ step: "connected", nomor: status.nomor_tersamar });
          return;
        }
        setView(mode === "qr" ? { step: "qr", qr: status.qr, secondsLeft } : { step: "kode", code: code ?? "", secondsLeft });
      }).catch(() => undefined);
    }, POLL_MS);
  };

  const start = async (mode: "qr" | "kode") => {
    setView({ step: "working" });
    try {
      await kirimFetch(`/devices/${device.kode}/provision`, { method: "POST", body: {} });
      const result = await kirimFetch<PairingResult>(`/devices/${device.kode}/pairing`, { method: "POST", body: mode === "qr" ? { mode } : { mode, phone } });
      if (result.mode === "qr") {
        setView({ step: "qr", qr: result.qr, secondsLeft: POLL_LIMIT_MS / 1000 });
        poll("qr");
      } else {
        setView({ step: "kode", code: result.pairing_code, secondsLeft: POLL_LIMIT_MS / 1000 });
        poll("kode", result.pairing_code);
      }
    } catch (failure) {
      setView({ step: "error", message: messageFor(failure) });
    }
  };

  return (
    <DialogFrame title={`Pasang ${device.label}`}>
      <PairingContent view={view} phone={phone} onPhone={setPhone} onStart={(mode) => void start(mode)} />
      <div className="mt-4 flex justify-end">
        <button type="button" className={secondaryButton} onClick={() => { stop(); onClose(); }}>{view.step === "connected" ? "Selesai" : "Tutup"}</button>
      </div>
    </DialogFrame>
  );
}

export function PairingContent({ view, phone, onPhone, onStart }: { view: PairingView; phone: string; onPhone: (value: string) => void; onStart: (mode: "qr" | "kode") => void }) {
  const instructions = <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm">Di HP nomor ini buka <strong>WhatsApp → Perangkat tertaut → Tautkan perangkat</strong>.</p>;
  if (view.step === "choose") {
    return (
      <div className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">Pilih cara memasang. Nomor ditautkan sebagai perangkat tertaut, jadi HP tetap bisa dipakai seperti biasa.</p>
        <button type="button" className={`${primaryButton} w-full`} onClick={() => onStart("qr")}><QrCode className="h-4 w-4" aria-hidden="true" /> Pindai kode QR</button>
        <div className="rounded-xl border border-border p-3">
          <Field label="Atau dengan kode pairing" helper="Nomor WhatsApp yang dipasang, contoh 0812…; tidak disimpan.">
            <input className="sq-admin-input" inputMode="tel" autoComplete="off" value={phone} onChange={(event) => onPhone(event.target.value)} />
          </Field>
          <button type="button" className={`${secondaryButton} mt-2 w-full`} disabled={phone.replace(/\D/g, "").length < 8} onClick={() => onStart("kode")}><PlugZap className="h-4 w-4" aria-hidden="true" /> Minta kode pairing</button>
        </div>
      </div>
    );
  }
  if (view.step === "working") return <p className="mt-3 text-sm text-muted-foreground" data-state="loading">Menyiapkan nomor di mesin…</p>;
  if (view.step === "qr") {
    return (
      <div className="mt-3">
        {view.qr ? <img src={view.qr} alt="Kode QR untuk menautkan WhatsApp" className="mx-auto aspect-square w-full max-w-[18rem] rounded-xl border border-border bg-white p-2" /> : <p className="text-sm text-muted-foreground">Menunggu kode QR dari mesin…</p>}
        {instructions}
        <p className="mt-2 text-center text-xs text-muted-foreground" aria-live="polite">Status diperbarui otomatis · {view.secondsLeft} detik lagi</p>
      </div>
    );
  }
  if (view.step === "kode") {
    return (
      <div className="mt-3 text-center">
        <p className="font-mono text-3xl font-bold tracking-[0.2em] text-brand-heading">{view.code}</p>
        {instructions}
        <p className="mt-1 text-sm text-muted-foreground">Pilih <strong>Tautkan dengan nomor telepon</strong> lalu masukkan kode di atas.</p>
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">Status diperbarui otomatis · {view.secondsLeft} detik lagi</p>
      </div>
    );
  }
  if (view.step === "connected") {
    return <p className="mt-3 rounded-xl bg-success-soft px-3 py-3 text-sm font-bold text-success-ink">Tersambung{view.nomor ? ` · ${view.nomor}` : ""}</p>;
  }
  if (view.step === "expired") return <p className="mt-3 text-sm text-muted-foreground">Waktu pemasangan habis. Tutup lalu coba pasang lagi.</p>;
  return <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">{view.message}</p>;
}
