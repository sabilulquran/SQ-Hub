# Sekretariat — Rancangan modul (PRD)

**Status:** DRAFT / DISCOVERY. Dokumen ini tidak mengizinkan implementasi atau perubahan production.
**Spesifikasi:** SEK-001 (usulan). Spesifikasi implementasi belum ada.
**Tanggal:** 2026-11-12 (revisi 1; revisi 0 2026-11-11)
**Terkait:** ADR-0001 (batas platform), ADR-0006 (stack), ADR-0007 (Organization Directory), ADR-0011 (pola modul bersama); `rapat-sq-module-design.md` (RAPAT-001 §2, register keputusan), `kerja-sq-module-design.md` (KERJA-001 §1.3, struktur organisasi dan 26 pengguna), `kirim-sq-module-design.md` (KIRIM-001); HCIS `docs/domain/hr-documents.md` (DOC-001/DOC-002, keputusan D-01–D-15) dan register EMP-010

## 1. Dasar

### 1.1 Fungsi tanpa unit

Yayasan **tidak punya unit kerja Sekretariat**. Struktur organisasi (KERJA-001 §1.3) berisi Direktur, empat unit sekolah, lima unit operasional, dan Biro Qur'an — tidak satu pun bernama Sekretariat atau Tata Usaha yayasan. Namun fungsinya ada dan berjalan setiap pekan, tersebar di banyak tangan:

| Fungsi | Siapa yang mengerjakannya sekarang |
| --- | --- |
| Surat keluar atas nama yayasan (undangan, pemberitahuan, permohonan, pengantar) | Unit masing-masing mengetik sendiri, nomor ditentukan sendiri-sendiri |
| Surat masuk (dinas pendidikan, kemenag, mitra, bank) — fisik maupun email | Diterima siapa pun yang sedang ada, diteruskan lewat WhatsApp, tidak teregister; email yayasan dibaca dari akun pribadi/unit tanpa catatan bersama |
| Surat Keputusan (SK) pengurus dan direktur | Diketik saat dibutuhkan; register tidak ada |
| Dokumen legal yayasan (akta notaris, SK Kemenkumham, NPWP, izin operasional sekolah, MoU) | Berkas fisik dan salinan PDF tersebar; tanggal habis izin tidak diingatkan sistem |
| Templat dan kop surat | Tiap unit memegang salinannya sendiri, versi tidak seragam |

Dua modul lain sudah menunjuk fungsi ini tanpa pemiliknya: RAPAT-001 menetapkan `rapat_admin` sebagai "Sekretariat yayasan" (keputusan owner nomor 3), dan HCIS memakai nomor dokumen gaya `YSQ/HCM/UJ/030` pada Buku Uraian Jabatan tanpa register yayasan yang menjaminnya. Modul ini memberi fungsi-fungsi itu satu rumah; perannya dipegang orang yang ditunjuk, bukan unit baru.

### 1.2 Masalah

- **Nomor surat tidak dijamin.** Tidak ada register pusat, jadi dua unit bisa memakai nomor yang sama, dan nomor bisa "dikarang" mundur. Surat atas nama yayasan tidak bisa diverifikasi keasliannya.
- **Surat masuk hilang jejak.** Tidak ada catatan surat apa diterima kapan, siapa yang menindaklanjuti, dan apa hasilnya.
- **SK tidak teregister.** Keputusan rapat akan tercatat di Rapat SQ (R1), tetapi SK sebagai dokumen resmi yang menindaklanjutinya tidak punya register dan penomoran.
- **Izin bisa kedaluwarsa tanpa peringatan.** Izin operasional sekolah dan perjanjian kerja sama punya tanggal habis; tidak ada sistem yang mengingatkan.

> **DISCOVERY.** Volume nyata belum didata: berapa surat keluar dan masuk per bulan, berapa SK per tahun, dan dokumen legal apa saja yang dimiliki yayasan beserta tanggal habisnya. Perkiraan dokumen ini: puluhan surat per bulan di seluruh yayasan, SK satuan per bulan, dokumen legal puluhan lembar. Angka nyata dikumpulkan pada langkah §14 nomor 1.

### 1.3 Hasil yang dituju

