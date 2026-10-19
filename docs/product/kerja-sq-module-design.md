# Kerja SQ — Desain modul (PRD)

**Status:** DRAFT / DISCOVERY. Dokumen ini tidak mengizinkan implementasi, pembelian, atau perubahan production.
**Spesifikasi:** KERJA-001 (usulan). Spesifikasi implementasi belum ada.
**Tanggal:** 2026-10-19 (revisi 1 — menambah §4.4 bangun-atau-adopsi, §6.6–6.9, §7 Data, §8 Layar, dan Lampiran B; revisi 0 tidak dicabut, hanya dilengkapi)
**Terkait:** ADR-0001 (batas platform), ADR-0006 (stack), ADR-0007 (Organization Directory), ADR-0011 + `kirim-sq-module-design.md` (pola modul di dalam Hub), `rapat-sq-module-design.md` (batas dengan register keputusan)
**Referensi luar:** bedah aplikasi Cicle 3.22.5 (Lampiran A); penelusuran enam alat kanban sumber terbuka (Lampiran B)

## 1. Dasar

### 1.1 Masalah

Yayasan sudah punya tempat untuk **fakta**: HCIS memegang kepegawaian, SQ Hub memegang organ dan direktori, Aset SQ memegang barang, Karir SQ memegang pelamar, SPMB memegang pendaftar.

Yang belum punya tempat adalah **pekerjaannya**. Siapa mengerjakan apa, sampai kapan, sudah sampai mana. Sekarang itu hidup di grup WhatsApp, di kepala kepala unit, dan di rapat yang hasilnya tidak ditagih.

Tiga gejala yang sudah terlihat di repo ini sendiri:

1. **Rapat SQ sengaja tidak membangunnya.** `rapat-sq-module-design.md` §3 menyatakan modul itu "menagih keputusan rapat, bukan menjadi task manager yayasan". Register keputusannya punya penanggung jawab, tenggat, dan status — tetapi tidak punya tempat untuk dikerjakan.
2. **Setiap modul domain melahirkan pekerjaan yang keluar dari modulnya.** Gelombang SPMB melahirkan tugas panitia. Aset yang rusak melahirkan perbaikan. Pelamar yang lolos melahirkan jadwal wawancara. Semuanya berakhir di WhatsApp.
3. **Kepanitiaan lintas unit tidak punya rumah.** Tidak ada unit HCIS bernama "Panitia SPMB 2027", padahal orangnya nyata dan pekerjaannya nyata.

### 1.2 Hasil yang dituju

1. Setiap unit dan setiap kepanitiaan punya satu papan tempat pekerjaannya terlihat.
2. Setiap orang bisa melihat satu daftar: apa saja yang menjadi tanggung jawab saya, dari seluruh ruang.
3. Penugasan punya tenggat dan pengingat, sehingga menagih tidak perlu dilakukan manusia.
4. Keputusan rapat tidak berhenti sebagai catatan — ia menjadi kartu yang bisa ditutup.
5. Pekerjaan yang lahir dari modul domain lain bisa ditarik ke papan tanpa mengetik ulang.

### 1.3 Asumsi yang belum diverifikasi

> **DISCOVERY.** Belum ada pendataan. Sebelum spesifikasi implementasi dibuat, perlu dicek: berapa staf aktif yang akan memakai, berapa unit dan kepanitiaan yang berjalan bersamaan, dan berapa besar lampiran yang realistis per bulan. Angka kapasitas di §4.3 memakai perkiraan kasar dan harus diganti.

## 2. Keputusan Product Owner

Keputusan yang sudah diambil dalam diskusi 2026-10-19:

| # | Keputusan |
| --- | --- |
| 1 | SQ Core punya modul kerja/koordinasi. Nama **Kerja SQ**, sejalan dengan Akun SQ, Aset SQ, Karir SQ, Kirim SQ. |
| 2 | Modul ini harus terintegrasi dengan modul SQ Core yang sudah ada, bukan berdiri sendiri. |
| 3 | Ruang kerja ada **dua jenis**: ruang tetap yang mengikuti organ/unit di SQ Hub, dan ruang ad-hoc untuk kepanitiaan. |
| 4 | Aplikasi Cicle dipakai sebagai bahan banding rancangan, bukan untuk ditiru utuh. |
| 5 | Alternatif sumber terbuka ditelusuri lebih dulu sebelum memutuskan membangun sendiri (§4.4). |
| 6 | Tahap sekarang adalah perancangan. Belum ada implementasi. |

## 3. Batas tanggung jawab

| Urusan | **Kerja SQ** | **Di luar modul** |
| --- | --- | --- |
| Papan dan kartu kerja | Membuat, menugaskan, menagih, menutup | — |
| Orang, unit, jabatan | Membaca dari Organization Directory | HCIS tetap pemilik fakta organisasi (ADR-0007) |
| Hak masuk aplikasi | Memeriksa ke Application Access | SQ Hub yang memberi dan mencabut |
| Keanggotaan ruang | Mencatat secara eksplisit di modul ini | Directory hanya memasok calon dan hierarki (§5.3) |
| Pengingat dan penugasan via WA | Menitip ke Kirim SQ | Kirim SQ yang mengirim |
| Notula dan pengesahannya | — | Rapat SQ |
| Keputusan rapat | Menerima sebagai kartu, melaporkan statusnya kembali | Rapat SQ tetap pemilik keputusannya |
| Data barang | Menautkan nomor aset pada kartu | Aset SQ tetap pemilik fakta aset |
| Presensi | — | HCIS dan ADMS |

Yang **tidak** dibangun:

- **Chat.** Lihat §12.2 — ini keputusan sadar, bukan kelalaian.
- **Penyuntingan dokumen bersama.** Lampiran disimpan dan diunduh, tidak disunting di tempat.
- **Absensi.** Check-in harian (§9 R3) adalah laporan kerja, bukan bukti kehadiran. Kehadiran tetap milik ADMS dan HCIS.
- **Master unit organisasi.** Kerja SQ tidak boleh menjadi tempat kedua mendefinisikan struktur yayasan.
- **Notula rapat.** Milik Rapat SQ.
- **Hierarki tugas lebih dari dua lapis.** Kartu dan butir ceklis. Tidak ada sub-sub-tugas.
- **Penyimpanan identitas sendiri.** Tidak ada tabel pengguna di modul ini (§7.3).

## 4. Letak

### 4.1 Modul di dalam SQ Hub

