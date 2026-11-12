# ORGAN-IMPL-001 — Portal Organ Yayasan

**Status:** ACCEPTED (Product Owner, 2026-11-12) bersama ADR-0012. Butir bertanda `DRAFT` adalah default agent yang menunggu konfirmasi. Implementasi belum dimulai.
**Arsitektur:** [ADR-0012](../architecture/adr/0012-portal-organ-yayasan.md)
**Menggantikan:** halaman Ringkasan Yayasan HUB-IMPL-021 §5 sebagai pintu masuk organ. Keanggotaan (§1), field registry (§2), kontrak ringkasan v1 (§3), dan perilaku fetch (§4) HUB-IMPL-021 tetap berlaku dan dipakai ulang.
**Terkait:** HUB-IMPL-021, HUB-IMPL-023; HCIS ORG-003, ORG-010, ORG-013, GOV-001

## Hasil yang dituju

Anggota Organ Yayasan membuka `organ.sabilulquran.or.id`, masuk dengan Akun SQ beserta verifikasi dua langkah, lalu:

1. melihat dasbor visual lintas aplikasi;
2. melihat apa yang menunggu keputusannya dan memutuskannya;
3. menerima laporan bulanan otomatis beserta catatan analisis.

Portal tidak memberi akses ke modul staf.

## Istilah

| Istilah | Arti |
|---|---|
| Portal | Aplikasi di `organ.sabilulquran.or.id`: route group terpisah di proses SQ Hub API, ditambah bundle web `apps/organ-web` (ADR-0012 D2) |
| Anggota efektif | Identitas dengan keanggotaan Organ Yayasan yang efektif (HUB-IMPL-021 §1) |
| Ringkasan | Respons kontrak governance summary v1 dari satu aplikasi |
| Snapshot bulanan | Ringkasan final satu bulan yang diterbitkan aplikasi asal setelah bulannya ditutup (R3) |
| Langkah keputusan | Satu langkah approval di aplikasi asal yang tersimpan atas nama anggota |

## Tahap

| Tahap | Isi | Prasyarat di luar SQ Hub |
|---|---|---|
| **R1** | Host, client, gerbang masuk, dasbor dari ringkasan yang sudah ada, daftar "Menunggu keputusan Anda" berupa tautan ke aplikasi asal, redirect `/yayasan` | Record DNS (owner), client Keycloak `sq-organ`, HCIS menerima `azp = sq-organ` pada `/governance/summary` (amandemen ORG-010) |
| **R2** | Memutuskan langsung di portal | HCIS: audience keputusan `hcis-organ-decision`, route keputusan dengan bearer bercakupan tulis (amandemen ORG-010 dan ORG-013-3) |
| **R3** | Laporan bulanan otomatis dan catatan analisis Claude | HCIS: endpoint snapshot bulanan dan penanda tutup bulan; kunci Anthropic API di environment Hub |

Setiap tahap dirilis terpisah dan bisa dikembalikan sendiri-sendiri.

## 1. Host dan masuk (R1)

### 1.1 Routing
- Hub API memilih route group dari header `Host`. `organ.sabilulquran.or.id` hanya melayani `/api/organ/*`, `/api/auth/*` milik portal, dan aset `apps/organ-web`. Host staf tidak melayani route portal, dan sebaliknya. Bila host tidak dikenal, jawabannya `421`.
- Edge (proxy Mi8VPS) meneruskan host portal ke Hub API dengan header `Host` aslinya. Record Cloudflare dibuat owner di akun Cloudflare yayasan.

### 1.2 Client dan sesi
- Client OIDC Keycloak `sq-organ` di realm staf: confidential, PKCE, redirect hanya ke `https://organ.sabilulquran.or.id/api/auth/callback`.
- Cookie sesi berlaku host-only di `organ.` dan terpisah dari cookie Hub. Masa berlakunya mengikuti sesi Hub.
- Akses masuk diatur dua lapis:
  - Akun SQ menolak orang tanpa Application Access ke portal. Registry mendapat aplikasi `organ`, dan Application Access-nya diberikan otomatis lewat formulir keanggotaan HUB-IMPL-021 §1.
  - Setelah callback, portal menolak identitas yang bukan anggota efektif dengan halaman "Portal ini khusus Organ Yayasan" dan tautan ke SQ Hub. Penolakan ini tidak membuat sesi.
