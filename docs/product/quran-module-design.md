# Al-Qur'an — Desain modul (PRD)

**Status:** Keputusan Product Owner 2026-11-13 dicatat di §2 dan menjadi dasar ADR-0013 (ACCEPTED). Implementasi menunggu `QURAN-IMPL-001` untuk R1. Butir bertanda `DRAFT` adalah default agent yang menunggu konfirmasi.
**Spesifikasi:** QURAN-001
**Tanggal:** 2026-11-13 (revisi 0)
**Terkait:** ADR-0001 (batas platform), ADR-0007 (Organization Directory), ADR-0008 dan ADR-0010 (realm eksternal), ADR-0011 (pola modul di dalam Hub), ADR-0013 (modul ini), `kerja-sq-module-design.md` (pola ruang dari Directory); HCIS REWARD-001 (`docs/domain/rewards.md` di repo HCIS)
**Referensi luar:** bedah aplikasi HafalanKu 1.8.0 (Lampiran A), hanya sebagai acuan fitur.

## 1. Dasar

### 1.1 Tujuan

Pegawai yayasan bisa membaca Al-Qur'an dalam tampilan **Mushaf Madinah** dari HCIS, menandai bacaan terakhirnya, dan melihat papan skor tilawah seluruh yayasan dan unitnya. Papan skor bulanan menjadi dasar penghargaan di HCIS. Keluarga juga bisa membaca dan menandai, tanpa masuk papan skor.

Modul yang sama nanti dipakai aplikasi mobile HCIS dan Keluarga melalui API yang sama.

### 1.2 Yang tidak termasuk

- Halaqoh, setoran hafalan santri, ujian tahfidz, dan rapor. Itu urusan akademik pondok dan sekolah, jadi modul tahfidz tersendiri bila diputuskan kelak.
- Grup buatan pengguna, kode undangan, obrolan grup.
- Pengenalan suara (simak bacaan dengan AI).
- Penilaian kinerja. Data tilawah tidak menjadi masukan PERF-001 di HCIS.

## 2. Keputusan Product Owner

| # | Keputusan | Tanggal |
| --- | --- | --- |
| K-01 | Bisa diakses dari web HCIS, dan nanti dari aplikasi mobile HCIS | 2026-11-13 |
| K-02 | Bentuknya seperti Kirim: modul sendiri, bisa diakses dari HCIS, dan bisa diakses dari Keluarga | 2026-11-13 |
| K-03 | Nama modul **Al-Qur'an**, tanpa embel-embel "SQ" | 2026-11-13 |
| K-04 | Tampilan **Mushaf Madinah**, memakai aturan awal dan akhir ayat tiap halaman | 2026-11-13 |
| K-05 | Grup **tidak dibuat pengguna**, sudah jadi: **seluruh yayasan** dan **per unit** | 2026-11-13 |
| K-06 | Data **per individu** terlihat, bukan hanya rekap | 2026-11-13 |
| K-07 | **Tidak masuk penilaian**, tetapi **masuk penghargaan** | 2026-11-13 |
| K-08 | Tilawah dihitung **default dengan ketuk ayat → "Tandai terakhir baca"**. Hitung otomatis dan catatan mandiri hanya untuk saat lupa menandai | 2026-11-13 |
| K-09 | **Bookmark ayat** yang bisa menandai **deretan ayat** | 2026-11-13 |
| K-10 | Papan skor **terlihat oleh semua**, filter **seluruh yayasan** atau **unitnya saja**; periode **pekanan, bulanan, sepanjang masa** | 2026-11-13 |
| K-11 | Penghargaan **hanya berdasarkan papan skor** | 2026-11-13 |
| K-12 | Rekomendasi agent untuk tampilan dan perhitungan (§6, §7, §9 dan Q-, M-, S- di Lampiran B) disetujui dengan "Yes, write R0" | 2026-11-13 |

## 3. Batas tanggung jawab

