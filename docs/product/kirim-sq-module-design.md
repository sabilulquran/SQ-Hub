# Kirim SQ — Desain modul

**Status:** DRAFT / DISCOVERY. Dokumen ini tidak mengizinkan implementasi atau perubahan production.
**Spesifikasi:** KIRIM-001; spesifikasi implementasi R1: KIRIM-IMPL-001 (ACCEPTED 2026-10-17); R2 belum punya spesifikasi implementasi
**Tanggal:** 2026-10-19 (revisi 3)
**Terkait:** ADR-0001, ADR-0006, ADR-0010, ADR-0011 (dengan amandemen 2026-10-19); SPMB SQ `sq-spmb/docs/product/kelola-peminat-dan-whatsapp.md` (SPMB-002), `sq-spmb/docs/product/module-design.md` (§6.8, §8), `sq-spmb/docs/specs/SPMB-IMPL-001-r0-fondasi-pengaturan-publik.md`; JalurPesan `jalurpesan.web.id/README.md`

> **Perubahan revisi 3 (2026-10-19).** Keputusan Product Owner: Kirim SQ **hanya mesin di balik layar**, yaitu API WhatsApp milik yayasan (nomor, kirim, terima, simpan chat dan media, status terkirim/dibaca, jangan-hubungi, batas laju). Kotak masuk staf dan pengelolaan peminat dibangun **di modul pemilik nomor**, dimulai dari SPMB (SPMB-002). Akibatnya:
>
> - Kirim SQ R2 menjadi **API percakapan** untuk modul pemilik nomor (§5.3), bukan layar inbox.
> - Tidak dibangun lagi: layar inbox `kirim.sabilulquran.or.id/inbox/<nomor>`, menu WhatsApp di tiap modul yang membuka Kirim SQ, tombol aksi modul (`kirim_actions`), petugas per nomor (`kirim_device_members`), dan `kirim_conversations.ditangani_oleh`. Penugasan percakapan kini milik modul.
> - Isi chat dan media **tetap disimpan di Kirim SQ**, terenkripsi dan selamanya (dikonfirmasi PO 2026-10-19, §13 no. 7).
> - Tambahan PO 2026-10-19: API grup (§5.4) dan impor riwayat chat lama (§5.5).

## 1. Dasar

Kirim SQ adalah **layanan WhatsApp milik yayasan** untuk semua aplikasi SQ Core. Kirim SQ hanya cangkangnya. Pengiriman sebenarnya dikerjakan oleh **mesin** yang bisa diganti. Untuk sementara mesinnya JalurPesan, gateway Baileys yang sudah berjalan di Mi8.

Keputusan Product Owner:

1. Nama modul **Kirim SQ**.
2. Cangkang (data, aturan, riwayat) milik yayasan. Mesin (sesi WhatsApp, Baileys) **menumpang JalurPesan** sampai SQ Core punya server sendiri.
3. SQ Core **tidak memasang Baileys** sekarang. Mi8 hanya punya ~1 GiB MemAvailable, jadi proses Baileys kedua tidak sepadan.
4. Trial dengan **2 nomor**: nomor HCIS dan nomor SPMB.
5. **Setiap nomor milik satu modul** (mis. nomor HCIS milik HCIS, nomor SPMB milik SPMB).
6. **Kirim SQ hanya mesin dan API, tanpa layar untuk staf modul (revisi 3, menggantikan butir 6 revisi 2).** Kirim SQ menyambungkan nomor, mengirim, menerima, menyimpan percakapan dan media, mencatat status, dan membuka **API percakapan** untuk modul pemilik nomor. Kotak masuk, penugasan, dan balasan staf adalah layar modul itu sendiri.
7. **Fitur khusus dan tempat kerja staf ada di modul pemilik nomor**, mis. kotak masuk panitia dan pengelolaan peminat di SPMB (SPMB-002), atau "Kirim slip gaji" di HCIS.
8. **Percakapan disimpan selamanya** (revisi 2), dengan gate kapasitas disk (§12). Revisi 3 menganggap isi chat tetap disimpan sekali di Kirim SQ dan modul membacanya lewat API tanpa menyalinnya (saran, §13 no. 7).
9. **Pengelola Kirim SQ:** Kepala HCM sebagai `kirim_admin`, dan boleh mendelegasikan ke admin SQ Core (revisi 2).
10. **Nomor baru khusus per bidang**, bukan nomor pribadi atau nomor utama kantor. Nomor resmi SPMB yang sudah dikenal publik tetap dipakai (revisi 2).
11. **Jam kirim otomatis 06.00–21.00 WIB.** Balasan petugas dan kode verifikasi bebas jam (revisi 2).

Kebutuhan lintas aplikasi sudah nyata (syarat ADR-0001):

