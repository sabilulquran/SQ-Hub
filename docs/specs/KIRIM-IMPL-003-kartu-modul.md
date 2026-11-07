# KIRIM-IMPL-003 — Kirim SQ: kartu WhatsApp per modul dan akses otomatis

**Status:** ACCEPTED (permintaan Product Owner 2026-11-03, dijalankan di bawah aturan owner 2026-10-26/27: "jalan terus, keputusan teknis diambil agent dan dilaporkan"). Keputusan yang belum tertulis di dokumen lain dicatat di §10; yang berstatus `DRAFT` boleh diubah owner kapan saja tanpa migrasi.
**Produk:** SQ Hub — modul `kirim` (Kirim SQ)
**Owner produk:** Kepala HCM (`kirim_admin`)
**Tanggal:** 2026-11-03
**Depends on:**
- [KIRIM-IMPL-001](KIRIM-IMPL-001-r1-nomor-dan-kirim.md) dan [KIRIM-IMPL-002](KIRIM-IMPL-002-r2-api-percakapan.md): kontrak, data, enkripsi, worker tetap berlaku kecuali disebut lain di sini
- [ADR-0011](../architecture/adr/0011-kirim-sq-shared-whatsapp-capability.md) dengan amandemen 2026-10-19
- HUB-IMPL-002 (Application Registry), HUB-IMPL-009 (Application Access)
- Mockup layar: https://claude.ai/artifact/5jipYDznwVYnyzuXCvhfJ1 (privat milik owner)

## 1. Masalah

Permintaan owner, 3 November 2026:

> "harusnya modul yg memang bisa ada integrasi WA tuh ada cardnya, jadi kode dan yg lainnya tuh ngga perlu input manual. misalnya card Keuangan, kalau kosong cukup icon + tambah whatsapp. kalau sudah tersambung baru deh detailnya muncul."
>
> "dan ada pilihan disambung. misalnya hcis dan karir dipisah cardnya. tapi di kirim pas + tuh bisa scan nomor baru, atau sambung dengan nomor aktif yg ada di situ."

Keadaan sebelum spesifikasi ini:

| Langkah menyambungkan modul | Cara lama | Masalah |
| --- | --- | --- |
| Membuat nomor | Layar Nomor: ketik kode, label, pemilik, provider, tenant | Isian teknis manual |
| Mendaftarkan modul pemakai | CLI `kirim:admin consumer add --nama --client-id` oleh operator | Tidak ada di layar |
| Memberi izin kirim lewat nomor modul lain | CLI `kirim:admin route add` | Tidak ada di layar; tidak terlihat bahwa nomor dipakai bersama |
| Token modul | Mapper audience `sq-hub-kirim` ditambahkan owner di Keycloak per client, lalu secret client **disalin** ke `KIRIM_CLIENT_SECRET` final.env modul | Butuh kata sandi admin Keycloak untuk setiap modul baru; salinan secret kedua |
| Rahasia webhook | Dibuat operator, ditulis ke `KIRIM_CONSUMER_SECRET_<NAMA>` final.env Hub **dan** disalin ke `KIRIM_WEBHOOK_SECRET` final.env modul | Rahasia yang sama di dua berkas, disalin tangan |
| Nomor yang dipakai | `KIRIM_DEVICE=<kode>` di final.env modul | Kode diketik di final.env |

## 2. Hasil yang diinginkan

1. Halaman utama Kirim SQ (`/`) menjadi **WhatsApp modul**: satu kartu untuk setiap aplikasi di registry SQ Hub yang ditandai bisa memakai WhatsApp. HCIS dan Karir SQ punya kartu sendiri walaupun memakai nomor yang sama.
2. Kartu kosong: ikon modul, nama, dan tombol **+ Tambah WhatsApp** yang menawarkan:
   - **Sambungkan nomor baru**: Kirim SQ membuat nomornya sendiri (kode, label, provider, tenant) lalu langsung membuka pindai QR atau kode pairing. Nomor menjadi milik modul ini.
   - **Pakai nomor yang sudah aktif**: memilih dari daftar nomor aktif; modul ikut mengirim lewat nomor itu. Pilihan "boleh juga mengirim kode verifikasi" (bawaan mati).
3. Kartu tersambung: nomor tersamar, provider, antrean modul ini (antre, gagal hari ini), jam kirim, laju, status, dan:
   - kartu **pemilik nomor**: Pasang (bila belum tersambung), Ubah, Jeda/Lanjutkan antrean, Impor riwayat, Putuskan, Nonaktifkan, dan keterangan "Dipakai juga oleh …" bila nomornya dipakai modul lain;
   - kartu **pemakai nomor bersama**: keterangan "Memakai nomor milik …", Ubah (hanya izin kode verifikasi), dan **Putuskan dari <modul>**.
4. Tidak ada isian kode nomor, client id, atau secret di layar mana pun, dan **tidak ada kredensial Kirim yang disalin ke final.env aplikasi pemakai** (§6).

## 3. Data (migration `0013_kirim_module_cards.sql`, aditif)