| Hal | Pemilik | Catatan |
| --- | --- | --- |
| Teks, tata letak halaman, font, terjemah, rujukan audio | Modul Al-Qur'an | Salinan verbatim dari penerbit asli (§5) |
| Tanda terakhir baca, catatan tilawah, bookmark | Modul Al-Qur'an | Per identitas `issuer + sub` |
| Grup yayasan dan unit, papan skor | Modul Al-Qur'an | Diturunkan dari Organization Directory saat dibaca, tanpa salinan struktur |
| Orang, unit, unit utama seseorang | HCIS → SQ Hub Organization Directory | ADR-0007; modul hanya membaca |
| Hak masuk pegawai | SQ Hub Application Access `al-quran` | Fail-closed |
| Akun keluarga | Keluarga SQ / realm `sq-keluarga` | ADR-0010 |
| Penghargaan: kandidat, penetapan, pengumuman, riwayat | HCIS REWARD-001 | HCIS membaca papan skor lewat API internal (§11.3) |
| Menu "Al-Qur'an" di HCIS dan Keluarga | Masing-masing aplikasi | Tautan ke `quran.sabilulquran.or.id` dengan SSO senyap |

## 4. Letak

Mengikuti ADR-0011 dan Kerja SQ: **modul `quran` di SQ Hub**, alamat `quran.sabilulquran.or.id`, tabel berawalan `quran_`, rute `/api/quran/*` dan `/internal/quran/*`. Rinciannya di ADR-0013.

Gate yang dipasang, sebagai pengukur:

- **Memori:** ukur RSS Hub API sebelum dan sesudah R1. Konten dibaca dari berkas statis per halaman, tidak dimuat seluruhnya ke memori.
- **Disk:** konten satu edisi sekitar 40 MB (font per halaman ±30 MB, tata letak dan teks ±6 MB, terjemah ±3 MB). Catatan tilawah kecil.
- **Beban serentak:** seluruh pegawai bisa membuka bersamaan selepas salat. Berkas konten dilayani sebagai berkas statis dengan cache panjang dan versi di nama berkas, jadi beban API hanya untuk catatan dan papan skor.

## 5. Konten

### 5.1 Sumber

| Isi | Sumber asli | Catatan |
| --- | --- | --- |
| Teks Arab Uthmani | Tanzil Project, *Uthmani* v1.1 | CC BY 3.0, **tidak boleh diubah**, catatan hak cipta disertakan, tautan ke tanzil.net ditampilkan |
| Batas ayat per halaman | Tanzil `quran-data.js` (`QuranData.Page`, 604 halaman) | Pembanding; yang dipakai adalah tata letak edisi terpilih (§5.3) |
| Tata letak 15 baris (kata per baris) | Quranic Universal Library (QUL, Tarteel), *Mushaf layout* edisi Madinah 1421 H | Lisensi per sumber daya harus dicek (§5.2) |
| Bentuk huruf per halaman | Font KFGQPC (Kompleks Raja Fahd), edisi 1421 H (QCF V2), satu font per halaman | Tidak boleh dimodifikasi |
| Font kepala surah dan basmalah | KFGQPC | sama |
| Terjemah Indonesia | QuranEnc.com, `indonesian_affairs` (Kementerian Agama RI), dengan catatan kaki | Tidak boleh diubah, sumber dicantumkan |
| Nama surah Indonesia | Quran.com API v4 `chapters?language=id` | Hanya nama dan arti surah |
| Audio murattal | quranicaudio.com, distreaming (tidak disalin) | 3 qari awal (DRAFT): Mishary Alafasy, Abdurrahman As-Sudais, Yasser Ad-Dossary |
| Penyorotan ayat saat audio | Data waktu per ayat untuk qari yang sama | Sumber dipastikan di QURAN-IMPL-001; bila tidak ada, audio diputar per ayat |

Data terjemah Kemenag dan teks Tanzil sudah diunduh dan dicek pada 2026-11-13: 114 surah, 6.236 ayat.

### 5.2 Gate lisensi

Sebelum QURAN-IMPL-001 diterima, setiap baris §5.1 dicatat dengan lisensinya, kewajiban atribusinya, dan tanggal pengecekan. QUL menyatakan lisensinya berbeda per sumber daya, jadi tata letak dan font dicek satu per satu. Bila sebuah sumber tidak mengizinkan disimpan dan dilayani sendiri, sumber itu diganti, bukan dipakai diam-diam.

Atribusi tampil di halaman "Tentang mushaf ini".

### 5.3 Edisi dan verifikasi