| Pemakai | Kebutuhan | Sumber |
| --- | --- | --- |
| Keluarga SQ | Kode verifikasi dan pemulihan akun keluarga | ADR-0010 |
| SPMB | Notifikasi status, pengingat, tautan daftar; WA masuk menjadi Peminat; API percakapan untuk kotak masuk panitia di SPMB | SPMB-001 §6.8, §8; SPMB-002 |
| HCIS | Notifikasi pegawai (slip, cuti, presensi), undangan; kelak kotak masuk admin HCIS yang dibangun di HCIS (§11) | Rencana |
| Karir SQ | Undangan tes/wawancara, status lamaran | Rencana |
| Keuangan | Tagihan dan kuitansi (PDF resmi) | Rencana |
| Media, Sosial | Pengumuman, informasi program, donatur | Rencana |

## 2. Batas tanggung jawab

| Urusan | **Kirim SQ** (dibangun sekali) | **Modul pemilik nomor / pemakai** |
| --- | --- | --- |
| Nomor | Mendaftarkan nomor, scan QR/kode pairing, status tersambung, modul pemilik | — |
| Pengiriman otomatis | Antrean, retry, batas laju per nomor, jam kirim, idempotensi | Menentukan **kapan** dan **kepada siapa** |
| Isi | Meneruskan teks, gambar, atau dokumen yang sudah jadi | Menyusun isi, templat, balasan cepat, dan PDF-nya sendiri |
| Status | Mencatat diterima mesin, terkirim, dibaca, gagal; memberi tahu pengirim dan pemilik nomor | Menyimpan status di datanya (mis. "tagihan sudah dikirim") |
| Pesan masuk | Menyimpan isi dan media ke percakapan, meneruskan event ke modul pemilik nomor | Mengolahnya (mis. SPMB membuat Peminat) |
| Percakapan | **API percakapan** (§5.3): daftar percakapan, isi pesan, unduh media, balas atas nama petugas, tandai dibaca | **Kotak masuk staf**: layar, saringan, siapa yang memegang, status ditangani, catatan, dan aturan siapa boleh membaca |
| Penugasan | — (tidak ada lagi `ditangani_oleh`) | Petugas yang memegang percakapan, ambil alih, antrean (mis. tabel penanganan percakapan di SPMB) |
| Kepatuhan | Daftar jangan-hubungi, audit pengiriman dan pembacaan lewat API, kuota per modul | Hak akses staf, persetujuan pemberitahuan yang khusus domain (mis. persetujuan prospek di Keluarga SQ), audit kerja staf |

Yang **tidak** dibangun di Kirim SQ:

- layar kotak masuk, balas, atau penugasan untuk staf modul (revisi 3);
- templat, balasan cepat, dan isi pesan per domain;
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

- Tabel memakai awalan `kirim_` di database SQ Hub. Rute di bawah `/internal/kirim/*` (API modul pemakai, termasuk API percakapan) dan `/api/admin/kirim/*` (layar admin Kirim SQ). Awalan `/api/kirim/*` yang dulu disimpan untuk inbox R2 tidak diperlukan lagi.
- Kode modul tidak mengimpor modul SQ Hub lain kecuali auth dan Application Access, supaya bisa diekstrak.
- Kalau SQ Hub sedang rilis atau mati, pemakai menyimpan permintaan di sisinya dan mengulang dengan kunci idempotensi yang sama (§5.1). Ini sesuai larangan "jangan membuat setiap request domain bergantung sinkron pada SQ Hub" di target architecture. Kotak masuk di modul pemilik nomor menampilkan "Riwayat chat sementara tidak bisa dimuat" saat Kirim SQ tidak tersedia; data kerja modul (peminat, tindak lanjut) tetap bisa dibuka.

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

Staf modul (web modul / aplikasi CS) ──► API staf modul pemilik nomor (mis. SPMB)
        │  modul memeriksa hak akses staf, lalu memanggil atas nama petugas
        ▼
