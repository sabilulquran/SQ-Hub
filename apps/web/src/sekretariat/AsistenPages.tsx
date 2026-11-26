import { useEffect, useRef, useState } from "react";

import { DetailDialog } from "@/components/DetailDialog";
import { WizardDone, WizardSteps } from "@/components/WizardSteps";
import { useWizardStep } from "@/components/useWizardStep";
import {
  docxUrl, errorMessage, LABEL_BAGIAN, sekretariatFetch,
  type BagianSurat, type IsiSurat, type KotakRingkas, type NaskahSurat, type PertanyaanAsisten,
  type SuratMasukDetail, type SuratMasukRingkas,
} from "@/sekretariat/api";
import { navigate } from "@/sekretariat/routes";
import { ErrorNote, Field, Link, PageHeader, Panel, primaryButton, secondaryButton, StateCard, useLoad } from "@/sekretariat/ui";

/**
 * SEK-IMPL-004 §5.1: Asisten Surat as a one-step-per-screen flow (UX-FLOW-001). The steps live in
 * `?langkah=`, the body is saved on the server after each round, and the letter number is never
 * touched here — it is still allocated only when the letter is published.
 */
const LANGKAH = ["konteks", "lengkapi", "periksa", "selesai"] as const;
const LABEL_LANGKAH = ["Konteks", "Lengkapi", "Periksa", "Selesai"];
type Langkah = (typeof LANGKAH)[number];

interface Kutipan {
  surat_masuk_id: string;
  awal: number;
  panjang: number;
  teks: string;
}