1. Setiap surat keluar atas nama yayasan memegang nomor yang dijamin register pusat, dengan arsip PDF yang tidak berubah setelah terbit.
2. Setiap surat masuk — lewat email yayasan maupun berkas fisik yang dipindai — jatuh ke kotak masuk yang tepat, terdisposisi ke unit, dan kelihatan statusnya.
3. Setiap SK terdaftar, bernomor, dan tertaut ke keputusan rapat yang mendasarinya bila ada.
4. Dokumen legal yayasan terkumpul di satu arsip dengan tanggal habis yang diingatkan jauh hari.
5. Penerima surat bisa memverifikasi keaslian surat yayasan dari nomor atau QR.

## 2. Batas tanggung jawab

| Urusan | **Sekretariat** | **Di luar modul** |
| --- | --- | --- |
| Surat keluar yayasan dan unit | Register, penomoran, arsip PDF, templat | Isi surat ditulis unit pengirim |
| Surat masuk | Kotak masuk per unit + yayasan: email domain (IMAP) dan pindaian surat fisik, register, disposisi, status | Tindak lanjutnya dikerjakan unit (bisa jadi kartu Kerja SQ); kotak masuk WhatsApp milik Kirim SQ |
| SK pengurus/direktur | Register, penomoran, arsip | Keputusan rapatnya milik Rapat SQ; SK kepegawaian (pengangkatan, mutasi) milik register HCIS EMP-010 |
| Dokumen legal yayasan | Arsip, metadata, tanggal habis, pengingat | Dokumen kepemilikan aset (sertifikat tanah, BPKB) milik Aset SQ; Sekretariat hanya menautkan |
| Surat layanan kepegawaian | — | HCIS DOC-001/DOC-002 (surat keterangan, SP) dengan penomoran sendiri (D-04) |
| Dokumen transaksi modul lain | — | Tanda terima SPMB, tanda terima donasi Sosial, dokumen Keuangan: masing-masing menomori sendiri |
| Notula dan keputusan rapat | — | Rapat SQ |
| Kalender kegiatan dan tugas | — | Kerja SQ |

Yang **tidak** dibangun:

- **tanda tangan elektronik bersertifikat.** Surat memakai blok penandatangan tercetak, sama seperti HCIS PAYSLIP-005; verifikasi keaslian lewat register dan QR, bukan sertifikat digital;
- **rantai approval surat.** Penerbitan satu langkah oleh pemegang peran; yayasan sekecil ini tidak butuh e-office berjenjang (meniru keputusan HCIS D-07);
- **pemindaian massal arsip lama.** Mulai dari surat yang terbit sejak modul hidup; arsip lama menyusul per kebutuhan (§13 nomor 4);
- **master organisasi kedua.** Kode unit untuk penomoran dibaca dari Organization Directory;
- **klien email penuh.** R1 membaca dan meregister email masuk, tidak mengirim, tidak mengelola folder, dan tidak menghapus apa pun di mailbox; email tetap bisa dibuka lewat webmail seperti biasa.

## 3. Letak

Sekretariat adalah **modul bersama di SQ Hub**, mengikuti pola ADR-0011 yang sudah dipakai Kirim SQ dan Kerja SQ:

- modul `sekretariat` di `apps/api` dan area web di `apps/web` — **tanpa proses baru di Mi8**, pertimbangan yang sama yang menempatkan Kerja SQ di Hub;
- alamat `sekretariat.sabilulquran.or.id`, masuk dengan Akun SQ staf dan akses lewat SQ Hub Application Access, seperti `kirim.sabilulquran.or.id`;
- tabel sendiri berawalan `sekretariat_` di database Hub; modul lain membaca lewat API, tidak lewat tabel;
- unit dan jabatan dibaca dari Organization Directory (ADR-0007);
- berkas (pindaian, PDF terbit) di disk Mi8 dengan salinan terenkripsi `rclone` ke Drive yayasan sebagai backup — pola Karir SQ yang diadopsi juga oleh Kerja SQ. Volume surat jauh di bawah lampiran Kerja SQ, jadi tidak menggeser perhitungan kapasitas yang ada.

Alasan bukan aplikasi sendiri (pola SPMB/Sosial): tidak ada halaman publik selain satu halaman verifikasi, tidak ada identitas eksternal, datanya lintas unit tetapi seluruh penggunanya staf, dan memori Mi8 adalah batas yang nyata. Bila kelak volume atau kebutuhan publik membesar, modul ini kandidat ekstraksi yang sama seperti Kerja SQ.

