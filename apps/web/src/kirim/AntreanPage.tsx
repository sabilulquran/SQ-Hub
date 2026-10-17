import { RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  kirimFetch,
  KirimRequestError,
  type KirimDeviceList,
  type KirimQueueItem,
  type KirimQueuePage,
  type KirimQueueSummary,
  type OutboxStatus,
} from "@/kirim/api";
import { errorLabel, formatBytes, formatTime, notRetryable, outboxStatusLabel, outboxStatusTone } from "@/kirim/labels";
import { dangerButton, Panel, ReasonDialog, secondaryButton, StateCard } from "@/kirim/KirimShell";

export type AntreanState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "ready"; summary: KirimQueueSummary; queue: KirimQueuePage; devices: string[] };

export interface AntreanFilter {
  device: string;
  status: "" | OutboxStatus;
  page: number;
}

const STATUSES: OutboxStatus[] = ["antre", "diserahkan", "terkirim", "dibaca", "gagal", "dibatalkan"];

/** Antrean (KIRIM-IMPL-001 §8): counts, filters and retry/cancel. Never shows message bodies. */
export function AntreanPage({ preview }: { preview?: AntreanState }) {
  const [state, setState] = useState<AntreanState>(preview ?? { status: "loading" });
  const [filter, setFilter] = useState<AntreanFilter>({ device: "", status: "", page: 1 });
  const [cancelling, setCancelling] = useState<KirimQueueItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview) return;
    try {
      const query = new URLSearchParams({ page: String(filter.page) });
      if (filter.device) query.set("device", filter.device);
      if (filter.status) query.set("status", filter.status);
      const [summary, queue, devices] = await Promise.all([
        kirimFetch<KirimQueueSummary>("/queue/summary"),
        kirimFetch<KirimQueuePage>(`/queue?${query.toString()}`),
        kirimFetch<KirimDeviceList>("/devices"),
      ]);
      setState({ status: "ready", summary, queue, devices: devices.devices.map((device) => device.kode) });
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
      setCancelling(null);
      await load();
    } catch (failure) {
      setError(failure instanceof KirimRequestError ? failure.message : "Kirim SQ sedang tidak dapat dihubungi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AntreanView
        state={state}
        filter={filter}
        busy={busy}
        actionError={cancelling ? null : error}
        onFilter={(next) => setFilter({ ...next, page: next.page })}
        onRetry={(item) => void act(() => kirimFetch(`/queue/${item.id}/retry`, { method: "POST", body: {} }))}
        onCancel={(item) => { setError(null); setCancelling(item); }}
        onReload={() => { setState({ status: "loading" }); void load(); }}
      />
      {cancelling ? (
        <ReasonDialog
          title="Batalkan pesan?"
          body={`Pesan ${cancelling.ref ?? "tanpa ref"} dari ${cancelling.pemakai} tidak akan dikirim. Pemakai menerima status dibatalkan.`}
          confirmLabel="Batalkan pesan"
          danger
          busy={busy}
          error={error}
          onClose={() => { setCancelling(null); setError(null); }}
          onConfirm={(alasan) => void act(() => kirimFetch(`/queue/${cancelling.id}/cancel`, { method: "POST", body: { alasan } }))}
        />
      ) : null}
    </>
  );
}

