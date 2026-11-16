# Panduan API gateway WhatsApp lewat Kirim untuk aplikasi luar

**Status:** BERLAKU sejak 2026-11-16 (keputusan owner; amandemen ADR-0011 2026-11-16).
**Untuk siapa:** developer aplikasi di luar SQ Core yang ingin mengirim WhatsApp lewat nomor yayasan, dan owner yang mendaftarkannya. Panduan ini bisa diikuti tanpa membaca kode SQ Hub.
**Contoh pertama:** Samijaya (toko online, berjalan di Mi8 port 3100) mengirim kode OTP admin lewat Kirim.
**Rujukan teknis:** [KIRIM-IMPL-001](../specs/KIRIM-IMPL-001-r1-nomor-dan-kirim.md) (kirim, status, webhook), [KIRIM-IMPL-002](../specs/KIRIM-IMPL-002-r2-api-percakapan.md) (percakapan), [KIRIM-IMPL-003](../specs/KIRIM-IMPL-003-kartu-modul.md) (kartu dan token), [KIRIM-IMPL-004](../specs/KIRIM-IMPL-004-k3-2-aksi-pesan-panggilan-grup.md) (aksi pesan, grup), [desain modul Kirim](../product/kirim-sq-module-design.md).

## 1. Gambaran

Kirim adalah modul WhatsApp di SQ Hub. Mesin pengirimnya (JalurPesan) tidak pernah dipanggil langsung oleh aplikasi; aplikasi bicara ke **API Kirim** dan Kirim yang mengurus nomor, antrean, batas laju, jam kirim, daftar jangan-hubungi, status terkirim/dibaca, penyimpanan percakapan, dan audit.

Sejak 2026-11-16 aplikasi **di luar SQ Core** boleh memakai API yang sama. Aturannya persis aturan modul SQ Core:

- Aplikasi terdaftar di **Pusat Admin SQ Hub** sebagai jenis **Aplikasi luar** dengan sakelar **Pakai WhatsApp lewat Kirim** dan **client ID Keycloak**-nya. Jenis hanya menjadi label kecil di kartu Kirim dan di dokumentasi; tidak ada perbedaan nomor, kuota, atau izin.
- Aplikasi mendapat **satu kartu** di layar Kirim. Nomor WhatsApp disambungkan dari kartu itu oleh pengelola Kirim (`kirim_admin`), bukan oleh aplikasi. Tidak ada kartu per nomor dan tidak ada logika "nomor siapa" di aplikasi: aplikasi mengirim tanpa menyebut nomor, Kirim memakai nomor di kartunya.
- Identitas aplikasi adalah **client Keycloak service account** (realm `sq-staff`). Aplikasi mengambil token client credentials sendiri; tidak ada rahasia Kirim yang disalin ke aplikasi.
- API Kirim hanya bisa dicapai dari **loopback host yang sama** (`http://127.0.0.1:3302`). Edge publik menjawab `404` untuk semua `/internal/*`. Aplikasi yang tidak berjalan di Mi8 belum bisa memakai gateway ini (asumsi DRAFT: bila nanti ada, jalurnya lewat terowongan privat ke loopback Hub, bukan membuka `/internal/*` ke internet).

## 2. Langkah owner: mendaftarkan aplikasi

Urutan ini memakai Samijaya sebagai contoh; ganti `samijaya` dengan kunci aplikasi Anda.

### 2.1 Buat client Keycloak (service account)

Dilakukan owner lewat `kcadm` dengan sesi master admin (skrip `kirim-kcadm-login.sh` di `sq-core-ops/scripts/mi8` membuat sesi sementara di `/root/kirim.kcadm`). Agent tidak pernah mengetik kata sandi Keycloak.

```sh
# dari chroot Ubuntu di Mi8, dengan sesi kcadm yang sudah ada
KC=/srv/keycloak/releases/keycloak-26.7.2-3a2238fc-20261004/bin/kcadm.sh
$KC create clients -r sq-staff --config /root/kirim.kcadm \
  -s clientId=samijaya -s name="Samijaya" -s enabled=true -s protocol=openid-connect \
  -s publicClient=false -s serviceAccountsEnabled=true \
  -s standardFlowEnabled=false -s implicitFlowEnabled=false -s directAccessGrantsEnabled=false
```

Lalu beri client itu audience `sq-hub-kirim` (idempoten, skrip yang sama dipakai untuk Karir dan Keluarga):

