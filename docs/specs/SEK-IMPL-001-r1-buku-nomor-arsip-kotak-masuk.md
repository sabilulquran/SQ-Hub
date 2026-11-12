# SEK-IMPL-001 — Sekretariat R1: buku nomor, arsip surat, kotak masuk

**Status:** DRAFT (usulan, 2026-11-12). Belum diterima Product Owner; tidak mengizinkan implementasi. Keputusan usulan di §16.
**Produk:** SQ Hub — modul `sekretariat` (Sekretariat)
**Owner produk:** Kepala HCM (`sekretariat_admin`, SEK-001 §13 nomor 2)
**Tanggal:** 2026-11-12 (DRAFT)
**Depends on:**
- [SEK-001](../product/sekretariat-module-design.md) revisi 5 — seluruh keputusan §13 sudah ditetapkan owner
- **Pedoman Tata Naskah Dinas YSQ v0.11 (draf)** Pasal 8 dan 13–14 — kaidah penomoran (hanya itu yang diadopsi)
- HCIS `docs/domain/outgoing-letter-register.md` (DOC-003) — model buku dan data yang dimigrasikan
- ADR-0011 (pola modul di dalam Hub), ADR-0001, ADR-0003 (Keycloak), ADR-0006 (stack), ADR-0007 (Organization Directory)
- HUB-IMPL-002 / HUB-IMPL-009 (Application Registry dan Application Access), HUB-IMPL-022 (launcher)
- [KERJA-IMPL-001](KERJA-IMPL-001-r1-papan-kerja.md) dan [KIRIM-IMPL-001](KIRIM-IMPL-001-r1-nomor-dan-kirim.md) sebagai preseden bentuk modul, login host sendiri, CLI peran, dan gate Mi8

**Pemakai pertama:** petugas register per penerbit (pedoman Pasal 13 ayat 3) — Sekretariat Pengurus, petugas divisi, tata usaha satuan — ditambah Direktur (disposisi) dan Kepala HCM (admin). Orangnya sebagian besar sudah ada di gelombang pertama Kerja SQ. Konsumen mesin pertama: **HCIS**, setelah cutover (§14).

## 1. Tujuan dan batas rilis

R1 memindahkan buku nomor surat yayasan ke rumahnya dan menambahkan dua hal yang belum pernah ada: arsip berkas surat dan kotak masuk.

R1 berisi:

1. **Buku nomor surat** milik Sekretariat: jenis (21 kode dua digit pedoman), penerbit (katalog tetap pedoman), hak ambil nomor per orang per penerbit, penghitung per penerbit × jenis × tahun, alokasi tanpa celah, pembatalan beralasan, nomor awal yang hanya menaikkan.
2. **Migrasi data DOC-003** dari HCIS: jenis, penerbit, grant, penghitung, dan seluruh nomor teralokasi — sekali, satu arah, diverifikasi (§14).
3. **API alokasi internal** untuk konsumen mesin (HCIS), fail-closed, dengan identitas layanan.
4. **Surat keluar + arsip PDF**: entri surat, ambil nomor saat terbit, unggah PDF final dengan checksum; register retroaktif untuk surat lama dengan nomor aslinya.
5. **Kotak masuk**: email `sekretariat@sabilulquran.or.id` ditarik lewat IMAP baca-saja + pindaian surat fisik; kotak yayasan dan kotak per penerbit; disposisi in-app dengan tenggat; penanda spam; tautan surat masuk ↔ balasan (kode 14).
6. **Akses berlapis** (SEK-001 §7): admin akses penuh; petugas hanya kotak masuk, register, dan arsip penerbitnya; pemberi disposisi melihat kotak yayasan.
7. **Akses:** login lewat client OIDC `sekretariat-sq`, dibatasi Application Access `sekretariat-sq`; peran admin di tabel modul.

Di luar R1 (SEK-001 §11):

- register SK + tautan Rapat SQ, arsip dokumen legal + pengingat kedaluwarsa, disposisi → kartu Kerja SQ, notifikasi Kirim SQ, halaman verifikasi QR publik, kirim email dari modul — **R2**;
- surat dirender dari templat, kop seragam — **R3**;
- tanda tangan elektronik bersertifikat, rantai approval surat, pemindaian massal arsip lama, master organisasi kedua, klien email penuh — **tidak dibangun** (SEK-001 §2).

