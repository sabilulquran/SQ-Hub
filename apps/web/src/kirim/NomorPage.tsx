import { AlertTriangle, History, Link2, Pause, Play, Plus, PlugZap, Power, QrCode, RefreshCw, Settings2, Unplug } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { applicationAppearance } from "@/components/applicationAppearance";
import {
  kirimFetch,
  KirimRequestError,
  type KirimConsumer,
  type KirimDevice,
  type KirimDeviceList,
  type KirimModuleCard,
  type KirimModuleList,
  type LiveStatus,
  type PairingResult,
} from "@/kirim/api";
import { deviceStatusLabel, deviceStatusTone, formatTime } from "@/kirim/labels";
import { dangerButton, Field, Panel, primaryButton, ReasonDialog, secondaryButton, StateCard } from "@/kirim/KirimShell";

export type NomorState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "ready"; list: KirimModuleList; consumers: KirimConsumer[] };

type Dialog =
  | { kind: "disconnect" | "deactivate" | "pause" | "resume"; device: KirimDevice }
  | { kind: "edit"; device: KirimDevice }
  | { kind: "pair"; device: KirimDevice }
  | { kind: "tambah"; card: KirimModuleCard }
  | { kind: "ubah-pemakai"; card: KirimModuleCard }
  | { kind: "putuskan-modul"; card: KirimModuleCard };

const POLL_MS = 3_000;
const POLL_LIMIT_MS = 2 * 60_000;

function messageFor(error: unknown): string {
  if (error instanceof KirimRequestError) return error.message;
  return "Kirim SQ sedang tidak dapat dihubungi. Coba lagi.";
}

