# KIRIM-IMPL-001 — Kirim SQ R1: nomor dan kirim

**Status:** ACCEPTED (Product Owner, 2026-10-17). Spesifikasi ini mengizinkan implementasi di repository; setiap langkah production tetap memerlukan persetujuan owner (§15).
**Produk:** SQ Hub — modul `kirim` (Kirim SQ)
**Owner produk:** Kepala HCM (`kirim_admin`, KIRIM-001 §1 butir 9)
**Tanggal:** 2026-10-17
**Depends on:**
- [KIRIM-001](../product/kirim-sq-module-design.md) revisi 2, terutama §4–§9 dan §12
- [ADR-0011](../architecture/adr/0011-kirim-sq-shared-whatsapp-capability.md) (ACCEPTED 2026-10-17)
- [ADR-0006](../architecture/adr/0006-engineering-stack.md) (stack), ADR-0001 (shared capability), ADR-0003 (Keycloak)
- HUB-IMPL-002 / HUB-IMPL-009 (Application Registry dan Application Access), HUB-IMPL-016 (launcher production)
- JalurPesan `jalurpesan.web.id` platform API (`/api/v1/platform/tenants/:externalTenantId/...`)

**Pemakai pertama:** SPMB SQ (`sq-spmb/docs/specs/SPMB-IMPL-001-r0-fondasi-pengaturan-publik.md` §6.1, §17) dan HCIS. Keluarga SQ (KEL-IMPL-001) mengirim kode lewat nomor `spmb`.

## 1. Tujuan dan batas rilis

R1 membuat Kirim SQ bisa **mengirim pesan otomatis sungguhan** untuk modul pemakai, dan **menyimpan semua pesan** sejak hari pertama, sehingga inbox R2 langsung punya riwayat.

R1 berisi:

1. **Nomor:** mendaftarkan nomor (`kirim_devices`), memasang lewat QR atau kode pairing, melihat status tersambung, memutus, menonaktifkan, dan memilih provider per nomor.
2. **Provider:** antarmuka provider internal dengan adapter `log` (bawaan) dan `jalurpesan`.
3. **Worker kirim** di dalam proses SQ Hub API: antrean, batas laju per nomor, jam kirim, retry, kedaluwarsa, dan idempotensi.
4. **API pemakai:** `POST /internal/kirim/messages`, `POST /internal/kirim/media`, `GET /internal/kirim/messages/:id`, dan `POST /internal/kirim/optouts` (lihat D-5).
5. **Penyimpanan:** semua pesan keluar dan masuk di `kirim_conversations` dan `kirim_messages`, isi dan nomor utuh **terenkripsi di kolom**, dicari lewat HMAC.
6. **Event ke modul:** webhook bertanda tangan HMAC `message.status`, `message.received`, dan `device.status`.
7. **Akses:** token client credentials realm `sq-staff` dengan audience `sq-hub-kirim` untuk API pemakai; aplikasi "Kirim SQ" di Application Access untuk layar admin.
8. **Layar admin minimum** di `kirim.sabilulquran.or.id`: **Nomor** dan **Antrean**.

Di luar R1 (KIRIM-001 §9):

- inbox, membaca isi percakapan di layar, balas dari layar, tanda sudah dibaca ke WhatsApp (`markRead`) — **R2**;
- menu WhatsApp di HCIS dan SPMB, petugas per nomor (`kirim_device_members`), tombol aksi modul (`kirim_actions`, `PUT /internal/kirim/devices/:kode/actions`) — **R2**;
- layar Jangan hubungi dan Aktivitas — **R2** (data dan audit-nya sudah ada di R1);
- provider `meta-cloud`, kanal email, inbox yang ditanam di halaman modul — **kelak**;
- grup WhatsApp, broadcast massal, templat per domain — **tidak dibangun** (KIRIM-001 §2).

## 2. Keputusan teknis

| Topik | Keputusan | Alasan / sumber |
| --- | --- | --- |
| Letak kode | `apps/api/src/modules/kirim/` dan layar di `apps/web`. Modul hanya mengimpor auth (hub-auth, machine-auth) dan Application Access | ADR-0011: bisa diekstrak kelak |
| Proses | **Tidak ada proses baru.** Worker kirim dan penarik event berjalan sebagai timer di proses SQ Hub API (port 3302 Mi8) | ADR-0011; memori Mi8 |
| Stack | ADR-0006: Fastify 5, `pg`, Zod, Vitest, SQL migration polos. Dependensi baru: hanya `@fastify/multipart` untuk unggah media (D-9). Tanpa Baileys, tanpa queue eksternal | ADR-0006, ADR-0011 |
| Database | Tabel berawalan `kirim_` di database SQ Hub yang sama (`sq_hub_production`) | ADR-0011 |
| Rute | `/internal/kirim/*` untuk modul pemakai (loopback saja, diblokir di edge). `/api/admin/kirim/*` untuk layar admin. `/api/kirim/*` disimpan untuk inbox R2 | ADR-0011 dan KIRIM-001 §3.1 |
| Provider | Dipilih **per nomor** di kolom `kirim_devices.provider` (`log` atau `jalurpesan`); URL dan kunci mesin dari env. Bawaan nomor baru: `log` | KIRIM-001 §3.4 |
| Mesin trial | JalurPesan `127.0.0.1:3401`, satu platform `sq-core`, satu tenant per nomor (`hcis`, `spmb`) | ADR-0011 |
| Autentikasi pemakai | JWT client credentials `sq-staff`, `aud` berisi `sq-hub-kirim`, diverifikasi dengan `createKeycloakMachineTokenVerifier` yang sudah ada; `azp`/`client_id` dipetakan ke `kirim_consumers` yang `aktif` | KIRIM-001 §5 |
| Enkripsi kolom | AES-256-GCM dengan kunci data khusus Kirim (`KIRIM_DATA_KEYS`), amplop `v1.<kid>.<iv>.<ciphertext>.<tag>`, AAD = `tabel:kolom:id`. Pencarian lewat HMAC-SHA256 dengan kunci terpisah (`KIRIM_LOOKUP_KEY`). **Tidak** diturunkan dari secret OIDC seperti `HubTokenVault` | KIRIM-001 §4, §12; rotasi secret OIDC tidak boleh membuat riwayat tak terbaca |
| Tanda tangan webhook ke pemakai | `X-Kirim-Timestamp` (detik Unix), `X-Kirim-Event-Id`, `X-Kirim-Signature` = hex HMAC-SHA256(rahasia per pemakai, `timestamp + "." + body mentah`), toleransi 5 menit | Usulan SPMB-IMPL-001 §17 butir 1–2, diterima di sini |
| Zona waktu jam kirim | `Asia/Jakarta` (WIB, UTC+7 tetap) | KIRIM-001 §1 butir 11 |
| Web | Bundle `apps/web` yang sama dengan Hub; bila `location.host` adalah `kirim.`, router memuat shell Kirim SQ (Nomor, Antrean) dan tidak menampilkan halaman Hub | Tanpa proses web baru |
| Hostname admin | `kirim.sabilulquran.or.id` → edge 3180 → web 3202 / API 3302 Mi8 | KIRIM-001 §8 |
| Login layar admin | Client OIDC sendiri `kirim-sq` (realm `sq-staff`, confidential, PKCE S256) dengan cookie sesi host-only `sq_kirim_session` di host `kirim.`; memakai ulang kode hub-auth dengan konfigurasi kedua (D-1) | AGENTS.md §5: tidak ada cookie wildcard lintas subdomain |

## 3. Arsitektur