## 2. Keputusan teknis

| Topik | Keputusan | Alasan / sumber |
| --- | --- | --- |
| Letak kode | `apps/api/src/modules/sekretariat/` dan layar di `apps/web/src/sekretariat/` | ADR-0011; pola kirim/kerja |
| Proses | **Tidak ada proses baru.** Penarik email berjalan sebagai timer di proses SQ Hub API (3302 Mi8) | SEK-001 §3; memori Mi8 |
| Stack | ADR-0006. Dependensi baru: **`imapflow`** (klien IMAP) dan **`mailparser`** (baca MIME) — keduanya murni Node tanpa binary native | Penarik email §7 |
| Database | Tabel berawalan `sekretariat_`, migration `0020_sekretariat_r1.sql` (setelah `0019_kerja_r1.sql`) | ADR-0011 |
| Rute | `/api/sekretariat/*` (sesi `sekretariat-sq`), `/api/admin/sekretariat/*` (admin), `/internal/sekretariat/*` untuk konsumen mesin — **diblokir di edge**, hanya terjangkau dari dalam Mi8 | Pola KERJA-IMPL-001 |
| Hostname | `sekretariat.sabilulquran.or.id` → edge 3180 → web 3202 / API 3302 | SEK-001 §3; DNS NXDOMAIN, dibuat saat rilis |
| Login | Client OIDC `sekretariat-sq` (realm `sq-staff`, confidential, PKCE S256), cookie host-only `sq_sekretariat_session`, memakai ulang hub-auth — pola `kirim-sq`/`kerja-sq` | AGENTS.md §5 |
| Konsumen mesin | Client Keycloak `hcis-sekretariat` (client credentials) untuk HCIS; daftar client yang diizinkan di env, pola `STAFF_ACTIVATION_ALLOWED_CLIENTS` HUB-IMPL-024 | §14; machine call pakai identitas layanan |
| Identitas orang | `person_id` Organization Directory, tanpa tabel pengguna; nama hanya cache tampilan | Pola Kerja SQ |
| Penomoran | Pola pedoman Pasal 13: `[kode jenis].[urut]/[kode penerbit]/[bulan Romawi]/[tahun]`; urut 3 digit mulai 001 (>999 lanjut 1000), per jenis per penerbit, reset 1 Januari `Asia/Jakarta`; tanpa tanggal mundur | SEK-001 §8 (DIPUTUSKAN) |
| Alokasi | Penghitung naik + baris register tertulis **dalam satu transaksi**, kunci baris penghitung; gagal = transaksi batal, nomor tidak bocor | DOC-003 D-05 (ACCEPTED, dipertahankan) |
| Berkas | PDF surat, pindaian, dan lampiran email di `SEKRETARIAT_MEDIA_ROOT` (`/srv/sq-hub/sekretariat-media`, 0700 `sqhub`); baris menyimpan kunci UUID + checksum SHA-256, bukan jalur/nama asli | Pola Karir/Kerja |
| Salinan off-host | `sq-core-sekretariat-media-offhost`: `rclone copy --immutable` ke remote crypt sendiri + `cryptcheck --one-way`, harian | Pola KERJA-IMPL-001 §9 |
| Email | Port `MailFetcher` dengan dua adapter: `imap` (imapflow, baca-saja: tanpa hapus, tanpa pindah, tanpa tandai) dan `log` (pengembangan). Kemajuan dicatat per mailbox lewat UIDVALIDITY + UID terakhir | SEK-001 §4; pola engine Kirim SQ |
| Zona waktu | Simpan `timestamptz` UTC; penghitung tahun dan tampilan `Asia/Jakarta` | DOC-003; pedoman |
| Web | Bundle `apps/web` sama; `location.host` berawalan `sekretariat.` memuat shell Sekretariat | Tanpa proses web baru |

## 3. Arsitektur