| Tabel | Kolom baru | Isi |
| --- | --- | --- |
| `applications` | `machine_client_id` text null, unik bila terisi | Client credentials milik aplikasi itu sendiri untuk memanggil SQ Hub (pola `<app>-api` yang sudah ada: `hcis-api`, `karir-sq-api`, `spmb-api`, `keluarga-sq-api`). Bukan secret |
| `applications` | `whatsapp_capable` boolean, bawaan `false` | Aplikasi mendapat kartu di Kirim SQ. `CHECK (NOT whatsapp_capable OR machine_client_id IS NOT NULL)` |
| `kirim_consumers` | `application_key` text null, unik, FK `applications(application_key)` | Kartu milik pemakai ini |
| `kirim_consumers` | `nomor_device_id` uuid null, FK `kirim_devices` | Nomor yang dipakai modul bila permintaan kirim tidak menyebut `device` |
| `kirim_consumers` | `webhook_secret_enc` text null | Rahasia webhook yang dibuat Kirim SQ, terenkripsi dengan kunci data Kirim (AAD per baris, seperti kolom `_enc` lain) |

Constraint lama `kirim_consumers_check` (`webhook_url` dan `webhook_secret_ref` harus sama-sama ada) diganti: `webhook_url` butuh salah satu dari `webhook_secret_ref` atau `webhook_secret_enc`; `webhook_secret_ref` tetap butuh `webhook_url`.

**Isi awal (bagian dari migration, tanpa nilai yang ditulis keras):**

1. `kirim_consumers.application_key` diisi bila `nama` sama dengan `application_key`, atau dengan `application_key` tanpa akhiran `-sq` (`karir` → `karir-sq`). Production: `hcis`, `karir`, `spmb`, `keluarga`.
2. `applications.machine_client_id` dan `whatsapp_capable = true` diisi dari `kirim_consumers.client_id` yang tertaut. Aset SQ dan Kirim SQ tetap `false`.
3. `nomor_device_id`: nomor milik pemakai itu bila tepat satu dan tidak nonaktif; bila tidak ada, satu-satunya nomor yang punya rute untuknya. Production: HCIS → `hcis`, SPMB → `spmb`, Karir → `hcis`, Keluarga → `spmb`.

Tidak ada baris yang dihapus dan tidak ada rute yang diubah, jadi pengiriman Karir, SPMB, dan Keluarga berjalan seperti sebelumnya.

**Recovery plan:** dump database Hub sebelum migrasi (runbook rilis Hub). Migration berjalan dalam satu transaksi. Rollback aplikasi ke rilis sebelumnya aman: kolom baru diabaikan kode lama, dan constraint baru lebih longgar daripada yang lama hanya untuk baris yang memakai `webhook_secret_enc`. Kode lama yang membaca konsumen dengan `webhook_url` dan tanpa `webhook_secret_ref` menganggap rahasia kosong: webhook tidak dikirim tanpa tanda tangan, tetapi diulang lalu berakhir `habis` (event hilang bagi modul itu). Karena itu jangan memakai `PUT /sambungan/webhook` sebelum rilis ini dinyatakan stabil.

## 4. API admin baru (`/api/admin/kirim`, sesi `kirim-sq`, `kirim_admin`)

| Method + path | Fungsi |
| --- | --- |
| `GET /modules` | `modules[]`: `application_key`, `nama`, `peran` (`kosong`, `pemilik`, `pemakai`), `nomor` (bentuk `GET /devices`) bila tersambung, `jenis` yang diizinkan, `antrean` modul ini, `dipakai_juga_oleh[]`, `pemilik_nomor`. Ditambah `devices` dan `peringatan` seperti `GET /devices`; layar memakainya untuk pilihan "Pakai nomor yang sudah aktif" dan daftar "Nomor tanpa kartu modul" |
| `POST /modules/:app/nomor-baru` | Hanya untuk kartu kosong. Membuat/menautkan pemakai, membuat nomor dengan kode otomatis (`application_key` tanpa `-sq`; bila terpakai `-2`, `-3`, …), label "Nomor <nama aplikasi>", provider `jalurpesan` bila mesin terkonfigurasi (tenant = kode) atau `log` bila tidak. Mengisi `nomor_device_id`. Jawaban: kartu |
| `POST /modules/:app/pakai-nomor` | `{ device, kode_verifikasi }`. Nomor harus aktif dan bukan milik modul ini. Membuat rute `notifikasi` (dan `kode` bila dicentang; dicabut bila tidak), mengisi `nomor_device_id`. Dipakai juga oleh Ubah pada kartu pemakai |
| `POST /modules/:app/putuskan` | `{ alasan }`. **Pemakai:** rute modul ini ke nomor itu dihapus dan `nomor_device_id` dikosongkan; nomor tetap tersambung untuk pemiliknya. **Pemilik:** ditolak `409 nomor_dipakai_modul_lain` bila modul lain masih memakai nomor itu; bila tidak, sesi WhatsApp dilepas seperti `POST /devices/:kode/disconnect` dan kartu menampilkan "Pasang" lagi |

Perubahan perilaku endpoint lama:

