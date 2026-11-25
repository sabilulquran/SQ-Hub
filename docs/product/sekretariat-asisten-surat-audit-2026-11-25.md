# Audit Sekretariat SQ dan rancangan Asisten Surat

**Sifat:** laporan audit baca-saja + rancangan. Tidak ada kode, konfigurasi, data production, akun, atau mailbox yang diubah dalam pekerjaan ini. Dokumen ini belum mengizinkan implementasi apa pun.
**Lanjutannya:** [SEK-IMPL-004](../specs/SEK-IMPL-004-asisten-surat.md) (DRAFT, 2026-11-25) adalah spesifikasi implementasi yang lahir dari audit ini. Bila keduanya berbeda, spesifikasi yang berlaku.
**Tanggal:** 2026-11-25
**Lingkup:** aplikasi Sekretariat SQ di `sekretariat.sabilulquran.or.id` (modul `sekretariat` di proses SQ Hub), buku nomor surat yayasan, dan titik masuk untuk fitur "Buat dengan AI" pada Surat Keluar.
**Keputusan owner 2026-11-25:** "SP" pada versi pertama berarti **jenis 07 Peringatan** (§3.2, §6 nomor 1). Enam butir keputusan sisanya berjalan di atas default `DRAFT` (§6).
**Rujukan utama:** [SEK-001](sekretariat-module-design.md) · [SEK-IMPL-001](../specs/SEK-IMPL-001-r1-buku-nomor-arsip-kotak-masuk.md) · [SEK-IMPL-002](../specs/SEK-IMPL-002-kotak-masuk-dari-layar.md) · [SEK-IMPL-003](../specs/SEK-IMPL-003-tampilan-kotak-masuk.md) · HCIS `docs/domain/hr-documents.md` (DOC-001/DOC-002) dan `docs/domain/outgoing-letter-register.md` (DOC-003) · Pedoman Tata Naskah Dinas YSQ (Google Doc, lihat §3.1).

---

## 1. Apa yang sudah berjalan, apa yang baru ada di kode, apa yang masih rancangan

### 1.1 Bukti production (diambil 2026-11-25, hanya GET)

| Pemeriksaan | Hasil |
| --- | --- |
| `GET https://sekretariat.sabilulquran.or.id/` | `200` |
| `GET /api/sekretariat/context` tanpa sesi | `401` (fail-closed) |
| `GET /api/admin/sekretariat/mailbox` tanpa sesi | `401` (rute SEK-IMPL-002 hidup) |
| `POST`-path `/internal/sekretariat/v1/alokasi-nomor` dari edge | `404` (tetap tertutup dari luar Mi8) |
| Bundel web yang disajikan | `/assets/index-CErMKJd7.js` |
| Penanda SEK-IMPL-003 di bundel | ada: `Kotak lain`, `Tambah panitia` |
| Penanda alur surat keluar di bundel | ada: `Register retroaktif`, `Terbitkan (ambil nomor)`, `Nomor diambil saat terbit` |
| Penanda AI di bundel | **tidak ada** (`Buat dengan AI` nihil) — belum ada jejak fitur ini di production |

Rilis yang menghasilkan keadaan itu, menurut runbook di repo `ops`:

- `hub-580d3291-20261117` — Sekretariat dinyalakan (`runbooks/2026-11-17-sekretariat-nyala.md`): client `sekretariat-sq` + `hcis-sekretariat` dibuat, `SEKRETARIAT_ENABLED=true`, katalog ter-seed **17 penerbit, 21 jenis**, `sekretariat_admins` aktif = 1 (Kepala HCM).
- `hub-186195b1-20261118` — SEK-IMPL-002 (`runbooks/2026-11-18-rilis-sekretariat-kotak-masuk.md`): tabel `sekretariat_mailbox` ada (17 kolom), **0 baris**, `SEKRETARIAT_DATA_KEYS` terisi.
- `hub-837c392b-20261118` — SEK-IMPL-003 (`runbooks/2026-11-18-rilis-sekretariat-tampilan.md`): tampilan ala aplikasi email, surat sebagai pop-up `?surat=`, pengaturan satu halaman per urusan.

### 1.2 Berjalan di production

| Hal | Bukti kode | Catatan |
| --- | --- | --- |
| Login Akun SQ khusus host Sekretariat | `apps/api/src/modules/sekretariat/routes.ts:610` (`registerSekretariatAuthRoutes`), cookie `sq_sekretariat_session`, transaksi `sq_sekretariat_oidc_tx` | Client OIDC `sekretariat-sq`, PKCE S256; `transactionTtlMinutes: 10` sedangkan sesi login Keycloak 30 menit — jebakan yang sudah tercatat (lihat §5.2) |
| Gerbang akses aplikasi | `routes.ts:290` — `checkAccess(identity, "sekretariat-sq")`; tanpa akses → `403 sekretariat_access_denied` | Application Access HUB-IMPL-009 |
| Identitas orang | `routes.ts:302` — `personByIdentity` dari Organization Directory; bukan pegawai aktif → `403 orang_belum_tercatat` | Tidak ada tabel pengguna sendiri |
| Kewenangan per penerbit | `modules/sekretariat/akses.ts:268` `loadPeran`, `:285` `requirePenerbit`, `:297` `requireKotak`, `:314` `requireSuratMasuk` | Penerbit lain → **404**, bukan 403 |
| Peran pengelola | `akses.ts:276` `isSekretariatAdmin` (tabel `sekretariat_admins`) | 1 pemegang aktif |
| Katalog jenis surat | `apps/api/migrations/0021_sekretariat_r1.sql:257` — 21 kode `01`–`21` | Dibaca lewat `GET /sekretariat/jenis` |
| Katalog penerbit | `0021_sekretariat_r1.sql:267` — 17 penerbit tetap; panitia dibuat admin dengan `berakhir_pada` wajib | `CHECK (kelompok <> 'panitia' OR berakhir_pada IS NOT NULL)` |
| Draf surat keluar | `modules/sekretariat/surat.ts:68` `create` | Field: jenis, perihal, tujuan, penandatangan, opsional `balasan_atas` |
| Penomoran saat terbit | `surat.ts:113` `terbitkan` → `buku.ts:98` `allocate` | Satu transaksi, kunci baris penghitung, tanpa tanggal mundur |
| Pembatalan | `surat.ts:141` `batalkan` (draf dihapus, terbit dibatalkan beralasan), `buku.ts:201` `void` | Nomor batal tetap tercatat |
| Arsip PDF | `routes.ts:462` (unggah, `allow: "pdf"`), `berkas.ts:110` (sniff MIME + checksum SHA-256), `surat.ts:135` (kunci saat terbit) | **Hanya PDF** untuk `surat_keluar` |
| Register + ekspor CSV | `buku.ts:259` `register`, `buku.ts:313` `exportCsv` (sel dinetralkan dari formula) | Tersaring per akses |
| Kotak masuk, disposisi, spam, pencarian | `modules/sekretariat/kotak.ts` | Pencarian `q` atas pengirim/perihal/isi dengan LIKE di-escape (`kotak.ts:11`) |
| Layar | `apps/web/src/sekretariat/` — `SekretariatShell.tsx:134` (menu Surat keluar, Buku nomor), `SuratPages.tsx` | Beranda = kotak masuk pertama |

