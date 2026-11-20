import {
  ChevronLeft, ChevronRight, FileText, Inbox, Mail, Paperclip, PenLine, Search, Send, ShieldAlert, Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DetailDialog } from "@/components/DetailDialog";
import { useDialogParam } from "@/components/useDialogParam";
import {
  berkasUrl, errorMessage, formatTanggal, formatUkuran, sekretariatFetch, sekretariatUpload, STATUS_SURAT_MASUK,
  type KotakRingkas, type SekretariatContext, type SuratMasukDetail, type SuratMasukRingkas,
} from "@/sekretariat/api";
import { navigate } from "@/sekretariat/routes";
import { kotakLabel, parseSender, tanggalRingkas } from "@/sekretariat/format";
import { ErrorNote, Field, Link, PageHeader, Panel, primaryButton, secondaryButton, StateCard, StatusBadge, useLoad } from "@/sekretariat/ui";

export interface PenerbitRingkas {
  id: string;
  kode: string;
  nama: string;
  kelompok: string;
}

type StatusSaring = "" | SuratMasukRingkas["status"];

const SARING: Array<{ value: StatusSaring; label: string }> = [
  { value: "", label: "Semua" },
  { value: "baru", label: "Baru" },
  { value: "didisposisi", label: "Didisposisi" },
  { value: "selesai", label: "Selesai" },
  { value: "spam", label: "Spam" },
];

function statusTone(status: SuratMasukRingkas["status"]): "biasa" | "baik" | "perhatian" | "bahaya" {
  return status === "selesai" ? "baik" : status === "didisposisi" ? "perhatian" : status === "spam" ? "bahaya" : "biasa";
}

/** `/` — a mail client opens on its inbox, so home is the first inbox the viewer may open. */
export function BerandaPage({ kotak }: { kotak: KotakRingkas[] | null }) {
  const first = kotak?.[0];
  useEffect(() => {
    if (first) navigate(`/kotak/${first.id}${window.location.search}`, true);
  }, [first]);
  if (kotak === null) return <StateCard kind="loading" title="Memuat kotak masuk" />;
  if (!first) {
    return (
      <StateCard
        kind="empty"
        title="Anda belum ditunjuk sebagai petugas"
        body="Akses kotak masuk, register nomor, dan arsip diberikan per penerbit oleh pengelola Sekretariat. Hubungi Kepala HCM."
      />
    );
  }
  return <StateCard kind="loading" title="Membuka kotak masuk" />;
}

/**
 * SEK-IMPL-003: one inbox, read like a mail client. Dense rows with sender, subject and the opening
 * words; unread ("baru") in bold with a dot; a search box and status filter that never move the
 * list; the letter opens as a pop-up over the list (`?surat=<id>`), so Back closes it and the list
 * keeps its place.
 */
