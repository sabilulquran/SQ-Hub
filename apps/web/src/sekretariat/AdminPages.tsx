import { useState } from "react";

import {
  errorMessage, formatTanggal, sekretariatAdminFetch, sekretariatFetch,
  type Jenis, type Penerbit, type RegisterItem, type SekretariatContext,
} from "@/sekretariat/api";
import { Pager } from "@/sekretariat/KotakPages";
import { ErrorNote, Field, PageHeader, Panel, primaryButton, ReasonDialog, secondaryButton, StateCard, StatusBadge, useLoad } from "@/sekretariat/ui";

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

/** SEK-IMPL-001 §9 Pengaturan (admin): issuers, officers, disposition holders, starting numbers, mail. */
export function PengaturanPage() {
  const { state, reload } = useLoad(
    async () => {
      const [penerbit, petugas, pemegang, jenis, mail] = await Promise.all([
        sekretariatAdminFetch<{ items: Penerbit[] }>("/penerbit"),
        sekretariatAdminFetch<{ items: Array<{ id: string; penerbitKode: string; personId: string; alasan: string }> }>("/petugas"),
        sekretariatAdminFetch<{ items: Array<{ id: string; personId: string; alasan: string }> }>("/disposisi-pemegang"),
        sekretariatAdminFetch<{ items: Jenis[] }>("/jenis"),
        sekretariatAdminFetch<{ items: Array<{ mailbox: string; uidTerakhir: number; terakhirTarikPada: string | null; galatTerakhir: string | null }> }>("/mail"),
      ]);
      return { penerbit: penerbit.items, petugas: petugas.items, pemegang: pemegang.items, jenis: jenis.items, mail: mail.items };
    },
    "pengaturan",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [petugasBaru, setPetugasBaru] = useState({ penerbitId: "", personId: "", alasan: "" });
  const [pemegangBaru, setPemegangBaru] = useState({ personId: "", alasan: "" });
  const [panitiaBaru, setPanitiaBaru] = useState({ kode: "", nama: "", berakhir: "", alasan: "" });
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat pengaturan" />;
  if (state.status === "error") {
    return state.code === "sekretariat_admin_required"
      ? <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Sekretariat" body="Hubungi Kepala HCM bila Anda seharusnya mengelola Sekretariat." />
      : <StateCard kind="error" title="Pengaturan belum dapat dimuat" body={state.message} />;
  }
  const data = state.data;
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work().then(() => reload()).catch((failure) => setError(errorMessage(failure))).finally(() => setBusy(false));
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Pengaturan" eyebrow="Pengelola Sekretariat" />
      <ErrorNote message={error} />

      <Panel>
        <h2 className="font-display text-base font-bold text-brand-heading">Penerbit</h2>
        <p className="mt-1 text-sm text-muted-foreground">Katalog tetap dari pedoman; panitia/tim/satgas dibuat di sini dengan masa berlaku.</p>
        <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          {data.penerbit.map((penerbit) => (
            <li key={penerbit.id} className="flex items-center gap-2">
              <span className="font-semibold">{penerbit.kode}</span>
              <span className="truncate text-muted-foreground">{penerbit.nama}</span>
              {!penerbit.aktif ? <StatusBadge label="nonaktif" tone="biasa" /> : null}
              {penerbit.berakhirPada ? <StatusBadge label={`s.d. ${formatTanggal(penerbit.berakhirPada)}`} tone="perhatian" /> : null}
              <span className="ml-auto text-xs text-muted-foreground">{penerbit.petugasAktif} petugas</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-4">
          <Field label="Kode panitia" helper="PAN./TIM./SATGAS.[alias]"><input className="sq-admin-input" value={panitiaBaru.kode} onChange={(event) => setPanitiaBaru({ ...panitiaBaru, kode: event.target.value.toUpperCase() })} placeholder="PAN.MILAD" /></Field>
          <Field label="Nama"><input className="sq-admin-input" value={panitiaBaru.nama} onChange={(event) => setPanitiaBaru({ ...panitiaBaru, nama: event.target.value })} /></Field>
          <Field label="Berakhir pada"><input type="date" className="sq-admin-input" value={panitiaBaru.berakhir} onChange={(event) => setPanitiaBaru({ ...panitiaBaru, berakhir: event.target.value })} /></Field>
          <Field label="Alasan"><input className="sq-admin-input" value={panitiaBaru.alasan} onChange={(event) => setPanitiaBaru({ ...panitiaBaru, alasan: event.target.value })} /></Field>
        </div>
        <button
          type="button"
          className={`${primaryButton} mt-3`}
          disabled={busy || !panitiaBaru.kode || !panitiaBaru.nama || !panitiaBaru.berakhir || !panitiaBaru.alasan.trim()}
          onClick={() => run(async () => {
            await sekretariatAdminFetch("/penerbit", { method: "POST", body: { kode: panitiaBaru.kode, nama: panitiaBaru.nama, berakhir_pada: panitiaBaru.berakhir, alasan: panitiaBaru.alasan } });
            setPanitiaBaru({ kode: "", nama: "", berakhir: "", alasan: "" });
          })}
        >
          Tambah penerbit panitia
        </button>
      </Panel>

      <Panel>
        <h2 className="font-display text-base font-bold text-brand-heading">Petugas register</h2>
        <p className="mt-1 text-sm text-muted-foreground">Hak ambil nomor sekaligus akses kotak masuk, register, dan arsip penerbitnya (akses berlapis).</p>
        <ul className="mt-3 space-y-1 text-sm">
          {data.petugas.map((petugas) => (
            <li key={petugas.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{petugas.penerbitKode}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{petugas.personId}</span>
              <button type="button" className="text-xs font-bold text-destructive hover:underline" disabled={busy}
                onClick={() => run(() => sekretariatAdminFetch(`/petugas/${petugas.id}/cabut`, { method: "POST", body: { alasan: "Dicabut lewat layar pengaturan." } }))}>
                Cabut
              </button>
            </li>
          ))}
          {data.petugas.length === 0 ? <li className="text-muted-foreground">Belum ada petugas.</li> : null}
        </ul>
        <div className="mt-4 grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-3">
          <Field label="Penerbit">
            <select className="sq-admin-input" value={petugasBaru.penerbitId} onChange={(event) => setPetugasBaru({ ...petugasBaru, penerbitId: event.target.value })}>
              <option value="">— pilih —</option>
              {data.penerbit.filter((penerbit) => penerbit.aktif).map((penerbit) => <option key={penerbit.id} value={penerbit.id}>{penerbit.kode}</option>)}
            </select>
          </Field>
          <Field label="Person ID Directory" helper="hcis:employee:<uuid>"><input className="sq-admin-input" value={petugasBaru.personId} onChange={(event) => setPetugasBaru({ ...petugasBaru, personId: event.target.value.trim() })} /></Field>
          <Field label="Alasan"><input className="sq-admin-input" value={petugasBaru.alasan} onChange={(event) => setPetugasBaru({ ...petugasBaru, alasan: event.target.value })} /></Field>
        </div>
        <button
          type="button"
          className={`${primaryButton} mt-3`}
          disabled={busy || !petugasBaru.penerbitId || !petugasBaru.personId || !petugasBaru.alasan.trim()}
          onClick={() => run(async () => {
            await sekretariatAdminFetch("/petugas", { method: "POST", body: { penerbit_id: petugasBaru.penerbitId, person_id: petugasBaru.personId, alasan: petugasBaru.alasan } });
            setPetugasBaru({ penerbitId: "", personId: "", alasan: "" });
          })}
        >
          Tambah petugas
        </button>
      </Panel>

      <Panel>
        <h2 className="font-display text-base font-bold text-brand-heading">Pemberi disposisi</h2>
        <p className="mt-1 text-sm text-muted-foreground">Membaca kotak yayasan dan mendisposisi isinya. Bawaannya Direktur; delegasi dicatat dengan alasan (D-4).</p>
        <ul className="mt-3 space-y-1 text-sm">
          {data.pemegang.map((pemegang) => (
            <li key={pemegang.id} className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-xs text-muted-foreground">{pemegang.personId}</span>
              <span className="truncate text-muted-foreground">{pemegang.alasan}</span>
              <button type="button" className="text-xs font-bold text-destructive hover:underline" disabled={busy}
                onClick={() => run(() => sekretariatAdminFetch(`/disposisi-pemegang/${pemegang.id}/cabut`, { method: "POST", body: { alasan: "Dicabut lewat layar pengaturan." } }))}>
                Cabut
              </button>
            </li>
          ))}
          {data.pemegang.length === 0 ? <li className="text-muted-foreground">Belum ada pemegang disposisi.</li> : null}
        </ul>
        <div className="mt-4 grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
          <Field label="Person ID Directory"><input className="sq-admin-input" value={pemegangBaru.personId} onChange={(event) => setPemegangBaru({ ...pemegangBaru, personId: event.target.value.trim() })} /></Field>
          <Field label="Alasan"><input className="sq-admin-input" value={pemegangBaru.alasan} onChange={(event) => setPemegangBaru({ ...pemegangBaru, alasan: event.target.value })} /></Field>
        </div>
        <button
          type="button"
          className={`${primaryButton} mt-3`}
          disabled={busy || !pemegangBaru.personId || !pemegangBaru.alasan.trim()}
          onClick={() => run(async () => {
            await sekretariatAdminFetch("/disposisi-pemegang", { method: "POST", body: { person_id: pemegangBaru.personId, alasan: pemegangBaru.alasan } });
            setPemegangBaru({ personId: "", alasan: "" });
          })}
        >
          Tambah pemegang
        </button>
      </Panel>

      <NomorAwalPanel penerbit={data.penerbit} jenis={data.jenis} busy={busy} run={run} />

      <Panel>
        <h2 className="font-display text-base font-bold text-brand-heading">Penarik email</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {data.mail.map((item) => (
            <li key={item.mailbox} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{item.mailbox}</span>
              <span className="text-muted-foreground">UID terakhir {item.uidTerakhir} · tarik {formatTanggal(item.terakhirTarikPada)}</span>
              {item.galatTerakhir ? <StatusBadge label={`galat: ${item.galatTerakhir}`} tone="bahaya" /> : <StatusBadge label="sehat" tone="baik" />}
            </li>
          ))}
          {data.mail.length === 0 ? <li className="text-muted-foreground">Belum pernah menarik email (mode log, atau belum jalan).</li> : null}
        </ul>
      </Panel>
    </div>
  );
}

function NomorAwalPanel({ penerbit, jenis, busy, run }: { penerbit: Penerbit[]; jenis: Jenis[]; busy: boolean; run: (work: () => Promise<unknown>) => void }) {
  const [value, setValue] = useState({ penerbitId: "", jenisKode: "", tahun: String(new Date().getFullYear()), nilai: "", alasan: "" });
  return (
    <Panel>
      <h2 className="font-display text-base font-bold text-brand-heading">Nomor awal</h2>
      <p className="mt-1 text-sm text-muted-foreground">Jalan masuk sisa buku manual: hanya bisa menaikkan penghitung, tidak pernah menurunkan (DOC-003 D-17).</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-5">
        <Field label="Penerbit">
          <select className="sq-admin-input" value={value.penerbitId} onChange={(event) => setValue({ ...value, penerbitId: event.target.value })}>
            <option value="">— pilih —</option>
            {penerbit.filter((item) => item.aktif).map((item) => <option key={item.id} value={item.id}>{item.kode}</option>)}
          </select>
        </Field>
        <Field label="Jenis">
          <select className="sq-admin-input" value={value.jenisKode} onChange={(event) => setValue({ ...value, jenisKode: event.target.value })}>
            <option value="">— pilih —</option>
            {jenis.filter((item) => item.aktif).map((item) => <option key={item.kode} value={item.kode}>{item.kode}</option>)}
          </select>
        </Field>
        <Field label="Tahun"><input className="sq-admin-input" inputMode="numeric" value={value.tahun} onChange={(event) => setValue({ ...value, tahun: event.target.value.replace(/\D/g, "").slice(0, 4) })} /></Field>
        <Field label="Nomor terakhir terpakai"><input className="sq-admin-input" inputMode="numeric" value={value.nilai} onChange={(event) => setValue({ ...value, nilai: event.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="Alasan"><input className="sq-admin-input" value={value.alasan} onChange={(event) => setValue({ ...value, alasan: event.target.value })} /></Field>
      </div>
      <button
        type="button"
        className={`${primaryButton} mt-3`}
        disabled={busy || !value.penerbitId || !value.jenisKode || !value.tahun || !value.nilai || !value.alasan.trim()}
        onClick={() => run(async () => {
          await sekretariatAdminFetch("/nomor-awal", {
            method: "POST",
            body: { penerbit_id: value.penerbitId, jenis_kode: value.jenisKode, tahun: Number(value.tahun), nilai: Number(value.nilai), alasan: value.alasan },
          });
          setValue({ ...value, nilai: "", alasan: "" });
        })}
      >
        Naikkan penghitung
      </button>
    </Panel>
  );
}
