/**
 * SEK-IMPL-004 §6.4 and §7.1: the catalogue of what a letter type must contain, and the B-1
 * skeleton it is poured into. This file is **data and rules**, never model output: the form,
 * the mandatory elements and the authority sentence come from the Pedoman Tata Naskah Dinas,
 * so a wrong answer from the model cannot change them.
 */

/** One element the type demands (pedoman BAB VI, matriks variasi templat korespondensi). */
export interface UnsurNaskah {
  kunci: string;
  label: string;
  wajib: boolean;
  /** Shown to the staff member, and given to the model so its question is about the right thing. */
  petunjuk: string;
}

export interface JenisDidukung {
  kode: string;
  nama: string;
  /** Pedoman Pasal 9 ayat (1). */
  bentuk: "B-1";
  unsur: UnsurNaskah[];
  /** Pedoman Pasal 21; the server supplies this sentence, the model never writes it. */
  kewenangan: string;
}

/**
 * R1 supports one type (owner, 2026-11-25). Adding another is one entry here plus its prompt
 * wording — no schema change (§6.4).
 */
export const JENIS_ASISTEN: Record<string, JenisDidukung> = {
  "07": {
    kode: "07",
    nama: "Peringatan",
    bentuk: "B-1",
    unsur: [
      { kunci: "dasar", label: "Dasar", wajib: true, petunjuk: "Perjanjian, aturan, atau surat sebelumnya yang menjadi dasar peringatan ini." },
      { kunci: "fakta", label: "Pelanggaran atau fakta", wajib: true, petunjuk: "Apa yang terjadi, kapan, dan berapa kali — sebagaimana diketahui penyusun." },
      { kunci: "tindakan_korektif", label: "Tindakan korektif", wajib: true, petunjuk: "Apa yang diminta dilakukan penerima untuk memperbaiki keadaan." },
      { kunci: "tenggat", label: "Tenggat", wajib: true, petunjuk: "Batas waktu tindakan korektif itu." },
      { kunci: "tanggapan", label: "Kesempatan menanggapi", wajib: true, petunjuk: "Bagaimana dan sampai kapan penerima dapat menyampaikan tanggapan." },
      { kunci: "tembusan", label: "Tembusan", wajib: false, petunjuk: "Pihak yang perlu mengetahui, bila ada." },
    ],
    kewenangan:
      "Surat ini diterbitkan dalam batas kewenangan penerbitnya dan tidak mengubah status atau hak pihak mana pun; "
      + "perubahan status atau hak memerlukan instrumen yang berwenang.",
  },
};

export function jenisDidukung(kode: string): JenisDidukung | null {
  return JENIS_ASISTEN[kode] ?? null;
}

export const KUNCI_BAGIAN = ["dasar", "fakta", "tindakan_korektif", "tenggat", "tanggapan", "tembusan"] as const;
export type KunciBagian = (typeof KUNCI_BAGIAN)[number];
export type Bagian = Partial<Record<KunciBagian, string>>;

/** Fixed text of the B-1 skeleton; copied as it stands, never written by the model. */
export const BASMALAH =
  "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ الْحَمْدُ لِلَّهِ، وَالصَّلَاةُ وَالسَّلَامُ عَلَى رَسُولِ اللَّهِ، وَعَلَى آلِهِ وَصَحْبِهِ";
export const SHALAWAT_PENUTUP = "وَصَلَّى اللهُ عَلَى نَبِيِّنَا مُحَمَّدٍ";
export const NOMOR_PLACEHOLDER = "[nomor diisi saat terbit]";
export const CATATAN_DRAF =
  "DRAF — disusun dengan bantuan AI, diperiksa dan menjadi tanggung jawab penyusunnya. "
  + "Mengikuti Pedoman Tata Naskah Dinas YSQ yang belum disahkan.";

/**
 * A letter number may only ever come from the book (§6.5 nomor 3). Anything that looks like one
 * in model output is refused rather than quietly carried into a draft: the pedoman pattern
 * `[kode].[urut]/[penerbit]/[bulan]/[tahun]`, and a line that opens with "Nomor:".
 */
const POLA_NOMOR = /\d{2}\.\d{3,}\s*\//;
const POLA_BARIS_NOMOR = /^[ \t]*nomor[ \t]*:/im;

export function memuatNomor(teks: string): boolean {
  return POLA_NOMOR.test(teks) || POLA_BARIS_NOMOR.test(teks);
}

export interface BarisMeta {
  label: string;
  nilai: string;
}

/** What both the preview and the .docx are built from; no formatting decisions live above this. */
export interface Naskah {
  meta: BarisMeta[];
  kanan: string[];
  yth: string;
  di: string;
  basmalah: string;
  salam: string;
  isi: string[];
  penutup: string;
  tandaTangan: string[];
  tembusan: string | null;
  catatanKaki: string;
}

export interface SumberNaskah {
  jenis: JenisDidukung;
  perihal: string;
  tujuan: string;
  penandatangan: string;
  /** Issuer name as it appears on the letterhead block, from sekretariat_penerbit. */
  penerbitNama: string;
  /** Allocation date is not known yet; the letter date is the day the draft is rendered. */
  tanggal: string;
  bagian: Bagian;
}

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** `2026-11-26` → `26 November 2026`. The caller already resolved the date in Asia/Jakarta. */
export function tanggalPanjang(iso: string): string {
  const [tahun, bulan, hari] = iso.split("-");
  const nama = BULAN_ID[Number(bulan) - 1];
  if (!tahun || !hari || !nama) return iso;
  return `${Number(hari)} ${nama} ${tahun}`;
}

function paragrafIsi(sumber: SumberNaskah): string[] {
  const urut: KunciBagian[] = ["dasar", "fakta", "tindakan_korektif", "tenggat", "tanggapan"];
  const isi = urut
    .map((kunci) => (sumber.bagian[kunci] ?? "").trim())
    .filter((teks) => teks.length > 0);
  // The authority sentence closes the body; it comes from the catalogue, not from the model.
  isi.push(sumber.jenis.kewenangan);
  return isi;
}

/**
 * Assembles the B-1 *New Official Style* skeleton (pedoman BAB VI, Contoh B-1). The number is a
 * placeholder on purpose: it is allocated only when the letter is published.
 */
export function rakitNaskah(sumber: SumberNaskah): Naskah {
  return {
    meta: [
      { label: "Nomor", nilai: NOMOR_PLACEHOLDER },
      { label: "Lampiran", nilai: "[jumlah atau nihil]" },
      { label: "Perihal", nilai: sumber.perihal },
    ],
    // Hijri date has no source in the system yet (audit §3.4), so it stays a placeholder.
    kanan: [`[Kota], ${tanggalPanjang(sumber.tanggal)}`, "[tanggal Hijriah]"],
    yth: sumber.tujuan,
    di: "[Tempat]",
    basmalah: BASMALAH,
    salam: "Dengan hormat,",
    isi: paragrafIsi(sumber),
    penutup: SHALAWAT_PENUTUP,
    tandaTangan: [sumber.penerbitNama, sumber.penandatangan, "", "[NAMA LENGKAP DAN GELAR]"],
    tembusan: (sumber.bagian.tembusan ?? "").trim() || null,
    catatanKaki: CATATAN_DRAF,
  };
}

/** Which mandatory elements are still empty; the preview shows them rather than hiding them. */
export function bagianKosong(jenis: JenisDidukung, bagian: Bagian): string[] {
  return jenis.unsur
    .filter((unsur) => unsur.wajib && (bagian[unsur.kunci as KunciBagian] ?? "").trim().length === 0)
    .map((unsur) => unsur.kunci);
}