**DNS.** `sekretariat.sabilulquran.or.id` per 2026-11-11 **belum ada** (NXDOMAIN). Rekaman dibuat pemegang akun Cloudflare yayasan lewat tunnel Mi8 saat rilis pertama siap, tidak lebih awal, dan dihapus bila layanan pensiun — pelajaran takeover subdomain `ppdb`.

## 4. Konsep dan entitas

```text
PERSURATAN (R1)
JenisSurat ──► NomorSurat (register, urut per jenis per tahun)
                 │
SuratKeluar ─────┘──► ArsipPDF (snapshot, checksum, QR)

KOTAK MASUK (R1)
Email (IMAP sekretariat@) ──┐
Pindaian surat fisik ───────┴──► SuratMasuk ──► KotakMasuk (yayasan / per unit)
                                     └──► Disposisi ──► (opsional) kartu Kerja SQ

REGISTER SK (R2)
SK ──► NomorSurat ──► ArsipPDF
 └──► tautan ke keputusan Rapat SQ (bila ada)

DOKUMEN LEGAL (R2)
DokumenLegal (jenis, penerbit, nomor asli, berlaku s.d.) ──► Pengingat (Kirim SQ / in-app)
```

- **JenisSurat** memegang kode penomoran (mis. `UND` undangan, `KET` keterangan, `SK`, `MoU`) dan templatnya. Dikelola `sekretariat_admin`.
- **NomorSurat** dialokasikan **hanya saat terbit**, tidak saat draf dibuat, dan **tidak didaur ulang** — surat yang dibatalkan tetap memegang nomornya berstatus `DIBATALKAN`. Dua keputusan ini meniru HCIS D-02/D-03 yang sudah ACCEPTED.
- **ArsipPDF** adalah berkas final yang diunggah atau dirender, disimpan sekali dengan checksum; data pegawai/unit di dalamnya adalah snapshot saat terbit.
- **KotakMasuk** adalah kotak surat per pemilik: satu kotak yayasan dan satu kotak per unit. Isinya SuratMasuk dari dua kanal: email yang ditarik dari mailbox domain, dan pindaian surat fisik yang diunggah pencatat.
- **SuratMasuk** menyimpan pengirim, tanggal diterima, perihal, isi/pindaian beserta lampiran email, dan disposisi (unit tujuan + catatan + tenggat).
- **Penarik email** adalah adapter yang bisa diganti, meniru pola engine Kirim SQ: port `MailFetcher`, adapter pertama IMAP ke mailbox `sekretariat@sabilulquran.or.id` di hosting email domain (cPanel/Jagoan, yang sudah dipakai Karir SQ untuk kirim email). Modul **membaca dan meregister**; email tetap utuh di mailbox aslinya.
- **DokumenLegal** menyimpan metadata dan berkas; yang bertanggal habis menghasilkan pengingat H-90/H-30/H-7.

## 5. Alur utama

### 5.1 Surat keluar

1. Pencatat unit membuat entri: jenis, perihal, tujuan, penandatangan, lampiran PDF final (atau render dari templat di R3).
2. Saat **terbitkan**, register mengalokasikan nomor berikutnya untuk jenis itu pada tahun berjalan, menempelkan QR verifikasi, dan mengunci arsip.
3. Surat lama (sebelum modul hidup) boleh diregister mundur dengan penanda `RETROAKTIF` dan nomor aslinya apa adanya — register tidak menerbitkan nomor baru untuk masa lalu.

### 5.2 Kotak masuk dan disposisi

Keputusan owner 2026-11-12: modul ini juga menjadi **kotak masuk email** yayasan, dengan akses berlapis (§7).

