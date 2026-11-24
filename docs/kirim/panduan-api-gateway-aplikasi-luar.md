# Panduan gerbang API WhatsApp lewat Kirim untuk aplikasi luar

**Status:** BERLAKU sejak 2026-11-17 (keputusan owner 2026-11-16 dan koreksi 2026-11-17; amandemen ADR-0011 2026-11-17). Menggantikan versi 2026-11-16 (client Keycloak, kartu per aplikasi) dan rancangan sementara "kunci per aplikasi".
**Untuk siapa:** developer portal atau aplikasi di luar SQ Suite yang ingin mengirim WhatsApp lewat nomor yayasan, dan pengelola Kirim yang menyambungkan nomornya. Versi untuk developer yang bisa dibuka tanpa login: **https://kirim.sabilulquran.or.id/dokumentasi-api** (tautan "Dokumentasi API" di panel Kirim dan di kartu).
**Contoh pertama:** Samijaya (toko online, berjalan di Mi8 port 3100) mengirim kode OTP admin dan notifikasi pesanan lewat Kirim.
**Rujukan teknis:** [KIRIM-IMPL-001](../specs/KIRIM-IMPL-001-r1-nomor-dan-kirim.md) (kirim, status, webhook), [KIRIM-IMPL-003](../specs/KIRIM-IMPL-003-kartu-modul.md) (kartu), [desain Kirim](../product/kirim-sq-module-design.md), [ADR-0011](../architecture/adr/0011-kirim-sq-shared-whatsapp-capability.md), istilah [STRUKTUR-001](../product/struktur-sq-suite.md).

## 1. Gambaran

Kirim adalah aplikasi WhatsApp di SQ Suite. Mesin pengirimnya (JalurPesan) tidak pernah dipanggil langsung; aplikasi bicara ke **API Kirim**, dan Kirim yang mengurus nomor, antrean, batas laju, jam kirim, daftar jangan hubungi, status terkirim, penyimpanan percakapan, dan audit.

Untuk aplikasi **di luar SQ Suite**, konsepnya generik, seperti JalurPesan atau penyedia WhatsApp lain: **nomor punya kunci, titik.**

