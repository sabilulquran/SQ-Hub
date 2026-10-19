import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { kirimFetch, KirimRequestError, type KirimDeviceList, type KirimOptout, type KirimOptoutPage } from "@/kirim/api";
import { cakupanText, formatTime } from "@/kirim/labels";
import { dangerButton, Field, Panel, primaryButton, ReasonDialog, secondaryButton, StateCard } from "@/kirim/KirimShell";

export type JanganHubungiState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "ready"; page: KirimOptoutPage; devices: string[] };

export interface OptoutFilter {
  cakupan: "" | "semua" | "device" | "consumer";
  sumber: "" | "admin" | "consumer";
  page: number;
}

const CAKUPAN_LABEL: Record<KirimOptout["cakupan"], string> = { semua: "Semua", device: "Nomor", consumer: "Modul" };

/** Jangan hubungi (KIRIM-IMPL-002 §12): masked numbers only; admins remove only their own rows. */
export function JanganHubungiPage({ preview }: { preview?: JanganHubungiState }) {
  const [state, setState] = useState<JanganHubungiState>(preview ?? { status: "loading" });
  const [filter, setFilter] = useState<OptoutFilter>({ cakupan: "", sumber: "", page: 1 });
  const [removing, setRemoving] = useState<KirimOptout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview) return;
    try {
      const query = new URLSearchParams({ page: String(filter.page) });
      if (filter.cakupan) query.set("cakupan", filter.cakupan);
      if (filter.sumber) query.set("sumber", filter.sumber);
      const [page, devices] = await Promise.all([kirimFetch<KirimOptoutPage>(`/optouts?${query.toString()}`), kirimFetch<KirimDeviceList>("/devices")]);
      setState({ status: "ready", page, devices: devices.devices.map((device) => device.kode) });
    } catch (failure) {
      setState(failure instanceof KirimRequestError && failure.status === 403 ? { status: "forbidden" } : { status: "error" });
    }
  }, [filter, preview]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      setRemoving(null);
      await load();
      return true;
    } catch (failure) {
      setError(failure instanceof KirimRequestError ? failure.message : "Kirim SQ sedang tidak dapat dihubungi.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <JanganHubungiView
        state={state}
        filter={filter}
        busy={busy}
        error={removing ? null : error}
        onFilter={setFilter}
        onAdd={(body) => act(() => kirimFetch("/optouts", { method: "POST", body }))}
        onRemove={(optout) => { setError(null); setRemoving(optout); }}
        onReload={() => { setState({ status: "loading" }); void load(); }}
      />
      {removing ? (
        <ReasonDialog
          title="Hapus dari Jangan hubungi?"
          body={`Nomor ${removing.nomor_tersamar ?? "ini"} bisa menerima pesan otomatis lagi (${cakupanText(removing).toLowerCase()}).`}
          confirmLabel="Hapus"
          danger
          busy={busy}
          error={error}
          onClose={() => { setRemoving(null); setError(null); }}
          onConfirm={(alasan) => void act(() => kirimFetch(`/optouts/${removing.id}`, { method: "DELETE", body: { alasan } }))}
        />
      ) : null}
    </>
  );
}