export function AntreanView({
  state,
  filter,
  busy,
  actionError,
  onFilter,
  onRetry,
  onCancel,
  onReload,
}: {
  state: AntreanState;
  filter: AntreanFilter;
  busy: boolean;
  actionError: string | null;
  onFilter: (filter: AntreanFilter) => void;
  onRetry: (item: KirimQueueItem) => void;
  onCancel: (item: KirimQueueItem) => void;
  onReload: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">Antrean</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pesan otomatis per nomor. Isi pesan tidak ditampilkan.</p>
        </div>
        <button type="button" className={secondaryButton} onClick={onReload}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Muat ulang</button>
      </div>

      <div className="mt-5 space-y-4">
        {state.status === "loading" ? <StateCard kind="loading" title="Memuat antrean" /> : null}
        {state.status === "error" ? <StateCard kind="error" title="Antrean belum dapat dimuat" body="Kirim SQ sedang tidak dapat dihubungi." /> : null}
        {state.status === "forbidden" ? <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Kirim SQ" /> : null}
        {state.status === "ready" ? (
          <>
            <Summary summary={state.summary} />
            <Panel>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-brand-heading">Nomor</span>
                  <select className="sq-admin-input" value={filter.device} onChange={(event) => onFilter({ ...filter, device: event.target.value, page: 1 })}>
                    <option value="">Semua nomor</option>
                    {state.devices.map((kode) => <option key={kode} value={kode}>{kode}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-brand-heading">Status</span>
                  <select className="sq-admin-input" value={filter.status} onChange={(event) => onFilter({ ...filter, status: event.target.value as AntreanFilter["status"], page: 1 })}>
                    <option value="">Semua status</option>
                    {STATUSES.map((status) => <option key={status} value={status}>{outboxStatusLabel[status]}</option>)}
                  </select>
                </label>
              </div>
              {actionError ? <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-ink">{actionError}</p> : null}
              {state.queue.items.length === 0 ? (
                <div className="mt-4"><StateCard kind="empty" title="Antrean kosong" body="Tidak ada pesan untuk saringan ini." /></div>
              ) : (
                <QueueList items={state.queue.items} busy={busy} onRetry={onRetry} onCancel={onCancel} />
              )}
              <div className="mt-4 flex items-center justify-between gap-2">
                <button type="button" className={secondaryButton} disabled={filter.page <= 1} onClick={() => onFilter({ ...filter, page: filter.page - 1 })}>Sebelumnya</button>
                <span className="text-xs text-muted-foreground">Halaman {state.queue.page}</span>
                <button type="button" className={secondaryButton} disabled={!state.queue.has_more} onClick={() => onFilter({ ...filter, page: filter.page + 1 })}>Berikutnya</button>
              </div>
            </Panel>
          </>
        ) : null}
      </div>
    </>
  );
}

function Summary({ summary }: { summary: KirimQueueSummary }) {
  return (
    <Panel>
      <h2 className="font-display text-base font-bold text-brand-heading">24 jam terakhir</h2>
      {summary.per_nomor.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Belum ada pesan dalam 24 jam terakhir.</p> : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {summary.per_nomor.map((row) => (
            <li key={row.nomor} className="rounded-xl border border-border p-3">
              <p className="font-bold text-brand-heading"><code>{row.nomor}</code></p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                {(["antre", "diserahkan", "terkirim", "dibaca", "gagal"] as const).map((status) => (
                  <div key={status} className="rounded-lg bg-muted px-1 py-1.5">
                    <dt className="text-muted-foreground">{outboxStatusLabel[status]}</dt>
                    <dd className="text-base font-bold text-foreground">{row[status] ?? 0}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Webhook habis: {summary.webhook_habis} · kirim_messages {formatBytes(summary.ukuran.tabel_kirim_messages)} · media {formatBytes(summary.ukuran.folder_media)} · disk bebas {formatBytes(summary.ukuran.disk_bebas)}
      </p>
    </Panel>
  );
}

function QueueList({ items, busy, onRetry, onCancel }: { items: KirimQueueItem[]; busy: boolean; onRetry: (item: KirimQueueItem) => void; onCancel: (item: KirimQueueItem) => void }) {
  return (
    <ul className="mt-4 divide-y divide-border/70" aria-label="Daftar antrean">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${outboxStatusTone[item.status]}`}>{outboxStatusLabel[item.status]}</span>
              <strong className="text-brand-heading">{item.pemakai}</strong>
              <span className="text-muted-foreground">via <code>{item.nomor}</code></span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{item.jenis === "kode" ? "Kode" : "Notifikasi"}</span>
              {item.dry_run ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-bold text-warning-ink">Uji</span> : null}
            </p>
            <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {item.tujuan} · ref {item.ref ?? "—"} · percobaan {item.percobaan} · {formatTime(item.created_at)}
            </p>
            {item.error_code ? <p className="mt-0.5 text-xs font-semibold text-danger-ink">{errorLabel(item.error_code)}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            {item.status === "gagal" && !(item.error_code && notRetryable.has(item.error_code)) ? (
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => onRetry(item)}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Coba ulang</button>
            ) : null}
            {item.status === "antre" ? (
              <button type="button" className={dangerButton} disabled={busy} onClick={() => onCancel(item)}><XCircle className="h-4 w-4" aria-hidden="true" /> Batalkan</button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