### 1.3 Ada di kode, belum dipakai di production

| Hal | Bukti | Mengapa belum jalan |
| --- | --- | --- |
| Penarikan email IMAP | `mail-imap.ts`, `mail.ts`, `module.ts:148` (timer 5 menit) | `SEKRETARIAT_MAIL_MODE` masih `log`; tabel `sekretariat_mailbox` kosong sehingga jalur env yang berlaku (M-5) — langkah §14 nomor 4 belum selesai |
| API alokasi untuk mesin | `routes-internal.ts:392` | Rutenya **hanya didaftarkan bila allowlist terisi** (`module.ts:139`); `SEKRETARIAT_ALLOWED_MACHINE_CLIENTS` masih kosong → HCIS belum menjadi konsumen |
| Migrasi DOC-003 | `migrasi.ts` + CLI | Langkah §14 nomor 8 belum dijalankan; buku HCIS masih buku aktif |
| Salinan berkas ke Drive | — | Langkah §14 nomor 5 (`rclone crypt sekretariat_media`) belum dipasang; **berkas Sekretariat di Mi8 belum punya salinan luar** |

### 1.4 Masih rancangan (belum ada kodenya)

- **R2:** register SK + tautan Rapat SQ, arsip dokumen legal + pengingat kedaluwarsa, disposisi → kartu Kerja SQ, notifikasi Kirim SQ, **halaman verifikasi publik `/v/<kode>`**, kirim email dari modul.
- **R3:** surat dirender dari templat + data, kop seragam, blok tanda tangan. **Asisten Surat adalah pintu masuk R3** dan belum punya spesifikasi.
- Tidak dibangun sama sekali (SEK-001 §2): tanda tangan elektronik bersertifikat, rantai approval, pemindaian massal arsip lama, klien email penuh.

### 1.5 Temuan tata kelola dokumen (bukan bug kode)

1. **SEK-IMPL-002 dan SEK-IMPL-003 masih berstatus `DRAFT` di kepala dokumennya**, padahal keduanya sudah dirilis ke production 18 November. Status dokumen tidak mencerminkan kenyataan.
2. **Dua migration bernomor 0026** (`0026_organ_decisions.sql` dan `0026_sekretariat_mailbox.sql`) sudah sama-sama masuk main. Tidak merusak apa pun (kunci `schema_migrations` adalah nama berkas), tetapi penomoran tidak lagi menunjukkan urutan. Migration berikutnya mulai 0027.
3. **Berkas Sekretariat belum punya salinan off-host.** Setiap rancangan yang menambah berkas (termasuk `.docx` hasil Asisten Surat, bila disimpan) memperbesar data yang hanya ada di satu HP.

---

## 2. Siklus satu surat, dan titik masuk Asisten Surat

### 2.1 Siklus yang sebenarnya berjalan

```text
(1) Petugas penerbit  → POST /sekretariat/penerbit/:id/surat        → baris sekretariat_surat_keluar status 'draf', nomor_id NULL
(2) Petugas           → POST /sekretariat/surat/:id/berkas (PDF)    → baris sekretariat_berkas, sha256, terkunci=false
(3) Petugas           → POST /sekretariat/surat/:id/terbit          → SATU TRANSAKSI:
                                                                        a. kunci baris penghitung, urut+1
                                                                        b. tulis sekretariat_nomor (nomor_lengkap)
                                                                        c. surat → status 'terbit', nomor_id, terbit_pada
                                                                        d. semua berkasnya → terkunci = true
                                                                        e. audit 'nomor.alokasi'
(x) Koreksi           → POST /sekretariat/surat/:id/batal (alasan)  → nomor berstatus 'dibatalkan', surat 'dibatalkan'; buat surat baru
(y) Surat lama        → POST /sekretariat/penerbit/:id/retroaktif   → status 'terbit', retroaktif=true, nomor_asli apa adanya, penghitung TIDAK tersentuh
```

Sifat yang harus dijaga oleh fitur apa pun yang menyentuh alur ini:

| Sifat | Di mana dijaga |
| --- | --- |
| Nomor hanya lahir saat terbit | `surat.ts:113`; draf tidak pernah memegang nomor |
| Tidak ada celah dan tidak ada nomor ganda | `buku.ts:123` — `INSERT ... ON CONFLICT DO UPDATE SET urut_terakhir = urut_terakhir + 1 RETURNING` dalam transaksi terbit |
| Validasi gagal tidak memakan nomor | Validasi jenis/penerbit dijalankan sebelum penghitung dinaikkan (`buku.ts:110`–`122`) |
| Nomor batal tidak dipakai ulang | `buku.ts:201`; unik `(penerbit_id, jenis_kode, tahun, urut)` dan `nomor_lengkap` (`0021:103`–`106`) |
| Arsip terbit tidak bisa diganti | `surat.ts:199` `authorizeUpload` → `409 berkas_terkunci` |
| Balasan selalu kode 14 dan tertaut dua arah | `surat.ts:74`–`78` (memaksa `jenisKode = "14"`), `kotak.ts` detail membawa `balasan[]` |

### 2.2 Apakah draf AI bisa memakai draf Surat Keluar yang sudah ada

**Bisa, dan memang itu jalan yang paling aman.** `sekretariat_surat_keluar` sudah menjadi wadah draf yang benar: ia memegang penerbit, jenis, perihal, tujuan, penandatangan, status, dan — yang penting — **belum memegang nomor**. Asisten Surat tidak perlu entitas "draf AI" yang berdiri sendiri.

Rancangan yang diusulkan: **satu baris draf, satu sesi asisten, 1:1.**

```text
Staf memilih jenis + penerbit        → POST /sekretariat/penerbit/:id/surat  (draf lahir lebih dulu, tanpa nomor)
Staf menjelaskan konteks             → POST /sekretariat/surat/:id/asisten/mulai
Asisten bertanya data yang kurang    → POST /sekretariat/surat/:id/asisten/jawab   (beberapa putaran)
Asisten menyusun draf isi            → tersimpan sebagai sekretariat_surat_isi (baris baru, 1:1 dengan surat)
Staf menyunting pratinjau            → PUT  /sekretariat/surat/:id/isi
Staf mengunduh .docx                 → GET  /sekretariat/surat/:id/docx           (dirender dari isi tersimpan, tidak disimpan ke disk)
Staf lanjut alur resmi               → unggah PDF final → POST .../terbit (tidak berubah sama sekali)
```

Akibatnya: **tidak ada entitas baru yang bisa tercatat ganda.** Draf tetap satu baris `sekretariat_surat_keluar`; nomor tetap satu baris `sekretariat_nomor` yang lahir hanya di `terbit`; arsip tetap satu PDF terkunci. Asisten Surat tidak pernah memanggil `allocate`.

### 2.3 Data yang bisa dipakai ulang tanpa diketik lagi

