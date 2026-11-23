import { BookOpen, Copy, Eye, EyeOff, Globe, KeyRound, Merge, Plus, QrCode, RotateCcw, Settings2, Trash2, Unplug } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  kirimFetch,
  KirimRequestError,
  type KirimDevice,
  type KirimGatewayCardNumber,
  type KirimGatewayDetail,
  type KirimGatewayKey,
  type KirimGatewayKeySummary,
  type KirimGatewayNumber,
} from "@/kirim/api";
import { deviceStatusLabel, deviceStatusTone } from "@/kirim/labels";
import { dangerButton, Field, Panel, primaryButton, secondaryButton, StateCard } from "@/kirim/KirimShell";

/**
 * ADR-0011 amendment 2026-11-17, reshaped by the owner on 2026-11-17.
 *
 * Numbers used by portals and applications outside Sabilul Qur'an Suite used to live as a list
 * inside one combined card. The owner asked for the opposite: one tile to add a number, and then
 * **each number is a card of its own**, the same shape as an application's card, with its API key
 * managed on that card rather than on a shared one.
 *
 * The card's face still never names an application (Kirim does not record who uses a key); the
 * number's own label is the operator's note for that.
 */

export const DOCS_PATH = "/dokumentasi-api";

/** Which device-level action a card asks the page to open; pairing and the number dialogs live there. */
export type GerbangDeviceAction =
  | { kind: "pair"; device: KirimDevice }
  | { kind: "sambung-ulang"; device: KirimDevice }
  | { kind: "disconnect"; device: KirimDevice }
  | { kind: "edit"; device: KirimDevice }
  | { kind: "deactivate"; device: KirimDevice }
  | { kind: "gabung"; device: KirimDevice; ke: { kode: string; label: string } }
  | { kind: "hapus-nomor"; device: KirimDevice };

/** The one tile that adds a number. It holds nothing else: the numbers themselves are cards. */
export function TambahNomorLuarTile({ busy, onAdd }: { busy: boolean; onAdd: () => void }) {
  return (
    <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface p-5 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Globe className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <h2 className="font-display text-lg font-bold text-brand-heading">Nomor aplikasi luar</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Untuk portal atau aplikasi di luar Sabilul Qur&rsquo;an Suite</p>
      </div>
      <button type="button" className={primaryButton} disabled={busy} onClick={onAdd}>
        <Plus className="h-4 w-4" aria-hidden="true" /> Tambah nomor
      </button>
    </div>
  );
}

