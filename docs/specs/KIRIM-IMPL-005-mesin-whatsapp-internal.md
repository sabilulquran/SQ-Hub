# KIRIM-IMPL-005 — Mesin WhatsApp internal Kirim SQ (`kirim-wa`) dan pemensiunan JalurPesan

**Status:** DRAFT → **dibangun** di repository (branch `feat/kirim-engine-wa`, 2026-11-17). Dijalankan di bawah aturan owner 2026-10-26/27 ("jalan terus, keputusan teknis diambil agent dan dilaporkan"). Nilai bertanda `DRAFT` boleh diubah owner lewat konfigurasi, tanpa migrasi.
**Produk:** SQ Hub — aplikasi `kirim` (Kirim SQ) + proses baru `kirim-wa`
**Owner produk:** Kepala HCM (`kirim_admin`)
**Tanggal:** 2026-11-17
**Depends on:**
- [ADR-0011](../architecture/adr/0011-kirim-sq-shared-whatsapp-capability.md) beserta **amandemen 2026-11-17** di dokumen yang sama (mesin internal sebagai proses worker; mencabut "No Baileys inside SQ Core")
- [KIRIM-IMPL-001](KIRIM-IMPL-001-r1-nomor-dan-kirim.md) §3.2 (kontrak penyedia internal), [KIRIM-IMPL-002](KIRIM-IMPL-002-r2-api-percakapan.md) §5.3, §6, §10.3, [KIRIM-IMPL-003](KIRIM-IMPL-003-kartu-modul.md) §11, [KIRIM-IMPL-004](KIRIM-IMPL-004-k3-2-aksi-pesan-panggilan-grup.md) §3, §6, §9, §11, §17
- Kontrak mesin JalurPesan (platform API `/api/v1/platform/tenants/:tenant/*`), yang **tetap menjadi kontrak** mesin internal

**Pemakai pertama:** nomor `luar` ("Aplikasi luar 2", dipakai Samijaya). Urutan cutover di §9.

---

## 1. Tujuan

Kirim SQ hari ini adalah gerbang: kunci API, kartu, antrean, jam kirim, daftar jangan hubungi, status, audit, dokumentasi. Mesin WhatsApp sebenarnya adalah **JalurPesan**, proses terpisah di Mi8 (web 3400, API 3401) yang menjalankan Baileys. JalurPesan memakai ±388 MB RSS (API 335 MB + web 53 MB) pada host dengan MemAvailable ±1,0 GB, membawa SQLite 261 MB + WAL 84 MB, UI admin, updater, backup, dan dasbor yang tidak dipakai Yayasan.

Spesifikasi ini memindahkan **lapisan WhatsApp saja** ke dalam rilis SQ Hub, sebagai **proses worker terpisah** bernama `kirim-wa`, lalu memensiunkan JalurPesan.

Yang **tidak** berubah:

1. Kontrak pemanggil API (`/internal/kirim/*`, kunci `krm_…`, dokumentasi publik). Tidak ada perubahan bagi Samijaya, SPMB, HCIS, Karir, Keluarga.
2. Antarmuka penyedia `apps/api/src/modules/kirim/providers/types.ts`. Mesin internal adalah **penyedia ketiga**, bukan pembongkaran Kirim SQ.
3. Riwayat percakapan di PostgreSQL (`kirim_*`). Tidak ada data yang dipindahkan atau dihapus.

---

## 2. Keputusan: worker terpisah, bukan di dalam proses API

Baileys adalah pustaka jaringan dengan state kriptografis dan parser protokol pihak ketiga. Kegagalan di sana (OOM, `uncaughtException` di stream WebSocket, loop libsignal) tidak boleh menjatuhkan SQ Hub, yang juga melayani Akun SQ, Portal Organ, Kerja SQ, Sekretariat SQ, dan Admin SQ.

**Keputusan:**