Mengikuti pola Kirim SQ (ADR-0011) dan Rapat SQ: **modul `kerja` di SQ Hub** (API dan web), bukan proses baru di Mi8.

Alasannya sama dan masih berlaku: Mi8 tidak punya memori lega, dan koordinasi kerja adalah kapabilitas lintas domain, bukan domain bisnis tersendiri.

Konsekuensi yang sama pula: tabel berawalan `kerja_`, rute `/api/kerja/*`, dan modul tidak mengimpor modul SQ Hub lain kecuali auth dan Application Access, supaya bisa diekstrak menjadi proses sendiri kelak tanpa membongkar Hub.

### 4.2 Alamat

`kerja.sabilulquran.or.id`, dengan pola edge yang sama seperti `kirim`: `/api/*` ke port API Hub dengan prefiks dicopot, sisanya ke web Hub, `/internal/*` dijawab 404 di edge.

### 4.3 Kenapa ini perlu gate sendiri

Kerja SQ berbeda dari Kirim SQ dan Rapat SQ dalam satu hal yang penting: **volumenya tumbuh terus**, dan sebagian besar pertumbuhan itu adalah lampiran.

| | Kirim SQ | Rapat SQ | **Kerja SQ** |
| --- | --- | --- | --- |
| Baris baru per hari | puluhan | ~nol | ratusan |
| Lampiran | media WA | notula | **berkas kerja harian** |
| Dibuka serentak | 1 admin | sekretariat | **seluruh staf** |

Dua konsekuensi yang harus masuk spesifikasi implementasi:

1. **Lampiran tidak boleh menumpuk di disk Mi8.** Sejalan dengan `sq-core-capacity-and-migration-plan.md` §3.4. Tentukan tujuan penyimpanan sebelum R1 ditulis, bukan sesudah.
2. **Gate memori seperti Kirim SQ.** Ukur RSS Hub API sebelum dan sesudah, dan tetapkan ambang berhenti sebelum fitur ditambah. Angka pembanding: mengaktifkan Kirim SQ menaikkan RSS Hub API dari 93 ke 122 MiB.

### 4.4 Bangun sendiri atau adopsi

Revisi 0 dokumen ini langsung mengasumsikan bangun sendiri tanpa pernah menuliskan alasannya. Itu keputusan besar yang lolos tanpa dibahas, dan di sini diperbaiki.

Enam alat kanban sumber terbuka ditelusuri pada 2026-10-19. Rinciannya di **Lampiran B**; ringkasnya:

| Alat | Nasib |
| --- | --- |
| Planka 2.x | **Gugur.** Lisensi Fair Use, bukan sumber terbuka OSI, dan SSO/OIDC dipindah ke tier berbayar |
| Focalboard | **Gugur.** Mattermost berhenti menerima PR sejak September 2023; versi mandiri beku |
| Wekan | **Gugur.** Butuh ≥1 GiB RAM untuk dirinya sendiri, saran ≥4 GiB total. Mi8 tidak sanggup |
| Taiga | **Gugur.** Multi-layanan (Django, Angular, RabbitMQ, Postgres), berorientasi scrum, ≥2 GiB |
| Kanboard | Teknis layak dan paling ringan, tapi **berstatus maintenance mode** — penulisnya tidak lagi membangun fitur baru |
| **Vikunja** | **Layak.** AGPL-3.0, satu binary Go, bisa SQLite, OIDC Keycloak terdokumentasi dan gratis |

Jadi ada satu kandidat yang benar-benar hidup. Pertanyaannya menjadi: apakah Vikunja sebagai proses terpisah lebih murah daripada modul buatan sendiri?

**Tidak**, karena enam hal berikut — dan keenamnya justru yang membuat modul ini milik SQ Core, bukan sekadar papan kanban:

| | Konsekuensi mengadopsi |
| --- | --- |
| **Proses baru di Mi8** | ADR-0011 menetapkan tidak ada proses baru. Vikunja paling ringan di antara enam, tetapi tetap satu proses dan satu basis data tambahan di host yang MemAvailable-nya sedang diawasi |
| **Penyimpanan identitas kedua** | Semua kandidat punya tabel pengguna sendiri. OIDC menautkan login, tetapi akun bayangan tetap lahir di luar Akun SQ. Offboarding jadi dua tempat, padahal register keputusan menuntut pencabutan akses yang bisa ditelusuri |
| **Application Access tidak dikenali** | Gerbang izin SQ Core tidak ada di alat mana pun. Harus ditambal di edge, dan tambalan izin di edge rapuh |
| **Organization Directory tidak terbaca** | Ruang tetap yang mengikuti organ, usulan keanggotaan, hierarki atasan–bawahan — semuanya tetap harus ditulis sebagai integrasi |
| **Tautan ke Rapat SQ dan Aset SQ** | Tidak ada alat yang punya konsep "kartu ini berasal dari keputusan rapat" atau "kartu ini menyangkut aset nomor sekian" |
| **Bahasa dan istilah** | Antarmuka Indonesia bergantung pada i18n mereka, dan istilahnya tidak akan cocok — board/list/card melawan ruang/papan/kolom/kartu |

**Putusan: bangun sendiri.**

Alasannya bukan "kanban itu mudah" — justru mekanika papannya yang paling banyak jebakan, dan keluhan nyata pengguna Cicle soal geser kartu yang lambat (§13) adalah buktinya. Alasannya adalah perbandingan apa yang dibeli melawan apa yang hilang: adopsi memberi mekanika papan, tetapi membuang seluruh permukaan integrasi — dan permukaan integrasi itulah produknya. Yang tersisa setelah integrasi ditambal bukan penghematan, melainkan dua sistem yang harus dijaga tetap sejalan.

**Kapan putusan ini ditinjau ulang.** Dua pemicu, bukan jadwal:

1. Pengukuran R1 menunjukkan modul jauh lebih berat daripada perkiraan §4.3.
2. Host pindah ke mesin yang lega, sehingga "proses baru" berhenti menjadi larangan.

Pada salah satu pemicu itu, bandingkan ulang Vikunja **sebelum** R2 ditambah, bukan sesudah.

**Yang tetap diambil dari penelusuran.** §6.6 sampai §6.9 — pencarian, urutan, kartu berulang, riwayat perubahan — ada di hampir semua alat yang ditelusuri dan tidak ada sama sekali di revisi 0 dokumen ini. Menelusuri produk yang sudah jadi tetap berguna meski tidak satu pun diadopsi.