```text
Petugas / Direktur / Admin ── https://sekretariat.sabilulquran.or.id
                               │
                            Tunnel ── edge 3180 ── web 3202 / API 3302
                                                   (/internal/* → 404 di edge)
                               ▼
SQ Hub API (3302) ─ modul sekretariat
   ├─ routes-app      : /api/sekretariat/*      (sesi + Application Access sekretariat-sq)
   ├─ routes-admin    : /api/admin/sekretariat/* (tambahan: sekretariat_admins aktif)
   ├─ routes-internal : /internal/sekretariat/v1/alokasi-nomor  (client credentials, §14)
   ├─ buku.ts         : jenis, penerbit, petugas (grant), penghitung, alokasi, batal, nomor awal
   ├─ surat.ts        : surat keluar, arsip PDF, retroaktif, tautan balasan
   ├─ kotak.ts        : kotak yayasan/penerbit, surat masuk, disposisi, spam
   ├─ mail/           : port MailFetcher + adapter imap (imapflow) dan log; timer penarik
   ├─ berkas.ts       : simpan/ambil berkas (checksum, batas 10 MiB), kuota
   └─ audit.ts        : sekretariat_audit

HCIS (3301, host yang sama) ── POST /internal/sekretariat/v1/alokasi-nomor  (setelah cutover §14)

cron Mi8 ── sq-core-sekretariat-media-offhost : rclone copy --immutable → crypt → Drive yayasan
```

## 4. Data

| Tabel | Isi utama |
| --- | --- |
| `sekretariat_jenis` | `kode` (dua digit, PK), `nama`, `aktif`, `urutan`. Diisi migration dengan 21 jenis pedoman Pasal 8. Jenis warisan DOC-003 (kode berhuruf) masuk sebagai baris `aktif = false` khusus data migrasi |
| `sekretariat_penerbit` | `id`, `kode` (unik, mis. `PENG.YSQ`, `SDITTSQ`, `PAN.MILAD`), `nama`, `kelompok` (`organ`/`direktorat`/`bidang`/`divisi`/`satuan`/`panitia`), `unit_id` (Directory, opsional untuk akses), `berakhir_pada` (wajib untuk `panitia`), `aktif`. Kode tidak dapat diubah; nonaktif, bukan hapus |
| `sekretariat_petugas` | `person_id` × `penerbit_id`, `alasan`, `diberikan_oleh/_pada`, `dicabut_oleh/_pada`. Satu baris aktif per pasangan. = "hak ambil nomor" DOC-003 sekaligus akses kotak/arsip penerbit |
| `sekretariat_penghitung` | (`penerbit_id`, `jenis_kode`, `tahun`) PK → `urut_terakhir`. Nomor awal hanya menaikkan |
| `sekretariat_nomor` | `id`, `penerbit_id`, `jenis_kode`, `tahun`, `urut`, `nomor_lengkap` (unik), `tanggal` (Jakarta), `perihal`, `tujuan`, `status` (`terpakai`/`dibatalkan`), `dibatalkan_*` + alasan, `sumber` (`sekretariat`/`hcis`/`migrasi-doc003`/`retroaktif`), `rujukan_modul`/`rujukan_id` (untuk konsumen mesin), `diambil_oleh` |
| `sekretariat_surat_keluar` | `id`, `nomor_id` (null untuk draf), `penerbit_id`, `jenis_kode`, `perihal`, `tujuan`, `penandatangan` (person_id atau teks organ), `status` (`draf`/`terbit`/`dibatalkan`), `retroaktif` boolean + `nomor_asli`, `balasan_atas` (→ `sekretariat_surat_masuk.id`), `dibuat_oleh/_pada`, `terbit_pada` |
| `sekretariat_berkas` | `pemilik_jenis` (`surat_keluar`/`surat_masuk`/`lampiran_email`), `pemilik_id`, `nama_tampil`, `kunci`, `mime`, `ukuran`, `sha256`, `diunggah_oleh/_pada`. Berkas surat terbit **terkunci** — tidak bisa diganti, hanya surat baru |
| `sekretariat_kotak` | `id`, `jenis` (`yayasan`/`penerbit`), `penerbit_id` (null untuk yayasan). Satu kotak yayasan + satu per penerbit aktif |
| `sekretariat_surat_masuk` | `id`, `kotak_id`, `kanal` (`email`/`fisik`), `dari`, `perihal`, `ringkasan`/`isi_teks`, `diterima_pada`, `status` (`baru`/`didisposisi`/`selesai`/`spam`), `email_message_id`/`email_uid` (unik per mailbox, anti-duplikat), `dicatat_oleh` (null untuk email) |
| `sekretariat_disposisi` | `surat_masuk_id`, `ke_kotak_id`, `catatan`, `tenggat_pada`, `oleh`, `pada`, `selesai_pada`, `selesai_keterangan`, `selesai_oleh` |
| `sekretariat_mail_state` | `mailbox`, `uidvalidity`, `uid_terakhir`, `terakhir_tarik_pada`, `galat_terakhir` |
| `sekretariat_admins` | `issuer`, `sub`, `aktif`, `diberikan_oleh`, `alasan` — pola `kerja_admins` |
| `sekretariat_audit` | `aktor`, `aksi`, `objek`, `alasan`, `pada`, `metadata` jsonb |

