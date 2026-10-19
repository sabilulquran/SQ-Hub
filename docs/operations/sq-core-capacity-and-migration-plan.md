# SQ Core — Rencana kapasitas dan migrasi host

**Status:** DRAFT / DISCOVERY. Dokumen ini tidak mengotorisasi pembelian, perubahan production, maupun migrasi.
**Tanggal:** 2026-10-19
**Terkait:** `operational-baseline.md`, `vps-deployment-retired-2026-10-19.md`, `HUB-IMPL-013-mi8-activation-plan.md`, `HUB-IMPL-013-mi8-keycloak-rehearsal.md`, `mi8-tailscale-management-plane-incident-2026-10-06.md`, `sq-core-login-theme-resource-recovery-2026-10-06.md`, ADR-0011, `docs/product/kirim-sq-module-design.md`, `docs/product/rapat-sq-module-design.md`
**Sumber operasional utama:** repositori **`sabilulquran/sq-core-ops`** — `reference/` dan `runbooks/`

Tidak ada perintah apa pun dijalankan terhadap Mi8 atau production dalam penyusunan dokumen ini. Isinya berasal dari dokumen di repositori ini, dari repositori `sq-core-ops`, dan dari harga publik penyedia.

> **Catatan sumber.** Draf pertama dokumen ini disusun hanya dari `docs/` SQ Hub dan karena itu menyatakan banyak hal sebagai "tidak tercatat". Sebagian besar ternyata **memang tercatat**, tetapi di repositori `sq-core-ops`, yang tidak dirujuk dari `docs/` SQ Hub. Revisi ini mengoreksinya. Pelajaran yang layak dicatat: `docs/` SQ Hub tidak menyebut keberadaan `sq-core-ops` sama sekali, sehingga pembaca yang hanya memegang repositori ini akan menyimpulkan keadaan yang salah.

## 1. Kenapa dokumen ini ada

Catatan operasi sendiri mencatat Mi8 berjalan pada batas kapasitasnya:

> "Mi8 showed 3.7 GB RAM with about 75 MB free, while production Keycloak is already under restart observation (OPS-MI8-KC-001)."
> — `HUB-IMPL-013-mi8-keycloak-rehearsal.md:24`, 2026-10-16

Sementara bebannya terus bertambah: Karir SQ sudah berjalan sejak 2026-10-17, lalu menyusul SPMB, Keluarga SQ, Kirim SQ, dan usulan Rapat SQ. Kapasitas sudah jatuh tempo terlepas dari fitur baru apa pun, dan tidak boleh dibingkai sebagai konsekuensi satu modul tertentu.

Dokumen ini **tidak** mengusulkan menghidupkan kembali jalur deployment VPS yang dipensiunkan pada 2026-10-19 (`vps-deployment-retired-2026-10-19.md`). Yang dipensiunkan adalah pipeline GitHub Actions dan VPS lama yang sudah dimatikan. Yang dibahas di sini adalah host production penggantinya, dengan cara rilis yang sama seperti sekarang: skrip `sq-core-ops` dan persetujuan pemilik per langkah.

## 2. Keadaan sekarang

### 2.1 Mi8 adalah perangkat Android, bukan VPS

Ini fakta paling menentukan dan perlu dinyatakan terang-terangan. Mi8 adalah perangkat Android yang dikelola sendiri, bukan server sewaan:

- `mi8-tailscale-management-plane-incident-2026-10-06.md:11,25,27` membahas "Android/Tailscale service, VPN, power-management", "Battery set to No restrictions", "Always-on VPN", dan "Android version, device uptime, battery state";
- Docker tidak tersedia di host (`HUB-IMPL-013-mi8-activation-plan.md:28`), sehingga seluruh layanan berjalan sebagai proses native di bawah supervisor SQ Core;
- akses pengelolaan lewat Tailscale (`ssh mi8vps`, `ssh mi8vps-root`), terpisah dari jalur ingress aplikasi;
- SQ Core pindah ke Mi8 pada 6 Oktober 2026, dan VPS produksi sebelumnya sudah diterminasi (`HUB-IMPL-013-mi8-activation-plan.md:11`).

