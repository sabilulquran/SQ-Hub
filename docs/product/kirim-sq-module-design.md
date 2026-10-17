# Kirim SQ — Desain modul

**Status:** DRAFT / DISCOVERY. Dokumen ini tidak mengizinkan implementasi atau perubahan production.
**Spesifikasi:** KIRIM-001 (belum ada spesifikasi implementasi)
**Tanggal:** 2026-10-17 (revisi 2)
**Terkait:** ADR-0001, ADR-0006, ADR-0010, ADR-0011; SPMB SQ `sq-spmb/docs/product/module-design.md` (§6.8, §8), `sq-spmb/docs/specs/SPMB-IMPL-001-r0-fondasi-pengaturan-publik.md`; JalurPesan `jalurpesan.web.id/README.md`

## 1. Dasar

Kirim SQ adalah **layanan WhatsApp milik yayasan** untuk semua aplikasi SQ Core. Kirim SQ hanya cangkangnya. Pengiriman sebenarnya dikerjakan oleh **mesin** yang bisa diganti. Untuk sementara mesinnya JalurPesan, gateway Baileys yang sudah berjalan di Mi8.

Keputusan Product Owner (2026-10-17):

1. Nama modul **Kirim SQ**.
2. Cangkang (data, aturan, riwayat) milik yayasan. Mesin (sesi WhatsApp, Baileys) **menumpang JalurPesan** sampai SQ Core punya server sendiri.
3. SQ Core **tidak memasang Baileys** sekarang. Mi8 hanya punya ~1 GiB MemAvailable, jadi proses Baileys kedua tidak sepadan.
4. Trial dengan **2 nomor**: nomor HCIS dan nomor SPMB.
5. **Setiap nomor milik satu modul** (mis. nomor HCIS milik HCIS, nomor SPMB milik SPMB).
6. **Fitur dasar dibangun sekali di Kirim SQ, dibuka dari menu di tiap modul (revisi 2):** menyambungkan nomor, mengirim, menerima, menyimpan percakapan, inbox, dan balas. Modul yang memakai WA mendapat menu **WhatsApp** yang membuka inbox nomor miliknya saja.
7. **Fitur khusus tetap di modul pemakai**, mis. "Jadikan Peminat" di SPMB atau "Kirim slip gaji" di HCIS.
8. **Percakapan disimpan selamanya** (revisi 2), dengan gate kapasitas disk (§12).
9. **Pengelola Kirim SQ:** Kepala HCM sebagai `kirim_admin`, dan boleh mendelegasikan ke admin SQ Core (revisi 2).
10. **Nomor baru khusus per bidang**, bukan nomor pribadi atau nomor utama kantor. Nomor resmi SPMB yang sudah dikenal publik tetap dipakai (revisi 2).
11. **Jam kirim otomatis 06.00–21.00 WIB.** Balasan manual dan kode verifikasi bebas jam (revisi 2).

Kebutuhan lintas aplikasi sudah nyata (syarat ADR-0001):

| Pemakai | Kebutuhan | Sumber |
| --- | --- | --- |
| Keluarga SQ | Kode verifikasi dan pemulihan akun keluarga | ADR-0010 |
| SPMB | Notifikasi status, pengingat, tautan daftar; WA masuk menjadi Peminat; inbox bersama | SPMB-001 §6.8, §8 |
| HCIS | Notifikasi pegawai (slip, cuti, presensi), undangan, inbox admin HCIS | Rencana |
| Karir SQ | Undangan tes/wawancara, status lamaran | Rencana |
| Keuangan | Tagihan dan kuitansi (PDF resmi) | Rencana |
| Media, Sosial | Pengumuman, informasi program, donatur | Rencana |

## 2. Batas tanggung jawab