export function KotakPage({ kotakId, kotak, context, onChanged }: {
  kotakId: string;
  kotak: KotakRingkas[] | null;
  context: SekretariatContext;
  onChanged: () => void;
}) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusSaring>("");
  const [ketik, setKetik] = useState("");
  const [cari, setCari] = useState("");
  const [suratId, bukaSurat, tutupSurat] = useDialogParam("surat");
  const [catat, setCatat] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => { setCari(ketik.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [ketik]);

  const query = `page=${page}${status ? `&status=${status}` : ""}${cari ? `&q=${encodeURIComponent(cari)}` : ""}`;
  const { state, reload } = useLoad(
    () => sekretariatFetch<{ kotak: { id: string; jenis: string }; items: SuratMasukRingkas[]; total: number; pageSize: number }>(`/kotak/${kotakId}/surat?${query}`),
    `${kotakId}:${query}`,
  );
  // Searching or filtering keeps the last rows on screen until the new ones arrive, so the list
  // never collapses into a skeleton and back while someone types (SEK-IMPL-003 T-5).
  const terakhir = useRef<{ items: SuratMasukRingkas[]; total: number; pageSize: number } | null>(null);
  if (state.status === "ready") terakhir.current = state.data;
  const data = state.status === "ready" ? state.data : state.status === "loading" ? terakhir.current : null;
  const memuat = state.status === "loading";
  const ini = kotak?.find((item) => item.id === kotakId);
  const judul = ini ? kotakLabel(ini) : "Kotak masuk";
  const refresh = () => { void reload(); onChanged(); };

  if (state.status === "error" && state.code === "tidak_ditemukan") {
    return (
      <>
        <StateCard kind="forbidden" title="Kotak ini bukan milik Anda" body="Kotak masuk hanya terbuka bagi petugas penerbitnya." action={<Link className={secondaryButton} href="/">Ke kotak masuk Anda</Link>} />
        {/* A letter the viewer may read still opens; the server decides on the letter itself. */}
        {suratId ? <SuratDialog suratId={suratId} context={context} onClose={tutupSurat} onChanged={refresh} /> : null}
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title={judul}
        eyebrow={ini && ini.baru > 0 ? `${ini.baru} surat baru` : "Kotak masuk"}
        actions={<button type="button" className={primaryButton} onClick={() => setCatat(true)}><PenLine className="h-4 w-4" aria-hidden="true" />Catat surat fisik</button>}
      />

      <Panel className="!p-0">
        {/* The toolbar has a fixed height and lives above the list; typing or filtering never moves the rows. */}
        <div className="flex flex-col gap-2 border-b border-border px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
          <label className="relative flex min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Cari surat</span>
            <input
              type="search"
              value={ketik}
              onChange={(event) => setKetik(event.target.value)}
              placeholder="Cari pengirim, perihal, atau isi"
              className="sq-admin-input !mt-0 w-full !pl-9"
            />
          </label>
          <div role="tablist" aria-label="Saring status" className="flex shrink-0 gap-1 overflow-x-auto">
            {SARING.map((item) => (
              <button
                key={item.value || "semua"}
                type="button"
                role="tab"
                aria-selected={status === item.value}
                onClick={() => { setStatus(item.value); setPage(1); }}
                className={[
                  "min-h-9 shrink-0 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  status === item.value ? "bg-brand-primary-pale font-bold text-brand-primary-deep" : "font-semibold text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {state.status === "error" ? (
          <div className="p-4"><StateCard kind="error" title="Kotak masuk belum dapat dimuat" body={state.message} /></div>
        ) : data === null ? (
          <ListSkeleton />
        ) : data.items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-bold text-foreground">{cari || status ? "Tidak ada surat yang cocok" : "Kotak ini kosong"}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {cari || status
                ? "Ubah kata pencarian atau pilih status lain."
                : ini?.jenis === "yayasan"
                  ? "Email ke sekretariat@sabilulquran.or.id dan surat fisik yang dicatat akan muncul di sini."
                  : "Disposisi dari kotak yayasan dan surat fisik penerbit ini akan muncul di sini."}
            </p>
          </div>
        ) : (
          <ul className={["divide-y divide-border/70 transition-opacity", memuat ? "opacity-60" : ""].join(" ")} aria-busy={memuat}>
            {data.items.map((item) => <SuratRow key={item.id} item={item} onOpen={() => bukaSurat(item.id)} />)}
          </ul>
        )}

        {data && data.total > 0 ? (
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        ) : null}
      </Panel>

      {suratId ? <SuratDialog suratId={suratId} context={context} onClose={tutupSurat} onChanged={refresh} /> : null}
      {catat ? (
        <CatatFisikDialog
          kotakId={kotakId}
          onClose={() => setCatat(false)}
          onCreated={(id) => { setCatat(false); refresh(); bukaSurat(id); }}
        />
      ) : null}
    </div>
  );
}

function SuratRow({ item, onOpen }: { item: SuratMasukRingkas; onOpen: () => void }) {
  const unread = item.status === "baru";
  const pengirim = parseSender(item.dari);
  const tanggal = tanggalRingkas(item.diterimaPada);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={[
          "grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none sm:grid-cols-[12px_minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-center sm:px-4 sm:py-2.5",
          unread ? "" : "text-muted-foreground",
        ].join(" ")}
      >
        <span className="flex h-5 items-center justify-center sm:h-auto" aria-hidden="true">
          {unread ? <span className="h-2 w-2 rounded-full bg-brand-primary" /> : null}
        </span>
        <span className={["min-w-0 truncate text-sm sm:col-auto", unread ? "font-bold text-foreground" : "font-semibold"].join(" ")}>
          {pengirim.nama}
        </span>
        {/* On phones subject and preview take the second line under the sender. */}
        <span className="col-start-2 col-end-4 row-start-2 min-w-0 truncate text-sm sm:col-auto sm:row-auto">
          <span className={unread ? "font-bold text-foreground" : "font-semibold text-foreground"}>{item.perihal || "(tanpa perihal)"}</span>
          {item.cuplikan ? <span className="text-muted-foreground"> — {item.cuplikan}</span> : null}
        </span>
        <span className="col-start-3 row-start-1 flex shrink-0 items-center gap-2 justify-self-end sm:col-auto sm:row-auto">
          {item.kanal === "fisik" ? <span className="text-[11px] font-semibold text-muted-foreground">Fisik</span> : null}
          {item.status !== "baru" ? <StatusBadge label={STATUS_SURAT_MASUK[item.status]} tone={statusTone(item.status)} /> : null}
          {item.lampiran > 0 ? <Paperclip className="h-4 w-4 text-muted-foreground" aria-label={`${item.lampiran} lampiran`} /> : null}
          <time dateTime={item.diterimaPada} className={["w-14 text-right text-xs tabular-nums", unread ? "font-bold text-foreground" : "text-muted-foreground"].join(" ")}>
            {tanggal}
          </time>
        </span>
        <span className="sr-only">{unread ? ", baru" : ""}</span>
      </button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-border/70" aria-busy="true" aria-label="Memuat surat">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3.5">
          <span className="h-3 w-32 rounded bg-muted" />
          <span className="h-3 flex-1 rounded bg-muted" />
          <span className="h-3 w-10 rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}

/** "1–25 dari 103" with previous and next, the way a mail list pages. Shared with Buku nomor. */
export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-end gap-1 border-t border-border px-3 py-2 text-xs text-muted-foreground sm:px-4">
      <span className="mr-2 tabular-nums">{from}–{to} dari {total}</span>
      <button type="button" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => onPage(page - 1)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" aria-label="Halaman berikutnya" disabled={page >= last} onClick={() => onPage(page + 1)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function CatatFisikDialog({ kotakId, onClose, onCreated }: { kotakId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ dari: "", perihal: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DetailDialog title="Catat surat fisik" description="Isi pengirim dan perihal, lalu unggah pindaiannya dari surat yang terbuka." onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Dari"><input className="sq-admin-input" value={form.dari} onChange={(event) => setForm({ ...form, dari: event.target.value })} placeholder="Pengirim surat" autoFocus /></Field>
        <Field label="Perihal"><input className="sq-admin-input" value={form.perihal} onChange={(event) => setForm({ ...form, perihal: event.target.value })} placeholder="Perihal surat" /></Field>
      </div>
      <ErrorNote message={error} />
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Batal</button>
        <button
          type="button"
          className={primaryButton}
          disabled={busy || !form.dari.trim()}
          onClick={() => {
            setBusy(true);
            setError(null);
            sekretariatFetch<{ id: string }>(`/kotak/${kotakId}/surat`, { method: "POST", body: { dari: form.dari, perihal: form.perihal } })
              .then((created) => onCreated(created.id))
              .catch((failure) => setError(errorMessage(failure)))
              .finally(() => setBusy(false));
          }}
        >
          Simpan
        </button>
      </div>
    </DetailDialog>
  );
}

/**
 * The open letter: who sent it and when, the text set for reading (not a code box), the files as
 * attachments, then the dispositions. Actions sit at the top where a mail client keeps them.
 */
function SuratDialog({ suratId, context, onClose, onChanged }: { suratId: string; context: SekretariatContext; onClose: () => void; onChanged: () => void }) {
  const { state, reload } = useLoad(() => sekretariatFetch<SuratMasukDetail>(`/surat-masuk/${suratId}`), suratId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disposisi, setDisposisi] = useState(false);
  const [selesai, setSelesai] = useState<string | null>(null);

  if (state.status !== "ready") {
    return (
      <DetailDialog label="Surat" onClose={onClose}>
        {state.status === "loading"
          ? <StateCard kind="loading" title="Membuka surat" />
          : <StateCard kind="error" title="Surat belum dapat dibuka" body={state.message} />}
      </DetailDialog>
    );
  }
  const surat = state.data;
  const pengirim = parseSender(surat.dari);
  const bolehDisposisi = surat.kotak.jenis === "yayasan" && (context.pengelola || context.peran?.disposisi) && surat.status !== "spam";
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work().then(() => { void reload(); onChanged(); }).catch((failure) => setError(errorMessage(failure))).finally(() => setBusy(false));
  };

  return (
    <DetailDialog title={surat.perihal || "(tanpa perihal)"} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2">
        {bolehDisposisi ? (
          <button type="button" className={primaryButton} disabled={busy} onClick={() => setDisposisi(true)}>
            <Send className="h-4 w-4" aria-hidden="true" />Disposisi
          </button>
        ) : null}
        <label className={`${secondaryButton} cursor-pointer`}>
          <Upload className="h-4 w-4" aria-hidden="true" />Unggah pindaian
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) run(() => sekretariatUpload(`/surat-masuk/${surat.id}/berkas`, file));
            }}
          />
        </label>
        {bolehDisposisi && surat.status === "baru" ? (
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => run(() => sekretariatFetch(`/surat-masuk/${surat.id}/spam`, { method: "POST", body: {} }))}>
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />Tandai spam
          </button>
        ) : null}
      </div>
      <ErrorNote message={error} />

      {/* Sender block, the way a letter or an e-mail header reads. */}
      <div className="mt-5 flex items-start gap-3 border-b border-border pb-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary-pale text-brand-primary-deep" aria-hidden="true">
          {surat.kanal === "email" ? <Mail className="h-[18px] w-[18px]" /> : <FileText className="h-[18px] w-[18px]" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">{pengirim.nama}</p>
          <p className="truncate text-xs text-muted-foreground">
            {pengirim.alamat ?? (surat.kanal === "fisik" ? "Surat fisik" : "Email")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs tabular-nums text-muted-foreground">{formatTanggal(surat.diterimaPada)}</p>
          <div className="mt-1"><StatusBadge label={STATUS_SURAT_MASUK[surat.status]} tone={statusTone(surat.status)} /></div>
        </div>
      </div>

      {surat.isiTeks ? (
        <div className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground">{surat.isiTeks}</div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{surat.kanal === "fisik" ? "Isi surat ada di pindaiannya." : "Email ini tidak berisi teks."}</p>
      )}

      {surat.berkas.length > 0 ? (
        <section aria-label="Lampiran" className="mt-6">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">{surat.berkas.length} lampiran</p>
          <ul className="flex flex-wrap gap-2">
            {surat.berkas.map((berkas) => (
              <li key={berkas.id}>
                <a
                  href={berkasUrl(berkas.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex max-w-[16rem] items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{berkas.nama}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatUkuran(berkas.ukuran)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {surat.disposisi.length > 0 || surat.balasan.length > 0 ? (
        <section aria-label="Disposisi" className="mt-6 border-t border-border pt-4">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Disposisi</p>
          <ul className="space-y-2">
            {surat.disposisi.map((item) => (
              <li key={item.id} className="rounded-xl border border-border px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-foreground">{item.kePenerbit?.nama ?? item.kePenerbit?.kode ?? "Penerbit"}</span>
                  {item.tenggatPada ? <span className="text-xs text-muted-foreground">tenggat {formatTanggal(item.tenggatPada)}</span> : null}
                  <span className="ml-auto">
                    {item.selesaiPada
                      ? <StatusBadge label={`Selesai ${formatTanggal(item.selesaiPada)}`} tone="baik" />
                      : <StatusBadge label="Belum selesai" tone="perhatian" />}
                  </span>
                </div>
                <p className="mt-1 text-foreground">{item.catatan}</p>
                {item.selesaiKeterangan ? <p className="mt-1 text-muted-foreground">{item.selesaiKeterangan}</p> : null}
                {!item.selesaiPada ? (
                  <button type="button" className={`${secondaryButton} mt-2`} onClick={() => setSelesai(item.id)}>Tandai selesai</button>
                ) : null}
              </li>
            ))}
          </ul>
          {surat.balasan.length > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Dibalas dengan{" "}
              {surat.balasan.map((balasan, index) => (
                <span key={balasan.id}>
                  {index > 0 ? ", " : null}
                  <Link href={`/surat/${balasan.id}`} className="font-semibold text-brand-primary-deep hover:underline">{balasan.nomor ?? `draf ${balasan.status}`}</Link>
                </span>
              ))}
            </p>
          ) : null}
        </section>
      ) : null}

      {disposisi ? <DisposisiDialog suratId={surat.id} onClose={() => setDisposisi(false)} onDone={() => { setDisposisi(false); void reload(); onChanged(); }} /> : null}
      {selesai ? <SelesaiDialog disposisiId={selesai} onClose={() => setSelesai(null)} onDone={() => { setSelesai(null); void reload(); onChanged(); }} /> : null}
    </DetailDialog>
  );
}

/** Stacked once on the open letter, which the shell rule allows for a confirmation-sized form. */
function DisposisiDialog({ suratId, onClose, onDone }: { suratId: string; onClose: () => void; onDone: () => void }) {
  const { state } = useLoad(() => sekretariatFetch<{ items: PenerbitRingkas[] }>("/penerbit"), "penerbit-disposisi");
  const [value, setValue] = useState({ kePenerbitId: "", catatan: "", tenggat: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DetailDialog title="Disposisi" description="Teruskan surat ini ke kotak masuk penerbit yang menindaklanjuti." onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Ke penerbit">
          <select className="sq-admin-input" value={value.kePenerbitId} onChange={(event) => setValue({ ...value, kePenerbitId: event.target.value })} disabled={state.status !== "ready"}>
            <option value="">{state.status === "loading" ? "Memuat penerbit" : "Pilih penerbit"}</option>
            {state.status === "ready" ? state.data.items.map((penerbit) => <option key={penerbit.id} value={penerbit.id}>{penerbit.nama} ({penerbit.kode})</option>) : null}
          </select>
        </Field>
        <Field label="Catatan"><textarea className="sq-admin-input" rows={3} value={value.catatan} onChange={(event) => setValue({ ...value, catatan: event.target.value })} placeholder="Apa yang diminta" /></Field>
        <Field label="Tenggat" helper="Boleh dikosongkan"><input type="date" className="sq-admin-input" value={value.tenggat} onChange={(event) => setValue({ ...value, tenggat: event.target.value })} /></Field>
      </div>
      <ErrorNote message={state.status === "error" ? state.message : error} />
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Batal</button>
        <button
          type="button"
          className={primaryButton}
          disabled={busy || !value.kePenerbitId || !value.catatan.trim()}
          onClick={() => {
            setBusy(true);
            setError(null);
            sekretariatFetch(`/surat-masuk/${suratId}/disposisi`, {
              method: "POST",
              body: { ke_penerbit_id: value.kePenerbitId, catatan: value.catatan, ...(value.tenggat ? { tenggat_pada: value.tenggat } : {}) },
            })
              .then(onDone)
              .catch((failure) => setError(errorMessage(failure)))
              .finally(() => setBusy(false));
          }}
        >
          Kirim disposisi
        </button>
      </div>
    </DetailDialog>
  );
}

function SelesaiDialog({ disposisiId, onClose, onDone }: { disposisiId: string; onClose: () => void; onDone: () => void }) {
  const [keterangan, setKeterangan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DetailDialog title="Tandai disposisi selesai" onClose={onClose}>
      <Field label="Apa yang sudah dikerjakan"><textarea className="sq-admin-input" rows={3} value={keterangan} onChange={(event) => setKeterangan(event.target.value)} autoFocus /></Field>
      <ErrorNote message={error} />
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Batal</button>
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
      </div>
    </DetailDialog>
  );
}

/** The old `/surat-masuk/<id>` link lands on the same letter as a pop-up over its inbox. */
export function SuratMasukRedirect({ suratMasukId, kotak }: { suratMasukId: string; kotak: KotakRingkas[] | null }) {
  const { state } = useLoad(() => sekretariatFetch<SuratMasukDetail>(`/surat-masuk/${suratMasukId}`), suratMasukId);
  useEffect(() => {
    if (state.status !== "ready" || kotak === null) return;
    // A letter disposed from the foundation inbox lives there, but a penerbit officer may read it
    // only through their own inbox. Land on an inbox the viewer can open: the letter's own when
    // it is theirs, else the inbox of a penerbit it was disposed to, else the first one they have.
    const surat = state.data;
    const bisa = new Set(kotak.map((item) => item.id));
    const kodeDisposisi = new Set(surat.disposisi.map((item) => item.kePenerbit?.kode).filter(Boolean));
    const tujuan = bisa.has(surat.kotak.id)
      ? surat.kotak.id
      : kotak.find((item) => item.penerbit?.kode && kodeDisposisi.has(item.penerbit.kode))?.id ?? kotak[0]?.id;
    if (tujuan) navigate(`/kotak/${tujuan}?surat=${suratMasukId}`, true);
  }, [state, suratMasukId, kotak]);
  if (state.status === "error") return <StateCard kind="error" title="Surat belum dapat dibuka" body={state.message} action={<Link className={secondaryButton} href="/">Ke kotak masuk</Link>} />;
  return <StateCard kind="loading" title="Membuka surat" />;
}

/** Surat keluar: the issuers whose register and archive the viewer may open. */
export function SuratKeluarPage({ context }: { context: SekretariatContext }) {
  const { state } = useLoad(() => sekretariatFetch<{ items: PenerbitRingkas[] }>("/penerbit"), "surat-keluar");
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat penerbit" />;
  if (state.status === "error") return <StateCard kind="error" title="Penerbit belum dapat dimuat" body={state.message} />;
  const milikku = new Set(context.peran?.penerbitIds ?? []);
  const items = context.pengelola ? state.data.items : state.data.items.filter((penerbit) => milikku.has(penerbit.id));
  return (
    <div>
      <PageHeader title="Surat keluar" eyebrow="Register nomor dan arsip per penerbit" />
      {items.length === 0 ? (
        <StateCard kind="empty" title="Anda belum memegang penerbit" body="Hak menerbitkan surat diberikan per penerbit oleh pengelola Sekretariat." />
      ) : (
        <Panel className="!p-0">
          <ul className="divide-y divide-border/70">
            {items.map((penerbit) => (
              <li key={penerbit.id}>
                <Link href={`/penerbit/${penerbit.id}/surat`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">{penerbit.nama}</span>
                    <span className="block truncate text-xs text-muted-foreground">{penerbit.kode}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
