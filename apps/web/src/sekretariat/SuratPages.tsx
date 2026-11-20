import { useState } from "react";

import {
  berkasUrl, errorMessage, formatTanggal, formatUkuran, sekretariatFetch, sekretariatUpload,
  type Jenis, type SuratKeluar,
} from "@/sekretariat/api";
import { Pager, type PenerbitRingkas } from "@/sekretariat/KotakPages";
import { navigate } from "@/sekretariat/routes";
import { ErrorNote, Field, Link, PageHeader, Panel, primaryButton, ReasonDialog, secondaryButton, StateCard, StatusBadge, useLoad } from "@/sekretariat/ui";

function suratTone(status: SuratKeluar["status"]): "biasa" | "baik" | "bahaya" {
  return status === "terbit" ? "baik" : status === "dibatalkan" ? "bahaya" : "biasa";
}

const STATUS_SURAT: Record<SuratKeluar["status"], string> = { draf: "Draf", terbit: "Terbit", dibatalkan: "Dibatalkan" };

/** One issuer's outgoing letters: the register, a new draft, and a retroactive entry (§6). */
export function PenerbitSuratPage({ penerbitId }: { penerbitId: string }) {
  const [page, setPage] = useState(1);
  const { state } = useLoad(
    async () => {
      const [surat, jenis, penerbit] = await Promise.all([
        sekretariatFetch<{ items: SuratKeluar[]; total: number; pageSize: number }>(`/penerbit/${penerbitId}/surat?page=${page}`),
        sekretariatFetch<{ items: Jenis[] }>("/jenis"),
        sekretariatFetch<{ items: PenerbitRingkas[] }>("/penerbit"),
      ]);
      return { ...surat, jenis: jenis.items, penerbit: penerbit.items.find((item) => item.id === penerbitId) ?? null };
    },
    `${penerbitId}:${page}`,
  );
  const [form, setForm] = useState<{ retroaktif: boolean } | null>(null);
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat surat keluar" />;
  if (state.status === "error") {
    return state.code === "tidak_ditemukan"
      ? <StateCard kind="forbidden" title="Penerbit ini bukan milik Anda" body="Register surat hanya terbuka bagi petugas penerbitnya." action={<Link className={secondaryButton} href="/">Ke Ringkasan</Link>} />
      : <StateCard kind="error" title="Surat keluar belum dapat dimuat" body={state.message} />;
  }
  const data = state.data;
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={<Link href="/" className="hover:underline">Ringkasan</Link>}
        title={`Surat keluar ${data.penerbit?.kode ?? ""}`}
        actions={
          <>
            <button type="button" className={primaryButton} onClick={() => setForm({ retroaktif: false })}>Surat baru</button>
            <button type="button" className={secondaryButton} onClick={() => setForm({ retroaktif: true })}>Register retroaktif</button>
          </>
        }
      >
        {data.penerbit ? <p className="mt-1 text-sm text-muted-foreground">{data.penerbit.nama}</p> : null}
      </PageHeader>
      {form ? (
        <SuratForm
          penerbitId={penerbitId}
          jenis={data.jenis}
          retroaktif={form.retroaktif}
          onClose={() => setForm(null)}
        />
      ) : null}
      {data.items.length === 0 ? (
        <StateCard kind="empty" title="Belum ada surat" body="Buat draf surat, unggah PDF finalnya, lalu terbitkan — nomor diambil saat terbit." />
      ) : (
        <Panel className="divide-y divide-border/60 !p-0">
          {data.items.map((surat) => (
            <Link key={surat.id} href={`/surat/${surat.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{surat.nomor ?? "(belum bernomor)"} · {surat.perihal}</p>
                <p className="truncate text-xs text-muted-foreground">Jenis {surat.jenisKode} · kepada {surat.tujuan} · {formatTanggal(surat.terbitPada ?? surat.dibuatPada)}{surat.retroaktif ? " · retroaktif" : ""}</p>
              </div>
              <StatusBadge label={STATUS_SURAT[surat.status]} tone={suratTone(surat.status)} />
            </Link>
          ))}
        </Panel>
      )}
      <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
    </div>
  );
}

function SuratForm({ penerbitId, jenis, retroaktif, onClose }: { penerbitId: string; jenis: Jenis[]; retroaktif: boolean; onClose: () => void }) {
  const [value, setValue] = useState({ jenisKode: "", perihal: "", tujuan: "", penandatangan: "", nomorAsli: "", tanggalAsli: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lengkap = value.jenisKode && value.perihal.trim().length >= 3 && value.tujuan.trim().length >= 2 && value.penandatangan.trim().length >= 2
    && (!retroaktif || (value.nomorAsli.trim().length >= 3 && value.tanggalAsli));
  return (
    <Panel>
      <h2 className="font-display text-base font-bold text-brand-heading">{retroaktif ? "Register retroaktif" : "Surat baru"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {retroaktif
          ? "Surat lama diarsipkan dengan nomor aslinya apa adanya; penghitung tidak tersentuh."
          : "Nomor diambil saat terbit, setelah PDF final diperiksa (pedoman Pasal 14)."}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Jenis naskah">
          <select className="sq-admin-input" value={value.jenisKode} onChange={(event) => setValue({ ...value, jenisKode: event.target.value })}>
            <option value="">— pilih —</option>
            {jenis.map((item) => <option key={item.kode} value={item.kode}>{item.kode} — {item.nama}</option>)}
          </select>
        </Field>
        <Field label="Penandatangan"><input className="sq-admin-input" value={value.penandatangan} onChange={(event) => setValue({ ...value, penandatangan: event.target.value })} placeholder="Jabatan atau nama penandatangan" /></Field>
        <Field label="Perihal"><input className="sq-admin-input" value={value.perihal} onChange={(event) => setValue({ ...value, perihal: event.target.value })} /></Field>
        <Field label="Tujuan"><input className="sq-admin-input" value={value.tujuan} onChange={(event) => setValue({ ...value, tujuan: event.target.value })} placeholder="Penerima surat" /></Field>
        {retroaktif ? (
          <>
            <Field label="Nomor asli" helper="Ditulis apa adanya, termasuk format lama."><input className="sq-admin-input" value={value.nomorAsli} onChange={(event) => setValue({ ...value, nomorAsli: event.target.value })} /></Field>
            <Field label="Tanggal surat asli"><input type="date" className="sq-admin-input" value={value.tanggalAsli} onChange={(event) => setValue({ ...value, tanggalAsli: event.target.value })} /></Field>
          </>
        ) : null}
      </div>
      <ErrorNote message={error} />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={busy || !lengkap}
          onClick={() => {
            setBusy(true);
            setError(null);
            const body = retroaktif
              ? { nomor_asli: value.nomorAsli, tanggal_asli: value.tanggalAsli, jenis_kode: value.jenisKode, perihal: value.perihal, tujuan: value.tujuan, penandatangan: value.penandatangan }
              : { jenis_kode: value.jenisKode, perihal: value.perihal, tujuan: value.tujuan, penandatangan: value.penandatangan };
            sekretariatFetch<{ id: string }>(`/penerbit/${penerbitId}/${retroaktif ? "retroaktif" : "surat"}`, { method: "POST", body })
              .then((created) => navigate(`/surat/${created.id}`))
              .catch((failure) => setError(errorMessage(failure)))
              .finally(() => setBusy(false));
          }}
        >
          {retroaktif ? "Simpan arsip" : "Simpan draf"}
        </button>
        <button type="button" className={secondaryButton} onClick={onClose}>Batal</button>
      </div>
    </Panel>
  );
}

/** One letter: its PDF, publish and void. Publishing locks the file (§6). */
export function SuratPage({ suratId }: { suratId: string }) {
  const { state, reload } = useLoad(
    () => sekretariatFetch<SuratKeluar & { berkas: Array<{ id: string; nama: string; ukuran: number; sha256: string; terkunci: boolean }> }>(`/surat/${suratId}`),
    suratId,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmBatal, setConfirmBatal] = useState(false);
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat surat" />;
  if (state.status === "error") return <StateCard kind="error" title="Surat belum dapat dimuat" body={state.message} />;
  const surat = state.data;
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work().then(() => reload()).catch((failure) => setError(errorMessage(failure))).finally(() => setBusy(false));
  };
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={<Link href={`/penerbit/${surat.penerbitId}/surat`} className="hover:underline">Surat keluar</Link>}
        title={surat.nomor ?? "(draf — belum bernomor)"}
        actions={
          <>
            {surat.status === "draf" ? (
              <button type="button" className={primaryButton} disabled={busy || surat.berkas.length === 0} onClick={() => run(() => sekretariatFetch(`/surat/${surat.id}/terbit`, { method: "POST", body: {} }))}>
                Terbitkan (ambil nomor)
              </button>
            ) : null}
            {surat.status !== "dibatalkan" ? (
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => setConfirmBatal(true)}>{surat.status === "draf" ? "Hapus draf" : "Batalkan"}</button>
            ) : null}
          </>
        }
      >
        <p className="mt-1 text-sm text-muted-foreground">
          {surat.perihal} · kepada {surat.tujuan} · ditandatangani {surat.penandatangan} · <StatusBadge label={STATUS_SURAT[surat.status]} tone={suratTone(surat.status)} />
          {surat.retroaktif ? " · retroaktif" : ""}
        </p>
      </PageHeader>
      <ErrorNote message={error} />
      {confirmBatal ? (
        <ReasonDialog
          title={surat.status === "draf" ? "Hapus draf ini?" : "Batalkan surat ini?"}
          body={surat.status === "draf" ? "Draf dan berkasnya dihapus; belum ada nomor yang terpakai." : "Nomornya tetap tercatat di buku berstatus Dibatalkan dan tidak pernah dipakai ulang."}
          confirmLabel={surat.status === "draf" ? "Hapus draf" : "Batalkan surat"}
          danger
          busy={busy}
          error={error}
          reasonRequired={surat.status !== "draf"}
          onConfirm={(alasan) => {
            setBusy(true);
            setError(null);
            sekretariatFetch<{ dihapus: boolean }>(`/surat/${surat.id}/batal`, { method: "POST", body: { alasan: alasan || "Draf dihapus oleh pembuatnya." } })
              .then((result) => {
                if (result.dihapus) navigate(`/penerbit/${surat.penerbitId}/surat`);
                else {
                  setConfirmBatal(false);
                  void reload();
                }
              })
              .catch((failure) => setError(errorMessage(failure)))
              .finally(() => setBusy(false));
          }}
          onClose={() => setConfirmBatal(false)}
        />
      ) : null}
      <Panel>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-brand-heading">Arsip PDF</h2>
          {surat.status === "draf" || surat.retroaktif ? (
            <label className={secondaryButton}>
              Unggah PDF
              <input
                type="file"
                accept="application/pdf"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) run(() => sekretariatUpload(`/surat/${surat.id}/berkas`, file));
                }}
              />
            </label>
          ) : null}
        </div>
        {surat.berkas.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Belum ada PDF. Surat tidak dapat terbit tanpa arsip finalnya.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {surat.berkas.map((berkas) => (
              <li key={berkas.id} className="flex items-center justify-between gap-2 text-sm">
                <a className="truncate font-semibold text-brand-primary-deep hover:underline" href={berkasUrl(berkas.id)} target="_blank" rel="noreferrer">{berkas.nama}</a>
                <span className="shrink-0 text-xs text-muted-foreground">{formatUkuran(berkas.ukuran)}{berkas.terkunci ? " · terkunci" : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {surat.status === "terbit" && !surat.retroaktif ? (
          <p className="mt-2 text-xs text-muted-foreground">Surat terbit terkunci: koreksi berarti membatalkan surat ini dan menerbitkan surat baru.</p>
        ) : null}
      </Panel>
    </div>
  );
}