Konsekuensi yang perlu disadari pemilik keputusan: production yayasan saat ini bergantung pada satu perangkat telepon, dengan manajemen daya Android, baterai, dan jaringan rumah/kantor sebagai bagian dari rantai ketersediaan. Insiden Tailscale 6 Oktober 2026 — yang akar penyebabnya masih **UNRESOLVED** — adalah contoh langsung risiko itu.

### 2.2 Yang berjalan di Mi8

Inventarisnya **ada**, di `sq-core-ops/reference/sq-core-supervisor-runtime.tsv` dan `sq-core-final-runtime-plan.tsv`. Dikelola supervisor `/data/local/mi8vps/sq-core-worker.sh`, berurutan:

| # | Komponen | Port lokal | Readiness |
| --- | --- | --- | --- |
| 1 | PostgreSQL (Termux PG 18.6) | 5432 | `pg_isready` |
| 2 | Keycloak 26.7.2 | 8080 HTTP, 9000 manajemen, 7800/57800 JGroups | `127.0.0.1:9000/health/ready` |
| 3 | HCIS | 3201 web, 3301 API | `127.0.0.1:3301/health` |
| 4 | `directory-proxy` (edge/TLS) | 443/8443 privat, 3180 edge | — |
| 5 | SQ Hub | 3202 web, 3302 API | `127.0.0.1:3302/health`, Directory `stale=false` |
| 6 | Aset SQ | 3203 web, 3303 API | `127.0.0.1:3303/healthz` |
| 7 | Karir SQ API | 3304 | `127.0.0.1:3304/api/health` |
| 8 | Karir SQ web | 3204 | `127.0.0.1:3204/` |

Itulah "8/8 service processes" yang disebut dokumen SQ Hub. Karir SQ berstatus `RUNNING_PUBLIC_LIVE` — **sudah berjalan sejak 2026-10-17**, bukan rencana.

Selain kedelapan itu, pada host yang sama juga berjalan:

| Komponen | Keterangan |
| --- | --- |
| RuangHadir | Port 3000, `EXISTING_PROTECTED`, "Do not change" |
| Samijaya | Port 3100, `EXISTING_PROTECTED_ACTIVE_DEPLOYMENT` |
| JalurPesan | Gateway Baileys, `127.0.0.1:3401` (ADR-0011:11) |
| Konektor Cloudflare | Tiga |
| Tailscale | Klien Android, management plane |
| Termux + lapisan Ubuntu (`/data/local/ubuntu26/`) | Dasar runtime |

Dua aplikasi pertama **tidak muncul sama sekali** di `docs/` SQ Hub, padahal ikut memakai memori host yang sama. Ini salah satu sebab perkiraan kapasitas sebelumnya terlalu rendah.

Hostname produksi menurut `sq-core-ops/reference/sq-core-final-ingress-map.tsv`: `login`, `hcis`, `hub`, `aset`, `adms` — semuanya `sabilulquran.or.id`, ditambah `karir` yang menyusul. Berkas itu adalah tangkapan pra-cutover 2026-10-05, sehingga nilai rekamannya historis; yang tetap berlaku adalah struktur rute dan aturan per hostname.

### 2.3 Yang memang belum tercatat

Setelah `sq-core-ops` diperhitungkan, daftarnya menyusut banyak:

- jumlah core dan model prosesor Mi8;
- kapasitas disk total dan terpakai;
- **pemakaian memori aktual per layanan** — tidak ada satu angka pun di repositori mana pun;
- nilai heap cap Java untuk Keycloak;
- isi, penyebab, dan gejala OPS-MI8-KC-001 Part A dan Part B.

Yang **sudah tercatat** dan sempat salah dinyatakan hilang di draf pertama: daftar kedelapan proses (§2.2), versi PostgreSQL (18.6, Termux), prosedur restore (`runbooks/sq-core-pg18-restore-rehearsal.md`, `sq-core-backup-acceptance.md`, skrip `sq-core-daily-restore-test`), dan tujuan backup off-host (§3.4).

### 2.4 Dua inkonsistensi yang tercatat

Keduanya perlu diluruskan sebelum angka apa pun dipakai sebagai dasar belanja:

1. **Angka memori berbeda.** "3.7 GB total / ~75 MB free" bertanggal 2026-10-16, sementara "~1 GiB MemAvailable" muncul tanpa tanggal di ADR-0011:12 dan `kirim-sq-module-design.md:16`. Keduanya bisa benar pada waktu berbeda, tetapi tidak boleh dipakai bergantian.
2. **Dua nama database Hub.** `sqcore_hub` (`HUB-IMPL-013-mi8-activation-plan.md:19`) versus `sq_hub_production` (`KIRIM-IMPL-001:180`).