1. **Email.** Penarik email mengambil pesan baru dari `sekretariat@sabilulquran.or.id` dan meregisternya ke kotak masuk yayasan — pengirim, perihal, isi, lampiran. Email tetap utuh di mailbox aslinya. Bila kelak unit punya alamat sendiri (§13 nomor 8), tiap alamat menjadi sumber kotak masuk unitnya.
2. **Surat fisik.** Pencatat memotret/mengunggah surat dan mengisi metadata singkat; surat yang dialamatkan ke unit boleh diregister langsung ke kotak masuk unit oleh pencatat unit itu.
3. **Disposisi.** Pemegang disposisi (Direktur atau yang ditunjuk) meneruskan isi kotak yayasan ke kotak masuk unit dengan catatan dan tenggat; unit menandai selesai dengan keterangan.
4. **Balasan.** R1 hanya membaca dan meregister; balasan email masih dikirim dari klien email biasa, dan statusnya dicatat manual (§13 nomor 9).
5. Bila tindak lanjut berupa pekerjaan nyata, disposisi dapat membuat **kartu di ruang Kerja SQ** unit itu (R2, konsumen bernama sesuai aturan Application Platform).

### 5.3 Surat Keputusan

SK diregister seperti surat keluar dengan jenis `SK`, ditambah dua hal: tautan opsional ke butir keputusan di register Rapat SQ, dan daftar pihak yang menerima salinan. SK kepegawaian tetap terbit dan teregister di HCIS (EMP-010); Sekretariat tidak menduplikasinya.

### 5.4 Dokumen legal dan pengingat

1. Admin mengunggah dokumen legal sekali di awal (akta, SK Kemenkumham, NPWP, izin operasional per sekolah, MoU aktif) dengan tanggal habis bila ada.
2. Pengingat jatuh ke Direktur dan unit terkait: in-app dulu, WhatsApp lewat Kirim SQ begitu kapasitasnya tersedia (adapter `log` → `kirim`, pola KERJA-001).
3. Perpanjangan dicatat sebagai versi baru; versi lama tetap tersimpan.

## 6. Integrasi dengan modul lain

| Modul | Hubungan |
| --- | --- |
| **HCIS** | Batas, bukan integrasi: surat layanan kepegawaian (DOC-001/002) dan SK kepegawaian (EMP-010) tetap di HCIS dengan penomorannya sendiri. Bila kelak owner menyatukan penomoran, HCIS membaca alokasi nomor lewat kontrak API — tidak di rancangan ini (§13 nomor 3) |
| **Rapat SQ** | SK menautkan butir keputusan rapat sebagai dasarnya (R2, setelah Rapat R1 ada). Satu arah: Sekretariat membaca, tidak menulis |
| **Kerja SQ** | Disposisi dapat membuat kartu di ruang unit (R2). Pencatat unit = petugas administrasi yang sudah ada di 26 pengguna Kerja SQ |
| **Kirim SQ** | Pengingat kedaluwarsa dan notifikasi disposisi lewat `WhatsAppSender` port dengan adapter `log` + `kirim` |
| **Aset SQ** | Dokumen kepemilikan aset tetap di Aset SQ; arsip legal hanya menautkan |
| **SPMB / Sosial / Keuangan / Karir** | Tidak ada: dokumen transaksi mereka bernomor sendiri di modulnya |
| **SQ Hub** | Akun SQ, Application Access, Organization Directory (kode unit untuk penomoran), audit |
| **Email domain (cPanel/Jagoan)** | Sumber kotak masuk: IMAP baca-saja ke `sekretariat@sabilulquran.or.id` (dibuat dulu di cPanel). Kredensial mailbox disimpan sebagai secret di Mi8, bukan di repository |

## 7. Peran

Tidak ada unit Sekretariat, jadi peran dipegang orang per fungsi. **Akses berlapis** (keputusan owner 2026-11-12):

| Peran | Kewenangan | Siapa (usulan) |
| --- | --- | --- |
| `sekretariat_admin` | **Akses penuh**: semua kotak masuk (termasuk email yayasan), semua register nomor, semua arsip, jenis surat, templat, hak akses modul | **Kepala HCM** — orang yang sama dengan `kirim_admin` dan `kerja_admin` (DRAFT) |
| Pencatat unit — hanya orang yang **ditunjuk** per unit | **Sebatas unitnya**: kotak masuk unit, register nomor surat unit (membuat dan menerbitkan surat keluar unit), arsip online unit | Petugas administrasi sekolah dan admin unit (gelombang pertama Kerja SQ) |
| Pemberi disposisi | Kotak masuk yayasan dan meneruskannya ke kotak unit | Direktur, dapat didelegasikan |
| Penandatangan | Tercatat pada surat; melihat surat yang ia tandatangani | Direktur, Ketua/Sekretaris Pengurus (akun organ, baca-saja) |
| Pembaca arsip legal | Membaca dokumen legal | Direktur, organ yayasan, `sekretariat_admin` |