```sh
/data/local/mi8vps/kirim-keycloak.sh audience samijaya
```

Ambil client secret untuk ditaruh di env aplikasi (tampilkan hanya di terminal owner, jangan dicatat di chat atau runbook):

```sh
ID=$($KC get clients -r sq-staff --config /root/kirim.kcadm -q clientId=samijaya --fields id | jq -r '.[0].id')
$KC get clients/$ID/client-secret -r sq-staff --config /root/kirim.kcadm
```

Sesudah selesai, hapus sesi kcadm: `kirim-keycloak.sh cleanup`.

### 2.2 Daftarkan aplikasi di Pusat Admin

Di `hub.sabilulquran.or.id/admin` → **Registry aplikasi** → **Baru**:

| Kolom | Isi |
| --- | --- |
| Kunci aplikasi | `samijaya` (pendek, stabil, tidak bisa diubah) |
| Nama | `Samijaya` (nama yang tampil di kartu Kirim) |
| URL kanonis | alamat publik aplikasi, misalnya `https://samijaya.example` |
| Status | Aktif |
| Jenis aplikasi | **Aplikasi luar** |
| Pakai WhatsApp lewat Kirim | dicentang |
| Client ID Keycloak (client mesin) | `samijaya` (client dari langkah 2.1; satu client hanya untuk satu aplikasi) |

Simpan. Yang sama bisa dilakukan dari CLI Hub bila GUI tidak tersedia: `npm run kirim:admin -- module set --app samijaya --machine-client samijaya --whatsapp true --reason "…"`.

### 2.3 Sambungkan nomor di kartu Kirim

Di `kirim.sabilulquran.or.id` kartu **Samijaya** (berlabel "aplikasi luar") muncul otomatis dengan status *Belum memakai WhatsApp*. Pengelola Kirim memilih **Tambah WhatsApp** → **Sambungkan nomor baru** → **Pasang**, lalu memindai QR dari HP nomor yang akan dipakai Samijaya. Pilihan lain, **Pakai nomor yang sudah aktif**, membuat Samijaya ikut mengirim lewat nomor modul lain (balasan masuk ke pemilik nomor itu).

Sampai kartu tersambung, `POST /internal/kirim/messages` dari aplikasi dijawab `422 device_not_connected`.

### 2.4 Isi env aplikasi

Hanya alamat non-rahasia dan kredensial client-nya sendiri; tidak ada kode nomor, tidak ada rahasia webhook:

```sh
KIRIM_BASE_URL=http://127.0.0.1:3302
KEYCLOAK_TOKEN_URL=https://login.sabilulquran.or.id/realms/sq-staff/protocol/openid-connect/token
KIRIM_CLIENT_ID=samijaya
KIRIM_CLIENT_SECRET=<dari langkah 2.1>
```

## 3. Token client credentials

```sh
curl -s -X POST "$KEYCLOAK_TOKEN_URL" \
  -d grant_type=client_credentials -d client_id="$KIRIM_CLIENT_ID" -d client_secret="$KIRIM_CLIENT_SECRET"
# → { "access_token": "…", "expires_in": 300, "token_type": "Bearer", … }
```

Yang diperiksa Kirim pada token (KIRIM-IMPL-003 §6):

- Ditandatangani realm `sq-staff` dan belum kedaluwarsa.
- **Audience** memuat `sq-hub-kirim` **atau** `sq-hub-api`. Token dengan audience `sq-hub-api` harus token service account (klaim `client_id` ada dan sama dengan `azp`); token pengguna ditolak.
- `azp`/`client_id` sama dengan **client ID yang terdaftar di registry** untuk aplikasi yang **aktif** dan **memakai WhatsApp**. Mengganti client ID di Pusat Admin langsung memutus client lama.

Simpan token di memori dan pakai ulang sampai sekitar 30 detik sebelum `expires_in` habis. Bila Kirim menjawab `401`, ambil token baru sekali lalu ulangi; `401` kedua berarti ada yang salah dengan client-nya.

## 4. Endpoint untuk aplikasi

Semua di bawah `http://127.0.0.1:3302/internal/kirim`, dengan header `Authorization: Bearer <token>`. Jawaban galat selalu berbentuk `{ "error": { "code", "message", "fields"? } }`; tidak ada jawaban yang memuat isi pesan atau nomor utuh orang lain.

