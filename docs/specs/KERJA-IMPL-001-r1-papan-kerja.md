# KERJA-IMPL-001 — Kerja SQ R1: papan kerja

**Status:** DRAFT. Spesifikasi ini **belum** mengizinkan implementasi; menunggu keputusan §16 dan persetujuan Product Owner.
**Produk:** SQ Hub — modul `kerja` (Kerja SQ)
**Owner produk:** Kepala HCM (`kerja_admin`, KERJA-001 §2 nomor 8)
**Tanggal:** 2026-10-20
**Depends on:**
- [KERJA-001](../product/kerja-sq-module-design.md) revisi 4, terutama §1.3, §5–§9, §11 dan §14
- [ADR-0011](../architecture/adr/0011-kirim-sq-shared-whatsapp-capability.md) (pola modul di dalam Hub), ADR-0001 (batas platform), ADR-0003 (Keycloak), ADR-0006 (stack), ADR-0007 (Organization Directory)
- [HUB-IMPL-018](HUB-IMPL-018-organization-directory-foundation.md) (kontrak baca Directory), HUB-IMPL-002 / HUB-IMPL-009 (Application Registry dan Application Access), HUB-IMPL-016 (launcher production)
- [KIRIM-IMPL-001](KIRIM-IMPL-001-r1-nomor-dan-kirim.md) sebagai preseden bentuk modul, login host sendiri, CLI peran, dan gate Mi8

**Pemakai pertama:** 26 orang, dari Direktur sampai setara wakil kepala sekolah dan TU/operator (KERJA-001 §1.3). Tidak ada modul lain yang memanggil Kerja SQ di R1.

## 1. Tujuan dan batas rilis

R1 membuat **papan kerja yang benar-benar dipakai**: ruang per unit dan per kepanitiaan, kartu yang bisa ditugaskan dan ditagih, dan satu daftar lintas ruang untuk tiap orang.

R1 berisi:

1. **Ruang:** ruang tetap yang dibuat dari unit Organization Directory, dan ruang panitia yang dibuat manual dengan tanggal berakhir wajib.
2. **Keanggotaan:** dicatat eksplisit per ruang dengan peran `pj`, `anggota`, `peninjau`; usulan perubahan dari Directory, tidak pernah menyalin otomatis.
3. **Papan:** papan, kolom, dan kartu dengan geser antar kolom dan urutan posisi pecahan.
4. **Kartu:** judul, uraian, penanggung jawab, label, tanggal mulai dan tenggat, status selesai berjenis (`tuntas`/`batal`/`ditunda`), arsip, salin dengan pilihan rinci.
5. **Ceklis:** banyak ceklis per kartu; tiap butir punya tenggat, penanggung jawab, dan lampiran sendiri.
6. **Komentar:** dua lapis (komentar dan balasan), tanpa bersarang lebih dalam.
7. **Lampiran:** di disk Mi8 dengan batas 25 MB per berkas dan kuota per ruang, disalin terenkripsi ke Drive sesuai pola Karir SQ.
8. **Tugas Saya:** kartu dari seluruh ruang yang diikuti, dalam satu daftar.
9. **Pencarian** di dalam satu ruang.
10. **Riwayat perubahan kartu** dengan aktor dan waktu.
11. **Pengingat in-app** H−1 hari dan H−1 jam untuk mulai dan tenggat, masing-masing dengan penanda anti-kirim-ulang.
12. **Akses:** login lewat client OIDC `kerja-sq`, dibatasi Application Access `kerja-sq`; peran `kerja_admin` di tabel modul.

Di luar R1 (KERJA-001 §9):

- pengumuman per ruang, apresiasi, penanda terbaca, kartu berulang, pencarian lintas ruang, pengingat lewat Kirim SQ — **R2**;
- check-in harian, tautan ke Rapat SQ dan Aset SQ, kartu ringkasan untuk Ringkasan Yayasan — **R3**;
- chat, penyuntingan dokumen bersama, absensi, master unit organisasi, hierarki tugas lebih dari dua lapis — **tidak dibangun** (KERJA-001 §3).

## 2. Keputusan teknis