```text
SPMB / HCIS / Keluarga SQ / Karir (backend, Mi8 loopback)
   │ POST http://127.0.0.1:3302/internal/kirim/messages
   │ Authorization: Bearer <client credentials, aud sq-hub-kirim>
   │ Idempotency-Key: <kunci pemakai>
   ▼
SQ Hub API (3302) ─ modul kirim
   ├─ routes/internal   : validasi, kuota, opt-out, rute → kirim_outbox + kirim_messages (status antre)
   ├─ worker (timer 2 dtk): ambil outbox jatuh tempo per nomor (FOR UPDATE SKIP LOCKED)
   │                       → batas laju, jam kirim, kedaluwarsa → provider.sendText/sendDocument
   ├─ provider log        : tidak mengirim; status `diserahkan` dengan dry_run
   ├─ provider jalurpesan : POST http://127.0.0.1:3401/api/v1/platform/tenants/<tenant>/{media,messages}
   ├─ ingest              : POST /internal/kirim/engine/jalurpesan/webhook (bertanda tangan JalurPesan)
   │                       + penarik GET .../events?after=<cursor> tiap 60 dtk dan saat start
   │                       → kirim_messages masuk / status keluar → kirim_webhook_deliveries
   ├─ pengirim webhook    : POST webhook_url pemakai (bertanda tangan Kirim SQ), retry
   └─ routes/admin        : /api/admin/kirim/* (Nomor, Antrean) untuk kirim_admin

Admin ── https://kirim.sabilulquran.or.id ── Tunnel ── edge 3180 ── web 3202 / API 3302
                                                       (/internal/* → 404 di edge)
```

### 3.1 Struktur kode (usulan)

```text
apps/api/src/modules/kirim/
  config.ts            # env + validasi (kunci, URL mesin, interval)
  crypto.ts            # seal/open kolom, hmac lookup, normalisasi nomor
  repository.ts        # SQL kirim_*
  service.ts           # terima pesan, opt-out, kuota, rute, status
  worker.ts            # loop kirim, rate limit, jam kirim, retry
  ingest.ts            # event mesin → pesan masuk / status
  webhooks.ts          # antrean dan pengiriman webhook ke pemakai
  providers/
    types.ts           # KirimProvider
    log.ts
    jalurpesan.ts
  routes-internal.ts   # /internal/kirim/*
  routes-admin.ts      # /api/admin/kirim/*
apps/api/src/cli/kirim-admin.ts   # bootstrap kirim_admin, daftar pemakai, nomor
apps/api/migrations/00NN_kirim_r1.sql
apps/web/src/kirim/                # shell Kirim SQ, layar Nomor dan Antrean
```

### 3.2 Kontrak provider

```ts
interface KirimProvider {
  readonly name: "log" | "jalurpesan";
  sendText(device: DeviceRef, to: Recipient, text: string, idempotencyKey: string): Promise<SendResult>;
  sendDocument(device: DeviceRef, to: Recipient, file: MediaFile, caption: string | null, idempotencyKey: string): Promise<SendResult>;
  deviceStatus(device: DeviceRef): Promise<ProviderDeviceStatus>;   // status + qr data-URL bila menunggu
  provision(device: DeviceRef, label: string): Promise<void>;       // idempoten
  startPairing(device: DeviceRef, mode: "qr" | { phone: string }): Promise<PairingResult>;
  disconnect(device: DeviceRef): Promise<void>;                     // logout sesi WhatsApp
  pullEvents(device: DeviceRef, cursor: number, limit: number): Promise<ProviderEventPage>;
  // markRead(device, conversation) ditambahkan di R2
}

type SendResult =
  | { ok: true; providerMessageId: string; dryRun: boolean }
  | { ok: false; kind: "rejected"; code: KirimErrorCode }          // tidak di-retry
  | { ok: false; kind: "retryable"; code: KirimErrorCode }         // retry dengan kunci sama
  | { ok: false; kind: "device"; code: "device_disconnected" };    // jeda antrean nomor itu
```

**Adapter `log`:** tidak membuka koneksi jaringan. `sendText`/`sendDocument` mengembalikan `providerMessageId = "log:" + idempotencyKey` dan `dryRun: true`. `deviceStatus` selalu `tersambung`. `pullEvents` selalu kosong. Log hanya memuat nomor tersamar dan panjang isi.

**Adapter `jalurpesan`** (kontrak dari `server/src/routes/platform-tenants.ts`, `media.ts`, `events.ts`, `services/webhook-delivery.ts`):

| Operasi | Panggilan JalurPesan | Pemetaan |
| --- | --- | --- |
| `provision` | `PUT /api/v1/platform/tenants/:tenant/device` `{ name }` | 201/200 = ada. 409 `Configured active device safety cap reached` → galat admin "Kapasitas mesin penuh" |
| `deviceStatus` | `GET .../device` | `liveState.status`: `connected` → `tersambung`; `qr` → `menunggu_pairing` (+ `qr`); `connecting` → `menunggu_pairing` bila belum pernah tersambung, `terputus` bila pernah; `disconnected` → `terputus`. 404 → `belum_dipasang` |
| `startPairing` QR | `POST .../device/connect` lalu `GET .../device` | QR data-URL hanya diteruskan ke layar admin, tidak disimpan dan tidak dicatat di log |
| `startPairing` kode | `POST .../device/pairing-code` `{ phone }` (digit saja, 8–15) | Kode pairing hanya ditampilkan, tidak disimpan |
| `disconnect` | `POST .../device/logout` | Sesi WhatsApp lepas; nomor perlu pairing ulang |
| `sendText` | `POST .../messages` `{ to, message }`, header `Idempotency-Key: kirim:<outbox_id>` | 200 `{ messageId }` → `diserahkan`. 400 penerima tidak sah → `rejected/invalid_number`. 404 → `device/device_disconnected`. 409 `idempotency_key_conflict` → `rejected/engine_conflict` + peringatan. 409 in-progress, 409 reset-required → `device`. 5xx/timeout 15 dtk → `retryable/engine_unavailable` |
| `sendDocument` | `POST .../media?type=document` (multipart, sekali per berkas per nomor, `mediaId` mesin dicache di `kirim_media_engine_refs`) lalu `POST .../messages` `{ to, mediaId, caption }` | Seperti `sendText` |
| `pullEvents` | `GET .../events?after=<cursor>&limit=100` | `message.received`, `message.delivered`, `message.read` |
| Unduh media masuk | `GET .../media/:mediaId` | Disalin ke penyimpanan Kirim SQ (§5.4) |

`to` dikirim sebagai digit internasional tanpa `+`, sesuai `PHONE_PATTERN` JalurPesan. Kunci idempotensi ke mesin diturunkan dari `kirim_outbox.id`, bukan dari kunci pemakai, sehingga retry worker setelah timeout tidak mengirim ganda.

## 4. Data

Migration baru `apps/api/migrations/00NN_kirim_r1.sql` dengan nomor bebas berikutnya saat merge (saat ini `0010`). Migration hanya **menambah** tabel dan index; tidak mengubah atau menghapus tabel yang ada. Pola mengikuti migration lain: `CREATE TABLE IF NOT EXISTS`, `CHECK` eksplisit, `REVOKE ALL ... FROM PUBLIC`.

Tabel R1 (mengikuti KIRIM-001 §4; perbedaan ditandai **+**):