### 2.5 Risiko yang ditemukan saat penyusunan

**Dokumentasi terbelah dua repositori tanpa saling menunjuk.** Seluruh runtime production — `sq-core-worker.sh`, `sq-corectl.sh`, `directory-proxy.mjs`, `sq-core-backup.sh`, skrip rilis per aplikasi, dan `install-mi8-sq-core-host-ready.sh` — ada di `sq-core-ops/scripts/mi8/`, lengkap dengan runbook cutover, restore PG18, dan penerimaan backup. Tidak ada yang hilang.

Masalahnya, `docs/` SQ Hub tidak menyebut `sq-core-ops` sama sekali, sementara README `sq-core-ops` menunjuk balik ke SQ Hub. Akibatnya pembaca yang hanya memegang SQ Hub — termasuk penyusun draf pertama dokumen ini — menyimpulkan bahwa runtime production tidak ada di version control. Kesimpulan itu salah, tetapi wajar.

Usulan perbaikan kecil: tambahkan rujukan ke `sq-core-ops` di `operational-baseline.md` dan `AGENTS.md` §3. Di luar lingkup dokumen ini, tetapi murah.

**Peringatan yang tetap berlaku:** README `sq-core-ops` menyatakan "Production stays authoritative: re-copy a script here whenever it changes on the host." Jadi salinan di repositori itu adalah cermin, bukan sumber. Sebelum migrasi, salinan itu harus dipastikan mutakhir terhadap host (§6).

## 3. Kebutuhan kapasitas

### 3.1 Perkiraan beban sekarang

> **ASUMSI.** Tidak ada satu pun angka memori per layanan yang tercatat (§2.3). Tabel di bawah adalah perkiraan penyusun dokumen berdasarkan sifat umum tiap teknologi, **bukan hasil pengukuran**. Angka sebenarnya harus diukur di Mi8 sebelum dipakai sebagai dasar belanja (§7 butir 1).

| Komponen | Perkiraan RSS | Dasar perkiraan |
| --- | --- | --- |
| Keycloak 26.7.2 (JVM) | 700 MB – 1,2 GB | Pemakai memori terbesar; JVM Quarkus |
| PostgreSQL 18.6 (Termux) | 300 – 500 MB | Empat database atau lebih, volume data masih kecil |
| HCIS (web + API) | 200 – 350 MB | Dua listener |
| SQ Hub (web + API) | 200 – 350 MB | ADR-0011:66 mencatat proses Node tambahan ~80–120 MiB RSS |
| Aset SQ (web + API) | 200 – 350 MB | — |
| Karir SQ (web + API) | 200 – 350 MB | Sudah berjalan sejak 2026-10-17 |
| `directory-proxy` | 80 – 120 MB | ADR-0011:66 |
| RuangHadir | 100 – 200 MB | `EXISTING_PROTECTED`, tidak boleh diubah |
| Samijaya | 100 – 200 MB | `EXISTING_PROTECTED_ACTIVE_DEPLOYMENT` |
| JalurPesan (Baileys) | 30 – 80 MB per nomor | ADR-0011:81, ditandai belum diukur |
| Konektor Cloudflare ×3 | 100 – 150 MB | — |
| Tailscale, Termux, lapisan Ubuntu, Android | 400 – 700 MB | — |
| **Perkiraan total** | **± 2,6 – 4,5 GB** | |

Batas atas perkiraan ini melampaui kapasitas fisik Mi8 (3,7 GB), yang wajar karena Linux berbagi memori antarproses dan sebagian dihitung ganda di tabel per komponen. Yang penting bukan ketepatan angkanya, melainkan arahnya: beban sudah menempel di langit-langit, dan itu cocok dengan pengamatan ~75 MB bebas.

Ambang yang **memang tertulis** dan harus dihormati:

- hentikan penambahan nomor Kirim SQ bila rata-rata MemAvailable 7 hari di bawah 900 MiB (`KIRIM-IMPL-001:448`, ADR-0011:72);
- realm eksternal baru menuntut headroom minimum 700 MiB MemAvailable (ADR-0008:37, ADR-0010:92);
- peringatan disk pada sisa bebas di bawah 10 GiB, dan hanya metadata di bawah 5 GiB (`KIRIM-IMPL-001:371,449`).

