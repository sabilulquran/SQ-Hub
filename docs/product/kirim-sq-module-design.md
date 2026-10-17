# Kirim SQ — Desain modul

**Status:** DRAFT / DISCOVERY. Dokumen ini tidak mengizinkan implementasi atau perubahan production.
**Spesifikasi:** KIRIM-001 (belum ada spesifikasi implementasi)
**Tanggal:** 2026-10-17 (revisi 1)
**Terkait:** ADR-0001, ADR-0006, ADR-0010; SPMB SQ `sq-spmb/docs/product/module-design.md` (§6.8, §8), `sq-spmb/docs/specs/SPMB-IMPL-001-r0-fondasi-pengaturan-publik.md`; JalurPesan `jalurpesan.web.id/README.md`

## 1. Dasar

Kirim SQ adalah **jalur kirim WhatsApp milik yayasan** untuk semua aplikasi SQ Core. Kirim SQ hanya cangkangnya. Pengiriman sebenarnya dikerjakan oleh **mesin** yang bisa diganti. Untuk sementara mesinnya JalurPesan, gateway Baileys yang sudah berjalan di Mi8.

Keputusan Product Owner (2026-10-17):

1. Nama modul **Kirim SQ**.
2. Cangkang (data, aturan, riwayat) milik yayasan. Mesin (sesi WhatsApp, Baileys) **menumpang JalurPesan** sampai SQ Core punya server sendiri.
3. SQ Core **tidak memasang Baileys** sekarang. Mi8 hanya punya ~1 GiB MemAvailable, jadi proses Baileys kedua tidak sepadan.
4. Trial dengan **2 nomor**.
5. **Logika bisnis tetap di modul pemakai.** Kirim SQ mengelola device dan jalur kirim, bukan isi atau alur bisnis.

Kebutuhan lintas aplikasi sudah nyata (syarat ADR-0001):

| Pemakai | Kebutuhan | Sumber |
| --- | --- | --- |
| Keluarga SQ | Kode verifikasi dan pemulihan akun keluarga | ADR-0010 |
| SPMB | Notifikasi status, pengingat, tautan daftar; WA masuk menjadi Peminat; kelak inbox bersama | SPMB-001 §6.8, §8 |
| HCIS | Notifikasi pegawai (slip, cuti, presensi), undangan | Rencana |
| Karir SQ | Undangan tes/wawancara, status lamaran | Rencana |
| Keuangan | Tagihan dan kuitansi (PDF resmi) | Rencana |
| Media, Sosial | Pengumuman, informasi program, donatur | Rencana |

## 2. Batas tanggung jawab

| Urusan | **Kirim SQ** | **Modul pemakai** |
| --- | --- | --- |
| Device | Mendaftarkan nomor, pairing, status tersambung, peruntukan nomor | — |
| Pengiriman | Antrean, retry, batas laju per nomor, jam kirim aman, idempotensi | Menentukan **kapan** dan **kepada siapa** |
| Isi | Meneruskan teks atau dokumen yang sudah jadi | Menyusun isi, templat, dan PDF-nya sendiri |
| Status | Mencatat diterima mesin, terkirim, dibaca, gagal; memberi tahu pengirim | Menyimpan status di datanya (mis. "tagihan sudah dikirim") |
| Pesan masuk | Menerima dari mesin, meneruskan ke modul pemilik nomor | Mengolahnya (mis. SPMB membuat Peminat) |
| Kepatuhan | Daftar jangan-hubungi, log audit, kuota per pemakai | Persetujuan pemberitahuan yang khusus domain (mis. persetujuan prospek di Keluarga SQ) |

Yang **tidak** dibangun di Kirim SQ:

- templat dan isi pesan per domain;
- CRM, pipeline peminat, atau data kontak;
- broadcast massal ke grup atau daftar yang tidak punya hubungan dengan yayasan;
- penyimpanan isi percakapan lengkap (kecuali kelak inbox bersama, §9).

## 3. Letak dan arsitektur

### 3.1 Letak: modul di SQ Hub API