| Urusan | **Kirim SQ** (dibangun sekali) | **Modul pemakai** |
| --- | --- | --- |
| Nomor | Mendaftarkan nomor, scan QR/kode pairing, status tersambung, modul pemilik | — |
| Pengiriman otomatis | Antrean, retry, batas laju per nomor, jam kirim, idempotensi | Menentukan **kapan** dan **kepada siapa** |
| Isi | Meneruskan teks atau dokumen yang sudah jadi | Menyusun isi, templat, dan PDF-nya sendiri |
| Status | Mencatat diterima mesin, terkirim, dibaca, gagal; memberi tahu pengirim | Menyimpan status di datanya (mis. "tagihan sudah dikirim") |
| Pesan masuk | Menyimpan ke percakapan, meneruskan ke modul pemilik nomor | Mengolahnya (mis. SPMB membuat Peminat) |
| Inbox dan balas | Daftar percakapan, isi chat, balas teks/dokumen, tanda sudah dibaca, siapa petugas yang membalas | Menu **WhatsApp** yang membuka inbox nomornya |
| Fitur khusus | Tombol aksi yang didaftarkan modul (tautan kembali ke modul) | Isi dan logika aksinya, mis. "Jadikan Peminat" |
| Kepatuhan | Daftar jangan-hubungi, log audit, kuota per modul | Persetujuan pemberitahuan yang khusus domain (mis. persetujuan prospek di Keluarga SQ) |

Yang **tidak** dibangun di Kirim SQ:

- templat dan isi pesan per domain;
- CRM, pipeline peminat, atau data kontak per domain;
- broadcast massal ke grup atau daftar yang tidak punya hubungan dengan yayasan;
- logika bisnis modul (status pendaftar, slip gaji, tagihan).

## 3. Letak dan arsitektur

### 3.1 Letak: modul di SQ Hub

Kirim SQ dibangun sebagai **modul `kirim` di SQ Hub** (API dan web), bukan aplikasi atau proses baru (ADR-0011).

| Pertimbangan | Modul SQ Hub | Aplikasi sendiri |
| --- | --- | --- |
| Memori Mi8 | Tidak ada proses baru | Satu proses Node lagi (~80–120 MiB RSS) |
| ADR-0001 | Cocok: shared capability lintas domain | Juga boleh, tetapi bukan domain bisnis |
| Kemandirian rilis | Ikut rilis SQ Hub | Rilis sendiri |
| Pindah kelak | Bisa diekstrak karena tabel dan rute terpisah | — |

Konsekuensinya:

- Tabel memakai awalan `kirim_` di database SQ Hub. Rute di bawah `/internal/kirim/*` (API modul pemakai) dan `/api/kirim/*` (layar Kirim SQ).
- Kode modul tidak mengimpor modul SQ Hub lain kecuali auth dan Application Access, supaya bisa diekstrak.
- Kalau SQ Hub sedang rilis atau mati, pemakai menyimpan permintaan di sisinya dan mengulang dengan kunci idempotensi yang sama (§5.1). Ini sesuai larangan "jangan membuat setiap request domain bergantung sinkron pada SQ Hub" di target architecture.

### 3.2 Alur

```text
HCIS / Karir / Keuangan / SPMB / Keluarga SQ (backend)
        │  POST /internal/kirim/messages  (token client credentials, Idempotency-Key)
        ▼
SQ Hub API ── modul kirim ── kirim_outbox, kirim_conversations, kirim_messages (PostgreSQL)
        │                         │
        │   worker kirim (di proses SQ Hub API, interval pendek)
        ▼                         ▼
   Provider per nomor:  log  |  jalurpesan  |  (kelak) jalurpesan-sendiri / meta-cloud
                                   │
                                   ▼
                     JalurPesan 127.0.0.1:3401  ── Baileys ── WhatsApp
                                   │
            webhook bertanda tangan + GET .../events?after= (pemulihan)
                                   ▼
        SQ Hub API: simpan ke percakapan → status ke outbox → webhook ke modul pemilik

Petugas modul ──► menu "WhatsApp" di HCIS/SPMB ──► kirim.sabilulquran.or.id/inbox/<nomor>
                                                   (inbox, balas, tombol aksi modul)
```

### 3.3 Menu WhatsApp di modul pemakai

- Setiap modul yang punya nomor menampilkan menu **WhatsApp** (mis. di menu SPMB staf, di menu admin HCIS).
- Menu itu membuka **inbox Kirim SQ** untuk nomor milik modul itu, di `kirim.sabilulquran.or.id/inbox/<kode-nomor>`, dengan tampilan SQ Design System yang sama. Petugas tidak perlu masuk lagi karena memakai SSO Akun SQ.
- Inbox hanya menampilkan nomor yang petugas itu ditugaskan (§8). Admin SPMB hanya melihat chat nomor SPMB, admin HCIS hanya chat nomor HCIS.
- **Tombol aksi modul:** modul mendaftarkan aksi untuk nomornya, mis. SPMB mendaftarkan "Jadikan Peminat" → `https://spmb.sabilulquran.or.id/staf/peminat/baru?wa=<id-percakapan>`. Inbox menampilkannya sebagai tombol, dan logikanya tetap di modul.
- Menanamkan inbox langsung di dalam halaman modul (komponen bersama) **belum** dilakukan. Itu menunggu strategi distribusi komponen bersama sesuai AGENTS.md §8, dan bisa menyusul tanpa mengubah data.