GET/POST /internal/kirim/devices/:kode/conversations, /internal/kirim/conversations/:id/...
```

Browser dan aplikasi staf **tidak pernah** memanggil Kirim SQ atau JalurPesan langsung.

### 3.3 Kotak masuk di modul pemilik nomor (revisi 3)

Bagian ini menggantikan "Menu WhatsApp di modul pemakai" dari revisi 2.

- Modul yang memiliki nomor membangun **kotak masuknya sendiri** di ruang stafnya, dengan pola SQ Design System. SPMB yang pertama (SPMB-002 §7).
- Modul itu memegang **aturan kerja**: siapa boleh membaca dan membalas, penugasan dan ambil alih, status ditangani, catatan staf, dan balasan cepat. Kirim SQ tidak menyimpan semua itu.
- Modul memanggil API percakapan (§5.3) dengan **token client credentials miliknya** dan menyebut **petugas** yang sedang bekerja (`issuer + sub` Akun SQ). Kirim SQ mencatat petugas itu di pesan keluar dan di audit.
- Kirim SQ hanya melayani API percakapan untuk **modul pemilik nomor** itu. Modul yang hanya punya rute kirim (§4, `kirim_routes`) tidak bisa membaca percakapan.
- Bila kelak beberapa modul butuh kotak masuk yang mirip (mis. SPMB dan HCIS), bagian tampilannya boleh dijadikan **komponen bersama** sesuai AGENTS.md §8. Datanya tetap dari API yang sama, dan aturan kerja tetap di tiap modul.

### 3.4 Provider

Kontrak provider internal (satu antarmuka, beberapa adapter):

- `sendText(device, to, text, idempotencyKey)`
- `sendDocument(device, to, file, caption, idempotencyKey)`; di R2 juga untuk gambar (JPEG/PNG) yang dikirim petugas
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
| `kirim_devices` | `id`, `kode` (mis. `hcis`, `spmb`), `label`, `pemilik_consumer_id`, `provider`, `provider_ref` (tenant JalurPesan), `nomor_tersamar`, `status` (`belum_dipasang`, `menunggu_pairing`, `tersambung`, `terputus`, `nonaktif`), `rate_per_menit`, `jam_kirim_mulai`, `jam_kirim_selesai`, `updated_at` | Satu nomor punya satu modul pemilik. Hanya pemilik yang boleh memakai API percakapan nomor itu |
| `kirim_consumers` | `id`, `client_id` (Keycloak), `nama` (mis. `hcis`, `spmb`), `webhook_url`, `webhook_secret_ref`, `kuota_harian`, `aktif` | Satu baris per aplikasi pemakai |
| `kirim_routes` | `consumer_id`, `device_id`, `jenis` (`notifikasi`, `kode`) | Modul lain yang boleh **mengirim** lewat nomor itu (mis. Keluarga SQ mengirim kode lewat nomor SPMB). Percakapan tetap hanya bisa dibaca pemilik nomor |
| `kirim_conversations` | `id`, `device_id`, `kontak_hmac`, `kontak_enc`, `nama_profil`, `pesan_terakhir_at`, `belum_dibaca` | Satu per nomor lawan bicara per device. Kolom `ditangani_oleh` **tidak dipakai lagi** (revisi 3); penugasan milik modul (§13 no. 1) |
| `kirim_messages` | `id`, `conversation_id`, `arah` (`masuk`, `keluar`), `asal` (`otomatis`, `petugas`), `petugas` (principal `issuer + sub`) nullable, `body_enc`, `media_ref`, `provider_message_id`, `status`, `created_at` | Semua pesan masuk dan keluar, **disimpan selamanya** (§12). `petugas` diisi dari `atas_nama` yang dikirim modul pemilik saat membalas |
| `kirim_outbox` | `id`, `consumer_id`, `device_id`, `idempotency_key`, `jenis`, `prioritas`, `to_hmac`, `message_id`, `status` (`antre`, `diserahkan`, `terkirim`, `dibaca`, `gagal`, `dibatalkan`), `attempts`, `next_attempt_at`, `error_code`, `created_at`, `expires_at` | Unik (`consumer_id`, `idempotency_key`). Isi pesan di `kirim_messages` |
| `kirim_media` | `id`, `device_id`, `mime`, `ukuran`, `sha256`, `path` | Berkas di disk Mi8, bukan di database |
| `kirim_optouts` | `nomor_hmac`, `cakupan` (`semua` atau `consumer_id`), `alasan`, `created_at` | Diperiksa sebelum kirim otomatis, kecuali jenis `kode` (§13 no. 2–3) |
| `kirim_events` | `id`, `device_id`, `provider_cursor`, `jenis`, `payload_ringkas`, `received_at` | Cursor pemulihan dari `GET .../events?after=` |
| `kirim_audit` | aktor, atas nama (petugas), aksi, objek, waktu | Pairing, ganti provider, opt-out manual, putus nomor; di R2 juga membuka isi percakapan, mengunduh media, membalas, dan menandai dibaca lewat API percakapan |

Isi pesan dan nomor utuh disimpan terenkripsi di kolom (`*_enc`), dan dicari lewat HMAC (`*_hmac`).

Tambahan dari KIRIM-IMPL-001 (ACCEPTED 2026-10-17, §4): `kirim_webhook_deliveries` (antrean webhook keluar), `kirim_admins` (siapa `kirim_admin`, D-2), dan `kirim_media_engine_refs` (cache `mediaId` mesin per nomor). Implementasi R1 juga menyimpan satu nilai uji terenkripsi per kunci di `kirim_key_canaries` supaya proses menolak start bila kunci hilang atau salah (KIRIM-IMPL-001 §9).

**Tidak dibuat lagi (revisi 3):** `kirim_device_members` (petugas per nomor) dan `kirim_actions` (tombol aksi modul). Keduanya direncanakan untuk inbox R2 di Kirim SQ dan belum pernah dibuat di R1. Hak akses staf kini diatur modul pemilik nomor.

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
- `jenis: "kode"` (OTP) memakai prioritas tertinggi, mengabaikan jam kirim dan opt-out, dan kedaluwarsa dalam 10 menit. Isi kode selalu disamarkan, juga di API percakapan.
- Ditolak `422` bila nomor ada di daftar jangan-hubungi, rute tidak mengizinkan, atau kuota habis.
- Pesan otomatis ikut tersimpan di percakapan sebagai pesan keluar berlabel "otomatis", sehingga terlihat di kotak masuk modul pemilik nomor.

### 5.2 Event ke modul pemakai

Kirim SQ memanggil `webhook_url` pemakai dengan tanda tangan HMAC, **segera setelah event tersimpan**, supaya kotak masuk modul bisa diperbarui langsung:

| Event | Isi | Dikirim ke |
| --- | --- | --- |
| `message.status` | `id`, `ref`, `status`, `error_code`; untuk pemilik nomor juga `conversation_id` | Modul yang mengirim, **dan** modul pemilik nomor untuk semua pesan keluar di nomornya (revisi 3), supaya tanda terkirim/dibaca tampil di kotak masuk |
| `message.received` | `device`, `conversation_id`, `message_id`, `from`, `nama_profil`, `tipe` (teks, gambar, dokumen, audio, …), `cuplikan` (maks. 200 karakter), `received_at` | Modul pemilik nomor |
| `device.status` | `device`, `status` | Modul pemilik dan modul yang punya rute |

Pemakai juga bisa menarik status lewat `GET /internal/kirim/messages/:id`.

Rincian kontrak di KIRIM-IMPL-001 §2 dan §6.2: header `X-Kirim-Event-Id`, `X-Kirim-Timestamp`, `X-Kirim-Signature` = hex HMAC-SHA256(rahasia pemakai, `timestamp.body`), toleransi 5 menit; setiap event membawa `event_id` (sama di setiap percobaan ulang) dan `message.received` membawa `message_id`. Kode galat stabil ada di KIRIM-IMPL-001 §5.3.

Kirim SQ tidak membuka koneksi langsung ke browser atau HP staf. Modul pemilik nomor yang meneruskan event ke layarnya (koneksi langsung saat terbuka, notifikasi push saat tertutup; SPMB-002 §8.4).

### 5.3 API percakapan untuk modul pemilik nomor (R2, revisi 3)

Bagian ini menggantikan "Pendaftaran tombol aksi" (`PUT /internal/kirim/devices/:kode/actions`) dari revisi 2.

Aturan umum:

- Hanya **modul pemilik nomor** (`kirim_devices.pemilik_consumer_id`) yang boleh memanggil API ini untuk nomornya. Pemakai lain mendapat `403`.
- Setiap panggilan membawa **`atas_nama`**: `issuer` dan `sub` Akun SQ petugas yang sedang bekerja (di body untuk `POST`, di header untuk `GET`). Kirim SQ tidak memeriksa peran petugas; itu tugas modul. Kirim SQ mencatat petugas di pesan keluar dan di audit, dan menolak panggilan tanpa `atas_nama` (`400`).
- Berbeda dari API kirim R1, jawaban API ini **memuat isi pesan dan nomor utuh**, karena memang untuk ditampilkan ke petugas. Isi tetap tidak masuk log, metrik, atau audit.
- Daftar dimuat bertahap dengan cursor. Pencarian di Kirim SQ hanya berdasarkan **nomor persis** (lewat HMAC). Pencarian nama dilakukan modul di datanya sendiri.

| Panggilan | Isi |
| --- | --- |
| `GET /internal/kirim/devices/:kode/conversations?setelah=&batas=&kontak=` | Daftar percakapan nomor itu, terbaru dulu: `id`, `kontak`, `nama_profil`, `pesan_terakhir_at`, `belum_dibaca`, cuplikan pesan terakhir |
| `GET /internal/kirim/conversations/:id` | Satu percakapan (data yang sama) |
| `GET /internal/kirim/conversations/:id/messages?sebelum=&batas=` | Isi pesan masuk dan keluar: arah, asal (`otomatis`/`petugas`), petugas, tipe, isi, `media_id`, status, waktu. Kode OTP disamarkan |
| `GET /internal/kirim/media/:id` | Unduh media masuk atau keluar. Hanya media milik nomor pemanggil |
| `POST /internal/kirim/devices/:kode/conversations` | `{ to, atas_nama }` → membuka atau membuat percakapan dengan nomor itu tanpa mengirim apa-apa. Untuk "memulai chat lebih dulu" (SPMB-002 §7.4); syarat jejak hubungan diperiksa modul |
| `POST /internal/kirim/conversations/:id/messages` | Balasan petugas, dengan `Idempotency-Key`: `{ text \| media_id, atas_nama, ref }` → `202 { id, status }`. `asal: petugas`, bebas jam kirim, mendahului antrean otomatis, tetap kena batas laju nomor dan opt-out (§13 no. 3). Media: PDF, JPEG, PNG, maks. 5 MiB lewat `POST /internal/kirim/media` |
| `POST /internal/kirim/conversations/:id/read` | `{ atas_nama, sampai_message_id }` → `markRead` ke mesin dan `belum_dibaca = 0` |
| `POST /internal/kirim/optouts`, `DELETE /internal/kirim/optouts` | Menambah (sudah ada di R1) dan mencabut opt-out yang dibuat pemakai itu sendiri (§13 no. 2) |

Kirim SQ **tidak** menyimpan siapa yang memegang percakapan, status ditangani, catatan, atau label. Semua itu data kerja modul.

### 5.4 Grup WhatsApp (keputusan PO 2026-10-19, SPMB-002 §7.6)

Modul pemilik nomor mengelola grup tempat nomornya menjadi anggota. Aturan umum §5.3 berlaku (pemilik nomor saja, `atas_nama` wajib, audit).

| Panggilan | Isi | Tahap |
| --- | --- | --- |
| `GET /internal/kirim/devices/:kode/groups` | Daftar grup nomor itu: `id`, nama, jumlah anggota, apakah nomor ini admin, pesan terakhir | R2 |
| `GET /internal/kirim/groups/:id/messages?sebelum=&batas=` | Isi pesan grup, dengan pengirim per pesan | R2 |
| `POST /internal/kirim/groups/:id/messages` | Balasan petugas ke grup (`text \| media_id`, `atas_nama`, `ref`) | R2 |
| `POST /internal/kirim/devices/:kode/groups` | Membuat grup baru `{ nama, deskripsi?, anggota[] }`; nomor ini menjadi admin | R3 |
| `POST /internal/kirim/groups/:id/participants`, `DELETE …/participants/:nomor` | Menambah dan mengeluarkan anggota. Bila orang itu tidak bisa ditambahkan langsung karena pengaturan privasinya, jawaban menandai `perlu_undangan` | R3 |
| `GET /internal/kirim/groups/:id/invite-link`, `PATCH /internal/kirim/groups/:id` | Tautan undangan; ubah nama atau deskripsi | R3 |

- Pesan grup masuk diteruskan ke modul sebagai event `group.message.received` (tanpa membuat percakapan pribadi).
- Penambahan anggota kena **batas laju sendiri** (awal 20 orang per jam per nomor) dan opt-out; ini untuk menjaga nomor dari blokir WhatsApp.
- **Mesin:** JalurPesan sudah punya daftar grup dan pesan grup (`/api/v1/platform/tenants/:id/groups…`), tetapi belum punya buat grup, tambah/keluarkan anggota, dan tautan undangan. Itu perlu ditambahkan ke JalurPesan sebelum tahap R3 (Baileys mendukung).

### 5.5 Impor riwayat chat lama (keputusan PO 2026-10-19, SPMB-002 §7.8)

- Riwayat chat nomor yang sudah dipakai sebelum Kirim SQ (mis. nomor SPMB di HP panitia) diimpor ke `kirim_messages` dengan tanda `asal: impor`. Pesan impor tidak memicu event `message.received`, balasan otomatis, atau notifikasi.
- **Jalur utama:** permintaan riwayat ke WhatsApp lewat perangkat tertaut. JalurPesan sudah menangani riwayat **sesuai permintaan** (`ON_DEMAND`) per percakapan; sinkron awal saat pairing diabaikan untuk isi pesan. Seberapa jauh ke belakang WhatsApp mau mengirim perlu diuji pada nomor `spmb`.
- **Jalur cadangan:** berkas **Ekspor chat** dari HP (teks + media) diunggah `kirim_admin` dan dipetakan ke percakapan per nomor.
- File cadangan WhatsApp (`msgstore.db.crypt14/15`) terenkripsi dan tidak dipakai kecuali kuncinya tersedia.
- Impor dijalankan sekali per nomor oleh `kirim_admin`, dengan ringkasan jumlah percakapan dan pesan, dan tercatat di audit.

## 6. Pengiriman dan keselamatan nomor

- **Batas laju per nomor:** awal 10 pesan otomatis/menit dengan jeda acak 2–6 detik. Jenis `kode` dan balasan petugas boleh mendahului antrean.
- **Jam kirim otomatis** untuk `notifikasi`: 06.00–21.00 WIB. Pesan di luar jam itu ditahan sampai pagi kecuali `kedaluwarsa` lebih dulu. **Balasan petugas lewat API percakapan dan jenis `kode` bebas jam.**
- **Retry:** 3 kali dengan backoff (1, 5, 30 menit). Setelah itu status `gagal` dan pengirim diberi tahu.
- **Nomor terputus:** antrean berhenti untuk nomor itu, `device.status` dikirim, modul pemilik menampilkan "Nomor WhatsApp tidak tersambung" di kotak masuknya, dan Kirim SQ admin diberi peringatan. Pesan tidak dialihkan otomatis ke nomor lain.
- **Isi pesan otomatis:** sebaiknya membawa tautan ke aplikasi, bukan data sensitif utuh (mis. "Slip gaji Oktober sudah tersedia" + tautan, bukan nominal gaji).

## 7. Nomor untuk trial

| Kode | Pemilik (percakapan) | Boleh mengirim juga | Nomor |
| --- | --- | --- | --- |
| `hcis` | HCIS (admin HCIS) | Karir SQ (notifikasi), sampai Karir punya nomor sendiri | Nomor baru khusus |
| `spmb` | SPMB (panitia, lewat kotak masuk SPMB-002) | Keluarga SQ (`kode`), sampai Keluarga SQ punya nomor sendiri | Nomor resmi SPMB yang sudah ada |

Keuangan, Sosial, dan Media mendapat nomor sendiri saat mulai memakai WA (roadmap: satu nomor resmi per bidang). Kalau satu nomor diblokir, nomor bidang lain tetap jalan.

## 8. Akses dan layar

Layar Kirim SQ hanya untuk **pengelola nomor**, bukan untuk staf modul:

- **Alamat:** `kirim.sabilulquran.or.id`, dilayani proses SQ Hub web dan API yang sudah ada (rute host di edge), jadi tetap tanpa proses baru. API modul pemakai (`/internal/kirim/*`) hanya lewat loopback dan diblokir di edge.
- **Akses:** terdaftar di SQ Hub **Application Access** sebagai aplikasi "Kirim SQ". Tile di Launcher **hanya tampil bagi staf yang punya akses**, yaitu `kirim_admin`.
- **Peran:** hanya `kirim_admin` (Kepala HCM; boleh didelegasikan ke admin SQ Core): menambah nomor, scan QR, memutus, ganti provider, menetapkan modul pemilik dan rute, daftar jangan-hubungi, melihat aktivitas. Peran `petugas` per nomor dari revisi 2 **dihapus**; staf modul diatur oleh modul itu.

Layar:

- **Nomor** (sudah ada di R1): daftar nomor, status, scan QR/kode pairing, putuskan, nonaktifkan, ganti provider, pemilik.
- **Antrean** (sudah ada di R1): jumlah antre/gagal per nomor, coba ulang, batalkan.
- **Jangan hubungi** (R2): tambah atau hapus nomor.
- **Aktivitas** (R2): audit dan ringkasan harian per modul, tanpa isi pesan.

Tidak ada layar inbox di Kirim SQ. `kirim_admin` **tidak bisa membaca isi chat** dari Kirim SQ. Isi chat hanya terbaca lewat kotak masuk modul pemilik nomor, oleh staf yang diberi hak oleh modul itu.

## 9. Tahapan

| Tahap | Isi |
| --- | --- |
| **R1** (live sejak 2026-10-18) | Nomor dan pairing, kirim otomatis (§5.1), simpan semua pesan masuk/keluar, event ke modul (§5.2), layar Nomor dan Antrean |
| **R2** (revisi 3) | API percakapan (§5.3), baca dan balas grup (§5.4), impor riwayat chat lama (§5.5), `message.status` ke pemilik nomor, `markRead`, kirim gambar, cabut opt-out, layar Jangan hubungi dan Aktivitas. Dibutuhkan oleh SPMB-002 tahap K2 |
| **R3** | Buat grup, tambah/keluarkan anggota, tautan undangan (§5.4), setelah JalurPesan mendukungnya. Dibutuhkan oleh SPMB-002 tahap K4 |
| Kelak | Komponen tampilan kotak masuk bersama bila HCIS dan SPMB sama-sama butuh, kanal email, pindah mesin |

Karena R1 sudah menyimpan semua pesan, kotak masuk di modul pemilik langsung punya riwayat sejak trial dimulai.

## 10. Pindah mesin (runbook ringkas)

1. Siapkan mesin baru dan provider-nya dengan provider `log` lalu nomor uji.
2. Untuk setiap nomor: hentikan antrean, tunggu `diserahkan` = 0.
3. Ganti `provider` dan `provider_ref` nomor itu, lalu **pairing ulang** (sesi WhatsApp tidak bisa dipindah).
4. Jalankan lagi antrean dan pantau status 24 jam.
5. Riwayat percakapan tetap ada di Kirim SQ, karena disimpan di `kirim_messages`, bukan di mesin.

Modul pemakai tidak berubah sama sekali.

## 11. Dampak pada dokumen lain

- **Semua modul pemakai** (SPMB, Keluarga SQ, HCIS, Karir, Keuangan, dan seterusnya): kirim WA otomatis lewat port sendiri (mis. `WhatsAppSender`) dengan dua adapter, `log` (default) dan `kirim` (HTTP ke kontrak §5). Modul pemakai **tidak** memanggil JalurPesan langsung dan tidak memasang Baileys. Selama Kirim SQ belum jalan, adapter `log` dipakai, sehingga pengembangan modul tidak menunggu Kirim SQ. Adapter langsung ke JalurPesan hanya boleh sebagai jalan darurat dengan persetujuan PO.
- **Modul pemilik nomor** (revisi 3): bila butuh kotak masuk, modul membangunnya sendiri di atas API percakapan (§5.3). Isi chat tidak disalin ke database modul; modul hanya menyimpan data kerjanya.
- **SPMB (SPMB-002):** kotak masuk panitia, penanganan percakapan (menggantikan `ditangani_oleh`), peminat, tindak lanjut, dan aplikasi Android CS ada di SPMB. SPMB memanggil API percakapan atas nama petugas; browser dan aplikasi CS hanya bicara ke API staf SPMB. Keputusan SPMB-001 2026-10-17 "Inbox WA SPMB adalah inbox Kirim SQ R2" sudah digantikan SPMB-002.
- **SPMB-IMPL-001:** port `WhatsAppSender` tetap, adapter JalurPesan langsung diganti adapter `log` + `kirim`. Pesan masuk ke nomor SPMB datang lewat webhook `message.received` dari Kirim SQ.
- **HCIS:** "inbox admin HCIS" yang direncanakan mengikuti pola yang sama: dibangun di HCIS di atas API percakapan nomor `hcis`, atau sebagai komponen tampilan bersama bila SPMB dan HCIS sama-sama memakainya (SPMB-002 §12 no. 7). Bukan layar Kirim SQ.
- **Keluarga SQ (KEL-IMPL-001):** relay kode `POST /internal/otp-deliveries` mengirim lewat Kirim SQ dengan `jenis: "kode"` di nomor `spmb`.
- **KIRIM-IMPL-001 (R1, ACCEPTED):** tidak diubah. Daftar "Di luar R1" yang menyebut inbox, menu WhatsApp, `kirim_device_members`, dan `kirim_actions` untuk R2 digantikan dokumen ini. Kolom `kirim_conversations.ditangani_oleh` yang sudah ada di database tetap kosong (§13 no. 1). R2 butuh spesifikasi implementasi baru (usulan KIRIM-IMPL-002).
- **ADR-0011:** diberi amandemen 2026-10-19 (Kirim SQ hanya mesin dan API; kotak masuk di modul pemilik nomor).

## 12. Operasional dan gate Mi8

- Tidak ada proses baru. Worker kirim berjalan di proses SQ Hub API; tambahan memori diperkirakan < 20 MiB.
- Beban tambahan ada di JalurPesan: perkiraan 30–80 MiB per nomor (belum diukur). Ukur RSS JalurPesan dan MemAvailable sebelum pairing dan selama 7 hari.
- **Batas berhenti memori:** MemAvailable rata-rata 7 hari < 900 MiB, atau RSS JalurPesan terus naik → hentikan penambahan nomor dan rencanakan pindah mesin.
- **Gate R2:** sebelum API percakapan dipakai di production, ukur beban baca riwayat dan unduh media dari kotak masuk SPMB pada puncak gelombang, bersama ukuran koneksi langsung dan push di sisi SPMB (SPMB-002 §12 no. 10).
- **Simpan selamanya dan kapasitas disk:** teks kecil (perkiraan < 1 GiB per tahun untuk 2 nomor), tetapi media bisa besar. Ukuran `kirim_messages` dan folder media masuk laporan harian. **Gate:** bila disk bebas Mi8 < 10 GiB, media lama dipindahkan ke arsip off-host sesuai rencana backup, bukan dihapus. Keputusan menghapus apa pun butuh PO.
- **Privasi:** percakapan bisa berisi data anak dan keuangan. Isi terenkripsi di kolom. Isi hanya keluar lewat API percakapan ke modul pemilik nomor, atas nama petugas yang hak aksesnya diperiksa modul itu. Setiap pembukaan isi, unduhan media, dan balasan tercatat di audit Kirim SQ, dan modul mencatat audit kerjanya sendiri.
- **Backup:** tabel `kirim_*` ikut dump database SQ Hub; media ikut arsip backup SQ Hub. Sesi WhatsApp ada di JalurPesan dan backup-nya belum konsisten (`CONSISTENCY_BLOCKED`); kalau Mi8 rusak, nomor dipairing ulang, dan riwayat percakapan tetap aman di Kirim SQ.

## 13. Pertanyaan terbuka

Pertanyaan revisi 1 dan 2 sudah dijawab PO pada 2026-10-17:

- Revisi 1: lama simpan, pengelola, nomor, jam kirim (§1 butir 8–11).
- Urutan bangun: **Kirim SQ R1 dulu**; SPMB R0 jalan dengan adapter `log` sambil menunggu (KIRIM-IMPL-001 D-13).
- Petugas inbox awal untuk `hcis` dan `spmb` (KIRIM-IMPL-001 D-13): **tidak berlaku lagi** sejak revisi 3, karena staf diatur modul pemilik nomor.
- Keputusan teknis R1 lainnya ada di KIRIM-IMPL-001 §16.

Pertanyaan baru dari revisi 3 **sudah dijawab Product Owner pada 2026-10-19**: seluruh saran disetujui apa
adanya. Tidak ada pertanyaan terbuka yang tersisa, jadi KIRIM-IMPL-002 boleh ditulis.

| # | Pertanyaan | Keputusan (PO, 2026-10-19) |
| --- | --- | --- |
| 1 | Kolom `kirim_conversations.ditangani_oleh` yang sudah ada di database (selalu kosong) dihapus atau dibiarkan? | **Dihapus di migration R2.** Kolom itu tidak pernah diisi, jadi aman; sampai migration R2 jalan, biarkan kosong dan jangan dipakai |
| 2 | SPMB-002 §10 ingin "jangan hubungi" dari SPMB menghentikan pesan otomatis dari modul mana pun, tetapi KIRIM-IMPL-001 D-5 hanya mengizinkan pemakai membuat opt-out cakupan `consumer`. Bagaimana? | **Tambah cakupan per nomor (`device`) yang hanya boleh dibuat pemilik nomor.** Jadi "jangan hubungi" dari SPMB menghentikan semua pesan otomatis lewat nomor `spmb` (termasuk notifikasi modul lain di nomor itu), kecuali `kode`. Cakupan `semua` tetap hanya oleh `kirim_admin` |
| 3 | Bolehkah petugas membalas nomor yang sudah opt-out? | **Hanya bila orang itu mengirim pesan dalam 24 jam terakhir** (dia sendiri yang menghubungi). Memulai chat atau membalas di luar itu ditolak `422 optout` |
| 4 | Siapa memeriksa syarat sebelum memulai chat (SPMB-002 §7.4)? | **Modul pemilik nomor.** PO memutuskan 2026-10-19 bahwa panitia boleh memulai chat ke nomor dari sumber mana pun asal sumbernya dicatat; pencatatan itu tugas SPMB. Kirim SQ hanya memeriksa kepemilikan nomor, opt-out, kuota, dan mencatat petugas |
| 5 | Pembacaan isi percakapan diaudit di Kirim SQ juga, atau cukup di modul? | **Di keduanya.** Kirim SQ mencatat ringkas (petugas, percakapan, aksi, waktu) supaya jejak tetap ada walau modul berganti; modul mencatat konteks kerjanya |
| 6 | Jenis media yang boleh dikirim petugas di R2? | **PDF, JPEG, PNG, maks. 5 MiB.** Voice note menyusul setelah kapasitas media Mi8 diukur (SPMB-002 §12 no. 9) |
| 7 | Isi chat dan media tetap disimpan di Kirim SQ (dibaca modul lewat API), atau disalin ke database modul? (sama dengan SPMB-002 §12 no. 1) | **Diputuskan PO 2026-10-19: tetap di Kirim SQ**, terenkripsi dan selamanya |

## Riwayat keputusan

| Tanggal | Keputusan |
| --- | --- |
| 2026-10-17 | Nama **Kirim SQ**. Cangkang milik yayasan; mesin menumpang JalurPesan; tidak memasang Baileys di SQ Core. |
| 2026-10-17 | Logika bisnis tetap di modul pemakai; Kirim SQ mengelola nomor dan jalur kirim. |
| 2026-10-17 | Alamat `kirim.sabilulquran.or.id`; tampil di Launcher hanya bagi yang punya akses lewat Application Access. |
| 2026-10-17 (revisi 2) | Fitur dasar (inbox, balas, simpan percakapan) dibangun sekali di Kirim SQ dan dibuka dari menu WhatsApp di tiap modul; fitur khusus tetap di modul. Setiap nomor milik satu modul. **Bagian inbox, menu WhatsApp, dan tombol aksi digantikan revisi 3 (2026-10-19).** |
| 2026-10-17 (revisi 2) | Percakapan disimpan selamanya; `kirim_admin` = Kepala HCM (boleh didelegasikan ke admin SQ Core); nomor baru khusus per bidang; jam kirim otomatis 06.00–21.00 WIB. Trial: nomor `hcis` dan `spmb`. |
| 2026-10-17 | ADR-0011 diterima PO. |
| 2026-10-17 | Urutan bangun dan petugas inbox awal diputuskan (§13); keputusan teknis R1 di KIRIM-IMPL-001 §16. |
| 2026-10-19 (revisi 3) | **Kirim SQ hanya mesin di balik layar** (API WhatsApp: nomor, kirim, terima, simpan chat dan media, status, jangan-hubungi, batas laju). Kotak masuk staf dan pengelolaan peminat dibangun di modul pemilik nomor, SPMB lebih dulu (SPMB-002). Kirim SQ R2 menjadi API percakapan. |
| 2026-10-19 | Isi chat tetap di Kirim SQ (dikonfirmasi PO). Tambahan: API grup — baca dan balas di R2, buat grup dan tambah anggota di R3 — dan impor riwayat chat lama (SPMB-002 §7.6, §7.8). |
| 2026-10-19 | **Enam pertanyaan teknis §13 no. 1–6 dijawab PO, seluruh saran disetujui:** kolom `ditangani_oleh` dihapus di migration R2; opt-out bertambah cakupan `device` yang hanya boleh dibuat pemilik nomor, sehingga "jangan hubungi" dari SPMB menghentikan semua pesan otomatis lewat nomor itu kecuali `kode`; petugas boleh membalas nomor ber-opt-out hanya bila orang itu menyapa dalam 24 jam terakhir; syarat sebelum memulai chat diperiksa modul pemilik nomor; pembacaan isi percakapan diaudit di Kirim SQ dan di modul; media petugas di R2 adalah PDF, JPEG dan PNG maksimal 5 MiB, voice note menyusul. KIRIM-IMPL-002 boleh ditulis. |