Catatan skema: tidak ada hapus keras — pembatalan dan spam adalah status; berkas dihapus logis dan dibuang oleh pekerjaan retensi; unik `(penerbit_id, jenis_kode, tahun, urut)` dan `nomor_lengkap`; indeks `(kotak_id, status, diterima_pada DESC)`.

## 5. Buku nomor

1. **Ambil nomor** (petugas penerbit itu, atau admin): input jenis + perihal + tujuan → transaksi: kunci baris penghitung, urut+1, tulis `sekretariat_nomor`, rakit `nomor_lengkap` menurut pedoman. Validasi gagal tidak memakan nomor.
2. **Batalkan** (pengambil selama miliknya, atau admin): alasan 10–500 karakter; status `dibatalkan`; urut tidak kembali.
3. **Nomor awal** (admin): per penerbit × jenis × tahun, hanya menaikkan (`409` bila tidak), teraudit — jalan masuk sisa buku manual.
4. **Retroaktif** (petugas/admin): surat lama diarsipkan dengan `nomor_asli` apa adanya + penanda `retroaktif`; **tidak** menyentuh penghitung dan tidak memakai format baru.
5. **Tanpa tanggal mundur:** `tanggal` = tanggal alokasi (Jakarta); tidak ada input tanggal pada ambil nomor (pedoman Pasal 13 ayat 5, DOC-003 D-06).
6. Register menampilkan semua baris (termasuk migrasi dan nomor HCIS) sesuai akses berlapis §8; ekspor CSV mengikuti ENG-LIST-aturan list Hub, sel dinetralkan dari formula.

## 6. Surat keluar dan arsip

1. Petugas membuat **draf** (jenis, perihal, tujuan, penandatangan, PDF final ≤ 10 MiB).
2. **Terbitkan** = ambil nomor (§5.1) + kunci berkas (checksum disimpan); setelah terbit, PDF tidak dapat diganti — koreksi berarti batalkan + surat baru.
3. Surat `balasan_atas` surat masuk otomatis berjenis **14** dan menautkan dua arah (pedoman Pasal 14 ayat 4).
4. Draf boleh dihapus; surat terbit tidak.

## 7. Kotak masuk

1. **Penarik email** (timer, bawaan tiap 5 menit): adapter `imap` membuka mailbox `sekretariat@sabilulquran.or.id` baca-saja, mengambil pesan dengan UID > `uid_terakhir`, mengurai (From, Subject, Date, teks, lampiran ≤ 10 MiB per berkas — yang lebih besar dicatat tanpa berkas), menulis `sekretariat_surat_masuk` ke **kotak yayasan**, lalu memajukan `uid_terakhir` dalam transaksi yang sama. `UIDVALIDITY` berubah → tarik ulang dengan anti-duplikat `email_message_id`. Email di mailbox tidak dihapus/dipindah/ditandai.
2. **Surat fisik:** petugas memotret/mengunggah + metadata; surat beralamat unitnya boleh langsung ke kotak penerbitnya; yang beralamat yayasan masuk kotak yayasan.
3. **Disposisi:** pemegang disposisi meneruskan item kotak yayasan ke kotak penerbit dengan catatan + tenggat; penerbit menandai selesai dengan keterangan. Disposisi tidak bernomor.
4. **Spam:** item kotak yayasan dapat ditandai `spam` (keluar dari daftar kerja, tetap tersimpan); tidak pernah otomatis.
5. Kegagalan IMAP dicatat di `sekretariat_mail_state.galat_terakhir` dan layar admin; penarik mundur eksponensial sampai 1 jam, tidak pernah mematikan modul.

## 8. Identitas dan akses berlapis