Kirim SQ dibangun sebagai **modul `kirim` di `apps/api` SQ Hub**, bukan aplikasi atau proses baru.

| Pertimbangan | Modul SQ Hub | Aplikasi sendiri |
| --- | --- | --- |
| Memori Mi8 | Tidak ada proses baru | Satu proses Node lagi (~80–120 MiB RSS) |
| ADR-0001 | Cocok: shared capability lintas domain | Juga boleh, tetapi bukan domain bisnis |
| Kemandirian rilis | Ikut rilis SQ Hub | Rilis sendiri |
| Pindah kelak | Bisa diekstrak karena tabel dan rute terpisah | — |

Konsekuensinya:

- Tabel memakai awalan `kirim_` di database SQ Hub, dan rute di bawah `/internal/kirim/*` dan `/api/admin/kirim/*`.
- Kode modul tidak mengimpor modul SQ Hub lain kecuali auth dan Application Access, supaya bisa diekstrak.
- Kalau SQ Hub sedang rilis atau mati, pemakai menyimpan permintaan di sisinya dan mengulang dengan kunci idempotensi yang sama (§5.1). Ini sesuai larangan "jangan membuat setiap request domain bergantung sinkron pada SQ Hub" di target architecture.

### 3.2 Alur

```text
HCIS / Karir / Keuangan / SPMB / Keluarga SQ
        │  POST /internal/kirim/messages  (token client credentials, Idempotency-Key)
        ▼
SQ Hub API ── modul kirim ── kirim_outbox (PostgreSQL)
        │                         │
        │   worker kirim (di proses SQ Hub API, interval pendek)
        ▼                         ▼
   Provider aktif:   log  |  jalurpesan  |  (kelak) jalurpesan-sendiri / meta-cloud
                                   │
                                   ▼
                     JalurPesan 127.0.0.1:3401  ── Baileys ── WhatsApp
                                   │
            webhook bertanda tangan + GET .../events?after= (pemulihan)
                                   ▼
        SQ Hub API: kirim_events → status ke outbox → webhook ke modul pemakai
```

### 3.3 Provider

Kontrak provider internal (satu antarmuka, beberapa adapter):

- `sendText(device, to, text, idempotencyKey)`
- `sendDocument(device, to, file, caption, idempotencyKey)`
- `deviceStatus(device)`, `startPairing(device)`
- `pullEvents(device, cursor)` untuk pemulihan

| Provider | Kegunaan | Catatan |
| --- | --- | --- |
| `log` | Development, staging, dan default sebelum nomor siap | Tidak mengirim; status langsung `sent` dengan penanda `dry_run` |
| `jalurpesan` | Trial dan produksi awal | Satu **platform** JalurPesan `sq-core`; setiap nomor Kirim SQ = satu **tenant** JalurPesan (`/api/v1/platform/tenants/:externalTenantId/...`) |
| `jalurpesan` instance sendiri | Saat SQ Core pindah server | Adapter sama, hanya URL dan kunci berbeda |
| `meta-cloud` | Kalau yayasan memakai WhatsApp Business Platform resmi | Butuh templat yang disetujui Meta untuk pesan di luar jendela 24 jam |

Provider dipilih **per device** di konfigurasi, bukan di kode, sehingga bisa dipindah tanpa rilis.

## 4. Data