- Menonaktifkan nomor mengosongkan kartu pemiliknya, sehingga "+ Tambah WhatsApp" muncul lagi.
- `POST /devices/:kode/disconnect` dan `/deactivate` ditolak `409 nomor_dipakai_modul_lain` bila nomor dipakai modul selain pemiliknya (rute atau `nomor_device_id`). Menghentikan semua pengiriman darurat tetap bisa lewat **Jeda antrean**, yang berlaku untuk semua modul di nomor itu dan bisa dibatalkan.
- `POST /devices` tetap ada untuk uji dan pemulihan, tetapi layar tidak lagi menampilkan form "Tambah nomor". Nomor yang tidak dipegang kartu mana pun tetap tampil di bawah kartu sebagai "Nomor tanpa kartu modul".
- Mengganti pemilik nomor lewat Ubah memindahkan kartu: kartu pemilik baru menampilkan nomor itu, kartu pemilik lama dikosongkan kecuali ia masih punya rute ke nomor itu.

Setiap perubahan menulis `kirim_audit` (`kartu.nomor_baru`, `kartu.pakai_nomor`, `kartu.putuskan`).

## 5. API pemakai (`/internal/kirim`, loopback)

- `POST /messages` dan `POST /media`: `device` **opsional**. Tanpa `device`, Kirim SQ memakai `nomor_device_id` modul itu; bila kosong → `422 device_not_connected` ("Modul ini belum tersambung ke WhatsApp. Sambungkan di kartu modul di Kirim SQ."). Dengan `device`, perilaku lama berlaku (aturan rute tidak berubah).
- `GET /sambungan` → `{ modul, nomor: { kode, status, nomor_tersamar, peran } | null, jenis: [...], webhook: { url, secret } | null }`. Modul tahu nomor dan rahasia webhooknya tanpa membaca final.env.
- `PUT /sambungan/webhook` `{ url }` → modul mendaftarkan alamat webhooknya sendiri, hanya pada path tetap `/internal/kirim/webhook` (atau `/api/internal/kirim/webhook`) di `http://127.0.0.1:<port>` atau `https://*.sabilulquran.or.id`, tanpa query. Batas path ini mencegah secret mesin yang bocor dipakai mengarahkan POST bertanda tangan ke layanan loopback lain. Operator tetap memakai aturan D-4 lewat CLI. Bila belum ada rahasia, Kirim SQ membuat 32 byte acak dan menyimpannya terenkripsi. Jawaban sama dengan `GET`.
- Penanda tangan webhook memakai `webhook_secret_enc` bila ada, lalu `webhook_secret_ref` (env) bila tidak.
- Token dari client yang terdaftar sebagai `machine_client_id` aplikasi `whatsapp_capable` yang aktif tetapi belum punya baris pemakai: baris pemakai dibuat otomatis (nama dari kunci aplikasi), lalu `GET /sambungan` menjawab `nomor: null` dan `POST /messages` tanpa `device` menjawab `422 device_not_connected` sampai kartunya disambungkan. Client lain tetap `403 consumer_unknown`.

## 6. Akses otomatis tanpa salin kredensial

| Kebutuhan | Cara baru |
| --- | --- |
| Identitas modul | Client credentials **milik modul sendiri** yang sudah ada di final.env-nya untuk memanggil SQ Hub (`SQ_HUB_MACHINE_CLIENT_ID/SECRET` atau padanannya). Tidak ada client atau secret baru |
| Audience token | Kirim SQ menerima audience `sq-hub-kirim` **atau** audience mesin SQ Hub `sq-hub-api` (`KIRIM_TOKEN_AUDIENCE=sq-hub-kirim,sq-hub-api`). Client `<app>-api` sudah memegang `sq-hub-api`, jadi modul baru tidak butuh mapper Keycloak dan tidak butuh kata sandi admin Keycloak (keputusan K-1, §10) |
| Izin kirim | Diputuskan di Kirim SQ, bukan di Keycloak: token yang masuk lewat audience `sq-hub-api` harus token service account (klaim `client_id` = `azp`; token pengguna ditolak). Token dengan audience `sq-hub-kirim` dikecualikan karena audience itu hanya dipasang owner per client service account; `spmb-api` dan `keluarga-sq-api` (diperiksa 2026-11-03) tidak membawa klaim `client_id`, client harus `machine_client_id` aplikasi di registry **saat ini** (aplikasi `active` dan `whatsapp_capable`; mengganti client di registry langsung memutus client lama), pemakai `aktif`, dan kartunya tersambung (`nomor_device_id` atau rute) |
| Nomor | Dari kartu (`nomor_device_id`); modul tidak lagi mengirim `device` |
| Rahasia webhook | Dibuat dan disimpan Kirim SQ; modul membacanya lewat `GET /sambungan` dengan tokennya sendiri |

Yang tetap ditulis di final.env modul hanya alamat non-rahasia (`KIRIM_BASE_URL`, bila tidak diturunkan dari alamat SQ Hub yang sudah ada) dan saklar adapter.

Batas yang tetap berlaku: rute `/internal/kirim/*` hanya loopback dan diblokir di edge; staf tidak pernah memegang token ini; `kirim_admin` tidak membaca isi chat.

Tidak ada client Keycloak baru, jadi tidak ada service account baru untuk daftar FGAP deny D-DRIFT-1.

## 7. Migrasi keadaan production

