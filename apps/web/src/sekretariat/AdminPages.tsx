import { useState } from "react";

import {
  errorMessage, formatTanggal, sekretariatFetch,
  type Jenis, type RegisterItem, type SekretariatContext,
} from "@/sekretariat/api";
import { Pager } from "@/sekretariat/KotakPages";
import { ErrorNote, PageHeader, Panel, ReasonDialog, secondaryButton, StateCard, StatusBadge, useLoad } from "@/sekretariat/ui";

/** SEK-IMPL-001 §9 Buku nomor: the combined register, scoped by the server to the viewer's issuers. */
export function BukuPage({ context }: { context: SekretariatContext }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState({ jenis: "", tahun: "", status: "" });
  const query = `page=${page}${filter.jenis ? `&jenis=${filter.jenis}` : ""}${filter.tahun ? `&tahun=${filter.tahun}` : ""}${filter.status ? `&status=${filter.status}` : ""}`;
  const { state, reload } = useLoad(
    async () => {
      const [register, jenis] = await Promise.all([
        sekretariatFetch<{ items: RegisterItem[]; total: number; pageSize: number }>(`/register?${query}`),
        sekretariatFetch<{ items: Jenis[] }>("/jenis"),
      ]);
      return { ...register, jenis: jenis.items };
    },
    query,
  );
  const [batal, setBatal] = useState<RegisterItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat buku nomor" />;
  if (state.status === "error") return <StateCard kind="error" title="Buku nomor belum dapat dimuat" body={state.message} />;
  const data = state.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Buku nomor surat" eyebrow="Satu buku untuk seluruh yayasan" actions={
        context.pengelola ? <a className={secondaryButton} href={`/api/admin/sekretariat/register/export?${query.replace(/^page=\d+&?/, "")}`}>Ekspor CSV</a> : null
      }>
        <p className="mt-1 text-sm text-muted-foreground">Pola pedoman: [kode jenis].[urut]/[kode penerbit]/[bulan Romawi]/[tahun]. Nomor batal tetap tercatat.</p>
      </PageHeader>
      <div className="flex flex-wrap gap-2">
        <select className="sq-admin-input !mt-0 w-auto" aria-label="Saring jenis" value={filter.jenis} onChange={(event) => { setFilter({ ...filter, jenis: event.target.value }); setPage(1); }}>
          <option value="">Semua jenis</option>
          {data.jenis.map((item) => <option key={item.kode} value={item.kode}>{item.kode} — {item.nama}</option>)}
        </select>
        <input className="sq-admin-input !mt-0 w-28" aria-label="Saring tahun" placeholder="Tahun" inputMode="numeric" value={filter.tahun} onChange={(event) => { setFilter({ ...filter, tahun: event.target.value.replace(/\D/g, "").slice(0, 4) }); setPage(1); }} />
        <select className="sq-admin-input !mt-0 w-auto" aria-label="Saring status" value={filter.status} onChange={(event) => { setFilter({ ...filter, status: event.target.value }); setPage(1); }}>
          <option value="">Semua status</option>
          <option value="terpakai">Terpakai</option>
          <option value="dibatalkan">Dibatalkan</option>
        </select>
      </div>
      <ErrorNote message={error} />
      {data.items.length === 0 ? (
        <StateCard kind="empty" title="Belum ada nomor pada saringan ini" body="Nomor muncul begitu surat pertama terbit, atau setelah migrasi DOC-003." />
      ) : (
        <Panel className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-bold text-muted-foreground">
                  <th className="px-4 py-2">Nomor</th>
                  <th className="px-4 py-2">Tanggal</th>
                  <th className="px-4 py-2">Perihal</th>
                  <th className="px-4 py-2">Tujuan</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="border-b border-border/50">
                    <td className="px-4 py-2 font-semibold text-foreground">{item.nomor}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatTanggal(item.tanggal)}</td>
                    <td className="max-w-56 truncate px-4 py-2">{item.perihal}</td>
                    <td className="max-w-40 truncate px-4 py-2 text-muted-foreground">{item.tujuan}</td>
                    <td className="px-4 py-2">
                      <StatusBadge label={item.status === "terpakai" ? "Terpakai" : "Dibatalkan"} tone={item.status === "terpakai" ? "baik" : "bahaya"} />
                      {item.sumber === "migrasi-doc003" ? <span className="ml-1 text-[11px] text-muted-foreground">migrasi</span> : null}
                      {item.sumber === "mesin" ? <span className="ml-1 text-[11px] text-muted-foreground">HCIS</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {item.status === "terpakai" ? (
                        <button type="button" className="text-xs font-bold text-destructive hover:underline" onClick={() => setBatal(item)}>Batalkan</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
      {batal ? (
        <ReasonDialog
          title={`Batalkan nomor ${batal.nomor}?`}
          body="Nomor yang batal tetap tercatat di buku dan tidak pernah dipakai ulang (DOC-003 D-08)."
          confirmLabel="Batalkan nomor"
          danger
          busy={busy}
          error={error}
          onConfirm={(alasan) => {
            setBusy(true);
            setError(null);
            sekretariatFetch(`/nomor/${batal.id}/batal`, { method: "POST", body: { alasan } })
              .then(() => {
                setBatal(null);
                void reload();
              })
              .catch((failure) => setError(errorMessage(failure)))
              .finally(() => setBusy(false));
          }}
          onClose={() => setBatal(null)}
        />
      ) : null}
    </div>
  );
}
