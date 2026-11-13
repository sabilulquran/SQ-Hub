import { useState } from "react";

import {
  berkasUrl, errorMessage, formatTanggal, formatUkuran, sekretariatFetch, sekretariatUpload, STATUS_SURAT_MASUK,
  type KotakRingkas, type SekretariatContext, type SuratMasukDetail, type SuratMasukRingkas,
} from "@/sekretariat/api";

export interface PenerbitRingkas {
  id: string;
  kode: string;
  nama: string;
  kelompok: string;
}
import { navigate } from "@/sekretariat/routes";
import { ErrorNote, Field, Link, PageHeader, Panel, primaryButton, secondaryButton, StateCard, StatusBadge, useLoad } from "@/sekretariat/ui";

function kotakLabel(kotak: KotakRingkas): string {
  return kotak.jenis === "yayasan" ? "Kotak yayasan" : `${kotak.penerbit?.nama ?? kotak.penerbit?.kode ?? "Penerbit"}`;
}

function statusTone(status: SuratMasukRingkas["status"]): "biasa" | "baik" | "perhatian" | "bahaya" {
  return status === "selesai" ? "baik" : status === "didisposisi" ? "perhatian" : status === "spam" ? "bahaya" : "biasa";
}

/** SEK-IMPL-001 §9 Ringkasan: the inboxes and issuers the viewer may open, plus mail errors for the admin. */
export function RingkasanPage({ context }: { context: SekretariatContext }) {
  const { state } = useLoad(
    async () => {
      const [kotak, penerbit] = await Promise.all([
        sekretariatFetch<{ kotak: KotakRingkas[]; mail: { items: Array<{ mailbox: string; terakhirTarikPada: string | null; galatTerakhir: string | null }> } | null }>("/ringkasan"),
        sekretariatFetch<{ items: PenerbitRingkas[] }>("/penerbit"),
      ]);
      return { ...kotak, penerbitAktif: penerbit.items };
    },
    "ringkasan",
  );
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat ringkasan" />;
  if (state.status === "error") return <StateCard kind="error" title="Ringkasan belum dapat dimuat" body={state.message} />;
  const { kotak, mail, penerbitAktif } = state.data;
  const milikku = new Set(context.peran?.penerbitIds ?? []);
  const penerbitku = context.pengelola ? penerbitAktif : penerbitAktif.filter((penerbit) => milikku.has(penerbit.id));
  return (
    <div className="space-y-5">
      <PageHeader title="Ringkasan" eyebrow="Sekretariat Yayasan Sabilul Qur'an" />
      {kotak.length === 0 ? (
        <StateCard
          kind="empty"
          title="Anda belum ditunjuk sebagai petugas"
          body="Akses kotak masuk, register nomor, dan arsip diberikan per penerbit oleh pengelola Sekretariat. Hubungi Kepala HCM."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kotak.map((item) => (
            <Link key={item.id} href={`/kotak/${item.id}`} className="block">
              <Panel className="h-full transition hover:border-brand-primary/50">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-base font-bold text-brand-heading">{kotakLabel(item)}</h2>
                  {item.baru > 0 ? <StatusBadge label={`${item.baru} baru`} tone="perhatian" /> : <StatusBadge label="Tidak ada yang baru" tone="biasa" />}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.jenis === "yayasan" ? "Email sekretariat@ dan surat fisik untuk yayasan" : item.penerbit?.kode}
                </p>
                {item.disposisiTerbuka > 0 ? <p className="mt-2 text-xs font-bold text-warning-ink">{item.disposisiTerbuka} disposisi belum selesai</p> : null}
              </Panel>
            </Link>
          ))}
        </div>
      )}
      {penerbitku.length > 0 ? (
        <Panel>
          <h2 className="font-display text-base font-bold text-brand-heading">Surat keluar</h2>
          <p className="mt-1 text-sm text-muted-foreground">Register nomor dan arsip surat per penerbit.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {penerbitku.map((penerbit) => (
              <li key={penerbit.id}>
                <Link href={`/penerbit/${penerbit.id}/surat`} className={secondaryButton}>{penerbit.kode}</Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {context.pengelola && mail ? (
        <Panel>
          <h2 className="font-display text-base font-bold text-brand-heading">Penarik email</h2>
          {mail.items.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Belum pernah menarik email.</p> : null}
          <ul className="mt-2 space-y-1 text-sm">
            {mail.items.map((item) => (
              <li key={item.mailbox} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{item.mailbox}</span>
                <span className="text-muted-foreground">tarik terakhir {formatTanggal(item.terakhirTarikPada)}</span>
                {item.galatTerakhir ? <StatusBadge label={`galat: ${item.galatTerakhir}`} tone="bahaya" /> : <StatusBadge label="sehat" tone="baik" />}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

/** One inbox: e-mail and physical letters, with the register form for a scanned letter. */
export function KotakPage({ kotakId }: { kotakId: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const { state } = useLoad(
    () => sekretariatFetch<{ kotak: { jenis: string }; items: SuratMasukRingkas[]; total: number; pageSize: number }>(
      `/kotak/${kotakId}/surat?page=${page}${status ? `&status=${status}` : ""}`,
    ),
    `${kotakId}:${page}:${status}`,
  );
  const [form, setForm] = useState<{ dari: string; perihal: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat kotak masuk" />;
  if (state.status === "error") {
    return state.code === "tidak_ditemukan"
      ? <StateCard kind="forbidden" title="Kotak ini bukan milik Anda" body="Kotak masuk hanya terbuka bagi petugas penerbitnya." action={<Link className={secondaryButton} href="/">Ke Ringkasan</Link>} />
      : <StateCard kind="error" title="Kotak masuk belum dapat dimuat" body={state.message} />;
  }
  const data = state.data;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={<Link href="/" className="hover:underline">Ringkasan</Link>} title={data.kotak.jenis === "yayasan" ? "Kotak yayasan" : "Kotak masuk"} actions={
        <>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="sq-admin-input !mt-0 w-auto" aria-label="Saring status">
            <option value="">Semua status</option>
            {Object.entries(STATUS_SURAT_MASUK).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button type="button" className={primaryButton} onClick={() => setForm({ dari: "", perihal: "" })}>Catat surat fisik</button>
        </>
      } />
      {form ? (
        <Panel>
          <h2 className="font-display text-base font-bold text-brand-heading">Catat surat fisik</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Dari"><input className="sq-admin-input" value={form.dari} onChange={(event) => setForm({ ...form, dari: event.target.value })} placeholder="Pengirim surat" /></Field>
            <Field label="Perihal"><input className="sq-admin-input" value={form.perihal} onChange={(event) => setForm({ ...form, perihal: event.target.value })} placeholder="Perihal surat" /></Field>
          </div>
          <ErrorNote message={error} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                sekretariatFetch<{ id: string }>(`/kotak/${kotakId}/surat`, { method: "POST", body: { dari: form.dari, perihal: form.perihal } })
                  .then((created) => navigate(`/surat-masuk/${created.id}`))
                  .catch((failure) => setError(errorMessage(failure)))
                  .finally(() => setBusy(false));
              }}
            >
              Simpan lalu unggah pindaian
            </button>
            <button type="button" className={secondaryButton} onClick={() => setForm(null)}>Batal</button>
          </div>
        </Panel>
      ) : null}
      {data.items.length === 0 ? (
        <StateCard kind="empty" title="Kotak ini kosong" body="Email baru ke sekretariat@sabilulquran.or.id dan surat fisik yang dicatat akan muncul di sini." />
      ) : (
        <Panel className="divide-y divide-border/60 !p-0">
          {data.items.map((item) => (
            <Link key={item.id} href={`/surat-masuk/${item.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{item.perihal || "(tanpa perihal)"}</p>
                <p className="truncate text-xs text-muted-foreground">{item.kanal === "email" ? "Email" : "Fisik"} · {item.dari} · {formatTanggal(item.diterimaPada)}</p>
              </div>
              <StatusBadge label={STATUS_SURAT_MASUK[item.status]} tone={statusTone(item.status)} />
            </Link>
          ))}
        </Panel>
      )}
      <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <button type="button" className={secondaryButton} disabled={page <= 1} onClick={() => onPage(page - 1)}>Sebelumnya</button>
      <span className="text-muted-foreground">Halaman {page} dari {last} · {total} baris</span>
      <button type="button" className={secondaryButton} disabled={page >= last} onClick={() => onPage(page + 1)}>Berikutnya</button>
    </div>
  );
}

/** One incoming letter: content, attachments, dispositions, replies, the disposition form. */
export function SuratMasukPage({ suratMasukId, context }: { suratMasukId: string; context: SekretariatContext }) {
  const { state, reload } = useLoad(() => sekretariatFetch<SuratMasukDetail>(`/surat-masuk/${suratMasukId}`), suratMasukId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disposisi, setDisposisi] = useState<{ kePenerbitId: string; catatan: string; tenggat: string } | null>(null);
  const [penerbitPilihan, setPenerbitPilihan] = useState<PenerbitRingkas[] | null>(null);
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat surat" />;
  if (state.status === "error") return <StateCard kind="error" title="Surat belum dapat dimuat" body={state.message} />;
  const surat = state.data;
  const bolehDisposisi = surat.kotak.jenis === "yayasan" && (context.pengelola || context.peran?.disposisi) && surat.status !== "spam";
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work().then(() => reload()).catch((failure) => setError(errorMessage(failure))).finally(() => setBusy(false));
  };
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={<Link href={`/kotak/${surat.kotak.id}`} className="hover:underline">Kotak masuk</Link>} title={surat.perihal || "(tanpa perihal)"} actions={
        <>
          {bolehDisposisi ? (
            <button
              type="button"
              className={primaryButton}
              onClick={() => {
                setDisposisi({ kePenerbitId: "", catatan: "", tenggat: "" });
                if (!penerbitPilihan) {
                  void sekretariatFetch<{ items: PenerbitRingkas[] }>("/penerbit")
                    .then((body) => setPenerbitPilihan(body.items))
                    .catch(() => setPenerbitPilihan([]));
                }
              }}
            >
              Disposisi
            </button>
          ) : null}
          {bolehDisposisi && surat.status === "baru" ? (
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => run(() => sekretariatFetch(`/surat-masuk/${surat.id}/spam`, { method: "POST", body: {} }))}>Tandai spam</button>
          ) : null}
        </>
      }>
        <p className="mt-1 text-sm text-muted-foreground">{surat.kanal === "email" ? "Email" : "Surat fisik"} · {surat.dari} · {formatTanggal(surat.diterimaPada)} · <StatusBadge label={STATUS_SURAT_MASUK[surat.status]} tone={statusTone(surat.status)} /></p>
      </PageHeader>
      <ErrorNote message={error} />
      {disposisi ? (
        <Panel>
          <h2 className="font-display text-base font-bold text-brand-heading">Disposisi ke penerbit</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Penerbit tujuan">
              <select className="sq-admin-input" value={disposisi.kePenerbitId} onChange={(event) => setDisposisi({ ...disposisi, kePenerbitId: event.target.value })}>
                <option value="">— pilih —</option>
                {(penerbitPilihan ?? []).map((penerbit) => <option key={penerbit.id} value={penerbit.id}>{penerbit.kode} — {penerbit.nama}</option>)}
              </select>
            </Field>
            <Field label="Catatan"><input className="sq-admin-input" value={disposisi.catatan} onChange={(event) => setDisposisi({ ...disposisi, catatan: event.target.value })} placeholder="Apa yang diminta" /></Field>
            <Field label="Tenggat (opsional)"><input type="date" className="sq-admin-input" value={disposisi.tenggat} onChange={(event) => setDisposisi({ ...disposisi, tenggat: event.target.value })} /></Field>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={primaryButton}
              disabled={busy || !disposisi.kePenerbitId || !disposisi.catatan.trim()}
              onClick={() => run(async () => {
                await sekretariatFetch(`/surat-masuk/${surat.id}/disposisi`, {
                  method: "POST",
                  body: { ke_penerbit_id: disposisi.kePenerbitId, catatan: disposisi.catatan, ...(disposisi.tenggat ? { tenggat_pada: disposisi.tenggat } : {}) },
                });
                setDisposisi(null);
              })}
            >
              Kirim disposisi
            </button>
            <button type="button" className={secondaryButton} onClick={() => setDisposisi(null)}>Batal</button>
          </div>
        </Panel>
      ) : null}
      {surat.isiTeks ? (
        <Panel>
          <h2 className="font-display text-base font-bold text-brand-heading">Isi</h2>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm text-foreground">{surat.isiTeks}</pre>
        </Panel>
      ) : null}
      <Panel>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-brand-heading">Berkas</h2>
          <label className={secondaryButton}>
            Unggah pindaian
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) run(() => sekretariatUpload(`/surat-masuk/${surat.id}/berkas`, file));
              }}
            />
          </label>
        </div>
        {surat.berkas.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Belum ada berkas.</p> : (
          <ul className="mt-2 space-y-1">
            {surat.berkas.map((berkas) => (
              <li key={berkas.id} className="flex items-center justify-between gap-2 text-sm">
                <a className="truncate font-semibold text-brand-primary-deep hover:underline" href={berkasUrl(berkas.id)} target="_blank" rel="noreferrer">{berkas.nama}</a>
                <span className="shrink-0 text-xs text-muted-foreground">{formatUkuran(berkas.ukuran)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel>
        <h2 className="font-display text-base font-bold text-brand-heading">Disposisi</h2>
        {surat.disposisi.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Belum ada disposisi.</p> : (
          <ul className="mt-2 space-y-2">
            {surat.disposisi.map((item) => (
              <li key={item.id} className="rounded-xl border border-border/60 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-brand-heading">{item.kePenerbit ? `${item.kePenerbit.kode}` : "—"}</span>
                  {item.tenggatPada ? <span className="text-xs text-muted-foreground">tenggat {formatTanggal(item.tenggatPada)}</span> : null}
                  {item.selesaiPada
                    ? <StatusBadge label={`Selesai ${formatTanggal(item.selesaiPada)}`} tone="baik" />
                    : <StatusBadge label="Belum selesai" tone="perhatian" />}
                </div>
                <p className="mt-1 text-foreground">{item.catatan}</p>
                {item.selesaiKeterangan ? <p className="mt-1 text-muted-foreground">Keterangan: {item.selesaiKeterangan}</p> : null}
                {!item.selesaiPada ? <SelesaiButton disposisiId={item.id} onDone={() => void reload()} /> : null}
              </li>
            ))}
          </ul>
        )}
        {surat.balasan.length > 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Balasan: {surat.balasan.map((balasan) => (
              <Link key={balasan.id} href={`/surat/${balasan.id}`} className="font-semibold text-brand-primary-deep hover:underline">{balasan.nomor ?? `(draf ${balasan.status})`}</Link>
            ))}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

function SelesaiButton({ disposisiId, onDone }: { disposisiId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [keterangan, setKeterangan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button type="button" className={`${secondaryButton} mt-2`} onClick={() => setOpen(true)}>Tandai selesai</button>;
  return (
    <div className="mt-2 space-y-2">
      <Field label="Keterangan penyelesaian"><input className="sq-admin-input" value={keterangan} onChange={(event) => setKeterangan(event.target.value)} placeholder="Apa yang sudah dikerjakan" /></Field>
      <ErrorNote message={error} />
      <div className="flex gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={busy || !keterangan.trim()}
          onClick={() => {
            setBusy(true);
            setError(null);
            sekretariatFetch(`/disposisi/${disposisiId}/selesai`, { method: "POST", body: { keterangan } })
              .then(onDone)
              .catch((failure) => setError(errorMessage(failure)))
              .finally(() => setBusy(false));
          }}
        >
          Selesai
        </button>
        <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>Batal</button>
      </div>
    </div>
  );
}
