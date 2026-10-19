# KIRIM-IMPL-002 — Kirim SQ R2: API percakapan, grup, dan impor riwayat

**Status:** DRAFT — menunggu keputusan Product Owner atas §17 (T-1…T-6). Spesifikasi ini belum mengizinkan implementasi.
**Produk:** SQ Hub — modul `kirim` (Kirim SQ)
**Owner produk:** Kepala HCM (`kirim_admin`, KIRIM-001 §1 butir 9)
**Tanggal:** 2026-10-19
**Depends on:**
- [KIRIM-001](../product/kirim-sq-module-design.md) revisi 3, terutama §2, §3.3, §5.2–§5.5, §8, §9, §12, dan keputusan §13 (PO, 2026-10-19)
- [KIRIM-IMPL-001](KIRIM-IMPL-001-r1-nomor-dan-kirim.md) (R1, ACCEPTED 2026-10-17): kontrak, data, enkripsi, worker, dan keputusan D-1…D-13 tetap berlaku kecuali disebut lain di sini
- [ADR-0011](../architecture/adr/0011-kirim-sq-shared-whatsapp-capability.md) dengan amandemen 2026-10-19
- JalurPesan `jalurpesan.web.id` platform API, dibaca dari kode sumber 2026-10-19 (`server/src/routes/platform-tenants.ts`, `platform-read-receipts.ts`, `history-imports.ts`, `whatsapp/service.ts`, `database/message-repository.ts`)

**Pemakai pertama:** SPMB SQ, tahap K2 (`spmb-sq/docs/product/kelola-peminat-dan-whatsapp.md`, SPMB-002 §7 dan §8). Nomor pertama: `spmb`.

## 1. Tujuan dan batas rilis

R2 membuat **modul pemilik nomor bisa membangun kotak masuknya sendiri** di atas Kirim SQ: membaca percakapan dan isinya, membalas atas nama petugas, menandai dibaca, membaca dan membalas grup, dan memindahkan riwayat chat lama. Kirim SQ tetap **tanpa layar untuk staf modul** (KIRIM-001 §1 butir 6).

R2 berisi:

1. **API percakapan** (§6.1): daftar percakapan per nomor, satu percakapan, isi pesan, unduh media, buka percakapan baru, balas, tandai dibaca.
2. **Balasan petugas** (§5): antrean sendiri di depan pesan otomatis, bebas jam kirim, teks atau PDF/JPEG/PNG ≤ 5 MiB, aturan opt-out 24 jam.
3. **Grup — baca dan balas** (§6.2): daftar grup, isi pesan grup, balas ke grup, event `group.message.received`.
4. **Event baru ke pemilik nomor** (§7): `message.status` untuk semua pesan keluar di nomornya, `message.sent` untuk pesan keluar yang tidak dibuat pemilik (dari HP nomor itu atau dari modul lain), `group.message.received`.
5. **Jangan hubungi per nomor** (§8): cakupan `device` yang hanya bisa dibuat pemilik nomor, dan pencabutan opt-out milik sendiri.
6. **Kontak LID dan nama profil** (§9): pemetaan LID → nomor telepon dan nama profil dari mesin (menutup D-6).
7. **Impor riwayat chat lama** (§10): jalur perangkat tertaut (utama) dan berkas Ekspor chat (cadangan), dijalankan `kirim_admin`.
8. **Layar admin** (§12): **Jangan hubungi**, **Aktivitas**, dan **Impor riwayat** di halaman Nomor.
9. **Migration R2** (§4): termasuk penghapusan kolom `kirim_conversations.ditangani_oleh` (KIRIM-001 §13 no. 1).

Di luar R2:

- buat grup, tambah/keluarkan anggota, tautan undangan, ubah nama/deskripsi grup — **R3** (KIRIM-001 §5.4), menunggu JalurPesan;
- mengirim voice note — menyusul setelah kapasitas media Mi8 diukur (KIRIM-001 §13 no. 6);
- media dari berkas Ekspor chat — lihat T-4;
- komponen tampilan kotak masuk bersama, provider `meta-cloud`, kanal email — **kelak**;
- layar delegasi `kirim_admin` — tetap CLI (T-3).

## 2. Temuan dari kode JalurPesan yang mengubah rencana

KIRIM-001 §5.4 dan §5.5 serta SPMB-002 §7.6 dan §7.8 meminta dukungan mesin "dicek dulu". Hasil pemeriksaan kode sumber JalurPesan 2026-10-19:

| Kebutuhan | Sudah ada di JalurPesan | Akibat untuk R2 |
| --- | --- | --- |
| Kirim ke kontak LID | Ya: `POST .../messages` menerima `toJid` (JID individual) selain `to` | Balasan ke percakapan LID memakai `toJid`; tidak perlu nomor telepon |
| Kirim gambar | Ya: `POST .../media?type=image` lalu kirim `mediaId` | Adapter menambah unggah `image` di samping `document` |
| Tanda dibaca ke WhatsApp | Ya: `POST .../messages/read` `{ messages: [{ remoteJid, whatsappMessageId }] }`, maks. 100, **hanya chat pribadi** | `markRead` lewat rute ini. Butuh **ID pesan WhatsApp**; R1 hanya menyimpan ID JalurPesan untuk pesan masuk (§4) |
| Daftar dan isi grup | Ya: `GET .../groups`, `GET .../groups/:groupJid`; pesan grup masuk ikut event `message.received` dengan `recipientType: "group"` | R2 cukup berhenti membuang pesan grup di ingest |
| Kirim ke grup | Ya: `POST .../groups/:groupJid/messages` (teks atau `mediaId`) | Tanda terkirim/dibaca grup **belum** ada di mesin; status balasan grup berhenti di `diserahkan` |
| Kontak dan nama | Ya: `GET .../contacts` (`jid`, `canonicalJid`, `displayName`), dari sinkron kontak dan pemetaan LID | Dipakai untuk §9 |
| **Pesan yang diketik di HP nomor itu** | **Tidak.** Pesan `fromMe` yang tidak dikirim lewat API dibuang (`normalizeInboundMessage`), tidak disimpan dan tidak menjadi event | Tanpa perubahan, balasan panitia dari HP nomor SPMB **tidak tampil** di kotak masuk SPMB, dan percakapan terlihat belum dibalas. Perlu **J-1** |
| Impor riwayat | Sebagian: permintaan riwayat `ON_DEMAND` per percakapan (maks. 500 pesan) **hanya lewat API admin JalurPesan**, dan hanya untuk percakapan yang sudah punya minimal satu pesan tersimpan sejak pairing. Hasilnya disimpan di JalurPesan tanpa event. Sinkron awal saat pairing hanya mengambil kontak, bukan isi pesan | Perlu **J-2**. Chat lama yang tidak pernah aktif lagi sejak pairing hanya bisa lewat Ekspor chat |
| Nama profil dan sebutan (`@nomor`) di pesan masuk | Tidak ada di payload event (`pushName`, `mentionedJid`, `remoteJidAlt` tidak diteruskan) | Perlu **J-3**. Sampai ada, `nama_profil` diisi dari kontak (§9) dan `menyebut_nomor_ini` bernilai `null` |