/** One outside number, in the same shape as an application card. */
export function NomorLuarCard({ nomor, onDevice, onKeys }: {
  nomor: KirimGatewayCardNumber;
  onDevice: (action: GerbangDeviceAction) => void;
  onKeys: () => void;
}) {
  const inactive = nomor.status === "nonaktif";
  /** A number with no engine behind it has no WhatsApp session to pair, reconnect or drop. */
  const engineless = nomor.provider === "log";
  /** "Hapus" is offered only when there is no live WhatsApp session to lose (never mid-pairing). */
  const canDelete = engineless || (nomor.status !== "tersambung" && nomor.status !== "menunggu_pairing");
  return (
    <Panel className="h-full">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Globe className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-bold text-brand-heading">{nomor.label}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Nomor aplikasi luar · <span className="font-mono">{nomor.kode}</span></p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${deviceStatusTone[nomor.status]}`}>{deviceStatusLabel[nomor.status]}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div><dt className="text-xs text-muted-foreground">Nomor</dt><dd className="font-semibold">{nomor.nomor_tersamar ?? "—"}</dd></div>
        <div>
          <dt className="text-xs text-muted-foreground">Kunci API</dt>
          <dd className="font-semibold">
            {nomor.kunci.length === 0 ? <span className="text-muted-foreground">belum ada</span>
              : nomor.kunci.length === 1 ? <span className="font-mono text-xs">{nomor.kunci[0]!.awalan}…</span>
              : <span>{nomor.kunci.length} kunci</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Antrean</dt>
          <dd className="font-semibold">{nomor.antrean?.antre ?? 0} antre · {nomor.antrean?.gagal_hari_ini ?? 0} gagal hari ini{nomor.antrean_dijeda ? " · dijeda" : ""}</dd>
        </div>
        <div><dt className="text-xs text-muted-foreground">Jam kirim · laju</dt><dd className="font-semibold">{nomor.jam_kirim_mulai}–{nomor.jam_kirim_selesai} WIB · {nomor.rate_per_menit}/menit</dd></div>
      </dl>

      {nomor.kunci.length > 0 ? (
        lastKeyUse(nomor.kunci)
          ? <p className="mt-2 text-xs text-muted-foreground">Kunci terakhir dipakai {formatDate(lastKeyUse(nomor.kunci)!)}.</p>
          : <p className="mt-2 text-xs text-muted-foreground">Kunci belum pernah dipakai.</p>
      ) : null}
      {nomor.webhook_terdaftar ? <p className="mt-1 text-xs text-muted-foreground">Webhook terdaftar.</p> : null}
      {engineless && !inactive ? <p className="mt-1 text-xs text-muted-foreground">Belum ada mesin WhatsApp di balik nomor ini; pilih mesinnya lewat Ubah.</p> : null}

      {nomor.nomor_ganda && !inactive ? (
        <div role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">
          <p>WhatsApp di nomor ini sama dengan <strong>{nomor.nomor_ganda.label}</strong>. Pesan masuk ditahan sampai disambungkan ke nomor itu.</p>
          <button type="button" className={`${secondaryButton} mt-2`} onClick={() => onDevice({ kind: "gabung", device: nomor, ke: nomor.nomor_ganda! })}>
            <Merge className="h-4 w-4" aria-hidden="true" /> Sambungkan ke nomor yang ada
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {!inactive ? (
          <>
            <button type="button" className={primaryButton} onClick={onKeys}><KeyRound className="h-4 w-4" aria-hidden="true" /> Kunci API</button>
            {engineless ? null : nomor.status === "belum_dipasang" ? (
              <button type="button" className={secondaryButton} onClick={() => onDevice({ kind: "pair", device: nomor })}><QrCode className="h-4 w-4" aria-hidden="true" /> Pasang</button>
            ) : (
              <button type="button" className={secondaryButton} onClick={() => onDevice({ kind: "sambung-ulang", device: nomor })}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Sambungkan ulang</button>
            )}
            <button type="button" className={secondaryButton} onClick={() => onDevice({ kind: "edit", device: nomor })}><Settings2 className="h-4 w-4" aria-hidden="true" /> Ubah</button>
            {!engineless && nomor.status !== "belum_dipasang" ? (
              <button type="button" className={dangerButton} onClick={() => onDevice({ kind: "disconnect", device: nomor })}><Unplug className="h-4 w-4" aria-hidden="true" /> Putuskan</button>
            ) : null}
            {canDelete ? (
              <button type="button" className={dangerButton} onClick={() => onDevice({ kind: "hapus-nomor", device: nomor })}><Trash2 className="h-4 w-4" aria-hidden="true" /> Hapus</button>
            ) : null}
          </>
        ) : (
          <>
            <p className="w-full text-sm text-muted-foreground">Nomor dinonaktifkan.</p>
            <button type="button" className={dangerButton} onClick={() => onDevice({ kind: "hapus-nomor", device: nomor })}><Trash2 className="h-4 w-4" aria-hidden="true" /> Hapus</button>
          </>
        )}
        <a className={secondaryButton} href={DOCS_PATH} target="_blank" rel="noreferrer"><BookOpen className="h-4 w-4" aria-hidden="true" /> Dokumentasi API</a>
      </div>
    </Panel>
  );
}

export type KunciDialogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; nomor: KirimGatewayNumber };

/**
 * The key pop-up for one number: a number may carry several keys at once (§17), so two outside
 * applications can share one WhatsApp line each with its own key. Create, copy once, rotate, revoke
 * each key on its own. Never a page-level panel (2026-11-13).
 */
export function KunciDialog({ kode, onClose, onChanged, preview }: {
  kode: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  preview?: KunciDialogState;
}) {
  const [state, setState] = useState<KunciDialogState>(preview ?? { status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview) return;
    try {
      const detail = await kirimFetch<KirimGatewayDetail>("/gerbang");
      const nomor = detail.nomor.find((item) => item.kode === kode);
      setState(nomor ? { status: "ready", nomor } : { status: "error" });
    } catch {
      setState({ status: "error" });
    }
  }, [kode, preview]);

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
      setError(failure instanceof KirimRequestError ? failure.message : "Kirim sedang tidak dapat dihubungi. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KunciDialogView
      state={state}
      busy={busy}
      error={error}
      onClose={onClose}
      onRetry={() => { setState({ status: "loading" }); void load(); }}
      onAddKey={() => void run(async () => { await kirimFetch(`/gerbang/nomor/${kode}/kunci`, { method: "POST", body: {} }); })}
      onRotateKey={(id) => void run(async () => { await kirimFetch(`/gerbang/nomor/${kode}/kunci/${id}/putar`, { method: "POST", body: {} }); })}
      onRevokeKey={(id, alasan) => void run(async () => { await kirimFetch(`/gerbang/nomor/${kode}/kunci/${id}/cabut`, { method: "POST", body: { alasan } }); })}
    />
  );
}

export function KunciDialogView({ state, busy, error, onClose, onRetry, onAddKey, onRotateKey, onRevokeKey }: {
  state: KunciDialogState;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onAddKey: () => void;
  onRotateKey: (id: string) => void;
  onRevokeKey: (id: string, alasan: string) => void;
}) {
  const title = state.status === "ready" ? `Kunci API ${state.nomor.label}` : "Kunci API";
  const keys = state.status === "ready" ? state.nomor.kunci : [];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface-raised p-5 shadow-[var(--shadow-raised)] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-brand-heading">{title}</h2>
          <a className={secondaryButton} href={DOCS_PATH} target="_blank" rel="noreferrer"><BookOpen className="h-4 w-4" aria-hidden="true" /> Dokumentasi API</a>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Beri tiap aplikasi luar kuncinya sendiri. Satu nomor boleh punya beberapa kunci agar dua aplikasi berbagi satu WhatsApp. Memutar ulang atau mencabut satu kunci tidak memengaruhi kunci lain atau sesi WhatsApp.</p>

        {state.status === "loading" ? <div className="mt-4"><StateCard kind="loading" title="Memuat kunci" /></div> : null}
        {state.status === "error" ? (
          <div className="mt-4"><StateCard kind="error" title="Kunci belum dapat dimuat" action={<button type="button" className={secondaryButton} onClick={onRetry}>Coba lagi</button>} /></div>
        ) : null}
        {state.status === "ready" ? (
          <div className="mt-4 space-y-3">
            {keys.length === 0 ? (
              <p className="rounded-xl bg-surface p-3 text-sm text-muted-foreground">Belum ada kunci untuk nomor ini.</p>
            ) : (
              keys.map((kunci) => (
                <KeyBlock key={kunci.id} kunci={kunci} busy={busy} onRotate={() => onRotateKey(kunci.id)} onRevoke={(alasan) => onRevokeKey(kunci.id, alasan)} />
              ))
            )}
            <button type="button" className={primaryButton} disabled={busy} onClick={onAddKey}>
              <Plus className="h-4 w-4" aria-hidden="true" /> {keys.length === 0 ? "Buat kunci" : "Tambah kunci"}
            </button>
          </div>
        ) : null}

        {error ? <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink" role="alert">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <button type="button" className={secondaryButton} onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  );
}

/** One key: hidden by default, shown or copied on request; rotate replaces it, revoke removes it. */
function KeyBlock({ kunci, busy, onRotate, onRevoke }: {
  kunci: KirimGatewayKey;
  busy: boolean;
  onRotate: () => void;
  onRevoke: (alasan: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<"putar" | "cabut" | null>(null);
  const [alasan, setAlasan] = useState("");
  const copy = () => {
    if (!kunci.kunci) return;
    void navigator.clipboard?.writeText(kunci.kunci).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <div className="rounded-xl bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-mono text-xs font-bold text-brand-heading">{kunci.awalan}…</span>
        <span className="text-xs text-muted-foreground">dibuat {formatDate(kunci.dibuat_at)} · {kunci.terakhir_dipakai_at ? `terakhir dipakai ${formatDate(kunci.terakhir_dipakai_at)}` : "belum pernah dipakai"}</span>
      </div>
      <code className="mt-2 block break-all rounded-lg bg-surface-raised px-3 py-2 font-mono text-sm" data-testid={shown && kunci.kunci ? "kunci-api" : undefined}>
        {shown && kunci.kunci ? kunci.kunci : `${kunci.awalan}${"•".repeat(24)}`}
      </code>
      {!kunci.kunci ? <p className="mt-1 text-xs text-warning-ink">Kunci lama tidak bisa ditampilkan lagi; putar ulang untuk mendapatkan kunci baru.</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {kunci.kunci ? (
          <>
            <button type="button" className={secondaryButton} onClick={() => setShown((value) => !value)}>{shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />} {shown ? "Sembunyikan" : "Tampilkan"}</button>
            <button type="button" className={secondaryButton} onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" /> {copied ? "Tersalin" : "Salin"}</button>
          </>
        ) : null}
        <button type="button" className={secondaryButton} disabled={busy} onClick={() => { setConfirming("putar"); setAlasan(""); }}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Putar ulang</button>
        <button type="button" className={dangerButton} disabled={busy} onClick={() => { setConfirming("cabut"); setAlasan(""); }}>Cabut</button>
      </div>
      {confirming === "putar" ? (
        <Confirm text="Kunci lama langsung berhenti berlaku; aplikasi yang memakainya harus diberi kunci baru. WhatsApp tetap tersambung." confirmLabel="Putar ulang kunci" danger={false} busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => { onRotate(); setConfirming(null); }} />
      ) : null}
      {confirming === "cabut" ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-surface-raised p-3">
          <Field label="Alasan pencabutan"><input className="sq-admin-input" value={alasan} maxLength={500} onChange={(event) => setAlasan(event.target.value)} /></Field>
          <button type="button" className={dangerButton} disabled={busy || !alasan.trim()} onClick={() => { onRevoke(alasan.trim()); setConfirming(null); }}>Cabut kunci</button>
          <button type="button" className={secondaryButton} onClick={() => setConfirming(null)}>Batal</button>
        </div>
      ) : null}
    </div>
  );
}

function Confirm({ text, confirmLabel, danger, busy, onCancel, onConfirm }: { text: ReactNode; confirmLabel: string; danger: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="mt-2 rounded-xl bg-surface-raised p-3">
      <p className="text-sm text-muted-foreground">{text}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={danger ? dangerButton : primaryButton} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className={secondaryButton} onClick={onCancel}>Batal</button>
      </div>
    </div>
  );
}

/** The most recent "last used" across a number's keys, or null if none has ever been used. */
function lastKeyUse(keys: KirimGatewayKeySummary[]): string | null {
  return keys.map((key) => key.terakhir_dipakai_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}
