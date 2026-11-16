# Struktur SQ Suite (STRUKTUR-001)

**Status:** ACCEPTED oleh Product Owner pada 2026-11-16 (ADR-0014). Butir bertanda `DRAFT` adalah default agent yang menunggu konfirmasi.
**Kondisi per:** 2026-11-16 (alamat dan rilis diperiksa langsung di server hari itu; lihat §10).
**Keputusan:** [ADR-0014](../architecture/adr/0014-sq-suite-ecosystem-structure.md).

Dokumen ini adalah **satu-satunya sumber** untuk pertanyaan "apa saja isi SQ Suite, untuk siapa, dan bagaimana keadaannya". Dokumen lain menautkan ke sini dan tidak menyimpan daftar sendiri. Setiap rilis yang mengubah status sebuah aplikasi memperbarui §5.

## 1. Istilah

| Istilah | Arti | Contoh |
| --- | --- | --- |
| **SQ Suite** | Seluruh ekosistem aplikasi Yayasan Sabilul Qur'an: aplikasi-aplikasi terpisah yang dirancang untuk dipakai bersama | — |
| **SQ Hub** | Halaman awal dan peluncur aplikasi di `hub.sabilulquran.or.id`; bukan nama keseluruhan | — |
| **Portal** | Pintu masuk untuk satu kelompok pengguna, dengan jenis akunnya | Portal Pegawai, Portal Organ |
| **Aplikasi** | Sistem yang mengurus satu bidang dan memegang data serta aturannya | HCIS, Aset SQ, Karir SQ |
| **Modul** | Bagian di dalam satu aplikasi | Cuti dan Payroll di dalam HCIS |
| **Wajah** | Cara satu aplikasi tampil di satu portal (§3) | Wajah Laporan Karir SQ di Portal Organ |

"SQ Core" adalah istilah lama untuk SQ Suite dan tidak dipakai lagi, kecuali pada nama teknis (§8) dan catatan lama.

## 2. Portal

| Portal | Pengguna | Akun | Alamat |
| --- | --- | --- | --- |
| **Portal Admin** | Admin akun, akses, dan peran | Akun staf dengan peran admin | `hub.sabilulquran.or.id` (Pusat Admin) |
| **Portal Pegawai** | Pegawai | Akun staf | `hub.sabilulquran.or.id` (SQ Hub), lalu alamat tiap aplikasi |
| **Portal Organ** | Pembina, Pengurus, Pengawas | Keanggotaan organ pada akun realm staf | `organ.sabilulquran.or.id` |
| **Portal Keluarga** (Keluarga SQ) | Orang tua dan wali | Akun keluarga | `keluarga.sabilulquran.or.id` |
| **Portal Pelamar** | Pelamar kerja | Akun pelamar | `karir.sabilulquran.or.id` |
| **Situs publik** | Siapa saja | Tanpa login | `sabilulquran.or.id` dan halaman publik aplikasi |

- Setiap portal punya satu **aplikasi beranda**, yang pertama dibuka penggunanya: Admin SQ (Portal Admin), SQ Hub (Portal Pegawai), aplikasi Portal Organ (Portal Organ), Keluarga SQ (Portal Keluarga), dan sisi pelamar Karir SQ (Portal Pelamar). Aplikasi lain menampilkan wajahnya di dalam portal itu.
- Portal Admin berdiri sendiri karena mengatur akses ke semua portal lain. Saat ini ia masih satu alamat dengan SQ Hub; pemisahan alamat adalah target (§7).
- Pengurus yang juga pegawai bergaji memakai Portal Organ untuk perannya sebagai organ dan Portal Pegawai untuk urusan kepegawaiannya sendiri.
- Login semua portal lewat `login.sabilulquran.or.id`.

## 3. Empat wajah aplikasi

| Wajah | Untuk siapa | Tampil di |
| --- | --- | --- |
| **Kelola** | Pegawai yang berwenang mengoperasikan aplikasinya | Portal Pegawai |
| **Layanan mandiri** | Orang yang datanya diurus (pegawai, keluarga, pelamar) | Portal orang itu |
| **Laporan** | Organ yayasan: ringkasan dan keputusan yang menjadi wewenangnya | Portal Organ |
| **Publik** | Siapa saja, tanpa login | Situs publik |