Dengan ~75 MB bebas, **dua ambang pertama sudah dilanggar hari ini.** Artinya penambahan nomor Kirim SQ dan realm eksternal baru secara formal terhalang oleh aturan yang sudah disepakati, bukan oleh pendapat dokumen ini.

### 3.2 Proyeksi 24 bulan

| Penambahan | Perkiraan tambahan | Catatan |
| --- | --- | --- |
Karir SQ **tidak** masuk daftar ini karena sudah berjalan (§2.2) dan sudah terhitung di §3.1.

| Penambahan | Perkiraan tambahan | Catatan |
| --- | --- | --- |
| SPMB (web + API) | 200 – 350 MB | Aplikasi domain, proses sendiri |
| Keluarga SQ | 150 – 250 MB | Realm eksternal keluarga (ADR-0010) |
| Kirim SQ, nomor tambahan | 30 – 80 MB per nomor | ADR-0011:81 |
| Rapat SQ | ~0 proses baru | Modul di dalam SQ Hub API, mengikuti pola Kirim SQ |
| Pertumbuhan cache PostgreSQL | 200 – 500 MB | Seiring bertambahnya data |
| **Tambahan total** | **± 0,6 – 1,2 GB** | |

Perkiraan beban kerja 24 bulan: **± 3,2 – 5,7 GB**, belum termasuk headroom untuk lonjakan, backup, dan pekerjaan pemeliharaan.

### 3.3 Spesifikasi target yang diusulkan

| Sumber daya | Usulan | Alasan |
| --- | --- | --- |
| RAM | **12 GB disarankan; 8 GB adalah lantai, bukan target** | Beban 24 bulan ~3,2–5,7 GB (§3.2). Pada batas atas itu, 8 GB hanya menyisakan ~2 GB dan akan terasa sempit saat rehearsal Keycloak atau restore berjalan bersamaan dengan production. 12 GB memberi ruang kerja yang nyata |
| vCPU | **4 minimum** | Tidak ada data CPU Mi8 (§2.3). Angka ini perkiraan; ukur pemakaian CPU sebelum memutuskan |
| Disk | **60 GB cukup, asalkan §3.4 diikuti** | Database masih kecil; yang tumbuh adalah backup dan media |
| Lokasi | **Indonesia** | §4.3 |

Rapat SQ **tidak** masuk dalam angka ini. Transkripsi dan peringkasan AI dilarang berbagi mesin dengan production (`rapat-sq-module-design.md` §5.5) dan ditangani mesin terpisah.

### 3.4 Backup dan media tidak boleh tinggal di disk host

Paket VPS lokal yang sepadan umumnya menawarkan 60 GB. Itu cukup untuk sistem operasi dan database, tetapi akan habis oleh backup harian, media Kirim SQ, dan dokumen Karir SQ.

Masalah ini **sudah ditangani sebagian**. Menurut README `sq-core-ops`, sejak 2026-10-19 backup harian production disimpan di **Drive 2 TB yayasan (`humancapital.ysq`)**, set `sq_daily:sets/`, menggantikan `mi8_crypt:production/sq-core-daily/`. Jadi salinan off-host sudah ada dan tidak perlu dibangun dari nol.

Yang perlu diperiksa saat migrasi: apakah jalur `sq-core-offhost-daily` dan `sq-core-karir-docs-offhost` ikut berpindah apa adanya ke host baru, dan apakah 2 TB masih memadai setelah media Kirim SQ dan dokumen Karir bertambah.

> **TBD.** Retensi dan ambang kapasitas Drive belum ditetapkan. Object storage seperti Cloudflare R2 tetap layak dipertimbangkan bila Drive menjadi sempit, tetapi dokumen ini tidak mengusulkan penggantian jalur yang baru saja dipakai.

## 4. Pilihan hosting

### 4.1 Harga

Kurs asumsi **Rp 18.500/EUR** per 2026-10-19; kurs sebenarnya perlu diperiksa saat belanja. Status PPN ditandai per baris.

**Terverifikasi dari halaman resmi penyedia, 2026-10-19:**

