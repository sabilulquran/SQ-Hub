import { BookOpen, Copy, Eye, EyeOff, Globe, KeyRound, Plus, QrCode, RotateCcw, Unplug } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { kirimFetch, KirimRequestError, type KirimDevice, type KirimGatewayCard, type KirimGatewayDetail, type KirimGatewayNumber } from "@/kirim/api";
import { deviceStatusLabel, deviceStatusTone } from "@/kirim/labels";
import { dangerButton, Field, Panel, primaryButton, secondaryButton, StateCard } from "@/kirim/KirimShell";

/**
 * ADR-0011 amendment 2026-11-17: the one generic card for portals and applications outside
 * Sabilul Qur'an Suite. Its face never names an application. The card holds several numbers and
 * each number has its own API key, like a JalurPesan device key: the owner copies it from the
 * pop-up into whatever application they want. Rotating or revoking a key never touches the
 * WhatsApp session.
 */

export const DOCS_PATH = "/dokumentasi-api";

/** Which device-level action the pop-up asks the page to open (pairing and the number dialogs live on the page). */
export type GerbangDeviceAction =
  | { kind: "pair"; device: KirimDevice }
  | { kind: "sambung-ulang"; device: KirimDevice }
  | { kind: "disconnect"; device: KirimDevice }
  | { kind: "deactivate"; device: KirimDevice };