- Edisi R1: **Mushaf Madinah 1421 H (KFGQPC V2)**, 604 halaman, 15 baris.
- Tes otomatis memeriksa: 114 surah, 6.236 ayat, jumlah ayat per surah, 604 halaman, setiap halaman 15 baris kecuali halaman 1–2 yang berbingkai hias dengan baris lebih sedikit, awal ayat tiap halaman, dan checksum setiap berkas konten.
- Perbandingan awal ayat tiap halaman antara Tanzil dan edisi 1421 H dicatat di Lampiran C. Bila berbeda, yang dipakai tata letak edisi terpilih; Tanzil hanya pembanding.
- Konten diberi **versi** (misalnya `madinah-1421.v1`). Catatan pengguna menyimpan kunci ayat (`surah:ayat`), bukan nomor halaman, jadi pergantian edisi tidak merusak catatan.

## 6. Tampilan mushaf

### 6.1 Halaman

- Halaman mushaf murni: bingkai, kepala surah, baris basmalah, nomor ayat bulat bawaan font, dan penanda juz dan hizb di tepi halaman.
- Terjemah **tidak** disisipkan ke halaman.
- HP: satu halaman. Layar lebar: dua halaman berdampingan seperti mushaf terbuka (halaman **ganjil di kanan**, misalnya Al-Fatihah hlm 1 di kanan dan hlm 2 di kiri).
- Geser ke kanan untuk halaman berikutnya, sesuai arah mushaf.
- Lompat ke halaman, surah, juz, atau hizb. Pencarian nama surah dalam huruf Latin dan Arab.
- Halaman dibuka di posisi terakhir baca.
- Font halaman diunduh per halaman dan disimpan di cache peramban. Halaman sebelum dan sesudahnya dimuat lebih dulu.

### 6.2 Ketuk ayat

Mengetuk satu ayat menyorotnya dan membuka lembar bawah berisi:

1. **Tandai terakhir baca** (tombol utama)
2. Terjemah Kemenag dan catatan kakinya
3. Putar audio dari ayat ini
4. Bookmark ayat ini, atau mulai bookmark deretan ayat (§8)
5. Salin teks ayat beserta rujukannya

### 6.3 Mode terjemah

Mode kedua menampilkan daftar ayat per surah (Arab dan terjemah). Tombol yang sama tersedia pada setiap ayat. Mode utama tetap mushaf.

### 6.4 Audio

Memutar per surah atau mulai dari ayat yang diketuk, dengan ayat yang sedang dibaca disorot bila data waktunya tersedia. Halaman berganti mengikuti bacaan. Audio tidak menghasilkan catatan tilawah.

### 6.5 Tidak ada di R1

Warna tajwid, tafsir, dan terjemah per kata. Ketiganya bisa ditambahkan tanpa mengubah tampilan dasar.

## 7. Tanda terakhir baca dan perhitungan tilawah

### 7.1 Cara utama: tandai terakhir baca

1. Pengguna membaca, mengetuk ayat terakhir yang dibacanya, lalu memilih **Tandai terakhir baca**.
2. Modul menyimpan tanda baru dan menghitung **rentang** dari ayat sesudah tanda sebelumnya sampai ayat yang ditandai. "Tanda sebelumnya" adalah tanda aktif terakhir milik pembaca itu menurut **urutan penyimpanan di server**, bukan menurut tanggal yang dinyatakan.
3. Rentang itu diubah menjadi **halaman** memakai tata letak edisi. Bobot sebuah ayat di sebuah halaman = jumlah kata ayat itu di halaman tersebut ÷ jumlah kata seluruh ayat di halaman itu. Kepala surah dan basmalah tidak berbobot. Ayat yang terbelah dua halaman dihitung per bagian. Bobot disimpan **tanpa pembulatan**; pembulatan satu desimal hanya untuk tampilan.
4. Tanda pertama seseorang hanya menjadi titik awal dan bernilai 0.
5. Skor sebuah tanda dicatat pada **tanggal WIB yang dinyatakan**: hari ini untuk tanda biasa, atau tanggal yang dipilih untuk catatan mandiri.

### 7.2 Aturan