## 5. Ruang kerja

### 5.1 Dua jenis

| | **Ruang tetap** | **Ruang panitia** |
| --- | --- | --- |
| Asal | Organ/unit yang terdaftar di SQ Hub | Dibuat manual |
| Contoh | Keuangan, Kurikulum, HCM, SD, SMP | Panitia SPMB 2027, Akreditasi, Renovasi Masjid |
| Calon anggota | Diusulkan dari Organization Directory | Dipilih manual dari Directory |
| Masa berlaku | Selama unitnya ada | **Wajib bertanggal berakhir**, bisa diperpanjang |
| Penanggung jawab | Kepala unit | Ditunjuk saat pembuatan |
| Saat berakhir | — | Otomatis menjadi arsip, isinya tetap terbaca |

Kewajiban tanggal berakhir pada ruang panitia itu disengaja. Tanpa itu, dalam dua tahun daftar ruang akan dipenuhi kepanitiaan yang sudah lama bubar — persis pola yang membuat grup WhatsApp tidak terurus.

### 5.2 Isi ruang

Setiap ruang membawa:

- **Papan** — satu atau lebih, berisi kolom dan kartu (§6)
- **Berkas ruang** — lampiran yang tidak menempel pada kartu tertentu
- **Pengumuman** — siaran ke anggota ruang (R2)
- **Check-in** — laporan kerja harian (R3)

Tidak ada chat di dalam ruang. Diskusi menempel pada kartu, tempatnya ada konteks.

### 5.3 Keanggotaan: diusulkan, bukan diwariskan

Ini titik yang paling mudah salah, dan sudah ada keputusan platform yang mengaturnya.

Register keputusan SQ Hub menyatakan: *perubahan unit/jabatan/status tidak boleh diam-diam memberi atau mencabut Application Access maupun mengubah peran domain; perubahan akses tetap eksplisit.*

Maka Kerja SQ **tidak** menyalin keanggotaan unit menjadi keanggotaan ruang secara otomatis. Yang terjadi:

1. Directory memasok **daftar calon** beserta hierarki atasan–bawahan.
2. Penanggung jawab ruang menerima **usulan perubahan** ketika Directory berubah: "Fulan pindah ke unit ini — tambahkan ke ruang?" dan "Fulanah sudah tidak di unit ini — keluarkan?"
3. Keanggotaan ruang yang berlaku adalah yang tercatat di `kerja_ruang_anggota`, dengan aktor dan waktunya.

Pengecualian yang harus eksplisit: **offboarding**. Ketika Akun SQ dinonaktifkan, akses ke seluruh ruang ikut hilang — ini sudah ditangani di lapisan Application Access dan tidak perlu logika sendiri di modul ini. Yang perlu ditangani modul ini: kartu yang masih ditugaskan ke orang tersebut harus muncul sebagai **yatim** di layar penanggung jawab ruang, bukan menghilang diam-diam.

## 6. Papan dan kartu

Struktur: **Ruang → Papan → Kolom → Kartu → Butir ceklis.** Empat lapis, berhenti di situ.

### 6.1 Anatomi kartu

| Bagian | Bentuk | Catatan |
| --- | --- | --- |
| Judul | wajib | satu-satunya yang wajib saat membuat |
| Uraian | teks kaya | komposer bersama (§6.4) |
| Penanggung jawab | banyak orang | dari anggota ruang |
| Label | berwarna, milik papan | taksonomi tidak dipaksa seragam antar unit |
| Mulai & tenggat | tanggal–waktu | disimpan UTC, ditampilkan 24 jam (§13) |
| Ceklis | banyak, tiap butir punya tenggat, penanggung jawab, lampiran | §6.2 |
| Komentar | dua lapis (§6.3) | |
| Lampiran | berkas | tujuan penyimpanan lihat §4.3 |
| Status selesai | `{status, jenis, pada, oleh}` | **jenis**: `tuntas`, `batal`, `ditunda` |
| Arsip | `{status}` | arsip, bukan hapus |
| Terbaca | daftar orang | siapa sudah membuka |
| Pengingat | empat penanda (§6.5) | |
| Posisi | pecahan | §6.7 |
| Tautan asal | modul + id | §10.2 |

Dua pilihan yang diambil dari Cicle dan layak dipertahankan:

**Status selesai menyimpan `jenis`, bukan sekadar benar/salah.** Tanpa ini, laporan hanya bisa menjawab "berapa yang belum". Dengan ini, laporan bisa menjawab "berapa yang dibatalkan" — dan itu pertanyaan yang jauh lebih berguna untuk pengurus.

**Salin kartu dengan pilihan rinci** — ikut label? ikut penanggung jawab? ikut ceklis? ikut lampiran? Ini membuat templat sekali pakai tanpa membangun fitur templat. Untuk pekerjaan yang benar-benar berulang, lihat §6.8.

### 6.2 Butir ceklis adalah subtugas penuh

Satu butir ceklis bisa punya tenggat, penanggung jawab, dan lampiran sendiri. Kemajuannya diagregasi ke kartu sebagai `{selesai, total}`.

Konsekuensinya: **tidak perlu entitas subtugas terpisah**, dan tidak perlu pohon tugas tanpa batas. Dua lapis cukup untuk hampir semua pekerjaan yayasan, dan pengguna tidak tersesat.

### 6.3 Komentar dua lapis, berhenti di situ

```text
Kartu
  └── Komentar            ← pesan tingkat atas
  │     ├── Balasan
  │     └── Balasan
  └── Komentar
        └── Balasan
```

Balasan tidak bisa dibalas bersarang lagi. Utas yang bisa bercabang tanpa batas selalu berantakan di layar ponsel, dan sebagian besar staf yayasan akan memakai ponsel.

### 6.4 Satu komposer untuk semua

Komposer teks kaya dengan `@sebut` dipakai sama di uraian kartu, komentar, pengumuman, dan check-in. **`@sebut` adalah fasilitas komposer, bukan fitur chat.**

Nama yang bisa disebut diambil dari anggota ruang, bukan dari seluruh yayasan — supaya tidak ada penyebutan lintas ruang yang bocor ke orang yang tidak berhak membaca kartunya.

Satu hal yang harus ikut sejak awal, bukan ditambal kemudian: **pembersihan HTML hasil tempel**, dengan berkas uji sendiri. Teks yang ditempel dari Word atau dari web adalah jalur masuk XSS yang paling sering terlewat.

### 6.5 Pengingat