| Topik | Keputusan | Alasan / sumber |
| --- | --- | --- |
| Letak kode | `apps/api/src/modules/kerja/` dan layar di `apps/web/src/kerja/`. Modul hanya mengimpor auth (hub-auth), Application Access, dan pembaca Organization Directory | KERJA-001 §4.1: bisa diekstrak kelak |
| Proses | **Tidak ada proses baru.** Worker pengingat berjalan sebagai timer di proses SQ Hub API (port 3302 Mi8) | ADR-0011; memori Mi8 |
| Stack | ADR-0006: Fastify 5, `pg`, Zod, Vitest, SQL migration polos. Dependensi baru: `@fastify/multipart` (sudah ada sejak KIRIM-IMPL-001) untuk unggah lampiran. Tanpa queue eksternal, tanpa mesin pencari | ADR-0006 |
| Database | Tabel berawalan `kerja_` di database SQ Hub yang sama (`sq_hub_production`), migration `0011_kerja_r1.sql` | ADR-0011 |
| Rute | `/api/kerja/*` untuk aplikasi (sesi `kerja-sq`), `/api/admin/kerja/*` untuk `kerja_admin`. `/internal/kerja/*` **disediakan namanya saja** untuk tautan modul di R3 dan diblokir di edge sejak R1 | KERJA-001 §4.2, §10.2 |
| Hostname | `kerja.sabilulquran.or.id` → edge 3180 → web 3202 / API 3302 Mi8 | KERJA-001 §4.2 |
| Login | Client OIDC sendiri `kerja-sq` (realm `sq-staff`, confidential, PKCE S256), cookie sesi host-only `sq_kerja_session`, memakai ulang kode hub-auth dengan konfigurasi kedua — persis pola `kirim-sq` | AGENTS.md §5: tidak ada cookie wildcard lintas subdomain |
| Audience mesin | **Tidak dibuat di R1.** Client `sq-hub-kerja` baru diperlukan ketika modul lain memanggil Kerja SQ (R3) | Satu objek Keycloak lebih sedikit untuk dijaga |
| Sumber orang dan unit | Pembaca Organization Directory yang sudah ada (HUB-IMPL-018 §"SQ Hub → Aset SQ read contract"). Modul **tidak** menyentuh tabel HCIS maupun tabel directory secara langsung | ADR-0007 |
| Identitas | Tidak ada tabel pengguna. Orang dirujuk dengan `person_id` Directory; nama dan foto hanya cache tampilan yang boleh basi | KERJA-001 §7.3 nomor 1 |
| Urutan kartu | Kolom `posisi numeric(30,15)`, sisip di titik tengah, rebalance satu kolom bila jarak dua tetangga < `1e-9` | KERJA-001 §6.7; menghindari menulis ulang seluruh kolom saat menggeser |
| Pencarian | PostgreSQL full-text, kolom `tsv` ter-generate dan indeks GIN per kartu, konfigurasi `indonesian` bila tersedia di PG18 dan `simple` bila tidak (diperiksa saat migration) | KERJA-001 §6.6: tanpa proses baru di Mi8 |
| Lampiran | Berkas di `KERJA_MEDIA_ROOT` (`/srv/sq-hub/kerja-media`, milik `sqhub`, 0700). Baris menyimpan **kunci penyimpanan**, bukan jalur | KERJA-001 §7.3 nomor 4, §7.4 |
| Salinan off-host | Skrip `sq-core-kerja-media-offhost` mengikuti `sq-core-karir-docs-offhost`: `rclone copy --immutable` ke remote crypt sendiri, lalu `cryptcheck --one-way` | KERJA-001 §7.4 |
| Zona waktu | Semua waktu disimpan `timestamptz` UTC; tampilan dan ambang pengingat memakai `Asia/Jakarta`, format 24 jam | KERJA-001 §13 |
| Web | Bundle `apps/web` yang sama; bila `location.host` diawali `kerja.`, router memuat shell Kerja SQ | Tanpa proses web baru |

## 3. Arsitektur

```text
Pengguna (26 orang) ── https://kerja.sabilulquran.or.id
                        │
                     Tunnel ── edge 3180 ── web 3202 / API 3302
                                            (/internal/* → 404 di edge)
                        ▼
SQ Hub API (3302) ─ modul kerja
   ├─ routes-app     : /api/kerja/*  (sesi sq_kerja_session + Application Access kerja-sq)
   ├─ routes-admin   : /api/admin/kerja/*  (tambahan: baris kerja_admins aktif)
   ├─ service        : aturan ruang, keanggotaan, kartu, ceklis, komentar, arsip
   ├─ directory.ts   : pembaca Organization Directory (unit, ancestry, people)
   │                   → usulan keanggotaan, tidak pernah menulis otomatis
   ├─ attachments.ts : simpan/ambil berkas di KERJA_MEDIA_ROOT, batas ukuran, kuota ruang
   ├─ search.ts      : query full-text dalam satu ruang
   ├─ history.ts     : tulis kerja_riwayat pada setiap perubahan kartu
   └─ reminders.ts   : timer 60 dtk → kartu jatuh tempo → notifikasi in-app, set penanda

cron Mi8 (di luar proses API)
   └─ sq-core-kerja-media-offhost : rclone copy --immutable → kerja_media: (crypt) → Drive yayasan
```

### 3.1 Struktur kode (usulan)

