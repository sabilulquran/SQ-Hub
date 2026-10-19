import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { kirimFetch, KirimRequestError, type KirimActivityPage, type KirimActivitySummary } from "@/kirim/api";
import { activityLabel, formatTime } from "@/kirim/labels";
import { Field, Panel, secondaryButton, StateCard } from "@/kirim/KirimShell";

export type AktivitasState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "ready"; page: KirimActivityPage; summary: KirimActivitySummary };

export interface ActivityFilter {
  aksi: string;
  device: string;
  page: number;
}

const FILTER_ACTIONS = ["percakapan.baca", "percakapan.balas", "media.unduh", "optout.tambah", "optout.cabut", "nomor.pairing", "antrean.batal", "riwayat.impor_ekspor"];

/** Aktivitas (KIRIM-IMPL-002 §12): audit and daily totals, never message bodies or full numbers. */
export function AktivitasPage({ preview }: { preview?: AktivitasState }) {
  const [state, setState] = useState<AktivitasState>(preview ?? { status: "loading" });
  const [filter, setFilter] = useState<ActivityFilter>({ aksi: "", device: "", page: 1 });

  const load = useCallback(async () => {
    if (preview) return;
    try {
      const query = new URLSearchParams({ page: String(filter.page) });
      if (filter.aksi) query.set("aksi", filter.aksi);
      if (filter.device) query.set("device", filter.device);
      const [page, summary] = await Promise.all([kirimFetch<KirimActivityPage>(`/activity?${query.toString()}`), kirimFetch<KirimActivitySummary>("/activity/summary")]);
      setState({ status: "ready", page, summary });
    } catch (failure) {
      setState(failure instanceof KirimRequestError && failure.status === 403 ? { status: "forbidden" } : { status: "error" });
    }
  }, [filter, preview]);

  useEffect(() => {
    void load();
  }, [load]);

  return <AktivitasView state={state} filter={filter} onFilter={setFilter} onReload={() => { setState({ status: "loading" }); void load(); }} />;
}

export function AktivitasView({ state, filter, onFilter, onReload }: { state: AktivitasState; filter: ActivityFilter; onFilter: (filter: ActivityFilter) => void; onReload: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-heading">Aktivitas</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">Jejak tindakan pengelola dan modul. Isi pesan dan nomor utuh tidak pernah tampil di sini.</p>
      </div>
      {state.status === "loading" ? <StateCard kind="loading" title="Memuat aktivitas" /> : null}
      {state.status === "forbidden" ? <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Kirim SQ" /> : null}
      {state.status === "error" ? (
        <StateCard kind="error" title="Aktivitas belum dapat dimuat" body="Kirim SQ sedang tidak dapat dihubungi." action={<button type="button" className={secondaryButton} onClick={onReload}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Coba lagi</button>} />
      ) : null}
      {state.status === "ready" ? (
        <>
          <Panel>
            <h2 className="font-display text-base font-bold text-brand-heading">7 hari terakhir</h2>
            {state.summary.percakapan_ganda.some((row) => row.jumlah > 0) ? (
              <p role="status" className="mt-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-ink">
                Ada percakapan ganda untuk orang yang sama (tercatat dengan dan tanpa nomor):{" "}
                {state.summary.percakapan_ganda.map((row) => `${row.nomor} ${row.jumlah}`).join(", ")}.
              </p>
            ) : null}
            {state.summary.harian.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Belum ada pesan dalam 7 hari terakhir.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr><th className="py-1.5 pr-3">Hari</th><th className="pr-3">Nomor</th><th className="pr-3">Modul</th><th className="pr-3">Otomatis</th><th className="pr-3">Petugas</th><th className="pr-3">Dari HP</th><th className="pr-3">Masuk</th><th>Gagal</th></tr>
                  </thead>
                  <tbody>
                    {state.summary.harian.map((row) => (
                      <tr key={`${row.hari}-${row.nomor}-${row.modul ?? ""}`} className="border-t border-border/60">
                        <td className="py-1.5 pr-3">{row.hari}</td><td className="pr-3">{row.nomor}</td><td className="pr-3">{row.modul ?? "—"}</td>
                        <td className="pr-3">{row.otomatis}</td><td className="pr-3">{row.petugas}</td><td className="pr-3">{row.dari_hp}</td><td className="pr-3">{row.masuk}</td><td>{row.gagal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tindakan">
                <select className="sq-admin-input" value={filter.aksi} onChange={(event) => onFilter({ ...filter, aksi: event.target.value, page: 1 })}>
                  <option value="">Semua tindakan</option>
                  {FILTER_ACTIONS.map((aksi) => <option key={aksi} value={aksi}>{activityLabel[aksi]}</option>)}
                </select>
              </Field>
              <Field label="Nomor yayasan">
                <input className="sq-admin-input" placeholder="mis. spmb" maxLength={31} value={filter.device} onChange={(event) => onFilter({ ...filter, device: event.target.value.trim().toLowerCase(), page: 1 })} />
              </Field>
            </div>
          </Panel>
          {state.page.aktivitas.length === 0 ? (
            <StateCard kind="empty" title="Belum ada aktivitas" />
          ) : (
            <ul className="space-y-2">
              {state.page.aktivitas.map((row) => (
                <li key={row.id}>
                  <Panel>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-bold text-brand-heading">{activityLabel[row.aksi] ?? row.aksi}</p>
                      <p className="text-xs text-muted-foreground">{formatTime(row.waktu)}</p>
                    </div>
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                      {row.aktor.jenis === "service" ? `Modul ${row.aktor.ref}` : row.aktor.jenis === "human" ? "Pengelola" : "Sistem"}
                      {row.petugas ? ` · ${row.petugas}` : ""} · {row.objek.jenis} {row.objek.ref.slice(0, 16)}
                      {row.hasil === "gagal" ? <span className="ml-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger-ink">gagal</span> : null}
                    </p>
                  </Panel>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between gap-2">
            <button type="button" className={secondaryButton} disabled={filter.page <= 1} onClick={() => onFilter({ ...filter, page: filter.page - 1 })}>Sebelumnya</button>
            <button type="button" className={secondaryButton} disabled={state.page.aktivitas.length < 50} onClick={() => onFilter({ ...filter, page: filter.page + 1 })}>Berikutnya</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