Empat penanda per kartu: H−1 hari dan H−1 jam, masing-masing untuk **mulai** dan **tenggat**.

```text
pengingat: { mulai_h1hari, mulai_h1jam, tenggat_h1hari, tenggat_h1jam }
```

Tiap penanda dinyalakan setelah terkirim. Ini mencegah pengingat ganda ketika worker berjalan ulang — bagian yang paling sering salah dan paling cepat membuat orang mematikan notifikasi.

Jalur kirimnya: in-app selalu, WhatsApp lewat Kirim SQ bila diaktifkan (§10.1).

### 6.6 Pencarian

Papan yang tumbuh tanpa pencarian akan ditinggalkan dalam enam bulan. Ini bukan fitur tahap akhir.

| | |
| --- | --- |
| **Dicari** | Judul kartu, uraian, isi komentar, nama lampiran, nama butir ceklis |
| **Batas** | Hanya ruang yang diikuti pengguna. Hasil tidak boleh membocorkan keberadaan kartu di ruang yang tidak diikuti |
| **Penyaring** | Ruang, papan, label, penanggung jawab, status selesai dan `jenis`-nya, rentang tenggat, termasuk arsip atau tidak |
| **Mesin** | Pencarian teks penuh PostgreSQL. **Bukan** mesin pencari terpisah — tidak ada proses baru di Mi8 (§4.1) |

R1 wajib: pencarian di dalam satu ruang, dan penyaring pada layar Tugas Saya. Pencarian lintas ruang menyusul setelah biaya indeksnya terukur.

### 6.7 Urutan dan prioritas

**Urutan kartu dalam kolom diatur manual** dengan menggeser, dan disimpan sebagai **posisi pecahan** — menyisipkan satu kartu di antara dua kartu lain hanya menulis satu baris, bukan menulis ulang seluruh kolom. Ini penting di Mi8 dan penting untuk keluhan "geser kartu lambat" di §13.

**Tidak ada field prioritas terpisah di R1.** Label sudah cukup, dan prioritas numerik punya kebiasaan buruk: dalam tiga bulan semua kartu menjadi "tinggi". Kalau nanti terbukti perlu, tambahkan setelah ada bukti pemakaian, bukan sebelumnya.

Urutan baku di layar Tugas Saya: tenggat terdekat lebih dulu, kartu tanpa tenggat di bawah, kartu lewat tenggat di paling atas dan ditandai.

### 6.8 Kartu berulang

Banyak pekerjaan yayasan berulang: laporan bulanan, penutupan kas, persiapan semester, rapat rutin, pelaporan ke dinas.

Ada dua cara, dan pilihannya berpengaruh:

| | Satu kartu yang tenggatnya maju | **Cetakan yang melahirkan kartu baru** |
| --- | --- | --- |
| Riwayat tiap periode | Hilang, tertimpa | **Terpisah dan bisa ditagih** |
| Periode lalu belum selesai | Tidak terlihat | **Terlihat sebagai kartu terlambat** |
| Komentar periode lama | Menumpuk di satu kartu | Tinggal di kartunya sendiri |

**Diambil yang kedua.** Aturannya:

- Cetakan hidup di ruang, bukan di kolom. Isinya sama dengan kartu: judul, uraian, ceklis, label, penanggung jawab baku.
- Jadwal: harian, mingguan, bulanan, atau tahunan pada tanggal tertentu.
- Kartu lahir **H−n sebelum tenggat**, bukan pada hari tenggat — supaya ada waktu mengerjakan. Nilai `n` diatur per cetakan.
- Kalau kartu periode sebelumnya belum selesai, kartu baru **tetap lahir**, dan yang lama tetap terbuka sebagai terlambat. Jangan menahan periode baru karena periode lama macet.

Tahap R2.

### 6.9 Riwayat perubahan kartu

Setiap kartu menyimpan jejak kejadiannya: dibuat, dipindah kolom, ditugaskan atau dilepas, tenggat diubah, ditutup dengan `jenis` apa, dibuka lagi, diarsipkan. Masing-masing dengan aktor dan waktunya.

Alasannya dua: akuntabilitas yayasan, dan menjawab "kenapa ini mundur" tanpa harus bertanya kepada orang.

Batasnya tiga, supaya tidak menjadi beban:

1. **Perubahan teks uraian tidak menyimpan versi.** Hanya dicatat bahwa uraian berubah, oleh siapa dan kapan. Menyimpan versi teks kaya mahal dan jarang dibaca.
2. **Riwayat tidak ikut hilang** ketika kartu diarsipkan.
3. **Ini bukan audit log platform.** Jejak akses, pemberian izin, dan tindakan admin tetap milik SQ Hub. Riwayat di sini hanya tentang isi kartu.

## 7. Data

Tabel berawalan `kerja_`, seluruhnya di basis data SQ Hub (§4.1).

### 7.1 Entitas R1

| Tabel | Isi |
| --- | --- |
| `kerja_ruang` | jenis (`tetap`/`panitia`), nama, rujukan organ (nullable), penanggung jawab, tanggal berakhir (nullable), status |
| `kerja_ruang_anggota` | ruang, orang, peran (`pj`/`anggota`/`peninjau`), dicatat oleh, dicatat pada |
| `kerja_papan` | ruang, nama, urutan |
| `kerja_kolom` | papan, nama, urutan, penanda "kolom ini berarti selesai" |
| `kerja_kartu` | kolom, judul, uraian, mulai, tenggat, selesai `{status, jenis, pada, oleh}`, arsip, posisi, asal `{modul, jenis, id, judul_cache}`, dibuat oleh |
| `kerja_kartu_orang` | kartu, orang — penanggung jawab kartu |
| `kerja_label` | papan, nama, warna |
| `kerja_kartu_label` | kartu, label |
| `kerja_ceklis` | kartu, nama, urutan |
| `kerja_ceklis_item` | ceklis, nama, tenggat, selesai, urutan |
| `kerja_ceklis_item_orang` | butir, orang |
| `kerja_komentar` | kartu, induk (nullable — berisi id komentar bila ini balasan), penulis, isi, dibuat, disunting |
| `kerja_lampiran` | pemilik `{jenis, id}`, nama, kunci penyimpanan, mime, ukuran, diunggah oleh |
| `kerja_terbaca` | objek `{jenis, id}`, orang, pada |
| `kerja_pengingat` | kartu, empat penanda, waktu terkirim masing-masing |
| `kerja_riwayat` | kartu, aksi, aktor, pada, ringkasan nilai lama dan baru |