export function AsistenPage({ suratId, kotak }: { suratId: string; kotak: KotakRingkas[] | null }) {
  const atas = useRef<HTMLDivElement>(null);
  const { step, index, goTo } = useWizardStep<Langkah>(LANGKAH, atas);
  const { state, reload } = useLoad(() => sekretariatFetch<IsiSurat>(`/surat/${suratId}/isi`), suratId);

  const [penjelasan, setPenjelasan] = useState("");
  const [kutipan, setKutipan] = useState<Kutipan[]>([]);
  const [pertanyaan, setPertanyaan] = useState<PertanyaanAsisten[]>([]);
  const [jawaban, setJawaban] = useState<Record<string, string>>({});
  const [bagian, setBagian] = useState<BagianSurat>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pemilih, setPemilih] = useState(false);
  const terisi = useRef(false);

  // What the server already holds seeds the form once, so coming back keeps the work.
  useEffect(() => {
    if (state.status !== "ready" || terisi.current) return;
    terisi.current = true;
    setPenjelasan(state.data.konteks.penjelasan);
    setBagian(state.data.bagian);
    setJawaban(Object.fromEntries(state.data.konteks.jawaban.map((item) => [item.kunci, item.nilai])));
  }, [state]);

  // UX-FLOW-001 rule 7: a later step opened without its data goes back to the first step.
  useEffect(() => {
    if (state.status !== "ready") return;
    if (step === "lengkapi" && pertanyaan.length === 0) goTo("konteks", { replace: true });
    if ((step === "periksa" || step === "selesai") && !state.data.ada) goTo("konteks", { replace: true });
  }, [step, state, pertanyaan.length, goTo]);

  if (state.status === "loading") return <StateCard kind="loading" title="Memuat draf" />;
  if (state.status === "error") {
    return state.code === "tidak_ditemukan"
      ? <StateCard kind="forbidden" title="Draf ini bukan milik Anda" body="Asisten Surat hanya terbuka bagi petugas penerbitnya." action={<Link className={secondaryButton} href="/surat-keluar">Ke Surat keluar</Link>} />
      : <StateCard kind="error" title="Asisten Surat belum dapat dibuka" body={state.message} />;
  }
  const isi = state.data;
  if (!isi.didukung) {
    return (
      <StateCard
        kind="empty"
        title="Jenis naskah ini belum punya kerangka"
        body="Asisten Surat baru menyiapkan jenis 07 Peringatan. Tulis surat ini seperti biasa, lalu unggah PDF finalnya."
        action={<Link className={secondaryButton} href={`/surat/${suratId}`}>Kembali ke draf</Link>}
      />
    );
  }

  const jalankan = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const tanya = () =>
    jalankan(async () => {
      const hasil = await sekretariatFetch<{ pertanyaan: PertanyaanAsisten[] }>(`/surat/${suratId}/asisten/tanya`, {
        method: "POST",
        body: { penjelasan, kutipan: kutipan.map(({ surat_masuk_id, awal, panjang }) => ({ surat_masuk_id, awal, panjang })) },
      });
      setPertanyaan(hasil.pertanyaan);
      await reload();
      // Nothing left to ask: the flow goes straight to the preview (§6.2).
      goTo(hasil.pertanyaan.length === 0 ? "periksa" : "lengkapi");
      if (hasil.pertanyaan.length === 0) await susun();
    });

  const susun = () =>
    jalankan(async () => {
      const hasil = await sekretariatFetch<{ bagian: BagianSurat }>(`/surat/${suratId}/asisten/susun`, {
        method: "POST",
        body: {
          penjelasan,
          jawaban: Object.entries(jawaban).map(([kunci, nilai]) => ({ kunci, nilai })).filter((item) => item.nilai.trim().length > 0),
          kutipan: kutipan.map(({ surat_masuk_id, awal, panjang }) => ({ surat_masuk_id, awal, panjang })),
        },
      });
      setBagian(hasil.bagian);
      await reload();
      goTo("periksa");
    });

  const simpan = () =>
    jalankan(async () => {
      await sekretariatFetch(`/surat/${suratId}/isi`, { method: "PUT", body: { bagian } });
      await reload();
      goTo("selesai", { replace: true });
    });

  return (
    <div className="space-y-4" ref={atas}>
      <PageHeader
        eyebrow={<Link href={`/surat/${suratId}`} className="hover:underline">Draf surat</Link>}
        title="Buat dengan AI"
      >
        <p className="mt-1 text-sm text-muted-foreground">
          Jenis {isi.jenisKode} — {isi.jenisNama}. Nomor surat tetap diambil saat terbit, bukan di sini.
        </p>
      </PageHeader>
      <WizardSteps steps={LABEL_LANGKAH} current={index} />
      <ErrorNote message={error} />
      {isi.jenisBerubah ? (
        <StateCard kind="empty" title="Jenis draf sudah berubah" body="Isi ini disusun untuk jenis naskah yang lain. Periksa unsur wajibnya sebelum dipakai." />
      ) : null}

      {step === "konteks" ? (
        <LangkahKonteks
          penjelasan={penjelasan}
          onPenjelasan={setPenjelasan}
          kutipan={kutipan}
          onBuangKutipan={(at) => setKutipan(kutipan.filter((_, index2) => index2 !== at))}
          onPilihKutipan={() => setPemilih(true)}
          busy={busy}
          sisaPutaran={isi.sisaPutaran}
          onLanjut={() => void tanya()}
          onLewati={() => goTo("periksa")}
          adaIsi={isi.ada}
        />
      ) : null}

      {step === "lengkapi" ? (
        <LangkahLengkapi
          pertanyaan={pertanyaan}
          jawaban={jawaban}
          onJawaban={(kunci, nilai) => setJawaban({ ...jawaban, [kunci]: nilai })}
          busy={busy}
          onKembali={() => goTo("konteks")}
          onSusun={() => void susun()}
        />
      ) : null}

      {step === "periksa" ? (
        <LangkahPeriksa
          naskah={isi.naskah}
          bagian={bagian}
          kosong={isi.kosong}
          onBagian={(kunci, nilai) => setBagian({ ...bagian, [kunci]: nilai })}
          busy={busy}
          onKembali={() => goTo("konteks")}
          onSimpan={() => void simpan()}
        />
      ) : null}

      {step === "selesai" ? (
        <WizardDone
          title="Draf tersimpan"
          message="Unduh .docx-nya, beri kop dan tanda tangan di Word, lalu kembali ke draf untuk mengunggah PDF final dan menerbitkannya."
        >
          <a className={primaryButton} href={docxUrl(suratId)}>Unduh .docx</a>
          <Link className={secondaryButton} href={`/surat/${suratId}`}>Kembali ke draf</Link>
        </WizardDone>
      ) : null}

      {pemilih ? (
        <PemilihKutipan
          kotak={kotak}
          onClose={() => setPemilih(false)}
          onPilih={(pilihan) => {
            setKutipan([...kutipan, pilihan].slice(0, 3));
            setPemilih(false);
          }}
        />
      ) : null}
    </div>
  );
}