| Method dan path | Fungsi |
| --- | --- |
| `GET /sambungan` | Nomor di kartu aplikasi, jenis yang boleh dikirim, dan rahasia webhook (§4.1) |
| `PUT /sambungan/webhook` | Mendaftarkan alamat webhook aplikasi sendiri (§4.6) |
| `POST /messages` | Kirim teks atau media ke satu nomor (§4.2, §4.3). Wajib `Idempotency-Key` |
| `GET /messages/:id` | Status satu pesan milik aplikasi ini (§4.4) |
| `POST /media` | Unggah PDF/JPEG/PNG sampai 5 MiB untuk dikirim (§4.3) |
| `POST /optouts`, `DELETE /optouts` | Tambah dan cabut jangan-hubungi (§4.5) |
| `GET /devices/:kode/conversations`, `GET /conversations/:id`, `GET /conversations/:id/messages`, `GET /media/:id`, `POST /devices/:kode/conversations`, `POST /conversations/:id/messages`, `POST /conversations/:id/read` | API percakapan: hanya untuk aplikasi **pemilik** nomor (§4.7) |
| Grup, aksi pesan (teruskan, edit, hapus, reaksi), foto profil, profil bisnis, katalog, balasan cepat, label | Sama: pemilik nomor saja; rincian di KIRIM-IMPL-002 §6 dan KIRIM-IMPL-004 |

### 4.1 Membaca sambungan

```sh
curl -s "$KIRIM_BASE_URL/internal/kirim/sambungan" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "modul": "samijaya",
  "nomor": { "kode": "samijaya", "status": "tersambung", "nomor_tersamar": "+62 812-••••-7890", "peran": "pemilik" },
  "jenis": ["notifikasi", "kode"],
  "webhook": null
}
```

- `nomor` bernilai `null` selama kartu belum tersambung. `status` salah satu dari `belum_dipasang`, `menunggu_pairing`, `tersambung`, `terputus`, `nonaktif`.
- `jenis`: `notifikasi` (pesan otomatis biasa) dan/atau `kode` (OTP). Pemilik nomor selalu boleh `notifikasi`; `kode` dan rute pada nomor modul lain diatur pengelola Kirim di kartu.
- `webhook` berisi `{ url, secret }` setelah aplikasi mendaftarkan webhook (§4.6). Rahasia ini yang dipakai memverifikasi tanda tangan.
- Aplikasi **tidak** mengambil keputusan dari `peran`; perilakunya sama di nomor mana pun (KIRIM-IMPL-003 G-1).

### 4.2 Mengirim teks

```sh
curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: samijaya:admin-otp:9f1c2d" \
  -d '{ "jenis": "kode", "to": "+6281234567890", "text": "Kode masuk admin Samijaya: 123456. Berlaku 10 menit.", "ref": "samijaya:admin-otp:9f1c2d" }'
# → 202 { "id": "4a1f…", "status": "antre" }
```

| Field | Arti |
| --- | --- |
| `jenis` | `kode` untuk OTP dan kode verifikasi: prioritas tertinggi, tidak terikat jam kirim dan jangan-hubungi, kedaluwarsa 10 menit, isinya disamarkan di penyimpanan. `notifikasi` untuk pesan otomatis lain: hanya dikirim 06.00–21.00 WIB, dihormati jangan-hubungi, kedaluwarsa 24 jam |
| `to` | Nomor tujuan: `+62…`, `62…`, atau `08…` (spasi, tanda hubung, kurung diabaikan) |
| `text` | 1–4096 karakter. **Atau** `media_id` (§4.3) dengan `caption` opsional; tepat satu dari keduanya |
| `prioritas` | `normal` (bawaan) atau `tinggi` |
| `kedaluwarsa` | ISO 8601 dengan zona waktu; pesan yang belum terkirim sampai saat itu menjadi `gagal/expired`. Untuk `kode` paling lama 10 menit |
| `ref` | ≤ 200 karakter, rujukan milik aplikasi yang ikut dikembalikan di status dan webhook. **Tanpa data pribadi** (bukan nomor, bukan nama) |
| `device` | Opsional dan **tidak perlu** untuk aplikasi luar: tanpa `device`, Kirim memakai nomor di kartu |