### 7.2 Entitas tahap berikutnya

| Tabel | Tahap | Isi |
| --- | --- | --- |
| `kerja_apresiasi` | R2 | objek `{jenis, id}`, pemberi, penerima, jenis fitur, isi (§12.1) |
| `kerja_pengumuman` | R2 | ruang, penulis, isi, dibuat |
| `kerja_cetakan` | R2 | ruang, isi kartu baku, jadwal, H−n, aktif (§6.8) |
| `kerja_checkin` | R3 | ruang, orang, tanggal, isi |

### 7.3 Aturan lintas tabel

1. **Tidak ada tabel pengguna.** Identitas selalu subject Akun SQ. Modul ini tidak pernah menyimpan nama, e-mail, atau jabatan sebagai sumber — hanya cache tampilan yang boleh basi dan harus ditandai sebagai cache. Ini yang membedakan modul dari alat adopsi mana pun (§4.4).
2. **Setiap tabel membawa rujukan ruang**, langsung atau lewat induknya. Query tanpa penyaring ruang tidak boleh ada, karena itulah batas kerahasiaan modul ini.
3. **Tidak ada hapus keras** untuk kartu dan komentar. Kartu diarsipkan; komentar ditandai dihapus dan isinya dikosongkan, strukturnya tetap supaya balasannya tidak yatim.
4. **Lampiran menyimpan kunci penyimpanan, bukan berkasnya.** Tujuan penyimpanannya diputuskan sebelum R1 (§4.3, §14 nomor 4).
5. **`asal` tidak pernah menyimpan isi milik modul lain**, hanya rujukan dan judul untuk ditampilkan (§10.2).

## 8. Layar

| Layar | Isi | Siapa |
| --- | --- | --- |
| **Tugas Saya** | Kartu dari seluruh ruang yang diikuti, diurutkan menurut §6.7. Halaman pertama setelah masuk | semua |
| **Daftar ruang** | Ruang tetap dan ruang panitia, dipisah; ruang yang akan berakhir ditandai | semua |
| **Papan** | Kanban: kolom, kartu, geser. Penyaring label dan penanggung jawab | anggota, peninjau (baca) |
| **Kartu** | Panel di sisi papan pada layar lebar, halaman penuh di ponsel | anggota, peninjau (baca) |
| **Pencarian** | §6.6, dengan penyaringnya | semua |
| **Berkas ruang** | Lampiran yang tidak menempel kartu | anggota |
| **Arsip ruang** | Kartu terarsip dan ruang panitia yang sudah berakhir | anggota |
| **Pengaturan ruang** | Anggota dan usulan dari Directory, label, papan, cetakan | penanggung jawab ruang |
| **Pengumuman** (R2) | Siaran ruang | anggota |
| **Check-in** (R3) | Laporan harian ruang | anggota |
| **Admin Kerja SQ** | Jenis ruang, label standar, retensi | `kerja_admin` |

Dua aturan yang berlaku untuk semuanya:

- **Setiap layar utama punya keadaan kosong yang menjelaskan langkah pertama**, bukan sekadar ilustrasi. "Belum ada kartu" tidak berguna; "Buat kartu pertama, atau tarik keputusan dari rapat terakhir" berguna.
- **R1 adalah web responsif, bukan aplikasi ponsel.** Papan harus bisa dipakai pada lebar ponsel sejak hari pertama, karena di situlah sebagian besar staf akan membukanya. Aplikasi ponsel adalah keputusan tersendiri (§14 nomor 7).

## 9. Tahapan

Disusun agar setiap tahap berguna sendiri dan tidak menyandera tahap berikutnya.

### R1 — Papan kerja

Ruang (dua jenis), papan, kolom, kartu, label, penugasan, ceklis, komentar, lampiran, arsip, **Tugas Saya** lintas ruang, pencarian dalam ruang, riwayat perubahan kartu, dan pengingat in-app.

Integrasi di R1: Akun SQ (masuk), Application Access (izin), Organization Directory (orang dan unit). Tidak ada yang lain.

Acceptance criteria usulan:

1. Ruang tetap bisa dibuat dari organ/unit yang ada di SQ Hub, dan calon anggotanya diusulkan dari Organization Directory.
2. Ruang panitia bisa dibuat manual dengan tanggal berakhir wajib.
3. Kartu bisa dibuat, ditugaskan, diberi tenggat, dipindah antar kolom, dan ditutup dengan `jenis` yang dipilih.
4. Butir ceklis bisa punya tenggat dan penanggung jawab sendiri.
5. "Tugas Saya" menampilkan kartu dari seluruh ruang yang diikuti, dalam satu daftar.
6. Pencarian di dalam ruang menemukan kartu menurut judul, uraian, dan komentar, dan tidak pernah menampilkan kartu dari ruang yang tidak diikuti.
7. Riwayat kartu mencatat pemindahan kolom, penugasan, perubahan tenggat, dan penutupan, dengan aktor dan waktu.
8. Pengingat terkirim tepat satu kali per penanda, dibuktikan dengan worker yang dijalankan ulang.
9. Geser kartu antar kolom tetap responsif pada perangkat kelas bawah, diuji pada perangkat nyata (§13).
10. Orang yang tidak punya Application Access ke `kerja-sq` ditolak, dan penolakannya fail-closed.

### R2 — Pengumuman, apresiasi, kartu berulang, dan WhatsApp

Pengumuman per ruang; apresiasi (§12.1); cetakan kartu berulang (§6.8); penanda terbaca; pencarian lintas ruang; dan pengingat lewat Kirim SQ.

Prasyarat: Kirim SQ sudah lewat masa trial dan gate memorinya aman.

### R3 — Check-in dan tautan antar modul

Check-in harian, serta tautan dua arah ke Rapat SQ dan Aset SQ (§10.2).

Prasyarat: Rapat SQ R1 sudah ada; pemilik untuk tiap tautan sudah ditunjuk.

> Register keputusan SQ Hub menetapkan: *scope one real consumer at a time; do not build generic integrations without an identified application and owner.* Karena itu tautan di R3 dibangun satu per satu, bukan sebagai kerangka integrasi umum.

## 10. Integrasi dengan modul lain

### 10.1 Peta