```text
apps/api/src/modules/kerja/
  config.ts            # env + validasi (root media, batas ukuran, interval pengingat)
  repository.ts        # SQL kerja_*
  service-ruang.ts     # ruang, keanggotaan, usulan dari Directory
  service-papan.ts     # papan, kolom, kartu, posisi, arsip, salin
  service-kartu.ts     # ceklis, komentar, label, penanggung jawab
  attachments.ts       # unggah, unduh, kuota, batas ukuran
  search.ts            # pencarian dalam ruang
  history.ts           # kerja_riwayat
  reminders.ts         # worker pengingat
  directory.ts         # pembaca Organization Directory
  routes-app.ts        # /api/kerja/*
  routes-admin.ts      # /api/admin/kerja/*
apps/api/src/cli/kerja-admin.ts   # bootstrap kerja_admin, buat ruang tetap dari Directory
apps/api/migrations/0011_kerja_r1.sql
apps/web/src/kerja/                # shell Kerja SQ dan layar §8
scripts/mi8/sq-core-kerja-media-offhost   # salinan terenkripsi ke Drive
```

## 4. Data

Semua tabel berawalan `kerja_`, semuanya membawa rujukan ruang langsung atau lewat induknya (KERJA-001 §7.3 nomor 2).

| Tabel | Isi utama |
| --- | --- |
| `kerja_ruang` | `id`, `jenis` (`tetap`/`panitia`), `nama`, `unit_id` (Directory, null untuk panitia), `berakhir_pada` (wajib non-null bila `panitia`), `status` (`aktif`/`arsip`), `dibuat_oleh`, `dibuat_pada` |
| `kerja_ruang_anggota` | `ruang_id`, `person_id`, `peran` (`pj`/`anggota`/`peninjau`), `dicatat_oleh`, `dicatat_pada`. Unik per (`ruang_id`, `person_id`) |
| `kerja_ruang_usulan` | Usulan dari Directory yang belum ditindak: `ruang_id`, `person_id`, `jenis` (`tambah`/`keluarkan`), `alasan`, `dibuat_pada`, `ditindak_pada`, `ditindak_oleh` |
| `kerja_papan` | `ruang_id`, `nama`, `urutan` |
| `kerja_kolom` | `papan_id`, `nama`, `urutan`, `menandai_selesai` boolean |
| `kerja_kartu` | `kolom_id`, `judul`, `uraian`, `mulai_pada`, `tenggat_pada`, `selesai_status`/`selesai_jenis`/`selesai_pada`/`selesai_oleh`, `arsip` boolean, `posisi numeric(30,15)`, `asal_modul`/`asal_jenis`/`asal_id`/`asal_judul` (null di R1), `dibuat_oleh`, `tsv` |
| `kerja_kartu_orang` | `kartu_id`, `person_id` — penanggung jawab kartu |
| `kerja_label` | `papan_id`, `nama`, `warna` |
| `kerja_kartu_label` | `kartu_id`, `label_id` |
| `kerja_ceklis` | `kartu_id`, `nama`, `urutan` |
| `kerja_ceklis_item` | `ceklis_id`, `nama`, `tenggat_pada`, `selesai` boolean, `urutan numeric(30,15)` |
| `kerja_ceklis_item_orang` | `item_id`, `person_id` |
| `kerja_lampiran` | `pemilik_jenis` (`kartu`/`ceklis_item`/`ruang`), `pemilik_id`, `nama`, `kunci_penyimpanan`, `mime`, `ukuran`, `diunggah_oleh`, `dihapus` boolean |
| `kerja_komentar` | `kartu_id`, `induk_id` (null = komentar, berisi id = balasan), `penulis`, `isi`, `dibuat_pada`, `disunting_pada`, `dihapus` boolean |
| `kerja_pengingat` | `kartu_id`, empat kolom waktu kirim: `mulai_h1hari_pada`, `mulai_h1jam_pada`, `tenggat_h1hari_pada`, `tenggat_h1jam_pada`, masing-masing null bila belum terkirim |
| `kerja_notifikasi` | `person_id`, `jenis`, `kartu_id`, `dibuat_pada`, `dibaca_pada` — pengingat dan penugasan in-app |
| `kerja_riwayat` | `kartu_id`, `aksi`, `aktor`, `pada`, `lama` jsonb, `baru` jsonb |
| `kerja_admins` | `issuer`, `sub`, `aktif`, `diberikan_oleh`, `alasan` |
| `kerja_audit` | Tindakan admin dan perubahan keanggotaan: `aktor`, `aksi`, `objek`, `alasan`, `pada` |

Catatan skema:

1. **Tidak ada hapus keras** untuk kartu, komentar, dan lampiran. Kartu memakai `arsip`; komentar dan lampiran memakai `dihapus` dengan isi dikosongkan dan strukturnya dipertahankan agar balasan tidak yatim (KERJA-001 §7.3 nomor 3).
2. `kerja_kartu.tsv` di-generate dari `judul` dan `uraian`; isi komentar diindeks lewat indeks terpisah pada `kerja_komentar`.
3. Indeks yang wajib ada: `(kolom_id, posisi)` untuk papan, `(person_id)` pada `kerja_kartu_orang` untuk Tugas Saya, GIN pada `tsv`, dan `(kartu_id, pada DESC)` pada `kerja_riwayat`.
4. `kerja_ruang` memakai constraint: `jenis = 'panitia'` ⇒ `berakhir_pada IS NOT NULL`; `jenis = 'tetap'` ⇒ `unit_id IS NOT NULL`.

## 5. Ruang dan keanggotaan

### 5.1 Ruang tetap dari Directory

Ruang tetap dibuat dari `unitId` Organization Directory. Modul menyimpan `unit_id`, bukan salinan struktur.

Saat ruang dibuat, modul memanggil `GET /internal/v1/organization-directory/people?unitId=<unitId>&active=true` dan menampilkan hasilnya sebagai **calon**, bukan sebagai anggota. Operator memilih siapa yang masuk; yang tercatat adalah `kerja_ruang_anggota` dengan aktor dan waktunya.

### 5.2 Usulan perubahan

Timer harian membandingkan anggota tercatat dengan isi Directory terkini per unit, lalu menulis `kerja_ruang_usulan`:

- orang ada di unit tetapi belum di ruang → usul `tambah`;
- orang ada di ruang tetapi tidak lagi di unit → usul `keluarkan`.

Usulan **tidak pernah dieksekusi sendiri**. Penanggung jawab ruang menerima dan menindaknya di layar Pengaturan ruang. Setiap tindakan menulis `kerja_audit`.

Bila Directory sedang `stale` (HUB-IMPL-018 §11), pembandingan dilewati dan dicatat; usulan tidak dibuat dari data basi.

### 5.3 Rantai atasan tidak seragam

TTSQ dan SDITTSQ berada langsung di bawah Kepala Bidang Pendidikan; SMPIT dan PKBM lewat Mudir Pesantren lebih dulu (KERJA-001 §1.3). Usulan peninjau memakai `GET .../units/{unitId}/ancestry` per unit, bukan satu pola yang sama untuk semua.

### 5.4 Orang di dua ruang

Tiga wakasek melayani SMPIT dan PKBM bersama. Tidak ada perlakuan khusus di data — satu orang boleh menjadi anggota banyak ruang. Yang menjadi penting bagi mereka adalah layar Tugas Saya (§8), bukan papan mana pun.

### 5.5 Ruang panitia

Dibuat manual, anggota dipilih dari Directory, `berakhir_pada` wajib diisi. Timer harian memindahkan ruang yang lewat tanggal berakhir ke `status = 'arsip'`; isinya tetap terbaca, kartu tidak bisa ditambah. Perpanjangan adalah tindakan eksplisit yang tercatat.

### 5.6 Anggota yang dinonaktifkan

Pencabutan Akun SQ ditangani di lapisan Application Access dan tidak diulang di sini. Yang ditangani modul: kartu yang masih ditugaskan kepada orang yang sudah tidak aktif muncul sebagai **yatim** di layar Pengaturan ruang penanggung jawab, bukan menghilang (KERJA-001 §5.3).

## 6. Kartu

### 6.1 Posisi

`posisi` adalah `numeric(30,15)`. Menyisipkan di antara dua kartu memakai titik tengah. Bila jarak dua tetangga < `1e-9`, kolom tersebut direbalance ke kelipatan 1024 dalam satu transaksi. Rebalance dicatat di log, bukan di `kerja_riwayat`.

Alternatif rank leksikografis ditolak untuk R1: pada 13 ruang dan papan berisi puluhan kartu, titik tengah numerik lebih sederhana dan lebih mudah diuji.

### 6.2 Status selesai

`selesai_jenis` adalah salah satu dari `tuntas`, `batal`, `ditunda`. Menutup kartu wajib memilih jenis; tidak ada nilai bawaan. Memindahkan kartu ke kolom ber-`menandai_selesai` menanyakan jenis, tidak menebaknya.

### 6.3 Salin kartu

Salinan menerima pilihan terpisah: label, penanggung jawab, ceklis, isi butir ceklis, lampiran. Yang tidak pernah ikut: komentar, riwayat, status selesai, dan pengingat yang sudah terkirim.

### 6.4 Pengingat

Timer 60 detik mencari kartu dengan `mulai_pada` atau `tenggat_pada` yang sudah melewati ambang H−1 hari atau H−1 jam menurut `Asia/Jakarta`, dan penanda terkait masih null. Untuk setiap kartu, modul menulis `kerja_notifikasi` ke semua penanggung jawab, lalu mengisi penanda **dalam transaksi yang sama**.