| Modul | Sebelum | Sesudah rilis Hub | Langkah lanjutan di modul |
| --- | --- | --- | --- |
| HCIS | Pemakai `hcis` (client `hcis-api`) memiliki nomor `hcis`; HCIS belum mengirim | Kartu HCIS: pemilik, "Dipakai juga oleh Karir SQ" | HCIS-side §8 |
| Karir SQ | Rute `notifikasi` + `kode` ke `hcis`; `KIRIM_DEVICE=hcis`, `KIRIM_WEBHOOK_SECRET`, `KIRIM_CLIENT_SECRET` di final.env | Kartu Karir: pemakai nomor `hcis`, kode diizinkan. Tetap jalan dengan konfigurasi lamanya | Adapter Karir membaca `GET /sambungan`, lalu tiga kunci itu dihapus (tindak lanjut di repo Karir) |
| SPMB SQ | Pemilik `spmb`; rute `kode` ke `spmb`; tiga kunci di final.env | Kartu SPMB: pemilik, "Dipakai juga oleh Keluarga" | Sama, di repo SPMB |
| Keluarga | Rute `kode` ke `spmb`; tanpa webhook | Kartu Keluarga: pemakai nomor `spmb`, kode saja | Sama, di repo Keluarga |

Saat rilis, operator menjalankan `kirim:admin consumer import-secret --nama karir --reason …` dan `--nama spmb`: rahasia webhook dari env Hub disalin **oleh proses Hub** ke `webhook_secret_enc` (nilai sama, tidak dicetak), sehingga `GET /sambungan` menyerahkan rahasia yang sama dengan yang sudah dipegang Karir dan SPMB. Sesudah semua modul membaca dari `GET /sambungan`, `KIRIM_CONSUMER_SECRET_*` boleh dihapus dari final.env Hub.

## 8. Konsumen pertama: HCIS

Aplikasi HCIS dipindah dari adapter `log` ke `kirim` dengan mekanisme §6 (perubahan di repo HCIS, spec `docs/domain/meeting-calendar.md` §9.2 dan I-10):

- token dengan `SQ_HUB_MACHINE_CLIENT_ID/SECRET` yang sudah ada, endpoint token diturunkan dari `OIDC_ISSUER`, alamat Kirim dari asal `SQ_HUB_APPLICATION_ACCESS_URL`; `device` tidak dikirim;
- **pengaman uji coba**: selama HCIS belum live ke staf, pesan sungguhan hanya dikirim ke nomor di `WHATSAPP_ALLOWLIST` (hanya nomor owner). Nomor lain dicatat `SKIPPED` dengan alasan `not_allowlisted`, tanpa panggilan ke Kirim SQ. Satu saklar mencabutnya: `WHATSAPP_RECIPIENT_MODE=all` (bawaan `allowlist`).

## 9. Uji

- Migration: isi awal menautkan pemakai lama dengan benar; dijalankan dua kali tetap sama; kartu aplikasi tanpa pemakai kosong.
- Admin: daftar kartu (kosong, pemilik, pemakai, dipakai bersama); nomor baru membuat kode otomatis dan menolak kartu yang sudah tersambung; pakai nomor menolak nomor nonaktif dan nomor milik sendiri; putuskan pemakai tidak menyentuh rute pemilik atau modul lain; putuskan/nonaktifkan pemilik ditolak `409` saat nomor dipakai bersama; audit tertulis.
- Pemakai: kirim tanpa `device` memakai nomor kartu; tanpa kartu → `422 device_not_connected`; token audience `sq-hub-api` diterima; client tak terdaftar → `403`; `GET`/`PUT /sambungan` membuat rahasia sekali, menolak URL di luar D-4, dan rahasia itu yang dipakai menandatangani webhook.
- Layar: kartu kosong, pemilik bersama, pemakai; dialog tambah dua pilihan; teks Putuskan untuk nomor bersama; lebar 390 px.

## 10. Keputusan

| # | Topik | Status | Keputusan |
| --- | --- | --- | --- |
| K-1 | Audience token pemakai | DIPUTUSKAN (agent, 2026-11-03, alasan teknis; owner boleh membalik lewat env tanpa rilis) | Terima `sq-hub-kirim` dan `sq-hub-api`. Izin per modul dijaga Kirim SQ lewat registry dan kartu. Alternatif: tetap `sq-hub-kirim` saja, dan setiap modul baru butuh owner menambah mapper Keycloak dengan kata sandi admin |
| K-2 | Daftar modul berkartu | DIPUTUSKAN | Dari registry: `applications.whatsapp_capable`. Aplikasi baru ditandai operator lewat `kirim:admin module set --app <key> --whatsapp true --machine-client <client>` saat didaftarkan (tercatat di `kirim_audit`) |
| K-3 | Putuskan pada nomor bersama | DIPUTUSKAN (aturan owner 3 Nov) | Putuskan di kartu pemakai hanya melepas modul itu. Pemilik tidak bisa memutus atau menonaktifkan nomor yang masih dipakai modul lain; lepaskan modul lain dulu atau pindahkan pemilik lewat Ubah. Darurat: Jeda antrean |
| K-4 | Izin kode verifikasi untuk pemakai nomor bersama | DRAFT | Bawaan mati; dicentang per kartu. Alasan: kode menembus jam kirim |
| K-5 | Satu modul satu nomor | DRAFT | Kartu menampilkan satu nomor. Rute lama ke nomor lain tetap berlaku tetapi tidak tampil di kartu |
| K-6 | Allowlist HCIS | DIPUTUSKAN (owner) | Hanya nomor owner sampai owner menyatakan go-live; saklar `WHATSAPP_RECIPIENT_MODE=all` |