| Dipakai ulang dari | Isi | Sumber kode |
| --- | --- | --- |
| `sekretariat_penerbit` | Kode (`GA.YSQ`), nama resmi, kelompok, aktif/berakhir | `GET /sekretariat/penerbit` → `pengaturan.penerbitAktif()` |
| `sekretariat_jenis` | 21 kode + nama + aktif | `GET /sekretariat/jenis` → `buku.jenisList(true)` |
| Organization Directory | Nama, NIP, unit penandatangan dan pihak yang disebut | `KerjaDirectory` (`module.ts:70`); pencarian orang sudah ada di `GET /admin/sekretariat/orang` |
| `sekretariat_surat_masuk` | Pengirim, perihal, `isi_teks`, tanggal diterima, lampiran — untuk "Buat draf balasan" | `kotak.ts:134` `detail` |
| `sekretariat_nomor` | Nomor rujukan surat sebelumnya ke tujuan yang sama | `buku.register` |
| Buku nomor | **Tidak** dipakai oleh asisten. Nomor tetap kosong di draf dan di `.docx` ditulis sebagai `[nomor diisi saat terbit]` | — |

### 2.4 Hubungan .docx hasil unduhan dengan PDF arsip

Ini perlu dinyatakan tegas, karena mudah disalahpahami:

- **`.docx` bukan arsip.** `berkas.ts:111` hanya menerima `application/pdf` untuk pemilik `surat_keluar`; MIME dideteksi dari isi berkas, bukan dari namanya. Unggahan `.docx` dijawab `415 jenis_berkas_ditolak`.
- **`.docx` adalah bahan kerja.** Staf mengunduh, memberi kop/tanda tangan di Word, mencetak atau mengekspor PDF, lalu mengunggah **PDF** itu sebagai arsip. Alur resmi tidak berubah sedikit pun.
- Usulan: **`.docx` dirender saat diminta dan tidak disimpan di `SEKRETARIAT_MEDIA_ROOT`.** Yang tersimpan adalah teksnya (`sekretariat_surat_isi`), yang jauh lebih kecil, bisa disunting, dan tidak menambah beban salinan off-host yang bahkan belum terpasang (§1.5 nomor 3).
- Konsekuensi yang harus diterima: isi `.docx` dan isi PDF arsip **bisa berbeda** bila staf menyunting di Word. Yang mengikat secara resmi tetap PDF yang terkunci saat terbit. `sekretariat_surat_isi` cukup diberi penanda "isi ini dipakai sebagai bahan, bukan sebagai arsip".

### 2.5 Kapan nomor resmi dialokasikan, dan bagaimana menghindari catatan ganda

| Risiko ganda | Penjagaan yang sudah ada | Yang perlu ditambah untuk Asisten Surat |
| --- | --- | --- |
| Draf ganda karena staf menekan "Buat dengan AI" dua kali | — | `sekretariat_surat_isi` unik per `surat_id`; tombol hanya muncul pada draf yang belum punya isi; sesi kedua melanjutkan sesi yang sama |
| Nomor ganda | Transaksi + unik `(penerbit, jenis, tahun, urut)` dan `nomor_lengkap` | Tidak ada tambahan: asisten tidak pernah mengalokasikan nomor |
| Nomor ganda dari konsumen mesin | `buku.ts:152` `allocateForMachine` idempoten per (`rujukan_modul`, `rujukan_id`), index unik `0021:110` | Bila kelak HCIS memakai Asisten Surat, kuncinya tetap `rujukan_id` HCIS, bukan id sesi AI |
| Arsip ganda | Berkas terkunci saat terbit; koreksi = batal + surat baru | `.docx` tidak disimpan, jadi tidak ada berkas kedua yang bisa tertukar dengan arsip |
| Retroaktif bertabrakan dengan deret baru | `retroaktif` tidak menyentuh penghitung (`surat.ts:89`); index unik mengecualikan `sumber = 'migrasi-doc003'` | Asisten Surat **tidak** dipakai untuk retroaktif pada versi pertama |

### 2.6 Integrasi aplikasi lain yang bergantung pada buku nomor

| Konsumen | Keadaan hari ini | Dampak Asisten Surat |
| --- | --- | --- |
| **HCIS** (surat keterangan DOC-001, surat peringatan DOC-002, surat tugas TRIP-001, SK panitia) | Masih memakai bukunya sendiri. `SEKRETARIAT_ALLOWED_MACHINE_CLIENTS` kosong → rute `/internal/sekretariat/v1/alokasi-nomor` tidak didaftarkan. Cutover §14 langkah 8–9 belum jalan | **Berpotongan langsung bila SP = Surat Peringatan** (lihat §3.3). Harus diputuskan sebelum versi pertama ditulis |
| Migrasi DOC-003 | `sumber = 'migrasi-doc003'`, format lama dipertahankan | Tidak tersentuh |
| Ekspor CSV register | `GET /admin/sekretariat/register/export` | Tidak berubah; baris AI tidak punya kolom sendiri karena yang tercatat tetap nomor biasa |
| Rapat SQ, Kerja SQ, Kirim SQ, Aset SQ | Belum tersambung (R2) | Tidak tersentuh |

---

## 3. Pedoman tata naskah, katalog, dan templat

### 3.1 Dokumen mana yang berlaku, dan mana yang masih draf

| Dokumen | Letak | Status sebenarnya |
| --- | --- | --- |
| "Pedoman Tata Naskah Dinas YSQ **v0.11** (draf)" yang dirujuk SEK-001 §8 dan SEK-IMPL-001 | **Tidak ada berkas dengan judul itu di Drive** | Rujukan tanpa berkas yang cocok judulnya |
| "Pedoman Tata Naskah Dinas YSQ **v0.7** — Draf Pembahasan Terintegrasi" (Google Doc, diubah 2026-11-03) | Drive `humancapital.ysq@gmail.com` | **Inilah isi yang dipakai kode**: Pasal 8 = katalog 21 jenis, Pasal 13 = pola nomor, Pasal 14 = nomor setelah pemeriksaan. Judulnya tertinggal di v0.7 |
| "Pedoman Tata Naskah Dinas YSQ - Draf Final" (Google Doc, 2026-10-12) | Drive yang sama | **Bukan** dokumen yang dirujuk: penomoran pasalnya berbeda (Pasal 4 klasifikasi, Pasal 12 nomor naskah) |
| "DRAF - … v0.10 Ringkas.docx" (2026-09-29) dan v0.1–v0.3 | Drive, folder arsip | Bahan kerja lama |
| `lampPERWAL55_2023-PEDOMAN_TATA_NASKAH_DINAS.pdf` | Drive | Pedoman pemerintah kota, bahan banding, bukan aturan yayasan |

**Belum ada satu pun versi yang disahkan.** Pada dokumen v0.7 itu: nomor naskahnya masih `[nomor]`, tabel pengesahan (Dibuat / Diperiksa / Disahkan) **kosong**, dan dua pasalnya menyatakan sendiri bahwa isinya belum berlaku:

- Pasal 8 ayat (2): *"Kode 01 sampai 21 berlaku hanya setelah pedoman revisi disahkan."*
- Pasal 10 ayat (8): *"Templat belum boleh dipakai untuk menerbitkan naskah sebelum pedoman ini disahkan."*