| Tabel | Kolom utama | Catatan |
| --- | --- | --- |
| `kirim_devices` | `id`, `kode` (mis. `resmi`, `spmb`), `label`, `provider`, `provider_ref` (tenant JalurPesan), `nomor_tersamar`, `status` (`belum_dipasang`, `menunggu_pairing`, `tersambung`, `terputus`, `nonaktif`), `rate_per_menit`, `jam_kirim_mulai`, `jam_kirim_selesai`, `updated_at` | Nomor utuh tidak disimpan di luar kolom terenkripsi |
| `kirim_consumers` | `id`, `client_id` (Keycloak), `nama` (mis. `hcis`, `spmb`), `webhook_url`, `webhook_secret_ref`, `kuota_harian`, `aktif` | Satu baris per aplikasi pemakai |
| `kirim_routes` | `consumer_id`, `device_id`, `jenis` (`notifikasi`, `kode`, `percakapan`) | Aplikasi mana boleh memakai nomor mana, untuk jenis apa |
| `kirim_outbox` | `id`, `consumer_id`, `device_id`, `idempotency_key`, `jenis`, `prioritas`, `to_hmac`, `to_enc`, `body_enc` atau `media_ref`, `status` (`antre`, `diserahkan`, `terkirim`, `dibaca`, `gagal`, `dibatalkan`), `attempts`, `next_attempt_at`, `provider_message_id`, `error_code`, `created_at`, `expires_at` | Unik (`consumer_id`, `idempotency_key`) |
| `kirim_inbound` | `id`, `device_id`, `from_hmac`, `from_enc`, `nama_profil`, `cuplikan` (maks. 200 karakter), `provider_message_id`, `received_at`, `diteruskan_ke`, `diteruskan_at` | Isi lengkap tidak disimpan (§2) |
| `kirim_optouts` | `nomor_hmac`, `cakupan` (`semua` atau `consumer_id`), `alasan`, `created_at` | Diperiksa sebelum kirim, kecuali jenis `kode` |
| `kirim_events` | `id`, `device_id`, `provider_cursor`, `jenis`, `payload_ringkas`, `received_at` | Cursor pemulihan dari `GET .../events?after=` |
| `kirim_audit` | aktor, aksi, objek, waktu | Pairing, ganti provider, opt-out manual, putus device |

Retensi awal: isi pesan (`body_enc`) dihapus **30 hari** setelah status final, sedangkan metadata disimpan 1 tahun. Angka ini perlu persetujuan PO.

## 5. Kontrak untuk aplikasi pemakai

Autentikasi: token **client credentials** realm `sq-staff` (pola `spmb-api`), dengan audience `sq-hub-kirim`. Kirim SQ memetakan `client_id` ke `kirim_consumers`.

### 5.1 Kirim pesan

`POST /internal/kirim/messages` dengan header `Idempotency-Key`:

```json
{
  "device": "resmi",
  "jenis": "notifikasi",
  "to": "+6281234567890",
  "text": "Assalamu'alaikum ... tautan: https://hcis.sabilulquran.or.id/...",
  "dokumen": null,
  "prioritas": "normal",
  "kedaluwarsa": "2026-10-18T07:00:00+07:00",
  "ref": "hcis:leave-request:8f2c"
}
```

- Jawaban `202 Accepted` dengan `{ "id", "status": "antre" }`. Permintaan ulang dengan kunci yang sama mengembalikan pesan yang sama tanpa mengirim ulang.
- `dokumen`: unggah dulu lewat `POST /internal/kirim/media` (PDF, maks. 5 MiB), lalu sebut `media_id`. Kirim SQ tidak pernah mengambil URL luar.
- `jenis: "kode"` (OTP) memakai prioritas tertinggi, mengabaikan jam kirim aman dan opt-out, dan kedaluwarsa dalam 10 menit.
- Ditolak `422` bila nomor ada di daftar jangan-hubungi, rute tidak mengizinkan, atau kuota habis.

### 5.2 Status dan pesan masuk ke pemakai

Kirim SQ memanggil `webhook_url` pemakai dengan tanda tangan HMAC:

| Event | Isi |
| --- | --- |
| `message.status` | `id`, `ref`, `status`, `error_code` |
| `message.received` | `device`, `from`, `nama_profil`, `cuplikan`, `received_at` (hanya ke pemakai yang punya rute `percakapan` pada device itu) |
| `device.status` | `device`, `status` (agar pemakai bisa menampilkan "Nomor WhatsApp tidak tersambung") |

Pemakai juga bisa menarik status lewat `GET /internal/kirim/messages/:id`.

## 6. Pengiriman dan keselamatan nomor