- Verifikasi dua langkah wajib: callback menolak token tanpa bukti TOTP (`acr` / `amr` sesuai konfigurasi realm yang sudah dipakai Admin Center).

### 1.3 Redirect dari Hub
Bila `PORTAL_ORGAN_ENABLED=true`, `GET /yayasan` di Hub menjawab redirect `302` ke portal. Anggota yang juga staf tetap mendarat di Beranda Hub setelah login. Pendaratan langsung ke portal untuk anggota (HUB-IMPL-021 §5) dipindah ke portal.

## 2. Dasbor (R1)

- Data diambil dengan fetch HUB-IMPL-021 §4, yaitu token exchange per aplikasi atas nama pengguna, timeout 3 detik, cache memori paling lama 60 detik, dan tidak pernah ditulis ke database. Bedanya hanya `azp` = `sq-organ`.
- Tata letak mengikuti HUB-IMPL-021 §5: strip headline, bagian per aplikasi, "Perlu perhatian", "Lihat tabel" untuk setiap grafik, dan aturan nilai `null`. Bedanya:
  - tidak ada "Aplikasi Anda";
  - tidak ada launcher modul;
  - tautan "Lihat rincian" tetap mengarah ke aplikasi asal. Aplikasi asal tetap memeriksa izinnya sendiri. Untuk HCIS, rincian itu adalah `/board`.
- Grafik memakai lima jenis grafik dari kontrak v1. Donut hanya untuk `composition` dengan 2–4 bagian. Selebihnya memakai batang.
- Tampilan HP: tanpa scroll horizontal, satu kolom, navigasi bawah "Ringkasan", "Keputusan", dan "Laporan" (yang terakhir mulai R3).

## 3. Menunggu keputusan Anda

### 3.1 R1: daftar dan tautan
- Sumber datanya `attention` pada ringkasan. Aplikasi yang punya langkah keputusan untuk pengguna mengirim satu item `attention` per jenis pengajuan, berisi jumlah dan umur tertua, dengan `href` ke halaman keputusan aplikasi itu. Untuk HCIS, `href` mengarah ke `/board`, bagian "Menunggu keputusan Anda" (ORG-013-3). Isi item tetap agregat: tanpa nama pemohon.
- Portal menampilkan item ini di tab "Keputusan" dan di kartu teratas dasbor.
- Pekerjaan HCIS untuk ini dicatat di §8.

### 3.2 R2: memutuskan di portal
- `GET /api/organ/decisions` meminta langkah milik pengguna dari setiap aplikasi yang mendaftarkan `decision_path` di registry (field baru, nullable, aturannya sama dengan `governance_summary_path`). Permintaan itu memakai token hasil exchange ke **audience keputusan** aplikasi tersebut (`decision_audience`, field baru). Isi yang ditampilkan untuk setiap langkah adalah yang dikirim aplikasi asal (ORG-013-3): jenis pengajuan, nama dan jabatan pemohon, periode, alasan, dan riwayat langkah tanpa catatan approver lain.
- `POST /api/organ/decisions/:applicationKey/:stepId` meneruskan `{ decision: "approve" | "reject", note? }` ke aplikasi asal dengan token keputusan yang **baru di-exchange untuk aksi itu** (satu token per aksi). Portal tidak menyimpan isi pengajuan maupun keputusannya. Aplikasi asal yang mencatat audit.
- Sebelum token keputusan diminta, sesi harus berumur kurang dari 15 menit sejak verifikasi TOTP terakhir. Bila lebih, portal meminta verifikasi ulang (`DRAFT`).
- Syarat sisi aplikasi (ADR-0012 D4): `aud` = audience keputusan, `azp` = `sq-organ`, ada bukti TOTP, kepemilikan langkah, capability, dan larangan self-approval berdasarkan orang (ORG-013-1).
- Satu-satunya data yang ditulis portal adalah satu event `organ.decision.forwarded`: aktor (digest identitas), aplikasi, id langkah, keputusan, status HTTP, dan waktu. Catatan, nama, dan alasan tidak ikut ditulis.