## 11. Addendum 2026-11-05: Sambungkan ulang, peringatan Nonaktifkan, satu nomor per WhatsApp

**Status:** ACCEPTED (tugas dari sesi induk K3.2, 2026-11-05, di bawah aturan owner 2026-10-26/27). Keputusan agent yang belum tertulis di dokumen lain dicatat di §11.5.

### Kejadian yang memicu (2026-11-05 11.25–11.29 WIB)

1. Owner melepas tautan nomor SPMB di HP lalu mencoba memindai QR baru untuk nomor `spmb`. Pemindaian gagal karena JalurPesan sedang restart.
2. Owner menekan **Nonaktifkan**. Kartu SPMB kosong, lalu "+ Tambah WhatsApp → Sambungkan nomor baru" membuat nomor kedua `spmb-2` (audit `kartu.nomor_baru`, `nomor.provision spmb-2`) yang dipindai dengan WhatsApp yang sama.
3. Kartu dan rute SPMB serta Keluarga pindah ke `spmb-2`, sementara inbox SPMB membaca nomor `spmb`; pesan masuk berhenti.
4. Ops memperbaiki di database: `spmb.provider_ref` = `spmb-2` (tenant JalurPesan yang memegang sesi), kartu dan rute kembali ke `spmb`, baris ganda dihapus (audit `nomor.gabung_duplikat`, `nomor.hapus_duplikat`). Cursor event JalurPesan global, jadi mengganti `provider_ref` aman.

Akar masalah: layar tidak punya cara memindai ulang nomor yang sudah ada, **Pasang** gagal pada sesi yang perlu di-reset, Nonaktifkan tidak menjelaskan akibatnya, dan kartu bisa membuat nomor kedua untuk WhatsApp yang sama tanpa peringatan.

### 11.1 Sambungkan ulang

`POST /devices/:kode/sambung-ulang` `{ mode: "qr" | "kode", phone?, alasan, perangkat_baru?: false }`, `Cache-Control: no-store`.

- Berlaku untuk nomor `jalurpesan` berstatus `terputus`, `menunggu_pairing`, atau `tersambung`. `belum_dipasang` memakai **Pasang**; `nonaktif` → `422 device_inactive`; `log` → `409 pairing_not_applicable`. `alasan` wajib (memutus sesi yang mungkin masih berjalan).
- Kirim SQ memanggil JalurPesan `POST /device/reset` pada tenant nomor itu (menghapus kredensial dan identitas sesi lalu membuka sesi QR baru; juga jalan saat mesin meminta `recoveryAction: "reset"` dan saat HP sudah melepas tautan). Bila tenant tidak punya perangkat (`404`), perangkat disiapkan lagi di tenant yang sama (`PUT /device`). Lalu QR atau kode pairing diminta seperti Pasang.
- **Nomor yang sama tetap dipakai**: `kode`, percakapan, kartu modul, rute, dan antrean tidak berubah. Status menjadi `menunggu_pairing` (pemakai menerima `device.status`). Jawaban: `{ nomor, mode, qr | pairing_code }`; QR dan kode tidak disimpan, dicatat log, atau diaudit.
- `perangkat_baru: true` (pilihan lanjutan, "bila Sambungkan ulang biasa tetap gagal"): Kirim SQ memilih tenant `<kode>-2`, `-3`, … yang tidak dipakai nomor lain dan belum dikenal mesin, menyiapkannya, lalu mengganti `provider_ref` nomor yang sama di akhir transaksi, persis seperti perbaikan manual 5 November. Tenant lama dibiarkan di mesin (dibersihkan operator bila perlu).
- Mesin restart (`engine_unavailable`): server mencoba lagi dua kali (jeda 1,5 dan 3 detik); layar lalu mencoba lagi sendiri tiga kali dengan hitung mundur 15 detik dan teks "Mesin WhatsApp sedang dinyalakan ulang … Jangan Nonaktifkan nomor ini", lalu tombol **Coba lagi**. Pesan galat `engine_unavailable` di admin API menjadi "Mesin WhatsApp sedang tidak tersedia, mungkin sedang dinyalakan ulang. Tunggu sekitar satu menit lalu coba lagi." dan `session_reset_required` menunjuk ke Sambungkan ulang.
- Audit `nomor.sambung_ulang` (berhasil/gagal) dengan `mode`, `perangkat_baru`, `alasan`, `status_sebelumnya`, dan `tenant_lama`/`tenant_baru` bila berganti tenant.
- Layar: kartu pemilik dan "Nomor tanpa kartu modul" menampilkan **Pasang** hanya untuk `belum_dipasang`, dan **Sambungkan ulang** untuk tiga status di atas. Dialog menjelaskan bahwa tidak ada nomor baru yang dibuat dan memperingatkan bila nomor sedang tersambung.

### 11.2 Nonaktifkan memperingatkan dan meminta konfirmasi