| # | Aturan | Status |
| --- | --- | --- |
| S-01 | Satuan skor adalah **halaman** Mushaf Madinah | Disetujui 2026-11-13 |
| S-02 | Tanda yang **mundur** dari tanda sebelumnya tidak menambah skor dan menjadi titik awal baru (dianggap mulai ulang atau murajaah), kecuali memenuhi S-08 | Disetujui 2026-11-13 |
| S-03 | Paling banyak **60 halaman per tanggal WIB** masuk skor. Kuota diisi menurut urutan penyimpanan tanda pada tanggal itu. Kelebihannya tetap tersimpan, tidak dihitung | Disetujui 2026-11-13 |
| S-04 | Catatan **otomatis** dan **mandiri** masuk skor dan terlihat berlabel di papan skor | Disetujui 2026-11-13 |
| S-05 | Pekan **Senin–Ahad**, bulan kalender, zona waktu **Asia/Jakarta**; hari berganti pukul 00.00 WIB | Disetujui 2026-11-13 |
| S-06 | Kandidat penghargaan diambil dari papan bulanan; aturannya dirinci di HCIS REWARD-001 R-03 | Disetujui 2026-11-13 |
| S-07 | Peringkat sama ditentukan oleh **hari aktif**, lalu **khatam**; bila masih sama, berbagi peringkat | Disetujui 2026-11-13 |
| S-08 | Tanda dianggap **melewati akhir mushaf** (maju) hanya bila tanda sebelumnya berada di 20 halaman terakhir dan tanda baru di 20 halaman pertama. Lompatan mundur lain mengikuti S-02 | DRAFT |
| S-09 | Hanya **tanda terakhir** yang bisa dibatalkan pemiliknya, dan hanya pada tanggal WIB yang sama. Pembatalan mengembalikan tanda sebelumnya sebagai titik acuan. Setelah itu catatan tidak bisa diubah, hanya ditambah | DRAFT |
| S-10 | **Khatam** tercatat ketika halaman **mentah** (tanpa batas S-03) sejak tanda pertama, atau sejak khatam sebelumnya, mencapai 604 **dan** bacaan sudah melewati 114:6 | DRAFT |
| S-11 | Setiap tanda baru, catatan mandiri, atau pembatalan menghitung ulang `quran_daily_scores` untuk tanggal yang terdampak dari seluruh tanda pada tanggal itu menurut urutan penyimpanan | DRAFT |

### 7.3 Cadangan bila lupa menandai

- **Otomatis:** halaman yang terbuka di layar minimal **40 detik** dicatat sebagai *halaman terlihat*. Bila hari itu belum ada tanda, aplikasi menawarkan sekali, saat dibuka lagi: "Tadi Anda membaca sampai halaman 45. Tandai?" Halaman terlihat **tidak masuk skor dengan sendirinya**; ia masuk skor ketika pengguna menyetujui tawaran itu, dan catatannya berlabel *otomatis* (DRAFT).
- **Catatan mandiri:** untuk membaca dari mushaf fisik. Pengguna memilih ayat terakhir yang dibaca, sama seperti menandai, dengan tanggal hari ini atau **paling lambat 2 hari ke belakang** (DRAFT). "2 hari" berarti tanggal kalender WIB: hari ini, kemarin, dan kemarin lusa. Labelnya *mandiri*.

Batas 2 hari membuat papan skor bulanan **final pada tanggal 3 bulan berikutnya pukul 00.00 WIB**. HCIS mengambil papan skor bulanan sesudah waktu itu (§11.3).

### 7.4 Yang tidak dihitung

Mendengar audio, membuka mode terjemah, dan membuka halaman tanpa menandai atau menyetujui tawaran otomatis.

## 8. Bookmark

- Bookmark bisa **satu ayat** atau **deretan ayat** dalam satu surah atau melintasi surah, misalnya 2:255–257 atau 112:1–114:6.
- Cara membuat deretan: ketuk ayat awal → **Mulai tandai deretan** → ketuk ayat akhir → simpan.
- Setiap bookmark punya nama opsional dan satu dari 5 warna. Catatan pribadi pendek (maks. 500 karakter) opsional (DRAFT).
- Deretan disorot tipis di halaman mushaf.
- Daftar bookmark bisa diurutkan menurut urutan mushaf atau waktu dibuat.
- Bookmark sepenuhnya pribadi, tidak terlihat orang lain dan tidak memengaruhi skor.

## 9. Grup dan papan skor

### 9.1 Grup sudah jadi