Kartu yang sudah selesai atau diarsipkan tidak menghasilkan pengingat. Mengubah tenggat **mengosongkan** dua penanda tenggat; mengubah tanggal mulai mengosongkan dua penanda mulai.

### 6.5 Riwayat

Setiap perubahan berikut menulis satu baris `kerja_riwayat`: dibuat, pindah kolom, pindah ruang tidak diizinkan di R1, tambah/lepas penanggung jawab, ubah tenggat atau tanggal mulai, tutup dengan jenis, buka kembali, arsip, pulihkan. Perubahan `uraian` dicatat sebagai kejadian tanpa menyimpan teks lama maupun baru (KERJA-001 §6.9).

## 7. Identitas dan akses

### 7.1 Keycloak (realm `sq-staff`)

| Client | Jenis | Untuk |
| --- | --- | --- |
| `kerja-sq` | Confidential, standard flow, PKCE S256 | Login di `https://kerja.sabilulquran.or.id/api/auth/callback` |

Skrip `infra/keycloak/scripts/reconcile-kerja-clients.sh` idempoten, mengikuti pola `reconcile-kirim-clients.sh`, dan diuji dengan menjalankannya dua kali.

### 7.2 Application Access

- Registry: `application_key = kerja-sq`, nama "Kerja SQ", `canonical_url = https://kerja.sabilulquran.or.id`, status `active` setelah layar siap di production.
- Masuk ke aplikasi butuh Application Access `kerja-sq` aktif. Tanpa itu: 403, dan tile tidak tampil di Launcher.
- Masuk ke layar **Admin Kerja SQ** butuh tambahan baris `kerja_admins` aktif. Punya akses tanpa peran → 403 dengan pesan yang menjelaskan.
- `kerja_admin` pertama (Kepala HCM) dibuat lewat CLI `npm run kerja:admin -- grant --issuer … --sub … --reason …` dan tercatat di `kerja_audit`.

### 7.3 Izin di dalam ruang

| Tindakan | `pj` | `anggota` | `peninjau` |
| --- | --- | --- | --- |
| Membaca papan, kartu, komentar, lampiran | ya | ya | ya |
| Membuat dan mengubah kartu, komentar, ceklis | ya | ya | tidak |
| Mengunggah lampiran | ya | ya | tidak |
| Menutup dan mengarsipkan kartu | ya | ya | tidak |
| Mengatur papan, kolom, label | ya | tidak | tidak |
| Mengubah keanggotaan, menindak usulan | ya | tidak | tidak |
| Menutup atau memperpanjang ruang | ya | tidak | tidak |

Bukan anggota ruang → 404, bukan 403. Keberadaan ruang dan kartu tidak boleh bocor lewat kode status.

## 8. Layar

Shell SQ Core dengan lockup "Kerja SQ", SQ Design System yang sama dengan Hub, tema terang dan gelap, lebar 390 px tanpa gulir horizontal (KERJA-001 §8).

| Layar | Isi | Siapa |
| --- | --- | --- |
| **Tugas Saya** | Halaman pertama setelah masuk. Kartu dari semua ruang yang diikuti; lewat tenggat di atas dan ditandai, lalu tenggat terdekat, lalu tanpa tenggat. Penyaring ruang, label, status | semua |
| **Daftar ruang** | Ruang tetap dan panitia dipisah; ruang yang akan berakhir dalam 30 hari ditandai | semua |
| **Papan** | Kolom dan kartu, geser antar kolom, penyaring label dan penanggung jawab | anggota dan peninjau (baca) |
| **Kartu** | Panel di sisi papan pada layar lebar, halaman penuh di ponsel. Uraian, ceklis, komentar, lampiran, riwayat | anggota dan peninjau (baca) |
| **Pencarian** | Dalam satu ruang, dengan penyaring §6 | anggota dan peninjau |
| **Berkas ruang** | Lampiran yang tidak menempel kartu, dengan sisa kuota ruang | anggota |
| **Arsip ruang** | Kartu terarsip | anggota |
| **Pengaturan ruang** | Anggota, usulan dari Directory, kartu yatim, label, papan, tanggal berakhir | `pj` |
| **Admin Kerja SQ** | Daftar ruang, pembuatan ruang tetap dari Directory, retensi | `kerja_admin` |

Setiap layar utama punya keadaan kosong yang menyebut langkah pertama, bukan ilustrasi kosong (KERJA-001 §8).

## 9. Lampiran