Ini **tidak membatalkan** yang sudah dibangun — owner memang sudah memutuskan 2026-11-12 untuk memakai kaidah penomorannya saja (SEK-001 §13 nomor 1), dan buku nomor sudah hidup di production dengan 21 jenis ter-seed. Tetapi Asisten Surat melangkah lebih jauh: ia akan **menghasilkan bentuk naskah**, bukan sekadar nomor. Di situlah kalimat Pasal 10 ayat (8) menjadi relevan dan perlu keputusan owner (§6, keputusan nomor 2).

Satu lagi: **kutipan pasal di SEK-001 bergeser.** SEK-001 §8 menulis "katalog penerbit Pasal 13 ayat (7)" dan "petugas register per penerbit Pasal 13 ayat (3)". Pada dokumen v0.7, katalog penerbit ada di **Pasal 11 ayat (7)**, dan Pasal 13 hanya punya tiga ayat. Isi katalognya cocok dengan `0021_sekretariat_r1.sql`; yang salah hanya nomor pasalnya.

### 3.2 Arti "SP" di katalog SQ

**Di katalog 21 jenis tidak ada kode bernama "SP".** Kode adalah dua digit, dan tidak satu pun berjudul "SP". Jadi "SP" adalah singkatan percakapan, dan di konteks Sabilul Qur'an ada beberapa calon:

| Calon | Kode katalog | Yang mendukung | Yang melemahkan |
| --- | --- | --- | --- |
| **Surat Peringatan** | **07 Peringatan** | HCIS sudah memakai istilah SP secara harfiah: `SP1`, `SP2`, `SP3` dengan masa berlaku 6 bulan (DOC-002, `hr-documents.md` D-10). Artikel Pusat Bantuan HCIS juga menulis "surat peringatan". Satu-satunya pemakaian "SP" yang benar-benar tercatat di repo | Berpotongan dengan HCIS (§3.3) |
| Surat Pernyataan | 06 Pernyataan | Umum dipakai di yayasan | Tidak muncul sebagai "SP" di dokumen mana pun |
| Surat Permohonan | 10 Permohonan | Volume tinggi di yayasan | Idem |
| Surat Pemberitahuan | 11 Pemberitahuan/Pengumuman | Volume tinggi | Idem |
| Surat Pengantar / Penawaran / Perjanjian | 16 / 15 / 02 | — | Idem |

**DIPUTUSKAN owner 2026-11-25: SP = 07 Peringatan.** Itu juga satu-satunya pembacaan yang punya jejak tertulis di sistem yang ada. Templat, data wajib, dan kewenangan penandatangan yang berlaku karena itu adalah yang diuraikan §3.3.

### 3.3 Kalau SP = 07 Peringatan: templat mana yang berlaku

Dari Pedoman (dokumen v0.7), BAB VI:

- **Bentuk: B-1 *New Official Style*** (Pasal 9 ayat 1: bentuk ini dipakai kode 07, 10, 11, 12, 13, 14, 15, 16).
- **Unsur wajib selain templat induk** (matriks variasi templat korespondensi): **dasar, pelanggaran, tindakan korektif, tenggat, kewenangan.**
- **Tambahan khusus** ("Unsur khusus pada jenis lain"): *"Peringatan 07: unsur pada matriks B serta kesempatan/tata cara tanggapan yang diwajibkan prosedur. Gunakan B-1."*
- **Kerangka B-1** (dari Lembar Contoh Bentuk yang Dapat Disalin): blok metadata `Nomor / Lampiran / Perihal` di kiri dengan `[Kota], [tanggal Masehi]` dan `[tanggal Hijriah]` di kanan → `Yth. [NAMA/JABATAN PENERIMA]` / `di [Tempat]` → basmalah + hamdalah-shalawat → `Dengan hormat,` → paragraf isi → shalawat penutup → `[NAMA BADAN ATAU SATUAN SESUAI KOP]` / `[JABATAN PENANDA TANGAN]` / `[NAMA LENGKAP DAN GELAR]` → `Tembusan:`.
- **Pengetikan** (Pasal 10): A4, margin 2 cm rata, Arial 11 pt (judul maks 12 pt, tabel/metadata boleh 10 pt, tidak boleh di bawah 10 pt), isi rata kiri-kanan, spasi 1,5 dengan jarak 6 pt sebelum/sesudah, **inden baris pertama 1,25 cm** (B-1 memang memakai inden).
- **Kewenangan** (Pasal 21, baris kode 07): penyusun draf **HCM atau satuan**; pemeriksa atasan/pemilik perkara dan dasar prosedural; **penanda tangan: Direktur untuk disiplin pegawai setelah pemeriksaan HCM; kepala satuan untuk peserta didik**; batas: *"Muat fakta, dasar, tindakan korektif, tenggat. Perubahan status/hak pegawai memerlukan instrumen berwenang."*

**Templat `.docx` yang sudah jadi: tidak ada untuk SP.** Di folder Drive "08 Tata Naskah Dinas › 02 TEMPLATE & INSTRUMEN" hanya ada `TEMPLATE - TND-YSQ-F-01 Surat Keputusan.docx`. Jadi bentuk B-1 untuk 07 harus dibangun dari kerangka di atas, bukan diambil dari berkas yang ada.

**Benturan dengan HCIS yang harus diputuskan.** HCIS DOC-002 sudah menerbitkan SP1/SP2/SP3 hari ini, dengan: HC sebagai penerbit (D-09), penandatangan Kepala HCM dengan fallback Direktur (D-05), masa berlaku 6 bulan (D-10), tanda terima pegawai (D-12), pembatalan beralasan dengan izin terpisah (D-14), dan isi yang **tidak** dicetak lewat layar pegawai (D-20 mengecualikan SP). Pedoman menempatkan penanda tangan 07 pada **Direktur**. Dua hal berbeda:

1. siapa yang menandatangani SP pegawai — Kepala HCM (HCIS hari ini) atau Direktur (Pedoman);
2. di aplikasi mana SP pegawai dibuat — HCIS (sudah berjalan, terhubung ke data pegawai, masa berlaku, tanda terima) atau Sekretariat (tempat Asisten Surat akan tinggal).

**Saran:** versi pertama Asisten Surat membuat **SP non-kepegawaian** — peringatan kepada **pihak luar** (mitra, vendor, penyewa, wali) yang diterbitkan GA atau satuan. SP pegawai **tetap di HCIS** dan tidak disentuh. Alasannya: SP pegawai sudah punya rumah yang bekerja dengan data pegawai, masa berlaku, dan tanda terima; memindahkannya adalah proyek tersendiri, bukan fitur AI. Bila owner justru menginginkan SP pegawai, itu menuntut cutover HCIS dulu (§14 langkah 8–9) — bukan pekerjaan versi pertama.

### 3.4 Data wajib: siapa mengisi apa

