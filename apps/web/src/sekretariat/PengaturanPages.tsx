import { Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { DetailDialog } from "@/components/DetailDialog";
import {
  errorMessage, formatTanggal, sekretariatAdminFetch, SekretariatRequestError,
  type Jenis, type Orang, type Penerbit,
} from "@/sekretariat/api";
import { MailboxPage } from "@/sekretariat/MailboxPage";
import { ErrorNote, Field, PageHeader, Panel, primaryButton, ReasonDialog, secondaryButton, StateCard, StatusBadge, useLoad, type Loaded } from "@/sekretariat/ui";

/**
 * SEK-IMPL-001 §9 Pengaturan, one short page per concern. Each page is a list with one primary
 * action, and every add form opens in a pop-up so the page behind never moves
 * (docs/design/sq-core-app-shell.md "Detail views open as a pop-up").
 */

type Bagian = "kotak-masuk" | "penerbit" | "petugas" | "disposisi" | "nomor-awal";

interface Petugas {
  id: string;
  penerbitId: string;
  penerbitKode: string;
  personId: string;
  alasan: string;
  diberikanPada: string;
  nama: string | null;
}

interface PemegangDisposisi {
  id: string;
  personId: string;
  alasan: string;
  diberikanPada: string;
  nama: string | null;
}

const EYEBROW = "Pengaturan Sekretariat";
const TIDAK_DI_DIREKTORI = "Orang tidak ditemukan di direktori";
const KODE_PANITIA = /^(PAN|TIM|SATGAS)\.[A-Z0-9][A-Z0-9-]{1,20}$/;
const barisDaftar = "flex min-h-16 items-center gap-3 px-4 py-3";
const tombolCabut = "inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-bold text-destructive hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50";

export function PengaturanPage({ bagian }: { bagian: Bagian }) {
  switch (bagian) {
    case "kotak-masuk":
      return <MailboxPage />;
    case "penerbit":
      return <PenerbitPage />;
    case "petugas":
      return <PetugasPage />;
    case "disposisi":
      return <DisposisiPage />;
    case "nomor-awal":
      return <NomorAwalPage />;
  }
}

/** Loading, forbidden and error share one shape on every Pengaturan page. */
function BelumSiap({ state, memuat, gagal }: { state: Exclude<Loaded<unknown>, { status: "ready" }>; memuat: string; gagal: string }) {
  if (state.status === "loading") return <StateCard kind="loading" title={memuat} />;
  return state.code === "sekretariat_admin_required"
    ? <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Sekretariat" body="Hubungi Kepala HCM bila Anda seharusnya mengelola Sekretariat." />
    : <StateCard kind="error" title={gagal} body={state.message} />;
}

function TombolTambah({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={primaryButton} disabled={disabled} onClick={onClick}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Cancel and submit at the foot of every add form, stacked on a phone like MailboxPage. */
function KakiForm({ busy, siap, label, labelBusy }: { busy: boolean; siap: boolean; label: string; labelBusy: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="reset" className={secondaryButton} disabled={busy}>Batal</button>
      <button type="submit" className={primaryButton} disabled={busy || !siap}>{busy ? labelBusy : label}</button>
    </div>
  );
}

/** Shared pop-up form: submit runs `onSimpan`, reset (Batal) closes. */
function FormDialog({ title, description, busy, error, onSimpan, onClose, children, kaki }: {
  title: string;
  description: string;
  busy: boolean;
  error: string | null;
  onSimpan: () => void;
  onClose: () => void;
  children: ReactNode;
  kaki: ReactNode;
}) {
  return (
    <DetailDialog title={title} description={description} onClose={() => { if (!busy) onClose(); }}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onSimpan();
        }}
        onReset={(event) => {
          event.preventDefault();
          if (!busy) onClose();
        }}
      >
        {children}
        <ErrorNote message={error} />
        {kaki}
      </form>
    </DetailDialog>
  );
}

/** Runs one write; on success closes the dialog and reloads the list, on failure keeps the input. */
function useSimpan(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jalankan = (kerja: () => Promise<unknown>, selesai: () => void) => {
    setBusy(true);
    setError(null);
    kerja()
      .then(() => {
        selesai();
        return reload();
      })
      .catch((failure) => setError(errorMessage(failure)))
      .finally(() => setBusy(false));
  };
  return { busy, error, setError, jalankan };
}

/* ------------------------------------------------------------------ Penerbit */

interface PanitiaForm { kode: string; nama: string; berakhir: string; alasan: string }

function PenerbitPage() {
  const { state, reload } = useLoad(() => sekretariatAdminFetch<{ items: Penerbit[] }>("/penerbit"), "pengaturan-penerbit");
  const [form, setForm] = useState<PanitiaForm | null>(null);
  const simpan = useSimpan(reload);
  if (state.status !== "ready") return <BelumSiap state={state} memuat="Memuat penerbit" gagal="Daftar penerbit belum dapat dimuat" />;
  const penerbit = state.data.items;
  const buka = () => { simpan.setError(null); setForm({ kode: "", nama: "", berakhir: "", alasan: "" }); };
  const tombol = <TombolTambah label="Tambah panitia" onClick={buka} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Penerbit" eyebrow={EYEBROW} actions={tombol}>
        <p className="mt-1 text-sm text-muted-foreground">Kode tetap berasal dari pedoman. Panitia, tim, dan satgas dibuat di sini dengan masa berlaku.</p>
      </PageHeader>
      {penerbit.length === 0 ? (
        <StateCard kind="empty" title="Belum ada penerbit" body="Katalog penerbit dari pedoman belum terpasang. Panitia, tim, dan satgas dapat ditambahkan di sini." action={tombol} />
      ) : (
        <Panel className="!p-0">
          <ul className="divide-y divide-border">
            {penerbit.map((item) => (
              <li key={item.id} className={barisDaftar}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{item.kode}</span>
                    {!item.aktif ? <StatusBadge label="Nonaktif" tone="biasa" /> : null}
                    {item.berakhirPada ? <StatusBadge label={`Sampai ${formatTanggal(item.berakhirPada)}`} tone="perhatian" /> : null}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{item.nama}</p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">{item.petugasAktif} petugas</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {form ? (
        <FormDialog
          title="Tambah panitia"
          description="Penerbit sementara untuk panitia, tim, atau satgas. Nomornya berhenti terbit setelah tanggal berakhir."
          busy={simpan.busy}
          error={simpan.error}
          onClose={() => setForm(null)}
          onSimpan={() => simpan.jalankan(
            () => sekretariatAdminFetch("/penerbit", { method: "POST", body: { kode: form.kode, nama: form.nama.trim(), berakhir_pada: form.berakhir, alasan: form.alasan.trim() } }),
            () => setForm(null),
          )}
          kaki={<KakiForm busy={simpan.busy} siap={KODE_PANITIA.test(form.kode) && form.nama.trim().length >= 3 && form.berakhir !== "" && form.alasan.trim() !== ""} label="Simpan panitia" labelBusy="Menyimpan…" />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kode" helper="Diawali PAN., TIM., atau SATGAS. lalu alias, misalnya PAN.MILAD">
              <input className="sq-admin-input" autoComplete="off" value={form.kode} onChange={(event) => setForm({ ...form, kode: event.target.value.toUpperCase().replace(/\s/g, "") })} placeholder="PAN.MILAD" />
            </Field>
            <Field label="Nama" helper="Paling sedikit 3 huruf">
              <input className="sq-admin-input" autoComplete="off" value={form.nama} onChange={(event) => setForm({ ...form, nama: event.target.value })} />
            </Field>
            <Field label="Berakhir pada">
              <input type="date" className="sq-admin-input" value={form.berakhir} onChange={(event) => setForm({ ...form, berakhir: event.target.value })} />
            </Field>
            <Field label="Alasan" helper="Tercatat di jejak audit">
              <input className="sq-admin-input" maxLength={500} value={form.alasan} onChange={(event) => setForm({ ...form, alasan: event.target.value })} />
            </Field>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Pemilih orang */

type HasilCari = { status: "diam" } | { status: "mencari" } | { status: "siap"; items: Orang[] } | { status: "galat"; pesan: string };

/**
 * SEK-IMPL-003 person picker: searches the Organization Directory by name as the admin types and
 * never shows or asks for the raw directory id.
 */
function PemilihOrang({ value, onChange }: { value: Orang | null; onChange: (orang: Orang | null) => void }) {
  const [teks, setTeks] = useState("");
  const [hasil, setHasil] = useState<HasilCari>({ status: "diam" });
  const kunci = teks.trim();

  useEffect(() => {
    if (value || kunci.length < 2) return;
    let usang = false;
    const timer = window.setTimeout(() => {
      setHasil({ status: "mencari" });
      sekretariatAdminFetch<{ items: Orang[] }>(`/orang?q=${encodeURIComponent(kunci)}`)
        .then((body) => { if (!usang) setHasil({ status: "siap", items: body.items }); })
        .catch((failure) => {
          if (usang) return;
          const pesan = failure instanceof SekretariatRequestError && failure.code === "directory_belum_tersedia"
            ? "Direktori organisasi sedang tidak tersedia, jadi nama belum dapat dicari. Coba lagi beberapa saat lagi."
            : errorMessage(failure, "Pencarian gagal. Coba lagi.");
          setHasil({ status: "galat", pesan });
        });
    }, 250);
    return () => {
      usang = true;
      window.clearTimeout(timer);
    };
  }, [kunci, value]);

  if (value) {
    return (
      <div>
        <span className="mb-1.5 block text-xs font-bold text-brand-heading">Orang</span>
        <div className="flex min-h-16 items-center gap-3 rounded-xl border border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-foreground">{value.nama}</p>
            {value.unit ? <p className="truncate text-sm text-muted-foreground">{value.unit}</p> : null}
          </div>
          <button type="button" className={secondaryButton} onClick={() => { onChange(null); setTeks(""); setHasil({ status: "diam" }); }}>Ganti</button>
        </div>
      </div>
    );
  }

  const tampil: HasilCari = kunci.length < 2 ? { status: "diam" } : hasil;
  return (
    <div>
      <Field label="Orang" helper="Ketik paling sedikit 2 huruf nama">
        <input
          className="sq-admin-input"
          type="search"
          autoComplete="off"
          value={teks}
          onChange={(event) => setTeks(event.target.value)}
          placeholder="Cari nama"
        />
      </Field>
      <div aria-live="polite">
        {tampil.status === "mencari" ? <p className="mt-2 text-sm text-muted-foreground">Mencari…</p> : null}
        {tampil.status === "galat" ? <ErrorNote message={tampil.pesan} /> : null}
        {tampil.status === "siap" && tampil.items.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Tidak ada nama yang cocok di direktori</p> : null}
      </div>
      {tampil.status === "siap" && tampil.items.length > 0 ? (
        <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {tampil.items.map((orang) => (
            <li key={orang.id}>
              <button type="button" className="flex min-h-14 w-full flex-col justify-center px-3 py-2 text-left hover:bg-muted" onClick={() => onChange(orang)}>
                <span className="truncate text-sm font-semibold text-foreground">{orang.nama}</span>
                {orang.unit ? <span className="truncate text-xs text-muted-foreground">{orang.unit}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Petugas */

interface PetugasForm { penerbitId: string; orang: Orang | null; alasan: string }

function PetugasPage() {
  const { state, reload } = useLoad(
    async () => {
      const [petugas, penerbit] = await Promise.all([
        sekretariatAdminFetch<{ items: Petugas[] }>("/petugas"),
        sekretariatAdminFetch<{ items: Penerbit[] }>("/penerbit"),
      ]);
      return { petugas: petugas.items, penerbit: penerbit.items };
    },
    "pengaturan-petugas",
  );
  const [form, setForm] = useState<PetugasForm | null>(null);
  const [cabut, setCabut] = useState<Petugas | null>(null);
  const simpan = useSimpan(reload);
  if (state.status !== "ready") return <BelumSiap state={state} memuat="Memuat petugas" gagal="Daftar petugas belum dapat dimuat" />;
  const { petugas, penerbit } = state.data;
  const penerbitAktif = penerbit.filter((item) => item.aktif);
  const namaPenerbit = new Map(penerbit.map((item) => [item.id, item.nama]));
  const kelompok = new Map<string, Petugas[]>();
  for (const item of [...petugas].sort((a, b) => a.penerbitKode.localeCompare(b.penerbitKode) || (a.nama ?? "").localeCompare(b.nama ?? ""))) {
    kelompok.set(item.penerbitId, [...(kelompok.get(item.penerbitId) ?? []), item]);
  }
  const buka = () => { simpan.setError(null); setForm({ penerbitId: penerbitAktif.length === 1 ? penerbitAktif[0]!.id : "", orang: null, alasan: "" }); };
  const tombol = <TombolTambah label="Tambah petugas" disabled={penerbitAktif.length === 0} onClick={buka} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Petugas register" eyebrow={EYEBROW} actions={tombol}>
        <p className="mt-1 text-sm text-muted-foreground">Petugas mengambil nomor surat untuk penerbitnya, sekaligus membuka kotak masuk, register, dan arsip penerbit itu.</p>
      </PageHeader>
      {petugas.length === 0 ? (
        <StateCard
          kind="empty"
          title="Belum ada petugas"
          body={penerbitAktif.length === 0 ? "Belum ada penerbit aktif. Siapkan penerbit dulu, lalu tetapkan petugasnya di sini." : "Tetapkan satu orang per penerbit agar nomor surat dapat diambil."}
          action={penerbitAktif.length > 0 ? tombol : undefined}
        />
      ) : (
        <Panel className="!p-0">
          <ul className="divide-y divide-border">
            {[...kelompok.entries()].map(([penerbitId, daftar]) => (
              <li key={penerbitId}>
                <div className="flex min-h-10 items-center gap-2 bg-muted px-4 py-2 text-xs font-bold text-muted-foreground">
                  <span className="shrink-0">{daftar[0]!.penerbitKode}</span>
                  <span className="truncate font-semibold">{namaPenerbit.get(penerbitId) ?? ""}</span>
                </div>
                <ul className="divide-y divide-border">
                  {daftar.map((item) => (
                    <li key={item.id} className={barisDaftar}>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate ${item.nama ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{item.nama ?? TIDAK_DI_DIREKTORI}</p>
                        <p className="truncate text-sm text-muted-foreground">{item.penerbitKode} · sejak {formatTanggal(item.diberikanPada)}</p>
                      </div>
                      <button type="button" className={tombolCabut} onClick={() => { simpan.setError(null); setCabut(item); }}>Cabut</button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {form ? (
        <FormDialog
          title="Tambah petugas"
          description="Petugas langsung dapat mengambil nomor dan membuka kotak masuk penerbit yang dipilih."
          busy={simpan.busy}
          error={simpan.error}
          onClose={() => setForm(null)}
          onSimpan={() => {
            if (!form.orang) return;
            simpan.jalankan(
              () => sekretariatAdminFetch("/petugas", { method: "POST", body: { penerbit_id: form.penerbitId, person_id: form.orang!.id, alasan: form.alasan.trim() } }),
              () => setForm(null),
            );
          }}
          kaki={<KakiForm busy={simpan.busy} siap={form.penerbitId !== "" && form.orang !== null && form.alasan.trim() !== ""} label="Simpan petugas" labelBusy="Menyimpan…" />}
        >
          <Field label="Penerbit">
            <select className="sq-admin-input" value={form.penerbitId} onChange={(event) => setForm({ ...form, penerbitId: event.target.value })}>
              <option value="">Pilih penerbit</option>
              {penerbitAktif.map((item) => <option key={item.id} value={item.id}>{item.kode} — {item.nama}</option>)}
            </select>
          </Field>
          <PemilihOrang value={form.orang} onChange={(orang) => setForm({ ...form, orang })} />
          <Field label="Alasan" helper="Tercatat di jejak audit">
            <input className="sq-admin-input" maxLength={500} value={form.alasan} onChange={(event) => setForm({ ...form, alasan: event.target.value })} />
          </Field>
        </FormDialog>
      ) : null}

      {cabut ? (
        <ReasonDialog
          title={`Cabut ${cabut.nama ?? "petugas ini"} dari ${cabut.penerbitKode}?`}
          body="Orang ini tidak lagi dapat mengambil nomor atau membuka kotak masuk penerbit tersebut. Nomor yang sudah diambilnya tetap tercatat."
          confirmLabel="Cabut petugas"
          danger
          busy={simpan.busy}
          error={simpan.error}
          onConfirm={(alasan) => simpan.jalankan(
            () => sekretariatAdminFetch(`/petugas/${cabut.id}/cabut`, { method: "POST", body: { alasan } }),
            () => setCabut(null),
          )}
          onClose={() => { if (!simpan.busy) setCabut(null); }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Pemberi disposisi */

interface PemegangForm { orang: Orang | null; alasan: string }

function DisposisiPage() {
  const { state, reload } = useLoad(() => sekretariatAdminFetch<{ items: PemegangDisposisi[] }>("/disposisi-pemegang"), "pengaturan-disposisi");
  const [form, setForm] = useState<PemegangForm | null>(null);
  const [cabut, setCabut] = useState<PemegangDisposisi | null>(null);
  const simpan = useSimpan(reload);
  if (state.status !== "ready") return <BelumSiap state={state} memuat="Memuat pemberi disposisi" gagal="Daftar pemberi disposisi belum dapat dimuat" />;
  const pemegang = [...state.data.items].sort((a, b) => (a.nama ?? "").localeCompare(b.nama ?? ""));
  const buka = () => { simpan.setError(null); setForm({ orang: null, alasan: "" }); };
  const tombol = <TombolTambah label="Tambah pemberi disposisi" onClick={buka} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Pemberi disposisi" eyebrow={EYEBROW} actions={tombol}>
        <p className="mt-1 text-sm text-muted-foreground">Membaca kotak masuk yayasan dan mendisposisikan isinya. Bawaannya Direktur; setiap delegasi dicatat dengan alasan.</p>
      </PageHeader>
      {pemegang.length === 0 ? (
        <StateCard kind="empty" title="Belum ada pemberi disposisi" body="Surat di kotak masuk yayasan menunggu sampai ada orang yang ditetapkan untuk mendisposisikannya." action={tombol} />
      ) : (
        <Panel className="!p-0">
          <ul className="divide-y divide-border">
            {pemegang.map((item) => (
              <li key={item.id} className={barisDaftar}>
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${item.nama ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{item.nama ?? TIDAK_DI_DIREKTORI}</p>
                  <p className="truncate text-sm text-muted-foreground">Sejak {formatTanggal(item.diberikanPada)} · {item.alasan}</p>
                </div>
                <button type="button" className={tombolCabut} onClick={() => { simpan.setError(null); setCabut(item); }}>Cabut</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {form ? (
        <FormDialog
          title="Tambah pemberi disposisi"
          description="Orang ini dapat membaca kotak masuk yayasan dan mendisposisikan suratnya."
          busy={simpan.busy}
          error={simpan.error}
          onClose={() => setForm(null)}
          onSimpan={() => {
            if (!form.orang) return;
            simpan.jalankan(
              () => sekretariatAdminFetch("/disposisi-pemegang", { method: "POST", body: { person_id: form.orang!.id, alasan: form.alasan.trim() } }),
              () => setForm(null),
            );
          }}
          kaki={<KakiForm busy={simpan.busy} siap={form.orang !== null && form.alasan.trim() !== ""} label="Simpan pemberi disposisi" labelBusy="Menyimpan…" />}
        >
          <PemilihOrang value={form.orang} onChange={(orang) => setForm({ ...form, orang })} />
          <Field label="Alasan" helper="Misalnya delegasi selama Direktur bertugas di luar">
            <input className="sq-admin-input" maxLength={500} value={form.alasan} onChange={(event) => setForm({ ...form, alasan: event.target.value })} />
          </Field>
        </FormDialog>
      ) : null}

      {cabut ? (
        <ReasonDialog
          title={`Cabut ${cabut.nama ?? "pemberi disposisi ini"}?`}
          body="Orang ini tidak lagi membaca kotak masuk yayasan. Disposisi yang sudah dibuatnya tetap tercatat."
          confirmLabel="Cabut pemberi disposisi"
          danger
          busy={simpan.busy}
          error={simpan.error}
          onConfirm={(alasan) => simpan.jalankan(
            () => sekretariatAdminFetch(`/disposisi-pemegang/${cabut.id}/cabut`, { method: "POST", body: { alasan } }),
            () => setCabut(null),
          )}
          onClose={() => { if (!simpan.busy) setCabut(null); }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Nomor awal */

interface NomorAwalForm { penerbitId: string; jenisKode: string; tahun: string; nilai: string; alasan: string }

function NomorAwalPage() {
  const { state, reload } = useLoad(
    async () => {
      const [penerbit, jenis] = await Promise.all([
        sekretariatAdminFetch<{ items: Penerbit[] }>("/penerbit"),
        sekretariatAdminFetch<{ items: Jenis[] }>("/jenis"),
      ]);
      return { penerbit: penerbit.items.filter((item) => item.aktif), jenis: jenis.items.filter((item) => item.aktif) };
    },
    "pengaturan-nomor-awal",
  );
  const [form, setForm] = useState<NomorAwalForm | null>(null);
  const [terakhir, setTerakhir] = useState<string | null>(null);
  const simpan = useSimpan(reload);
  if (state.status !== "ready") return <BelumSiap state={state} memuat="Memuat nomor awal" gagal="Pengaturan nomor awal belum dapat dimuat" />;
  const { penerbit, jenis } = state.data;
  const bisa = penerbit.length > 0 && jenis.length > 0;
  const buka = () => { simpan.setError(null); setForm({ penerbitId: "", jenisKode: "", tahun: String(new Date().getFullYear()), nilai: "", alasan: "" }); };

  return (
    <div className="space-y-4">
      <PageHeader title="Nomor awal" eyebrow={EYEBROW} actions={<button type="button" className={primaryButton} disabled={!bisa} onClick={buka}>Naikkan penghitung</button>}>
        <p className="mt-1 text-sm text-muted-foreground">Menaikkan penghitung agar nomor baru melanjutkan sisa buku nomor manual. Penghitung hanya bisa naik, tidak pernah turun.</p>
      </PageHeader>
      {!bisa ? (
        <StateCard kind="empty" title="Belum ada penerbit atau jenis surat aktif" body="Penghitung dapat dinaikkan setelah ada penerbit aktif dan jenis surat aktif." />
      ) : null}
      {terakhir ? <p role="status" className="text-sm text-muted-foreground">{terakhir}</p> : null}

      {form ? (
        <FormDialog
          title="Naikkan penghitung"
          description="Isi nomor terakhir yang sudah terpakai di buku manual. Nomor berikutnya yang terbit adalah angka itu ditambah satu."
          busy={simpan.busy}
          error={simpan.error}
          onClose={() => setForm(null)}
          onSimpan={() => {
            const kode = penerbit.find((item) => item.id === form.penerbitId)?.kode ?? "";
            simpan.jalankan(
              () => sekretariatAdminFetch("/nomor-awal", {
                method: "POST",
                body: { penerbit_id: form.penerbitId, jenis_kode: form.jenisKode, tahun: Number(form.tahun), nilai: Number(form.nilai), alasan: form.alasan.trim() },
              }),
              () => {
                setTerakhir(`Penghitung ${form.jenisKode} untuk ${kode} tahun ${form.tahun} sekarang ${form.nilai}.`);
                setForm(null);
              },
            );
          }}
          kaki={<KakiForm busy={simpan.busy} siap={form.penerbitId !== "" && form.jenisKode !== "" && form.tahun.length === 4 && form.nilai !== "" && Number(form.nilai) > 0 && form.alasan.trim() !== ""} label="Naikkan penghitung" labelBusy="Menyimpan…" />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Penerbit">
              <select className="sq-admin-input" value={form.penerbitId} onChange={(event) => setForm({ ...form, penerbitId: event.target.value })}>
                <option value="">Pilih penerbit</option>
                {penerbit.map((item) => <option key={item.id} value={item.id}>{item.kode} — {item.nama}</option>)}
              </select>
            </Field>
            <Field label="Jenis surat">
              <select className="sq-admin-input" value={form.jenisKode} onChange={(event) => setForm({ ...form, jenisKode: event.target.value })}>
                <option value="">Pilih jenis</option>
                {jenis.map((item) => <option key={item.kode} value={item.kode}>{item.kode} — {item.nama}</option>)}
              </select>
            </Field>
            <Field label="Tahun">
              <input className="sq-admin-input" inputMode="numeric" value={form.tahun} onChange={(event) => setForm({ ...form, tahun: event.target.value.replace(/\D/g, "").slice(0, 4) })} />
            </Field>
            <Field label="Nomor terakhir terpakai">
              <input className="sq-admin-input" inputMode="numeric" value={form.nilai} onChange={(event) => setForm({ ...form, nilai: event.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
          <Field label="Alasan" helper="Misalnya sisa buku nomor manual sampai bulan ini">
            <input className="sq-admin-input" maxLength={500} value={form.alasan} onChange={(event) => setForm({ ...form, alasan: event.target.value })} />
          </Field>
        </FormDialog>
      ) : null}
    </div>
  );
}