| Aturan | Nilai |
| --- | --- |
| Batas ukuran per berkas | **25 MB** (KERJA-001 §14 nomor 10) |
| Kuota per ruang | Bawaan **2 GB**, bisa diubah `kerja_admin` |
| Jenis berkas | Daftar izin: PDF, gambar, dokumen Office, teks, arsip zip. Diperiksa dengan magic bytes, bukan ekstensi |
| Tempat | `KERJA_MEDIA_ROOT/<ruang_id>/<kunci>` — `kunci` adalah UUID, bukan nama asli |
| Izin berkas | Direktori 0700 milik `sqhub` |
| Unduh | Lewat `/api/kerja/lampiran/:id` setelah keanggotaan ruang diperiksa. Tidak ada tautan publik, tidak ada tautan yang bisa ditebak |
| Penghapusan | `dihapus = true`; berkas fisik dihapus oleh pekerjaan retensi, bukan seketika |
| Salinan off-host | `sq-core-kerja-media-offhost` harian: `rclone copy --immutable` ke remote crypt `kerja_media:`, lalu `cryptcheck --one-way` |
| Pemindahan | Berkas berumur > 1 tahun dihapus dari disk Mi8 setelah salinan Drive terbukti ada; baris tetap dengan penanda `di_arsip` |
| Disk rendah | Di bawah **10 GiB** bebas: unggahan ditolak dengan pesan yang jelas, bukan gagal diam-diam |

Berkas **tidak** dienkripsi di disk Mi8 (D-1), mengikuti pola Karir SQ: perlindungan di disk adalah kepemilikan berkas, dan enkripsi dipasang pada salinan off-host.

## 10. Keamanan dan privasi

1. Bukan anggota ruang menerima **404**, sehingga keberadaan ruang tidak bocor.
2. Uraian, komentar, dan nama lampiran dibersihkan sebagai HTML saat disimpan **dan** saat ditampilkan, dengan berkas uji tempel tersendiri (KERJA-001 §6.4).
3. `@sebut` hanya boleh memilih dari anggota ruang itu, tidak dari seluruh yayasan.
4. Unduh lampiran tidak pernah memakai nama berkas asli sebagai jalur.
5. Log dan audit tidak memuat isi kartu, isi komentar, maupun nama berkas.
6. Semua tindakan admin dan perubahan keanggotaan menulis `kerja_audit` dengan alasan wajib.
7. `/internal/kerja/*` diblokir di edge sejak R1 meski belum dipakai.

## 11. Konfigurasi (env SQ Hub API)

| Nama | Isi |
| --- | --- |
| `KERJA_ENABLED` | Bawaan `false`. Mematikan rute, timer, dan tile |
| `KERJA_OIDC_CLIENT_ID` / `KERJA_OIDC_CLIENT_SECRET` | Client `kerja-sq` |
| `KERJA_PUBLIC_ORIGIN` | `https://kerja.sabilulquran.or.id` |
| `KERJA_MEDIA_ROOT` | `/srv/sq-hub/kerja-media` |
| `KERJA_MAX_UPLOAD_BYTES` | `26214400` (25 MB) |
| `KERJA_ROOM_QUOTA_BYTES` | Bawaan `2147483648` (2 GB) |
| `KERJA_REMINDER_INTERVAL_MS` | Bawaan `60000` |
| `KERJA_DIRECTORY_SYNC_CRON` | Jam pembandingan usulan harian, WIB |
| `KERJA_MIN_FREE_DISK_BYTES` | `10737418240` (10 GiB) |

## 12. Uji

**Otomatis (wajib lulus di CI):**

- **Unit:**
  - posisi: sisip di tengah, sisip berulang 60 kali memicu rebalance, urutan tetap setelah rebalance;
  - ambang pengingat WIB: tepat H−1 hari, H−1 jam, kartu selesai, kartu arsip, tenggat diubah mengosongkan penanda yang benar saja;
  - `selesai_jenis` wajib, nilai di luar daftar ditolak;
  - constraint ruang: panitia tanpa `berakhir_pada` ditolak, tetap tanpa `unit_id` ditolak;
  - pembersihan HTML tempel: skrip, atribut `on*`, `javascript:`, HTML dari Word;
  - salin kartu: tiap kombinasi pilihan, dan komentar/riwayat tidak pernah ikut.
- **API (dengan PostgreSQL uji):**
  - bukan anggota ruang → 404 pada ruang, papan, kartu, lampiran, pencarian;
  - `peninjau` → 403 pada semua tulis; `anggota` → 403 pada pengaturan papan dan keanggotaan;
  - tanpa Application Access → 403; akses tanpa `kerja_admins` → 403 pada `/api/admin/kerja/*`;
  - unggah: > 25 MB ditolak, mime palsu ditolak, kuota ruang habis ditolak, disk < 10 GiB ditolak;
  - unduh lampiran ruang lain → 404;
  - pencarian tidak pernah mengembalikan kartu dari ruang yang tidak diikuti;
  - Tugas Saya menggabungkan kartu dari dua ruang untuk satu orang (kasus wakasek SMPIT + PKBM);
  - usulan Directory: `stale` → tidak ada usulan dibuat; usulan tidak pernah mengubah keanggotaan sendiri;
  - setiap tindakan admin dan keanggotaan menulis tepat satu `kerja_audit`, dan tanpa alasan → 400;
  - worker pengingat dijalankan dua kali tidak menghasilkan notifikasi ganda.