- Mesin internal berjalan sebagai proses Node tersendiri, `kirim-wa`, di dalam rilis SQ Hub (`apps/kirim-wa`). Satu proses untuk **semua** nomor; satu sesi WhatsApp ≈ 1 soket Baileys di heap yang sama.
- Proses API Hub tidak pernah meng-`import` Baileys. Ketergantungan `@whiskeysockets/baileys` hanya ada di `apps/kirim-wa/package.json`.
- Hub berbicara ke worker lewat **loopback TCP `127.0.0.1:3310`** dengan `Authorization: Bearer <KIRIM_WA_PLATFORM_KEY>`, memakai **kontrak platform yang sama persis dengan JalurPesan**. Alasan memilih TCP loopback, bukan unix socket: adaptor `jalurpesan.ts` yang sudah terbukti memakai `fetch(url)` global; unix socket menuntut dispatcher undici khusus di setiap pemanggilan, termasuk unggah multipart dan unduh stream. Soket hanya mendengar di `127.0.0.1`, tidak pernah dirutekan di edge (§12). Portnya 3310, bukan 3307: di Mi8, MariaDB milik stack WordPress sudah memakai 3307, dan ia menjawab sambungan TCP tanpa bicara HTTP — sehingga probe kesehatan di sana terlihat seperti "tidak ada yang jalan", bukan "sudah dipakai". Port bebas dipastikan dari daftar soket yang mendengar (`/proc/net/tcp`), bukan dari probe HTTP.
- Worker mati → Hub melihat `engine_unavailable`, antrean menahan pesan dan mencoba lagi; tidak ada pesan hilang. Watchdog konsol `server.samijaya.online` menyalakan ulang worker dalam ±2 menit, sama seperti layanan lain (§14).

**Batas memori.** Worker dijalankan dengan `--max-old-space-size=320` (`DRAFT`). Empat nomor pada JalurPesan hari ini memakai 335 MB termasuk SQLite, UI, dan updater yang tidak ikut pindah. Bila RSS worker melewati 400 MB dengan empat nomor tersambung, cutover dihentikan dan dilaporkan (§10).

---

## 3. Yang dipindahkan dari JalurPesan

Berkas berikut dipindahkan ke `apps/kirim-wa/src/` dengan perubahan sekecil mungkin (nama impor, logger, tanpa SQLite):

| Asal (JalurPesan `server/src/`) | Baris | Tujuan |
| --- | --- | --- |
| `whatsapp/service.ts` | 2496 | `wa/service.ts` — soket Baileys satu nomor: QR, kode pairing, reconnect, logout, kirim teks/media, terima, read receipt, aksi pesan, grup, bisnis, katalog, balasan cepat, label, riwayat |
| `whatsapp/device-manager.ts` | 930 | `wa/device-manager.ts` — pemilik semua soket, batas jumlah nomor aktif, pemulihan saat start |
| `whatsapp/message-changes.ts` | 461 | `wa/message-changes.ts` — normalisasi edit/hapus/reaksi dan agregator log panggilan |
| `whatsapp/native-read-service-factory.ts` | 231 | `wa/native-read-service-factory.ts` — read receipt dari HP sendiri dan pesan terkirim dari perangkat tertaut |
| `whatsapp/libsignal-console-redaction.ts` | 45 | `wa/libsignal-console-redaction.ts` — redaksi log libsignal (nomor tidak pernah masuk log) |
| `services/message-sender.ts` | 688 | `store/sender.ts` — idempotensi kirim, pending/stored result, galat idempotency |
| `services/media-service.ts` | 216 | `store/media.ts` |
| `services/history-import.ts` | 197 | `store/history.ts` |
| `services/send-safety.ts` | 104 | `wa/send-safety.ts` (tanpa perubahan) |
| `services/conversation-read-receipts.ts` | 100 | diserap ke `routes/read-receipts.ts` |
| `services/linked-device-sent.ts` | 66 | `store/linked-device-sent.ts` |
| `media/types.ts`, `conversations/identity.ts` | 61 + 147 | `wa/media-types.ts`, `wa/identity.ts` |

**Pustaka.** `@whiskeysockets/baileys` dipin **persis `7.0.0-rc14`** (tanpa `^`). Versi ini adalah `latest` di npm sejak 29 Juli 2026; 7.0.0 final belum ada. Pengelola berencana melepas libsignal karena lisensi GPLv3, sehingga rilis berikutnya dapat mengubah API dan lisensi. Kenaikan versi adalah keputusan tersendiri dengan uji ulang pairing.

**Yang tidak dipindahkan:** UI web JalurPesan, dasbor admin, updater, backup internal, kunci API per-device JalurPesan, multi-platform/tenant (worker hanya melayani satu platform: SQ Hub), dan SQLite 261 MB. Riwayat percakapan Yayasan sudah ada di PostgreSQL Hub.

---

## 4. Penyimpanan state

### 4.1 Auth state Baileys (di disk)

- Akar: `KIRIM_WA_AUTH_ROOT`, production `/srv/sq-hub/shared/kirim-wa/auth`, mode `0700`, pemilik `sqhub`.
- Satu folder per nomor, **dinamai kode nomor Kirim** (`kirim_devices.kode`, pola `^[a-z][a-z0-9-]{1,30}$`): `…/auth/<kode>/`. Isinya format `useMultiFileAuthState` bawaan Baileys (`creds.json`, `pre-key-*.json`, `session-*.json`, `app-state-sync-key-*.json`, …).
- Dinamai kode, bukan hash id internal seperti JalurPesan, supaya runbook non-engineer bisa dibaca dan dijalankan (§13 runbook, §9 cutover).
- Auth state **tidak pernah** masuk PostgreSQL, tidak pernah masuk log, dan tidak ikut `pg_dump`. Salinannya ikut set backup off-host Mi8 (`mi8_crypt`) sebagai bagian dari `/srv/sq-hub/shared`.