`Idempotency-Key` (1–200 karakter) wajib. Permintaan ulang dengan kunci dan isi yang sama mengembalikan pesan yang sama tanpa mengirim ulang; kunci yang sama dengan isi berbeda dijawab `409 idempotency_key_conflict`. Ulangi `POST` hanya bila tidak mendapat `202` (5xx, timeout, jaringan), dengan kunci yang **sama**. Setelah `202`, kegagalan datang lewat status (§4.4) atau webhook (§4.6); jangan kirim ulang otomatis.

### 4.3 Mengirim media

Unggah dulu, lalu kirim `media_id`-nya. Berkas diperiksa dari isinya (magic bytes), bukan dari nama: `application/pdf`, `image/jpeg`, `image/png`, maksimum 5 MiB. Kirim tidak pernah mengambil URL luar.

```sh
curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/media" \
  -H "Authorization: Bearer $TOKEN" -F "file=@struk.pdf;type=application/pdf"
# → 201 { "media_id": "7c0e…", "sha256": "…", "ukuran": 48213 }

curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: samijaya:struk:SJ1" \
  -d '{ "jenis": "notifikasi", "to": "+6281234567890", "media_id": "7c0e…", "caption": "Struk pesanan SJ1", "ref": "samijaya:struk:SJ1" }'
```

Media yang diunggah tetapi tidak dipakai dalam 24 jam boleh dibersihkan Kirim.

### 4.4 Status pesan

```sh
curl -s "$KIRIM_BASE_URL/internal/kirim/messages/4a1f…" -H "Authorization: Bearer $TOKEN"
# → { "id": "4a1f…", "ref": "samijaya:admin-otp:9f1c2d", "status": "terkirim", "error_code": null, "dry_run": false, "updated_at": "2026-11-16T07:00:12.000Z" }
```

| `status` | Arti |
| --- | --- |
| `antre` | Diterima Kirim, menunggu giliran (jam kirim, laju, atau nomor yang sedang terputus) |
| `diserahkan` | Mesin sudah mengirim ke WhatsApp. `dry_run: true` berarti nomor masih memakai penyedia `log` (uji), tidak ada yang benar-benar terkirim |
| `terkirim` | Sampai di HP penerima |
| `dibaca` | Dibaca penerima |
| `gagal` | Tidak terkirim; `error_code` terisi (§6) |
| `dibatalkan` | Dibatalkan pengelola Kirim dari layar Antrean sebelum diserahkan |

Status hanya bergerak maju. Pesan milik aplikasi lain dijawab `404 not_found`.

### 4.5 Jangan hubungi (opt-out)

```sh
# orang minta tidak dihubungi lagi oleh aplikasi ini
curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/optouts" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "nomor": "+6281234567890", "cakupan": "consumer", "alasan": "Minta berhenti lewat chat 2026-11-16" }'
# mencabut opt-out yang dibuat aplikasi ini sendiri
curl -s -X DELETE "$KIRIM_BASE_URL/internal/kirim/optouts" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "nomor": "+6281234567890", "cakupan": "consumer", "alasan": "Minta dihubungi lagi" }'
```

Cakupan `consumer` berlaku untuk pesan `notifikasi` dari aplikasi ini saja; `kode` tetap lewat. Cakupan `device` (semua aplikasi di nomor itu) hanya boleh dibuat pemilik nomor. Opt-out yang dibuat admin atau aplikasi lain tidak bisa dicabut lewat sini (`404`). Keduanya idempoten.

### 4.6 Webhook masuk ke aplikasi

Aplikasi yang ingin menerima status dan pesan masuk mendaftarkan alamatnya sendiri. Alamat hanya boleh `http://127.0.0.1:<port>/internal/kirim/webhook` atau `https://<host>.sabilulquran.or.id/api/internal/kirim/webhook`, tanpa query. Kirim membuat rahasia 32 byte sekali dan menyimpannya terenkripsi; aplikasi membacanya dari jawaban (sama dengan `GET /sambungan`).

```sh
curl -s -X PUT "$KIRIM_BASE_URL/internal/kirim/sambungan/webhook" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "url": "http://127.0.0.1:3100/internal/kirim/webhook" }'
# → { …, "webhook": { "url": "http://127.0.0.1:3100/internal/kirim/webhook", "secret": "…" } }
```

Setiap event dikirim `POST` dengan `Content-Type: application/json` dan tiga header:

| Header | Isi |
| --- | --- |
| `X-Kirim-Event-Id` | ID event, sama di setiap percobaan ulang; aplikasi wajib mengabaikan ID yang sudah diproses |
| `X-Kirim-Timestamp` | Detik Unix saat pengiriman; tolak bila selisih dengan jam server lebih dari 5 menit |
| `X-Kirim-Signature` | Hex HMAC-SHA256(`secret`, `timestamp + "." + body mentah`) |

Verifikasi (Node, tanpa pustaka tambahan). Tanda tangan dihitung atas **body mentah**, jadi baca body sebagai string sebelum di-parse:

```js
const crypto = require('node:crypto');

function kirimWebhookValid(secret, headers, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
  const timestamp = Number(headers['x-kirim-timestamp']);
  const signature = String(headers['x-kirim-signature'] || '');
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}
```

Jawab `2xx` secepatnya (timeout Kirim 10 detik) dan proses isinya setelah itu. Selain `2xx`, Kirim mengulang dengan backoff 30 detik, 1, 2, 4 … menit sampai maksimum 1 jam, paling banyak 8 percobaan, lalu event itu `habis` dan tampil sebagai peringatan di layar Kirim. Tipe event yang tidak dikenal wajib dijawab `2xx` dan diabaikan.

Isi event (`{ "event_id", "type", "occurred_at", "data" }`):

| `type` | Dikirim ke | `data` |
| --- | --- | --- |
| `message.status` | Aplikasi pengirim, dan pemilik nomor untuk semua pesan keluar di nomornya | `id`, `ref` (hanya untuk pengirimnya), `status`, `error_code`, `dry_run`, `conversation_id` |
| `message.received` | Pemilik nomor | `device`, `conversation_id`, `message_id`, `from` (`null` bila WhatsApp hanya memberi alamat LID), `nama_profil`, `tipe`, `cuplikan` (≤ 200 karakter), `received_at`, `kutipan_message_id`, `diteruskan` |
| `message.sent` | Pemilik nomor | Pesan keluar di nomornya yang bukan dibuat pemilik (diketik di HP, atau pesan otomatis aplikasi lain): `device`, `conversation_id` atau `group_id`, `message_id`, `asal`, `dikirim_oleh`, `tipe`, `cuplikan`, `status`, `waktu` |
| `device.status` | Pemilik dan setiap aplikasi yang punya rute di nomor itu | `device`, `status` |
| `group.message.received`, `message.edited`, `message.deleted`, `message.reaction`, `call.logged` | Pemilik nomor | Lihat KIRIM-IMPL-002 §7 dan KIRIM-IMPL-004 §7 |

Aplikasi yang hanya mengirim OTP tidak perlu webhook: cukup `GET /messages/:id` bila ingin tahu statusnya.

### 4.7 Percakapan (pemilik nomor)

Bila kartu aplikasi **memiliki** nomornya (bukan memakai nomor modul lain), aplikasi boleh membaca dan membalas percakapan nomor itu atas nama petugasnya. Setiap panggilan baca menyebut petugas lewat header `X-Kirim-Atas-Nama-Issuer` dan `X-Kirim-Atas-Nama-Sub` (atau body `atas_nama: { issuer, sub }` untuk tulis); Kirim mencatatnya di audit dan pada pesan keluar, sedangkan hak akses petugas diperiksa aplikasi sendiri.

```sh
curl -s "$KIRIM_BASE_URL/internal/kirim/devices/samijaya/conversations?batas=20" -H "Authorization: Bearer $TOKEN" \
  -H "X-Kirim-Atas-Nama-Issuer: https://login.sabilulquran.or.id/realms/sq-staff" -H "X-Kirim-Atas-Nama-Sub: <sub petugas>"
curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/conversations/<id>/messages" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -H "Idempotency-Key: samijaya:balas:<id>:1" \
  -d '{ "text": "Terima kasih, pesanan Anda sedang disiapkan.", "atas_nama": { "issuer": "https://login.sabilulquran.or.id/realms/sq-staff", "sub": "<sub petugas>" } }'
```

Balasan petugas hanya boleh dalam 24 jam setelah pesan masuk terakhir bila orang itu minta tidak dihubungi; selain itu bebas jam. Bentuk item percakapan dan pesan, grup, media masuk, dan aksi pesan ada di KIRIM-IMPL-002 §6 dan KIRIM-IMPL-004. Isi chat tidak disalin ke basis data aplikasi; aplikasi menyimpan data kerjanya sendiri saja.

## 5. Kuota dan batas laju