| Tabel | Kolom utama | Catatan |
| --- | --- | --- |
| `kirim_devices` | `id` uuid, `kode` unik (`^[a-z][a-z0-9-]{1,30}$`), `label`, `pemilik_consumer_id`, `provider` (`log`, `jalurpesan`), `provider_ref` (tenant JalurPesan), `nomor_tersamar`, `nomor_enc`, `status` (`belum_dipasang`, `menunggu_pairing`, `tersambung`, `terputus`, `nonaktif`), `antrean_dijeda` bool, `rate_per_menit` (bawaan 10), `jam_kirim_mulai` (06:00), `jam_kirim_selesai` (21:00), `status_berubah_at`, `updated_at` | Satu nomor, satu modul pemilik |
| `kirim_consumers` | `id`, `client_id` unik (Keycloak), `nama` unik, `webhook_url`, `webhook_secret_ref`, `kuota_harian`, `aktif` | `webhook_secret_ref` adalah nama variabel env yang menyimpan rahasia, bukan rahasianya (D-4) |
| `kirim_routes` | `consumer_id`, `device_id`, `jenis` (`notifikasi`, `kode`), PK gabungan | Pemilik nomor otomatis boleh mengirim `notifikasi` lewat nomornya sendiri; baris rute untuk modul lain dan untuk `kode` |
| `kirim_conversations` | `id`, `device_id`, `kontak_hmac`, `kontak_enc`, `kontak_jenis` (`pn`, `lid`) **+**, `kontak_lid_hmac` **+**, `nama_profil_enc` **+**, `pesan_terakhir_at`, `belum_dibaca`, `ditangani_oleh` (null di R1) | Unik (`device_id`, `kontak_hmac`) dan unik (`device_id`, `kontak_lid_hmac`) bila terisi. `nama_profil` ikut dienkripsi karena data pribadi |
| `kirim_messages` | `id`, `conversation_id`, `arah` (`masuk`, `keluar`), `asal` (`otomatis`, `petugas`), `petugas` null, `jenis` (`notifikasi`, `kode`, null untuk masuk) **+**, `tipe` (`teks`, `dokumen`, `gambar`, `audio`, `video`, `stiker`, `lainnya`) **+**, `body_enc`, `body_disamarkan` bool **+**, `media_id`, `provider`, `provider_message_id`, `dry_run` **+**, `status` (`antre`, `diserahkan`, `terkirim`, `dibaca`, `gagal`, `dibatalkan`, `diterima`), `created_at`, `provider_at` | Disimpan selamanya. Unik (`provider`, `device_id`, `provider_message_id`) bila tidak null, sehingga event ganda tidak membuat pesan ganda |
| `kirim_outbox` | `id`, `consumer_id`, `device_id`, `idempotency_key`, `request_hash` **+**, `jenis`, `prioritas` (`kode` > `tinggi` > `normal`), `to_hmac`, `ref`, `message_id`, `status` (`antre`, `diserahkan`, `terkirim`, `dibaca`, `gagal`, `dibatalkan`), `attempts`, `next_attempt_at`, `error_code`, `created_at`, `expires_at`, `updated_at` | Unik (`consumer_id`, `idempotency_key`). Isi di `kirim_messages` |
| `kirim_media` | `id`, `device_id`, `arah`, `mime`, `ukuran`, `sha256`, `path`, `dienkripsi` bool, `uploaded_by_consumer_id`, `provider_media_id`, `created_at` | Berkas di disk Mi8 (§5.4), bukan di database |
| `kirim_media_engine_refs` **+** | `media_id`, `device_id`, `provider`, `provider_media_id`, `created_at` | Cache `mediaId` JalurPesan per nomor supaya retry tidak mengunggah ulang |
| `kirim_optouts` | `nomor_hmac`, `cakupan` (`semua` atau `consumer_id`), `alasan`, `sumber` (`admin`, `consumer`) **+**, `created_at` | Diperiksa sebelum kirim, kecuali `jenis = kode` |
| `kirim_events` | `id`, `device_id`, `provider`, `provider_event_id` unik per provider, `provider_cursor`, `jenis`, `payload_ringkas` (tanpa isi pesan), `received_at` | Mencegah event ganda; cursor terakhir per nomor = `max(provider_cursor)` |
| `kirim_webhook_deliveries` **+** | `id` (= `event_id` ke pemakai), `consumer_id`, `event_type`, `payload_enc`, `status` (`pending`, `retry`, `berhasil`, `habis`), `attempts`, `next_attempt_at`, `last_status_code`, `created_at`, `delivered_at` | Antrean webhook keluar; tidak ada di KIRIM-001 §4 tetapi diperlukan agar event tidak hilang saat pemakai mati |
| `kirim_admins` **+** | `identity_issuer`, `identity_subject`, `granted_by`, `granted_at`, `revoked_at`, `alasan` | Siapa `kirim_admin` (D-2) |
| `kirim_audit` | `id`, `actor_kind` (`human`, `service`, `system`), `actor_ref`, `aksi`, `objek_jenis`, `objek_ref`, `hasil`, `metadata` jsonb (tanpa isi pesan dan nomor utuh), `occurred_at` | Pairing, ganti provider, putus, nonaktif, jeda/lanjut antrean, coba ulang, batalkan, opt-out, tambah/cabut admin, pendaftaran pemakai dan rute |

Tidak dibuat di R1 (menyusul migration R2): `kirim_device_members`, `kirim_actions`.

### 4.1 Enkripsi dan pencarian

- Kolom `*_enc` berisi amplop `v1.<kid>.<iv b64url>.<ciphertext b64url>.<tag b64url>`, AES-256-GCM, IV 12 byte acak, AAD `kirim:<tabel>:<kolom>:<id baris>` sehingga nilai tidak bisa dipindah ke baris lain.
- `KIRIM_DATA_KEYS` = daftar `kid:base64(32 byte)`; kunci pertama dipakai untuk menulis, semua kunci dipakai untuk membaca. Rotasi = tambah kunci baru di depan; pesan lama tetap terbaca. Re-enkripsi massal di luar R1.
- `*_hmac` = hex HMAC-SHA256(`KIRIM_LOOKUP_KEY`, nilai kanonik). Nilai kanonik nomor: `pn:+<E.164>`; untuk alamat LID dari WhatsApp: `lid:<jid>` (D-6).
  Sejak revisi D-6 (2026-10-30) percakapan dikunci pada **nomor** bila mesin menyertakannya; LID-nya disimpan di `kontak_lid_hmac`.
- Normalisasi nomor masukan: hapus spasi, tanda hubung, dan kurung; `08…` → `+628…`; `628…` → `+628…`; hasil harus `+` lalu 8–15 digit. Selain itu `422 invalid_number`.
- `nomor_tersamar` = `+62 812-••••-7890` (4 digit terakhir). Hanya bentuk ini yang muncul di log, layar Antrean, dan audit.
- Isi `jenis: kode` disimpan terenkripsi seperti pesan lain, dengan `body_disamarkan = true` supaya inbox R2 menampilkannya sebagai "Kode verifikasi (disamarkan)".
- **Kunci hilang = riwayat hilang.** Kunci disimpan di env produksi SQ Hub dan dicadangkan off-host **terpisah** dari dump database, dengan pemegang yang ditetapkan owner (D-3). Dump database saja tidak membuka isi pesan.

### 4.2 Recovery plan migration

1. Sebelum migrate di production: dump `sq_hub_production` lewat `sq-core-backup.sh` dan catat checksum dump.
2. Migration hanya `CREATE TABLE/INDEX`. Bila gagal, transaksi di-rollback oleh `migrate.ts` (satu file satu transaksi) dan database tetap seperti sebelum migrate.
3. Rollback aplikasi = kembali ke release SQ Hub sebelumnya (OPS-MI8-REL-001). Tabel `kirim_*` dibiarkan; release lama tidak membacanya.
4. **Tidak ada `DROP` di production** setelah ada pesan sungguhan (percakapan disimpan selamanya; menghapus butuh PO). Sebelum ada data sungguhan, skrip `DROP TABLE kirim_*` boleh dijalankan hanya dengan persetujuan owner dan dicatat.
5. Uji pemulihan: dump yang berisi tabel `kirim_*` dipulihkan di lingkungan terpisah, lalu satu pesan terenkripsi dibuka dengan kunci dari cadangan kunci (bukti bahwa cadangan kunci dan dump cocok).
6. Perubahan skema berikutnya selalu migration baru; file yang sudah diterapkan tidak diedit (checksum `schema_migrations`).

## 5. Pengiriman

### 5.1 Menerima permintaan (`POST /internal/kirim/messages`)

Urutan pemeriksaan, berhenti pada yang pertama gagal:

1. Bearer token sah (`aud` berisi `sq-hub-kirim`, issuer `sq-staff`, belum kedaluwarsa) → selain itu `401`.
2. `azp`/`client_id` ada di `kirim_consumers` dan `aktif` → selain itu `403 consumer_unknown`.
3. `Idempotency-Key` ada, 1–200 karakter → selain itu `400`.
4. Body sah (Zod, §6.1) → selain itu `400 invalid_request`.
5. **Idempotensi:** bila (`consumer_id`, `idempotency_key`) sudah ada:
   - `request_hash` sama → jawaban asli (`202` dengan `id` dan status sekarang), tanpa membuat pesan baru;
   - `request_hash` beda → `409 idempotency_key_conflict`.