export function JanganHubungiView({
  state,
  filter,
  busy,
  error,
  onFilter,
  onAdd,
  onRemove,
  onReload,
}: {
  state: JanganHubungiState;
  filter: OptoutFilter;
  busy: boolean;
  error: string | null;
  onFilter: (filter: OptoutFilter) => void;
  onAdd: (body: { nomor: string; cakupan: "semua" | "device"; device?: string; alasan: string }) => Promise<boolean>;
  onRemove: (optout: KirimOptout) => void;
  onReload: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-heading">Jangan hubungi</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Nomor di sini tidak menerima pesan otomatis. Kode verifikasi tetap terkirim. Nomor hanya tampil tersamar.
        </p>
      </div>
      {state.status === "loading" ? <StateCard kind="loading" title="Memuat daftar jangan hubungi" /> : null}
      {state.status === "forbidden" ? <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Kirim SQ" /> : null}
      {state.status === "error" ? (
        <StateCard kind="error" title="Daftar belum dapat dimuat" body="Kirim SQ sedang tidak dapat dihubungi." action={<button type="button" className={secondaryButton} onClick={onReload}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Coba lagi</button>} />
      ) : null}
      {state.status === "ready" ? (
        <>
          <AddOptoutForm devices={state.devices} busy={busy} error={error} onAdd={onAdd} />
          <Panel>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cakupan">
                <select className="sq-admin-input" value={filter.cakupan} onChange={(event) => onFilter({ ...filter, cakupan: event.target.value as OptoutFilter["cakupan"], page: 1 })}>
                  <option value="">Semua cakupan</option>
                  <option value="semua">Semua pesan otomatis</option>
                  <option value="device">Per nomor</option>
                  <option value="consumer">Per modul</option>
                </select>
              </Field>
              <Field label="Sumber">
                <select className="sq-admin-input" value={filter.sumber} onChange={(event) => onFilter({ ...filter, sumber: event.target.value as OptoutFilter["sumber"], page: 1 })}>
                  <option value="">Semua sumber</option>
                  <option value="admin">Pengelola Kirim SQ</option>
                  <option value="consumer">Modul</option>
                </select>
              </Field>
            </div>
          </Panel>
          {state.page.optouts.length === 0 ? (
            <StateCard kind="empty" title="Belum ada nomor di daftar ini" />
          ) : (
            <ul className="space-y-2">
              {state.page.optouts.map((optout) => (
                <li key={optout.id}>
                  <Panel className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold text-brand-heading">{optout.nomor_tersamar ?? "—"}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground">{CAKUPAN_LABEL[optout.cakupan]}</span>{" "}
                        {cakupanText(optout)} · {optout.sumber === "admin" ? "oleh pengelola" : `oleh modul ${optout.modul ?? ""}`} · {formatTime(optout.dibuat)}
                      </p>
                      <p className="mt-1 break-words text-sm">{optout.alasan}</p>
                    </div>
                    {optout.bisa_dihapus ? (
                      <button type="button" className={dangerButton} onClick={() => onRemove(optout)}><Trash2 className="h-4 w-4" aria-hidden="true" /> Hapus</button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Dicabut oleh modulnya</span>
                    )}
                  </Panel>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between gap-2">
            <button type="button" className={secondaryButton} disabled={filter.page <= 1} onClick={() => onFilter({ ...filter, page: filter.page - 1 })}>Sebelumnya</button>
            <button type="button" className={secondaryButton} disabled={state.page.optouts.length < 50} onClick={() => onFilter({ ...filter, page: filter.page + 1 })}>Berikutnya</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AddOptoutForm({ devices, busy, error, onAdd }: { devices: string[]; busy: boolean; error: string | null; onAdd: (body: { nomor: string; cakupan: "semua" | "device"; device?: string; alasan: string }) => Promise<boolean> }) {
  const [nomor, setNomor] = useState("");
  const [cakupan, setCakupan] = useState<"semua" | "device">("semua");
  const [device, setDevice] = useState(devices[0] ?? "");
  const [alasan, setAlasan] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const done = await onAdd({ nomor, cakupan, ...(cakupan === "device" ? { device } : {}), alasan });
    if (done) {
      setNomor("");
      setAlasan("");
    }
  };
  return (
    <Panel>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <h2 className="font-display text-base font-bold text-brand-heading">Tambah nomor</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nomor WhatsApp" helper="Contoh 0812 3456 7890">
            <input className="sq-admin-input" inputMode="tel" autoComplete="off" maxLength={40} value={nomor} onChange={(event) => setNomor(event.target.value)} />
          </Field>
          <Field label="Cakupan">
            <select className="sq-admin-input" value={cakupan} onChange={(event) => setCakupan(event.target.value as "semua" | "device")}>
              <option value="semua">Semua pesan otomatis</option>
              <option value="device">Hanya satu nomor yayasan</option>
            </select>
          </Field>
          {cakupan === "device" ? (
            <Field label="Nomor yayasan">
              <select className="sq-admin-input" value={device} onChange={(event) => setDevice(event.target.value)}>
                {devices.map((kode) => <option key={kode} value={kode}>{kode}</option>)}
              </select>
            </Field>
          ) : null}
        </div>
        <Field label="Alasan">
          <textarea className="sq-admin-input" rows={2} maxLength={500} value={alasan} onChange={(event) => setAlasan(event.target.value)} />
        </Field>
        {error ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">{error}</p> : null}
        <button type="submit" className={primaryButton} disabled={busy || !nomor.trim() || !alasan.trim() || (cakupan === "device" && !device)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Tambahkan
        </button>
      </form>
    </Panel>
  );
}