| Peran | Sumber | Boleh |
| --- | --- | --- |
| `sekretariat_admin` (Kepala HCM) | `sekretariat_admins` + CLI bootstrap | Semua kotak (termasuk yayasan), semua register/arsip, jenis, penerbit, petugas, nomor awal, pengaturan email, membatalkan nomor siapa pun |
| Petugas penerbit | `sekretariat_petugas` aktif | Kotak masuk penerbitnya, ambil/batalkan nomor miliknya, register + arsip penerbitnya, unggah surat fisik |
| Pemberi disposisi (Direktur, dapat didelegasikan) | `sekretariat_disposisi_holders` (baris admin-kelola, alasan wajib) | Kotak yayasan: baca, disposisi, tandai spam |
| Konsumen mesin (HCIS) | Client credentials `hcis-sekretariat` | `POST /internal/sekretariat/v1/alokasi-nomor` saja |

- Masuk aplikasi butuh Application Access `sekretariat-sq`; tanpa peran apa pun → layar kosong "Anda belum ditunjuk sebagai petugas" (bukan 500).
- Petugas melihat penerbit lain → **404**, bukan 403 — keberadaan surat tidak bocor (pola KERJA-IMPL-001 §7.3).
- Kotak yayasan dan arsip legal (R2) butuh MFA sesuai `staff-authentication-policy.md`; R1 menegakkannya untuk kotak yayasan.
- Isi email adalah data pihak luar: tidak masuk log; kredensial IMAP hanya env Mi8.

## 9. Layar

Shell SQ Core, lockup **"Sekretariat"** (tanpa singkatan "SQ"), tema terang/gelap, 390 px tanpa gulir horizontal.

| Layar | Isi | Siapa |
| --- | --- | --- |
| **Ringkasan** | Disposisi terbuka milikku, surat terbit terakhir penerbitku, galat penarik email (admin) | semua peran |
| **Kotak masuk** | Daftar per kotak: email + fisik, status, disposisi; detail dengan lampiran | petugas (kotaknya), disposisi/admin (yayasan) |
| **Surat keluar** | Register penerbit, ambil nomor, draf → terbit, retroaktif, batalkan, unduh PDF | petugas |
| **Buku nomor** | Register gabungan + ekspor CSV, filter penerbit/jenis/tahun/status | admin (semua), petugas (penerbitnya) |
| **Pengaturan** | Jenis, penerbit, petugas, pemberi disposisi, nomor awal, status mailbox | admin |

Setiap layar punya keadaan memuat, kosong (dengan langkah pertama), galat, terlarang, dan tampilan ponsel.

## 10. Konfigurasi (env SQ Hub API)

| Nama | Isi |
| --- | --- |
| `SEKRETARIAT_ENABLED` | Bawaan `false`. Mematikan rute, timer, tile |
| `SEKRETARIAT_OIDC_CLIENT_ID` / `_SECRET` | Client `sekretariat-sq` |
| `SEKRETARIAT_PUBLIC_ORIGIN` | `https://sekretariat.sabilulquran.or.id` |
| `SEKRETARIAT_MEDIA_ROOT` | `/srv/sq-hub/sekretariat-media` |
| `SEKRETARIAT_MAX_UPLOAD_BYTES` | `10485760` (10 MiB, SEK-001 §9) |
| `SEKRETARIAT_MAIL_MODE` | `log` (bawaan) / `imap` |
| `SEKRETARIAT_IMAP_HOST` / `_PORT` / `_USER` / `_PASS` | Mailbox `sekretariat@` di hosting email domain (cPanel/Jagoan); secret hanya di Mi8 |
| `SEKRETARIAT_MAIL_INTERVAL_MS` | Bawaan `300000` (5 menit) |
| `SEKRETARIAT_ALLOWED_MACHINE_CLIENTS` | Bawaan kosong; diisi `hcis-sekretariat` saat cutover |
| `SEKRETARIAT_MIN_FREE_DISK_BYTES` | Mengikuti nilai KERJA (5 GiB sementara) |

## 11. Uji

**Otomatis (wajib lulus di CI):**