Aturan:
1. Setiap aplikasi yang memegang data yayasan **wajib** punya wajah Laporan. Organ tidak pernah mengoperasikan aplikasi. Dikecualikan: aplikasi yang tidak punya hal untuk diawasi organ, yaitu aplikasi beranda portal (hanya menampilkan data aplikasi lain), Kirim SQ (layanan kirim; yang melapor adalah aplikasi pengirimnya), Akun SQ dan Admin SQ, serta Al-Qur'an (bacaan pribadi).
2. Wajah Kelola hanya untuk pegawai yang diberi wewenang.
3. Datanya tetap satu. Wajah hanya cara menampilkan.

## 4. Matriks aplikasi × portal

Target. Kolom "Status" dan "Wajah Laporan" di §5.2 menunjukkan mana yang sudah berjalan. Portal Admin tidak punya kolom: ia tidak menampilkan wajah aplikasi, melainkan mengatur siapa mendapat wajah yang mana.

| Aplikasi | Portal Pegawai | Portal Organ | Portal Keluarga | Portal Pelamar | Publik |
| --- | --- | --- | --- | --- | --- |
| HCIS | Layanan mandiri semua pegawai; Kelola oleh HC | Ringkasan SDM, daftar pegawai, persetujuan cuti | — | — | — |
| Aset SQ | "Aset Saya"; Kelola oleh petugas aset | Ringkasan aset | — | — | — |
| Karir SQ | Kelola oleh panitia; persetujuan kebutuhan tenaga | Ringkasan rekrutmen, keputusan MPP | — | Melamar, pantau status | Daftar lowongan |
| SPMB SQ | Kelola oleh panitia | Ringkasan pendaftaran | Mendaftar, bayar, lihat hasil | — | Info pendaftaran |
| Sekolah | Kelola oleh guru dan tata usaha | Laporan akademik | Kehadiran, hafalan, rapor anak | — | — |
| Keuangan | Kelola oleh petugas keuangan | Laporan keuangan | Tagihan dan pembayaran | — | — |
| Sosial & Dakwah | Kelola oleh tim sosial | Laporan donasi dan beasiswa | — | — | Donasi, info beasiswa |
| Sekretariat SQ | Surat dan arsip | Ringkasan surat dan SK `DRAFT` | — | — | Cek keaslian surat |
| Rapat SQ | Rapat dan notulen | Daftar keputusan rapat `DRAFT` | — | — | — |
| Kerja SQ | Papan kerja | Pekerjaan lewat tenggat `DRAFT` | — | — | — |
| Al-Qur'an | Mushaf, papan tilawah | — | Mushaf (nanti) | — | — |
| Kirim SQ | Kelola oleh petugas berwenang | — | — | — | — |
| Keluarga SQ | Kelola data keluarga oleh petugas berwenang | Jumlah keluarga dan siswa `DRAFT` | Beranda keluarga, Kartu Siswa | — | Cek keaslian Kartu Siswa |
| Akun SQ | Ada | Ada | Ada | Ada | — |

## 5. Daftar aplikasi

Status: **Jalan** (dipakai di production) · **Terpasang** (di production, belum dibuka ke penggunanya) · **Dibangun** (kode ada, belum dinyalakan) · **Disetujui** (spesifikasi/ADR disetujui, belum dibangun) · **Rancangan** · **Disebut** (baru disebut di dokumen).

### 5.1 Bagian platform (repo `SQ-Hub`)

| Nama | Isi | Alamat | Status |
| --- | --- | --- | --- |
| SQ Hub | Halaman awal dan peluncur aplikasi | `hub.` | Jalan |
| Akun SQ | Login, SSO, MFA, kelola akun sendiri (Keycloak) | `login.`, `hub.` | Jalan |
| Admin SQ (Pusat Admin) | Daftar aplikasi, Application Access, peran, siklus akun pegawai | `hub.` | Jalan; siklus akun belum lengkap |
| Direktori Organisasi | Salinan baca struktur organisasi dari HCIS untuk aplikasi lain | — | Jalan |
| Bilah atas bersama | Tanda SQ, nama aplikasi, peluncur, menu akun di semua aplikasi | — | Target (§7); peluncur sudah ada di HCIS, Aset SQ, Karir SQ, SPMB SQ |