| Bagian surat | Sumber | Boleh ditulis AI? |
| --- | --- | --- |
| Kop (logo, identitas legal, alamat, kontak) | Pasal 11 ayat (5); belum ada aset kop digital di repo | **Tidak.** Versi pertama: `.docx` tanpa kop, diberi kop oleh staf di Word (lihat §6 keputusan nomor 3) |
| Nomor surat | Buku nomor, hanya saat terbit | **Tidak.** `.docx` menulis `[nomor diisi saat terbit]` |
| Kode jenis & kode penerbit | `sekretariat_jenis`, `sekretariat_penerbit` | **Tidak** — dipilih staf dari daftar, divalidasi server |
| Kota & tanggal Masehi | Server, zona `Asia/Jakarta` (`buku.ts:26` `jakartaParts`) | **Tidak** |
| Tanggal Hijriah | Belum ada sumbernya di sistem | **Tidak.** Dikosongkan `[  ]` pada versi pertama, diisi staf |
| Lampiran (jumlah/nihil) | Isian staf | Tidak |
| Perihal | Isian staf; juga kolom `perihal` di draf | Boleh diusulkan AI, staf menyetujui |
| Yth. penerima + tempat | Isian staf; `tujuan` di draf | Boleh dirapikan AI, tidak boleh dikarang |
| Pembuka/penutup keagamaan | Kerangka B-1, teks tetap | **Tidak** — teks tetap, disalin apa adanya |
| **Dasar** | Isian staf (perjanjian, aturan, surat sebelumnya) | AI **menanyakan**, tidak mengarang; bila staf tak mengisi, bagian ini dikosongkan dengan penanda |
| **Pelanggaran / fakta** | Isian staf, atau kutipan terpilih dari surat masuk | AI menyusun kalimatnya dari fakta yang diberikan; **dilarang menambah fakta** |
| **Tindakan korektif** | Isian staf | AI boleh merumuskan, staf menyetujui |
| **Tenggat** | Isian staf (tanggal) | AI menanyakan; format tanggal oleh server |
| **Kewenangan** | Pasal 21; server menyodorkan kalimat baku menurut jenis + penerbit | **Tidak** — kalimat dari aturan, bukan karangan |
| **Kesempatan/tata cara tanggapan** | Prosedur yang berlaku | AI menanyakan; bila belum ada prosedur tertulis, kalimat baku disiapkan sebagai `DRAFT` |
| Blok tanda tangan (badan/satuan, jabatan, nama+gelar) | Organization Directory + aturan kewenangan Pasal 21 | **Tidak** — dipilih dari daftar |
| Tembusan | Isian staf | Boleh diusulkan AI dari aturan |

Aturan ringkasnya: **AI menulis kalimat, bukan fakta.** Semua yang bisa salah secara hukum — nomor, kode, tanggal, penandatangan, kewenangan — datang dari data atau aturan, bukan dari model.

---

## 4. Batas akses: mode internal, demo publik, dan IMAP kelak

### 4.1 Mode internal (versi pertama)

Rantai pemeriksaan yang sudah ada dan **harus dipakai ulang apa adanya**, bukan ditulis ulang:

```text
sesi cookie sq_sekretariat_session        routes.ts:284
  → Application Access "sekretariat-sq"   routes.ts:290   (tanpa akses: 403)
  → orang aktif di Organization Directory routes.ts:302   (bukan pegawai aktif: 403)
  → loadPeran (admin / penerbitIds / disposisi)  akses.ts:268
  → requirePenerbit untuk draf             akses.ts:285   (penerbit lain: 404)
  → mutasi wajib Origin = publicOrigin     routes.ts:297  (403 origin_forbidden)
```

Rute asisten diletakkan **di dalam helper `write()` yang sama** (`routes.ts:351`) sehingga `Cache-Control: no-store`, pemeriksaan Origin, dan pemetaan galat berlaku otomatis. Tidak ada jalur baru menuju data.

### 4.2 Bagaimana akses satu surat masuk diperiksa

`akses.ts:314` `requireSuratMasuk`:

1. id bukan UUID → 404;
2. surat tidak ada → 404;
3. boleh langsung bila: admin; **atau** kotaknya `yayasan` dan pemohon pemegang disposisi; **atau** kotaknya `penerbit` dan pemohon petugas penerbit itu;
4. kalau tidak: dicek apakah surat itu **pernah didisposisikan** ke salah satu kotak penerbit yang dipegang pemohon (`SELECT ... JOIN sekretariat_kotak ... WHERE k.penerbit_id = ANY($2)`);
5. gagal semua → **404**, bukan 403 — keberadaan surat tidak bocor.

Dipakai juga oleh `surat.ts:76`: membuat balasan atas surat masuk menuntut pemohon memang boleh membaca surat itu. Jadi "Buat draf balasan" sudah punya penjagaannya, dan Asisten Surat tinggal memakai jalur yang sama.

### 4.3 Usulan: memilih kutipan dari satu pesan sebagai konteks

Masalahnya: kalau browser mengirim teks kutipan, server tidak tahu teks itu benar-benar berasal dari surat yang boleh dibaca pemohon. Itu membuka jalan menyuntik teks apa pun ke dalam prompt.

**Usulan: klien hanya mengirim penunjuk, server yang memotong.**

- Di pop-up surat masuk, staf menyorot bagian teks. Klien mengirim `{ surat_masuk_id, awal, panjang }` — **offset di dalam `isi_teks`**, bukan teksnya.
- Server menjalankan `requireSuratMasuk`, membaca `isi_teks` dari database, lalu memotong sendiri: `isi_teks.slice(awal, awal + panjang)`.
- Batas: paling banyak 3 kutipan per draf, masing-masing maksimal 2.000 karakter, total maksimal 4.000 karakter. Offset di luar panjang teks → `400`.
- Kutipan disimpan di `sekretariat_surat_isi.konteks` bersama `surat_masuk_id`-nya, supaya pratinjau dapat menunjukkan "draf ini memakai kutipan dari surat X" dan auditor dapat menelusurinya.
- Lampiran (PDF/gambar) **tidak** ikut ke model pada versi pertama. Menambahkannya berarti mengirim berkas pihak luar ke layanan luar; itu keputusan tersendiri.

### 4.4 Demo publik dengan data fiktif

Ini bagian paling mudah bocor, jadi batasnya harus keras:

| Aturan | Alasan |
| --- | --- |
| Demo **tidak boleh** berbagi rute dengan `/sekretariat/*` | Rute itu seluruhnya di belakang sesi + Application Access; menambah jalur tanpa sesi di sana berarti melubangi `write()`/`get()` yang menjaga semuanya |
| Demo memakai **prefiks sendiri** (`/demo/asisten-surat/*`) dan flag sendiri (`SEKRETARIAT_DEMO_ENABLED`, bawaan `false`) | Pola yang sama dengan `SEKRETARIAT_ENABLED`: mati secara bawaan, mematikan rute sekaligus |
| Demo **tidak menyentuh tabel `sekretariat_*`** sama sekali — tanpa baris draf, tanpa berkas, tanpa audit surat | Supaya tidak ada catatan demo yang bisa tertukar dengan catatan resmi, dan tidak ada jalan menulis ke data yayasan dari halaman tanpa login |
| Katalog demo adalah **fixture tetap di kode**: satu penerbit fiktif (mis. `DEMO.CONTOH`), satu jenis, nama orang fiktif | Nama penerbit asli pada halaman publik sama saja dengan menerbitkan struktur organisasi |
| `.docx` demo **diberi watermark "CONTOH — BUKAN NASKAH RESMI"** dan nomor ditulis `[contoh]` | Supaya berkas demo tidak pernah bisa dipakai sebagai surat |
| Batas pemakaian per IP dan **anggaran token bulanan terpisah** dari anggaran internal | Halaman tanpa login adalah halaman yang bisa dipakai siapa saja |
| Prompt demo identik dengan prompt internal, kecuali data yang disodorkan | Supaya yang didemokan memang fitur yang sama |