function LangkahKonteks({
  penjelasan, onPenjelasan, kutipan, onBuangKutipan, onPilihKutipan, busy, sisaPutaran, onLanjut, onLewati, adaIsi,
}: {
  penjelasan: string;
  onPenjelasan: (value: string) => void;
  kutipan: Kutipan[];
  onBuangKutipan: (index: number) => void;
  onPilihKutipan: () => void;
  busy: boolean;
  sisaPutaran: number;
  onLanjut: () => void;
  onLewati: () => void;
  adaIsi: boolean;
}) {
  const cukup = penjelasan.trim().length >= 10;
  return (
    <Panel>
      <h2 className="font-display text-base font-bold text-brand-heading">Jelaskan duduk perkaranya</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Tulis apa yang terjadi dengan kalimat Anda sendiri. Asisten akan menanyakan data yang masih kurang menurut unsur wajib jenis naskah ini.
      </p>
      <div className="mt-3">
        <Field label="Penjelasan" helper="Paling sedikit 10 karakter. Jangan tulis nomor surat; nomor diambil saat terbit.">
          <textarea
            className="sq-admin-input min-h-40"
            value={penjelasan}
            maxLength={4000}
            onChange={(event) => onPenjelasan(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-brand-heading">Kutipan dari surat masuk</h3>
          <button type="button" className={secondaryButton} disabled={busy || kutipan.length >= 3} onClick={onPilihKutipan}>
            Ambil kutipan
          </button>
        </div>
        {kutipan.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Belum ada. Paling banyak tiga kutipan, masing-masing 2.000 karakter.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {kutipan.map((item, index) => (
              <li key={`${item.surat_masuk_id}-${item.awal}`} className="rounded-xl border border-border/70 p-3">
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{item.teks}</p>
                <button type="button" className="mt-2 text-xs font-semibold text-danger-ink hover:underline" onClick={() => onBuangKutipan(index)}>
                  Buang kutipan ini
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {sisaPutaran <= 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Batas bantuan AI untuk draf ini sudah habis. Anda masih dapat menyunting isinya langsung.
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" className={primaryButton} disabled={busy || !cukup || sisaPutaran <= 0} onClick={onLanjut}>
          {busy ? "Menanyakan…" : "Lanjutkan"}
        </button>
        {adaIsi ? (
          <button type="button" className={secondaryButton} disabled={busy} onClick={onLewati}>Langsung ke pratinjau</button>
        ) : null}
      </div>
    </Panel>
  );
}

function LangkahLengkapi({
  pertanyaan, jawaban, onJawaban, busy, onKembali, onSusun,
}: {
  pertanyaan: PertanyaanAsisten[];
  jawaban: Record<string, string>;
  onJawaban: (kunci: string, nilai: string) => void;
  busy: boolean;
  onKembali: () => void;
  onSusun: () => void;
}) {
  return (
    <Panel>
      <h2 className="font-display text-base font-bold text-brand-heading">Lengkapi data yang kurang</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Jawab seperlunya. Yang Anda kosongkan akan tampil sebagai bagian kosong di pratinjau, bukan dikarang.
      </p>
      <div className="mt-3 space-y-3">
        {pertanyaan.map((item) => (
          <Field key={item.kunci} label={LABEL_BAGIAN[item.kunci] ?? item.kunci} helper={item.pertanyaan}>
            <textarea
              className="sq-admin-input min-h-24"
              value={jawaban[item.kunci] ?? ""}
              maxLength={2000}
              onChange={(event) => onJawaban(item.kunci, event.target.value)}
            />
          </Field>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" className={primaryButton} disabled={busy} onClick={onSusun}>
          {busy ? "Menyusun…" : "Susun draf"}
        </button>
        <button type="button" className={secondaryButton} disabled={busy} onClick={onKembali}>Ubah penjelasan</button>
      </div>
    </Panel>
  );
}

function LangkahPeriksa({
  naskah, bagian, kosong, onBagian, busy, onKembali, onSimpan,
}: {
  naskah: NaskahSurat | null;
  bagian: BagianSurat;
  kosong: string[];
  onBagian: (kunci: keyof BagianSurat, nilai: string) => void;
  busy: boolean;
  onKembali: () => void;
  onSimpan: () => void;
}) {
  const kunci: Array<keyof BagianSurat> = ["dasar", "fakta", "tindakan_korektif", "tenggat", "tanggapan", "tembusan"];
  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="font-display text-base font-bold text-brand-heading">Isi surat</h2>
        <p className="mt-1 text-sm text-muted-foreground">Dibuat AI — periksa sebelum dipakai. Anda dapat menyunting setiap bagian.</p>
        {kosong.length > 0 ? (
          <p className="mt-2 text-sm text-warning-ink">
            Bagian wajib yang masih kosong: {kosong.map((item) => LABEL_BAGIAN[item] ?? item).join(", ")}.
          </p>
        ) : null}
        <div className="mt-3 space-y-3">
          {kunci.map((item) => (
            <Field key={item} label={LABEL_BAGIAN[item] ?? item}>
              <textarea
                className="sq-admin-input min-h-24"
                value={bagian[item] ?? ""}
                maxLength={4000}
                onChange={(event) => onBagian(item, event.target.value)}
              />
            </Field>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" className={primaryButton} disabled={busy} onClick={onSimpan}>
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
          <button type="button" className={secondaryButton} disabled={busy} onClick={onKembali}>Ubah penjelasan</button>
        </div>
      </Panel>
      {naskah ? <PratinjauNaskah naskah={naskah} bagian={bagian} /> : null}
    </div>
  );
}

/** The B-1 skeleton as the .docx will carry it; the body paragraphs follow what is being edited. */
function PratinjauNaskah({ naskah, bagian }: { naskah: NaskahSurat; bagian: BagianSurat }) {
  const isi = (["dasar", "fakta", "tindakan_korektif", "tenggat", "tanggapan"] as const)
    .map((kunci) => (bagian[kunci] ?? "").trim())
    .filter((teks) => teks.length > 0);
  return (
    <Panel>
      <h2 className="font-display text-base font-bold text-brand-heading">Pratinjau</h2>
      <div className="mt-3 rounded-xl border border-border/70 bg-surface-raised p-4 text-sm leading-7 text-foreground sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <div>
            {naskah.meta.map((baris) => (
              <p key={baris.label}>{baris.label} : {baris.nilai}</p>
            ))}
          </div>
          <div className="sm:text-right">
            {naskah.kanan.map((baris) => <p key={baris}>{baris}</p>)}
          </div>
        </div>
        <p className="mt-4">Yth. {naskah.yth}</p>
        <p>di {naskah.di}</p>
        <p className="mt-4 text-center" dir="rtl" lang="ar">{naskah.basmalah}</p>
        <p className="mt-4">{naskah.salam}</p>
        {isi.map((alinea, index) => <p key={index} className="mt-3 indent-8 text-justify">{alinea}</p>)}
        <p className="mt-3 indent-8 text-justify">{naskah.isi[naskah.isi.length - 1]}</p>
        <p className="mt-4 text-center" dir="rtl" lang="ar">{naskah.penutup}</p>
        <div className="mt-6">
          {naskah.tandaTangan.map((baris, index) => <p key={index}>{baris || " "}</p>)}
        </div>
        {bagian.tembusan?.trim() ? (
          <div className="mt-4">
            <p>Tembusan:</p>
            <p>{bagian.tembusan}</p>
          </div>
        ) : null}
        <p className="mt-6 text-center text-xs text-muted-foreground">{naskah.catatanKaki}</p>
      </div>
    </Panel>
  );
}

/**
 * §5.2: the staff member selects text in the letter, and only the offsets travel. The body is
 * shown in a read-only textarea so `selectionStart`/`selectionEnd` are offsets into exactly the
 * string the server holds.
 */
function PemilihKutipan({
  kotak, onClose, onPilih,
}: {
  kotak: KotakRingkas[] | null;
  onClose: () => void;
  onPilih: (kutipan: Kutipan) => void;
}) {
  const [kotakId, setKotakId] = useState(kotak?.[0]?.id ?? "");
  const [suratId, setSuratId] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [galat, setGalat] = useState<string | null>(null);

  const daftar = useLoad(
    () => (kotakId ? sekretariatFetch<{ items: SuratMasukRingkas[] }>(`/kotak/${kotakId}/surat`) : Promise.resolve({ items: [] })),
    kotakId,
  );
  const detail = useLoad(
    () => (suratId ? sekretariatFetch<SuratMasukDetail>(`/surat-masuk/${suratId}`) : Promise.resolve(null)),
    suratId ?? "",
  );

  return (
    <DetailDialog title="Ambil kutipan dari surat masuk" description="Sorot bagian yang ingin dipakai, lalu tekan Pakai sebagai konteks." onClose={onClose} wide>
      <div className="space-y-3">
        <Field label="Kotak masuk">
          <select className="sq-admin-input" value={kotakId} onChange={(event) => { setKotakId(event.target.value); setSuratId(null); }}>
            {(kotak ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.jenis === "yayasan" ? "Kotak yayasan" : item.penerbit?.kode ?? "Kotak penerbit"}
              </option>
            ))}
          </select>
        </Field>
        {daftar.state.status === "ready" && daftar.state.data.items.length > 0 ? (
          <Field label="Surat">
            <select className="sq-admin-input" value={suratId ?? ""} onChange={(event) => setSuratId(event.target.value || null)}>
              <option value="">— pilih surat —</option>
              {daftar.state.data.items.map((item) => (
                <option key={item.id} value={item.id}>{item.dari} — {item.perihal}</option>
              ))}
            </select>
          </Field>
        ) : daftar.state.status === "ready" ? (
          <p className="text-sm text-muted-foreground">Kotak ini belum punya surat masuk.</p>
        ) : null}
        {detail.state.status === "ready" && detail.state.data ? (
          <>
            <Field label="Isi surat" helper="Hanya bagian yang Anda sorot yang dipakai; maksimal 2.000 karakter.">
              <textarea ref={area} className="sq-admin-input min-h-60 font-mono text-xs" readOnly value={detail.state.data.isiTeks} />
            </Field>
            <ErrorNote message={galat} />
            <button
              type="button"
              className={primaryButton}
              onClick={() => {
                const node = area.current;
                if (!node) return;
                const awal = node.selectionStart;
                const panjang = node.selectionEnd - node.selectionStart;
                if (panjang <= 0) {
                  setGalat("Sorot dulu bagian yang ingin dipakai.");
                  return;
                }
                if (panjang > 2000) {
                  setGalat("Kutipan terlalu panjang; sorot paling banyak 2.000 karakter.");
                  return;
                }
                onPilih({ surat_masuk_id: detail.state.status === "ready" && detail.state.data ? detail.state.data.id : "", awal, panjang, teks: node.value.slice(awal, awal + panjang) });
              }}
            >
              Pakai sebagai konteks
            </button>
          </>
        ) : null}
      </div>
    </DetailDialog>
  );
}

/** The entry point on the draft page; the button only appears for types the assistant supports. */
export function TombolAsisten({ suratId, jenisKode, tersedia, jenis, adaIsi }: {
  suratId: string;
  jenisKode: string;
  tersedia: boolean;
  jenis: string[];
  adaIsi: boolean;
}) {
  if (!tersedia || !jenis.includes(jenisKode)) return null;
  return (
    <button type="button" className={secondaryButton} onClick={() => navigate(`/surat/${suratId}/asisten`)}>
      {adaIsi ? "Lanjutkan draf AI" : "Buat dengan AI"}
    </button>
  );
}