6. Nomor `device` ada dan tidak `nonaktif` → selain itu `422 device_inactive`.
7. Rute: pemilik nomor boleh `notifikasi`; selain itu harus ada baris `kirim_routes` (`consumer`, `device`, `jenis`) → selain itu `422 route_denied`.
8. Nomor tujuan sah → selain itu `422 invalid_number`.
9. Opt-out (`semua` atau cakupan pemakai ini), kecuali `jenis: kode` → `422 optout`.
10. Kuota harian pemakai (semua jenis, hari WIB) → `422 quota_exceeded`.
11. `media_id` (bila ada) milik pemakai ini dan nomor ini → selain itu `422 media_invalid`.

Lolos semua: dalam satu transaksi buat/temukan `kirim_conversations`, buat `kirim_messages` (`keluar`, `otomatis`, `antre`) dan `kirim_outbox`, lalu jawab `202 { "id", "status": "antre" }`. `kedaluwarsa` bawaan: 24 jam untuk `notifikasi`, dan selalu paling lama 10 menit untuk `kode`.

Bila device `terputus` atau `menunggu_pairing`, permintaan **tetap diterima** dan menunggu di antrean sampai tersambung atau kedaluwarsa; pemakai sudah mendapat `device.status`.

### 5.2 Worker

- Timer setiap 2 detik (`KIRIM_WORKER_INTERVAL_MS`), satu putaran pada satu waktu dalam proses. Klaim baris memakai `SELECT … FOR UPDATE SKIP LOCKED` dengan lease 60 detik, sehingga aman bila kelak ada dua proses.
- Per nomor, urutan klaim: prioritas (`kode`, `tinggi`, `normal`), lalu `created_at`.
- **Lewati nomor** yang `antrean_dijeda`, `nonaktif`, atau tidak `tersambung` (provider `log` selalu dianggap tersambung).
- **Batas laju:** paling banyak `rate_per_menit` pesan otomatis per nomor per 60 detik bergulir, dihitung dari `kirim_messages.provider_at`, dengan jeda acak 2–6 detik antar kiriman pada satu nomor. `kode` boleh mendahului antrean tetapi tetap dihitung.
- **Jam kirim:** `notifikasi` hanya dikirim pada `jam_kirim_mulai`–`jam_kirim_selesai` WIB. Di luar jam, `next_attempt_at` dipindah ke jam mulai berikutnya. Bila `expires_at` jatuh lebih dulu, status `gagal` dengan `error_code = expired`. `kode` bebas jam.
- **Kedaluwarsa:** pesan yang lewat `expires_at` sebelum diserahkan → `gagal/expired`, tanpa dikirim.
- **Retry:** hasil `retryable` dijadwalkan ulang setelah 1, 5, lalu 30 menit (3 kali retry, 4 percobaan). Setelah itu `gagal`. Hasil `rejected` langsung `gagal`. Hasil `device` tidak menambah `attempts`, menandai nomor `terputus`, dan menjeda antrean nomor itu sampai status `tersambung` lagi.
- Setiap perubahan status outbox menulis `message.status` ke `kirim_webhook_deliveries` untuk pemakai pengirim, dalam transaksi yang sama.

### 5.3 Status

| Status outbox | Arti | Dari |
| --- | --- | --- |
| `antre` | Diterima Kirim SQ | §5.1 |
| `diserahkan` | Mesin menerima dan mengirim ke WhatsApp (atau `log` dengan `dry_run`) | Jawaban `sendText`/`sendDocument` |
| `terkirim` | Sampai di HP penerima | Event `message.delivered` |
| `dibaca` | Dibaca penerima | Event `message.read` |
| `gagal` | Tidak terkirim; `error_code` terisi | Worker |
| `dibatalkan` | Dibatalkan admin dari layar Antrean sebelum diserahkan | Admin |

Status hanya bergerak maju (`antre` → `diserahkan` → `terkirim` → `dibaca`); event yang datang terlambat atau tidak berurutan tidak memundurkan status.

Kode galat stabil (`error_code` dan badan `422`): `optout`, `route_denied`, `quota_exceeded`, `device_inactive`, `invalid_number`, `media_invalid`, `expired`, `engine_unavailable`, `engine_rejected`, `engine_conflict`, `cancelled`.

### 5.4 Media

- `POST /internal/kirim/media` (multipart, satu berkas, field `device`): hanya `application/pdf` di R1, maks. 5 MiB, dicek dari magic bytes `%PDF-`, bukan hanya header. Jawaban `201 { "media_id", "sha256", "ukuran" }`. Kirim SQ tidak pernah mengambil URL luar.
- Berkas disimpan di `KIRIM_MEDIA_ROOT` (usulan `/srv/sq-hub/kirim-media/<yyyy>/<mm>/<uuid>`), mode `0600`, milik user layanan SQ Hub, **dienkripsi** dengan kunci data yang sama (D-8).
- Media masuk dari JalurPesan diunduh ke tempat yang sama sampai `KIRIM_INBOUND_MEDIA_MAX_BYTES` (usulan 16 MiB). Lebih besar dari itu: hanya metadata disimpan, pesan diberi tanda "media terlalu besar" (D-7).
- Media yang diunggah tetapi tidak dipakai dalam 24 jam boleh dibersihkan (bukan percakapan). Media yang terhubung ke pesan disimpan selamanya.

## 6. API

Galat memakai bentuk `{ "error": { "code", "message" } }`.

### 6.1 API pemakai (`/internal/kirim`, loopback saja)

| Method + path | Fungsi |
| --- | --- |
| `POST /messages` | Kirim pesan otomatis (§5.1). Body: `device`, `jenis` (`notifikasi`, `kode`), `to`, `text` (1–4096 karakter) **atau** `media_id` dengan `caption` opsional, `prioritas` (`normal`, `tinggi`), `kedaluwarsa` (ISO 8601 opsional), `ref` (≤ 200 karakter, tanpa data pribadi). Jawaban `202 { id, status }` |
| `GET /messages/:id` | Status pesan milik pemakai ini: `id`, `ref`, `status`, `error_code`, `dry_run`, `updated_at`. Pesan pemakai lain → `404` |
| `POST /media` | Unggah PDF (§5.4) |
| `POST /optouts` | `{ "nomor", "cakupan": "consumer", "alasan" }` → opt-out berlaku untuk pemakai ini. Idempoten. Hanya admin yang bisa membuat cakupan `semua` (D-5) |

`GET /internal/kirim/messages/:id` dan semua jawaban **tidak** memuat isi pesan atau nomor utuh.

### 6.2 Event ke pemakai (webhook keluar)

`POST <webhook_url>` dengan `Content-Type: application/json` dan header `X-Kirim-Event-Id`, `X-Kirim-Timestamp`, `X-Kirim-Signature` (§2).

```json
{ "event_id": "…", "type": "message.status", "occurred_at": "…",
  "data": { "id": "…", "ref": "spmb:lead-123:link:v1", "status": "terkirim", "error_code": null, "dry_run": false } }

{ "event_id": "…", "type": "message.received", "occurred_at": "…",
  "data": { "device": "spmb", "conversation_id": "…", "message_id": "…", "from": "+6281234567890",
            "nama_profil": "…", "tipe": "teks", "cuplikan": "≤ 200 karakter", "received_at": "…" } }

{ "event_id": "…", "type": "device.status", "occurred_at": "…",
  "data": { "device": "spmb", "status": "terputus" } }
```

- `message.status` ke pemakai pengirim; `message.received` ke pemilik nomor; `device.status` ke pemilik dan setiap pemakai yang punya rute di nomor itu.
- `from` bernilai `null` hanya bila WhatsApp tidak memberi nomor telepon sama sekali; sejak revisi D-6 (2026-10-30) nomor
  diambil dari `peerJidAlt` sehingga pesan masuk ber-LID tetap membawa nomornya. `nama_profil` diisi dari
  `senderDisplayName` bila mesin mengirimkannya; `conversation_id` tetap stabil.