### 4.2 State operasional (PostgreSQL, database Hub)

Dipilih PostgreSQL yang sudah ada, bukan SQLite baru: satu jalur backup (`hub-release.sh` sudah men-dump sebelum migrasi), satu mesin penyimpanan untuk owner, dan tanpa dependensi native (`better-sqlite3` butuh kompilasi di chroot arm64). Biaya: dua koneksi backend tambahan (pool `max: 2`).

Tabel baru, prefiks `kirim_wa_` (migration `0025_kirim_engine_wa.sql`, §7). Worker **hanya** menyentuh tabel `kirim_wa_*`; ia tidak pernah membaca atau menulis `kirim_*` milik Hub. Batas ini dijaga oleh peran database tersendiri bila owner memisahkannya nanti; untuk sekarang dijaga oleh kode dan uji.

### 4.3 Media (di disk)

`KIRIM_WA_MEDIA_ROOT`, production `/srv/sq-hub/shared/kirim-wa/media`, `0700`. Berisi berkas media keluar yang diunggah Hub (sampai terkirim) dan media masuk yang diunduh dari WhatsApp (sampai Hub menyalinnya lewat `GET /media/:id`). Media masuk yang sudah disalin Hub dibersihkan setelah `KIRIM_WA_MEDIA_TTL_HOURS` (bawaan 72, `DRAFT`); Hub menyimpan salinannya sendiri di `/srv/sq-hub/kirim-media`.

### 4.4 Pemulihan setelah restart

Saat start, worker:

1. Membaca `kirim_wa_devices`. Nomor dengan `parked = true` dilewati (§9: nomor yang sengaja tidak boleh tersambung).
2. Untuk tiap nomor lain yang punya `creds.json` di folder auth-nya, membuka soket Baileys (`restoreIfAuthenticated` dari `device-manager.ts`). Tidak ada pemindaian QR ulang.
3. Melanjutkan `kirim_wa_events.cursor` dari nilai terakhir di database — cursor tidak pernah mundur, sehingga Hub tidak pernah melewatkan atau mengulang event.
4. Mengirim ulang pesan keluar yang masih `pending` di `kirim_wa_idempotency` **tidak** dilakukan: pesan yang statusnya belum pasti dilaporkan ke Hub sebagai `engine_unavailable` (dapat dicoba lagi dengan `Idempotency-Key` yang sama), dan idempotensi di worker mencegah kiriman ganda.

Urutan koneksi dibuat berurutan dengan jeda 3 detik antar-nomor (`DRAFT`), supaya empat soket tidak membuka serentak pada host 3,8 GB.

---

## 5. Kontrak worker ↔ Hub

Worker mengimplementasikan **himpunan bagian kontrak platform JalurPesan yang dipakai `providers/jalurpesan.ts`**, pada `http://127.0.0.1:3310/api/v1/platform/tenants/:kode/…`, autentikasi `Authorization: Bearer <KIRIM_WA_PLATFORM_KEY>`.

Karena bentuk permintaan, bentuk jawaban, dan kode status identik, penyedia baru di Hub adalah **turunan tipis** dari `JalurPesanProvider` (§6). Daftar lengkap rute yang wajib ada:

| Kelompok | Rute |
| --- | --- |
| Nomor | `PUT /device`, `GET /device`, `POST /device/connect`, `POST /device/pairing-code`, `POST /device/logout`, `POST /device/reset` |
| Kirim | `POST /messages` (teks atau `mediaId`, header `Idempotency-Key`), `POST /media?type=…` (multipart), `GET /media/:id` |
| Aksi | `POST /messages/:waId/{reaction,edit,delete}` |
| Baca | `POST /messages/read` |
| Event | `GET /events?after=&limit=` |
| Grup | `GET /groups`, `POST /groups`, `GET|POST /groups/:jid/...` (participants, subject, description, invite, invite/revoke, settings, requests, picture, leave, messages) |
| Kontak | `GET /contacts?page=&pageSize=`, `GET /profile-picture?jid=` |
| Riwayat | `POST /history-imports`, `GET /history-imports/:id`, `GET /history-imports/:id/messages`, `GET /history-chats` |
| Bisnis | `GET|PUT /business-profile`, `PUT /business-hours`, `GET /catalog`, produk, `GET|PUT|DELETE /quick-replies…`, `PUT /chat-labels` |
| Kesehatan | `GET /health` (tanpa autentikasi, hanya loopback) |