| Penyedia | Paket | Core | RAM | Disk | Per bulan | Per tahun |
| --- | --- | --- | --- | --- | --- | --- |
| Contabo (Jerman) | Cloud VPS 4 | 4 | 8 GB | 100 GB SSD | €4,40 (kontrak 24 bln) / €5,50 | ± Rp 977rb / Rp 1,22 jt |
| Contabo (Jerman) | Cloud VPS 6 | 6 | 12 GB | 200 GB SSD | €6,00 (24 bln) | ± Rp 1,33 jt |
| Contabo (Jerman) | Cloud VPS 8 | 8 | 24 GB | 300 GB SSD | €11,20 (24 bln) | ± Rp 2,49 jt |
| Biznet Gio (Indonesia) | NEO Lite MM 8.4 | 4 | 8 GB | 60 GB | Rp 269rb (promo; normal Rp 399rb) | Rp 3,23 jt (normal Rp 4,79 jt) |
| Biznet Gio (Indonesia) | NEO Lite MM 8.8 | 8 | 8 GB | 60 GB | Rp 289rb (promo; normal Rp 499rb) | Rp 3,47 jt |
| Biznet Gio (Indonesia) | NEO Lite LL 16.8 | 8 | 16 GB | 60 GB | Rp 459rb (promo; normal Rp 839rb) | Rp 5,51 jt |

Catatan: halaman daftar harga Biznet Gio tidak menyatakan apakah harga sudah termasuk PPN; perlu dikonfirmasi. Harga promo juga tidak menyebutkan periode berlakunya, dan harga normal hampir dua kali lipat — perlu dipastikan apa yang berlaku saat perpanjangan.

**Belum terverifikasi:**

| Penyedia | Paket | Spek | Harga | Sumber |
| --- | --- | --- | --- | --- |
| Hetzner (Jerman/Finlandia) | CPX32 | 4 vCPU / 8 GB / 160 GB NVMe | tidak ditampilkan | Spesifikasi dari halaman resmi; harga tidak muncul |
| Hetzner | CPX42 | 8 vCPU / 16 GB / 320 GB NVMe | tidak ditampilkan | idem |
| IDCloudHost | Rocket VPS 4 | 4 core / 16 GB / 120 GB | Rp 245rb/bln, Rp 2,79 jt/thn | Agregator pihak ketiga; halaman resmi menolak akses (HTTP 403) |

Hetzner menaikkan harga seluruh lini pada Juni 2026, sehingga angka pihak ketiga mana pun untuk Hetzner harus dianggap kedaluwarsa.

### 4.2 Mesin untuk pekerjaan AI (bila Rapat SQ berlanjut)

| Pilihan | Biaya | Catatan |
| --- | --- | --- |
| Mini PC 32 GB di kantor yayasan | ± Rp 8,2 jt sekali beli, listrik ± Rp 300rb/tahun | Audio rapat tidak pernah meninggalkan kantor. Tidak menuntut uptime |
| VPS 8 GB terpisah | ± Rp 1,0 – 1,2 jt/tahun, selamanya | Audio keluar ke penyedia hosting |

Harga mini PC berasal dari satu listing marketplace yang tidak bertanggal dan **belum diverifikasi**. Keputusan ini tidak mendesak dan bergantung pada hasil tes akurasi Whisper (`rapat-sq-module-design.md` §10).

### 4.3 Lokal versus Eropa

Selisih harganya nyata: Contabo 12 GB ± Rp 1,33 jt/tahun berbanding Biznet 8 GB ± Rp 3,23 jt/tahun. Eropa dua sampai tiga kali lebih murah untuk RAM yang sama atau lebih besar.

Yang dibeli dengan selisih itu adalah **latensi**. Seluruh pengguna SQ Core berada di Indonesia, dan Mi8 hari ini juga berada di Indonesia, sehingga pindah ke Eropa adalah **kemunduran** pengalaman pengguna, bukan sekadar pilihan netral. Login OIDC melewati beberapa perjalanan bolak-balik antara browser, Keycloak, dan aplikasi, sehingga tambahan ±150–180 ms per perjalanan paling terasa justru di alur masuk.

> **Catatan.** Angka latensi di atas adalah perkiraan umum Indonesia–Eropa, **bukan hasil pengukuran**. Kalau selisih biaya menjadi pertimbangan serius, ukur dulu dengan uji coba satu bulan sebelum memutuskan.