### 3.4 Provider

Kontrak provider internal (satu antarmuka, beberapa adapter):

- `sendText(device, to, text, idempotencyKey)`
- `sendDocument(device, to, file, caption, idempotencyKey)`
- `markRead(device, conversation)`
- `deviceStatus(device)`, `startPairing(device)`
- `pullEvents(device, cursor)` untuk pemulihan

| Provider | Kegunaan | Catatan |
| --- | --- | --- |
| `log` | Development dan default sebelum nomor siap | Tidak mengirim; status langsung `sent` dengan penanda `dry_run` |
| `jalurpesan` | Trial dan produksi awal | Satu **platform** JalurPesan `sq-core`; setiap nomor Kirim SQ = satu **tenant** JalurPesan (`/api/v1/platform/tenants/:externalTenantId/...`) |
| `jalurpesan` instance sendiri | Saat SQ Core pindah server | Adapter sama, hanya URL dan kunci berbeda |
| `meta-cloud` | Kalau yayasan memakai WhatsApp Business Platform resmi | Butuh templat yang disetujui Meta untuk pesan di luar jendela 24 jam |

Provider dipilih **per nomor** di konfigurasi, bukan di kode, sehingga bisa dipindah tanpa rilis.

## 4. Data

| Tabel | Kolom utama | Catatan |
| --- | --- | --- |
| `kirim_devices` | `id`, `kode` (mis. `hcis`, `spmb`), `label`, `pemilik_consumer_id`, `provider`, `provider_ref` (tenant JalurPesan), `nomor_tersamar`, `status` (`belum_dipasang`, `menunggu_pairing`, `tersambung`, `terputus`, `nonaktif`), `rate_per_menit`, `jam_kirim_mulai`, `jam_kirim_selesai`, `updated_at` | Satu nomor punya satu modul pemilik |
| `kirim_consumers` | `id`, `client_id` (Keycloak), `nama` (mis. `hcis`, `spmb`), `webhook_url`, `webhook_secret_ref`, `kuota_harian`, `aktif` | Satu baris per aplikasi pemakai |
| `kirim_routes` | `consumer_id`, `device_id`, `jenis` (`notifikasi`, `kode`) | Modul lain yang boleh **mengirim** lewat nomor itu (mis. Keluarga SQ mengirim kode lewat nomor SPMB). Inbox tetap milik pemilik nomor |
| `kirim_device_members` | `device_id`, `principal` (`issuer + sub`), `peran` (`petugas`), `ditambahkan_oleh`, `created_at` | Petugas yang boleh membuka inbox dan membalas |
| `kirim_actions` | `device_id`, `label`, `url_template`, `urutan` | Tombol aksi yang didaftarkan modul pemilik (§3.3) |
| `kirim_conversations` | `id`, `device_id`, `kontak_hmac`, `kontak_enc`, `nama_profil`, `pesan_terakhir_at`, `belum_dibaca`, `ditangani_oleh` | Satu per nomor lawan bicara per device |
| `kirim_messages` | `id`, `conversation_id`, `arah` (`masuk`, `keluar`), `asal` (`otomatis`, `petugas`), `petugas` (principal) nullable, `body_enc`, `media_ref`, `provider_message_id`, `status`, `created_at` | Semua pesan masuk dan keluar, **disimpan selamanya** (§12) |
| `kirim_outbox` | `id`, `consumer_id`, `device_id`, `idempotency_key`, `jenis`, `prioritas`, `to_hmac`, `message_id`, `status` (`antre`, `diserahkan`, `terkirim`, `dibaca`, `gagal`, `dibatalkan`), `attempts`, `next_attempt_at`, `error_code`, `created_at`, `expires_at` | Unik (`consumer_id`, `idempotency_key`). Isi pesan di `kirim_messages` |
| `kirim_media` | `id`, `device_id`, `mime`, `ukuran`, `sha256`, `path` | Berkas di disk Mi8, bukan di database |
| `kirim_optouts` | `nomor_hmac`, `cakupan` (`semua` atau `consumer_id`), `alasan`, `created_at` | Diperiksa sebelum kirim otomatis, kecuali jenis `kode` |
| `kirim_events` | `id`, `device_id`, `provider_cursor`, `jenis`, `payload_ringkas`, `received_at` | Cursor pemulihan dari `GET .../events?after=` |
| `kirim_audit` | aktor, aksi, objek, waktu | Pairing, ganti provider, tambah/hapus petugas, opt-out manual, putus nomor, membuka percakapan |

