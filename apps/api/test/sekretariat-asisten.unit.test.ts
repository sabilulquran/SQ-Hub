import { Buffer } from "node:buffer";
import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { escapeXml, namaBerkasDocx, renderDocx, zipStore } from "../src/modules/sekretariat/docx.js";
import {
  bagianKosong, jenisDidukung, memuatNomor, NOMOR_PLACEHOLDER, rakitNaskah, tanggalPanjang,
} from "../src/modules/sekretariat/naskah.js";
import { bersihkanBagian, bersihkanPertanyaan, LogPenyusun, type MasukanAsisten } from "../src/modules/sekretariat/penyusun.js";

const JENIS = jenisDidukung("07")!;

function masukan(over: Partial<MasukanAsisten> = {}): MasukanAsisten {
  return {
    jenis: JENIS,
    penerbitKode: "GA.YSQ",
    penerbitNama: "Divisi General Affairs",
    perihal: "Peringatan keterlambatan katering",
    tujuan: "PT Boga Uji",
    penandatangan: "Direktur",
    penjelasan: "Vendor terlambat tiga kali bulan ini.",
    jawaban: [],
    kutipan: [],
    ...over,
  };
}

/** A ZIP of stored entries can be walked by its local headers; no unzip library needed. */
function bacaZip(buffer: Buffer): Array<{ nama: string; isi: Buffer; crcCocok: boolean }> {
  const entri: Array<{ nama: string; isi: Buffer; crcCocok: boolean }> = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const crc = buffer.readUInt32LE(offset + 14);
    const ukuran = buffer.readUInt32LE(offset + 18);
    const panjangNama = buffer.readUInt16LE(offset + 26);
    const panjangExtra = buffer.readUInt16LE(offset + 28);
    const nama = buffer.subarray(offset + 30, offset + 30 + panjangNama).toString("utf8");
    const mulai = offset + 30 + panjangNama + panjangExtra;
    const isi = buffer.subarray(mulai, mulai + ukuran);
    entri.push({ nama, isi, crcCocok: crc32(isi) === crc });
    offset = mulai + ukuran;
  }
  return entri;
}

describe("SEK-IMPL-004 kerangka naskah (§7.1)", () => {
  it("menaruh placeholder nomor, bukan nomor surat", () => {
    const naskah = rakitNaskah({
      jenis: JENIS, perihal: "Peringatan", tujuan: "PT Boga Uji", penandatangan: "Direktur",
      penerbitNama: "Divisi General Affairs", tanggal: "2026-11-26", bagian: { fakta: "Terlambat tiga kali." },
    });
    expect(naskah.meta[0]).toEqual({ label: "Nomor", nilai: NOMOR_PLACEHOLDER });
    expect(naskah.kanan[0]).toBe("[Kota], 26 November 2026");
    // The authority sentence always closes the body and comes from the catalogue, not the model.
    expect(naskah.isi[naskah.isi.length - 1]).toBe(JENIS.kewenangan);
  });

  it("menyebut bagian wajib yang masih kosong", () => {
    expect(bagianKosong(JENIS, { fakta: "ada" })).toEqual(["dasar", "tindakan_korektif", "tenggat", "tanggapan"]);
    expect(bagianKosong(JENIS, { dasar: "a", fakta: "b", tindakan_korektif: "c", tenggat: "d", tanggapan: "e" })).toEqual([]);
  });

  it("menulis tanggal panjang Indonesia", () => {
    expect(tanggalPanjang("2026-01-01")).toBe("1 Januari 2026");
    expect(tanggalPanjang("2026-12-31")).toBe("31 Desember 2026");
  });

  it("mengenali pola nomor naskah dan baris Nomor:", () => {
    expect(memuatNomor("Menunjuk surat 07.003/GA.YSQ/XI/2026 tertanggal kemarin")).toBe(true);
    expect(memuatNomor("Nomor: 12/ABC")).toBe(true);
    expect(memuatNomor("Keterlambatan terjadi tiga kali pada 3, 10, dan 17 November.")).toBe(false);
  });
});