- **Migration:** `0011_kerja_r1.sql` dijalankan dua kali pada database kosong dan pada database berisi; deteksi konfigurasi `indonesian` diuji pada kedua cabang.

**Manual sebelum rilis:** geser kartu pada perangkat Android kelas bawah nyata, bukan emulator (KERJA-001 §13).

## 13. Gate Mi8

| Gate | Ukuran | Batas |
| --- | --- | --- |
| Memori SQ Hub API | RSS sebelum dan sesudah `KERJA_ENABLED=true`, 24 jam dengan timer berjalan | Kenaikan < 20 MiB |
| Durasi putaran worker pengingat | p95 di Mi8 | < 200 ms |
| Durasi pencarian | p95 pada ruang terbesar | < 300 ms |
| Disk Mi8 | Ruang bebas dan ukuran `KERJA_MEDIA_ROOT`, masuk laporan harian | < 10 GiB bebas → unggahan ditolak, pemindahan arsip dipercepat |
| Database | Ukuran tabel `kerja_*` per minggu | Dicatat; tidak ada batas di R1 |
| MemAvailable Mi8 | Rata-rata harian 7 hari | Di bawah 900 MiB → hentikan penambahan ruang, rencanakan pindah mesin |

Pengukuran dicatat di `docs/operations/KERJA-IMPL-001-mi8-gates.md` (dibuat saat rilis).

## 14. Kriteria penerimaan R1

Sepuluh pertama mengikuti KERJA-001 §9; sisanya khusus spesifikasi ini.

1. Semua uji otomatis lulus; typecheck, lint, dan build lulus.
2. Ruang tetap bisa dibuat dari unit Organization Directory, dan calon anggotanya datang dari Directory.
3. Ruang panitia bisa dibuat manual dan ditolak bila tanpa tanggal berakhir.
4. Kartu bisa dibuat, ditugaskan, diberi tenggat, dipindah antar kolom, dan ditutup dengan `jenis` yang dipilih.
5. Butir ceklis bisa punya tenggat dan penanggung jawab sendiri.
6. Tugas Saya menampilkan kartu dari seluruh ruang yang diikuti dalam satu daftar, termasuk untuk orang yang berada di dua ruang.
7. Pencarian dalam ruang menemukan kartu menurut judul, uraian, dan komentar, dan tidak pernah menampilkan kartu dari ruang yang tidak diikuti.
8. Riwayat kartu mencatat pemindahan kolom, penugasan, perubahan tenggat, dan penutupan, dengan aktor dan waktu.
9. Pengingat terkirim tepat satu kali per penanda, dibuktikan dengan worker dijalankan ulang.
10. Geser kartu antar kolom tetap responsif pada perangkat Android kelas bawah nyata.
11. Lampiran di atas 25 MB ditolak, kuota ruang ditegakkan, dan unduh dari bukan-anggota ditolak 404.
12. Lampiran yang diunggah muncul di salinan Drive terenkripsi pada jalan berikutnya, dibuktikan dengan `cryptcheck`.
13. Usulan keanggotaan dari Directory tidak pernah mengubah keanggotaan tanpa tindakan manusia, dan tidak dibuat saat Directory `stale`.
14. Orang yang tidak punya Application Access `kerja-sq` ditolak, dan penolakannya fail-closed.
15. `/internal/kerja/*` tidak bisa dicapai dari luar Mi8.
16. Gate Mi8 §13 tercatat untuk 7 hari pertama setelah ruang pertama dipakai.

## 15. Langkah production (masing-masing butuh persetujuan owner)