Isi pesan dan nomor utuh disimpan terenkripsi di kolom (`*_enc`), dan dicari lewat HMAC (`*_hmac`).

## 5. Kontrak untuk aplikasi pemakai

Autentikasi backend: token **client credentials** realm `sq-staff` (pola `spmb-api`), dengan audience `sq-hub-kirim`. Kirim SQ memetakan `client_id` ke `kirim_consumers`.

### 5.1 Kirim pesan otomatis

`POST /internal/kirim/messages` dengan header `Idempotency-Key`:

```json
{
  "device": "hcis",
  "jenis": "notifikasi",
  "to": "+6281234567890",
  "text": "Assalamu'alaikum ... tautan: https://hcis.sabilulquran.or.id/...",
  "media_id": null,
  "prioritas": "normal",
  "kedaluwarsa": "2026-10-18T07:00:00+07:00",
  "ref": "hcis:leave-request:8f2c"
}
```

- Jawaban `202 Accepted` dengan `{ "id", "status": "antre" }`. Permintaan ulang dengan kunci yang sama mengembalikan pesan yang sama tanpa mengirim ulang.
- `media_id`: unggah dulu lewat `POST /internal/kirim/media` (PDF, maks. 5 MiB). Kirim SQ tidak pernah mengambil URL luar.
- `jenis: "kode"` (OTP) memakai prioritas tertinggi, mengabaikan jam kirim dan opt-out, dan kedaluwarsa dalam 10 menit. Isi kode tidak ditampilkan di inbox (disamarkan).
- Ditolak `422` bila nomor ada di daftar jangan-hubungi, rute tidak mengizinkan, atau kuota habis.
- Pesan otomatis ikut tampil di inbox sebagai pesan keluar berlabel "otomatis".

### 5.2 Event ke modul pemakai

Kirim SQ memanggil `webhook_url` pemakai dengan tanda tangan HMAC:

| Event | Isi | Dikirim ke |
| --- | --- | --- |
| `message.status` | `id`, `ref`, `status`, `error_code` | Modul yang mengirim |
| `message.received` | `device`, `conversation_id`, `from`, `nama_profil`, `cuplikan` (maks. 200 karakter), `received_at` | Modul pemilik nomor |
| `device.status` | `device`, `status` | Modul pemilik dan modul yang punya rute |

Pemakai juga bisa menarik status lewat `GET /internal/kirim/messages/:id`.

### 5.3 Pendaftaran tombol aksi

`PUT /internal/kirim/devices/:kode/actions` oleh modul pemilik nomor, berisi daftar `{ label, url_template }`. `url_template` hanya boleh mengarah ke host modul itu sendiri, dan memakai `conversation_id`, bukan nomor utuh.

## 6. Pengiriman dan keselamatan nomor

- **Batas laju per nomor:** awal 10 pesan otomatis/menit dengan jeda acak 2–6 detik. Jenis `kode` dan balasan petugas boleh mendahului antrean.
- **Jam kirim otomatis** untuk `notifikasi`: 06.00–21.00 WIB. Pesan di luar jam itu ditahan sampai pagi kecuali `kedaluwarsa` lebih dulu. **Balasan petugas dari inbox dan jenis `kode` bebas jam.**
- **Retry:** 3 kali dengan backoff (1, 5, 30 menit). Setelah itu status `gagal` dan pengirim diberi tahu.
- **Nomor terputus:** antrean berhenti untuk nomor itu, `device.status` dikirim, inbox menampilkan "Nomor WhatsApp tidak tersambung", dan Kirim SQ admin diberi peringatan. Pesan tidak dialihkan otomatis ke nomor lain.
- **Isi pesan otomatis:** sebaiknya membawa tautan ke aplikasi, bukan data sensitif utuh (mis. "Slip gaji Oktober sudah tersedia" + tautan, bukan nominal gaji).

## 7. Nomor untuk trial