describe("SEK-IMPL-004 saringan keluaran model (§6.5)", () => {
  it("menolak bagian yang memuat nomor surat dan membuang kunci asing", () => {
    const { bagian, ditolak } = bersihkanBagian(JENIS, {
      dasar: "Perjanjian kerja sama katering.",
      fakta: "Menunjuk 07.003/GA.YSQ/XI/2026, vendor terlambat.",
      entah_apa: "tidak dikenal",
      tenggat: "   ",
    });
    expect(bagian.dasar).toBe("Perjanjian kerja sama katering.");
    expect(bagian.fakta).toBeUndefined();
    expect(ditolak).toEqual(["fakta"]);
    expect(Object.keys(bagian)).toEqual(["dasar"]);
  });

  it("membuang pertanyaan berkunci asing, ganda, dan lebih dari enam", () => {
    const pertanyaan = bersihkanPertanyaan(JENIS, [
      { kunci: "dasar", pertanyaan: "Apa dasarnya?", mengapa: "wajib" },
      { kunci: "dasar", pertanyaan: "Dasarnya apa lagi?", mengapa: "" },
      { kunci: "tidak_ada", pertanyaan: "Abaikan", mengapa: "" },
      { kunci: "fakta", pertanyaan: "", mengapa: "" },
      { kunci: "tenggat", pertanyaan: "Kapan tenggatnya?", mengapa: "" },
    ]);
    expect(pertanyaan.map((item) => item.kunci)).toEqual(["dasar", "tenggat"]);
  });

  it("mode log menanyakan tepat unsur wajib yang belum dijawab, tanpa jaringan", async () => {
    const penyusun = new LogPenyusun();
    const semua = await penyusun.tanya(masukan());
    expect(semua.pertanyaan.map((item) => item.kunci)).toEqual(["dasar", "fakta", "tindakan_korektif", "tenggat", "tanggapan"]);
    const sebagian = await penyusun.tanya(masukan({ jawaban: [{ kunci: "dasar", nilai: "Perjanjian katering" }] }));
    expect(sebagian.pertanyaan.map((item) => item.kunci)).not.toContain("dasar");
    expect(semua.tokenMasuk).toBe(0);
  });

  it("mode log menyusun bagian dari jawaban staf apa adanya", async () => {
    const hasil = await new LogPenyusun().susun(masukan({
      jawaban: [{ kunci: "fakta", nilai: "Terlambat tiga kali." }, { kunci: "bukan_unsur", nilai: "abaikan" }],
    }));
    expect(hasil.bagian).toEqual({ fakta: "Terlambat tiga kali." });
  });
});

describe("SEK-IMPL-004 penulis .docx (§7.3)", () => {
  it("meloloskan karakter XML dan membuang karakter kontrol", () => {
    expect(escapeXml('PT "A" & <B>')).toBe("PT &quot;A&quot; &amp; &lt;B&gt;");
    expect(escapeXml("a\u0007b")).toBe("ab");
    expect(escapeXml("baris\tkolom")).toBe("baris\tkolom");
  });

  it("mempertahankan pergantian baris sebagai <w:br/>, bukan merekatkan kata", () => {
    const naskah = rakitNaskah({
      jenis: JENIS, perihal: "P", tujuan: "T", penandatangan: "Direktur",
      penerbitNama: "Divisi General Affairs", tanggal: "2026-11-26",
      bagian: { fakta: "Baris satu\nBaris dua\r\nBaris tiga" },
    });
    const dokumen = bacaZip(renderDocx(naskah))[2]!.isi.toString("utf8");
    expect(dokumen).not.toContain("Baris satuBaris dua");
    expect(dokumen).toContain('<w:t xml:space="preserve">Baris satu</w:t><w:br/><w:t xml:space="preserve">Baris dua</w:t>');
    expect(dokumen).toContain("Baris tiga");
  });

  it("menulis ZIP yang dapat dibaca ulang dengan CRC yang benar", () => {
    const zip = zipStore([
      { nama: "satu.txt", data: Buffer.from("isi pertama", "utf8") },
      { nama: "dua/tiga.txt", data: Buffer.from("isi kedua", "utf8") },
    ]);
    const entri = bacaZip(zip);
    expect(entri.map((item) => item.nama)).toEqual(["satu.txt", "dua/tiga.txt"]);
    expect(entri.every((item) => item.crcCocok)).toBe(true);
    expect(entri[1]!.isi.toString("utf8")).toBe("isi kedua");
  });

  it("merender .docx lengkap yang memuat perihal dan penanda draf, tanpa nomor surat", () => {
    const naskah = rakitNaskah({
      jenis: JENIS, perihal: "Peringatan keterlambatan", tujuan: "PT Boga & Co", penandatangan: "Direktur",
      penerbitNama: "Divisi General Affairs", tanggal: "2026-11-26",
      bagian: { dasar: "Perjanjian kerja sama.", fakta: "Terlambat tiga kali.", tembusan: "Kepala HCM" },
    });
    const entri = bacaZip(renderDocx(naskah));
    expect(entri.map((item) => item.nama)).toEqual([
      "[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/footer1.xml",
    ]);
    expect(entri.every((item) => item.crcCocok)).toBe(true);
    const dokumen = entri[2]!.isi.toString("utf8");
    expect(dokumen).toContain("Peringatan keterlambatan");
    expect(dokumen).toContain("PT Boga &amp; Co");
    expect(dokumen).toContain(NOMOR_PLACEHOLDER);
    expect(dokumen).toContain("Tembusan:");
    // Pedoman Pasal 10: A4, 2 cm margins, Arial 11 pt, first-line indent 1.25 cm.
    expect(dokumen).toContain('w:w="11906"');
    expect(dokumen).toContain('w:top="1134"');
    expect(dokumen).toContain('w:ascii="Arial"');
    expect(dokumen).toContain('w:firstLine="709"');
    expect(memuatNomor(dokumen.replace(NOMOR_PLACEHOLDER, ""))).toBe(false);
    expect(entri[4]!.isi.toString("utf8")).toContain("DRAF");
  });

  it("menamai berkas menurut jenis, penerbit, dan tanggal", () => {
    expect(namaBerkasDocx("07", "GA.YSQ", "2026-11-26")).toBe("draf-07-GA.YSQ-2026-11-26.docx");
    expect(namaBerkasDocx("07", "PAN.MILAD 2026", "2026-11-26")).toBe("draf-07-PAN.MILAD-2026-2026-11-26.docx");
  });
});