/** KIRIM-IMPL-003: the Kirim SQ home page, one card per module that may use WhatsApp. */
export function NomorPage({ preview }: { preview?: NomorState }) {
  const [state, setState] = useState<NomorState>(preview ?? { status: "loading" });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview) return;
    try {
      const [list, consumers] = await Promise.all([
        kirimFetch<KirimModuleList>("/modules"),
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

  const run = async <T,>(task: () => Promise<T>, next?: (result: T) => Dialog | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await task();
      setDialog(next ? next(result) : null);
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

  const shared = (device: KirimDevice) =>
    state.status === "ready" ? state.list.modules.find((card) => card.peran === "pemilik" && card.nomor?.kode === device.kode)?.dipakai_juga_oleh ?? [] : [];

  return (
    <>
      <NomorView state={state} onOpen={(next) => { setError(null); setDialog(next); }} onRetry={() => { setState({ status: "loading" }); void load(); }} />
      {dialog?.kind === "disconnect" ? (
        <ReasonDialog title={`Putuskan ${dialog.device.label}?`} body={sharedBody(shared(dialog.device), "Sesi WhatsApp di mesin dilepas. Nomor perlu dipasang ulang sebelum bisa mengirim lagi.")} confirmLabel="Putuskan" danger busy={busy} error={error} onClose={close}
          onConfirm={(alasan) => void run(() => kirimFetch(`/devices/${dialog.device.kode}/disconnect`, { method: "POST", body: { alasan } }))} />
      ) : null}
      {dialog?.kind === "deactivate" ? (
        <ReasonDialog title={`Nonaktifkan ${dialog.device.label}?`} body={sharedBody(shared(dialog.device), "Permintaan kirim baru untuk nomor ini ditolak. Antrean yang ada tidak dihapus.")} confirmLabel="Nonaktifkan" danger busy={busy} error={error} onClose={close}
          onConfirm={(alasan) => void run(() => kirimFetch(`/devices/${dialog.device.kode}/deactivate`, { method: "POST", body: { alasan } }))} />
      ) : null}
      {dialog?.kind === "pause" || dialog?.kind === "resume" ? (
        <ReasonDialog
          title={dialog.kind === "pause" ? `Jeda antrean ${dialog.device.label}?` : `Lanjutkan antrean ${dialog.device.label}?`}
          body={dialog.kind === "pause"
            ? `Pesan tetap diterima dan menunggu di antrean sampai dilanjutkan.${shared(dialog.device).length > 0 ? ` Antrean ${shared(dialog.device).join(", ")} ikut berhenti.` : ""}`
            : "Pesan yang menunggu akan dikirim lagi sesuai jam kirim dan batas laju."}
          confirmLabel={dialog.kind === "pause" ? "Jeda antrean" : "Lanjutkan antrean"}
          busy={busy}
          error={error}
          reasonRequired={false}
          onClose={close}
          onConfirm={(alasan) => void run(() => kirimFetch(`/devices/${dialog.device.kode}/${dialog.kind}`, { method: "POST", body: alasan ? { alasan } : {} }))}
        />
      ) : null}
      {dialog?.kind === "putuskan-modul" && dialog.card.nomor ? (
        <ReasonDialog
          title={`Putuskan ${dialog.card.nama} dari ${dialog.card.nomor.label}?`}
          body={`${dialog.card.nama} berhenti mengirim lewat nomor ini. Nomor tetap tersambung dan ${dialog.card.pemilik_nomor ?? "pemiliknya"} tetap mengirim seperti biasa.`}
          confirmLabel={`Putuskan dari ${dialog.card.nama}`}
          danger
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={(alasan) => void run(() => kirimFetch(`/modules/${dialog.card.application_key}/putuskan`, { method: "POST", body: { alasan } }))}
        />
      ) : null}
      {dialog?.kind === "edit" && state.status === "ready" ? (
        <EditDeviceDialog device={dialog.device} consumers={state.consumers} busy={busy} error={error} onClose={close}
          onSave={(body) => void run(() => kirimFetch(`/devices/${dialog.device.kode}`, { method: "PATCH", body }))} />
      ) : null}
      {(dialog?.kind === "tambah" || dialog?.kind === "ubah-pemakai") && state.status === "ready" ? (
        <TambahDialog
          card={dialog.card}
          numbers={state.list.devices.filter((device) => device.status !== "nonaktif" && device.kode !== dialog.card.nomor?.kode)}
          owners={Object.fromEntries(state.list.modules.filter((card) => card.peran === "pemilik" && card.nomor).map((card) => [card.nomor!.kode, card.nama]))}
          editing={dialog.kind === "ubah-pemakai"}
          busy={busy}
          error={error}
          onClose={close}
          onNewNumber={() => void run(
            () => kirimFetch<KirimModuleCard>(`/modules/${dialog.card.application_key}/nomor-baru`, { method: "POST", body: {} }),
            // Pairing opens right away; a `log` number needs none.
            (created) => (created.nomor?.provider === "jalurpesan" ? { kind: "pair", device: created.nomor } : null),
          )}
          onUseNumber={(device, kodeVerifikasi) => void run(() => kirimFetch(`/modules/${dialog.card.application_key}/pakai-nomor`, { method: "POST", body: { device, kode_verifikasi: kodeVerifikasi } }))}
        />
      ) : null}
      {dialog?.kind === "pair" ? <PairingDialog device={dialog.device} onClose={() => { close(); void load(); }} /> : null}
    </>
  );
}

function sharedBody(sharers: string[], body: string): string {
  return sharers.length > 0
    ? `Nomor ini masih dipakai ${sharers.join(", ")}. Putuskan modul itu dulu dari kartunya, atau pindahkan pemilik nomor lewat Ubah. Untuk menghentikan semua pengiriman sementara, pakai Jeda antrean.`
    : body;
}

export function NomorView({ state, onOpen, onRetry }: { state: NomorState; onOpen: (dialog: Dialog) => void; onRetry: () => void }) {
  const cardNumbers = state.status === "ready"
    ? new Set(state.list.modules.filter((card) => card.peran === "pemilik").map((card) => card.nomor?.kode))
    : new Set<string | undefined>();
  const others = state.status === "ready" ? state.list.devices.filter((device) => !cardNumbers.has(device.kode)) : [];
  return (
    <>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">WhatsApp modul</h1>
        <p className="mt-1 text-sm text-muted-foreground">Satu kartu untuk setiap modul SQ Core yang bisa memakai WhatsApp.</p>
      </div>

      <div className="mt-5 space-y-4">
        {state.status === "loading" ? <StateCard kind="loading" title="Memuat modul" /> : null}
        {state.status === "error" ? (
          <StateCard kind="error" title="Modul belum dapat dimuat" body="Kirim SQ sedang tidak dapat dihubungi." action={<button type="button" className={secondaryButton} onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Coba lagi</button>} />
        ) : null}
        {state.status === "forbidden" ? <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Kirim SQ" /> : null}
        {state.status === "ready" ? (
          <>
            <Warnings list={state.list} />
            {state.list.modules.length === 0 ? (
              <StateCard kind="empty" title="Belum ada modul yang memakai WhatsApp" body="Modul muncul di sini begitu ditandai bisa memakai WhatsApp di registry aplikasi SQ Hub." />
            ) : (
              <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {state.list.modules.map((card) => (
                  <li key={card.application_key}><ModuleCard card={card} onOpen={onOpen} /></li>
                ))}
              </ul>
            )}
            {others.length > 0 ? (
              <section aria-labelledby="nomor-lain" className="pt-2">
                <h2 id="nomor-lain" className="font-display text-lg font-bold text-brand-heading">Nomor tanpa kartu modul</h2>
                <ul className="mt-3 grid gap-4 lg:grid-cols-2">
                  {others.map((device) => (
                    <li key={device.kode}><DeviceCard device={device} onOpen={onOpen} /></li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

function ModuleIcon({ applicationKey, large = false }: { applicationKey: string; large?: boolean }) {
  const { icon: Icon, tile } = applicationAppearance(applicationKey);
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl ${tile} ${large ? "h-12 w-12" : "h-10 w-10"}`}>
      <Icon className={large ? "h-6 w-6" : "h-5 w-5"} aria-hidden="true" />
    </span>
  );
}

export function ModuleCard({ card, onOpen }: { card: KirimModuleCard; onOpen: (dialog: Dialog) => void }) {
  const device = card.nomor;
  if (card.peran === "kosong" || !device) {
    return (
      <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface p-5 text-center">
        <ModuleIcon applicationKey={card.application_key} large />
        <div>
          <h2 className="font-display text-lg font-bold text-brand-heading">{card.nama}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Belum memakai WhatsApp</p>
        </div>
        <button type="button" className={primaryButton} onClick={() => onOpen({ kind: "tambah", card })}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Tambah WhatsApp
        </button>
      </div>
    );
  }
  const owner = card.peran === "pemilik";
  const inactive = device.status === "nonaktif";
  return (
    <Panel className="h-full">
      <div className="flex items-start gap-3">
        <ModuleIcon applicationKey={card.application_key} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-bold text-brand-heading">{card.nama}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{owner ? `Pemilik ${device.label}` : `Memakai nomor milik ${card.pemilik_nomor ?? device.pemilik}`}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${deviceStatusTone[device.status]}`}>{deviceStatusLabel[device.status]}</span>
      </div>
      {owner && card.dipakai_juga_oleh.length > 0 ? (
        <p className="mt-3 rounded-xl bg-info-soft px-3 py-2 text-sm text-info-ink">Dipakai juga oleh <strong>{card.dipakai_juga_oleh.join(", ")}</strong></p>
      ) : null}
      {!owner ? (
        <p className="mt-3 rounded-xl bg-info-soft px-3 py-2 text-sm text-info-ink">Nomor bersama. Jam kirim, laju, dan jeda diatur dari kartu <strong>{card.pemilik_nomor ?? device.pemilik}</strong>.</p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div><dt className="text-xs text-muted-foreground">Nomor</dt><dd className="font-semibold">{device.nomor_tersamar ?? "—"}</dd></div>
        {owner ? (
          <div>
            <dt className="text-xs text-muted-foreground">Provider</dt>
            <dd className="flex flex-wrap items-center gap-1.5 font-semibold">
              {device.provider}
              {device.provider === "log" ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning-ink">Uji — tidak mengirim</span> : null}
            </dd>
          </div>
        ) : (
          <div><dt className="text-xs text-muted-foreground">Boleh mengirim</dt><dd className="font-semibold">{card.jenis.map((jenis) => (jenis === "kode" ? "kode verifikasi" : "notifikasi")).join(", ") || "—"}</dd></div>
        )}
        <div><dt className="text-xs text-muted-foreground">Antrean {card.nama}</dt><dd className="font-semibold">{card.antrean.antre} antre · {card.antrean.gagal_hari_ini} gagal hari ini{device.antrean_dijeda ? " · dijeda" : ""}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Jam kirim · laju</dt><dd className="font-semibold">{device.jam_kirim_mulai}–{device.jam_kirim_selesai} WIB · {device.rate_per_menit}/menit</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {owner ? (
          <OwnerActions device={device} inactive={inactive} onOpen={onOpen} />
        ) : (
          <>
            <button type="button" className={secondaryButton} onClick={() => onOpen({ kind: "ubah-pemakai", card })}><Settings2 className="h-4 w-4" aria-hidden="true" /> Ubah</button>
            <button type="button" className={dangerButton} onClick={() => onOpen({ kind: "putuskan-modul", card })}><Unplug className="h-4 w-4" aria-hidden="true" /> Putuskan dari {card.nama}</button>
          </>
        )}
      </div>
    </Panel>
  );
}

function OwnerActions({ device, inactive, onOpen }: { device: KirimDevice; inactive: boolean; onOpen: (dialog: Dialog) => void }) {
  return (
    <>
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
    </>
  );
}

/**
 * "+ Tambah WhatsApp": a new number (Kirim SQ picks its code, label and tenant, then pairing
 * opens on the card) or an active number of another module. Nothing technical is typed.
 */
export function TambahDialog({ card, numbers, owners = {}, editing, busy, error, onClose, onNewNumber, onUseNumber }: {
  card: KirimModuleCard;
  numbers: KirimDevice[];
  /** Number code → the owning module's name, so the list says "milik HCIS", not a consumer id. */
  owners?: Record<string, string>;
  editing: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onNewNumber: () => void;
  onUseNumber: (device: string, kodeVerifikasi: boolean) => void;
}) {
  const [mode, setMode] = useState<"baru" | "pakai">(editing ? "pakai" : "baru");
  const [device, setDevice] = useState(editing ? card.nomor?.kode ?? "" : numbers[0]?.kode ?? "");
  const [kode, setKode] = useState(editing ? card.jenis.includes("kode") : false);
  const choices = editing && card.nomor ? [card.nomor] : numbers;
  const option = "flex gap-3 rounded-xl border p-3 text-sm";
  return (
    <DialogFrame title={editing ? `Ubah ${card.nama}` : `Tambah WhatsApp untuk ${card.nama}`}>
      {!editing ? <p className="mt-1.5 text-sm text-muted-foreground">Pilih salah satu. Kode nomor, identitas modul, dan kunci webhook disiapkan otomatis.</p> : null}
      <div className="mt-3 space-y-3">
        {!editing ? (
          <label className={`${option} ${mode === "baru" ? "border-brand-primary bg-brand-primary-pale/40" : "border-border"}`}>
            <input type="radio" name="cara" className="mt-1" checked={mode === "baru"} onChange={() => setMode("baru")} />
            <span><strong>Sambungkan nomor baru</strong><br /><span className="text-muted-foreground">Nomor ini menjadi milik {card.nama}; balasan masuk ke {card.nama}. Setelah dibuat, pindai QR langsung terbuka.</span></span>
          </label>
        ) : null}
        {!editing ? (
          <label className={`${option} ${mode === "pakai" ? "border-brand-primary bg-brand-primary-pale/40" : "border-border"}`}>
            <input type="radio" name="cara" className="mt-1" checked={mode === "pakai"} disabled={numbers.length === 0} onChange={() => setMode("pakai")} />
            <span><strong>Pakai nomor yang sudah aktif</strong><br /><span className="text-muted-foreground">{numbers.length === 0 ? "Belum ada nomor aktif." : `${card.nama} ikut mengirim lewat nomor modul lain. Balasan tetap masuk ke pemilik nomor.`}</span></span>
          </label>
        ) : null}
        {mode === "pakai" && choices.length > 0 ? (
          <fieldset className="space-y-2 rounded-xl border border-border p-3 text-sm">
            <legend className="px-1 text-xs font-bold text-brand-heading">Nomor aktif</legend>
            {choices.map((item) => (
              <label key={item.kode} className="flex items-center gap-2">
                <input type="radio" name="nomor" checked={device === item.kode} disabled={editing} onChange={() => setDevice(item.kode)} />
                <span>{item.label} · {item.nomor_tersamar ?? deviceStatusLabel[item.status]} · milik {owners[item.kode] ?? item.pemilik}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 pt-1">
              <input type="checkbox" checked={kode} onChange={(event) => setKode(event.target.checked)} />
              <span>Boleh juga mengirim kode verifikasi (tanpa batas jam kirim)</span>
            </label>
          </fieldset>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">{error}</p> : null}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Batal</button>
        {mode === "baru" ? (
          <button type="button" className={primaryButton} disabled={busy} onClick={onNewNumber}><Plus className="h-4 w-4" aria-hidden="true" /> Buat nomor {card.nama}</button>
        ) : (
          <button type="button" className={primaryButton} disabled={busy || !device} onClick={() => onUseNumber(device, kode)}><Link2 className="h-4 w-4" aria-hidden="true" /> {editing ? "Simpan" : "Sambungkan"}</button>
        )}
      </div>
    </DialogFrame>
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