- `message_id` dan `event_id` memenuhi usulan SPMB-IMPL-001 §17 butir 2–3.
- Pengiriman: timeout 10 detik; `2xx` = berhasil; selain itu retry dengan backoff 30 dtk, 1, 2, 4 … menit sampai maks. 1 jam, paling banyak 8 percobaan, lalu `habis` dan tampil sebagai peringatan admin. Body yang sama dan `event_id` yang sama di setiap percobaan; pemakai wajib menolak `event_id` ganda.
- `webhook_url` R1 hanya boleh `http://127.0.0.1:<port>/…` (pemakai di Mi8) atau `https://<host>.sabilulquran.or.id/…` (D-4).
- **Aturan retry pemakai** (usulan SPMB §17 butir 6): pemakai hanya mengulang `POST /messages` bila tidak mendapat `202` (5xx, timeout, jaringan), dengan kunci yang **sama**. Setelah `202`, kegagalan dilaporkan lewat `message.status`; pemakai tidak mengirim ulang otomatis.

### 6.3 Masukan dari mesin

| Method + path | Fungsi |
| --- | --- |
| `POST /internal/kirim/engine/jalurpesan/webhook` | Menerima webhook JalurPesan. Verifikasi `x-jalurpesan-signature` = `v1=` hex HMAC-SHA256(rahasia langganan, `timestamp + "." + body mentah`), `x-jalurpesan-timestamp` dalam 5 menit, perbandingan waktu-konstan. Tidak sah → `401` tanpa memproses. `eventId` yang sudah tercatat → `200` tanpa memproses ulang |

Penarik event (`pullEvents`) berjalan tiap 60 detik per nomor `jalurpesan` dan saat proses start, mulai dari cursor terakhir di `kirim_events`. Webhook hanya mempercepat; penarik menjamin tidak ada event yang terlewat. Event dari tenant yang tidak dikenal dicatat sebagai peringatan dan dibuang.

Pemrosesan event:

- `message.received`: pesan masuk (bukan grup) → buat/temukan percakapan, simpan `kirim_messages` (`masuk`, `diterima`), unduh media bila ada, naikkan `belum_dibaca`, tulis `message.received` untuk pemilik nomor. Pesan grup diabaikan di R1.
- `message.delivered` / `message.read`: cari pesan keluar lewat `provider_message_id`, majukan status (§5.3), tulis `message.status`.

### 6.4 API admin (`/api/admin/kirim`, sesi `kirim-sq`, peran `kirim_admin`)

Semua perubahan wajib: sesi valid, Application Access aktif untuk `kirim-sq`, terdaftar di `kirim_admins`, permintaan same-origin, dan `alasan` untuk tindakan yang memutus, menonaktifkan, mengganti provider, atau membatalkan. Setiap perubahan menulis `kirim_audit`.

| Method + path | Fungsi |
| --- | --- |
| `GET /context` | Identitas admin dan kemampuan layar |
| `GET /devices` | Daftar nomor: kode, label, pemilik, provider, status, nomor tersamar, antrean (antre/gagal hari ini), status berubah terakhir |
| `POST /devices` | Tambah nomor (`kode`, `label`, `pemilik`, `provider` bawaan `log`, `provider_ref`) |
| `PATCH /devices/:kode` | Ubah label, pemilik, rate, jam kirim, provider/`provider_ref` (hanya saat antrean dijeda dan tidak ada `diserahkan` yang menunggu, KIRIM-001 §10) |
| `POST /devices/:kode/provision` | Siapkan tenant di mesin (idempoten) |
| `POST /devices/:kode/pairing` | `{ "mode": "qr" }` atau `{ "mode": "kode", "phone" }`; jawaban QR data-URL atau kode pairing, berlaku sesaat, `Cache-Control: no-store` |
| `GET /devices/:kode/status` | Status langsung dari mesin (polling layar saat pairing, tiap 3 detik, berhenti setelah 2 menit) |
| `POST /devices/:kode/disconnect` | Logout sesi WhatsApp |
| `POST /devices/:kode/pause`, `/resume` | Jeda/lanjutkan antrean nomor |
| `POST /devices/:kode/deactivate` | Nonaktifkan nomor; permintaan baru ditolak `device_inactive`; antrean tidak dihapus |
| `GET /consumers`, `GET /routes` | Baca pemakai dan rute (pengubahan lewat CLI di R1, D-4) |
| `GET /queue?device=&status=&page=` | Antrean: `id`, pemakai, `ref`, jenis, tujuan tersamar, status, percobaan, `error_code`, waktu. **Tanpa isi pesan** |
| `POST /queue/:id/retry` | Pesan `gagal` (bukan `optout`/`route_denied`/`expired`) diantrekan ulang dengan percobaan baru |
| `POST /queue/:id/cancel` | Pesan `antre` → `dibatalkan` |
| `GET /queue/summary` | Jumlah per nomor dan status untuk 24 jam terakhir, webhook `habis`, ukuran tabel dan folder media |

Layar admin **tidak pernah** menampilkan isi pesan atau nomor utuh di R1. Membaca isi percakapan adalah fitur inbox R2 dan memerlukan penugasan petugas (KIRIM-001 §8).

## 7. Identitas dan akses

### 7.1 Keycloak (realm `sq-staff`)

| Client | Jenis | Untuk |
| --- | --- | --- |
| `sq-hub-kirim` | Bearer-only / tanpa flow | Hanya nama audience; tidak bisa meminta token |
| `kirim-sq` | Confidential, standard flow, PKCE S256 | Login admin di `https://kirim.sabilulquran.or.id/api/auth/callback` (D-1) |
| `spmb-api`, client HCIS, client Keluarga SQ, client Karir | Client credentials (milik masing-masing aplikasi) | Mendapat **audience mapper** `sq-hub-kirim` hanya bila didaftarkan sebagai pemakai |

Skrip `infra/keycloak/scripts/reconcile-kirim-clients.sh` idempoten, mengikuti pola `reconcile-organization-directory-clients.sh`, dan diuji dengan menjalankannya dua kali. Token client yang tidak punya audience `sq-hub-kirim` ditolak `401`; token yang punya audience tetapi `client_id` tidak terdaftar ditolak `403`.

### 7.2 Application Access

- Registry: `application_key = kirim-sq`, nama "Kirim SQ", `canonical_url = https://kirim.sabilulquran.or.id`, status `active` setelah layar siap di production.
- Tile Launcher tampil hanya bagi yang punya Application Access aktif (perilaku HUB-IMPL-016 yang sudah ada).
- Masuk ke layar admin butuh **dua** syarat: Application Access `kirim-sq` aktif **dan** baris `kirim_admins` aktif. Punya akses tanpa peran → layar "Anda belum ditetapkan sebagai pengelola Kirim SQ" (403).
- `kirim_admin` pertama (Kepala HCM) dibuat lewat CLI `npm run kirim:admin -- grant --issuer … --sub … --reason …` dan tercatat di `kirim_audit`. Delegasi ke admin SQ Core di R1 juga lewat CLI oleh operator atas permintaan Kepala HCM (D-2).

## 8. Layar

Shell SQ Core dengan lockup "Kirim SQ", SQ Design System yang sama dengan Hub, tema terang dan gelap, lebar 390 px tanpa gulir horizontal.

**Nomor**

- Kartu per nomor: label, kode, pemilik, provider (`log` diberi lencana "Uji — tidak mengirim"), status berwarna (`tersambung`, `menunggu_pairing`, `terputus`, `nonaktif`, `belum_dipasang`), nomor tersamar, antrean antre/gagal, waktu status berubah.
- Tambah nomor; ubah label, pemilik, jam kirim, dan laju.
- **Pasang:** pilih QR atau kode pairing. QR tampil besar dengan hitung mundur dan petunjuk "WhatsApp → Perangkat tertaut → Tautkan perangkat". Status diperbarui otomatis; setelah tersambung tampil "Tersambung" dan nomor tersamar.
- Putuskan, jeda/lanjutkan antrean, nonaktifkan, ganti provider: dialog konfirmasi dengan alasan.
- Peringatan di atas halaman bila ada nomor `terputus` atau webhook `habis`.

