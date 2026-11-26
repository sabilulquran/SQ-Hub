import { Buffer } from "node:buffer";
import { crc32 } from "node:zlib";

import { type Naskah } from "./naskah.js";

/**
 * SEK-IMPL-004 §7.3: a minimal OOXML writer. A `.docx` is a ZIP of four small XML parts, so a
 * full document library would add megabytes for nothing — and Mi8's memory is a real limit
 * (SEK-IMPL-001 §12). Everything here is built from strings with strict escaping, so there is no
 * binary template in the repository whose contents nobody has read.
 */

// Pedoman Pasal 10: A4, 2 cm margins, Arial 11 pt, 1.5 line spacing with 6 pt before/after,
// first-line indent 1.25 cm on body paragraphs. Word measures these in twips (1/1440 inch).
const HALAMAN = { lebar: 11906, tinggi: 16838, margin: 1134 };
const SPASI = { baris: 360, sebelum: 120, sesudah: 120 };
const INDEN_BARIS_PERTAMA = 709;
const UKURAN_HURUF = 22; // half-points: 11 pt
const UKURAN_KECIL = 16; // half-points: 8 pt, for the draft note

/** Only the five XML predefined entities exist in XML 1.0; control characters are dropped. */
export function escapeXml(value: string): string {
  let keluar = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 && char !== "\t") continue;
    if (code === 0x7f) continue;
    if (char === "&") keluar += "&amp;";
    else if (char === "<") keluar += "&lt;";
    else if (char === ">") keluar += "&gt;";
    else if (char === '"') keluar += "&quot;";
    else if (char === "'") keluar += "&apos;";
    else keluar += char;
  }
  return keluar;
}

interface GayaParagraf {
  inden?: boolean;
  rata?: "both" | "center" | "right" | "left";
  tebal?: boolean;
  kecil?: boolean;
  spasiTunggal?: boolean;
}