Semantik yang wajib dipertahankan karena Hub bergantung padanya:

- `POST /messages` menjawab `200 {messageId}` dengan **id pesan WhatsApp**, `409 {code:"idempotency_key_conflict"}` bila kunci yang sama dipakai untuk isi berbeda, `409` lain = nomor terputus, `404 {error:"Media not found"}` bila `mediaId` tak dikenal, `404` lain = nomor tidak ada, `429` = pengaman kirim (sementara), `400 {error:"Invalid recipient…"}` = nomor tujuan tidak sah.
- `GET /events` memberi `{events:[{eventId,cursor,type,deviceId,messageId,occurredAt,payload}],nextCursor,hasMore}` dengan `cursor` **naik monoton per worker** dan event terurut naik. Bentuk `payload` mengikuti KIRIM-IMPL-002 §6.1 dan KIRIM-IMPL-004 §6.2 (`{version, message|change|reaction|call}`), persis seperti yang dibaca `ingest.ts`.
- `GET /device` memberi `{device:{id,whatsappPhone,pairedAt,lastConnectedAt},liveState:{status,qr,jid,connectedAt}}`; `status` salah satu `disconnected|connecting|qr|connected`.
- `409 {recoveryAction:"reset"}` berarti sesi harus disambungkan ulang (pemetaan Hub: `session_reset_required`).

**Webhook dorong.** Worker juga memanggil `POST {KIRIM_WA_WEBHOOK_URL}` (Hub `/internal/kirim/engine/jalurpesan/webhook`) dengan tanda tangan `x-jalurpesan-signature` seperti sekarang, hanya untuk mempercepat tarikan; kebenaran tetap pada cursor. Rute Hub tidak diubah supaya satu rahasia dan satu jalur tetap berlaku untuk kedua mesin. (Nama rute dibiarkan historis; §13 runbook menyebutnya "jalur dorong mesin".)

---

## 6. Penyedia ketiga di Hub

```ts
export type ProviderName = "log" | "jalurpesan" | "wa";
```

- `apps/api/src/modules/kirim/providers/wa.ts`: `class WaEngineProvider extends JalurPesanProvider` dengan `readonly name = "wa"`, dikonfigurasi `KIRIM_WA_BASE_URL` + `KIRIM_WA_PLATFORM_KEY`. Tidak ada logika baru; satu-satunya perbedaan adalah nama dan tujuan.
- `providers/types.ts` tidak berubah selain `ProviderName`.
- `kirim_devices.provider` menerima `'wa'` (migration §7). **Sakelar penyedia tetap per nomor**, seperti yang sudah ada sejak KIRIM-IMPL-001.
- `module.ts`: `ingest`, `photos`, dan pemilihan penyedia tidak lagi menunjuk `providers.jalurpesan` secara khusus, melainkan menerima peta penyedia dan memilih **per nomor** dari `kirim_devices.provider` (§8.1).

---

## 7. Data

Migration `0025_kirim_engine_wa.sql`, aditif, tanpa pemindahan data:

1. `kirim_devices.provider`: `CHECK (provider IN ('log','jalurpesan','wa'))`.
2. `kirim_messages.provider`, `kirim_media_engine_refs.provider`, `kirim_events.provider`: idem (`kirim_media_engine_refs` dan `kirim_events` semula hanya `'jalurpesan'`).
3. **Indeks unik pesan menjadi lintas-mesin.** `kirim_messages_provider_message_idx` `(provider, device_id, provider_message_id)` diganti `kirim_messages_wa_message_idx` `(device_id, provider_message_id) WHERE provider <> 'log' AND provider_message_id IS NOT NULL`. Alasan di §8.2.
4. Tabel worker:

| Tabel | Isi |
| --- | --- |
| `kirim_wa_devices` | `kode` (PK), `wa_jid`, `wa_phone`, `wa_display_name`, `paired_at`, `last_connected_at`, `last_disconnect_*`, `requires_reset`, `parked`, `label` |
| `kirim_wa_events` | `id` (uuid), `cursor` (bigserial), `kode`, `type`, `message_id`, `occurred_at`, `payload_enc` |
| `kirim_wa_idempotency` | `kode` + `key` (PK), `fingerprint`, `state` (`pending`/`done`/`failed`), `result_enc`, `created_at` |
| `kirim_wa_media` | `id` (uuid), `kode`, `source`, `media_type`, `mime`, `size_bytes`, `sha256`, `path`, `created_at`, `expired_at` |
| `kirim_wa_messages` | indeks pesan untuk jangkar riwayat dan read receipt: `kode`, `wa_message_id`, `chat_jid`, `from_me`, `participant`, `occurred_at`, `message_type`, `body_enc`, `media_id` |
| `kirim_wa_history_imports` | `id`, `kode`, `chat_jid`, `source`, `state`, `requested_at`, `completed_at`, `reason` |