- **Seluruh yayasan:** semua pegawai yang aktif di Organization Directory dan punya pemetaan identitas Akun SQ.
- **Per unit:** dihitung dari **unit utama** seseorang di Organization Directory beserta unit-unit induknya. Papan skor sebuah unit memuat semua orang yang unit utamanya adalah unit itu atau turunannya. Contoh: papan "SMPIT" memuat SMPIT dan seluruh bagian di bawahnya. Unit dirujuk dengan id Directory `hcis:org-node:<stable_key>`.
- **Unit papan skor** adalah daftar eksplisit yang dipelihara `quran_admin` (`quran_scoreboard_units`), bukan "tingkat sekian" dalam pohon, karena kedalaman struktur yayasan tidak seragam (ada lapisan Mudir Pesantren di atas SMPIT dan PKBM). Isi awal: unit sekolah dan unit operasional yang sama dengan ruang tetap Kerja SQ (DRAFT). Daftar ini juga menjadi cakupan kandidat per unit di REWARD-001.
- Filter **Unit saya** menampilkan pilihan untuk setiap tingkat di atas unit utama pengguna, misalnya "SMPIT" dan "SMPIT › Tata Usaha". Defaultnya unit papan skor tempat pengguna berada (DRAFT).
- Orang yang unit utamanya tidak berada di bawah unit papan skor mana pun tetap ada di papan seluruh yayasan.
- Pindah unit tercermin otomatis karena grup dihitung saat dibaca. Catatan tilawah milik orangnya, jadi skor yang sudah ada ikut pindah. Papan skor periode lalu yang sudah final memakai unit pada saat final (§9.4).
- Tidak ada pembuatan, penggabungan, atau keluar grup.

### 9.2 Isi papan skor

| Kolom | Isi |
| --- | --- |
| Peringkat | Berdasarkan halaman dalam periode |
| Nama dan unit | Dari Organization Directory |
| Halaman | Satu desimal |
| Hari aktif | Hari dengan skor lebih dari 0 dalam periode |
| Khatam | Jumlah khatam dalam periode |
| Label | Ikon kecil bila sebagian skor berasal dari catatan *otomatis* atau *mandiri* |

- **Jam membaca tidak pernah ditampilkan** (disetujui 2026-11-13).
- Peringkat sama ditentukan menurut S-07.
- Pegawai dengan skor 0 tidak diberi baris; papan menampilkan jumlahnya saja, misalnya "34 pegawai belum tercatat pekan ini" (DRAFT).
- Pengguna selalu melihat baris dirinya sendiri disematkan di atas, beserta peringkatnya.

### 9.3 Periode

| Periode | Rentang | Kapan final |
| --- | --- | --- |
| Pekanan | Senin 00.00 – Ahad 23.59 WIB | Rabu pukul 00.00 berikutnya (setelah batas 2 hari) |
| Bulanan | Tanggal 1 – akhir bulan | Tanggal 3 bulan berikutnya pukul 00.00 |
| Sepanjang masa | Sejak catatan pertama | Tidak pernah final, selalu berjalan |

Periode berjalan dan periode sebelumnya bisa dibuka. Periode lama yang sudah final bisa dipilih dari daftar.

### 9.4 Snapshot

Saat sebuah periode pekanan atau bulanan final, modul menyimpan **satu snapshot per periode** yang mencakup papan seluruh yayasan dan setiap unit papan skor: peringkat, angka, dan unit setiap orang saat itu. Papan periode lalu dibaca dari snapshot, jadi tidak berubah karena pindah unit atau koreksi data sesudahnya. Snapshot bulanan inilah yang dibaca HCIS untuk penghargaan.

Snapshot menyimpan **versi dan `asOf` Organization Directory** yang dipakai (ADR-0007). Bila Directory sedang tertinggal (stale) saat waktu final, pembuatan snapshot ditunda dan dicoba ulang tiap jam sampai 24 jam. Sesudah itu snapshot dibuat dengan data Directory terakhir dan diberi tanda `directory_stale`, yang ikut dikirim ke HCIS (DRAFT).

### 9.5 Siapa melihat apa

| Orang | Lihat |
| --- | --- |
| Setiap pegawai dengan akses `al-quran` | Semua papan skor: seluruh yayasan dan setiap unit, semua periode (K-10) |
| Pegawai sendiri | Catatan rinci miliknya: setiap tanda, rentang ayat, label |
| Orang lain | Hanya kolom §9.2; **bukan** rentang ayat atau waktu tanda seseorang |
| Keluarga | Membaca dan menandai untuk dirinya sendiri; tidak melihat dan tidak masuk papan skor |
| `quran_admin` | Sama seperti pegawai, ditambah status konten dan audit. Tidak bisa mengubah catatan orang |

## 10. Akses dan identitas