Selisihnya sekitar Rp 1,9 juta per tahun, atau ± Rp 158 ribu per bulan. Dokumen ini menilai itu harga yang pantas untuk menjaga pengalaman pengguna, tetapi keputusannya milik Product Owner (§7).

## 5. Konsekuensi migrasi yang mudah terlewat

**Sesi WhatsApp Kirim SQ harus dipasang ulang.** Backup sesi JalurPesan berstatus `CONSISTENCY_BLOCKED`; dokumen menyatakan "kalau Mi8 rusak, nomor dipairing ulang" (`kirim-sq-module-design.md:266`, ADR-0011:81). Migrasi host berarti setiap nomor WhatsApp dipairing ulang dengan scan QR. Ini harus direncanakan, bukan ditemukan saat pelaksanaan.

**Dua aplikasi yang dilindungi ikut terdampak.** RuangHadir dan Samijaya berjalan di host yang sama dan ditandai `EXISTING_PROTECTED` / "Do not change". Keduanya tidak dibahas di `docs/` SQ Hub. Pemiliknya harus dilibatkan sejak awal: ikut pindah, tetap di Mi8, atau pindah terpisah.

**Android/Termux ke Linux biasa bukan pemindahan berkas.** Path runtime sekarang bercampur antara `/data/local/mi8vps/`, `/data/local/ubuntu26/`, dan `/data/data/com.termux/`. PostgreSQL berjalan sebagai Termux PG 18.6 dengan pengguna `u0_a211`. Di host Linux biasa semua itu menjadi path dan pengguna normal, sehingga skrip supervisor perlu disesuaikan — tetapi `install-mi8-sq-core-host-ready.sh` dan runbook `sq-core-host-ready-2026-10-04.md` sudah menyediakan kerangkanya, jadi ini penyesuaian, bukan penulisan ulang dari nol.

**Keycloak membawa provider dan theme kustom.** `infra/keycloak/providers/karir-identity`, `providers/trusted-device`, dan theme SQ harus ikut dan versinya cocok dengan Keycloak 26.7.2.

## 6. Garis besar migrasi

Garis besar, bukan runbook. Runbook rinci disusun terpisah setelah spesifikasi target disetujui.

**Prasyarat**

1. Ukur pemakaian memori dan CPU per layanan di Mi8, ganti angka asumsi §3.1 dengan hasil pengukuran.
2. Pastikan salinan skrip di `sq-core-ops/scripts/mi8/` mutakhir terhadap host — README-nya menyatakan production tetap otoritatif dan salinan harus diperbarui setiap kali skrip berubah (§2.5).
3. Luruskan dua inkonsistensi §2.4.
4. Tinjau ulang runbook yang sudah ada untuk host baru: `sq-core-host-ready-2026-10-04.md`, `sq-core-cutover-command-plan.md`, `sq-core-pg18-restore-rehearsal.md`, `sq-core-backup-acceptance.md`, dan `sq-core-migration-audit-2026-10-03.md`. Migrasi ini adalah pengulangan kedua dari yang sudah pernah dikerjakan, bukan hal baru.
5. Sepakati nasib RuangHadir dan Samijaya dengan pemiliknya (§5).
6. Putuskan §7.
7. Tetapkan dan umumkan jendela pemeliharaan.

**Urutan**

1. Sediakan host baru; pasang PostgreSQL, Java 21, Node sesuai versi yang dipakai production.
2. Angkut supervisor SQ Core dan skrip runtime; sesuaikan ke Linux.
3. Ambil backup segar yang terverifikasi untuk seluruh database production — Keycloak, HCIS, Hub, Aset, Karir — beserta arsip lampiran Aset dan dokumen Karir dan salinan off-host, tepat sebelum perubahan. Ikuti `sq-core-backup-acceptance.md`.
4. Restore seluruh database ke host baru mengikuti `sq-core-pg18-restore-rehearsal.md`; cocokkan jumlah tabel dengan daftar isi dump dan periksa tidak ada indeks invalid.
5. Jalankan Keycloak 26.7.2 beserta provider dan theme; verifikasi realm, client, dan alur login tanpa memindahkan trafik.
6. Jalankan sisanya sesuai urutan supervisor §2.2: HCIS, `directory-proxy`, SQ Hub, Aset SQ, Karir SQ API, Karir SQ web; verifikasi readiness masing-masing lewat jalur internal.
7. Pasang konektor Cloudflare baru di host baru, **tanpa** memindahkan rute hostname.
8. Verifikasi menyeluruh di host baru melalui tunnel baru dengan hostname sementara.
9. Pindahkan rute hostname production satu per satu mengikuti pola `sq-core-final-ingress-map.tsv`: `login`, lalu `hcis`, `hub`, `aset`, `karir`, dan terakhir `adms`. Verifikasi di antara tiap langkah. `adms` ditaruh terakhir karena melayani perangkat presensi dan trafiknya tidak bisa dijeda.
10. Pasang ulang nomor WhatsApp Kirim SQ (§5).
11. Biarkan Mi8 hidup dan tidak diubah selama masa pengamatan yang disepakati.