- `GET /devices/:kode/pemakaian` → `{ kartu: [nama modul], rute: [{ modul, jenis }] }`: kartu yang `nomor_device_id`-nya nomor ini dan rute ke nomor ini, pemilik termasuk.
- `POST /devices/:kode/deactivate` `{ alasan, konfirmasi?: false }`. Aturan K-3 tetap lebih dulu (`409 nomor_dipakai_modul_lain` bila modul lain memakai nomor). Bila masih ada kartu atau rute (misalnya kartu pemiliknya sendiri) dan `konfirmasi` tidak `true` → `409 konfirmasi_diperlukan` dengan `dipakai` dan pesan yang menyarankan Sambungkan ulang. Audit `nomor.nonaktif` mencatat `dipakai`.
- Layar: dialog Nonaktifkan menampilkan kartu yang dikosongkan dan rute yang berhenti, tautan **Sambungkan ulang** ("WhatsApp-nya hanya terlepas atau gagal dipindai?"), dan kotak centang "Saya paham …" yang wajib dicentang sebelum tombol Nonaktifkan aktif.

### 11.3 Satu nomor Kirim per WhatsApp

Data (migration `0015_kirim_device_nomor_hmac.sql`, aditif): kolom `kirim_devices.nomor_hmac` = HMAC lookup Kirim dari `pn:+<digit>`, sama dengan HMAC nomor di `kirim_optouts`. Diisi saat status mesin dibaca dan, untuk nomor lama (termasuk nonaktif), dari `nomor_enc` saat Hub start. Nomor utuh tidak pernah keluar ke layar; yang dibandingkan hanya HMAC. Kolom `kirim_events.provider_ref` mencatat tenant setiap event (baris lama diisi tenant nomornya saat ini, jadi cursor production tidak bergeser): nomor mesin menomori event lintas semua tenant, sehingga cursor tarik sebuah nomor adalah cursor tertinggi **dari tenant yang dipakainya sekarang**, dan nomor yang pindah tenant mulai dari 0 di tenant itu.

1. **Mencegah dari kartu.** `POST /modules/:app/nomor-baru` ditolak `409 nomor_modul_ada` (dengan daftar `nomor`) bila modul sudah memiliki nomor, nonaktif termasuk, kecuali `{ nomor_berbeda: true }`. Kartu membawa `nomor_lama[]` (nomor milik modul selain nomor kartunya). Dialog "+ Tambah WhatsApp" menaruh **Pakai nomor lama <modul>** di urutan pertama dan terpilih; **Sambungkan nomor baru** baru aktif setelah admin mencentang "WhatsApp yang akan dipindai berbeda dari …". Audit `kartu.nomor_baru` mencatat `nomor_berbeda_dari`.
2. **Pakai nomor lama.** `POST /modules/:app/pakai-nomor-lama` `{ device }`: hanya nomor milik modul itu (`422 nomor_bukan_milik_modul`). Nomor nonaktif menjadi `terputus` (`log` → `tersambung`) dengan percakapan, rute, dan tenant yang sama; kartu menautkannya lagi; layar langsung membuka Sambungkan ulang bila belum tersambung. Audit `kartu.pakai_nomor_lama`.
3. **Mendeteksi saat dipindai.** Nomor yang lebih baru, tertaut ke WhatsApp yang sama dengan nomor yang lebih dulu ada (status apa pun), dan **belum pernah menerima pesan masuk** **ditahan** (nomor yang sudah menerima pesan tidak pernah ditahan, supaya pasangan lama yang sudah berjalan tidak tiba-tiba berhenti; peringatan `nomor_sama` tetap tampil di status): event mesinnya tidak ditarik dan direktori grup/kontaknya tidak disegarkan, sehingga percakapan tidak terbelah; event menunggu di mesin. Kirim keluar tidak ditahan. `GET /devices/:kode/status` membawa `nomor_sama[]` (`kode`, `label`, `status`, `lebih_dulu`); `GET /devices` dan kartu membawa `nomor_ganda` per nomor dan `peringatan.nomor_ganda`. Dialog pemasangan dan kartu menampilkan peringatan dengan tombol **Pakai nomor yang ada**.
4. **Pakai nomor yang ada.** `POST /devices/:kode/pakai-nomor-yang-ada` `{ ke, alasan }`: `kode` = nomor ganda yang lebih baru, `ke` = nomor yang lebih dulu ada dengan HMAC sama (`409 nomor_tidak_sama` / `nomor_lebih_baru` bila tidak). Keduanya `jalurpesan` dan milik modul yang sama (`409 pemilik_berbeda`). Nomor ganda tidak boleh sudah punya percakapan, pesan, antrean, media, grup, impor, opt-out, atau foto (`409 nomor_sudah_berisi`, perlu operator). Dalam satu transaksi: event dan kartu/rute nomor ganda pindah ke `ke`, nomor ganda dihapus, `ke.provider_ref` diganti tenant nomor ganda, dan status `ke` mengikuti status nomor ganda. Event nomor ganda tetap bertanda tenantnya, jadi `ke` menarik event yang ditahan dari cursor tenant itu (0 bila belum ada), bukan dari cursor tenant lamanya. Audit `nomor.gabung_duplikat` (objek `ke`) dan `nomor.hapus_duplikat` (objek nomor ganda), nama aksi yang sama dengan perbaikan manual.
5. Perbaikan samping: kode nomor baru tidak boleh sama dengan tenant yang sudah dipegang nomor lain (setelah 5 November `spmb` memakai tenant `spmb-2`, jadi nomor baru SPMB berikutnya tidak boleh berkode `spmb-2`).