`payload_enc`, `result_enc`, dan `body_enc` disegel AES-256-GCM dengan `KIRIM_WA_DATA_KEYS` memakai `KirimCrypto` yang sudah ada (`apps/api/src/modules/kirim/crypto.ts`, diekspor lewat paket bersama). **Kunci worker berbeda dari kunci Hub**: worker tidak boleh bisa membaca `kirim_messages`, dan bocornya kunci worker tidak membuka riwayat Yayasan.

`kirim_wa_messages` dipangkas berkala: baris lebih tua dari `KIRIM_WA_MESSAGE_RETENTION_DAYS` (bawaan 400, `DRAFT`) dan tidak menjadi jangkar riwayat dihapus. Riwayat panjang tetap ada di `kirim_messages` milik Hub.

---

## 8. Konsistensi data saat nomor berpindah mesin

Ini bagian paling berisiko. Kasus yang pernah terjadi dan tidak boleh terulang: device duplikat `spmb-2` yang membuat kotak masuk SPMB tuli.

### 8.1 Satu baris nomor, selamanya

Pindah mesin adalah **`UPDATE kirim_devices SET provider = 'wa'` pada baris yang sama**. Tidak ada `INSERT`. Rute admin `POST /api/admin/kirim/devices/:kode/mesin` hanya boleh mengubah kolom `provider` (dan `provider_ref`, yang tetap sama dengan `kode`), tidak pernah membuat nomor baru, dan menolak bila:

- nomor sedang `nonaktif`;
- masih ada baris `kirim_outbox` berstatus `antri` atau `dikirim` untuk nomor itu (antrean harus kosong, §8.3);
- ada nomor lain yang `nomor_hmac`-nya sama dan tidak `nonaktif` (penjaga duplikat `spmb-2`).

Setiap perpindahan dicatat di `kirim_kartu_riwayat` dengan `jenis = 'mesin_diubah'` dan audit `kirim_audit`, berisi kode nomor, mesin lama, mesin baru, dan pelaku.

### 8.2 Id pesan WhatsApp adalah satu ruang nama

`provider_message_id` berisi **id pesan WhatsApp**, yang sama apa pun mesinnya. Indeks unik lama memasukkan `provider` ke dalam kunci, sehingga pesan yang sama bisa masuk dua kali bila nomor berpindah mesin di tengah percakapan (persis pola `spmb-2`). Indeks baru (§7 butir 3) mengabaikan `provider`, dan semua pencarian receipt/aksi di `ingest.ts`, `actions.ts`, dan `message-state.ts` mencocokkan `provider <> 'log'`, bukan `provider = 'jalurpesan'`.

### 8.3 Cursor event dan idempotensi

- Cursor sudah tersimpan per `(device_id, provider, provider_ref)` di `kirim_events` (lihat `ingest.ts` `pullPages`). Nomor yang pindah ke `wa` otomatis mulai dari cursor 0 di ruang mesin baru, sementara baris lama dengan `provider = 'jalurpesan'` tetap ada sebagai riwayat. Tidak ada event lama yang ditarik ulang karena mesin baru tidak punya event lama; tidak ada event baru yang terlewat karena cursor mesin baru selalu dari 0.
- Idempotensi kirim ada di sisi mesin. Pesan yang sedang terbang saat sakelar dipindah bisa berakhir tanpa catatan di mesin baru, sehingga percobaan ulang akan mengirim dua kali. Karena itu §8.1 menuntut antrean nomor itu kosong lebih dulu; rute sakelar menjeda antrean nomor (`antrean_dijeda = true`), menunggu sampai kosong, menukar mesin, lalu melepas jeda.
- Status pesan lama (`terkirim`, `dibaca`) tidak berubah. Receipt yang masih datang dari JalurPesan untuk pesan lama tidak akan tertarik lagi (nomor sudah tidak di-poll pada mesin itu); pesan yang sudah `terkirim` tetap `terkirim`.

### 8.4 Riwayat dan media

Media masuk yang sudah disalin Hub tetap di `/srv/sq-hub/kirim-media`. `kirim_media_engine_refs` berkunci `(media_id, device_id, provider)`, sehingga referensi media mesin lama dan mesin baru tidak bertabrakan: media keluar yang pernah diunggah ke JalurPesan akan diunggah sekali lagi ke mesin baru saat dipakai lagi.

---