**Pemulihan**

- Sampai langkah 9, membatalkan berarti tidak melakukan apa-apa: production masih di Mi8.
- Pada langkah 9, membatalkan berarti mengembalikan rute hostname ke konektor Mi8. Itu operasi Cloudflare, bukan operasi data.
- Setelah langkah 9 dan sudah ada penulisan data di host baru, kembali ke Mi8 berarti kehilangan data yang ditulis sejak peralihan. Karena itu **titik tidak bisa kembali ada di langkah 9**, dan harus dinyatakan jelas kepada pemilik keputusan sebelum dimulai.
- Mi8 tidak boleh dimatikan, dihapus, atau dipakai ulang sampai penerimaan resmi.

Peralihan ini masih jauh lebih murah daripada nanti, karena SQ Core belum punya pengguna staf. Tetapi **jendela itu sudah mulai menutup**: Karir SQ berstatus `RUNNING_PUBLIC_LIVE` sejak 2026-10-17 dan melayani kandidat dari luar, sementara `adms` melayani perangkat presensi yang trafiknya tidak bisa dijeda. Keduanya harus diperlakukan sebagai layanan yang sudah dipakai orang, bukan sebagai sistem kosong.

Itu justru alasan untuk tidak menunda, bukan alasan untuk ragu.

## 7. Keputusan yang butuh persetujuan Product Owner

| # | Pertanyaan | Saran |
| --- | --- | --- |
| 1 | Ukur dulu, atau belanja berdasarkan perkiraan? | **Ukur dulu.** Satu jam kerja mengganti seluruh §3.1 dengan angka nyata. Tanpa itu, belanja berdasarkan tebakan |
| 2 | Lokal atau Eropa? | **Lokal.** Selisih ± Rp 158rb/bulan sepadan untuk menjaga latensi bagi pengguna yang semuanya di Indonesia |
| 3 | Berapa RAM? | **12 GB.** Setelah RuangHadir, Samijaya, dan Karir SQ ikut dihitung, 8 GB menjadi lantai yang sempit, bukan target yang nyaman |
| 4 | Kapan? | Sebelum pengguna nyata masuk ke SQ Core. Sesudahnya, migrasi yang sekarang murah akan menjadi mahal |
| 4b | RuangHadir dan Samijaya ikut pindah? | Libatkan pemiliknya sebelum memutuskan. Keduanya ditandai "Do not change" dan tidak boleh ikut terbawa diam-diam |
| 5 | Mi8 jadi apa setelahnya? | Dipertahankan tanpa diubah selama masa pengamatan, lalu dijadikan simpanan dingin. Jangan langsung dipakai ulang |
| 6 | Backup dan media ke object storage? | Ya, dan Cloudflare R2 lebih dipilih karena tidak menambah vendor baru. Rinciannya dokumen tersendiri |
| 7 | Mesin AI untuk Rapat SQ | Tunda. Bergantung pada tes akurasi Whisper, dan tidak boleh menyandera keputusan 1–6 |

## 8. Langkah berikutnya

1. Pengukuran di Mi8 (keputusan 1), hasilnya menggantikan §3.1.
2. Commit skrip runtime yang hilang (§2.5).
3. Putuskan §7 butir 2 dan 3.
4. Baru setelah itu: runbook migrasi rinci beserta jendela pemeliharaan dan kriteria penerimaannya.

Tidak ada pembelian maupun perubahan production sebelum butir 1–3 selesai.