### 11.4 Uji

- Sambungkan ulang: kode, percakapan, kartu, dan rute sama sesudahnya; perubahan `provider_ref` bersamaan ditolak `409 conflict`; `/device/reset` dipanggil; 503 sekali dicoba lagi; mode kode pairing; tenant hilang disiapkan ulang; `perangkat_baru` memilih tenant bebas dan mengganti `provider_ref` saja; QR/kode tidak tersimpan.
- Nonaktifkan: `pemakaian`, `409 konfirmasi_diperlukan` tanpa konfirmasi dan tanpa perubahan/audit, berhasil dengan konfirmasi; K-3 tetap lebih dulu.
- Nomor ganda: kartu kosong menolak nomor baru tanpa `nomor_berbeda` dan tidak membuat baris; pakai nomor lama mengaktifkan nomor yang sama; nomor kedua dengan WhatsApp sama ditahan, pesan masuknya tidak masuk sebelum digabung dan masuk ke nomor lama sesudahnya walaupun nomor lama sudah mencatat cursor yang lebih tinggi di tenantnya; nomor yang sudah menerima pesan tidak ditahan; arah gabung yang salah dan nomor ganda yang sudah berisi ditolak.
- Layar: Pasang vs Sambungkan ulang per status, dialog sambung ulang (alasan wajib, peringatan tersambung, coba lagi), peringatan Nonaktifkan, Tambah dengan nomor lama di depan, peringatan nomor ganda.

### 11.5 Keputusan

| # | Topik | Status | Keputusan |
| --- | --- | --- | --- |
| K-7 | Nonaktifkan pada nomor yang dipakai kartu pemiliknya sendiri | DIPUTUSKAN (agent, permintaan sesi induk) | Boleh, setelah peringatan dan centang konfirmasi. K-3 untuk modul lain tidak berubah |
| K-8 | Nomor ganda yang sudah menyimpan percakapan atau antrean | DRAFT | Tidak digabung dari layar; operator memindahkan data dengan dry-run seperti 5 November. Alasan: memindahkan percakapan yang bentrok butuh aturan gabung riwayat yang belum ada. Batas yang diketahui: kirim keluar tidak ditahan, jadi bila kartu sudah mengirim lewat nomor ganda (nomor baru yang dibuat dengan `nomor_berbeda`), penggabungan dari layar ditolak `nomor_sudah_berisi`; status kirim nomor yang ditahan juga baru masuk setelah digabung. Karena itu pencegahan di kartu (§11.3 butir 1) adalah pengaman utamanya |
| K-9 | Tenant lama setelah `perangkat_baru` atau gabung | DRAFT | Dibiarkan di mesin; operator menghapusnya bila perlu. Kirim SQ tidak menghapus perangkat mesin otomatis |
| K-10 | Coba ulang saat mesin restart | DRAFT | Server 2× (1,5 dan 3 detik), layar 3× tiap 15 detik. Watchdog JalurPesan biasanya pulih dalam ±1 menit |

**Recovery plan:** dump database Hub sebelum migrasi (runbook rilis). Migration 0015 aditif dan berjalan dalam satu transaksi; rollback aplikasi ke rilis sebelumnya aman karena kode lama tidak membaca `nomor_hmac`. Nomor yang sedang ditahan pada rilis ini kembali ditarik normal oleh kode lama (perilaku sebelum addendum).

## 12. Addendum 2026-11-07: Ganti nomor WhatsApp dari kartu modul

**Status:** ACCEPTED (permintaan owner 2026-11-07, "kan kartu modul, bukan kartu nomor"). Keputusan agent dicatat di §12.4.

### Kejadian yang memicu (2026-11-07 12.12–12.13 WIB)

Owner ingin SPMB memakai nomor WhatsApp lain. Kartu SPMB tidak punya jalan untuk itu, jadi owner menempuh Putuskan Keluarga → Putuskan nomor SPMB (keluar dari WhatsApp) → Nonaktifkan → kartu kosong → **Pakai nomor yang sudah aktif** (satu-satunya nomor aktif: HCIS) untuk SPMB dan Keluarga. Akibatnya nomor SPMB nonaktif tanpa kartu, **Sambungkan ulang** hilang karena nomornya nonaktif, kotak masuk SPMB (yang membaca nomor `spmb`) tuli, dan kode SPMB keluar dari nomor HCIS. Ops mengembalikan `spmb` ke `terputus` (audit `nomor.aktif_lagi`) tanpa memindah kartu.

Akar masalah: layar memperlakukan pergantian WhatsApp sebagai pergantian **nomor Kirim**, padahal modul (dan kotak masuk SPMB yang memakai kode nomor tetap) membutuhkan nomor Kirim yang sama dengan WhatsApp yang berbeda. Mesin sudah bisa melakukannya lewat Sambungkan ulang (§11.1), tetapi tidak ditawarkan sebagai "ganti nomor".

### 12.1 Ganti nomor WhatsApp