| Kode | Pemilik (inbox) | Boleh mengirim juga | Nomor |
| --- | --- | --- | --- |
| `hcis` | HCIS (admin HCIS) | Karir SQ (notifikasi), sampai Karir punya nomor sendiri | Nomor baru khusus |
| `spmb` | SPMB (panitia) | Keluarga SQ (`kode`), sampai Keluarga SQ punya nomor sendiri | Nomor resmi SPMB yang sudah ada |

Keuangan, Sosial, dan Media mendapat nomor sendiri saat mulai memakai WA (roadmap: satu nomor resmi per bidang). Kalau satu nomor diblokir, nomor bidang lain tetap jalan.

## 8. Akses dan layar

Kirim SQ tampil seperti aplikasi SQ Core lain:

- **Alamat:** `kirim.sabilulquran.or.id`, dilayani proses SQ Hub web dan API yang sudah ada (rute host di edge), jadi tetap tanpa proses baru. API modul pemakai (`/internal/kirim/*`) hanya lewat loopback dan diblokir di edge.
- **Akses:** terdaftar di SQ Hub **Application Access** sebagai aplikasi "Kirim SQ". Tile di Launcher **hanya tampil bagi staf yang punya akses**.
- **Peran:**

| Peran | Siapa | Bisa |
| --- | --- | --- |
| `kirim_admin` | Kepala HCM; boleh didelegasikan ke admin SQ Core | Menambah nomor, scan QR, memutus, ganti provider, menetapkan modul pemilik dan rute, menambah petugas per nomor, daftar jangan-hubungi, melihat aktivitas |
| `petugas` per nomor | Ditetapkan `kirim_admin` atas usulan modul (mis. panitia SPMB untuk nomor `spmb`) | Membuka inbox nomor itu, membalas, menandai dibaca, memakai tombol aksi modul |

Layar:

- **Nomor** (admin): daftar nomor, status, scan QR/kode pairing, putuskan, nonaktifkan, ganti provider, pemilik, petugas.
- **Inbox** (petugas): daftar percakapan per nomor, isi chat, balas teks/dokumen, label otomatis/petugas, nama petugas yang membalas, tombol aksi modul.
- **Antrean** (admin): jumlah antre/gagal per nomor, coba ulang, batalkan.
- **Jangan hubungi** (admin): tambah atau hapus nomor.
- **Aktivitas** (admin): audit dan ringkasan harian per modul.

`kirim_admin` tidak otomatis bisa membaca isi chat. Untuk membaca, admin harus menambahkan dirinya sebagai petugas nomor itu, dan tindakan itu tercatat di audit.

## 9. Tahapan

| Tahap | Isi |
| --- | --- |
| **R1** | Nomor dan pairing, kirim otomatis (§5.1), simpan semua pesan masuk/keluar, event ke modul (§5.2), layar Nomor dan Antrean |
| **R2** | Inbox dan balas dari `kirim.sabilulquran.or.id`, menu WhatsApp di HCIS dan SPMB, petugas per nomor, tombol aksi modul |
| Kelak | Inbox ditanam langsung di halaman modul (komponen bersama), kanal email, pindah mesin |

Karena R1 sudah menyimpan semua pesan, inbox R2 langsung punya riwayat sejak trial dimulai.

## 10. Pindah mesin (runbook ringkas)

1. Siapkan mesin baru dan provider-nya dengan provider `log` lalu nomor uji.
2. Untuk setiap nomor: hentikan antrean, tunggu `diserahkan` = 0.
3. Ganti `provider` dan `provider_ref` nomor itu, lalu **pairing ulang** (sesi WhatsApp tidak bisa dipindah).
4. Jalankan lagi antrean dan pantau status 24 jam.
5. Riwayat percakapan tetap ada di Kirim SQ, karena disimpan di `kirim_messages`, bukan di mesin.

Modul pemakai tidak berubah sama sekali.

## 11. Dampak pada dokumen lain