function run(teks: string, gaya: GayaParagraf): string {
  const ukuran = gaya.kecil ? UKURAN_KECIL : UKURAN_HURUF;
  const props = [
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>',
    gaya.tebal ? "<w:b/>" : "",
    `<w:sz w:val="${ukuran}"/><w:szCs w:val="${ukuran}"/>`,
  ].join("");
  // xml:space preserve keeps the leading and trailing spaces of a line intact.
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${escapeXml(teks)}</w:t></w:r>`;
}

function paragraf(teks: string, gaya: GayaParagraf = {}): string {
  const spacing = gaya.spasiTunggal
    ? '<w:spacing w:line="240" w:lineRule="auto" w:before="0" w:after="0"/>'
    : `<w:spacing w:line="${SPASI.baris}" w:lineRule="auto" w:before="${SPASI.sebelum}" w:after="${SPASI.sesudah}"/>`;
  const props = [
    spacing,
    `<w:jc w:val="${gaya.rata ?? "both"}"/>`,
    gaya.inden ? `<w:ind w:firstLine="${INDEN_BARIS_PERTAMA}"/>` : "",
  ].join("");
  return `<w:p><w:pPr>${props}</w:pPr>${teks.length > 0 ? run(teks, gaya) : ""}</w:p>`;
}

/**
 * The `Nomor / Lampiran / Perihal` block on the left and the dates on the right. A two-column
 * table keeps the two columns apart without relying on tab stops the reader may not have.
 */
function blokMeta(naskah: Naskah): string {
  const kiri = naskah.meta
    .map((baris) => paragraf(`${baris.label} : ${baris.nilai}`, { rata: "left", spasiTunggal: true }))
    .join("");
  const kanan = naskah.kanan
    .map((baris) => paragraf(baris, { rata: "right", spasiTunggal: true }))
    .join("");
  const sel = (isi: string, lebar: number) =>
    `<w:tc><w:tcPr><w:tcW w:w="${lebar}" w:type="dxa"/></w:tcPr>${isi}</w:tc>`;
  return [
    "<w:tbl>",
    '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>',
    ...["top", "left", "bottom", "right", "insideH", "insideV"].map((sisi) => `<w:${sisi} w:val="none" w:sz="0" w:space="0"/>`),
    "</w:tblBorders></w:tblPr>",
    `<w:tr>${sel(kiri, 5600)}${sel(kanan, 3600)}</w:tr>`,
    "</w:tbl>",
  ].join("");
}

function badan(naskah: Naskah): string {
  const bagian: string[] = [];
  // Room for the letterhead the staff member pastes in Word (A-3).
  bagian.push(paragraf("", {}), paragraf("", {}), paragraf("", {}));
  bagian.push(blokMeta(naskah));
  bagian.push(paragraf("", { spasiTunggal: true }));
  bagian.push(paragraf(`Yth. ${naskah.yth}`, { rata: "left", spasiTunggal: true }));
  bagian.push(paragraf(`di ${naskah.di}`, { rata: "left", spasiTunggal: true }));
  bagian.push(paragraf("", { spasiTunggal: true }));
  bagian.push(paragraf(naskah.basmalah, { rata: "center" }));
  bagian.push(paragraf(naskah.salam, { rata: "left" }));
  for (const alinea of naskah.isi) bagian.push(paragraf(alinea, { inden: true }));
  bagian.push(paragraf(naskah.penutup, { rata: "center" }));
  bagian.push(paragraf("", {}));
  for (const baris of naskah.tandaTangan) bagian.push(paragraf(baris, { rata: "left", spasiTunggal: true }));
  if (naskah.tembusan) {
    bagian.push(paragraf("", { spasiTunggal: true }));
    bagian.push(paragraf("Tembusan:", { rata: "left", spasiTunggal: true }));
    bagian.push(paragraf(naskah.tembusan, { rata: "left", spasiTunggal: true }));
  }
  return bagian.join("");
}

function dokumenXml(naskah: Naskah): string {
  const sectPr = [
    "<w:sectPr>",
    '<w:footerReference w:type="default" r:id="rIdFooter"/>',
    `<w:pgSz w:w="${HALAMAN.lebar}" w:h="${HALAMAN.tinggi}"/>`,
    `<w:pgMar w:top="${HALAMAN.margin}" w:right="${HALAMAN.margin}" w:bottom="${HALAMAN.margin}" w:left="${HALAMAN.margin}" w:header="708" w:footer="708" w:gutter="0"/>`,
    "</w:sectPr>",
  ].join("");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    "<w:body>",
    badan(naskah),
    sectPr,
    "</w:body></w:document>",
  ].join("");
}

function footerXml(catatan: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    paragraf(catatan, { rata: "center", kecil: true, spasiTunggal: true }),
    "</w:ftr>",
  ].join("");
}

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
  "</Types>",
].join("");

const ROOT_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
  "</Relationships>",
].join("");

const DOC_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
  "</Relationships>",
].join("");

export interface EntriZip {
  nama: string;
  data: Buffer;
}

/**
 * A ZIP of *stored* entries. Deflate would save a few kilobytes on a file this small and buy a
 * second failure mode; stored keeps the writer short enough to read in one sitting.
 * Timestamps are fixed at 1980-01-01 so the same letter always renders byte-for-byte the same.
 */
export function zipStore(entri: EntriZip[]): Buffer {
  const potongan: Buffer[] = [];
  const pusat: Buffer[] = [];
  let offset = 0;
  for (const berkas of entri) {
    const nama = Buffer.from(berkas.nama, "utf8");
    const sum = crc32(berkas.data);
    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0);
    lokal.writeUInt16LE(20, 4); // version needed
    lokal.writeUInt16LE(0, 6); // flags
    lokal.writeUInt16LE(0, 8); // stored
    lokal.writeUInt16LE(0, 10); // time
    lokal.writeUInt16LE(0x0021, 12); // date: 1980-01-01
    lokal.writeUInt32LE(sum, 14);
    lokal.writeUInt32LE(berkas.data.length, 18);
    lokal.writeUInt32LE(berkas.data.length, 22);
    lokal.writeUInt16LE(nama.length, 26);
    lokal.writeUInt16LE(0, 28); // extra length
    potongan.push(lokal, nama, berkas.data);

    const pusatEntri = Buffer.alloc(46);
    pusatEntri.writeUInt32LE(0x02014b50, 0);
    pusatEntri.writeUInt16LE(20, 4); // version made by
    pusatEntri.writeUInt16LE(20, 6); // version needed
    pusatEntri.writeUInt16LE(0, 8);
    pusatEntri.writeUInt16LE(0, 10);
    pusatEntri.writeUInt16LE(0, 12);
    pusatEntri.writeUInt16LE(0x0021, 14);
    pusatEntri.writeUInt32LE(sum, 16);
    pusatEntri.writeUInt32LE(berkas.data.length, 20);
    pusatEntri.writeUInt32LE(berkas.data.length, 24);
    pusatEntri.writeUInt16LE(nama.length, 28);
    pusatEntri.writeUInt16LE(0, 30); // extra
    pusatEntri.writeUInt16LE(0, 32); // comment
    pusatEntri.writeUInt16LE(0, 34); // disk
    pusatEntri.writeUInt16LE(0, 36); // internal attrs
    pusatEntri.writeUInt32LE(0, 38); // external attrs
    pusatEntri.writeUInt32LE(offset, 42);
    pusat.push(pusatEntri, nama);

    offset += lokal.length + nama.length + berkas.data.length;
  }
  const isiPusat = Buffer.concat(pusat);
  const akhir = Buffer.alloc(22);
  akhir.writeUInt32LE(0x06054b50, 0);
  akhir.writeUInt16LE(0, 4);
  akhir.writeUInt16LE(0, 6);
  akhir.writeUInt16LE(entri.length, 8);
  akhir.writeUInt16LE(entri.length, 10);
  akhir.writeUInt32LE(isiPusat.length, 12);
  akhir.writeUInt32LE(offset, 16);
  akhir.writeUInt16LE(0, 20);
  return Buffer.concat([...potongan, isiPusat, akhir]);
}

/** Fails at boot rather than handing a staff member a corrupt file (§7.3). */
export function assertDocxTersedia(): void {
  if (typeof crc32 !== "function") {
    throw new Error("node:zlib crc32 is required to render .docx (Node 22.2 or newer)");
  }
}

export function renderDocx(naskah: Naskah): Buffer {
  assertDocxTersedia();
  return zipStore([
    { nama: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { nama: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
    { nama: "word/document.xml", data: Buffer.from(dokumenXml(naskah), "utf8") },
    { nama: "word/_rels/document.xml.rels", data: Buffer.from(DOC_RELS, "utf8") },
    { nama: "word/footer1.xml", data: Buffer.from(footerXml(naskah.catatanKaki), "utf8") },
  ]);
}

/** `draf-07-GA.YSQ-2026-11-26.docx`; the caller already checked the pieces are safe. */
export function namaBerkasDocx(jenisKode: string, penerbitKode: string, tanggal: string): string {
  const aman = (value: string) => value.replace(/[^A-Za-z0-9.-]/g, "-");
  return `draf-${aman(jenisKode)}-${aman(penerbitKode)}-${aman(tanggal)}.docx`;
}