## 9. Cutover per nomor

**Aturan:** satu nomor per langkah, tidak pernah dua. Setiap langkah berdiri sendiri dan punya jalur mundur.

Urutan (risiko terendah lebih dulu):

| # | Nomor | Kode | Pemakai | Alasan urutan |
| --- | --- | --- | --- | --- |
| 1 | Aplikasi luar 2 | `luar` | Samijaya (kunci API) | Satu pemakai, pesan OTP/notifikasi, tanpa kotak masuk petugas |
| 2 | Nomor SPMB SQ | `spmb-sq` | SPMB | Nomor SPMB kedua, lalu lintas lebih kecil |
| 3 | Nomor SPMB | `spmb` | SPMB | Kotak masuk petugas aktif |
| 4 | Nomor HCIS | `hcis` | HCIS, Karir, Keluarga | Paling banyak konsumen |

(Kode pasti dibaca dari production sebelum tiap langkah; tabel ini memakai kode yang terlihat saat spesifikasi ditulis.)

### 9.1 Memindahkan auth state (supaya tidak pindai QR ulang)

Satu sesi WhatsApp tidak boleh hidup di dua proses. Urutannya:

1. **Catat memori:** `MemAvailable` dan RSS JalurPesan API/web serta worker (§10).
2. **Parkir nomor di JalurPesan:** `UPDATE devices SET requires_session_reset = 1 WHERE id = '<id JalurPesan>'` pada `jalurpesan.sqlite`. Dengan ini `restoreIfAuthenticated()` melewatinya saat start, tanpa logout dan tanpa menghapus kredensial.
3. **Restart proses API JalurPesan.** Soket nomor itu mati; nomor lain menyambung kembali seperti biasa (Baileys memutar ulang pesan offline, dan cursor event Hub menjaga sisanya). Jangan memakai `POST /device/logout` atau `/device/reset`: keduanya membuang sesi dan memaksa pindai QR.
4. **Salin auth state:** `cp -a /srv/jalurpesan/shared/state/wa-devices/<sha256(idJalurPesan)>/. /srv/sq-hub/shared/kirim-wa/auth/<kode>/`, lalu `chown -R sqhub:sqhub` dan `chmod -R go-rwx`.
5. **Tukar mesin di Hub** lewat rute admin §8.1 (jeda antrean → tunggu kosong → `provider = 'wa'` → lepas jeda). Worker menyambung dengan kredensial yang disalin.
6. **Verifikasi:** status nomor `tersambung` di Kirim, `GET /health` worker 200, satu pesan uji terkirim lewat nomor itu, satu pesan masuk tercatat.
7. **Catat memori lagi** (§10).

**Jalur mundur** (urut, berhenti di yang berhasil):

- a. Tukar balik ke `jalurpesan` di Hub, hapus parkir di JalurPesan (`requires_session_reset = 0`), restart JalurPesan. Auth state asli JalurPesan tidak pernah dihapus pada langkah 4, jadi sesi lama masih sah.
- b. Bila sesi tidak mau hidup di mana pun: **pindai QR ulang** di kartu Kirim (Kelola nomor → Pasang). Riwayat percakapan tidak hilang; hanya sesi WhatsApp yang baru.

Gate sebelum nomor berikutnya: nomor yang baru pindah harus **stabil minimal 24 jam** (tersambung, tidak ada `device.status` terputus berulang, tidak ada lonjakan `kirim_outbox` gagal).

---

## 10. Pengukuran memori

Sebelum dan sesudah tiap cutover, dicatat di runbook:

```
grep MemAvailable /proc/meminfo
# RSS per proses, kB:
for p in $(pidof node); do printf '%s %s %s\n' "$p" "$(grep VmRSS /proc/$p/status | awk '{print $2}')" "$(readlink /proc/$p/cwd)"; done
```

Target akhir: JalurPesan mati, hemat ±335 MB (API) + ±53 MB (web), dikurangi RSS worker. **Bila MemAvailable justru turun setelah sebuah cutover, cutover berikutnya dihentikan dan dilaporkan ke owner** (ini gate ADR-0011 "Release gates" yang diperbarui).

---

## 11. Konfigurasi

Hub (`final.env`):

| Nama | Arti |
| --- | --- |
| `KIRIM_WA_BASE_URL` | `http://127.0.0.1:3310` |
| `KIRIM_WA_PLATFORM_KEY` | rahasia bersama Hub ↔ worker |

Worker (`final.env` yang sama, dibaca oleh proses worker):