- **Semua modul pemakai** (SPMB, Keluarga SQ, HCIS, Karir, Keuangan, dan seterusnya): kirim WA otomatis lewat port sendiri (mis. `WhatsAppSender`) dengan dua adapter, `log` (default) dan `kirim` (HTTP ke kontrak §5). Modul pemakai **tidak** memanggil JalurPesan langsung, tidak memasang Baileys, dan **tidak membangun inbox sendiri**. Selama Kirim SQ belum jalan, adapter `log` dipakai, sehingga pengembangan modul tidak menunggu Kirim SQ. Adapter langsung ke JalurPesan hanya boleh sebagai jalan darurat dengan persetujuan PO.
- **SPMB-IMPL-001:** port `WhatsAppSender` tetap, tetapi adapter JalurPesan langsung diganti adapter `log` + `kirim`. Pesan masuk ke nomor SPMB datang lewat webhook `message.received` dari Kirim SQ. Inbox bersama SPMB (SPMB-001 §6.8) adalah inbox Kirim SQ R2, dibuka dari menu WhatsApp SPMB, dengan tombol aksi "Jadikan Peminat".
- **Keluarga SQ (KEL-IMPL-001):** relay kode `POST /internal/otp-deliveries` mengirim lewat Kirim SQ dengan `jenis: "kode"` di nomor `spmb`.
- **ADR-0011:** Kirim SQ sebagai shared capability SQ Hub dengan mesin yang bisa diganti.

## 12. Operasional dan gate Mi8

- Tidak ada proses baru. Worker kirim berjalan di proses SQ Hub API; tambahan memori diperkirakan < 20 MiB.
- Beban tambahan ada di JalurPesan: perkiraan 30–80 MiB per nomor (belum diukur). Ukur RSS JalurPesan dan MemAvailable sebelum pairing dan selama 7 hari.
- **Batas berhenti memori:** MemAvailable rata-rata 7 hari < 900 MiB, atau RSS JalurPesan terus naik → hentikan penambahan nomor dan rencanakan pindah mesin.
- **Simpan selamanya dan kapasitas disk:** teks kecil (perkiraan < 1 GiB per tahun untuk 2 nomor), tetapi media bisa besar. Ukuran `kirim_messages` dan folder media masuk laporan harian. **Gate:** bila disk bebas Mi8 < 10 GiB, media lama dipindahkan ke arsip off-host sesuai rencana backup, bukan dihapus. Keputusan menghapus apa pun butuh PO.
- **Privasi:** percakapan bisa berisi data anak dan keuangan. Isi terenkripsi di kolom, akses hanya petugas nomor itu, dan setiap pembukaan percakapan tercatat di audit.
- **Backup:** tabel `kirim_*` ikut dump database SQ Hub; media ikut arsip backup SQ Hub. Sesi WhatsApp ada di JalurPesan dan backup-nya belum konsisten (`CONSISTENCY_BLOCKED`); kalau Mi8 rusak, nomor dipairing ulang, dan riwayat percakapan tetap aman di Kirim SQ.

## 13. Pertanyaan terbuka

Semua pertanyaan sudah dijawab PO pada 2026-10-17:

- Revisi 1: lama simpan, pengelola, nomor, jam kirim (§1 butir 8–11).
- Urutan bangun: **Kirim SQ R1 dulu**; SPMB R0 jalan dengan adapter `log` sambil menunggu (KIRIM-IMPL-001 D-13).
- Petugas inbox awal untuk `hcis` dan `spmb`: **ditetapkan Kepala HCM saat R2**, atas usulan kepala bidang masing-masing; tidak memblokir R1 (KIRIM-IMPL-001 D-13).
- Keputusan teknis R1 lainnya ada di KIRIM-IMPL-001 §16.

## Riwayat keputusan

| Tanggal | Keputusan |
| --- | --- |
| 2026-10-17 | Nama **Kirim SQ**. Cangkang milik yayasan; mesin menumpang JalurPesan; tidak memasang Baileys di SQ Core. |
| 2026-10-17 | Logika bisnis tetap di modul pemakai; Kirim SQ mengelola nomor dan jalur kirim. |
| 2026-10-17 | Alamat `kirim.sabilulquran.or.id`; tampil di Launcher hanya bagi yang punya akses lewat Application Access. |
| 2026-10-17 (revisi 2) | Fitur dasar (inbox, balas, simpan percakapan) dibangun sekali di Kirim SQ dan dibuka dari menu WhatsApp di tiap modul; fitur khusus tetap di modul. Setiap nomor milik satu modul. |
| 2026-10-17 (revisi 2) | Percakapan disimpan selamanya; `kirim_admin` = Kepala HCM (boleh didelegasikan ke admin SQ Core); nomor baru khusus per bidang; jam kirim otomatis 06.00–21.00 WIB. Trial: nomor `hcis` dan `spmb`. |
| 2026-10-17 | ADR-0011 diterima PO. |
| 2026-10-17 | Urutan bangun dan petugas inbox awal diputuskan (§13); keputusan teknis R1 di KIRIM-IMPL-001 §16. |