Perubahan JalurPesan yang dibutuhkan (keputusan T-1):

| # | Perubahan | Wajib untuk |
| --- | --- | --- |
| **J-1** | Simpan pesan `fromMe` yang dikirim dari HP atau perangkat tertaut lain (bukan lewat API), pribadi dan grup, lalu terbitkan event `message.sent` dengan `whatsappMessageId`, `chatJid`, isi/media, dan waktu. Pesan yang dikirim lewat API tidak diterbitkan ulang | Kotak masuk yang benar selama panitia masih membalas dari HP (SPMB K1→K2) |
| **J-2** | Rute platform `POST /api/v1/platform/tenants/:id/history-imports` `{ chatJid, maxMessages }` dan `GET .../history-imports/:importId` (status dan jumlah), serta `GET .../messages?chatJid=&importId=&page=` untuk mengambil hasilnya. Sama dengan rute admin yang sudah ada, dengan kunci platform | Impor jalur utama (§10.1) |
| **J-3** | Tambah `pushName`, `remoteJidAlt` (nomor telepon untuk kontak LID bila diketahui), dan `mentionedJids` ke payload `message.received` (versi payload naik) | Nama profil langsung, sebutan di grup (SPMB-002 §7.6) |

J-1…J-3 dikerjakan di repo JalurPesan dengan spesifikasinya sendiri, seperti D-10. Kirim SQ R2 **tetap bisa dirilis tanpa J-2 dan J-3** (fitur terkait tampil sebagai "belum tersedia"); **J-1 adalah gate** sebelum SPMB memakai kotak masuk untuk kerja harian (§15).

## 3. Keputusan teknis

| Topik | Keputusan | Alasan / sumber |
| --- | --- | --- |
| Letak kode | Tetap `apps/api/src/modules/kirim/`. File baru: `conversations.ts` (baca), `replies.ts` (balas), `groups.ts`, `contacts.ts`, `history-import.ts`, `routes-conversations.ts` | KIRIM-IMPL-001 §3.1; bisa diekstrak |
| Proses | **Tidak ada proses baru.** Penyegar grup dan kontak, serta pekerja impor, berjalan sebagai timer di proses SQ Hub API seperti worker R1 | ADR-0011; memori Mi8 |
| Dependensi | **Tidak ada dependensi baru** bila T-4 disetujui (Ekspor chat `.txt` saja). Unggah memakai `@fastify/multipart` yang sudah ada | ADR-0006 |
| Siapa boleh memanggil | Hanya **pemilik nomor** (`kirim_devices.pemilik_consumer_id`) untuk semua rute §6. Pemakai lain `403 not_owner`, juga bila ia punya rute kirim di nomor itu | KIRIM-001 §3.3 |
| Petugas (`atas_nama`) | Wajib di setiap panggilan §6. `GET`: header `X-Kirim-Atas-Nama-Issuer` dan `X-Kirim-Atas-Nama-Sub`. `POST`: field `atas_nama: { issuer, sub }`. Masing-masing 1–255 karakter, tanpa format yang ditafsirkan. Tanpa itu `400 atas_nama_required`. Kirim SQ tidak memeriksa peran petugas | KIRIM-001 §5.3; AGENTS.md §5 (`issuer + sub` buram) |
| Isi di jawaban | Jawaban §6 **memuat isi pesan dan nomor utuh**. Rute §6 memakai serializer log yang sama dengan R1: body, query, header `atas_nama`, dan jawaban tidak masuk log | KIRIM-001 §5.3; KIRIM-IMPL-001 §10 |
| Kode verifikasi | Pesan `jenis: kode` tetap disamarkan di semua jawaban dan event: `isi: null`, `disamarkan: true` | KIRIM-001 §5.1 |
| Cursor | Buram (`base64url` dari waktu + id), stabil walau ada pesan baru. `batas` bawaan 30, maks. 100 | Daftar dimuat bertahap (SPMB-002 §7.2) |
| Pencarian | Hanya **nomor persis** lewat HMAC (`?kontak=`). Nama dicari modul di datanya sendiri | KIRIM-001 §5.3 |
| Audit baca | Satu baris `percakapan.baca` per petugas per percakapan per 15 menit; unduh media, balas, buka percakapan, dan tandai dibaca selalu satu baris. Isi tidak pernah masuk audit | KIRIM-001 §13 no. 5; menjaga ukuran `kirim_audit` |
| Grup di WhatsApp | Grup disimpan terpisah dari percakapan pribadi (`kirim_groups`); pesan grup tidak membuat percakapan pribadi | KIRIM-001 §5.4 |

## 4. Data

Migration baru `apps/api/migrations/0011_kirim_r2.sql` (nomor bebas berikutnya saat merge). Berbeda dari R1, migration ini **mengubah** tabel yang ada, tetapi tidak menghapus data: kolom yang dihapus selalu kosong, dan setiap `CHECK` yang diganti hanya dilonggarkan.

### 4.1 Perubahan tabel R1