## 4. Laporan bulanan (R3)

### 4.1 Snapshot dari aplikasi
- Kontrak snapshot bulanan v1 sama dengan ringkasan v1, ditambah `period` (`YYYY-MM`), `revision` (bilangan bulat, mulai 1), `closedAt`, dan `supersedes` (revisi sebelumnya atau null). Kontrak ini hanya diterbitkan setelah bulan itu ditutup oleh aplikasi asal.
- Endpointnya `GET <governance_monthly_path>?period=YYYY-MM` (field registry baru). Jawabannya `404` bila bulan belum ditutup.
- Penarikan dijalankan oleh job harian di Hub pukul 03:00 WIB, di luar jam 19 UTC. Job ini memakai **identitas mesin portal**, bukan token pengguna, karena laporan bulanan dibaca semua anggota dengan isi yang sama. Aplikasi asal memberi identitas mesin itu izin baca snapshot bulanan saja, sehingga `GOVERNANCE_SUMMARY_AUDIENCE` per pengguna tidak tersentuh (`DRAFT`, butuh amandemen ORG-010).

### 4.2 Penyimpanan
Tabel `organ_monthly_reports`:

| Kolom | Isi |
|---|---|
| `period` | `YYYY-MM`, kunci |
| `sections` | snapshot per aplikasi: `{ applicationKey, revision, closedAt, snapshot }` |
| `status` | `partial` (ada aplikasi yang belum menutup bulan) atau `complete` |
| `analysis` | hasil §5, atau null |
| `created_at`, `updated_at` | |

Baris tidak pernah diubah isinya untuk revisi yang sama. Revisi baru dari satu aplikasi menambah versi bagian itu dan mencatat yang lama sebagai riwayat. Hanya agregat yang disimpan, sesuai validasi kontrak v1 (tanpa nama, tanpa baris per orang).

### 4.3 Tampilan dan notifikasi
- Tab "Laporan" berisi daftar bulan. Satu laporan menampilkan bagian per aplikasi dengan grafik dan tabel. Bagian dari aplikasi yang belum menutup bulan ditandai "Belum final", tanpa angka sementara.
- Saat status berubah menjadi `complete`, setiap anggota efektif menerima email "Laporan <bulan> siap" berisi tautan, tanpa angka di isi email.
- Tersedia unduhan PDF yang dibuat di server dari data tersimpan, dengan label "Dibuat AI" pada bagian analisis.

### 4.4 Penanda tutup bulan per aplikasi
| Aplikasi | Penanda (`DRAFT`) |
|---|---|
| HCIS | Periode payroll bulan itu mencapai `APPROVED`. Yang diekspos hanya fakta "bulan final", tanpa id periode atau nominal (GOV-001). Isi snapshot adalah agregat SDM ORG-003 per akhir bulan, tanpa payroll. |
| Karir SQ, SPMB, Aset SQ | Ditetapkan di spesifikasi masing-masing. Sampai ada, bagiannya "Belum final". |

## 5. Catatan analisis Claude (R3)

### 5.1 Masukan
Satu objek JSON yang dibangun portal dari data yang sudah tampil:

```json
{
  "period": "2026-10",
  "metrics": [
    { "key": "hcis.employees.active", "label": "Pegawai aktif", "value": 412, "previous": 405, "unit": "orang" }
  ],
  "series": [
    { "key": "hcis.employees.trend", "label": "Pegawai aktif per bulan", "points": [{ "period": "2026-05", "value": 398 }] }
  ],
  "pendingDecisions": [{ "applicationKey": "hcis", "count": 2, "oldestAgeDays": 3 }]
}
```

Tidak ada nama, id orang, isi pengajuan, atau teks bebas buatan pengguna. Label hanya berasal dari kontrak aplikasi.