Pencatat unit tidak melihat kotak masuk yayasan, kotak unit lain, register unit lain, maupun arsip unit lain. Peran dengan akses arsip legal atau kotak masuk yayasan wajib MFA (`staff-authentication-policy.md`).

## 8. Penomoran dan verifikasi

- Format usulan, selaras dengan HCIS D-04 dan nomor yang sudah beredar (`YSQ/HCM/UJ/030`): **`<urut>/<kode-jenis>/<kode-unit>/YSQ/<bulan-romawi>/<tahun>`**, urut per jenis per tahun takwim; surat atas nama yayasan memakai kode unit `SEK` atau tanpa kode unit (§13 nomor 1). Status **DRAFT** — aturan bisnis yang belum ada di dokumen mana pun.
- Urutan tanpa lompatan dijamin database (pola §8 SOS-001). PDF disimpan sekali dengan checksum dan QR.
- **Halaman verifikasi** `sekretariat.sabilulquran.or.id/v/<kode>` (publik, tanpa login) hanya menampilkan nomor, jenis, tanggal, perihal umum, dan penandatangan — tanpa isi surat dan tanpa data pribadi.

## 9. Privasi, keamanan, audit

- Surat bisa memuat data pribadi dan urusan sensitif (teguran mitra, perjanjian). Isi dan lampiran hanya terbuka bagi peran pada §7; halaman verifikasi tidak pernah menampilkan isi.
- Isi email adalah data pihak luar: tunduk pada akses berlapis §7, tidak masuk log, dan kredensial mailbox hanya di secret Mi8. Penarikan IMAP baca-saja — modul tidak menghapus atau memindahkan email di mailbox.
- Dokumen legal adalah identitas hukum yayasan; unduhan memakai tautan sementara dan setiap akses tercatat.
- Audit mencatat alokasi nomor, penerbitan, pembatalan beralasan, register retroaktif, disposisi dan perubahan statusnya, serta unggah/versi dokumen legal.
- Berkas PDF/JPEG/PNG maksimum 10 MiB; register retroaktif dan pembatalan butuh alasan tertulis.
- Tidak ada NIK, nomor rekening, atau gaji dalam metadata register.

## 10. Tampilan

Mengikuti SQ Core design system C dan app shell. Teks antarmuka menulis "Sabilul Qur'an", tidak disingkat "SQ".

Ruang staf: **Ringkasan** (surat terbaru, disposisi terbuka, izin mendekati habis), **Kotak masuk** (email + surat fisik; admin melihat semua kotak, pencatat hanya kotak unitnya), **Surat keluar**, **Surat Keputusan**, **Arsip legal**, **Pengaturan** (jenis, templat, alamat email sumber, akses). Pencatat unit hanya melihat menu dan data unitnya. Aksen kategori: belum dipilih.

## 11. Tahapan

| Rilis | Isi | Menggantikan |
| --- | --- | --- |
| **R1 · Register, nomor & kotak masuk** | Jenis surat, surat keluar + penomoran terjamin + arsip PDF unggahan, kotak masuk (email `sekretariat@` lewat IMAP + pindaian surat fisik) + disposisi in-app, akses berlapis, register retroaktif | Penomoran sendiri-sendiri per unit; email yayasan tanpa register |
| **R2 · SK, legal, integrasi** | Register SK + tautan Rapat SQ, arsip dokumen legal + pengingat kedaluwarsa, disposisi → kartu Kerja SQ, notifikasi Kirim SQ, halaman verifikasi publik | Berkas legal tersebar; izin tanpa pengingat |
| **R3 · Render dari templat** | Surat dirender dari templat + data (pola HCIS D-01), kop seragam, blok tanda tangan | Ketik manual di Word per unit |

R1 berdiri sendiri: tidak menunggu Rapat SQ, Kirim SQ production, atau modul lain.

## 12. Risiko