| Nama | Bawaan | Arti |
| --- | --- | --- |
| `KIRIM_WA_PORT` | `3310` | hanya `127.0.0.1` |
| `KIRIM_WA_AUTH_ROOT` | — | folder auth state |
| `KIRIM_WA_MEDIA_ROOT` | — | folder media |
| `KIRIM_WA_DATA_KEYS` | — | `kid:base64(32 byte)`, kunci worker, **berbeda** dari `KIRIM_DATA_KEYS` |
| `KIRIM_WA_MAX_DEVICES` | `6` | pengaman jumlah soket |
| `KIRIM_WA_WEBHOOK_URL` | — | jalur dorong ke Hub |
| `KIRIM_WA_WEBHOOK_SECRET` | — | sama dengan `JALURPESAN_WEBHOOK_SECRET` Hub |
| `KIRIM_WA_MEDIA_TTL_HOURS` | `72` | `DRAFT` |
| `KIRIM_WA_MESSAGE_RETENTION_DAYS` | `400` | `DRAFT` |
| `KIRIM_WA_CONNECT_STAGGER_MS` | `3000` | `DRAFT` |

`JALURPESAN_BASE_URL` dan `JALURPESAN_PLATFORM_KEY` tetap ada sampai nomor terakhir pindah dan JalurPesan dipensiunkan; itulah yang membuat jalur mundur bisa ditempuh.

---

## 12. Akses dan privasi

- Worker mendengar hanya di `127.0.0.1:3310`; tidak ada rute edge, tidak ada hostname tunnel.
- Semua rute kecuali `/health` menuntut `Authorization: Bearer <KIRIM_WA_PLATFORM_KEY>`, dibandingkan dengan `timingSafeEqual`.
- Nomor telepon, isi pesan, QR, dan kode pairing **tidak pernah** masuk log worker. Redaksi konsol libsignal (`libsignal-console-redaction.ts`) dipasang sebelum Baileys dimuat.
- Isi pesan yang tersimpan di worker (indeks pesan, buffer impor riwayat, hasil idempotensi) disegel dengan kunci worker sendiri (§7).
- Worker tidak membaca tabel `kirim_*`. Hub tidak membaca tabel `kirim_wa_*`.

---

## 13. Uji

Dipindahkan dan disesuaikan dari JalurPesan `server/test/`:

| Uji JalurPesan | Menjadi |
| --- | --- |
| `device-manager.test.ts` | `apps/kirim-wa/test/device-manager.test.ts` |
| `whatsapp-reconnect.test.ts` | `apps/kirim-wa/test/reconnect.test.ts` |
| `libsignal-console-redaction.test.ts` | `apps/kirim-wa/test/libsignal-redaction.test.ts` |
| `send-safety.test.ts` | `apps/kirim-wa/test/send-safety.test.ts` |
| `outbound-reliability.test.ts` | `apps/kirim-wa/test/idempotency.test.ts` |
| `pairing-and-groups.test.ts` | `apps/kirim-wa/test/pairing-and-groups.test.ts` |
| `platform-api.test.ts`, `platform-read-receipts.test.ts`, `platform-group-management.test.ts` | `apps/kirim-wa/test/platform-api.test.ts` |
| `inbound-messages.test.ts`, `message-actions-and-calls.test.ts` | `apps/kirim-wa/test/events.test.ts` |
| `history-import.test.ts`, `history-bootstrap.test.ts` | `apps/kirim-wa/test/history.test.ts` |
| `media.test.ts` | `apps/kirim-wa/test/media.test.ts` |

Uji baru di Hub:

- `kirim-engine-switch.integration.test.ts`: sakelar per nomor (antrean harus kosong, penolakan nomor duplikat, pencatatan riwayat kartu), dan bahwa pesan dengan id WhatsApp sama tidak masuk dua kali saat nomor pindah mesin.
- `kirim-wa-provider.test.ts`: `WaEngineProvider` memakai base URL dan kunci sendiri, bukan JalurPesan.

---

## 14. Rilis

1. PR menyentuh autentikasi (kunci platform worker), izin (rute admin baru), dan migration → **satu putaran review independen** sebelum merge (aturan owner).
2. Rilis Hub lewat `hub-release.sh` seperti biasa: dump database dulu, dry-run migrasi, bukan jam 19 UTC, rollback otomatis bila tidak sehat.
3. `sq-core-launch.sh` mendapat layanan `kirim-wa`; `sq-core-worker.sh` mendapat gate `ready()`-nya (`GET http://127.0.0.1:3310/health` = 200) sehingga watchdog menyalakannya ulang dalam ±2 menit. `hub-release.sh` menulis ulang jalur rilis worker sama seperti `hub`.
4. Verifikasi kesehatan: 3301, 3302, 3303, 3304, 3305, 3306, 9000 = 200, ditambah 3310 untuk worker.
5. Cutover nomor satu per satu (§9), masing-masing dengan catatan memori.
6. **Pemensiunan JalurPesan** hanya setelah keempat nomor pindah dan stabil beberapa hari: proses `jalurpesan` web dan API dimatikan dan dicabut dari `sq-core-worker.sh`, **`/srv/jalurpesan` tidak dihapus** dan tetap menjadi jalur mundur. Penghapusan nanti menuntut backup state ke Drive `mi8_crypt` lebih dulu.