| Batas | Nilai | Diatur oleh |
| --- | --- | --- |
| Kuota harian per aplikasi (semua jenis) | bawaan **500 pesan per hari WIB** (1–100.000) | Pengelola Kirim (`kuota_harian` pemakai) |
| Laju per nomor | bawaan **10 pesan per menit** (1–60) per nomor, dibagi semua aplikasi di nomor itu | Kartu pemilik nomor |
| Jeda antar kiriman di satu nomor | acak 2–6 detik | Tetap |
| Jam kirim `notifikasi` | bawaan 06.00–21.00 WIB; pesan di luar jam menunggu sampai 06.00 (atau kedaluwarsa) | Kartu pemilik nomor |
| `kode` | tanpa jam kirim, tanpa jangan-hubungi, kedaluwarsa 10 menit | Tetap |
| Ulang kirim bila mesin gagal | 1, 5, lalu 30 menit (4 percobaan), lalu `gagal` | Tetap |
| Teks | 1–4096 karakter; `ref` ≤ 200 | Tetap |
| Media keluar | PDF/JPEG/PNG ≤ 5 MiB, satu berkas per unggahan | Tetap |
| Body JSON | `413 body_too_large` bila melewati batas rute | Tetap |
| Grup dan katalog | batas per jam tersendiri, dijawab `429` dengan `Retry-After` | KIRIM-IMPL-004 §9, §17 |

Kuota yang habis dijawab `422 quota_exceeded` saat `POST /messages`; aplikasi menyimpan permintaan di sisinya dan mencoba lagi setelah pukul 00.00 WIB. Jangan membangun pengulangan agresif: antrean dan laju sudah diatur Kirim.

## 6. Kode galat

Galat HTTP saat memanggil API:

| HTTP | `code` | Arti dan tindakan |
| --- | --- | --- |
| 400 | `invalid_request` | Body atau query tidak sesuai skema; `fields` menyebut path field yang salah (nilainya tidak dikembalikan) |
| 400 | `idempotency_key_required` | Header `Idempotency-Key` tidak ada atau bukan 1–200 karakter |
| 400 | `atas_nama_required` | Panggilan percakapan tanpa petugas |
| 401 | `unauthenticated` | Token tidak ada, kedaluwarsa, atau tanda tangannya salah. Ambil token baru sekali |
| 401 | `invalid_signature` | Hanya untuk webhook mesin, bukan untuk aplikasi |
| 403 | `consumer_unknown` | Client tidak terdaftar sebagai client aplikasi yang aktif dan memakai WhatsApp, atau pemakainya dinonaktifkan pengelola Kirim |
| 403 | `not_owner` | Panggilan percakapan atau opt-out `device` dari aplikasi yang bukan pemilik nomor |
| 404 | `not_found` | Pesan, percakapan, atau opt-out bukan milik aplikasi ini |
| 409 | `idempotency_key_conflict` | Kunci sama, isi berbeda. Pakai kunci baru |
| 413 | `body_too_large` | Body melewati batas |
| 422 | `device_not_connected` | Kartu aplikasi belum tersambung ke nomor. Minta pengelola Kirim menyambungkannya |
| 422 | `device_inactive` | Nomor di kartu nonaktif |
| 422 | `route_denied` | Jenis ini tidak diizinkan lewat nomor itu (misalnya `kode` di nomor modul lain tanpa rute `kode`) |
| 422 | `invalid_number` | `to` bukan nomor telepon yang sah |
| 422 | `optout` | Orang itu minta tidak dihubungi (hanya untuk `notifikasi`) |
| 422 | `quota_exceeded` | Kuota harian aplikasi habis |
| 422 | `media_invalid` | Bukan PDF/JPEG/PNG, lebih dari 5 MiB, lebih dari satu berkas, atau `media_id` bukan milik aplikasi ini di nomor ini |
| 422 | `webhook_url_invalid` | Alamat webhook di luar aturan §4.6 |
| 429 | `engine_rate_limited`, `antrean_penuh`, `group_add_limit` | Batas sementara; tunggu `Retry-After` detik |

`error_code` pada status `gagal` (§4.4) dan webhook `message.status`: `optout`, `route_denied`, `quota_exceeded`, `device_inactive`, `invalid_number`, `media_invalid`, `expired` (kedaluwarsa sebelum terkirim, termasuk `kode` lewat 10 menit dan nomor yang lama terputus), `engine_unavailable`, `engine_rejected`, `engine_conflict`, `cancelled`.