**Antrean**

- Ringkasan per nomor (antre, diserahkan, terkirim, dibaca, gagal dalam 24 jam).
- Tabel dengan saring nomor dan status: pemakai, `ref`, jenis, tujuan tersamar, status, percobaan, kode galat dalam bahasa Indonesia ("Nomor minta tidak dihubungi", "Di luar kuota harian", …), waktu.
- Aksi: coba ulang (pesan gagal), batalkan (pesan antre).

Setiap layar memeriksa state loading, kosong, galat, dan terlarang (403).

## 9. Kegagalan dan pemulihan

| Kegagalan | Perilaku |
| --- | --- |
| SQ Hub API mati atau sedang rilis | Pemakai mendapat galat jaringan dan mengulang dengan kunci yang sama (§6.2). Antrean di database tetap; worker melanjutkan setelah start |
| JalurPesan mati / timeout | `retryable`: backoff 1/5/30 menit lalu `gagal`. Penarik event mencoba lagi tiap 60 detik |
| Nomor terputus (logout, sesi rusak, HP lama mati) | Status `terputus`, antrean nomor itu berhenti, `device.status` ke pemakai, peringatan di layar Nomor. Pesan tidak dialihkan ke nomor lain. `kode` yang kedaluwarsa menjadi `gagal/expired` |
| JalurPesan minta reset sesi (409) | Sama seperti terputus; admin memutus lalu memasang ulang |
| Kapasitas perangkat JalurPesan penuh (409 safety cap) | Provision gagal dengan pesan jelas; tidak ada perubahan di Kirim SQ |
| Webhook JalurPesan tidak sampai | Penarik event menutup celah dari cursor terakhir |
| Webhook JalurPesan palsu atau diubah | `401`, tidak diproses, dicatat (tanpa body) |
| Pemakai webhook mati | Retry sampai 8 kali dalam beberapa jam; status `habis` tampil sebagai peringatan; pemakai juga bisa menarik `GET /internal/kirim/messages/:id` |
| Kunci `KIRIM_DATA_KEYS` hilang atau salah | Saat start pertama dengan `KIRIM_ENABLED=true`, modul menyimpan satu nilai uji terenkripsi (canary) per `kid`. Start berikutnya ditolak bila kunci tidak bisa membukanya. Tidak ada fallback ke teks polos |
| Disk Mi8 < 10 GiB bebas | Peringatan di layar dan laporan harian; media masuk tetap disimpan sampai < 5 GiB, lalu hanya metadata (D-7). Tidak ada penghapusan otomatis |
| Waktu sistem bergeser | Jam kirim dihitung dari waktu database (`now()`), bukan jam proses Node |
| Proses restart di tengah kiriman | Lease 60 detik habis, baris diambil lagi; kunci idempotensi `kirim:<outbox_id>` ke JalurPesan mencegah kiriman ganda |

## 10. Keamanan dan privasi

- `/internal/kirim/*` hanya didengar di loopback dan **diblokir di edge** (`404`) untuk host `kirim.` dan `hub.`. Uji edge wajib (§12).
- Log Fastify tidak mencatat body, query, atau header `Authorization` untuk rute `/internal/kirim/*` dan `/api/admin/kirim/*` (serializer seperti `DIRECTORY_PREFIX`). Tidak ada isi pesan, nomor utuh, QR, kode pairing, token, atau rahasia di log, audit, atau metrik.
- `ref` dari pemakai diperlakukan sebagai teks buram dan dibatasi 200 karakter; kontrak meminta tanpa data pribadi.
- Rahasia (kunci data, kunci lookup, kunci platform JalurPesan, rahasia langganan webhook JalurPesan, rahasia webhook per pemakai) hanya di env production, tidak pernah di repository atau database.
- Admin tidak membaca isi chat di R1 (§6.4). Akses baca isi di R2 harus lewat penugasan petugas dan tercatat.
- Isi pesan otomatis sebaiknya berupa tautan, bukan data sensitif utuh (KIRIM-001 §6); ini kewajiban modul pemakai dan dicek di review spesifikasi masing-masing.

## 11. Konfigurasi (env SQ Hub API)

| Variabel | Isi |
| --- | --- |
| `KIRIM_ENABLED` | `true`/`false` (bawaan `false`). `false` = rute kirim tidak didaftarkan dan worker tidak jalan |
| `KIRIM_TOKEN_AUDIENCE` | `sq-hub-kirim` |
| `KIRIM_DATA_KEYS`, `KIRIM_LOOKUP_KEY` | §4.1 |
| `KIRIM_MEDIA_ROOT`, `KIRIM_INBOUND_MEDIA_MAX_BYTES` | §5.4 |
| `KIRIM_WORKER_INTERVAL_MS`, `KIRIM_EVENT_PULL_INTERVAL_MS` | Bawaan 2000 dan 60000 |
| `JALURPESAN_BASE_URL` | `http://127.0.0.1:3401` |
| `JALURPESAN_PLATFORM_KEY` | Kunci Bearer platform `sq-core` |
| `JALURPESAN_WEBHOOK_SECRET` | Rahasia langganan webhook platform `sq-core` |
| `KIRIM_CONSUMER_SECRET_<NAMA>` | Rahasia webhook per pemakai (dirujuk `webhook_secret_ref`) |
| `KIRIM_OIDC_CLIENT_ID`, `KIRIM_OIDC_CLIENT_SECRET`, `KIRIM_PUBLIC_ORIGIN` | Login admin di host `kirim.` |

`infra/production.env.example` diperbarui dengan nama variabel tanpa nilai.

## 12. Uji

**Otomatis (wajib lulus di CI):**

- **Unit:**
  - normalisasi nomor (`08…`, `628…`, `+62…`, spasi/tanda hubung, terlalu pendek/panjang, bukan digit);
  - penyamaran nomor;
  - seal/open: round-trip, AAD baris lain ditolak, tag diubah ditolak, kunci lama tetap terbaca setelah rotasi, kunci tak dikenal ditolak;
  - HMAC lookup stabil dan berbeda per kunci;
  - jam kirim WIB: tepat 06.00, 20.59, 21.00, tengah malam, kedaluwarsa sebelum pagi;
  - batas laju bergulir dan jeda acak dalam 2–6 detik (sumber acak disuntik);
  - jadwal retry 1/5/30 menit lalu `gagal`;
  - status hanya maju (event tidak berurutan dan ganda);
  - tanda tangan webhook keluar dan verifikasi webhook JalurPesan: sah, salah, timestamp lama, body diubah.
- **API (dengan PostgreSQL uji):**
  - `POST /messages`: token tanpa audience → 401; client tak terdaftar → 403; tanpa `Idempotency-Key` → 400; kunci sama body sama → satu pesan, jawaban sama; kunci sama body beda → 409; setiap kode `422` (`optout`, `route_denied`, `quota_exceeded`, `device_inactive`, `invalid_number`, `media_invalid`);
  - `jenis: kode` mengabaikan opt-out dan jam kirim, kedaluwarsa maks. 10 menit, `body_disamarkan`;
  - `GET /messages/:id` pemakai lain → 404; jawaban tanpa isi dan tanpa nomor utuh;
  - `POST /media`: bukan PDF, > 5 MiB, magic bytes palsu ditolak;
  - admin: tanpa Application Access → 403; akses tanpa `kirim_admins` → 403; tanpa alasan → 400; cross-origin → 403; setiap aksi menulis satu `kirim_audit`;
  - `GET /queue` tidak pernah memuat isi pesan.