| Tabel | Perubahan | Alasan |
| --- | --- | --- |
| `kirim_conversations` | **Hapus** `ditangani_oleh` (didahului pemeriksaan: migration gagal bila ada baris yang tidak null). Tambah `kontak_alt_hmac`, `kontak_alt_enc` (nomor telepon untuk kontak LID, §9), `dibaca_sampai_at`, `pesan_masuk_terakhir_at` | KIRIM-001 §13 no. 1 dan no. 3; §9 |
| `kirim_messages` | `asal` boleh `hp` (diketik di HP nomor itu, J-1). Tambah `diimpor` bool (bawaan `false`), `wa_message_id` (ID pesan WhatsApp, untuk tanda dibaca dan untuk mencocokkan impor), `consumer_id` (modul yang mengirim pesan otomatis/petugas), `group_id`, `pengirim_hmac`, `pengirim_enc` (anggota grup yang mengirim). `conversation_id` boleh null **hanya** bila `group_id` terisi: `CHECK ((conversation_id IS NULL) <> (group_id IS NULL))`. `jenis` boleh `percakapan` | §5, §6.2, §10 |
| `kirim_messages` | Pesan masuk yang diimpor: `CHECK (arah = 'keluar' OR status = 'diterima')` tetap; pesan keluar yang diimpor berstatus `terkirim` | §10 |
| `kirim_outbox` | `jenis` boleh `percakapan`; `prioritas` boleh `petugas` (urutan: `kode` > `petugas` > `tinggi` > `normal`); tambah `atas_nama` (petugas), `group_id`. `to_hmac` berisi HMAC kontak atau HMAC grup | §5 |
| `kirim_optouts` | `cakupan` boleh `device` dengan `device_id`; tambah `nomor_tersamar` (untuk layar admin, null pada baris R1). `CHECK`: `semua` → tanpa `consumer_id`/`device_id`, `sumber = admin`; `consumer` → `consumer_id`; `device` → `device_id` dan `consumer_id` = pembuatnya (pemilik nomor) atau `sumber = admin`. Index unik per cakupan | KIRIM-001 §13 no. 2; §8 |
| `kirim_webhook_deliveries` | `event_type` boleh `message.sent` dan `group.message.received` | §7 |
| `kirim_audit` | Tambah `atas_nama` text null (`issuer` + spasi + `sub`, dari modul) | §3 |

Isi pesan R1 yang sudah tersimpan tidak disentuh. `wa_message_id` hanya terisi untuk pesan yang masuk setelah R2 (dan hasil impor); pesan masuk R1 tetap bisa dibaca, tetapi tanda dibaca ke WhatsApp hanya dikirim untuk pesan yang punya `wa_message_id`.

### 4.2 Tabel baru

| Tabel | Kolom utama | Catatan |
| --- | --- | --- |
| `kirim_groups` | `id`, `device_id`, `group_hmac`, `group_jid_enc`, `nama_enc`, `jumlah_anggota`, `nomor_ini_admin` bool, `pesan_terakhir_at`, `belum_dibaca`, `dibaca_sampai_at`, `keluar_at` (nomor sudah bukan anggota), `disegarkan_at` | Unik (`device_id`, `group_hmac`). Nama grup dienkripsi karena bisa memuat nama anak atau kelas |
| `kirim_history_imports` | `id`, `device_id`, `conversation_id`, `jalur` (`perangkat`, `ekspor`), `status` (`antre`, `menunggu_mesin`, `memasukkan`, `selesai`, `gagal`), `diminta_oleh` (principal admin), `provider_import_id`, `jumlah_diminta`, `jumlah_dimasukkan`, `jumlah_ganda`, `jumlah_dilewati`, `galat`, `created_at`, `selesai_at` | Satu baris per percakapan per percobaan. Berkas ekspor tidak disimpan setelah diproses |

### 4.3 Recovery plan migration

1. Sebelum migrate di production: dump `sq_hub_production` lewat `sq-core-backup.sh`, catat checksum.
2. Migration satu transaksi (`migrate.ts`); gagal = rollback, database tetap seperti sebelumnya. Pemeriksaan `ditangani_oleh` kosong ada di awal file, sehingga data yang tak terduga menghentikan migration, bukan dihapus.
3. Rollback aplikasi = kembali ke release SQ Hub sebelumnya. Release R1 bisa berjalan di skema R2 karena semua kolom tambahan punya bawaan atau boleh null, dan `CHECK` hanya dilonggarkan. Namun worker R1 **tidak mengenal** balasan petugas dan grup: ia akan mengambil baris `prioritas = petugas` sebagai prioritas biasa, menahannya sesuai jam kirim, dan gagal pada balasan grup (tanpa `conversation_id`). Karena itu **sebelum rollback**: jeda antrean nomor pemilik (`pause`), lalu batalkan balasan petugas dan grup yang masih `antre` lewat layar Antrean, dan beri tahu modul pemilik. Layar dan API R1 tidak membaca isi, jadi pesan `asal = hp`, `jenis = percakapan`, dan pesan grup yang sudah tersimpan tidak terganggu.
4. Tidak ada `DROP TABLE` atau penghapusan isi. Kolom `ditangani_oleh` tidak pernah diisi (KIRIM-IMPL-001 §4: "null di R1").
5. Uji migration: database kosong, salinan skema production terakhir, dan dua kali jalan tanpa perubahan.

## 5. Balasan petugas

### 5.1 Menerima balasan (`POST /internal/kirim/conversations/:id/messages`)

Urutan pemeriksaan, berhenti pada yang pertama gagal:

1. Token sah dan pemakai terdaftar (seperti R1 §5.1 langkah 1–2).
2. `Idempotency-Key` 1–200 karakter → selain itu `400`.
3. Body sah: `text` (1–4096) **atau** `media_id` dengan `caption` opsional; `atas_nama`; `ref` (≤ 200, tanpa data pribadi); `kedaluwarsa` opsional → selain itu `400 invalid_request` / `400 atas_nama_required`.
4. Idempotensi (`consumer_id`, `idempotency_key`) seperti R1.
5. Percakapan ada dan nomornya milik pemanggil → selain itu `404 not_found` (tidak membedakan "tidak ada" dan "bukan milikmu").
6. Nomor tidak `nonaktif` → `422 device_inactive`.
7. **Opt-out** (`semua`, `device` nomor ini, atau `consumer` pemanggil): ditolak `422 optout`, **kecuali** orang itu mengirim pesan ke nomor ini dalam 24 jam terakhir (`pesan_masuk_terakhir_at`, waktu database) (KIRIM-001 §13 no. 3).
8. `media_id` milik pemanggil, nomor ini, `arah = keluar`, MIME `application/pdf`, `image/jpeg`, atau `image/png` → selain itu `422 media_invalid`.