### 5.2 Permintaan
- Model: `claude-opus-5-5`, `output_config.effort: "medium"`, adaptive thinking (bawaan), tanpa streaming, `max_tokens` 4000.
- Server-side refusal fallback diaktifkan (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). Bila hasil akhirnya tetap `stop_reason: "refusal"`, analisis tidak dibuat.
- Structured output (`output_config.format`, JSON schema):

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["bullets"],
  "properties": {
    "bullets": {
      "type": "array", "minItems": 3, "maxItems": 5,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["text", "metricKeys"],
        "properties": {
          "text": { "type": "string", "maxLength": 280 },
          "metricKeys": { "type": "array", "minItems": 1, "items": { "type": "string" } }
        }
      }
    }
  }
}
```

- System prompt: tulis 3–5 poin pengamatan dalam bahasa Indonesia yang lugas untuk pengurus yayasan; setiap poin hanya boleh menyatakan apa yang tampak dari angka yang diberikan dan wajib menyebut key metrik yang menjadi dasarnya; tanpa rekomendasi kebijakan, tanpa dugaan sebab yang tidak tampak di data.
- Dipanggil lewat SDK resmi `@anthropic-ai/sdk`. Kunci dibaca dari `ANTHROPIC_API_KEY` di environment server Hub.

### 5.3 Validasi dan penyimpanan
- Poin yang `metricKeys`-nya memuat key yang tidak ada di masukan dibuang. Bila tersisa kurang dari satu poin, analisis tidak dibuat.
- Yang disimpan di `organ_monthly_reports.analysis`: `{ bullets, model, inputSha256, createdAt }`.
- Analisis dibuat sekali, saat laporan pertama kali `complete`, dan sekali lagi bila ada revisi snapshot. Tidak ada regenerasi diam-diam.
- Kegagalan API (timeout, 5xx, refusal) tidak menghalangi laporan. Laporan tampil tanpa analisis, dan job harian mencoba lagi paling banyak tiga hari berturut-turut.
- Log hanya mencatat status, latensi, dan jumlah token, tanpa isi masukan maupun keluaran.

### 5.4 Tampilan
Kotak "Catatan analisis" ditampilkan di atas laporan, dengan label "Dibuat AI — diperiksa terhadap angka di bawah". Setiap poin menautkan ke grafik atau metrik yang dirujuknya.

## 6. Privasi dan keamanan

- Portal tidak menyimpan data domain hidup. Yang disimpan hanya snapshot bulanan final (agregat), analisisnya, dan event penerusan keputusan tanpa isi.
- Token hasil exchange tidak pernah sampai ke browser. Token keputusan dibuat per aksi.
- Semua string dari aplikasi dirender sebagai teks.
- Anthropic API hanya menerima agregat (§5.1). Data pribadi tidak pernah dikirim.
- Portal tidak menyalin pemeriksaan izin domain. Yang ia periksa hanya keanggotaan efektif (gerbang masuk) dan keabsahan respons.

## 7. Galat

| Keadaan | Perilaku |
|---|---|
| Bukan anggota efektif | Halaman penolakan, tanpa sesi |
| Satu aplikasi gagal di-fetch | Kartunya "Tidak dapat dimuat" dengan tombol coba lagi; kartu lain tetap tampil |
| Keputusan ditolak aplikasi (`403`, `409`) | Pesan dari aplikasi asal ditampilkan; daftar dimuat ulang |
| Hasil keputusan tidak diketahui (timeout) | "Hasil belum pasti", lalu daftar dimuat ulang tanpa kirim ulang otomatis |
| Snapshot tidak valid terhadap kontrak | Bagian itu tidak disimpan; event `organ.report.snapshot_rejected` dicatat dengan kode saja |

## 8. Pekerjaan di aplikasi lain

| Aplikasi | Tahap | Pekerjaan |
|---|---|---|
| HCIS | R1 | Amandemen ORG-010: `/governance/summary` menerima `azp` `sq-organ` selain `sq-hub`. Tambah item `attention` "N pengajuan menunggu keputusan Anda" untuk principal yang punya langkah `pending` |
| HCIS | R2 | Audience `hcis-organ-decision`; `GET`/`POST` route keputusan dengan bearer bercakupan tulis (`azp` `sq-organ`, bukti TOTP); amandemen ORG-013-3 yang menutup `TBD`-nya |
| HCIS | R3 | Endpoint snapshot bulanan dan penanda tutup bulan dari periode payroll `APPROVED` |
| Karir SQ | R1/R2 | Governance summary; langkah MPP untuk Ketua bila Direktur kosong (REC-IMPL-006) |
| Aset SQ, SPMB | R1/R3 | Governance summary, lalu snapshot bulanan |
| Owner | R1 | Record DNS `organ` di akun Cloudflare yayasan |

Setiap baris membutuhkan ID spesifikasi di repository-nya masing-masing.

## 9. Test wajib

- Host staf tidak melayani route portal, dan sebaliknya. Host tidak dikenal mendapat `421`.
- Identitas tanpa keanggotaan efektif ditolak tanpa sesi. Keanggotaan yang `termEnd`-nya lewat langsung ditolak.
- Token tanpa bukti TOTP ditolak di callback.
- Kartu dari aplikasi yang gagal tidak menghalangi kartu lain. Respons yang melanggar kontrak dibuang.
- R2: token keputusan dibuat per aksi, tidak pernah sampai ke browser, dan tidak menggunakan audience ringkasan. Event penerusan tidak memuat catatan atau nama.
- R3:
  - snapshot dengan revisi baru tidak menimpa revisi lama;
  - bagian yang belum ditutup tampil "Belum final";
  - poin analisis dengan key asing dibuang;
  - refusal dan timeout tidak menghalangi laporan;
  - masukan ke Claude tidak memuat nama (diuji dengan data sintetis yang memuat nama di field lain).

## 10. Rilis dan rollback

- **Flag:** `PORTAL_ORGAN_ENABLED` (R1), `PORTAL_ORGAN_DECISIONS_ENABLED` (R2), `PORTAL_ORGAN_REPORTS_ENABLED` (R3). Semuanya default `false`.
- **Urutan R1:**
  1. DNS (owner).
  2. Client Keycloak `sq-organ` dan konfigurasi token exchange, dibuktikan dengan probe audience yang diizinkan dan yang dilarang (pola `HUB-IMPL-021-token-exchange.md`).
  3. Amandemen HCIS ORG-010 dirilis.
  4. Hub dirilis dengan flag mati.
  5. Flag dinyalakan.
  6. Redirect `/yayasan` dinyalakan.
- **Rollback:** matikan flag. `/yayasan` kembali melayani halaman Hub, dan HCIS `/board` tetap berfungsi. Tabel `organ_monthly_reports` hanya tambahan dan boleh dibiarkan.

## 11. Pertanyaan terbuka

| # | Pertanyaan | Default sementara |
|---|---|---|
| T-1 | Jalankan di proses Hub (ADR-0012 D2) atau proses sendiri? | Proses Hub |
| T-2 | Batas umur sesi sejak TOTP sebelum boleh memutuskan | 15 menit |
| T-3 | Penanda tutup bulan HCIS | Payroll `APPROVED`, diekspos sebagai "bulan final" saja |
| T-4 | Laporan bulanan dibaca dengan identitas mesin portal | Ya, khusus snapshot bulanan |
| T-5 | Email "laporan siap" | Ya, tanpa angka |

## Acceptance criteria

- ORGAN-001-A: `organ.sabilulquran.or.id` hanya bisa dimasuki anggota efektif dengan TOTP. Orang lain ditolak tanpa sesi.
- ORGAN-001-B: dasbor menampilkan ringkasan setiap aplikasi atas nama pengguna, tanpa menyimpan data domain hidup.
- ORGAN-001-C: R1 menampilkan pengajuan yang menunggu keputusan sebagai tautan ke aplikasi asal. R2 meneruskan keputusan dengan token keputusan per aksi, dan semua aturan approval tetap di aplikasi asal.
- ORGAN-001-D: laporan bulanan hanya memuat snapshot final dari aplikasi asal. Bagian yang belum ditutup ditandai "Belum final", dan revisi tidak menimpa yang lama.
- ORGAN-001-E: catatan analisis dibuat dari agregat saja, setiap poinnya menyebut metrik yang ada, berlabel "Dibuat AI", dan disimpan bersama model serta hash masukan.
- ORGAN-001-F: mematikan flag mengembalikan organ ke Hub `/yayasan` dan HCIS `/board` tanpa perubahan di aplikasi lain.