- **Pegawai:** realm `sq-staff`, Application Access `al-quran`. Akses diberikan eksplisit sekali untuk seluruh pegawai aktif oleh admin. Untuk pegawai baru, pemberian akses adalah **langkah eksplisit** di daftar onboarding, bukan pemberian otomatis dari perubahan Directory (DRAFT, mengikuti aturan register Hub bahwa akses selalu eksplisit).
- **Keluarga (R4):** client tersendiri di realm `sq-keluarga`. Application Access tidak berlaku untuk realm ini (ADR-0010); yang memberi masuk adalah akun keluarga yang aktif di Keluarga SQ. Halaman masuk `quran.sabilulquran.or.id` menawarkan "Masuk sebagai pegawai" dan "Masuk sebagai keluarga". Dua sesi dengan cookie terpisah per realm, tidak pernah bertukar token.
- **Aturan per rute:** rute konten dan rute `me/*` menerima identitas pegawai maupun keluarga. Rute papan skor hanya menerima identitas pegawai; identitas keluarga dijawab 403.
- **Satu orang dua identitas:** pegawai yang juga wali santri punya dua catatan terpisah. Tidak digabung tanpa ADR baru (DRAFT).
- **Pegawai keluar:** akses dicabut di Application Access. Catatannya disimpan; ia hilang dari papan skor berjalan, tetapi tetap ada di snapshot yang sudah final (DRAFT).
- `quran_admin`: Kepala HCM, dapat didelegasikan ke admin SQ Core (DRAFT, sama seperti `kirim_admin` dan `kerja_admin`).

## 11. API

### 11.1 Konten (semua identitas yang sudah masuk)

| Rute | Isi |
| --- | --- |
| `GET /api/quran/v1/edition` | Versi edisi, daftar berkas, checksum, atribusi |
| `GET /api/quran/v1/surahs` | 114 surah: nama Arab, Latin, arti Indonesia, jumlah ayat, tempat turun, halaman awal |
| `GET /api/quran/v1/pages/{1..604}` | Tata letak 15 baris: baris, kata, kode glyph, kunci ayat, penanda juz dan hizb |
| `GET /api/quran/v1/surahs/{n}/translation` | Terjemah dan catatan kaki per ayat |
| `GET /api/quran/v1/package` | Paket lengkap untuk offline (tata letak, teks, terjemah), ETag sesuai versi |
| Berkas font per halaman | Berkas statis berversi dengan cache panjang |

### 11.2 Pribadi

| Rute | Isi |
| --- | --- |
| `GET/POST /api/quran/v1/me/marks` | Tanda terakhir baca; POST membuat tanda baru (utama, otomatis, atau mandiri) dengan `Idempotency-Key` |
| `DELETE /api/quran/v1/me/marks/{id}` | Batalkan tanda hari ini (S-09) |
| `GET /api/quran/v1/me/summary` | Posisi terakhir, skor pekan, bulan, sepanjang masa, khatam |
| `GET/POST/PATCH/DELETE /api/quran/v1/me/bookmarks` | Bookmark satu ayat atau deretan |
| `GET /api/quran/v1/scoreboards` | Papan skor: `scope=foundation\|unit:<unitId>`, `period=week\|month\|all`, `at=<tanggal>`, pagination server-side |

Tanda biasa memakai **waktu server**. Hanya tanda yang diantre saat offline (peramban atau mobile) boleh membawa waktu tanda asli, dan hanya bila masih dalam batas 2 hari (§7.3); di luar batas itu ditolak. Tanda tertunda seperti ini diberi label *tertunda*, yang terlihat oleh pemiliknya dan `quran_admin`, tidak di papan skor (DRAFT).

Papan skor memakai pagination server-side (`page`/`pageSize`, default 25, maks 100, dengan `total`).

### 11.3 Internal untuk HCIS

`GET /internal/quran/v1/scoreboards/monthly?month=YYYY-MM`

- Token `sq-staff` client-credentials, audiens `sq-hub-quran`, scope `quran.scoreboard.read`, hanya untuk konsumen terdaftar. Setiap pembacaan oleh konsumen dicatat di `quran_audit` (konsumen, bulan, waktu).
- Hanya untuk bulan yang sudah final; bulan berjalan dijawab `409 period_not_final`.
- Satu respons berisi **satu snapshot**: cakupan yayasan dan setiap unit papan skor (`hcis:org-node:<stable_key>`), masing-masing berupa daftar peringkat dengan `personId` Directory (`hcis:employee:<uuid>`), unit saat final, halaman, hari aktif, khatam, dan label. Tanpa nama, NIP, atau `sub`.
- Mengembalikan versi snapshot, versi dan `asOf` Directory, serta tanda `directory_stale`, supaya HCIS bisa menyimpan bukti dari mana kandidatnya diambil.