- **Batas laju per device:** awal 10 pesan/menit dengan jeda acak 2–6 detik. Jenis `kode` boleh mendahului antrean.
- **Jam kirim aman** untuk `notifikasi`: 06.00–21.00 WIB. Pesan di luar jam itu ditahan sampai pagi kecuali `kedaluwarsa` lebih dulu.
- **Retry:** 3 kali dengan backoff (1, 5, 30 menit). Setelah itu status `gagal` dan pemakai diberi tahu.
- **Device terputus:** antrean berhenti untuk device itu, `device.status` dikirim ke pemakai, admin diberi peringatan. Pesan tidak dialihkan otomatis ke nomor lain.
- **Isi pesan:** setiap pesan sebaiknya membawa tautan ke aplikasi, bukan data sensitif utuh (mis. "Slip gaji Oktober sudah tersedia" + tautan, bukan nominal gaji).

## 7. Nomor untuk trial

| Device | Peruntukan | Pemakai | Jenis |
| --- | --- | --- | --- |
| `resmi` | Notifikasi resmi yayasan, sebagian besar satu arah | HCIS, Karir, Keuangan, Keluarga SQ (kode), Media, Sosial | `notifikasi`, `kode` |
| `spmb` | Nomor resmi SPMB, dua arah | SPMB | `notifikasi`, `kode` (sementara, ADR-0010), `percakapan` |

Kalau nomor `spmb` yang ramai percakapan diblokir, notifikasi gaji dan tagihan tetap jalan lewat `resmi`. Media atau Sosial mendapat nomor sendiri kalau volumenya sudah besar.

## 8. Layar admin

Kirim SQ tampil seperti aplikasi SQ Core lain:

- **Alamat:** `kirim.sabilulquran.or.id`, dilayani proses SQ Hub web dan API yang sudah ada (rute host di edge), jadi tetap tanpa proses baru. Subdomain baru dibutuhkan saat layar admin dibangun; API pemakai (`/internal/kirim/*`) hanya lewat loopback dan diblokir di edge.
- **Akses:** terdaftar di SQ Hub **Application Access** sebagai aplikasi "Kirim SQ". Tile di Launcher **hanya tampil bagi staf yang punya akses**.
- **Peran:**
  - `kirim_admin` (tim TI): semua layar di bawah.
  - `kirim_operator` (petugas bidang, opsional): melihat status nomor dan antrean milik aplikasinya saja, serta coba ulang kiriman gagal.

Layar untuk `kirim_admin`:

- **Nomor:** daftar device, status, tombol pairing (kode pairing atau QR dari mesin), putuskan, nonaktifkan, ganti provider.
- **Pemakai dan rute:** aplikasi mana boleh memakai nomor mana, kuota harian.
- **Antrean:** jumlah antre/gagal per device, coba ulang, batalkan.
- **Jangan hubungi:** tambah atau hapus nomor.
- **Aktivitas:** audit dan ringkasan harian per pemakai.

Isi pesan tidak ditampilkan di layar admin; hanya metadata dan nomor tersamar.

## 9. Kelak (bukan R1)

- **Inbox bersama** untuk SPMB (SPMB-001 §6.8): percakapan dua arah, banyak petugas, balas dari aplikasi. Ini butuh penyimpanan isi percakapan dan keputusan privasi tersendiri.
- Kanal lain (email) lewat kontrak yang sama.
- Pindah mesin: instance JalurPesan sendiri di server SQ Core, atau WhatsApp Business Platform resmi.

## 10. Pindah mesin (runbook ringkas)

1. Siapkan mesin baru dan provider-nya di staging dengan provider `log` lalu nomor uji.
2. Untuk setiap device: hentikan antrean, tunggu `diserahkan` = 0.
3. Ganti `provider` dan `provider_ref` device, lalu **pairing ulang** nomor (sesi WhatsApp tidak bisa dipindah).
4. Jalankan lagi antrean dan pantau status 24 jam.
5. Riwayat lama tetap ada di `kirim_outbox`; riwayat chat di mesin lama tidak ikut pindah.