- Di panel Kirim ada **satu kartu "Aplikasi luar"** (keterangan: *Portal atau aplikasi di luar Sabilul Qur'an Suite yang memakai API*; nama dan keterangan asumsi DRAFT). Kartu itu **menampung beberapa nomor**. Muka kartu tidak menyebut aplikasi mana pun; tidak ada kartu per aplikasi dan tidak ada kartu per nomor.
- **Setiap nomor di kartu punya kunci API sendiri** (`krm_…`), dibuat otomatis saat nomor disambungkan. Pop-up kartu menampilkan per nomor: status sambungan, kuncinya (tombol **Tampilkan**, **Salin**, **Putar ulang**, **Cabut**), dan kapan terakhir dipakai. Memutar ulang atau mencabut kunci **tidak memutus WhatsApp** nomor itu.
- Kirim **tidak perlu tahu aplikasi mana** yang memegang kunci. Tidak ada pendaftaran aplikasi, tidak ada client Keycloak, tidak ada client ID mesin. Owner menyalin kunci dari kartu dan menempelkannya ke aplikasi luar mana pun yang ia mau.
- Aplikasi mengirim **tanpa menyebut nomor**; Kirim memakai nomor pemilik kunci.
- Dua alamat dasar, satu antrean (KIRIM-IMPL-003 §17.4):
  - aplikasi di host yang sama: `http://127.0.0.1:3302/internal/kirim` (loopback; edge publik menjawab `404` untuk semua `/internal/*`);
  - aplikasi di hosting lain (mis. Google Apps Script): `https://kirim.sabilulquran.or.id/api/v1`. Hanya menerima kunci `krm_…`; tanpa kunci atau dengan token lain jawabannya `401`. Endpoint yang ada: `GET /sambungan`, `PUT /sambungan/webhook`, `POST /messages`, `GET /messages/:id`, `POST`/`DELETE /optouts`, `POST /media`. Percakapan dan grup tidak tersedia di alamat ini.
- **Nomor aplikasi lain** (§17): bila nomor luar ternyata dipindai ke WhatsApp yang sudah dimiliki aplikasi lain (mis. Nomor HCIS), tombol **Sambungkan ke nomor yang ada** memindahkan **kunci yang sama** ke nomor itu. Aplikasi luarnya tidak perlu diubah; kartunya tetap tampil sebagai "memakai Nomor HCIS" untuk mengurus kunci, dan **Hapus** di kartu itu melepas nomornya (kunci dicabut, nomor tetap berjalan untuk pemiliknya).

Aplikasi di dalam SQ Suite tetap memakai jalur lama: registry Pusat Admin, kartu per aplikasi, dan token Keycloak (KIRIM-IMPL-003). Jenis "Aplikasi luar" di Pusat Admin hanya label; ia tidak menentukan kartu Kirim maupun akses API.

## 2. Dua langkah

### 2.1 Pengelola Kirim: sambungkan nomor

Di `kirim.sabilulquran.or.id`, halaman **Aplikasi**, ubin **Nomor aplikasi luar** → **Tambah nomor**. Kirim membuat nomor baru (kode `luar`, `luar-2`, …; label "Aplikasi luar", "Aplikasi luar 2", …) beserta kuncinya, lalu membuka pemasangan: pindai QR dari HP nomor yang akan dipakai. Sejak itu **nomor tersebut punya kartunya sendiri** di halaman yang sama, sejajar dengan kartu aplikasi: di situ ada statusnya, tombol **Kunci API**, Pasang atau Sambungkan ulang, Ubah, dan Putuskan. Jam kirim, laju, dan jeda antrean diatur pada nomornya seperti nomor lain.

### 2.2 Owner atau developer: salin kunci nomor itu ke aplikasi

Di pop-up, pada nomor yang dipakai, tekan **Tampilkan** atau **Salin**, lalu taruh kuncinya di berkas env server aplikasi:

```sh
KIRIM_BASE_URL=http://127.0.0.1:3302
KIRIM_API_KEY=<kunci krm_… dari nomor di kartu Aplikasi luar>
```

Contoh di bawah memakai jalur loopback `$KIRIM_BASE_URL/internal/kirim/…`. Dari hosting lain (mis. Google Apps Script; simpan kuncinya di Script Properties, bukan di kode), ganti awalan itu dengan `https://kirim.sabilulquran.or.id/api/v1/…`, misalnya `POST https://kirim.sabilulquran.or.id/api/v1/messages`.

Kunci setara kata sandi: simpan di env server (mode 600), bukan di kode frontend, repositori, log, atau chat. Bila bocor, **Putar ulang** memberi kunci baru dan mematikan yang lama seketika; **Cabut** mematikan kunci tanpa pengganti. WhatsApp nomor itu tetap tersambung. Audit Kirim mencatat `gerbang.nomor_baru`, `gerbang.kunci_buat`, `gerbang.kunci_putar`, `gerbang.kunci_cabut`, dan `gerbang.webhook` (awalan kunci saja, tanpa nilainya).

## 3. Autentikasi

Setiap permintaan ke `http://127.0.0.1:3302/internal/kirim/*` membawa `Authorization: Bearer <kunci>`. Kirim mencari hash kuncinya; kunci yang tidak dikenal, diputar ulang, atau dicabut dijawab `401 unauthenticated`, gerbang yang dinonaktifkan pengelola dijawab `403 consumer_unknown`. Token Keycloak tidak pernah bisa bertindak sebagai gerbang.

`Idempotency-Key` wajib di `POST /messages` dan berlaku **per nomor**: dua nomor boleh memakai nilai yang sama tanpa bentrok, dan kunci yang diputar ulang tetap mengenali pengulangan sebelumnya.

## 4. Endpoint yang tersedia untuk kunci API

Jawaban galat selalu `{ "error": { "code", "message", "fields"? } }`.

| Method dan path | Fungsi |
| --- | --- |
| `GET /sambungan` | Nomor pemilik kunci, jenis yang boleh dikirim, webhook nomor itu |
| `PUT /sambungan/webhook` | Mendaftarkan alamat webhook untuk nomor ini |
| `POST /messages` | Kirim teks atau media. Wajib `Idempotency-Key`; field `device` **tidak boleh** dikirim (400) |
| `GET /messages/:id` | Status pesan yang dikirim lewat nomor ini |
| `POST /media` | Unggah PDF/JPEG/PNG sampai 5 MiB (tanpa field `device`) |
| `POST /optouts`, `DELETE /optouts` | Jangan hubungi, cakupan `consumer` atau `device` (hanya nomor ini) |

Endpoint percakapan, grup, aksi pesan, foto profil, dan profil bisnis **tidak** tersedia untuk kunci API (`403 api_key_not_allowed`); itu milik aplikasi SQ Suite pemilik nomor.

### 4.1 Membaca sambungan

```sh
curl -s "$KIRIM_BASE_URL/internal/kirim/sambungan" -H "Authorization: Bearer $KIRIM_API_KEY"
```

```json
{ "nomor": { "kode": "luar", "status": "tersambung", "nomor_tersamar": "+62 851-••••-2504" }, "jenis": ["notifikasi", "kode"], "webhook": null }
```

### 4.2 Mengirim teks

```sh
curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/messages" \
  -H "Authorization: Bearer $KIRIM_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: samijaya:admin-otp:9f1c2d" \
  -d '{ "jenis": "kode", "to": "+6281234567890", "text": "Kode masuk admin Samijaya: 123456. Berlaku 10 menit.", "ref": "samijaya:admin-otp:9f1c2d" }'
# → 202 { "id": "4a1f…", "status": "antre" }
```

| Field | Arti |
| --- | --- |
| `jenis` | `kode` untuk OTP: prioritas tertinggi, tanpa jam kirim dan jangan hubungi, kedaluwarsa 10 menit, isi disamarkan. `notifikasi` untuk pesan otomatis lain: 06.00–21.00 WIB, menghormati jangan hubungi, kedaluwarsa 24 jam |
| `to` | `+62…`, `62…`, atau `08…`; spasi, tanda hubung, kurung diabaikan |
| `text` | 1–4096 karakter, **atau** `media_id` dengan `caption` opsional |
| `prioritas` | `normal` (bawaan) atau `tinggi` |
| `kedaluwarsa` | ISO 8601 dengan zona waktu; untuk `kode` paling lama 10 menit |
| `ref` | ≤ 200 karakter, dikembalikan di status dan webhook; **tanpa data pribadi** |

Ulangi `POST` hanya bila tidak mendapat `202` (5xx, timeout, jaringan), dengan kunci idempotensi yang **sama**; kunci sama dengan isi berbeda dijawab `409 idempotency_key_conflict`. Setelah `202`, kegagalan datang lewat status atau webhook.

### 4.3 Media, status, jangan hubungi

Sama dengan API aplikasi SQ Suite (KIRIM-IMPL-001 §5.4, §6.1; KIRIM-IMPL-002 §8), tanpa field `device`:

```sh
curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/media" -H "Authorization: Bearer $KIRIM_API_KEY" -F "file=@struk.pdf;type=application/pdf"
curl -s "$KIRIM_BASE_URL/internal/kirim/messages/<id>" -H "Authorization: Bearer $KIRIM_API_KEY"
curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/optouts" -H "Authorization: Bearer $KIRIM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "nomor": "+6281234567890", "cakupan": "consumer", "alasan": "Minta berhenti lewat chat 2026-11-17" }'
```

Status: `antre` → `diserahkan` → `terkirim` → `dibaca`, atau `gagal` (dengan `error_code`) / `dibatalkan`. `GET /messages/:id` hanya melihat pesan yang dikirim lewat nomor kunci itu.

### 4.4 Webhook

Webhook terdaftar **per nomor**. Alamat boleh `https://<host>/…` mana pun atau `http://127.0.0.1:<port>/…`, tanpa kredensial di URL. Kirim membuat rahasia 32 byte sekali dan menyimpannya terenkripsi; aplikasi membacanya dari jawaban. Memutar ulang kunci tidak mengubah webhook maupun rahasianya.

```sh
curl -s -X PUT "$KIRIM_BASE_URL/internal/kirim/sambungan/webhook" -H "Authorization: Bearer $KIRIM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "url": "http://127.0.0.1:3100/internal/kirim/webhook" }'
# → { "nomor": { … }, "jenis": [ … ], "webhook": { "url": "…", "secret": "…" } }
```

Header tiap event: `X-Kirim-Event-Id`, `X-Kirim-Timestamp` (detik Unix, toleransi 5 menit), `X-Kirim-Signature` = hex HMAC-SHA256(rahasia, `timestamp + "." + body mentah`). Event: `message.status` (pesan nomor ini), `message.received`, `message.sent`, `device.status`. Jawab `2xx` dalam 10 detik; selain itu diulang 30 detik, 1, 2, 4 … menit sampai 1 jam, maksimum 8 percobaan. Contoh verifikasi Node dan PHP ada di halaman dokumentasi publik.

## 5. Kuota dan batas laju

| Batas | Nilai |
| --- | --- |
| Kuota harian gerbang (semua nomor luar bersama, semua jenis) | bawaan 500 pesan per hari WIB; diatur pengelola Kirim pada pemakai `aplikasi-luar` (asumsi DRAFT: kuota bersama, bukan per nomor) |
| Laju per nomor | bawaan 10 pesan per menit; jeda acak 2–6 detik |
| Jam kirim `notifikasi` | bawaan 06.00–21.00 WIB per nomor; `kode` kapan saja |
| Ulang kirim bila mesin gagal | 1, 5, 30 menit lalu `gagal` |
| Teks, ref, media | 1–4096 karakter; ≤ 200 karakter; PDF/JPEG/PNG ≤ 5 MiB |

## 6. Kode galat

| HTTP | `code` | Arti |
| --- | --- | --- |
| 400 | `invalid_request` | Body tidak sesuai skema (`fields`), termasuk field `device` dari kunci API |
| 400 | `idempotency_key_required` | Header tidak ada atau bukan 1–200 karakter |
| 401 | `unauthenticated` | Kunci tidak ada, tidak dikenal, diputar ulang, atau dicabut |
| 403 | `consumer_unknown` | Gerbang dinonaktifkan pengelola, atau token Keycloak mencoba bertindak sebagai gerbang |
| 403 | `api_key_not_allowed` | Endpoint percakapan/grup/bisnis |
| 403 | `not_owner` | Opt-out cakupan `device` untuk nomor lain |
| 404 | `not_found` | Pesan atau opt-out bukan milik nomor ini |
| 409 | `idempotency_key_conflict` | Kunci idempotensi sama, isi berbeda |
| 413 | `body_too_large` | Body melewati batas |
| 422 | `device_not_connected`, `device_inactive`, `invalid_number`, `optout`, `quota_exceeded`, `media_invalid`, `webhook_url_invalid` | Seperti KIRIM-IMPL-001 §5.3 |

`error_code` pada `gagal`: `optout`, `route_denied`, `quota_exceeded`, `device_inactive`, `invalid_number`, `media_invalid`, `expired`, `engine_unavailable`, `engine_rejected`, `engine_conflict`, `cancelled`.

## 7. Contoh integrasi OTP minimal (Node)

```js
async function kirimOtp(nomor, kode, idPermintaan) {
  const res = await fetch(`${process.env.KIRIM_BASE_URL}/internal/kirim/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.KIRIM_API_KEY}`, 'Idempotency-Key': `otp:${idPermintaan}` },
    body: JSON.stringify({ jenis: 'kode', to: nomor, text: `Kode masuk Anda: ${kode}. Berlaku 10 menit.`, ref: `otp:${idPermintaan}` }),
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 202) return (await res.json()).id;
  const { error } = await res.json().catch(() => ({ error: null }));
  throw new Error(error?.code ?? `KIRIM_${res.status}`);
}
```