| # | Langkah | Siapa | Rollback |
| --- | --- | --- | --- |
| 1 | Keycloak: `reconcile-kerja-clients.sh` (client `kerja-sq`), dijalankan dua kali | Operator SQ Core | Nonaktifkan client |
| 2 | Rilis SQ Hub dengan modul kerja, `KERJA_ENABLED=false`; backup lalu migrate `0011` | Operator | Release sebelumnya; migration aditif, tabel ditinggalkan |
| 3 | Buat `KERJA_MEDIA_ROOT` (0700 `sqhub`), isi env §11, lalu `KERJA_ENABLED=true`; ukur gate memori | Operator | `KERJA_ENABLED=false` |
| 4 | Remote rclone `kerja_media_drive:` dan crypt `kerja_media:` di akun Drive yayasan, kunci dibuat di host dan dibaca sekali oleh owner ke password manager | Operator + owner | Hapus bagian remote dari `rclone.conf` |
| 5 | Pasang `sq-core-kerja-media-offhost` dan jalankan sekali dengan satu berkas uji; buktikan `cryptcheck` bersih dan berkas bisa ditarik balik | Operator | Nonaktifkan cron |
| 6 | Registry Application Access `kerja-sq`, beri akses Kepala HCM, `kerja:admin grant` Kepala HCM | Platform Administrator | Status `inactive`, cabut akses |
| 7 | **Edge route** `kerja.sabilulquran.or.id` → 3202/3302 dengan `/internal/*` diblokir; uji route | Operator | Hapus route |
| 8 | **DNS** `kerja.sabilulquran.or.id` (CNAME ke tunnel) oleh **pemilik akun Cloudflare Yayasan** — zona `sabilulquran.or.id` ada di akun Cloudflare Yayasan, bukan akun operator. Jangan dibuat lewat panel hosting lain | Pemilik Cloudflare Yayasan | Hapus record |
| 9 | Buat 13 ruang tetap dari Directory lewat CLI, tunjuk penanggung jawab tiap ruang **sebelum** anggotanya diundang | Operator atas persetujuan Kepala HCM | Ruang `status = 'arsip'` |
| 10 | Beri Application Access kepada jajaran direktur dan kepala unit; sosialisasi tahap pertama | Platform Administrator | Cabut akses |
| 11 | Setelah kepala unit terbiasa, beri akses wakasek dan TU/operator (KERJA-001 §14 nomor 9) | Platform Administrator | Cabut akses |
| 12 | Tinjauan pemakaian minggu ketiga; ruang yang tidak dipakai ditutup (KERJA-001 §13.1) | Kepala HCM | — |

Langkah 8 mengikuti pelajaran insiden DNS menggantung: subdomain yang pensiun harus dihapus record-nya, dan dibuat lewat tunnel Mi8, bukan lewat panel hosting.

## 16. Hal yang masih perlu diputuskan

Product Owner belum memutuskan butir-butir ini. Nomor `D-n` dipakai sebagai rujukan di seluruh dokumen.

| # | Topik | Saran |
| --- | --- | --- |
| D-1 | Lampiran dienkripsi di disk Mi8? | **Tidak**, ikuti pola Karir SQ: kepemilikan berkas 0700 di disk, enkripsi pada salinan Drive. Kirim SQ memilih sebaliknya (KIRIM-IMPL-001 D-8) karena medianya datang dari luar dan memuat dokumen pihak ketiga; lampiran Kerja SQ adalah berkas kerja internal. Bila PO menghendaki sama dengan Kirim, biayanya satu lapis enkripsi kolom dan kunci cadangan tambahan |
| D-2 | Siapa boleh membuat ruang di R1 | **`kerja_admin` saja**, lewat CLI untuk 13 ruang tetap dan lewat layar admin untuk ruang panitia. Layar pembuatan oleh kepala unit menyusul di R2 |
| D-3 | Apakah peninjau organ yayasan ikut di R1 | **Tidak.** Organ melihat Ringkasan Yayasan di R3, bukan isi kartu (KERJA-001 §14 nomor 6) |
| D-4 | SMPIT dan PKBM: satu ruang atau dua | **Dua ruang terpisah**, dengan tiga wakasek menjadi anggota keduanya. Unitnya memang terpisah, dan menggabungkan ruang akan mencampur pekerjaan dua satuan pendidikan |
| D-5 | Retensi `kerja_riwayat` dan `kerja_audit` | **Selamanya di R1.** Volumenya kecil pada 26 pengguna; tinjau setelah setahun |
| D-6 | Kuota ruang bawaan 2 GB | Angka usulan, belum dihitung terhadap pemakaian nyata. Tinjau setelah tiga bulan |
| D-7 | Apakah `peninjau` perlu ada di R1 | **Ya**, karena Kepala Bidang Pendidikan dan Mudir perlu melihat papan unit di bawahnya tanpa ikut mengerjakan |

## 17. Dampak pada dokumen lain

- **KERJA-001:** setelah spesifikasi ini ACCEPTED, catat tabel tambahan (`kerja_ruang_usulan`, `kerja_notifikasi`, `kerja_admins`, `kerja_audit`) dan aturan izin per peran ruang di §7 dan §11.
- **`docs/specs/README.md`:** KERJA-IMPL-001 ditambahkan (selesai di PR ini).
- **Roadmap and decision register:** baris Kerja SQ diperbarui saat spesifikasi ACCEPTED.
- **`scripts/mi8/`:** `sq-core-kerja-media-offhost` disalin ke repo setelah dipasang di host, mengikuti aturan "production tetap otoritatif".
- **Rencana kapasitas:** `KERJA_MEDIA_ROOT` masuk daftar direktori yang dipantau.

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-10-20 | DRAFT pertama untuk R1 dari KERJA-001 revisi 4 |