- Kartu pemilik dengan nomor `jalurpesan` berstatus `terputus`, `menunggu_pairing`, atau `tersambung` menampilkan **Ganti nomor WhatsApp**.
- Tombol itu membuka dialog Sambungkan ulang dalam mode ganti: judul "Ganti nomor WhatsApp <modul>", alasan terisi "Ganti nomor WhatsApp" (boleh diubah), penjelasan bahwa kartu, kode nomor, riwayat percakapan, rute, dan antrean tetap, peringatan bahwa WhatsApp lama dilepas, pesan ke nomor lama tidak masuk lagi, dan nomor di brosur/situs/tautan wa.me diganti sendiri. Petunjuk pindai menyebut "HP dengan nomor WhatsApp yang baru".
- API tetap `POST /devices/:kode/sambung-ulang`, dengan field tambahan `ganti_nomor?: false` yang hanya dicatat di audit `nomor.sambung_ulang` (berhasil dan gagal). Pekerjaan mesinnya sama dengan Sambungkan ulang.
- Dialog Putuskan, Nonaktifkan, dan Ubah pada nomor milik sebuah kartu menampilkan "Mau memakai nomor WhatsApp lain untuk modul ini? **Ganti nomor WhatsApp** saja: kartu, percakapan, dan rutenya tetap."
- Teks Sambungkan ulang biasa menambahkan "Memindai dari HP lain berarti mengganti nomor WhatsApp-nya."

### 12.2 Kembali ke nomor sendiri dan pindah nomor pinjaman tanpa Putuskan

- `POST /modules/:app/pakai-nomor-lama` dan `POST /modules/:app/pakai-nomor`: bila kartu sedang memakai nomor **modul lain**, nomor itu dilepas dalam transaksi yang sama (rute modul ini ke nomor itu dihapus), lalu kartu menautkan nomor tujuan. Audit `kartu.pakai_nomor_lama` / `kartu.pakai_nomor` mencatat `dilepas: <kode>`. Kartu yang memakai nomornya **sendiri** tetap ditolak `409 kartu_sudah_tersambung`, dengan pesan yang menunjuk ke Ganti nomor WhatsApp.
- **Ubah** pada kartu pemakai menawarkan **Pakai nomor lama <modul>** (bila modul punya nomor) dan **Tetap memakai nomor modul lain** dengan pilihan semua nomor aktif yang bukan milik modul itu, nomor yang sedang dipakai di urutan pertama.
- Di "Nomor tanpa kartu modul", nomor yang dimiliki modul yang kartunya kosong atau sedang meminjam nomor lain menampilkan "Nomor milik <modul> …" dan **Pakai lagi untuk <modul>** (`pakai-nomor-lama`); dialognya menjelaskan modul belum bisa mengirim sampai dipindai, lalu Sambungkan ulang terbuka langsung bila nomor belum tersambung.

### 12.3 Uji

- Web: tombol Ganti nomor WhatsApp hanya pada kartu pemilik dengan status yang bisa disambung ulang; teks dialog mode ganti; petunjuk Ganti nomor di peringatan Nonaktifkan; Pakai lagi di daftar nomor tanpa kartu; Ubah kartu pemakai menawarkan nomor lama dan nomor aktif lain.
- API: kartu pemakai pindah ke nomor ketiga lalu kembali ke nomornya sendiri yang nonaktif tanpa Putuskan, rute nomor pinjaman terhapus, audit `dilepas`; kartu pemilik tetap ditolak; Sambungkan ulang dengan `ganti_nomor` mempertahankan kode, kartu, dan rute serta mencatat `ganti_nomor` di audit.

### 12.4 Keputusan

| # | Topik | Status | Keputusan |
| --- | --- | --- | --- |
| K-11 | Ganti WhatsApp sebuah modul | DIPUTUSKAN (agent, atas keluhan owner) | Memakai nomor Kirim yang sama (Sambungkan ulang), bukan nomor baru, supaya kode nomor yang dibaca modul (misalnya kotak masuk SPMB) dan riwayat percakapan tetap. Percakapan dari nomor lama dan nomor baru tercampur per kontak di nomor Kirim yang sama |
| K-12 | Nomor pinjaman saat kartu pindah | DIPUTUSKAN (agent) | Dilepas otomatis dalam satu transaksi; nomor milik sendiri tidak pernah dilepas otomatis |
| K-13 | Nomor publik modul (brosur, situs, tautan wa.me) setelah ganti | DRAFT | Diganti sendiri oleh admin modul; Kirim SQ hanya mengingatkan di dialog |

**Recovery plan:** tidak ada migration. Rollback aplikasi ke rilis sebelumnya aman: field `ganti_nomor` ditolak kode lama hanya bila layar baru masih terbuka (muat ulang halaman).

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-11-03 | Versi pertama atas permintaan owner; mockup dibagikan ke owner |
| 2026-11-03 | Review independen: token service account wajib, client mengikuti registry, kartu kosong saat nomor nonaktif, path webhook mandiri dibatasi |
| 2026-11-05 | §11: Sambungkan ulang, konfirmasi Nonaktifkan, satu nomor per WhatsApp (kejadian SPMB 5 November) |
| 2026-11-05 | Review independen §11: cursor event per tenant (`kirim_events.provider_ref`), penahanan hanya untuk nomor tanpa pesan masuk, cek `provider_ref` bersamaan di Sambungkan ulang, batas gabung dicatat di K-8 |
| 2026-11-07 | §12: Ganti nomor WhatsApp dari kartu modul, kembali ke nomor sendiri dan pindah nomor pinjaman tanpa Putuskan (kejadian SPMB 7 November) |