Modul pemakai tidak berubah sama sekali.

## 11. Dampak pada dokumen lain

- **Semua modul pemakai** (SPMB, Keluarga SQ, HCIS, Karir, Keuangan, dan seterusnya): kirim WA lewat port sendiri (mis. `WhatsAppSender`) dengan dua adapter, `log` (default) dan `kirim` (HTTP ke kontrak §5). Modul pemakai **tidak** memanggil JalurPesan langsung dan tidak memasang Baileys. Selama Kirim SQ belum jalan, adapter `log` dipakai, sehingga pengembangan modul tidak menunggu Kirim SQ. Adapter langsung ke JalurPesan hanya boleh sebagai jalan darurat dengan persetujuan PO.
- **SPMB-IMPL-001:** port `WhatsAppSender` tetap, tetapi adapter JalurPesan langsung diganti adapter `log` + `kirim`. Pesan masuk ke nomor SPMB datang lewat webhook `message.received` dari Kirim SQ, bukan dari JalurPesan.
- **Keluarga SQ (KEL-IMPL-001):** relay kode `POST /internal/otp-deliveries` mengirim lewat Kirim SQ dengan `jenis: "kode"`.
- **ADR baru (ADR-0011):** Kirim SQ sebagai shared capability SQ Hub dengan mesin yang bisa diganti.

## 12. Operasional dan gate Mi8

- Tidak ada proses baru. Worker kirim berjalan di proses SQ Hub API; tambahan memori diperkirakan < 20 MiB.
- Beban tambahan ada di JalurPesan: perkiraan 30–80 MiB per nomor (belum diukur). Ukur RSS JalurPesan dan MemAvailable sebelum pairing dan selama 7 hari.
- **Batas berhenti:** MemAvailable rata-rata 7 hari < 900 MiB, atau RSS JalurPesan terus naik → hentikan penambahan nomor dan rencanakan pindah mesin.
- Backup: tabel `kirim_*` ikut dump database SQ Hub. Sesi WhatsApp ada di JalurPesan dan backup-nya belum konsisten (`CONSISTENCY_BLOCKED`); kalau Mi8 rusak, nomor dipairing ulang.

## 13. Pertanyaan terbuka

| # | Pertanyaan | Saran |
| --- | --- | --- |
| 1 | Kirim SQ sebagai modul SQ Hub atau aplikasi sendiri? | Modul SQ Hub (§3.1), demi memori Mi8 |
| 2 | Retensi isi pesan? | 30 hari setelah final; metadata 1 tahun |
| 3 | Siapa pemegang peran `kirim_admin`? | Admin SQ Core (tim TI), bukan per bidang; petugas bidang cukup `kirim_operator` |
| 7 | Kapan subdomain `kirim.sabilulquran.or.id` dibuat? | Saat layar admin dibangun; DNS ditambahkan pemilik akun Cloudflare yayasan |
| 4 | Nomor `resmi` memakai nomor apa? | Nomor baru khusus gateway, bukan nomor utama kantor |
| 5 | Siapa yang membangun lebih dulu: Kirim SQ atau SPMB R0? | Kirim SQ R1 kecil dulu (provider `log` + `jalurpesan`, tanpa inbox), supaya SPMB tidak perlu adapter langsung ke JalurPesan |
| 6 | Jam kirim aman 06.00–21.00 WIB? | Ya, kecuali jenis `kode` |

## Riwayat keputusan

| Tanggal | Keputusan |
| --- | --- |
| 2026-10-17 | Nama **Kirim SQ**. Cangkang milik yayasan; mesin menumpang JalurPesan; tidak memasang Baileys di SQ Core. |
| 2026-10-17 | Logika bisnis tetap di modul pemakai; Kirim SQ mengelola device dan jalur kirim. |
| 2026-10-17 | Trial 2 nomor: `resmi` dan `spmb`. |
| 2026-10-17 | Alamat `kirim.sabilulquran.or.id`; tampil di Launcher hanya bagi yang punya akses lewat Application Access. |