| Modul | Arah | Isi | Tahap |
| --- | --- | --- | --- |
| **Akun SQ** | masuk | SSO realm `sq-staff`. Klien `kerja-sq` (browser, PKCE S256) dan `kerja-sq-api` (mesin), mengikuti bentuk klien `kirim-sq` | R1 |
| **SQ Hub — Application Access** | masuk | Izin masuk aplikasi, eksplisit per orang, fail-closed | R1 |
| **SQ Hub — Organization Directory** | masuk | Orang, unit, jabatan, hierarki. Hanya baca. Usulan keanggotaan (§5.3) | R1 |
| **SQ Hub — registry organ** | masuk | Daftar organ/unit sebagai asal ruang tetap | R1 |
| **HCIS** | **tidak langsung** | Semua fakta organisasi lewat Directory. Modul ini tidak boleh menyentuh tabel HCIS (ADR-0007) | — |
| **Kirim SQ** | keluar | Pengingat tenggat dan pemberitahuan penugasan via WA. Port `WhatsAppSender` dengan adapter `log` + `kirim`, consumer `kerja` | R2 |
| **Rapat SQ** | dua arah | Keputusan rapat → kartu; status kartu → terlihat di rapat berikutnya (§10.3) | R3 |
| **Aset SQ** | dua arah | Kartu menautkan nomor aset untuk perbaikan/peminjaman; Aset SQ menampilkan kartu terbuka pada asetnya | R3 |
| **Ringkasan Yayasan** | keluar | Satu kartu ringkasan per unit untuk organ: kartu terbuka, lewat tenggat, selesai bulan ini. Kerja SQ memiliki angkanya sendiri dan aturan privasinya, sesuai ADR-0009 | R3 |
| **Karir SQ** | masuk | Tahap seleksi melahirkan tugas panitia | demand-led |
| **SPMB / Keluarga SQ** | masuk | Gelombang melahirkan tugas panitia | demand-led |
| **ADMS** | **tidak ada** | Presensi mesin bukan urusan modul ini | — |

### 10.2 Tautan asal: satu mekanisme, bukan sembilan

Semua integrasi masuk memakai bentuk yang sama. Kartu menyimpan:

```text
asal: { modul, jenis, id, judul_cache }
```

Contohnya `{ modul: "rapat", jenis: "keputusan", id: "...", judul_cache: "..." }`.

Aturannya:

- Kerja SQ **tidak** menyimpan isi milik modul asal, hanya rujukan dan judul untuk ditampilkan.
- Ketika kartu ditutup, Kerja SQ memberi tahu modul asal lewat jalur internal. Rapat SQ memakai itu untuk menandai keputusannya selesai.
- Modul asal tetap pemilik faktanya. Kalau Kerja SQ dimatikan, tidak ada data modul lain yang hilang.

Dengan satu bentuk ini, menambah modul asal berikutnya adalah pekerjaan konfigurasi, bukan pekerjaan rancangan ulang. Tetapi tetap: satu pemakai nyata dulu, baru dibangun.

### 10.3 Hubungan dengan Rapat SQ

Ini pasangan yang paling erat, dan batasnya harus tegas:

| | Rapat SQ | Kerja SQ |
| --- | --- | --- |
| Memiliki keputusan rapat | **Ya** | Tidak |
| Memiliki pelaksanaannya | Tidak | **Ya** |
| Menampilkan status tindak lanjut | Ya, dibaca dari Kerja SQ | Ya, sumbernya |
| Berlaku tanpa yang lain | Ya | Ya |

Keduanya harus tetap berguna sendiri-sendiri. Rapat SQ R1 sudah dirancang tanpa Kerja SQ, dan Kerja SQ R1 dirancang tanpa Rapat SQ. Tautan baru muncul di R3.

## 11. Peran dan akses

Dua lapis, dan jangan dicampur.

**Lapis platform** — siapa boleh masuk aplikasi:

| | |
| --- | --- |
| Application Access `kerja-sq` | Diberikan eksplisit per orang di SQ Hub, audited |
| `kerja_admin` | Mengatur jenis ruang, label standar, dan retensi. Usulan pemegang: lihat §14 |

**Lapis ruang** — siapa boleh apa di dalam satu ruang:

| Peran | Kewenangan |
| --- | --- |
| Penanggung jawab ruang | Mengatur papan, anggota, cetakan, dan menutup ruang |
| Anggota | Membuat dan mengerjakan kartu, berkomentar |
| Peninjau | Hanya membaca. Untuk organ dan pengawas |

Tiga catatan:

1. **Tidak meniru enam tingkat peran Cicle.** Yayasan sudah punya hierarki di Directory; menambah hierarki kedua di dalam modul hanya menciptakan dua sumber kebenaran yang bisa berselisih.
2. **Anggota tidak dibuat baca-saja secara bawaan.** Cicle memilih itu, dan akibatnya setiap penugasan harus lewat admin. Untuk yayasan dengan sedikit admin, itu akan macet.
3. **Peran ruang tidak diturunkan dari jabatan.** Kepala unit *diusulkan* sebagai penanggung jawab ruang tetap, tetapi pencatatannya tetap eksplisit — alasan yang sama dengan §5.3.

## 12. Dua keputusan rancangan yang perlu dijelaskan

### 12.1 Apresiasi sebagai primitif, bukan tombol suka

Apresiasi (`kerja_apresiasi`) menempel pada objek apa pun — kartu, komentar, balasan, lampiran, pengumuman, check-in — dan menyimpan `jenis_fitur` serta **penerimanya**.

Alasan merancangnya sejak awal meski baru dipakai di R2: menambahkan reaksi belakangan ke lima jenis objek berarti lima perubahan skema. Merancangnya sekali di awal berarti nol.

Alasan produknya lebih penting: dengan `penerima` yang eksplisit, ini menjadi **pengakuan antar orang**, bukan sekadar "suka". Untuk organisasi yang sebagian besar pekerjanya tidak digaji sebanding dengan bebannya, itu bukan hiasan.

### 12.2 Kenapa tidak ada chat

Cicle punya chat grup dan chat pribadi. Tetapi **halaman tutorial resmi Cicle sendiri menyarankan chat jangan dipakai untuk kerja**, dan mengarahkan pengguna ke papan, pengumuman, dan check-in. Chat ada di sana sebagai jembatan adopsi dari WhatsApp, bukan sebagai tempat kerja.

Untuk SQ Core, membangun chat berarti:

- menambah beban memori yang paling tidak terduga di Mi8 (koneksi hidup, riwayat yang tumbuh tanpa batas);
- bersaing langsung dengan WhatsApp, yang sudah menang;
- memindahkan informasi dari tempat yang punya konteks (kartu) ke tempat yang tidak punya.