| Risiko | Penanganan |
| --- | --- |
| Modul dibangun tetapi tidak dipakai karena tidak ada unit pemiliknya | Fungsi ditempelkan ke orang yang sudah ada (petugas administrasi gelombang Kerja SQ); mulai dari penomoran, kebutuhan yang paling terasa |
| Penomoran pusat ditinggalkan dan unit kembali mengarang nomor | Verifikasi QR membuat surat teregister lebih "sah" di mata penerima; sosialisasi lewat jalur yang sama dengan Kerja SQ |
| Register ganda dengan HCIS untuk SK kepegawaian | Batas §2 eksplisit; UI SK menolak jenis kepegawaian dan menunjuk ke HCIS |
| Dokumen legal bocor | Peran sempit + MFA, tautan sementara, akses tercatat |
| Beban Mi8 bertambah | Modul di proses Hub yang ada; berkas kecil dan jarang; penarikan email berkala (bukan push), lampiran dibatasi; pola backup yang sudah berjalan |
| Kredensial mailbox bocor atau mailbox penuh spam | Kredensial di secret Mi8, IMAP baca-saja; alamat `sekretariat@` dipublikasikan seperlunya; spam ditandai tanpa disposisi dan tidak membuat kartu |
| Subdomain dibuat lalu ditinggalkan | DNS hanya lewat tunnel Mi8, dihapus bila pensiun |

## 13. Keputusan terbuka

Semua saran di bawah adalah asumsi **DRAFT** sampai Product Owner menetapkannya.

| # | Pertanyaan | Saran |
| --- | --- | --- |
| 1 | Format nomor surat yayasan | `<urut>/<kode-jenis>/<kode-unit>/YSQ/<bulan-romawi>/<tahun>`, urut per jenis per tahun; selaras HCIS D-04 |
| 2 | Siapa `sekretariat_admin` | **Kepala HCM**, sama dengan `kirim_admin` dan `kerja_admin` |
| 3 | Apakah penomoran HCIS (D-04) ikut register pusat ini | **Tidak untuk sekarang.** HCIS menomori suratnya sendiri; disatukan hanya bila owner memutuskan, lewat kontrak API |
| 4 | Arsip lama diregister mundur sampai kapan | Hanya yang masih dirujuk (SK aktif, MoU berjalan, izin berlaku); bukan pemindaian massal |
| 5 | Nama modul di antarmuka | **"Sekretariat"** saja; nama internal Sekretariat SQ sejalan Kirim/Rapat/Kerja SQ |
| 6 | ~~Siapa boleh melihat surat keluar~~ | **DIPUTUSKAN owner 2026-11-12:** akses berlapis — admin akses penuh termasuk semua kotak masuk; per unit hanya orang yang ditunjuk, sebatas kotak masuk, register nomor, dan arsip online unitnya (§7) |
| 7 | Pengingat kedaluwarsa jatuh ke siapa | Direktur dan kepala unit terkait, H-90/H-30/H-7 |
| 8 | Alamat email: satu `sekretariat@` atau juga per unit | Mulai **satu alamat** `sekretariat@sabilulquran.or.id`; pembagian ke unit lewat disposisi in-app. Alamat per unit menyusul bila volume menuntut, tiap alamat jadi sumber kotak unitnya |
| 9 | Balas email dari dalam modul | **Tidak di R1** — baca dan register saja; balasan dari klien email biasa dan statusnya dicatat. Kirim dari modul (SMTP mailbox yang sama) dinilai di R2 setelah volume terlihat |

## 14. Langkah berikutnya

1. Data singkat volume: hitung surat keluar/masuk sebulan terakhir di dua unit contoh, daftar dokumen legal beserta tanggal habisnya. Hasilnya mengganti catatan DISCOVERY §1.2.
2. Product Owner menetapkan §13, terutama nomor 1 (format nomor) dan 2 (admin).
3. Buat mailbox `sekretariat@sabilulquran.or.id` di cPanel (pemegang akses hosting email), simpan kredensialnya sebagai secret di Mi8.
4. Pemegang akun Cloudflare yayasan membuat rekaman `sekretariat` lewat tunnel Mi8 saat R1 siap terbit, tidak lebih awal.
5. Baru setelah itu: spesifikasi `SEK-IMPL-001` untuk R1 saja, mengikuti pola KERJA-IMPL-001. ADR tampaknya tidak perlu — modul mengikuti pola ADR-0011 yang sudah ACCEPTED.

Tidak ada kode yang ditulis sebelum langkah 1–2 selesai.