**Saran urutan:** bangun mode internal dulu dan jalankan beberapa pekan. Demo publik ditulis sebagai spesifikasi tersendiri setelah itu, bukan di PR yang sama — ia menambah permukaan publik pertama Sekretariat, dan `sekretariat.sabilulquran.or.id` hari ini tidak punya satu pun halaman tanpa login.

### 4.5 IMAP kelak

Tidak ada yang berubah untuk Asisten Surat: ia membaca `sekretariat_surat_masuk.isi_teks` yang **sudah tersimpan**, bukan mailbox. Yang perlu diingat:

- Penarikan tetap baca-saja (SEK-001 §9): modul tidak menghapus, memindahkan, atau menandai email.
- Saat mode `imap` dinyalakan, `isi_teks` akan berisi teks pihak luar sungguhan. Sejak saat itu, kutipan yang dikirim ke Claude adalah **data pihak luar**, dan aturan §4.6 berlaku penuh.
- Ganti sandi mailbox tidak lagi menuntut SSH (SEK-IMPL-002); sandinya tidak pernah dikirim balik ke layar (M-3) dan tidak pernah masuk log, audit, atau pesan galat (M-12). **Audit ini tidak membaca dan tidak menampilkan satu pun nilai rahasia.**

### 4.6 Bagaimana server memanggil Claude API

Pola yang sudah terbukti di repo ada di Karir SQ dan sebaiknya ditiru, bukan ditemukan ulang:

| Hal | Rujukan | Yang dipakai untuk Asisten Surat |
| --- | --- | --- |
| Adapter dua mode | `karir/apps/api/src/config.ts:62` (`AI_MODE: log \| anthropic`), `modules/publication/polisher.ts` (`LogCaptionPolisher` / `ClaudeCaptionPolisher`) | `SEKRETARIAT_AI_MODE` bawaan `log`: tanpa jaringan, menghasilkan draf kerangka dari isian staf. CI dan pengembangan tidak pernah memanggil Claude |
| Kunci di server | `ANTHROPIC_API_KEY` di env Mi8, dibaca saat boot, tidak pernah ke browser | **Dikoreksi di SEK-IMPL-004 A-7:** memakai ulang `ANTHROPIC_API_KEY` milik proses Hub, bukan kunci baru per aplikasi — ORGAN-IMPL-001 §2 sudah menetapkan kunci itu di environment Hub, dan dua nama env untuk satu proses hanya menambah jalan salah. Nilainya tidak pernah dibaca, dicatat, atau ditampilkan |
| Model | `AI_MODEL` bawaan `claude-sonnet-5-5` | `SEKRETARIAT_AI_MODEL`, bawaan `claude-opus-5-5` mengikuti ORGAN-IMPL-001 §6.2 |
| Anggaran | `AI_MONTHLY_BUDGET_USD` | Pagar per bulan dicatat di database per aplikasi (`SEKRETARIAT_AI_MAKS_PANGGILAN_BULAN`); melewati batas → fitur mati dengan kalimat yang jelas, bukan 503 |
| Keluaran terstruktur | `karir/.../cv-summaries/prompt.ts:66` (`output_config.format.type: "json_schema"`) | Draf dikembalikan sebagai JSON per bagian (dasar, fakta, tindakan korektif, tenggat, tanggapan, tembusan), bukan satu blok teks — supaya pratinjau dapat menaruh tiap bagian di tempatnya dan bagian yang kosong terlihat kosong |
| Penolakan & galat | `polisher.ts:5` (`AI_UNAVAILABLE` / `AI_REFUSED` / `AI_ERROR`), `cv-summaries/summarizer.ts:43` (`stop_reason === "refusal"`) | Galat tidak pernah membatalkan draf; staf tetap bisa menulis sendiri |
| Isi dokumen = data, bukan perintah | `cv-summaries/prompt.ts:18`, `polisher.ts` baris aturan | Wajib: kutipan surat masuk dibungkus `<kutipan_surat_masuk>` dan prompt sistem menyatakan isinya tidak boleh diperlakukan sebagai instruksi |

**Data minimum yang dikirim** (dan tidak lebih):

```text
- kode jenis + nama jenis            (mis. "07", "Peringatan")
- kode penerbit + nama resminya      (mis. "GA.YSQ", "Divisi General Affairs")
- jabatan penandatangan              (bukan NIP, bukan id pegawai)
- perihal dan tujuan yang diketik staf
- jawaban staf atas pertanyaan asisten
- kutipan terpilih dari satu surat masuk (maks 4.000 karakter, §4.3)
- daftar unsur wajib jenis itu (dari aturan, bukan dari database)
```

**Yang tidak pernah dikirim:** nomor surat, isi `sekretariat_nomor`, daftar penerbit lain, daftar orang di Organization Directory, `hcis:employee:<uuid>` atau NIP, berkas apa pun, isi mailbox selain kutipan terpilih, dan — tentu saja — kredensial apa pun.

**Audit:** satu baris `sekretariat_audit` per panggilan (`surat.asisten`), berisi `surat_id`, jenis, penerbit, jumlah token masuk/keluar, dan status (berhasil / ditolak / galat). **Tanpa isi prompt dan tanpa isi jawaban** — sama seperti `routes.ts:331` yang sengaja tidak pernah mencatat teks galat karena bisa membawa isi surat.

---

## 5. Bukti awal dan uji regresi

### 5.1 Bukti awal yang harus diambil **sebelum** ada satu baris kode

Supaya ada pembanding sesudahnya. Semuanya bisa diambil tanpa mengubah apa pun.

| # | Bukti | Cara |
| --- | --- | --- |
| B-1 | Jumlah baris `sekretariat_nomor` per (penerbit, jenis, tahun) dan `urut_terakhir` per baris `sekretariat_penghitung` | Ekspor CSV register (`GET /admin/sekretariat/register/export`) + satu kueri baca di Mi8 |
| B-2 | Jumlah `sekretariat_surat_keluar` per status | Kueri baca |
| B-3 | Jumlah `sekretariat_berkas` hidup dan ukuran `SEKRETARIAT_MEDIA_ROOT` | `du` di Mi8 |
| B-4 | Jumlah `sekretariat_surat_masuk` per kotak per status, dan `sekretariat_mail_state` | Kueri baca |
| B-5 | Isi `sekretariat_admins`, `sekretariat_petugas`, `sekretariat_disposisi_pemegang` yang aktif | Layar Pengaturan |
| B-6 | `SEKRETARIAT_MAIL_MODE`, `SEKRETARIAT_ALLOWED_MACHINE_CLIENTS` (ada/tidak, **bukan nilainya**) | Daftar nama env, tanpa nilai rahasia |
| B-7 | RSS proses SQ Hub API dan `MemAvailable` Mi8 | Laporan harian yang sudah ada |
| B-8 | Hasil `npm test` pada `main` hari ini (1.032 baris uji Sekretariat, §5.3) | CI |