Yang dibangun sebagai gantinya: **komentar pada kartu** (ada konteksnya) dan **pengumuman per ruang** (ada penerimanya). Keduanya bisa dikirim ke WhatsApp lewat Kirim SQ, sehingga orang tetap diberi tahu di tempat yang sudah mereka buka.

## 13. Risiko

| Risiko | Penanganan |
| --- | --- |
| **Modul melebar jadi "kantor virtual"** | §3 "yang tidak dibangun" bersifat mengikat. Chat, dokumen bersama, dan absensi ditolak secara eksplisit |
| **Volume dan lampiran membebani Mi8** | Gate memori dan tujuan penyimpanan lampiran ditetapkan **sebelum** R1 ditulis (§4.3) |
| **Geser kartu terasa lambat di ponsel kelas bawah** | Keluhan nyata pengguna Cicle. Posisi pecahan (§6.7) dan pengujian di perangkat kelas bawah sejak minggu pertama, bukan di akhir. Masuk acceptance criteria R1 |
| **Kesalahan zona waktu pada tenggat** | Keluhan nyata pengguna Cicle (pilihan PM kembali jadi AM). Simpan UTC, tampilkan 24 jam, jangan pernah menyimpan string jam lokal |
| **Pencarian lambat setelah data menumpuk** | Pencarian teks penuh PostgreSQL dengan indeks, dan lintas ruang baru dibuka setelah biayanya terukur (§6.6) |
| **Riwayat kartu membengkak** | Tidak menyimpan versi teks uraian (§6.9) |
| **Tumpang tindih dengan Rapat SQ** | §10.3. Keputusan milik Rapat SQ, pelaksanaan milik Kerja SQ |
| **Check-in disalahartikan sebagai absensi** | Dinamai "laporan harian", bukan "kehadiran". Tidak ada jam masuk, tidak ada lokasi, tidak ada foto |
| **Keanggotaan ruang menyimpang dari struktur** | Usulan sinkronisasi dari Directory (§5.3), bukan penyalinan otomatis |
| **Ruang panitia menumpuk** | Tanggal berakhir wajib (§5.1) |
| **Membangun ulang yang sudah ada** | Ditelusuri dan dijawab di §4.4 dan Lampiran B, dengan dua pemicu untuk meninjau ulang |
| **Tidak ada yang memakai** | Mulai dari satu unit yang pekerjaannya paling terlihat. Jangan luncurkan ke seluruh yayasan sekaligus |

## 14. Keputusan terbuka

| # | Pertanyaan | Saran |
| --- | --- | --- |
| 1 | Unit mana yang memakai lebih dulu | **Panitia SPMB.** Pekerjaannya bertenggat, lintas unit, dan sudah ada sekarang — jadi kegunaannya terbukti atau tidak dalam satu gelombang |
| 2 | Siapa `kerja_admin` | **Kepala HCM**, sama dengan `kirim_admin`. Menambah pemegang peran baru menambah orang yang harus dilatih |
| 3 | Modul di Hub atau proses sendiri | **Modul di Hub untuk R1**, dengan pengukuran RSS sebelum/sesudah. Tinjau ulang setelah R1 dipakai sebulan; §4.1 sudah menyiapkan jalan ekstraksi, dan §4.4 menyebut dua pemicu |
| 4 | Di mana lampiran disimpan | **Putuskan sebelum R1 ditulis.** Jangan di disk Mi8. Pilihannya mengikuti keputusan backup/media di rencana kapasitas §3.4 |
| 5 | Retensi kartu dan lampiran ruang yang sudah ditutup | **Kartu dan riwayatnya selamanya, lampiran ditinjau setelah setahun.** Angka usulan, belum dihitung terhadap disk |
| 6 | Apakah peninjau organ melihat seluruh ruang | **Tidak.** Organ melihat Ringkasan Yayasan (angka), bukan isi kartu tiap unit. Beri akses isi hanya bila diminta dan dicatat |
| 7 | Apakah R1 perlu aplikasi ponsel | **Tidak.** Web responsif dulu, tetapi papan wajib bisa dipakai pada lebar ponsel sejak R1 (§8) |

## 15. Langkah berikutnya

1. Wawancara singkat satu kepala unit dan panitia SPMB untuk mengganti asumsi §1.3 dengan angka.
2. Putuskan §14 nomor 1, 2, dan 4. Nomor 3 menunggu pengukuran R1.
3. Tetapkan tujuan penyimpanan lampiran bersama pemilik rencana kapasitas.
4. Baru setelah itu: ADR bila diperlukan (kandidat ADR-0012), lalu spesifikasi `KERJA-IMPL-001` untuk **R1 saja**.

Sebelum langkah 1–3 selesai, tidak ada kode yang ditulis.

## Lampiran A — Apa yang diambil dari Cicle

Cicle (`app.cicle` 3.22.5, PT Bit Aplikasi Masa Depan) dibedah pada 2026-10-19 dari artefak APK dan dokumentasi API publiknya. Hierarkinya `Company → Team → {Boards, Bucket, Group Chat, Blast, Check-in, Schedule} → List → Card`.

Tidak ada yang disalin utuh. Yang diambil polanya.

| Pola Cicle | Diambil | Alasan |
| --- | --- | --- |
| Butir ceklis = subtugas penuh | **Ya** | Dua lapis cukup; menghindari entitas subtugas terpisah |
| Komentar dua lapis, berhenti | **Ya** | Utas bersarang berantakan di ponsel |
| Pengingat berjenjang dengan penanda per pengingat | **Ya** | Mencegah notifikasi ganda |
| Terbaca per objek | **Ya** | Menjawab "sudah dibaca siapa" tanpa menagih |
| Apresiasi polimorfik dengan `jenis_fitur` | **Ya** | Dirancang sekali, dipakai di semua fitur |
| `selesai.jenis` alih-alih benar/salah | **Ya** | Laporan bisa membedakan tuntas, batal, tertunda |
| Salin dengan pilihan rinci | **Ya** | Templat sekali pakai yang murah |
| Satu komposer `@sebut` untuk semua fitur | **Ya** | Perilaku konsisten, satu implementasi |
| "Tugas Saya" lintas ruang | **Ya** | Wajib bila ruang dibuat sebagai silo |
| Berbagi dari OS sebagai jalur masuk berkas | **Ditunda** | Baru relevan kalau ada aplikasi ponsel (§14 nomor 7) |
| Beban kerja dengan satuan bebas | **Ditunda** | Belum ada yang memintanya |
| Kartu publik untuk non-anggota | **Ditunda** | Tambah permukaan privasi tanpa kebutuhan nyata |
| Komentar suara | **Tidak** | Menambah beban penyimpanan dan tidak bisa dicari |
| Chat grup dan pribadi | **Tidak** | §12.2 |
| Enam tingkat peran | **Tidak** | Hierarki sudah ada di Directory |
| Anggota baca-saja secara bawaan | **Tidak** | Akan macet pada yayasan dengan sedikit admin |