export function GerbangCard({ card, onOpen }: { card: KirimGatewayCard; onOpen: () => void }) {
  const connected = card.nomor.filter((nomor) => nomor.status === "tersambung").length;
  return (
    <Panel className="h-full border-dashed">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Globe className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-bold text-brand-heading">{card.nama}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{card.keterangan}</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div><dt className="text-xs text-muted-foreground">Nomor</dt><dd className="font-semibold">{card.nomor.length === 0 ? "Belum ada" : `${card.nomor.length} nomor · ${connected} tersambung`}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Kunci API aktif</dt><dd className="font-semibold">{card.kunci_aktif}</dd></div>
      </dl>
      {card.nomor.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {card.nomor.map((nomor) => (
            <li key={nomor.kode} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{nomor.label}{nomor.nomor_tersamar ? <span className="text-muted-foreground"> · {nomor.nomor_tersamar}</span> : null}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${deviceStatusTone[nomor.status]}`}>{deviceStatusLabel[nomor.status]}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={primaryButton} onClick={onOpen}><KeyRound className="h-4 w-4" aria-hidden="true" /> Kelola nomor dan kunci</button>
        <a className={secondaryButton} href={DOCS_PATH} target="_blank" rel="noreferrer"><BookOpen className="h-4 w-4" aria-hidden="true" /> Dokumentasi API</a>
      </div>
    </Panel>
  );
}

export type GerbangDialogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; detail: KirimGatewayDetail };

/** The pop-up: loads the card's numbers with their keys, rotates and revokes keys, and asks the page to pair numbers. */
export function GerbangDialog({ onDevice, onClose, onChanged, preview }: {
  onDevice: (action: GerbangDeviceAction) => void;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  preview?: GerbangDialogState;
}) {
  const [state, setState] = useState<GerbangDialogState>(preview ?? { status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview) return;
    try {
      setState({ status: "ready", detail: await kirimFetch<KirimGatewayDetail>("/gerbang") });
    } catch {
      setState({ status: "error" });
    }
  }, [preview]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await load();
      await onChanged();
    } catch (failure) {
      setError(failure instanceof KirimRequestError ? failure.message : "Kirim SQ sedang tidak dapat dihubungi. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GerbangDialogView
      state={state}
      busy={busy}
      error={error}
      onClose={onClose}
      onRetry={() => { setState({ status: "loading" }); void load(); }}
      onNewNumber={() => void run(async () => {
        const device = await kirimFetch<KirimDevice>("/gerbang/nomor-baru", { method: "POST", body: {} });
        if (device.provider === "jalurpesan") onDevice({ kind: "pair", device });
      })}
      onDevice={onDevice}
      onRotateKey={(kode) => void run(async () => { await kirimFetch(`/gerbang/nomor/${kode}/kunci`, { method: "POST", body: {} }); })}
      onRevokeKey={(kode, alasan) => void run(async () => { await kirimFetch(`/gerbang/nomor/${kode}/kunci/cabut`, { method: "POST", body: { alasan } }); })}
    />
  );
}

export function GerbangDialogView({ state, busy, error, onClose, onRetry, onNewNumber, onDevice, onRotateKey, onRevokeKey }: {
  state: GerbangDialogState;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onNewNumber: () => void;
  onDevice: (action: GerbangDeviceAction) => void;
  onRotateKey: (kode: string) => void;
  onRevokeKey: (kode: string, alasan: string) => void;
}) {
  const title = state.status === "ready" ? state.detail.nama : "Aplikasi luar";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface-raised p-5 shadow-[var(--shadow-raised)] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-brand-heading">{title}</h2>
            {state.status === "ready" ? <p className="mt-0.5 text-sm text-muted-foreground">{state.detail.keterangan}</p> : null}
          </div>
          <a className={secondaryButton} href={DOCS_PATH} target="_blank" rel="noreferrer"><BookOpen className="h-4 w-4" aria-hidden="true" /> Dokumentasi API</a>
        </div>

        {state.status === "loading" ? <div className="mt-4"><StateCard kind="loading" title="Memuat nomor dan kunci" /></div> : null}
        {state.status === "error" ? (
          <div className="mt-4"><StateCard kind="error" title="Kartu belum dapat dimuat" action={<button type="button" className={secondaryButton} onClick={onRetry}>Coba lagi</button>} /></div>
        ) : null}

        {state.status === "ready" ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">Tiap nomor punya kunci API sendiri. Salin kunci itu ke aplikasi luar yang akan memakai nomornya. Memutar ulang atau mencabut kunci tidak memutus WhatsApp.</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Nomor</h3>
              <button type="button" className={secondaryButton} disabled={busy} onClick={onNewNumber}><Plus className="h-4 w-4" aria-hidden="true" /> Sambungkan nomor baru</button>
            </div>
            {state.detail.nomor.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Belum ada nomor. Sambungkan nomor baru, lalu pindai QR dari HP nomor yang akan dipakai aplikasi luar.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {state.detail.nomor.map((nomor) => <NumberRow key={nomor.kode} nomor={nomor} busy={busy} onDevice={onDevice} onRotateKey={onRotateKey} onRevokeKey={onRevokeKey} />)}
              </ul>
            )}
          </>
        ) : null}

        {error ? <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink" role="alert">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <button type="button" className={secondaryButton} onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  );
}

function NumberRow({ nomor, busy, onDevice, onRotateKey, onRevokeKey }: {
  nomor: KirimGatewayNumber;
  busy: boolean;
  onDevice: (action: GerbangDeviceAction) => void;
  onRotateKey: (kode: string) => void;
  onRevokeKey: (kode: string, alasan: string) => void;
}) {
  const inactive = nomor.status === "nonaktif";
  return (
    <li className="rounded-xl border border-border/70 bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-brand-heading">{nomor.label} <span className="font-mono text-[11px] font-normal text-muted-foreground">{nomor.kode}</span></p>
          <p className="text-xs text-muted-foreground">{nomor.nomor_tersamar ?? "Belum terpasang"}{nomor.antrean ? ` · ${nomor.antrean.antre} antre · ${nomor.antrean.gagal_hari_ini} gagal hari ini` : ""}{nomor.webhook_terdaftar ? " · webhook terdaftar" : ""}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${deviceStatusTone[nomor.status]}`}>{deviceStatusLabel[nomor.status]}</span>
        {!inactive ? <NumberActions device={nomor} onDevice={onDevice} /> : null}
      </div>
      {!inactive ? <KeyBlock nomor={nomor} busy={busy} onRotateKey={onRotateKey} onRevokeKey={onRevokeKey} /> : null}
    </li>
  );
}

function NumberActions({ device, onDevice }: { device: KirimDevice; onDevice: (action: GerbangDeviceAction) => void }) {
  if (device.provider !== "jalurpesan") return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {device.status === "belum_dipasang" ? (
        <button type="button" className={secondaryButton} onClick={() => onDevice({ kind: "pair", device })}><QrCode className="h-4 w-4" aria-hidden="true" /> Pasang</button>
      ) : (
        <>
          <button type="button" className={secondaryButton} onClick={() => onDevice({ kind: "sambung-ulang", device })}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Sambungkan ulang</button>
          <button type="button" className={dangerButton} onClick={() => onDevice({ kind: "disconnect", device })}><Unplug className="h-4 w-4" aria-hidden="true" /> Putuskan</button>
        </>
      )}
    </div>
  );
}

/** The number's key: hidden by default, shown or copied on request; rotate replaces it, revoke removes it. */
function KeyBlock({ nomor, busy, onRotateKey, onRevokeKey }: { nomor: KirimGatewayNumber; busy: boolean; onRotateKey: (kode: string) => void; onRevokeKey: (kode: string, alasan: string) => void }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<"putar" | "cabut" | null>(null);
  const [alasan, setAlasan] = useState("");
  const kunci = nomor.kunci;
  const copy = () => {
    if (!kunci?.kunci) return;
    void navigator.clipboard?.writeText(kunci.kunci).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <div className="mt-3 rounded-xl bg-surface-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-bold text-brand-heading">Kunci API</span>
        {kunci ? (
          <span className="text-xs text-muted-foreground">dibuat {formatDate(kunci.dibuat_at)} · {kunci.terakhir_dipakai_at ? `terakhir dipakai ${formatDate(kunci.terakhir_dipakai_at)}` : "belum pernah dipakai"}</span>
        ) : (
          <span className="text-xs text-muted-foreground">belum ada</span>
        )}
      </div>
      {kunci ? (
        <code className="mt-2 block break-all rounded-lg bg-surface px-3 py-2 font-mono text-sm" data-testid={shown && kunci.kunci ? "kunci-api" : undefined}>
          {shown && kunci.kunci ? kunci.kunci : `${kunci.awalan}${"•".repeat(24)}`}
        </code>
      ) : null}
      {kunci && !kunci.kunci ? <p className="mt-1 text-xs text-warning-ink">Kunci lama tidak bisa ditampilkan lagi; putar ulang untuk mendapatkan kunci baru.</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {kunci?.kunci ? (
          <>
            <button type="button" className={secondaryButton} onClick={() => setShown((value) => !value)}>{shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />} {shown ? "Sembunyikan" : "Tampilkan"}</button>
            <button type="button" className={secondaryButton} onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" /> {copied ? "Tersalin" : "Salin"}</button>
          </>
        ) : null}
        {kunci ? (
          <>
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => { setConfirming("putar"); setAlasan(""); }}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Putar ulang</button>
            <button type="button" className={dangerButton} disabled={busy} onClick={() => { setConfirming("cabut"); setAlasan(""); }}>Cabut</button>
          </>
        ) : (
          <button type="button" className={primaryButton} disabled={busy} onClick={() => onRotateKey(nomor.kode)}><KeyRound className="h-4 w-4" aria-hidden="true" /> Buat kunci</button>
        )}
      </div>
      {confirming === "putar" ? (
        <Confirm text="Kunci lama langsung berhenti berlaku; aplikasi yang memakainya harus diberi kunci baru. WhatsApp tetap tersambung." confirmLabel="Putar ulang kunci" danger={false} busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => { onRotateKey(nomor.kode); setConfirming(null); }} />
      ) : null}
      {confirming === "cabut" ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-surface p-3">
          <Field label="Alasan pencabutan"><input className="sq-admin-input" value={alasan} maxLength={500} onChange={(event) => setAlasan(event.target.value)} /></Field>
          <button type="button" className={dangerButton} disabled={busy || !alasan.trim()} onClick={() => { onRevokeKey(nomor.kode, alasan.trim()); setConfirming(null); }}>Cabut kunci</button>
          <button type="button" className={secondaryButton} onClick={() => setConfirming(null)}>Batal</button>
        </div>
      ) : null}
    </div>
  );
}

function Confirm({ text, confirmLabel, danger, busy, onCancel, onConfirm }: { text: ReactNode; confirmLabel: string; danger: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="mt-2 rounded-xl bg-surface p-3">
      <p className="text-sm text-muted-foreground">{text}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={danger ? dangerButton : primaryButton} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className={secondaryButton} onClick={onCancel}>Batal</button>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}