## 12. Data

| Entitas | Isi |
| --- | --- |
| `quran_readers` | `issuer`, `sub`, realm, `personId` Directory bila pegawai, dibuat, terakhir aktif |
| `quran_marks` | pembaca, urutan penyimpanan, kunci ayat, waktu tanda, tanggal WIB yang dinyatakan, jenis (`tanda`, `otomatis`, `mandiri`), tertunda, rentang dari–ke, halaman mentah (tanpa pembulatan), halaman masuk skor, khatam, dibatalkan |
| `quran_bookmarks` | pembaca, ayat awal, ayat akhir, nama, warna, catatan |
| `quran_daily_scores` | pembaca, tanggal, halaman masuk skor, khatam, label (rekap untuk papan skor, dihitung ulang menurut S-11) |
| `quran_scoreboard_units` | daftar unit papan skor (`hcis:org-node:<stable_key>`), diubah `quran_admin` dengan audit |
| `quran_scoreboard_snapshots` | periode, versi, waktu final, versi dan `asOf` Directory, `directory_stale`, baris per cakupan (personId, unit, peringkat, angka) |
| `quran_audit` | admin dan perubahan konten; catatan pengguna sendiri tercatat di `quran_marks` |

Waktu disimpan dalam UTC; tanggal skor dihitung dalam Asia/Jakarta.

## 13. Tahapan

### R1 — Membaca dan menandai (pegawai)

1. Konten edisi Madinah 1421 H terverifikasi (§5) dan dilayani sebagai berkas statis.
2. Tampilan mushaf (§6.1–6.3), satu dan dua halaman, navigasi, posisi terakhir.
3. Tandai terakhir baca, hitung halaman dan khatam, aturan S-01–S-11.
4. Cadangan otomatis dan mandiri (§7.3).
5. Bookmark satu ayat dan deretan (§8).
6. Papan skor pekanan, bulanan, dan sepanjang masa untuk yayasan dan unit, dengan snapshot (§9).
7. Application Access `al-quran`, tile Launcher, dan menu "Al-Qur'an" di HCIS.
8. API internal §11.3 untuk HCIS.

### R2 — Audio

Murattal tiga qari dengan penyorotan ayat bila data waktunya tersedia.

### R3 — Pengingat

Pengingat in-app dan, bila diputuskan, WhatsApp lewat Kirim SQ ("Belum menandai bacaan hari ini"). Jam dan frekuensi diputuskan Product Owner.

### R4 — Keluarga dan mobile

Client `sq-keluarga`, menu di Keluarga SQ, paket offline untuk aplikasi mobile.

Penghargaan berjalan paralel di HCIS (REWARD-001) dan bisa dimulai sesudah R1 menghasilkan snapshot bulanan pertama.

## 14. Risiko

| Risiko | Pengaman |
| --- | --- |
| Lompat tanda untuk menaikkan skor | Batas 60 halaman/hari (S-03), label otomatis/mandiri terlihat, dan penghargaan tetap ditetapkan Kepala HCM di HCIS |
| Tekanan sosial atau riya karena papan terbuka | Keputusan Product Owner (K-10). Yang ditampilkan dibatasi (§9.2–9.5), tidak dipakai untuk penilaian, pegawai skor 0 tidak disebut namanya |
| Lisensi konten | Gate §5.2 sebelum implementasi |
| Teks Al-Qur'an rusak saat diproses | Tes jumlah dan checksum (§5.3); konten tidak pernah diedit tangan |
| Beban serentak di Mi8 | Konten statis dengan cache panjang (§4) |
| Hub mati | Halaman yang sudah dibuka tetap terbaca dari cache; tanda gagal diantre di peramban dan dikirim ulang dengan kunci yang sama |

## 15. Keputusan terbuka (DRAFT, dipakai sampai diubah)