- **Unit:** perakit nomor (contoh pedoman persis: `01.001/PENG.YSQ/I/2026`, `12.003/PAN.MILAD/X/2026`; urut 1000 tanpa padding); pergantian tahun Jakarta 31 Des 23:59 vs 1 Jan 00:00 WIB; nomor awal hanya naik; retroaktif tidak menyentuh penghitung; parser email (teks, multipart, lampiran besar dilewati dengan catatan).
- **API (PostgreSQL uji):** dua alokasi bersamaan → dua nomor berurutan tanpa celah/ganda; validasi gagal tidak memakan nomor; batal tidak melepaskan urut; petugas penerbit lain → 404; tanpa Application Access → 403; `/internal/.../alokasi-nomor` tanpa client terdaftar → 401/403, dengan client → nomor + idempoten per `rujukan_modul+rujukan_id` (panggilan ulang mengembalikan nomor yang sama, bukan nomor baru); terbit mengunci berkas (unggah ulang → 409); penarik email idempoten (UID sama dua kali → satu baris); UIDVALIDITY berubah → tanpa duplikat; disposisi hanya oleh pemegangnya; MFA ditegakkan untuk kotak yayasan; setiap tindakan admin menulis tepat satu `sekretariat_audit`.
- **Migrasi DOC-003 (CLI, fixture ekspor):** jumlah baris sama, penghitung tujuan ≥ maksimum urut sumber per penerbit×jenis×tahun, `nomor_lengkap` lama tidak berubah, jalan dua kali tanpa duplikat (idempoten per id sumber).
- **Migration SQL:** `0020` dijalankan dua kali pada database kosong dan berisi.

**Manual sebelum rilis:** kirim email uji nyata ke `sekretariat@` (teks, lampiran PDF, lampiran > 10 MiB) dan buktikan ketiganya tampil benar; buka di ponsel.

## 12. Gate Mi8

| Gate | Ukuran | Batas |
| --- | --- | --- |
| Memori SQ Hub API | RSS sebelum/sesudah `SEKRETARIAT_ENABLED=true` + `SEKRETARIAT_MAIL_MODE=imap`, 24 jam | Kenaikan < 20 MiB |
| Putaran penarik email | p95 di Mi8 | < 5 dtk per putaran tanpa pesan baru |
| Disk | Ukuran `SEKRETARIAT_MEDIA_ROOT` masuk laporan harian | Di bawah ambang bebas → unggahan ditolak |
| Alokasi nomor | p95 | < 150 ms |

Dicatat di `docs/operations/SEK-IMPL-001-mi8-gates.md` saat rilis.

## 13. Kriteria penerimaan R1

1. Semua uji otomatis lulus; typecheck, lint, build lulus.
2. Nomor yang diterbitkan persis mengikuti pola pedoman, berurutan tanpa celah per jenis per penerbit, reset pada 1 Januari WIB.
3. Data DOC-003 termigrasi dengan verifikasi §14 lulus, dan nomor lama tampil utuh di register.
4. HCIS (atau klien uji dengan client credentials) memperoleh nomor lewat `/internal/sekretariat/v1/alokasi-nomor`, idempoten per rujukan, dan ditolak tanpa identitas layanan; dari luar Mi8 rute tidak terjangkau.
5. Surat keluar terbit mengunci PDF ber-checksum; surat retroaktif menyimpan nomor aslinya tanpa menyentuh penghitung.
6. Email ke `sekretariat@` muncul di kotak yayasan tanpa duplikat, mailbox asli tidak berubah, dan kegagalan IMAP terlihat di layar admin tanpa mematikan modul.
7. Disposisi berpindah ke kotak penerbit dengan tenggat dan bisa ditandai selesai; petugas tidak dapat melihat kotak, register, atau arsip penerbit lain (404).
8. Berkas muncul di salinan Drive terenkripsi, dibuktikan `cryptcheck`.
9. Akses tanpa Application Access ditolak fail-closed; kotak yayasan menegakkan MFA.
10. Gate Mi8 §12 tercatat 7 hari pertama.

## 14. Migrasi, cutover, dan langkah production

Mengikuti aturan rilis owner 2026-10-27 (dry-run dulu, backup sebelum migration, gate lolos, rollback bila verifikasi gagal, tidak pada jam 19 UTC, laporkan sesudahnya). **Pasangan spesifikasi HCIS** (alokasi DOC-001/002/surat tugas lewat API ini + pensiun layar `/app/letters`) ditulis di repo HCIS dan dirilis bersama langkah 8–9.