Implementasi Samijaya: `server/kirim-client.js` (env `WHATSAPP_PROVIDER=kirim`, `KIRIM_BASE_URL`, `KIRIM_API_KEY`), uji `tests/kirim-client-harness.js`.

## 8. Pemeriksaan cepat

1. `GET /sambungan` dengan kunci → `200` dan `nomor.status` `tersambung`. `401` → kunci salah, diputar ulang, atau dicabut; `belum_dipasang`/`terputus` berarti QR belum dipindai.
2. Kirim satu `kode` ke nomor sendiri; `GET /messages/:id` menjadi `terkirim` dalam beberapa detik (`dry_run: true` berarti nomor masih penyedia `log`).
3. Di panel Kirim, pop-up kartu menunjukkan "terakhir dipakai" pada kunci nomor itu.

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-11-24 | Alamat publik `https://kirim.sabilulquran.or.id/api/v1` aktif (kunci API saja, antrean sama). Nomor luar yang ternyata WhatsApp milik aplikasi lain bisa disambungkan ke nomor itu dengan kunci yang sama (KIRIM-IMPL-003 §17) |
| 2026-11-17 | Koreksi owner: kunci melekat pada nomor, bukan aplikasi; tidak ada pendaftaran aplikasi; kunci tampil di pop-up untuk disalin, diputar ulang, dicabut. Dokumentasi dua langkah |
| 2026-11-17 | Desain ulang: satu kartu generik "Aplikasi luar" dengan beberapa nomor, kunci API terbitan Kirim, dokumentasi publik `/dokumentasi-api` |
| 2026-11-16 | Dokumen pertama (client Keycloak, kartu per aplikasi luar); digantikan |