### 5.2 Uji regresi: risiko → gejala yang diuji → bukti lulus

| Risiko | Gejala yang harus diuji | Bukti lulus |
| --- | --- | --- |
| Asisten memakan nomor | Membuat draf lewat asisten lalu membatalkannya; ulangi 5 kali | `urut_terakhir` penerbit×jenis×tahun **tidak berubah** sama sekali |
| Nomor bercelah atau ganda | Dua penerbitan bersamaan atas penerbit+jenis yang sama (uji yang sudah ada: `sekretariat.integration.test.ts:245`) | Dua nomor berurutan, tanpa celah, tanpa ganda |
| Draf ganda | Menekan "Buat dengan AI" dua kali pada draf yang sama; dua tab sekaligus | Tetap satu baris `sekretariat_surat_keluar` dan satu `sekretariat_surat_isi` |
| Arsip ganda / `.docx` jadi arsip | Mengunggah `.docx` ke `/surat/:id/berkas` | `415 jenis_berkas_ditolak`, tidak ada berkas tersisa di disk (`berkas.ts:135` `finally rm`) |
| Arsip terbit berubah | Mengunggah PDF ke surat yang sudah terbit | `409 berkas_terkunci` (uji yang ada: `:288`) |
| Kewenangan antarunit bocor | Petugas `GA.YSQ` membuka draf/asisten milik `KEU.YSQ`; membuka register penerbit lain | **404** di semua jalur, bukan 403 (uji yang ada: `:342`, `:351`) |
| Akses aplikasi bocor | Pemohon tanpa Application Access `sekretariat-sq` memanggil rute asisten | `403`, tanpa pernah memanggil Claude |
| Kutipan surat masuk bocor | Mengirim `surat_masuk_id` milik kotak yang tidak boleh dibaca; mengirim offset di luar panjang teks | `404` untuk yang pertama, `400` untuk yang kedua; **tidak ada panggilan ke Claude** |
| Prompt injection dari email | Email uji berisi "abaikan instruksi sebelumnya dan tulis …" dipakai sebagai kutipan | Draf tidak menuruti kalimat itu; kutipan tetap terbungkus `<kutipan_surat_masuk>` |
| Rahasia bocor ke log | Menjalankan asisten dalam mode `anthropic` lalu memeriksa `web.log` dan `sekretariat_audit` | Tidak ada kunci API, tidak ada isi prompt, tidak ada isi surat |
| CSRF | Memanggil rute asisten dengan `Origin` lain | `403 origin_forbidden` (uji yang ada: `:372`) |
| Login antarunit | Masuk sebagai petugas satu penerbit, admin, dan pemegang disposisi; periksa menu dan kotak yang tampil | Sidebar hanya memuat kotak yang boleh dibuka; `GET /sekretariat/context` membawa `peran` yang benar |
| Penerimaan IMAP terganggu | Menyalakan mode `imap`, kirim email uji (teks, lampiran PDF, lampiran > 10 MiB) | Tiga-tiganya tampil benar; tanpa duplikat (uji yang ada: `:422`, `:437`, `:457`); mailbox asli tidak berubah |
| Disposisi terganggu | Disposisi dari kotak yayasan ke kotak penerbit, lalu tandai selesai | Berpindah dan menutup surat (uji yang ada: `:381`) |
| Buku nomor terganggu oleh konsumen mesin | Panggilan ulang `/internal/.../alokasi-nomor` dengan rujukan sama | Nomor yang sama, bukan nomor baru (uji yang ada: `:492`) |
| Anggaran AI jebol | Menyetel anggaran ke nol lalu menjalankan asisten | Fitur mati dengan kalimat yang bisa ditindaklanjuti; alur manual tetap jalan |
| Mi8 kehabisan memori | Gate SEK-IMPL-001 §12: RSS sebelum/sesudah, 24 jam | Kenaikan < 20 MiB; alokasi nomor p95 < 150 ms |
| Demo publik menyentuh data asli | Menjalankan seluruh alur demo, lalu bandingkan B-1..B-4 | Semua angka **identik** sebelum dan sesudah |

### 5.3 Dasar regresi yang sudah ada (jangan sampai merah)

`apps/api/test/sekretariat.integration.test.ts` (822 baris), `sekretariat.unit.test.ts` (92), `sekretariat-mailbox.unit.test.ts` (118), dan `apps/web/src/sekretariat/sekretariat.test.ts` (58). Blok yang relevan: buku nomor (§5), akses berlapis (§8), kotak masuk dan disposisi (§7), penarik email, API alokasi mesin, migrasi DOC-003, audit, SEK-IMPL-002 mailbox, SEK-IMPL-003 pencarian dan pemilih orang.

---

## 6. Keputusan

Nomor 1 diputuskan owner pada 2026-11-25. Nomor 2–7 **belum ditanyakan satu per satu**; sesuai aturan owner 2026-10-26 ("ambil default yang paling masuk akal, catat sebagai asumsi `DRAFT`, jalan terus, dan laporkan asumsinya belakangan"), rancangan ini berjalan di atas default di kolom kanan. Semuanya dapat dibalik owner kapan saja sebelum spesifikasi implementasi ditulis; yang paling mahal untuk dibalik belakangan adalah nomor 4.

| # | Pertanyaan | Pilihan | Keputusan / asumsi |
| --- | --- | --- | --- |
| 1 | **Apa yang dimaksud "SP"?** | (a) 07 Peringatan · (b) 06 Pernyataan · (c) 10 Permohonan · (d) 11 Pemberitahuan | **DIPUTUSKAN owner 2026-11-25: (a) 07 Peringatan.** Templat, unsur wajib, dan kewenangan yang berlaku ada di §3.3 |
| 2 | **Boleh menghasilkan bentuk naskah sebelum Pedoman disahkan?** Pasal 10 ayat (8) melarang templat dipakai menerbitkan naskah sebelum pengesahan | (a) Ya, dengan penanda "draf, mengikuti Pedoman yang belum disahkan" pada `.docx` · (b) Tunggu pengesahan | **`DRAFT` — (a).** `.docx` adalah bahan kerja yang masih disunting dan dicetak staf, bukan naskah terbit; yang mengikat tetap PDF yang diunggah manusia. Penanda dihapus begitu Pedoman disahkan |
| 3 | **Kop di `.docx`?** Belum ada aset kop digital | (a) Tanpa kop, staf menempel di Word · (b) Tunda sampai aset kop ada · (c) Bangun kop sekarang | **`DRAFT` — (a)** untuk versi pertama. Kop seragam memang pekerjaan R3 dan butuh aset (logo, SK Kemenkumham, NPSN) yang belum ada di repo |
| 4 | **SP pegawai atau SP pihak luar?** | (a) Pihak luar saja; SP pegawai tetap di HCIS · (b) SP pegawai sekalian | **`DRAFT` — (a).** (b) menuntut cutover buku DOC-003 (§14 langkah 8–9) lebih dulu dan menyentuh masa berlaku + tanda terima pegawai. **Ini asumsi yang paling menentukan bentuk versi pertama** |
| 5 | **Penandatangan SP:** Pedoman menaruh 07 pada Direktur; HCIS menaruh SP pada Kepala HCM | (a) Ikut Pedoman: Direktur · (b) Ikut HCIS: Kepala HCM | **`DRAFT` — (a) untuk SP pihak luar** (Pedoman Pasal 21). SP pegawai di HCIS tidak diubah, jadi benturannya tidak muncul selama nomor 4 = (a) |
| 6 | **Demo publik: sekarang atau nanti?** | (a) Nanti, spesifikasi tersendiri · (b) Sekarang, satu paket | **`DRAFT` — (a).** Ini halaman tanpa login pertama di `sekretariat.`; layak PR dan review sendiri |
| 7 | **Rujukan Pedoman:** repo menyebut "v0.11", Drive tidak punya berkas berjudul itu (yang isinya cocok berjudul v0.7) | (a) Rapikan judul Drive menjadi versi sebenarnya dan perbaiki kutipan pasal di SEK-001 · (b) Biarkan | **`DRAFT` — (a).** Pekerjaan beberapa menit, dan tanpa itu rujukan kode menunjuk dokumen yang tidak bisa ditemukan. Penggantian judul di Drive adalah milik pemegang akun `humancapital.ysq@gmail.com`, bukan pekerjaan repo |