Keluhan nyata pengguna Cicle yang menjadi risiko di §13: geser kartu lambat, kesalahan AM/PM pada agenda, berkas harus diunduh berulang.

Yang **tidak** ada di Cicle dan tetap kita butuhkan: pencarian yang memadai, kartu berulang, dan riwayat perubahan kartu. Ketiganya tidak muncul di dokumentasi API publiknya. Itu sebagian alasan mengapa penelusuran Lampiran B tetap dikerjakan.

## Lampiran B — Penelusuran alternatif sumber terbuka (2026-10-19)

Enam alat yang disebut Product Owner, ditelusuri untuk menjawab satu pertanyaan: adakah yang bisa diadopsi alih-alih dibangun? Putusannya di §4.4.

| Alat | Lisensi | Stack | SSO/OIDC | Jejak memori | Status | Nasib |
| --- | --- | --- | --- | --- | --- | --- |
| **Planka 2.x** | "Fair Use License" (fair-code) — **bukan sumber terbuka OSI** | Node + React, Docker | **Pro berbayar** | proses + DB sendiri | aktif, komersial | Gugur |
| **Focalboard** | MIT | Go + React | — | sedang | **beku**, PR tidak ditinjau sejak Sep 2023 | Gugur |
| **Wekan** | MIT | Meteor + Node 26 + MongoDB/FerretDB | SAML, LDAP, OAuth2 | **≥1 GiB untuk dirinya sendiri; saran ≥4 GiB total** | sangat aktif | Gugur |
| **Taiga** | tidak terverifikasi dalam penelusuran ini | Django + Angular + RabbitMQ + Postgres, multi-layanan | — | **≥2 GiB** menurut staf Taiga (pos lama) | aktif | Gugur |
| **Kanboard** | MIT | PHP + SQLite/MySQL/Postgres | lewat plugin | paling ringan | **maintenance mode** — penulis tidak membangun fitur baru | Tidak diambil |
| **Vikunja** | AGPL-3.0 | Go, **satu binary**, SQLite/Postgres/MySQL | **Ya**, Keycloak terdokumentasi, gratis | paling ringan di antara yang hidup | aktif | Kandidat tunggal |

Catatan per alat:

- **Planka** pindah dari MIT ke AGPL-3.0, lalu ke lisensi "Fair Use" pada lini 2.x. Tabel perbandingan di README resminya sendiri menandai "Guest roles, SSO (OIDC)" sebagai fitur Pro, bukan Community. Untuk SQ Core yang seluruh identitasnya bertumpu pada Keycloak, ini mematikan. Ada fork MIT bernama 4gaBoards dari masa sebelum perubahan lisensi; tidak ditelusuri lebih jauh karena fork lama membawa risikonya sendiri.
- **Focalboard** versi mandiri dihentikan Mattermost; fungsinya dilipat ke Mattermost Boards. Deployment lama tetap jalan tetapi tidak menerima pembaruan.
- **Wekan** dipelihara sangat aktif oleh satu orang, tetapi angka memorinya berasal dari dokumentasinya sendiri dan tidak mungkin ditampung Mi8.
- **Taiga** berorientasi scrum (sprint, backlog, story point), bukan papan kerja operasional. Bentuk produknya tidak cocok bahkan seandainya mesinnya cukup.
- **Kanboard** adalah satu-satunya yang jejak memorinya sebanding dengan modul buatan sendiri, dan lisensinya paling longgar. Yang menghentikannya adalah status maintenance mode: mengadopsi alat yang penulisnya sudah berhenti menambah fitur berarti mewarisi pekerjaannya tanpa mewarisi arahnya.
- **Vikunja** adalah pembanding yang jujur: AGPL, satu binary, SQLite, OIDC Keycloak gratis dan terdokumentasi. Ia gugur bukan karena kualitas, melainkan karena enam alasan struktural di §4.4 — dan itu alasan yang berlaku untuk alat mana pun, bukan khusus untuknya.

**Yang diambil tanpa mengadopsi:** pencarian, urutan posisi, kartu berulang, dan riwayat perubahan (§6.6–6.9). Keempatnya ada di hampir semua alat di atas dan tidak ada di revisi 0 dokumen ini.

> Angka lisensi, status pemeliharaan, dan kebutuhan memori di tabel ini berasal dari halaman proyek masing-masing dan agregator pihak ketiga pada 2026-10-19. Beberapa direktori perbandingan masih mencantumkan lisensi Planka yang lama. Verifikasi ulang sebelum dipakai sebagai dasar keputusan belanja atau adopsi.

## Lampiran C — Sumber

- Bedah artefak dan rancangan fitur Cicle: `Projects/cicle-re/` (BEDAH-CICLE-APK.md, RANCANGAN-FITUR-CICLE.md)
- Dokumentasi API Cicle: `api-docs.cicle.app`
- Planka lisensi dan matriks fitur Community/Pro: `github.com/plankanban/planka`, `planka.app/pricing`
- Focalboard status pemeliharaan: `hub.docker.com/r/mattermost/focalboard`, `focalboard.com/docs/personal-edition`
- Vikunja OIDC dan pemasangan: `vikunja.io/docs/openid`, `vikunja.io/docs/installing`
- Kanboard lisensi dan status: `github.com/kanboard/kanboard`
- Wekan lisensi, stack, dan kebutuhan RAM: `github.com/wekan/wekan`
- Taiga kebutuhan mesin: `community.taiga.io`
- Pola modul di dalam Hub: ADR-0011, `kirim-sq-module-design.md` §3.1
- Batas dengan register keputusan: `rapat-sq-module-design.md` §3
- Kendala memori dan penyimpanan: `docs/operations/sq-core-capacity-and-migration-plan.md`
- Keputusan akses eksplisit: `roadmap-and-decision-register.md`, bagian Identity Lifecycle