- **Worker dan provider:**
  - adapter `log` tidak membuat panggilan jaringan dan menandai `dry_run`;
  - adapter `jalurpesan` terhadap stub HTTP kontrak JalurPesan: pemetaan 200/400/404/409/5xx/timeout; `Idempotency-Key` ke mesin = `kirim:<outbox_id>` dan sama di setiap retry;
  - restart di tengah lease tidak mengirim ganda (stub menghitung kiriman per kunci);
  - nomor terputus menjeda antrean nomor itu saja; nomor lain tetap jalan;
  - dokumen diunggah sekali per nomor, lalu `mediaId` dipakai ulang.
- **Ingest:** event `message.received` teks dan media, grup diabaikan, event ganda lewat webhook dan penarik hanya disimpan sekali, cursor maju, tenant tak dikenal dibuang.
- **Webhook keluar:** retry dan `habis`, `event_id` sama di setiap percobaan, URL di luar daftar yang diizinkan ditolak saat pendaftaran.
- **Migration:** berjalan di database kosong dan di salinan skema production terakhir; berjalan dua kali tanpa perubahan.
- **Privasi log:** uji yang menangkap output logger saat kirim dan terima memastikan tidak ada nomor utuh, isi, QR, kode pairing, atau token.
- **Web:** layar Nomor dan Antrean untuk state loading, kosong, galat, 403, dan 390 px; QR tidak tersimpan di state URL atau storage.

**Manual sebelum rilis:**

- Edge: `https://kirim.sabilulquran.or.id/internal/kirim/messages` dan `https://hub.sabilulquran.or.id/internal/kirim/messages` → 404 dari luar.
- Pairing nomor uji di JalurPesan lewat layar Nomor (QR dan kode pairing), lalu putus dan pasang ulang.
- Kiriman ujung-ke-ujung dari SPMB (adapter `kirim`) ke HP uji: `antre` → `diserahkan` → `terkirim` → `dibaca` tampil di SPMB lewat webhook.
- Balasan dari HP uji masuk sebagai `message.received` di SPMB, dan tersimpan terenkripsi (dicek langsung di database: kolom `*_enc` tidak berisi teks polos).
- Jam kirim: pesan `notifikasi` yang dibuat pukul 21.30 WIB terkirim setelah 06.00.

## 13. Gate Mi8

| Gate | Ukuran | Batas |
| --- | --- | --- |
| Memori SQ Hub API | RSS sebelum dan sesudah `KIRIM_ENABLED=true`, 24 jam dengan worker berjalan | Kenaikan < 20 MiB (baseline produksi ~31 MiB) |
| Memori JalurPesan | RSS sebelum pairing, setelah setiap nomor, dan harian 7 hari | Tercatat per nomor (perkiraan 30–80 MiB, belum diukur) |
| MemAvailable Mi8 | Rata-rata harian 7 hari | **Berhenti menambah nomor** bila rata-rata 7 hari < 900 MiB atau RSS JalurPesan terus naik; rencanakan pindah mesin (KIRIM-001 §12) |
| Disk Mi8 | Ruang bebas, ukuran `kirim_messages`, ukuran `KIRIM_MEDIA_ROOT`, masuk laporan harian | < 10 GiB bebas → media lama dipindah ke arsip off-host sesuai rencana backup; tidak dihapus tanpa PO |
| Database | Ukuran tabel `kirim_*` per minggu | Dicatat; tidak ada batas di R1 |
| CPU/IO | Durasi putaran worker | p95 < 200 ms di Mi8 |

Pengukuran dicatat di `docs/operations/KIRIM-IMPL-001-mi8-gates.md` (dibuat saat rilis).

## 14. Kriteria penerimaan R1

1. Semua uji otomatis lulus; typecheck, lint, dan build lulus.
2. Pemakai terdaftar mengirim dengan token `sq-hub-kirim`; token tanpa audience atau client tak terdaftar ditolak.
3. Kunci idempotensi yang sama tidak pernah menghasilkan dua pesan, termasuk saat restart dan timeout mesin.
4. Batas laju, jam kirim 06.00–21.00 WIB untuk `notifikasi`, dan pengecualian `kode` terbukti di uji.
5. Retry 1/5/30 menit lalu `gagal`, dengan `message.status` ke pengirim di setiap perubahan.
6. Semua pesan keluar dan masuk tersimpan di `kirim_messages` dengan isi dan nomor terenkripsi; dump database tanpa kunci tidak memperlihatkan isi.
7. `message.received` sampai ke pemilik nomor dengan `event_id` dan `message_id`; event ganda tidak membuat pesan ganda.
8. Nomor terputus menjeda antreannya saja, mengirim `device.status`, dan tampil di layar Nomor.
9. Layar Nomor dan Antrean hanya bisa dibuka `kirim_admin` dengan Application Access `kirim-sq`; tidak ada isi pesan atau nomor utuh di layar admin, log, atau audit.
10. `/internal/kirim/*` tidak bisa dicapai dari luar Mi8.
11. Gate Mi8 §13 tercatat untuk 7 hari pertama setelah nomor pertama dipasang.
12. Dump yang berisi `kirim_*` dipulihkan di lingkungan terpisah dan satu pesan berhasil dibuka dengan kunci dari cadangan kunci.
13. Ujung-ke-ujung: SPMB mengirim tautan daftar lewat nomor `spmb` dan menerima statusnya; HCIS mengirim satu notifikasi uji lewat nomor `hcis`.

## 15. Langkah production (masing-masing butuh persetujuan owner)

Urutan; setiap langkah dicatat di ledger operasi dengan bukti dan rollback-nya.

| # | Langkah | Siapa | Rollback |
| --- | --- | --- | --- |
| 1 | **JalurPesan: platform `sq-core`.** JalurPesan saat ini hanya membuat platform `sipaya` (`PlatformRepository.ensureSipaya`); belum ada rute untuk membuat platform. Perlu perubahan kecil di repo JalurPesan dengan spesifikasinya sendiri (D-10) | Pemilik JalurPesan | Platform dinonaktifkan; tidak memengaruhi SIPAYA |
| 2 | Kunci platform `sq-core` (`POST /api/v1/platforms/sq-core/api-keys`) disimpan di env SQ Hub | Admin JalurPesan | Hapus/rotasi kunci |
| 3 | Periksa `MAX_ACTIVE_DEVICES` JalurPesan dan jumlah perangkat SIPAYA aktif; naikkan batas hanya bila gate memori memungkinkan | Pemilik JalurPesan + owner | Kembalikan nilai |
| 4 | Keycloak: `reconcile-kirim-clients.sh` (client `sq-hub-kirim`, `kirim-sq`, audience mapper untuk pemakai pertama), dijalankan dua kali | Operator SQ Core | Nonaktifkan client/mapper |
| 5 | Rilis SQ Hub dengan modul kirim, `KIRIM_ENABLED=false`; backup lalu migrate (§4.2) | Operator | Release sebelumnya |
| 6 | Isi env kunci (§11), cadangkan kunci off-host terpisah, lalu `KIRIM_ENABLED=true`; ukur gate memori SQ Hub | Operator + pemegang kunci | `KIRIM_ENABLED=false` |
| 7 | Langganan webhook JalurPesan untuk platform `sq-core` ke `http://127.0.0.1:3302/internal/kirim/engine/jalurpesan/webhook` (pastikan JalurPesan menerima URL loopback http; bila tidak, cukup penarik event) | Admin JalurPesan | Nonaktifkan langganan |
| 8 | Registry Application Access `kirim-sq`, beri akses Kepala HCM, `kirim:admin grant` Kepala HCM | Platform Administrator | Status `inactive`, cabut akses |
| 9 | **Edge route** `kirim.sabilulquran.or.id` → 3202/3302 dengan `/internal/*` diblokir; uji route | Operator | Hapus route |
| 10 | **DNS** `kirim.sabilulquran.or.id` (CNAME ke tunnel) oleh **pemilik akun Cloudflare Yayasan** — zona `sabilulquran.or.id` ada di akun Cloudflare Yayasan, bukan akun operator | Pemilik Cloudflare Yayasan | Hapus record |
| 11 | Daftarkan pemakai `spmb` dan `hcis` (CLI): `client_id`, `webhook_url`, rahasia, kuota; rute Keluarga SQ `kode` di `spmb` dan Karir `notifikasi` di `hcis` saat aplikasinya siap | Operator atas persetujuan Kepala HCM | `aktif = false` |
| 12 | Nomor `hcis` dan `spmb` dengan provider `log`; uji kirim dry-run dari SPMB dan HCIS | Kepala HCM | — |
| 13 | **Tenant `hcis`**: ukur memori, ganti provider ke `jalurpesan`, provision, **pairing** nomor baru HCIS; uji kirim ke HP uji | Kepala HCM + pemegang HP nomor | Putuskan, provider `log` |
| 14 | **Tenant `spmb`**: sama, untuk nomor resmi SPMB. Nomor ditautkan sebagai perangkat tertaut, jadi HP panitia tetap bisa membalas seperti biasa | Kepala HCM + Ketua Panitia SPMB | Putuskan, provider `log` |
| 15 | SPMB mengganti `WHATSAPP_ADAPTER=kirim`; pantau 7 hari gate §13 | Admin SPMB | `WHATSAPP_ADAPTER=log` |