---

## 7. Ringkasan

**Yang bisa langsung dipakai ulang.** Draf Surat Keluar yang sudah ada (`sekretariat_surat_keluar`, belum bernomor) adalah wadah yang tepat — tidak perlu entitas baru. Rantai akses lengkap sudah ada dan terbukti (sesi → Application Access → Directory → peran penerbit → 404 bukan 403). Katalog 21 jenis dan 17 penerbit sudah ter-seed di production. Pemeriksaan akses satu surat masuk (`requireSuratMasuk`) sudah dipakai `balasan_atas`, jadi "Buat draf balasan" tinggal menumpang. Pola panggilan AI dua mode (`log` / `anthropic`) dengan anggaran bulanan dan keluaran JSON terstruktur sudah terbukti di Karir SQ.

**Titik integrasi yang disarankan.** Satu baris `sekretariat_surat_isi` (1:1 dengan draf), tiga rute di bawah helper `write()` yang sudah ada (`/surat/:id/asisten/*`, `PUT /surat/:id/isi`, `GET /surat/:id/docx`), dan **tidak satu pun sentuhan ke `buku.allocate`**. `.docx` dirender saat diminta dan tidak disimpan; arsip tetap PDF yang diunggah manusia dan dikunci saat terbit.

**Ruang lingkup versi pertama.** Satu jenis: **07 Peringatan** (diputuskan owner 2026-11-25) untuk pihak luar, bentuk B-1, penerbit yang dipegang staf, mode internal saja, tanpa kop, tanpa demo publik, tanpa SP pegawai. "Buat draf balasan" dari satu email menyusul setelah mode `imap` hidup.

**Keadaan keputusan.** Nomor 1 sudah dikunci. Nomor 2–7 berjalan di atas default `DRAFT` (§6) dan dapat dibalik owner kapan saja sebelum spesifikasi implementasi ditulis. Satu yang berbiaya besar bila dibalik belakangan: nomor 4 (SP pihak luar vs SP pegawai), karena (b) menuntut cutover buku DOC-003 lebih dulu.

### Skenario: staf GA dari konteks sampai `.docx`

1. Staf GA masuk ke `sekretariat.sabilulquran.or.id` dengan Akun SQ. Ia petugas penerbit `GA.YSQ`, jadi sidebar memuat kotak GA dan menu **Surat keluar** (`SekretariatShell.tsx:134`).
2. **Surat keluar → GA.YSQ → Surat baru.** Ia memilih jenis **07 Peringatan**, mengetik perihal dan tujuan, memilih penandatangan. Draf tersimpan tanpa nomor (`surat.ts:68`).
3. Di halaman draf muncul **Buat dengan AI**. Ia menjelaskan konteks: "vendor katering terlambat tiga kali bulan ini, kontraknya nomor 02.004/GA.YSQ/VIII/2026".
4. Asisten bertanya apa yang masih kurang menurut unsur wajib 07: tanggal-tanggal keterlambatan, tindakan korektif yang diminta, tenggat, dan cara vendor menanggapi. Staf menjawab di layar.
5. Asisten mengembalikan draf per bagian (dasar / fakta / tindakan korektif / tenggat / tanggapan / tembusan). **Pratinjau** menampilkannya dalam kerangka B-1: blok `Nomor | Lampiran | Perihal` dengan `[nomor diisi saat terbit]`, `Yth.`, basmalah, isi berinden, shalawat penutup, blok tanda tangan, tembusan.
6. Staf menyunting langsung di pratinjau — mengubah kalimat, menghapus satu paragraf. Simpan (`PUT /surat/:id/isi`).
7. **Unduh .docx** — A4, margin 2 cm, Arial 11, spasi 1,5, inden 1,25 cm, tanpa kop, bertanda "draf".
8. Di Word ia menempelkan kop GA, mencetak untuk ditandatangani, lalu memindai hasilnya menjadi PDF.
9. Kembali ke Sekretariat: **Unggah PDF** ke draf yang sama, lalu **Terbitkan (ambil nomor)**. Nomor `07.002/GA.YSQ/XI/2026` lahir saat itu juga, PDF terkunci, baris audit `nomor.alokasi` tertulis. Draf AI tidak pernah menyentuh penghitung.

### Rujukan kode utama

| Hal | Berkas |
| --- | --- |
| Rute dan penjaga akses | `hub/apps/api/src/modules/sekretariat/routes.ts` (`:280` registrasi, `:295` viewer, `:351` write, `:437`–`:447` surat & buku) |
| Peran dan akses berlapis | `hub/apps/api/src/modules/sekretariat/akses.ts` (`:268`, `:285`, `:297`, `:314`) |
| Surat keluar | `hub/apps/api/src/modules/sekretariat/surat.ts` (`:68` create, `:113` terbitkan, `:141` batalkan, `:199` authorizeUpload) |
| Buku nomor | `hub/apps/api/src/modules/sekretariat/buku.ts` (`:26` jakartaParts, `:44` nomorLengkap, `:98` allocate, `:152` allocateForMachine, `:201` void) |
| Kotak masuk | `hub/apps/api/src/modules/sekretariat/kotak.ts` (`:72` isi, `:134` detail, `:179` disposisi) |
| Berkas | `hub/apps/api/src/modules/sekretariat/berkas.ts` (`:76` store, `:110` deteksi MIME) |
| Rute mesin | `hub/apps/api/src/modules/sekretariat/routes-internal.ts` (`:392`) |
| Konfigurasi & flag | `hub/apps/api/src/modules/sekretariat/config.ts` |
| Skema & seed | `hub/apps/api/migrations/0021_sekretariat_r1.sql` (`:257` jenis, `:267` penerbit) |
| Layar surat keluar | `hub/apps/web/src/sekretariat/SuratPages.tsx`, `SekretariatShell.tsx` |
| Pola AI yang ditiru | `karir/apps/api/src/modules/publication/polisher.ts`, `karir/apps/api/src/modules/cv-summaries/{prompt,summarizer}.ts`, `karir/apps/api/src/config.ts:62` |