---

## 15. Dokumentasi untuk owner

- `docs/kirim/panduan-api-gateway-aplikasi-luar.md` dan halaman publik `kirim.sabilulquran.or.id/dokumentasi-api` **tidak berubah**: kontrak pemanggil tetap sama. Bila ternyata ada yang berubah, keduanya diperbarui bersamaan.
- Runbook baru `docs/kirim/runbook-mesin-whatsapp.md` untuk non-engineer: membaca status nomor, menyambungkan ulang sebuah nomor, apa yang terjadi setelah HP restart, kapan harus pindai QR, dan apa yang **tidak** boleh dilakukan (menghapus folder auth).

---

## 16. Jalannya di production (2026-11-17)

Rilis `hub-8418d324-20261117` lewat `hub-release.sh`: dump `/srv/sq-hub/backups/pre-hub-8418d324-20261117.dump`, dry-run migrasi bersih, `0025_kirim_engine_wa.sql` diterapkan, sehat 16 detik. Mesin `kirim-wa` berjalan di `127.0.0.1:3310`, diawasi `sq-core-worker.sh`.

**Cutover 1 — `luar-2` (Aplikasi luar 2, dipakai Samijaya), 2026-11-17 04:31 UTC.** Dilakukan persis menurut §9.1: nomor diparkir di JalurPesan (`requires_session_reset = 1`), API JalurPesan di-restart, folder auth disalin (830 berkas, 0,14 MB; **asal tidak dihapus**), mesin ditukar lewat `KirimAdminService.updateDevice` (antrean dijeda, tidak ada pesan menggantung, penjaga nomor ganda lolos). **Sesi tersambung kembali dalam 3 detik tanpa pindai QR.** Diuji: satu pesan ke nomor itu sendiri lewat mesin (id `3EB0461BC8D5EABF9AF983`, ulangan dengan kunci idempotensi sama tidak mengirim dua kali), lalu satu pesan ujung ke ujung memakai kunci API Samijaya lewat Kirim (id `3EB0DB7CAF0508F6E9DB0B`, tersimpan `provider = 'wa'`, `diserahkan` pada percobaan pertama).

| Ukuran (kB) | Sebelum | Sesudah |
| --- | --- | --- |
| MemAvailable | 961.580 | 1.026.408 |
| JalurPesan API | 169.520 | 136.088 |
| JalurPesan web | 53.276 | 53.276 |
| `kirim-wa` | 89.944 (0 sesi) | 96.724 (1 sesi) |

Memori **naik** 64 MB: JalurPesan melepas 33 MB, mesin memakai 7 MB untuk sesi yang sama. Gate §10 terlampaui dengan baik.

**Koreksi terhadap angka di §1.** JalurPesan API hari ini 136–169 MB, bukan 335 MB seperti perkiraan awal. Penghematan akhir setelah JalurPesan dimatikan karena itu diperkirakan **±190 MB (API + web) dikurangi RSS mesin**, bukan ±388 MB. Angka sebenarnya dicatat pada tiap cutover.

**Keadaan nomor yang ditemukan (bukan akibat perpindahan ini).** Nomor `spmb` di Kirim menunjuk tenant JalurPesan `spmb-2`, yang **tidak pernah dipasangkan**; sesi SPMB yang sebenarnya ada di tenant `spmb` (nomor yang sama, `+62851…78`) dan diparkir dengan `requires_session_reset = 1`. Karena itu WhatsApp SPMB sudah terputus sebelum pekerjaan ini. Pemulihannya sama dengan §9.1: salin folder auth tenant `spmb` menjadi `auth/spmb/`, lalu tukar mesin nomor `spmb` ke `wa`. Bila kredensialnya ternyata sudah mati, nomor itu tetap seperti sekarang dan perlu pindai QR — mencobanya tidak menambah risiko.

**Sisa cutover** (gate §9: stabil ≥24 jam dulu): `spmb`, `luar` (belum pernah dipasangkan, perlu pindai QR apa pun mesinnya), lalu `hcis` (paling ramai, terakhir).

## 17. Pertanyaan terbuka

Tidak ada yang memblokir. Keputusan bisnis yang belum tertulis diambil sebagai `DRAFT` dan dicatat di §2, §4.3, §7, §11.