| # | Hal | Default |
| --- | --- | --- |
| D-01 | Hitung otomatis masuk skor hanya setelah disetujui pengguna (§7.3) | Ya |
| D-02 | Catatan mandiri paling lambat 2 hari ke belakang | 2 hari |
| D-03 | Unit papan skor dan default filter "Unit saya" | Daftar eksplisit `quran_scoreboard_units` (§9.1); isi awal mengikuti ruang tetap Kerja SQ |
| D-04 | Pegawai skor 0 hanya ditampilkan sebagai jumlah | Ya |
| D-05 | Pembatalan hanya untuk tanda terakhir, di tanggal yang sama (S-09) | Ya |
| D-11 | Ambang "melewati akhir mushaf" (S-08) | 20 halaman |
| D-12 | Directory tertinggal saat snapshot | Tunda sampai 24 jam, lalu tandai `directory_stale` |
| D-06 | `quran_admin` | Kepala HCM, dapat didelegasikan |
| D-07 | Pemberian akses `al-quran` | Bulk sekali oleh admin, lalu lewat onboarding |
| D-08 | Qari awal | Alafasy, As-Sudais, Ad-Dossary |
| D-09 | Pegawai keluar | Hilang dari papan berjalan, tetap di snapshot final |
| D-10 | Dua identitas untuk satu orang | Tidak digabung |

## 16. Langkah berikutnya

1. Gate lisensi §5.2.
2. `QURAN-IMPL-001` untuk R1, termasuk migrasi, kontrak API, dan rencana tes.
3. HCIS `REWARD-001` ditulis bersamaan supaya kontrak §11.3 disepakati dua sisi.
4. Langkah produksi mengikuti aturan rilis owner 2026-10-27; DNS `quran.sabilulquran.or.id` oleh pemilik DNS.

## Lampiran A — Acuan: HafalanKu 1.8.0

Aplikasi Android HafalanKu (`com.hafalanku.guardian`, React Native/Expo) dibedah pada 2026-11-13 hanya untuk memahami fiturnya. Tidak ada data, kode, atau aset yang dipakai ulang.

| Temuan | Yang diambil untuk desain ini |
| --- | --- |
| Konten berupa JSON polos: teks per kata, terjemah QuranEnc, kotak koordinat ayat dan kata untuk gambar halaman Madinah 1441 H | Konten diambil dari penerbit aslinya (§5). Kami memilih font per halaman, bukan gambar |
| Gambar halaman mushaf diunduh dari server mereka | Tidak dipakai |
| Grup ngaji dengan kode undangan, papan harian, khatam | Diganti grup sudah jadi dari Directory (K-05) |
| Halaqoh, setoran santri, program Arbain | Di luar modul ini (§1.2) |
| Model pengenal bacaan (ONNX, MIT) | Di luar R1 |

## Lampiran B — Rekomendasi yang disetujui 2026-11-13

- **Tampilan:** replika 15 baris dengan font per halaman; edisi 1421 H; warna tajwid belum di R1; font dan data disimpan sendiri; dua halaman di layar lebar; mode terjemah sebagai mode kedua; satuan progres halaman.
- **Terjemah:** Kemenag (QuranEnc `indonesian_affairs`).
- **Audio:** distreaming dari quranicaudio.com, tidak disalin ke Mi8.
- **Penghargaan:** dari papan skor bulanan; 3 teratas seluruh yayasan dan 1 teratas tiap unit sebagai kandidat; Kepala HCM menetapkan; sertifikat dan pengumuman, belum uang (dirinci di HCIS REWARD-001).

## Lampiran C — Verifikasi data 2026-11-13

| Pemeriksaan | Hasil |
| --- | --- |
| Teks Tanzil Uthmani v1.1 | 6.236 ayat, 114 surah, catatan hak cipta di akhir berkas |
| Terjemah QuranEnc `indonesian_affairs` | 114 surah terunduh lengkap |
| Awal ayat tiap halaman: Tanzil `QuranData.Page` vs Quran.com API v4 `verses/by_page` edisi 1421 H (`mushaf=1`, QCF V2) | **604 dari 604 halaman sama** |
| Hal yang sama vs edisi 1405 H (`mushaf=2`, QCF V1) | **604 dari 604 halaman sama** |
| Tata letak baris hlm 604 (contoh) | 73 kata di baris 3, 4, 7, 8, 9, 12, 13, 14, 15. Baris 1–2, 5–6, 10–11 adalah kepala surah dan basmalah untuk 112, 113, 114 |
| Font per halaman | Tersedia untuk V1 dan V2; contoh hlm 604: 38 KB (V1) dan 53 KB (V2) dalam woff2 |

Karena batas halaman Tanzil sama dengan kedua edisi, Tanzil bisa dipakai sebagai pembanding otomatis di tes (§5.3).