### 5.2 Aplikasi

| Aplikasi | Bidang | Alamat | Repo | Jalan di | Status | Wajah Laporan |
| --- | --- | --- | --- | --- | --- | --- |
| HCIS | Kepegawaian | `hcis.` (mesin presensi: `adms.`) | `hcisysq` | Program sendiri | Terpasang; belum dibuka ke pegawai | Ada |
| Aset SQ | Aset dan serah terima | `aset.` | `Aset-SQ` | Program sendiri | Jalan | Ada |
| Karir SQ | Rekrutmen | `karir.` | `karir-sq` | Program sendiri | Jalan | Ada (kartu belum dicek di portal) |
| SPMB SQ | Penerimaan murid baru, termasuk aplikasi CS Android | `spmb.` | `spmb-sq` | Program sendiri | Jalan untuk panitia (peminat, kotak masuk WhatsApp); pendaftaran keluarga terpasang, pembukaannya `TBD` (catatan ops terakhir, 26 Okt 2026: belum dibuka) | Belum |
| Keluarga SQ | Portal keluarga: akun, Kartu Siswa | `keluarga.` | `keluarga-sq` | Program sendiri | Terpasang (akun keluarga, Kartu Siswa); pembukaan ke keluarga `TBD`; KEL-IMPL-004 masih rancangan | Belum |
| Kirim SQ | Kirim WhatsApp resmi untuk semua aplikasi | `kirim.` | `SQ-Hub` | Proses Hub (alasan 1) | Jalan | Tidak perlu |
| Portal Organ | Aplikasi beranda Portal Organ: ringkasan, keputusan, laporan | `organ.` | `SQ-Hub` | Proses Hub (alasan 2) | Ringkasan jalan; keputusan dan laporan bulanan belum | Tidak perlu |
| Kerja SQ | Papan kerja unit dan kepanitiaan | `kerja.` | `SQ-Hub` | Proses Hub (alasan 3, kompromi) | Jalan (tahap 1) | Belum |
| Sekretariat SQ | Nomor surat, surat masuk, arsip SK | `sekretariat.` | `SQ-Hub` | Proses Hub (alasan 3, kompromi) | Dibangun; belum dinyalakan | Belum |
| Al-Qur'an | Mushaf Madinah dan papan tilawah | `quran.` | `SQ-Hub` | Proses Hub (alasan 3, kompromi) | Disetujui (ADR-0013) | Tidak perlu |
| Rapat SQ | Rapat, notulen, daftar keputusan | belum ada | `SQ-Hub` | Proses Hub (alasan 3, kompromi) | Rancangan | Belum |
| Keuangan | Tagihan, SPP, kas/bank, anggaran | `keuangan.` | usulan `sq-keuangan` | Program sendiri | Rancangan (KEU-001) | Belum |
| Sosial & Dakwah | Donasi, beasiswa OTA, bantuan, beranda publik | `sosialdakwah.` | usulan `sq-sosial` | Program sendiri | Rancangan (SOS-001) | Belum |
| Sekolah | Siswa, kelas, rapor, tahfizh, asrama | belum ada | belum ada | Program sendiri | Disebut | Belum |

"Alasan 1–3" merujuk ADR-0014 D6. Aplikasi beralasan 3 pindah ke program sendiri bila memori server memungkinkan atau datanya makin sensitif.

### 5.3 Modul di dalam HCIS

Presensi (ATT) · Cuti dan mesin persetujuan (LEAVE, APR) · Payroll (PAY) · Reimbursement dan pinjaman (REIMB, LOAN) · Kinerja (PERF) · Pelatihan (TRAIN) · Penghargaan (REWARD) · Administrasi kepegawaian (EMP) · Dokumen HR (DOC) · Perjalanan dinas (TRIP) · Aset pegawai (ASSET) · Notifikasi dan pengumuman (NOTIF) · Struktur organisasi (ORG) · Laporan (RPT) · Pusat bantuan (HELP). Rinciannya ada di `docs/product/hcis-capability-map.md` pada repo HCIS.

