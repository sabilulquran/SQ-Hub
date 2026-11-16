# Panduan gerbang API WhatsApp lewat Kirim untuk aplikasi luar

**Status:** BERLAKU sejak 2026-11-17 (keputusan owner 2026-11-16 dan 2026-11-17; amandemen ADR-0011 2026-11-17). Menggantikan versi 2026-11-16 yang memakai client Keycloak dan kartu per aplikasi.
**Untuk siapa:** developer portal atau aplikasi di luar SQ Suite yang ingin mengirim WhatsApp lewat nomor yayasan, dan pengelola Kirim yang menyiapkannya. Versi untuk developer yang bisa dibuka tanpa login: **https://kirim.sabilulquran.or.id/dokumentasi-api** (halaman yang sama dengan tautan "Dokumentasi API" di panel Kirim).
**Contoh pertama:** Samijaya (toko online, berjalan di Mi8 port 3100) mengirim kode OTP admin dan notifikasi pesanan lewat Kirim.
**Rujukan teknis:** [KIRIM-IMPL-001](../specs/KIRIM-IMPL-001-r1-nomor-dan-kirim.md) (kirim, status, webhook), [KIRIM-IMPL-003](../specs/KIRIM-IMPL-003-kartu-modul.md) (kartu), [desain Kirim](../product/kirim-sq-module-design.md), [ADR-0011](../architecture/adr/0011-kirim-sq-shared-whatsapp-capability.md), istilah [STRUKTUR-001](../product/struktur-sq-suite.md).

## 1. Gambaran

Kirim adalah aplikasi WhatsApp di SQ Suite. Mesin pengirimnya (JalurPesan) tidak pernah dipanggil langsung; aplikasi bicara ke **API Kirim**, dan Kirim yang mengurus nomor, antrean, batas laju, jam kirim, daftar jangan hubungi, status terkirim, penyimpanan percakapan, dan audit.

Untuk aplikasi **di luar SQ Suite**, Kirim menjadi gerbang API dengan aturan ini:

- Di panel Kirim ada **satu kartu generik "Aplikasi luar"** (keterangan: *Portal atau aplikasi di luar Sabilul Qur'an Suite yang memakai API*; nama dan keterangan ini asumsi DRAFT, owner boleh mengganti). Kartu itu **menampung beberapa nomor**. Muka kartu tidak pernah menyebut nama aplikasi mana pun; tidak ada kartu per aplikasi dan tidak ada kartu per nomor.
- Setiap aplikasi luar memegang **kunci API terbitan Kirim** (`krm_…`), dibuat pengelola di pop-up kartu, **terikat ke satu nomor** di kartu itu, ditampilkan sekali, disimpan sebagai hash berkunci, dan **bisa dicabut tanpa memutus nomor**. Tidak ada client Keycloak, tidak ada token yang perlu diperbarui.
- Aplikasi mengirim **tanpa menyebut nomor**; Kirim memakai nomor yang terikat pada kuncinya. Nama aplikasi hanya tampil di dalam pop-up, di samping kuncinya.
- API Kirim hanya bisa dicapai dari **loopback host yang sama** (`http://127.0.0.1:3302`). Edge publik menjawab `404` untuk semua `/internal/*`. Alamat publik `https://kirim.sabilulquran.or.id/api/v1` untuk aplikasi di hosting lain adalah rancangan (DRAFT), belum aktif.

Aplikasi di dalam SQ Suite tetap memakai jalur lama: registry Pusat Admin, kartu per aplikasi, dan token Keycloak (KIRIM-IMPL-003). Jenis aplikasi "Aplikasi luar" di Pusat Admin hanya label; aplikasi luar tidak mendapat kartu sendiri dan tidak memakai sakelar WhatsApp di sana.

## 2. Langkah pengelola Kirim

Semua lewat GUI di `kirim.sabilulquran.or.id`, halaman **Aplikasi**, kartu **Aplikasi luar** → **Kelola nomor dan kunci**.

1. **Sambungkan nomor baru.** Kirim membuat nomor baru milik kartu (kode `luar`, `luar-2`, …; label "Aplikasi luar", "Aplikasi luar 2", …) dan langsung membuka pemasangan: pindai QR dari HP nomor yang akan dipakai aplikasi itu. Nomor yang sudah ada di kartu bisa dipasang ulang, disambungkan ulang, atau diputus dari pop-up yang sama; rutenya sama seperti nomor aplikasi lain (jam kirim, laju, jeda antrean diatur di nomor itu).
2. **Buat kunci.** Isi *Nama aplikasi pemakai* (misalnya "Samijaya"), pilih nomornya, tekan **Buat kunci**. Kunci `krm_…` tampil **satu kali** dengan tombol salin; serahkan ke developer aplikasi lewat jalur aman (bukan chat atau tiket). Setelah ditutup, hanya awalannya (`krm_xxxxxxxx…`) yang terlihat.
3. **Cabut** bila kunci bocor atau aplikasi berhenti: tekan **Cabut** pada kuncinya dan tulis alasannya. Aplikasi itu langsung ditolak (`401`); nomor dan kunci lain tetap jalan. Terbitkan kunci baru bila perlu.

Jalur CLI tidak diperlukan. Audit Kirim mencatat `gerbang.nomor_baru`, `gerbang.kunci_buat`, `gerbang.kunci_cabut`, dan `gerbang.webhook` (tanpa nilai kunci).

## 3. Yang disiapkan di aplikasi

```sh
KIRIM_BASE_URL=http://127.0.0.1:3302
KIRIM_API_KEY=<kunci krm_… dari kartu Aplikasi luar>
```

Kunci API setara kata sandi: simpan di berkas env server (mode 600), bukan di kode frontend, repositori, log, atau chat.

## 4. Autentikasi

Setiap permintaan ke `http://127.0.0.1:3302/internal/kirim/*` membawa `Authorization: Bearer <kunci>`. Kirim mencari hash kuncinya; kunci yang tidak dikenal atau sudah dicabut dijawab `401 unauthenticated`, gerbang yang dinonaktifkan pengelola dijawab `403 consumer_unknown`. Token Keycloak tidak pernah bisa bertindak sebagai gerbang.

`Idempotency-Key` wajib di `POST /messages` dan berlaku **per kunci**: dua aplikasi boleh memakai nilai yang sama tanpa bentrok.

## 5. Endpoint yang tersedia untuk kunci API

Jawaban galat selalu `{ "error": { "code", "message", "fields"? } }`.

| Method dan path | Fungsi |
| --- | --- |
| `GET /sambungan` | Nomor yang terikat pada kunci, jenis yang boleh dikirim, webhook nomor itu |
| `PUT /sambungan/webhook` | Mendaftarkan alamat webhook untuk nomor kunci ini |
| `POST /messages` | Kirim teks atau media. Wajib `Idempotency-Key`; field `device` **tidak boleh** dikirim (400) |
| `GET /messages/:id` | Status pesan yang dikirim lewat nomor kunci ini |
| `POST /media` | Unggah PDF/JPEG/PNG sampai 5 MiB (tanpa field `device`) |
| `POST /optouts`, `DELETE /optouts` | Jangan hubungi, cakupan `consumer` atau `device` (hanya nomor kunci ini) |

Endpoint percakapan, grup, aksi pesan, foto profil, dan profil bisnis **tidak** tersedia untuk kunci API (`403 api_key_not_allowed`); itu milik aplikasi SQ Suite pemilik nomor.

### 5.1 Membaca sambungan

```sh
curl -s "$KIRIM_BASE_URL/internal/kirim/sambungan" -H "Authorization: Bearer $KIRIM_API_KEY"
```

```json
{ "aplikasi": "Samijaya", "nomor": { "kode": "luar", "status": "tersambung", "nomor_tersamar": "+62 851-••••-2504" }, "jenis": ["notifikasi", "kode"], "webhook": null }
```

### 5.2 Mengirim teks

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

Ulangi `POST` hanya bila tidak mendapat `202` (5xx, timeout, jaringan), dengan kunci yang **sama**; kunci sama dengan isi berbeda dijawab `409 idempotency_key_conflict`. Setelah `202`, kegagalan datang lewat status atau webhook.

### 5.3 Media, status, jangan hubungi

Sama dengan API aplikasi SQ Suite (KIRIM-IMPL-001 §5.4, §6.1; KIRIM-IMPL-002 §8), tanpa field `device`:

```sh
curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/media" -H "Authorization: Bearer $KIRIM_API_KEY" -F "file=@struk.pdf;type=application/pdf"
curl -s "$KIRIM_BASE_URL/internal/kirim/messages/<id>" -H "Authorization: Bearer $KIRIM_API_KEY"
curl -s -X POST "$KIRIM_BASE_URL/internal/kirim/optouts" -H "Authorization: Bearer $KIRIM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "nomor": "+6281234567890", "cakupan": "consumer", "alasan": "Minta berhenti lewat chat 2026-11-17" }'
```

Status: `antre` → `diserahkan` → `terkirim` → `dibaca`, atau `gagal` (dengan `error_code`) / `dibatalkan`. `GET /messages/:id` hanya melihat pesan yang dikirim lewat nomor kunci itu.

### 5.4 Webhook

Webhook terdaftar **per nomor** di kartu Aplikasi luar (asumsi DRAFT: satu nomor untuk satu aplikasi luar). Alamat boleh `https://<host>/…` mana pun atau `http://127.0.0.1:<port>/…`, tanpa kredensial di URL. Kirim membuat rahasia 32 byte sekali dan menyimpannya terenkripsi; aplikasi membacanya dari jawaban.

```sh
curl -s -X PUT "$KIRIM_BASE_URL/internal/kirim/sambungan/webhook" -H "Authorization: Bearer $KIRIM_API_KEY" -H "Content-Type: application/json" \
  -d '{ "url": "http://127.0.0.1:3100/internal/kirim/webhook" }'
# → { …, "webhook": { "url": "…", "secret": "…" } }
```

Header tiap event: `X-Kirim-Event-Id`, `X-Kirim-Timestamp` (detik Unix, toleransi 5 menit), `X-Kirim-Signature` = hex HMAC-SHA256(rahasia, `timestamp + "." + body mentah`). Event: `message.status` (pesan kunci ini), `message.received`, `message.sent`, `device.status` untuk nomor itu. Jawab `2xx` dalam 10 detik; selain itu diulang 30 detik, 1, 2, 4 … menit sampai 1 jam, maksimum 8 percobaan. Contoh verifikasi Node dan PHP ada di halaman dokumentasi publik.

## 6. Kuota dan batas laju

| Batas | Nilai |
| --- | --- |
| Kuota harian gerbang (semua aplikasi luar bersama, semua jenis) | bawaan 500 pesan per hari WIB; diatur pengelola Kirim pada pemakai `aplikasi-luar` (asumsi DRAFT: kuota bersama, bukan per kunci) |
| Laju per nomor | bawaan 10 pesan per menit; jeda acak 2–6 detik |
| Jam kirim `notifikasi` | bawaan 06.00–21.00 WIB per nomor; `kode` kapan saja |
| Ulang kirim bila mesin gagal | 1, 5, 30 menit lalu `gagal` |
| Teks, ref, media | 1–4096 karakter; ≤ 200 karakter; PDF/JPEG/PNG ≤ 5 MiB |

## 7. Kode galat

| HTTP | `code` | Arti |
| --- | --- | --- |
| 400 | `invalid_request` | Body tidak sesuai skema (`fields`), termasuk field `device` dari kunci API |
| 400 | `idempotency_key_required` | Header tidak ada atau bukan 1–200 karakter |
| 401 | `unauthenticated` | Kunci tidak ada, tidak dikenal, atau dicabut |
| 403 | `consumer_unknown` | Gerbang dinonaktifkan pengelola, atau token Keycloak mencoba bertindak sebagai gerbang |
| 403 | `api_key_not_allowed` | Endpoint percakapan/grup/bisnis |
| 403 | `not_owner` | Opt-out cakupan `device` untuk nomor lain |
| 404 | `not_found` | Pesan atau opt-out bukan milik kunci ini |
| 409 | `idempotency_key_conflict` | Kunci sama, isi berbeda |
| 413 | `body_too_large` | Body melewati batas |
| 422 | `device_not_connected`, `device_inactive`, `invalid_number`, `optout`, `quota_exceeded`, `media_invalid`, `webhook_url_invalid` | Seperti KIRIM-IMPL-001 §5.3 |

`error_code` pada `gagal`: `optout`, `route_denied`, `quota_exceeded`, `device_inactive`, `invalid_number`, `media_invalid`, `expired`, `engine_unavailable`, `engine_rejected`, `engine_conflict`, `cancelled`.

## 8. Contoh integrasi OTP minimal (Node)

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

## 9. Pemeriksaan cepat

1. `GET /sambungan` dengan kunci → `200`, `aplikasi` = nama yang ditulis pengelola, `nomor.status` `tersambung`. `401` → kunci salah/dicabut; `nomor: null` tidak terjadi karena kunci selalu terikat nomor, tetapi `status` `belum_dipasang`/`terputus` berarti QR belum dipindai.
2. Kirim satu `kode` ke nomor sendiri; `GET /messages/:id` menjadi `terkirim` dalam beberapa detik (`dry_run: true` berarti nomor masih penyedia `log`).
3. Di panel Kirim, kartu Aplikasi luar menunjukkan jumlah nomor tersambung dan kunci aktif; pop-up menunjukkan "terakhir dipakai" pada kuncinya.

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-11-17 | Desain ulang: satu kartu generik "Aplikasi luar" dengan beberapa nomor, kunci API terbitan Kirim menggantikan client Keycloak, dokumentasi publik di `/dokumentasi-api`. Kartu per aplikasi luar (2026-11-16) dihapus atas keputusan owner |
| 2026-11-16 | Dokumen pertama (client Keycloak, kartu per aplikasi luar); digantikan |