| # | Langkah | Siapa | Rollback |
| --- | --- | --- | --- |
| 1 | Keycloak: `reconcile-sekretariat-clients.sh` (client `sekretariat-sq` + `hcis-sekretariat`), idempoten, dijalankan dua kali | Operator | Nonaktifkan client |
| 2 | Rilis SQ Hub dengan modul, `SEKRETARIAT_ENABLED=false`; backup lalu migrate `0020` | Operator | Release sebelumnya; migration aditif |
| 3 | Buat `SEKRETARIAT_MEDIA_ROOT`, isi env §10 (`SEKRETARIAT_MAIL_MODE=log`), `SEKRETARIAT_ENABLED=true`; ukur gate memori | Operator | `SEKRETARIAT_ENABLED=false` |
| 4 | Mailbox `sekretariat@sabilulquran.or.id` dibuat di cPanel; kredensial ke env Mi8 (owner yang memegang kredensial hosting); `SEKRETARIAT_MAIL_MODE=imap`, uji email nyata | Owner + operator | Kembali ke `log` |
| 5 | Remote rclone crypt `sekretariat_media:`; pasang `sq-core-sekretariat-media-offhost`, uji `cryptcheck` | Operator + owner (kunci) | Nonaktifkan cron |
| 6 | Registry + Application Access `sekretariat-sq`; CLI `sekretariat:admin grant` Kepala HCM; isi penerbit/petugas/pemberi disposisi | Platform Administrator | Status `inactive` |
| 7 | Edge route + **DNS** `sekretariat` (CNAME tunnel, oleh pemilik akun Cloudflare Yayasan — bukan panel hosting) | Operator + pemilik Cloudflare | Hapus route/record |
| 8 | **Migrasi DOC-003:** HCIS diekspor (skrip ekspor di repo HCIS) → CLI `sekretariat:impor-doc003` (dry-run dulu) → verifikasi otomatis: jumlah baris, maksimum urut per penerbit×jenis×tahun, contoh acak dibandingkan. Sejak tanggal cutover, buku HCIS dibuat baca-saja | Operator | Impor idempoten; buku HCIS belum dimatikan sampai verifikasi lulus |
| 9 | Aktifkan konsumen HCIS (`SEKRETARIAT_ALLOWED_MACHINE_CLIENTS=hcis-sekretariat`; rilis HCIS sisi konsumen); layar `/app/letters` HCIS pensiun | Operator | Kosongkan daftar client; layar HCIS kembali |
| 10 | Sosialisasi petugas register per penerbit; pantau 7 hari | Kepala HCM | — |

Selama langkah 1–7 buku DOC-003 di HCIS tetap satu-satunya buku aktif; sejak langkah 8 buku Sekretariat menggantikannya — **tidak pernah dua buku aktif**.

## 15. Dampak pada dokumen lain

- `docs/specs/README.md`: baris SEK-IMPL-001.
- Roadmap and decision register: baris Sekretariat diperbarui saat spesifikasi ACCEPTED.
- Repo HCIS: spesifikasi pasangan sisi konsumen + skrip ekspor DOC-003 (ditulis sebelum langkah 8).
- `infra/production.env.example`: blok `SEKRETARIAT_*`.

## 16. Keputusan usulan (menunggu Product Owner)

Semua `DRAFT`; angka boleh diubah tanpa mengubah skema.

| # | Topik | Usulan |
| --- | --- | --- |
| D-1 | Interval penarik email | 5 menit |
| D-2 | Lampiran email lebih dari 10 MiB | Dicatat sebagai baris surat masuk tanpa berkasnya, dengan keterangan "lampiran terlalu besar — buka di webmail" |
| D-3 | Idempotensi API mesin | Satu nomor per (`rujukan_modul`, `rujukan_id`); panggilan ulang mengembalikan nomor yang sama |
| D-4 | Pemberi disposisi | Direktur; delegasi lewat baris `sekretariat_disposisi_holders` oleh admin dengan alasan |
| D-5 | Berkas di disk Mi8 dienkripsi? | Tidak — pola Karir/Kerja (0700 + crypt di salinan Drive); isi email bukan dokumen identitas |
| D-6 | Retensi surat masuk spam | Tetap tersimpan, ditinjau setahun |

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-11-12 | DRAFT pertama untuk R1 dari SEK-001 revisi 5 |