## 6. Di luar SQ Suite

| Sistem | Keadaan | Rencana |
| --- | --- | --- |
| Website `sabilulquran.or.id` (WordPress) | Jalan; dikelola tim publikasi; sedang dipindah hosting | Tetap sebagai situs publik; aplikasi SQ Suite menyediakan halaman publiknya sendiri |
| Email yayasan | Sedang direncanakan pindah layanan | Di luar SQ Suite |
| Payroll Tools (Google Apps Script) | Alat lama, masih dipakai | Digantikan Payroll HCIS setelah parallel run lulus |
| Presensi QR (`absensi-temp`) | **Tidak dipakai** (Product Owner, 2026-11-16) | Tidak dilanjutkan; presensi resmi ada di HCIS |
| JalurPesan | Mesin WhatsApp di belakang Kirim SQ; proyek terpisah | Tetap terpisah |
| SIPAYA, Ruang Hadir | Dipensiunkan dan dicopot dari server 2026-11-16 | — |

## 7. Target yang belum dibangun

Ini pekerjaan tersendiri, bukan bagian dari perapian dokumen ini:

1. **Bilah atas bersama** di semua aplikasi: tanda SQ, nama aplikasi, peluncur, menu akun.
2. **Satu konsol peran** di Admin SQ. Saat ini akses aplikasi diatur di Admin SQ, tetapi peran diatur di tiap aplikasi (HCIS, Karir SQ, Aset SQ).
3. **Alamat sendiri untuk Portal Admin**, terpisah dari SQ Hub.
4. **Standar tampilan** yang wajib di semua aplikasi.
5. **Wajah Laporan** untuk SPMB SQ, Sekretariat SQ, Kerja SQ, dan Keluarga SQ.

Urutan prioritas yang disarankan sesudah perapian (`DRAFT`): membuka HCIS ke pegawai, lalu Keuangan, lalu pindah server. Rapat SQ, Al-Qur'an, dan Sosial & Dakwah ditahan sampai itu berjalan.

## 8. Nama teknis yang tidak berubah

Repo `sq-core-ops`, nama skrip dan berkas di server (`sq-core-launch.sh`, `sq-core-worker.sh`), nama database (`sqcore_*`), client ID Keycloak, dan ID spesifikasi tetap seperti sekarang (ADR-0014 D7).

## 9. Aturan menambah aplikasi

1. Tentukan bidang dan pemilik datanya. Bila bidang itu sudah dimiliki aplikasi lain, ia menjadi modul di aplikasi tersebut, bukan aplikasi baru.
2. Isi barisnya di matriks §4: portal mana, wajah apa.
3. Tentukan tempat jalannya menurut ADR-0014 D6 dan catat alasannya.
4. Beri nama menurut pola "<Nama> SQ" (ADR-0014 D9).
5. Tambahkan barisnya di §5.2 dengan status **Rancangan**, baru kemudian tulis rancangannya.

## 10. Cara memeriksa kondisi

- Alamat: `curl -s -o /dev/null -w '%{http_code}' https://<nama>.sabilulquran.or.id/`.
- Rilis yang berjalan: `cwd` proses di Mi8 (`/srv/<aplikasi>/releases/...`), bukan isi repo.
- Aplikasi di proses Hub: flag `*_ENABLED` pada `final.env` platform SQ Hub.

Pemeriksaan 2026-11-16: `hub`, `organ`, `kirim`, `kerja`, `sekretariat`, `hcis`, `aset`, `karir`, `spmb`, `keluarga` menjawab 200; `login` 302; `quran` dan `keuangan` 421 (belum dilayani); `sosialdakwah` dan `rapat` belum punya DNS. Flag Hub yang menyala: `KIRIM_ENABLED`, `KERJA_ENABLED`, `PORTAL_ORGAN_ENABLED`.