## 16. Keputusan atas hal yang sebelumnya TBD

Product Owner menyetujui semua saran di bawah pada 2026-10-17. Nomor `D-n` dipakai sebagai rujukan di seluruh dokumen ini.

| # | Topik | Status | Keputusan |
| --- | --- | --- | --- |
| D-1 | Login layar admin di host `kirim.` | DIPUTUSKAN (PO, 2026-10-17) | Client `kirim-sq` sendiri dan cookie host-only `sq_kirim_session`, memakai ulang kode hub-auth. Alternatif `hub.sabilulquran.or.id/kirim` ditolak karena menyimpang dari keputusan alamat `kirim.` |
| D-2 | Tempat menyimpan peran `kirim_admin` dan cara delegasi | DIPUTUSKAN (PO, 2026-10-17) | Tabel `kirim_admins` milik modul; R1 lewat CLI. Layar delegasi oleh Kepala HCM menyusul di R2 bersama petugas per nomor |
| D-3 | Pemegang cadangan kunci enkripsi Kirim SQ | DIPUTUSKAN (PO, 2026-10-17) | Kepala HCM dan pemilik Mi8, disimpan off-host di tempat yang sama dengan cadangan secret Keycloak, terpisah dari dump database |
| D-4 | Pendaftaran pemakai, rute, dan rahasia webhook di R1 | DIPUTUSKAN (PO, 2026-10-17) | CLI `kirim:admin` oleh operator atas persetujuan Kepala HCM; layar menyusul. `webhook_url` hanya loopback `http://127.0.0.1:<port>` atau `https://*.sabilulquran.or.id`. Kuota awal 500 pesan/hari per pemakai |
| D-5 | `POST /internal/kirim/optouts` (usulan SPMB §17 butir 5) masuk R1? | DIPUTUSKAN (PO, 2026-10-17) | Ya, karena kecil dan pemeriksaan opt-out sudah ada di R1. Cakupan dari pemakai hanya `consumer`; `semua` hanya oleh admin |
| D-6 | Lawan bicara yang hanya punya alamat LID (tanpa nomor telepon) | DIPUTUSKAN (PO, 2026-10-17), **DIREVISI 2026-10-30** | Semula: simpan sebagai `lid:<jid>`, `from = null`, pemetaan LID → nomor menyusul di R2. Ternyata WhatsApp mengalamatkan hampir semua chat masuk dengan LID, sedangkan chat yang dimulai petugas memakai nomor, sehingga satu orang mendapat **dua percakapan** dan balasannya tampak hilang (dilaporkan owner 2026-10-30). Kini: percakapan dikunci pada nomor bila mesin menyertakannya di `peerJidAlt`; LID disimpan di `kontak_lid_hmac` supaya kejadian yang hanya membawa LID tetap menemukan percakapan yang sama. `lid:<jid>` dengan `from = null` hanya untuk kontak yang benar-benar tanpa nomor. Tidak perlu `GET .../contacts` |
| D-7 | Batas media masuk yang disalin ke Kirim SQ, dan perilaku saat disk rendah | DIPUTUSKAN (PO, 2026-10-17) | Salin sampai 16 MiB; di bawah 5 GiB bebas hanya metadata. Media tetap ada di JalurPesan sesuai retensinya |
| D-8 | Berkas media dienkripsi di disk? | DIPUTUSKAN (PO, 2026-10-17) | Ya, AES-256-GCM dengan kunci data yang sama, karena berkas bisa berisi slip, tagihan, atau dokumen anak |
| D-9 | Dependensi unggah multipart | DIPUTUSKAN (PO, 2026-10-17) | `@fastify/multipart` dengan batas ukuran ketat (alternatif body `application/pdf` mentah ditolak) |
| D-10 | Cara membuat platform `sq-core` di JalurPesan | DIPUTUSKAN (PO, 2026-10-17) | Perubahan kecil di JalurPesan: CLI `platform:create` (bukan rute HTTP publik), dengan spesifikasi di repo JalurPesan dan persetujuan owner |
| D-11 | Nomor untuk kode Keluarga SQ: SPMB-IMPL-001 §17 butir 7 menyebut device `resmi`, KIRIM-001 revisi 2 §7 menyebut `spmb` | DIPUTUSKAN (PO, 2026-10-17) | Ikut KIRIM-001 revisi 2 (`spmb` dengan rute `kode`); nama device tetap dibaca dari konfigurasi Keluarga SQ, dan ADR-0010/KEL-IMPL-001 disesuaikan lewat PR kecil |
| D-12 | SPMB-IMPL-001 §13 menyebut rute SPMB `percakapan`; KIRIM-001 hanya punya `notifikasi` dan `kode` | DIPUTUSKAN (PO, 2026-10-17) | Tidak perlu jenis rute baru: pemilik nomor otomatis menerima `message.received`; balasan dari inbox adalah R2. SPMB-IMPL-001 disesuaikan |
| D-13 | KIRIM-001 §13 no. 1 (urutan bangun Kirim SQ R1 vs SPMB R0) dan no. 2 (petugas inbox awal) | DIPUTUSKAN (PO, 2026-10-17) | No. 1: Kirim SQ R1 dulu, SPMB R0 jalan dengan `log`. No. 2: ditetapkan Kepala HCM saat R2 atas usulan kepala bidang; tidak memblokir R1 |

## 17. Dampak pada dokumen lain

- **KIRIM-001:** setelah spesifikasi ini ACCEPTED, catat tabel tambahan (`kirim_webhook_deliveries`, `kirim_admins`, `kirim_media_engine_refs`), format tanda tangan webhook, kode galat, dan `event_id`/`message_id` di §4–§5.
- **SPMB-IMPL-001 §17:** butir 1–4 dan 6 dipenuhi di sini; butir 5 dipenuhi oleh D-5; butir 7 diputuskan D-11 (nomor `spmb`), dan SPMB-IMPL-001 §13 disesuaikan menurut D-12.
- **ADR-0010 / KEL-IMPL-001:** kode Keluarga SQ dikirim lewat nomor `spmb` (D-11); disesuaikan lewat PR kecil di repo masing-masing.
- **JalurPesan:** butuh spesifikasi kecil untuk CLI `platform:create` (D-10) sebelum langkah production §15 no. 1.
- **Roadmap and decision register:** baris Kirim SQ diperbarui (selesai di PR ini).
- **`docs/specs/README.md`:** KIRIM-IMPL-001 ditambahkan (selesai di PR ini).

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-10-17 | DRAFT pertama untuk R1 dari KIRIM-001 revisi 2 dan ADR-0011 |
| 2026-10-17 | PO menyetujui semua saran TBD-1…TBD-13; menjadi keputusan D-1…D-13 (§16) |
| 2026-10-17 | ACCEPTED oleh Product Owner; implementasi R1 di repository diizinkan |