Lolos semua: dalam satu transaksi buat `kirim_messages` (`keluar`, `petugas`, `jenis = percakapan`, `petugas = atas_nama`, `consumer_id`) dan `kirim_outbox` (`prioritas = petugas`), naikkan `pesan_terakhir_at`, tulis audit `percakapan.balas`, lalu jawab `202 { id, status: "antre" }`.

- **Kuota harian tidak dihitung** untuk balasan petugas (T-5). Batas laju nomor tetap berlaku.
- **Kedaluwarsa bawaan 72 jam** (T-2), dan boleh diatur modul sampai 7 hari. Selama nomor `terputus`, balasan menunggu di antrean (SPMB-002 §7.7 "ditahan lalu terkirim setelah tersambung"); lewat kedaluwarsa → `gagal/expired` dan `message.status` ke pemilik.
- Balasan ke kontak LID dikirim dengan `toJid`; ke kontak nomor dengan `to`.

### 5.2 Worker

Worker R1 dipakai dengan tiga perubahan:

- **Urutan klaim per nomor:** `kode`, `petugas`, `tinggi`, `normal`.
- **Jam kirim:** `percakapan` bebas jam, seperti `kode`.
- **Batas laju:** satu hitungan per nomor untuk semua pesan keluar (otomatis dan petugas) dalam 60 detik bergulir, dengan jeda acak 2–6 detik. Balasan petugas mendahului antrean, tetapi tidak melampaui batas. Bawaan `rate_per_menit` 10 tetap (KIRIM-001 §6).

`policy.ts` (`windowDecision`) menerima `jenis: "percakapan"`; aturan lain tidak berubah.

### 5.3 Media keluar

`POST /internal/kirim/media` (R1) diperluas: `application/pdf` (magic `%PDF-`), `image/jpeg` (`FF D8 FF`), `image/png` (`89 50 4E 47 0D 0A 1A 0A`), maks. 5 MiB, untuk semua pemakai. Adapter JalurPesan mengunggah dengan `?type=image` untuk gambar dan `?type=document` untuk PDF, dengan cache `kirim_media_engine_refs` yang sama. Kontrak provider:

```ts
sendMedia(device, to: Recipient | { jid: string }, file: MediaFile & { kind: "document" | "image" }, caption, idempotencyKey): Promise<SendResult>;
sendGroup(device, groupJid: string, content: { text: string } | { file: MediaFile & { kind: "document" | "image" }; caption: string | null }, idempotencyKey): Promise<SendResult>;
markRead(device, messages: Array<{ remoteJid: string; whatsappMessageId: string }>): Promise<void>;
listGroups(device): Promise<ProviderGroup[]>;
listContacts(device, page: number): Promise<ProviderContactPage>;
requestHistory(device, chatJid: string, maxMessages: number): Promise<{ importId: string }>;   // J-2
historyStatus(device, importId: string): Promise<ProviderHistoryStatus>;                        // J-2
historyMessages(device, importId: string, page: number): Promise<ProviderHistoryPage>;          // J-2
```

`sendDocument` R1 menjadi pembungkus `sendMedia(kind: "document")`. Adapter `log` mengembalikan kosong untuk daftar dan `dry_run` untuk kiriman.

## 6. API percakapan (`/internal/kirim`, loopback saja, pemilik nomor saja)

Galat memakai bentuk R1 `{ "error": { "code", "message" } }`. Semua jawaban `Cache-Control: no-store`.

### 6.1 Percakapan pribadi