## 7. Contoh integrasi OTP minimal (Node 22, tanpa pustaka tambahan)

```js
'use strict';
const crypto = require('node:crypto');

const env = {
  base: process.env.KIRIM_BASE_URL.replace(/\/+$/, ''),
  tokenUrl: process.env.KEYCLOAK_TOKEN_URL,
  clientId: process.env.KIRIM_CLIENT_ID,
  clientSecret: process.env.KIRIM_CLIENT_SECRET,
};
let cached = { token: '', expiresAt: 0 };

async function token(force = false) {
  if (!force && cached.token && cached.expiresAt > Date.now()) return cached.token;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.clientId, client_secret: env.clientSecret });
  const response = await fetch(env.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw new Error('token ' + response.status);
  const data = await response.json();
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 30) * 1000 };
  return cached.token;
}

// Mengirim satu kode OTP. `challengeId` menjadi kunci idempotensi, jadi pengulangan setelah timeout tidak mengirim dua kali.
async function sendOtp(phone, code, challengeId) {
  const send = async (bearer) => fetch(env.base + '/internal/kirim/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', 'Idempotency-Key': 'otp:' + challengeId },
    body: JSON.stringify({ jenis: 'kode', to: phone, text: `Kode masuk Anda: ${code}. Berlaku 10 menit.`, ref: 'otp:' + challengeId }),
    signal: AbortSignal.timeout(12000),
  });
  let response = await send(await token());
  if (response.status === 401) response = await send(await token(true));
  if (response.status !== 202) {
    const error = await response.json().catch(() => ({}));
    throw new Error('kirim ' + response.status + ' ' + (error.error?.code ?? ''));
  }
  return (await response.json()).id; // simpan bila ingin menanyakan statusnya lewat GET /messages/:id
}

module.exports = { sendOtp };
```

Implementasi yang dipakai Samijaya ada di `server/kirim-client.js` repo Samijaya, dengan uji HTTP tiruan di `tests/kirim-client-harness.js`.

## 8. Aturan yang berlaku untuk aplikasi

- Aplikasi tidak memilih nomor dan tidak menyimpan kode nomor; nomor ada di kartunya di Kirim. Mengganti nomor dilakukan pengelola Kirim di kartu, tanpa perubahan di aplikasi.
- `ref`, kunci idempotensi, dan log aplikasi tidak memuat nomor telepon atau nama orang.
- Isi pesan `kode` disamarkan di Kirim; aplikasi juga tidak mencatat kode di lognya.
- Pesan `notifikasi` mengikuti jam kirim dan jangan-hubungi; pakai `kode` hanya untuk kode verifikasi, bukan untuk melewati jam kirim.
- Aplikasi mengulang `POST` hanya saat tidak mendapat `202`, dengan kunci yang sama. Kegagalan setelah `202` datang lewat status atau webhook.
- Client secret disimpan di env aplikasi (misalnya `prod.env` dengan mode 600), tidak di repo, tidak di chat.
- Kirim boleh dinonaktifkan untuk satu aplikasi oleh pengelola Kirim (pemakai nonaktif, kartu diputus, atau sakelar WhatsApp di Pusat Admin dimatikan); aplikasi harus tetap berjalan dengan pesan yang tertunda, bukan gagal total.

## 9. Pemeriksaan cepat setelah pendaftaran

1. `GET /sambungan` dengan token aplikasi menjawab `200` dan `modul` sama dengan kunci aplikasi. `403 consumer_unknown` berarti client ID di Pusat Admin tidak sama dengan `azp` token, aplikasi tidak aktif, atau sakelar WhatsApp belum dicentang; `401` berarti token (audience, realm, kedaluwarsa).
2. `nomor` terisi dan `status: "tersambung"`. Bila `null`, kartu belum disambungkan (§2.3).
3. Kirim satu pesan uji ke nomor sendiri dengan `jenis: "kode"`; `GET /messages/:id` menjadi `terkirim` dalam beberapa detik. `dry_run: true` berarti nomor masih memakai penyedia `log`.
4. Di layar Kirim, kartu aplikasi menampilkan hitungan antrean; layar Aktivitas mencatat pengirimnya.

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-11-16 | Dokumen pertama, bersama amandemen ADR-0011 "aplikasi luar boleh punya kartu" dan pendaftaran aplikasi luar dari Pusat Admin. Contoh pertama: Samijaya |
