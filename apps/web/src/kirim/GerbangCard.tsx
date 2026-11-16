import { BookOpen, Copy, KeyRound, Plus, QrCode, RotateCcw, Unplug, Globe } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  kirimFetch,
  KirimRequestError,
  type KirimApiKey,
  type KirimDevice,
  type KirimGatewayCard,
  type KirimGatewayDetail,
  type KirimIssuedKey,
} from "@/kirim/api";
import { deviceStatusLabel, deviceStatusTone } from "@/kirim/labels";
import { dangerButton, Field, Panel, primaryButton, secondaryButton, StateCard } from "@/kirim/KirimShell";

/**
 * ADR-0011 amendment 2026-11-17: the one generic card for portals and applications outside
 * Sabilul Qur'an Suite. Its face never names an application; names live in the pop-up next to
 * the keys. The card holds several numbers; each key is bound to one of them.
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

/** The pop-up: loads the card's numbers and keys, issues and revokes keys, and asks the page to pair numbers. */
export function GerbangDialog({ onDevice, onClose, onChanged, preview }: {
  onDevice: (action: GerbangDeviceAction) => void;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  preview?: GerbangDialogState;
}) {
  const [state, setState] = useState<GerbangDialogState>(preview ?? { status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<KirimIssuedKey | null>(null);

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
      issued={issued}
      busy={busy}
      error={error}
      onClose={onClose}
      onRetry={() => { setState({ status: "loading" }); void load(); }}
      onNewNumber={() => void run(async () => {
        const device = await kirimFetch<KirimDevice>("/gerbang/nomor-baru", { method: "POST", body: {} });
        if (device.provider === "jalurpesan") onDevice({ kind: "pair", device });
      })}
      onDevice={onDevice}
      onCreateKey={(namaAplikasi, device) => void run(async () => {
        setIssued(await kirimFetch<KirimIssuedKey>("/gerbang/kunci", { method: "POST", body: { nama_aplikasi: namaAplikasi, device } }));
      })}
      onRevokeKey={(id, alasan) => void run(async () => {
        await kirimFetch(`/gerbang/kunci/${id}/cabut`, { method: "POST", body: { alasan } });
      })}
      onDismissIssued={() => setIssued(null)}
    />
  );
}

export function GerbangDialogView({ state, issued, busy, error, onClose, onRetry, onNewNumber, onDevice, onCreateKey, onRevokeKey, onDismissIssued }: {
  state: GerbangDialogState;
  issued: KirimIssuedKey | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onNewNumber: () => void;
  onDevice: (action: GerbangDeviceAction) => void;
  onCreateKey: (namaAplikasi: string, device: string) => void;
  onRevokeKey: (id: string, alasan: string) => void;
  onDismissIssued: () => void;
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
            <Section title="Nomor" action={<button type="button" className={secondaryButton} disabled={busy} onClick={onNewNumber}><Plus className="h-4 w-4" aria-hidden="true" /> Sambungkan nomor baru</button>}>
              {state.detail.nomor.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada nomor. Sambungkan nomor baru, lalu pindai QR dari HP nomor yang akan dipakai aplikasi luar.</p>
              ) : (
                <ul className="divide-y divide-border/70">
                  {state.detail.nomor.map((nomor) => (
                    <li key={nomor.kode} className="flex flex-wrap items-center gap-2 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-brand-heading">{nomor.label} <span className="font-mono text-[11px] font-normal text-muted-foreground">{nomor.kode}</span></p>
                        <p className="text-xs text-muted-foreground">{nomor.nomor_tersamar ?? "Belum terpasang"} · {nomor.kunci_aktif} kunci aktif{nomor.antrean ? ` · ${nomor.antrean.antre} antre` : ""}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${deviceStatusTone[nomor.status]}`}>{deviceStatusLabel[nomor.status]}</span>
                      <NumberActions device={nomor} onDevice={onDevice} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {issued ? <IssuedKey issued={issued} onDismiss={onDismissIssued} /> : null}

            <Section title="Kunci API">
              <KeyForm numbers={state.detail.nomor} busy={busy} onCreate={onCreateKey} />
              {state.detail.kunci.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Belum ada kunci. Satu kunci untuk satu aplikasi, terikat ke satu nomor di kartu ini.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border/70">
                  {state.detail.kunci.map((kunci) => <KeyRow key={kunci.id} kunci={kunci} busy={busy} onRevoke={onRevokeKey} />)}
                </ul>
              )}
            </Section>
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

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function NumberActions({ device, onDevice }: { device: KirimDevice; onDevice: (action: GerbangDeviceAction) => void }) {
  if (device.status === "nonaktif") return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {device.provider === "jalurpesan" && device.status === "belum_dipasang" ? (
        <button type="button" className={secondaryButton} onClick={() => onDevice({ kind: "pair", device })}><QrCode className="h-4 w-4" aria-hidden="true" /> Pasang</button>
      ) : null}
      {device.provider === "jalurpesan" && device.status !== "belum_dipasang" ? (
        <button type="button" className={secondaryButton} onClick={() => onDevice({ kind: "sambung-ulang", device })}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Sambungkan ulang</button>
      ) : null}
      {device.provider === "jalurpesan" && device.status !== "belum_dipasang" ? (
        <button type="button" className={dangerButton} onClick={() => onDevice({ kind: "disconnect", device })}><Unplug className="h-4 w-4" aria-hidden="true" /> Putuskan</button>
      ) : null}
    </div>
  );
}

function KeyForm({ numbers, busy, onCreate }: { numbers: KirimDevice[]; busy: boolean; onCreate: (namaAplikasi: string, device: string) => void }) {
  const usable = numbers.filter((nomor) => nomor.status !== "nonaktif");
  const [nama, setNama] = useState("");
  const [device, setDevice] = useState(usable[0]?.kode ?? "");
  const chosen = usable.some((nomor) => nomor.kode === device) ? device : usable[0]?.kode ?? "";
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <Field label="Nama aplikasi pemakai" helper="Hanya tampil di sini, untuk tahu kunci mana milik siapa.">
        <input className="sq-admin-input" value={nama} maxLength={60} placeholder="mis. Toko online" onChange={(event) => setNama(event.target.value)} />
      </Field>
      <Field label="Nomor">
        <select className="sq-admin-input" value={chosen} disabled={usable.length === 0} onChange={(event) => setDevice(event.target.value)}>
          {usable.length === 0 ? <option value="">Belum ada nomor</option> : null}
          {usable.map((nomor) => <option key={nomor.kode} value={nomor.kode}>{nomor.label}{nomor.nomor_tersamar ? ` · ${nomor.nomor_tersamar}` : ""}</option>)}
        </select>
      </Field>
      <button type="button" className={primaryButton} disabled={busy || !nama.trim() || !chosen} onClick={() => { onCreate(nama.trim(), chosen); setNama(""); }}>
        <KeyRound className="h-4 w-4" aria-hidden="true" /> Buat kunci
      </button>
    </div>
  );
}

/** Shown once: the plain key never comes back from the server. */
function IssuedKey({ issued, onDismiss }: { issued: KirimIssuedKey; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-5 rounded-xl border border-warning-ink/30 bg-warning-soft p-4" role="status">
      <p className="text-sm font-bold text-warning-ink">Kunci untuk {issued.nama_aplikasi} ({issued.nomor.label}). Salin sekarang: kunci ini tidak ditampilkan lagi.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-surface px-3 py-2 font-mono text-sm" data-testid="kunci-api">{issued.kunci}</code>
        <button type="button" className={secondaryButton} onClick={() => {
          void navigator.clipboard?.writeText(issued.kunci).then(() => setCopied(true), () => setCopied(false));
        }}><Copy className="h-4 w-4" aria-hidden="true" /> {copied ? "Tersalin" : "Salin"}</button>
      </div>
      <p className="mt-2 text-xs text-warning-ink">Simpan di berkas env aplikasi di server, bukan di kode atau di chat. Kunci yang hilang diganti dengan kunci baru, lalu yang lama dicabut.</p>
      <button type="button" className={`${secondaryButton} mt-3`} onClick={onDismiss}>Sudah saya simpan</button>
    </div>
  );
}

function KeyRow({ kunci, busy, onRevoke }: { kunci: KirimApiKey; busy: boolean; onRevoke: (id: string, alasan: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [alasan, setAlasan] = useState("");
  const revoked = Boolean(kunci.dicabut_at);
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-semibold ${revoked ? "text-muted-foreground line-through" : "text-brand-heading"}`}>{kunci.nama_aplikasi} <span className="font-mono text-[11px] font-normal text-muted-foreground">{kunci.awalan}…</span></p>
          <p className="text-xs text-muted-foreground">
            {kunci.nomor.label} · dibuat {formatDate(kunci.dibuat_at)}
            {kunci.terakhir_dipakai_at ? ` · terakhir dipakai ${formatDate(kunci.terakhir_dipakai_at)}` : " · belum pernah dipakai"}
            {revoked ? ` · dicabut ${formatDate(kunci.dicabut_at!)}` : ""}
          </p>
        </div>
        {!revoked && !confirming ? <button type="button" className={dangerButton} disabled={busy} onClick={() => setConfirming(true)}>Cabut</button> : null}
      </div>
      {confirming ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-surface p-3">
          <Field label="Alasan pencabutan"><input className="sq-admin-input" value={alasan} maxLength={500} onChange={(event) => setAlasan(event.target.value)} /></Field>
          <button type="button" className={dangerButton} disabled={busy || !alasan.trim()} onClick={() => { onRevoke(kunci.id, alasan.trim()); setConfirming(false); }}>Cabut kunci</button>
          <button type="button" className={secondaryButton} onClick={() => setConfirming(false)}>Batal</button>
        </div>
      ) : null}
    </li>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}