| Method + path | Fungsi |
| --- | --- |
| `GET /devices/:kode/conversations?setelah=&batas=&kontak=&belum_dibaca=` | Daftar percakapan nomor itu, `pesan_terakhir_at` terbaru dulu. `kontak` = nomor persis (dinormalkan seperti R1, dicari lewat `kontak_hmac` dan `kontak_alt_hmac`). `belum_dibaca=1` hanya yang `belum_dibaca > 0`. Jawaban `{ items, setelah }` |
| `GET /conversations/:id` | Satu percakapan, data yang sama dengan satu item daftar |
| `GET /conversations/:id/messages?sebelum=&batas=` | Pesan masuk dan keluar, terbaru dulu. Jawaban `{ items, sebelum }` |
| `GET /media/:id` | Unduh media masuk atau keluar milik nomor pemanggil. `Content-Type` dari MIME tersimpan, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`. Media yang tidak disalin (D-7) → `410 media_unavailable` dengan alasannya |
| `POST /devices/:kode/conversations` | `{ to, atas_nama }` → membuka percakapan yang ada (`200`) atau membuat yang baru (`201`) tanpa mengirim apa-apa. Nomor yang cocok dengan `kontak_alt` percakapan LID membuka percakapan LID itu. Syarat sumber dan jejak hubungan diperiksa modul (KIRIM-001 §13 no. 4) |
| `POST /conversations/:id/messages` | Balasan petugas (§5.1) |
| `POST /conversations/:id/read` | `{ atas_nama, sampai_message_id }` → `belum_dibaca = 0`, `dibaca_sampai_at` = waktu pesan itu, lalu `markRead` ke mesin untuk pesan masuk yang belum ditandai, punya `wa_message_id`, sampai pesan itu (per 100). Gagal di mesin tidak menggagalkan jawaban (`200 { mesin: "gagal" }`) dan tidak diulang otomatis: tanda dibaca di HP pengirim tidak penting untuk kerja panitia |

**Item percakapan:**

```json
{
  "id": "…", "device": "spmb",
  "kontak": { "nomor": "+6281234567890", "jenis": "pn" },
  "nama_profil": "Rina", "pesan_terakhir_at": "…", "belum_dibaca": 2,
  "jangan_hubungi": false, "bisa_dibalas_sampai": "…",
  "pesan_terakhir": { "id": "…", "arah": "masuk", "asal": null, "tipe": "teks", "cuplikan": "≤ 200 karakter", "disamarkan": false, "status": "diterima", "waktu": "…" }
}
```

- `kontak.nomor` bernilai `null` untuk LID yang nomornya belum diketahui; `kontak.jenis` `pn` atau `lid`.
- `jangan_hubungi` true bila ada opt-out yang berlaku untuk pemanggil di nomor ini; `bisa_dibalas_sampai` = `pesan_masuk_terakhir_at + 24 jam` bila `jangan_hubungi`, selain itu `null`. Modul memakainya untuk menonaktifkan kolom balas dengan alasan yang jelas.

**Item pesan:**

```json
{
  "id": "…", "arah": "keluar", "asal": "petugas", "diimpor": false,
  "dikirim_oleh": "spmb", "petugas": { "issuer": "…", "sub": "…" },
  "tipe": "gambar", "isi": "caption atau teks", "disamarkan": false,
  "media": { "id": "…", "mime": "image/jpeg", "ukuran": 182311, "tersedia": true, "alasan": null },
  "status": "dibaca", "error_code": null, "waktu": "…", "waktu_mesin": "…"
}
```

- `asal`: `otomatis`, `petugas`, `hp` (diketik di HP nomor itu, J-1), atau `null` untuk pesan masuk.
- `dikirim_oleh`: nama modul untuk pesan otomatis dan petugas (mis. `keluarga` untuk kode verifikasi di nomor `spmb`), `null` untuk `hp` dan pesan masuk.
- `petugas` hanya untuk `asal = petugas`; nama orangnya dicari modul.

### 6.2 Grup (R2: baca dan balas)

| Method + path | Fungsi |
| --- | --- |
| `GET /devices/:kode/groups?setelah=&batas=` | Grup tempat nomor ini menjadi anggota: `id`, `nama`, `jumlah_anggota`, `nomor_ini_admin`, `pesan_terakhir_at`, `belum_dibaca`, `cuplikan` pesan terakhir. Daftar dari `kirim_groups`, disegarkan dari mesin tiap 15 menit dan saat ada pesan dari grup yang belum dikenal. Grup yang sudah ditinggalkan (`keluar_at`) tidak tampil |
| `GET /groups/:id` | Satu grup |
| `GET /groups/:id/messages?sebelum=&batas=` | Isi pesan grup, dengan `pengirim: { nomor, nama_profil }` per pesan masuk |
| `POST /groups/:id/messages` | Balasan petugas ke grup, `Idempotency-Key`, `{ text \| media_id, caption?, atas_nama, ref? }` → `202`. Aturan §5.1 kecuali opt-out (pesan ke grup bukan pesan pribadi ke orang yang opt-out). Status berhenti di `diserahkan` karena mesin belum melaporkan tanda grup (§2) |
| `POST /groups/:id/read` | `{ atas_nama, sampai_message_id }` → `belum_dibaca = 0` di Kirim SQ saja; mesin tidak punya tanda dibaca grup |

Panggilan membuat grup, menambah atau mengeluarkan anggota, tautan undangan, dan mengubah grup adalah **R3** dan menjawab `404` di R2.

## 7. Event ke modul

Format, tanda tangan, retry, dan `event_id` tetap R1 §6.2.

| Event | Kepada | Isi `data` |
| --- | --- | --- |
| `message.status` | Pengirim (R1) **dan pemilik nomor** untuk semua pesan keluar di nomornya. Bila pengirim = pemilik, satu event saja | R1: `id`, `ref`, `status`, `error_code`, `dry_run`; **ditambah** `conversation_id` atau `group_id`. `ref` hanya diisi untuk penerima yang mengirim pesan itu (ref milik modul pengirim) |
| `message.received` | Pemilik nomor (R1) | R1 tetap; `nama_profil` kini terisi dari kontak atau J-3 bila diketahui. Tidak dikirim untuk pesan impor |
| `message.sent` **(baru)** | Pemilik nomor | Pesan keluar baru di nomornya yang **tidak** dibuat oleh pemilik sendiri: dari HP (`asal: hp`, J-1) atau pesan otomatis modul lain. `{ device, conversation_id \| group_id, message_id, asal, dikirim_oleh, tipe, cuplikan, disamarkan, status, waktu }`. Untuk `asal: hp`, `belum_dibaca` percakapan menjadi 0, karena orang yang membalas di HP sudah membaca |
| `group.message.received` **(baru)** | Pemilik nomor | `{ device, group_id, message_id, pengirim: { nomor, nama_profil }, tipe, cuplikan, menyebut_nomor_ini, received_at }`. `menyebut_nomor_ini` `null` sampai J-3 |
| `device.status` | R1 | Tidak berubah |

Pemakai yang memvalidasi tipe event harus mengabaikan tipe yang tidak dikenal dengan `2xx` (pola penangan SPMB dan Keluarga SQ sejak 2026-10-19).

## 8. Jangan hubungi

| Method + path | Fungsi |
| --- | --- |
| `POST /internal/kirim/optouts` | R1, ditambah `{ "nomor", "cakupan": "device", "device": "spmb", "alasan" }` — **hanya pemilik nomor**, selain itu `403 not_owner`. Berlaku untuk semua pesan otomatis lewat nomor itu dari modul mana pun, kecuali `kode` |
| `DELETE /internal/kirim/optouts` | `{ "nomor", "cakupan": "consumer" \| "device", "device"?, "alasan" }` → mencabut opt-out yang **dibuat pemakai itu sendiri**. Opt-out dari admin atau modul lain tidak bisa dicabut lewat sini (`404`). Idempoten; menulis audit `optout.cabut` |

Pemeriksaan opt-out R1 (§5.1 langkah 9) ditambah cakupan `device`. Aturan 24 jam hanya berlaku untuk balasan petugas (§5.1), tidak untuk pesan otomatis.

## 9. Kontak LID dan nama profil

- Penyegar kontak berjalan tiap 6 jam per nomor `jalurpesan`, dan segera setelah percakapan LID baru dibuat: membaca `GET .../contacts` per halaman 200.
- Untuk percakapan `lid` yang `canonicalJid`-nya nomor telepon: isi `kontak_alt_hmac`/`kontak_alt_enc`. Percakapan **tidak digabung**: riwayatnya tetap satu, dan kiriman berikutnya ke nomor itu memakai percakapan LID tersebut (§6.1 `POST /devices/:kode/conversations`, `POST /messages` R1).
- Bila sebelumnya sudah ada percakapan `pn` terpisah untuk nomor yang sama, keduanya tetap ada; daftar percakapan menampilkan keduanya dengan nomor yang sama, dan admin mendapat ringkasan "percakapan ganda" di layar Aktivitas. Penggabungan otomatis tidak dilakukan di R2 karena tidak bisa dibatalkan.
- `displayName` mengisi `nama_profil_enc` bila kosong; J-3 (`pushName`) menimpanya dengan nama terbaru dari pesan masuk.
- `message.received.from` tetap `null` untuk LID yang nomornya belum diketahui, dan berisi nomor bila sudah (R1 D-6 selesai).

## 10. Impor riwayat chat lama

Dijalankan **`kirim_admin`** dari layar Nomor (§12), sekali per nomor, dengan ringkasan jumlah dan audit. Pesan impor: `diimpor = true`, tidak memicu `message.received`, `message.sent`, balasan otomatis, atau notifikasi, dan tidak mengubah `belum_dibaca` maupun `pesan_masuk_terakhir_at` (jadi tidak membuka aturan 24 jam).

### 10.1 Jalur perangkat tertaut (utama, butuh J-2)

1. Admin memilih **Impor dari WhatsApp** untuk nomor itu dan jumlah pesan per percakapan (bawaan 200, maks. 500).
2. Kirim SQ membuat satu `kirim_history_imports` per percakapan yang dikenalnya, lalu memprosesnya **satu per satu** (mesin hanya menerima satu permintaan menunggu per nomor).
3. Untuk tiap percakapan: `requestHistory` → tunggu status selesai (tanya tiap 10 detik, batas 10 menit; lewat batas → `gagal` dengan alasan "WhatsApp tidak mengirim riwayat") → ambil hasil per halaman → masukkan ke `kirim_messages`, unduh media seperti R1 §5.4.
4. **Pencegah ganda:** pesan yang `wa_message_id`-nya sudah ada di percakapan itu dilewati (`jumlah_ganda`).
5. Ringkasan di layar: percakapan selesai/gagal, pesan dimasukkan, ganda, dilewati.

Batas yang perlu diketahui panitia: percakapan yang **tidak pernah aktif lagi sejak nomor ditautkan** belum punya pesan tersimpan, sehingga WhatsApp tidak bisa diminta riwayatnya. Seberapa jauh ke belakang WhatsApp mau mengirim juga ditentukan WhatsApp. Untuk chat semacam itu dipakai §10.2. Uji kelayakan di nomor `spmb` adalah gate §15.

### 10.2 Jalur berkas Ekspor chat (cadangan)

1. Di HP nomor itu: buka chat → **Lainnya → Ekspor chat → Tanpa media**. Berkasnya `.txt`.
2. Admin mengunggah berkas di layar Impor riwayat **dan mengetik nomor lawan bicara** (berkas ekspor hanya memuat nama kontak, bukan nomor). Maks. 10 MiB per berkas.
3. Pengurai mengenali format tanggal Android dan iPhone dalam bahasa Indonesia dan Inggris (`19/10/26 09.12 - Nama: isi`, `[19/10/26 09.12.33] Nama: isi`, dan variasi 12/24 jam). Baris tanpa awalan tanggal disambung ke pesan sebelumnya. Pesan sistem ("Pesan dan panggilan terenkripsi…", "<Media tidak disertakan>") dilewati dan dihitung.
4. Arah pesan ditentukan dari nama pengirim: admin memilih nama mana yang adalah nomor yayasan (pratinjau 20 pesan pertama sebelum memasukkan).
5. **Pencegah ganda** terhadap pesan yang sudah ada (dari mesin atau impor sebelumnya): menit yang sama, arah sama, dan HMAC isi sama.
6. Berkas dibaca di memori (≤ 10 MiB), tidak disimpan di disk, dan tidak masuk log.

## 11. Akses dan keamanan

- Semua rute §6–§8 di `/internal/kirim/*`: loopback saja, `404` di edge (uji edge R1 diulang untuk rute baru).
- **Pemilik nomor saja** untuk §6 dan cakupan `device`; diperiksa di setiap panggilan dari `kirim_devices.pemilik_consumer_id`, bukan dari data yang dikirim pemakai.
- `atas_nama` dicatat apa adanya; Kirim SQ tidak menafsirkan atau memvalidasi petugas. Modul pemilik wajib memeriksa hak petugas sebelum memanggil (KIRIM-001 §3.3), dan itu dicek di review spesifikasi modul (SPMB-002 / spesifikasi K2).
- `kirim_admin` **tetap tidak bisa membaca isi chat**. Layar Impor riwayat hanya menampilkan jumlah dan pratinjau 20 baris berkas yang ia unggah sendiri.
- Unduh media mengirim isi yang sudah didekripsi hanya ke loopback; tidak ada URL bertanda tangan atau tautan publik.
- Log: rute baru masuk serializer privasi R1. Uji tangkap log (§14) diperluas ke baca, balas, unduh, grup, kontak, dan impor.

## 12. Layar admin (`kirim.sabilulquran.or.id`)

**Jangan hubungi** (baru)

- Daftar opt-out: nomor tersamar (atau "—" untuk baris R1), cakupan (Semua / Nomor `spmb` / Modul `hcis`), alasan, sumber, tanggal. Saring cakupan dan sumber.
- Tambah: nomor, cakupan **Semua** atau **per nomor**, alasan. Hapus: hanya baris dengan sumber admin, dengan alasan. Setiap aksi tercatat.
- Admin tidak bisa mencari berdasarkan isi, hanya nomor persis.

**Aktivitas** (baru)

- Audit terbaru dengan saring aksi, nomor, pemakai, dan tanggal: aktor (petugas tampil sebagai `issuer`/`sub` tersamar), aksi, objek, hasil, waktu. **Tanpa isi pesan dan tanpa nomor utuh.**
- Ringkasan harian per modul dan nomor: pesan otomatis, balasan petugas, pesan dari HP, pesan masuk, gagal, percakapan dibuka, media diunduh; percakapan ganda LID/nomor (§9).

**Nomor → Impor riwayat** (baru)

- Tombol **Impor dari WhatsApp** (nonaktif dengan keterangan bila J-2 belum ada di mesin) dan **Unggah ekspor chat**.
- Kemajuan per percakapan dan ringkasan akhir; riwayat impor sebelumnya.

Setiap layar memeriksa state loading, kosong, galat, terlarang (403), dan lebar 390 px.

## 13. Konfigurasi

| Variabel | Isi |
| --- | --- |
| `KIRIM_GROUP_REFRESH_INTERVAL_MS` | Bawaan 900000 (15 menit) |
| `KIRIM_CONTACT_REFRESH_INTERVAL_MS` | Bawaan 21600000 (6 jam) |
| `KIRIM_REPLY_DEFAULT_TTL_HOURS` | Bawaan 72 (T-2) |
| `KIRIM_HISTORY_IMPORT_ENABLED` | `true`/`false`, bawaan `false`; `true` hanya setelah J-2 terpasang di mesin |

Tidak ada secret baru. `infra/production.env.example` diperbarui dengan nama variabel tanpa nilai.

## 14. Uji

**Otomatis (wajib lulus di CI):**

- **Unit:** urutan prioritas `kode` > `petugas` > `tinggi` > `normal`; `percakapan` bebas jam; batas laju bersama otomatis + petugas; aturan opt-out 24 jam tepat di 23:59 dan 24:00; magic bytes JPEG/PNG/PDF dan MIME palsu; cursor stabil saat ada pesan baru; pengurai Ekspor chat untuk enam contoh format, baris sambungan, dan pesan sistem; pencegah ganda impor.
- **API (PostgreSQL uji):**
  - setiap rute §6: bukan pemilik → `403 not_owner` (termasuk pemakai yang punya rute kirim di nomor itu); tanpa `atas_nama` → `400`; percakapan nomor lain → `404`;
  - jawaban memuat isi dan nomor utuh, **kecuali** `kode` (`isi: null`, `disamarkan: true`);
  - balas: idempotensi seperti R1; opt-out ditolak tanpa pesan masuk 24 jam, diterima dengan pesan masuk 24 jam; kuota harian tidak berkurang; kedaluwarsa 72 jam;
  - buka percakapan: nomor yang sama dua kali → satu percakapan; nomor yang cocok `kontak_alt` → percakapan LID;
  - tandai dibaca: `belum_dibaca = 0`, mesin dipanggil hanya untuk pesan dengan `wa_message_id`, per 100; kegagalan mesin tidak menggagalkan jawaban;
  - opt-out `device` hanya oleh pemilik; `DELETE` tidak bisa mencabut milik admin atau modul lain;
  - audit: satu `percakapan.baca` per 15 menit per petugas per percakapan; balas, unduh, buka, dan tandai dibaca selalu tercatat; tidak ada isi di `kirim_audit.metadata`.
- **Ingest:** pesan grup masuk ke `kirim_groups`/`kirim_messages` dengan pengirim, tidak membuat percakapan pribadi; `message.sent` dari J-1 (stub) membuat pesan `asal: hp` dan mengosongkan `belum_dibaca`; pesan yang dikirim lewat API tidak tercatat dua kali; `wa_message_id` tersimpan.
- **Event:** `message.status` ke pemilik untuk pesan modul lain, tanpa `ref` milik modul lain; satu event bila pengirim = pemilik; `group.message.received` dan `message.sent` sesuai §7; pesan impor tidak menerbitkan event.
- **Provider:** adapter JalurPesan terhadap stub kontrak: unggah `image` dan `document`, `toJid` untuk LID, `messages/read` per 100, daftar grup, kirim grup, kontak, J-2.
- **Migration:** kosong, salinan skema production, dua kali; `ditangani_oleh` terisi → migration gagal tanpa perubahan; **release R1 di atas skema R2** menjalankan uji integrasi R1 tanpa galat, dan langkah sebelum rollback di §4.3 no. 3 terbukti menghentikan balasan petugas dan grup yang masih antre.
- **Privasi log:** tidak ada isi, nomor utuh, nama profil, nama grup, `atas_nama`, atau isi berkas ekspor di log.
- **Web:** layar Jangan hubungi, Aktivitas, dan Impor riwayat untuk state loading, kosong, galat, 403, dan 390 px.

**Manual sebelum rilis:**

- Edge: rute §6 `404` dari luar di host `kirim.` dan `hub.`.
- Dari SPMB (atau skrip uji dengan client `spmb-api`) di nomor `spmb`: daftar percakapan, baca, balas teks dan gambar ke HP uji, tanda dibaca muncul di HP uji, unduh gambar dari HP uji, balas grup uji.
- J-1: balasan yang diketik di HP nomor `spmb` muncul di percakapan sebagai `hp` dalam 1 menit.
- J-2: impor 50 pesan dari satu percakapan uji; ulangi → semuanya ganda.
- Ekspor chat: satu berkas dari HP Android dan satu dari iPhone.

## 15. Gate Mi8 dan rilis

| Gate | Ukuran | Batas |
| --- | --- | --- |
| Memori SQ Hub API | RSS sebelum dan 24 jam sesudah R2 dengan penyegar grup/kontak aktif | Kenaikan < 15 MiB di atas R1 |
| Beban baca (KIRIM-001 §12 Gate R2) | Waktu jawab `GET …/messages` dan `GET /media/:id` di Mi8 dengan 50 permintaan per menit (perkiraan puncak gelombang SPMB) | p95 < 300 ms untuk daftar; unduh media 1 MiB < 2 detik; MemAvailable tidak turun di bawah 900 MiB |
| Disk | Ukuran `KIRIM_MEDIA_ROOT` sebelum dan sesudah impor | Impor dihentikan bila bebas < 10 GiB (D-7) |
| **J-1 terpasang** | Uji manual §14 | Wajib sebelum SPMB memakai kotak masuk untuk kerja harian |
| Kelayakan impor | Uji J-2 di nomor `spmb` | Hasil dicatat; menentukan berapa banyak chat yang perlu §10.2 |

Langkah production (masing-masing butuh persetujuan owner, dicatat di ledger operasi):

| # | Langkah | Rollback |
| --- | --- | --- |
| 1 | Rilis JalurPesan dengan J-1 (dan J-2/J-3 bila siap), dengan spesifikasinya sendiri | Release JalurPesan sebelumnya |
| 2 | Backup lalu rilis SQ Hub dengan R2 dan migration 0011 (`KIRIM_HISTORY_IMPORT_ENABLED=false`) | Release SQ Hub sebelumnya (§4.3) |
| 3 | Ukur gate memori dan beban baca | — |
| 4 | Uji manual §14 di nomor `spmb` bersama Ketua Panitia SPMB | — |
| 5 | `KIRIM_HISTORY_IMPORT_ENABLED=true` setelah J-2 terpasang; impor riwayat nomor `spmb` oleh `kirim_admin` | `false`; pesan impor tetap (tidak dihapus tanpa PO) |

## 16. Kriteria penerimaan R2

1. Semua uji otomatis lulus; typecheck, lint, dan build lulus.
2. Hanya pemilik nomor yang bisa membaca percakapan, unduh media, membalas, dan menandai dibaca; setiap panggilan tanpa `atas_nama` ditolak.
3. Balasan petugas terkirim di depan antrean otomatis, bebas jam kirim, tunduk pada batas laju dan aturan opt-out 24 jam, dan menunggu selama nomor terputus sampai kedaluwarsa.
4. Kotak masuk modul bisa diperbarui langsung dari event: pesan masuk, pesan keluar dari mana pun (termasuk HP, setelah J-1), dan status setiap pesan keluar di nomornya.
5. Grup bisa dibaca dan dibalas; pesan grup tidak membuat percakapan pribadi.
6. Opt-out per nomor dari pemilik menghentikan pesan otomatis modul lain di nomor itu, kecuali `kode`.
7. Kontak LID tampil dengan nomornya bila mesin mengetahuinya.
8. Riwayat lama bisa diimpor lewat mesin (setelah J-2) dan lewat berkas Ekspor chat, tanpa ganda dan tanpa event.
9. `kirim_admin` tetap tidak bisa membaca isi chat; layar Jangan hubungi dan Aktivitas tanpa isi pesan dan tanpa nomor utuh.
10. Kolom `ditangani_oleh` hilang dari skema; release R1 masih bisa berjalan di skema R2 dengan langkah rollback §4.3 no. 3.
11. Gate §15 tercatat.

## 17. Hal yang perlu diputuskan Product Owner

| # | Topik | Saran |
| --- | --- | --- |
| T-1 | Perubahan JalurPesan J-1…J-3 (§2). J-1 menutup celah besar: tanpa itu balasan panitia dari HP nomor SPMB tidak tampil di kotak masuk | **Dikerjakan di repo JalurPesan dengan spesifikasi kecil sendiri, sebelum rilis R2.** J-1 wajib (gate), J-2 dan J-3 boleh menyusul tanpa menahan R2 |
| T-2 | Berapa lama balasan petugas boleh menunggu saat nomor terputus sebelum dianggap gagal? | **72 jam bawaan**, boleh diatur modul sampai 7 hari. Lebih dari itu isi balasan kemungkinan sudah tidak relevan |
| T-3 | KIRIM-IMPL-001 D-2 menjanjikan layar delegasi `kirim_admin` di R2 "bersama petugas per nomor", yang sudah dihapus revisi 3 | **Tetap lewat CLI.** Pengelola hanya Kepala HCM dan 1–2 admin SQ Core, jarang berubah |
| T-4 | Ekspor chat: hanya teks, atau juga media (berkas `.zip`)? | **Teks saja (`.txt`) di R2.** Membaca `.zip` butuh dependensi baru dan memori lebih di Mi8; media lama yang penting bisa dikirim ulang oleh panitia. Media menyusul bila uji impor menunjukkan perlu |
| T-5 | Apakah balasan petugas dihitung dalam kuota harian modul (bawaan 500 pesan/hari)? | **Tidak dihitung.** Kuota untuk mencegah pesan otomatis berlebihan; membatasi balasan petugas bisa membuat panitia berhenti membalas di puncak gelombang. Batas laju nomor tetap melindungi dari blokir |
| T-6 | Percakapan ganda untuk orang yang sama (satu tercatat sebagai LID, satu sebagai nomor) | **Tidak digabung otomatis di R2**; ditampilkan di Aktivitas. Penggabungan permanen tidak bisa dibatalkan, jadi menunggu data seberapa sering terjadi |

## 18. Dampak pada dokumen lain

- **KIRIM-001:** §5.2 ditambah event `message.sent` dan `group.message.received`; §5.5 dicatat batas jalur perangkat tertaut (§10.1) dan bahwa sinkron awal tidak memuat isi pesan; §9 R2 merujuk dokumen ini. Dilakukan setelah spesifikasi ini ACCEPTED.
- **KIRIM-IMPL-001:** tidak diubah. D-2 (layar delegasi) dan D-6 (pemetaan LID) dilanjutkan di sini (T-3, §9).
- **SPMB-002 / spesifikasi SPMB K2:** memakai §6–§8 sebagai kontrak; penangan webhook SPMB menerima `message.sent` dan `group.message.received`; status "menunggu nomor tersambung" dibaca dari `message.status` `antre` + `device.status`.
- **JalurPesan:** spesifikasi kecil untuk J-1…J-3 (T-1).
- **`docs/specs/README.md`:** KIRIM-IMPL-002 ditambahkan (PR ini).

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-10-19 | DRAFT pertama untuk R2 dari KIRIM-001 revisi 3 dan keputusan PO §13 no. 1–7, setelah memeriksa kode sumber JalurPesan |
