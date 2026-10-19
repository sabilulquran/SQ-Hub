# Rapat SQ — Rancangan modul (PRD)

**Status:** DRAFT / DISCOVERY. Dokumen ini tidak mengizinkan implementasi, pembelian, atau perubahan production.
**Spesifikasi:** RAPAT-001 (usulan). Spesifikasi implementasi belum ada.
**Tanggal:** 2026-10-19 (revisi 1 — menggantikan revisi 0 seluruhnya)
**Terkait:** ADR-0001 (batas platform), ADR-0006 (stack), ADR-0007 (Organization Directory), ADR-0011 + `kirim-sq-module-design.md` (pola modul dan mesin yang bisa diganti)

## 1. Dasar

### 1.1 Masalah

Yang mahal di yayasan bukan merekam suara rapat, melainkan **daur hidup rapat**: agenda, daftar hadir, notula yang disahkan, keputusan, dan penanggung jawab tindak lanjut yang bisa ditagih di rapat berikutnya.

Bagian transkrip bisa dibeli atau diunduh gratis. Bagian yayasannya tidak ada yang menjual: siapa yang wajib hadir menurut struktur HCIS, notula mana yang sudah sah, dan keputusan mana yang belum dikerjakan.

Karena itu **inti modul ini adalah notula resmi dan register keputusan.** Transkripsi hanyalah bahan baku, dan sengaja ditaruh sebagai bagian yang bisa dicopot.

### 1.2 Hasil yang dituju

1. Setiap rapat punya satu tempat: agenda, peserta, daftar hadir, lampiran, notula.
2. Notula punya status yang jelas — draf, disunting, disahkan — dan yang mengesahkan tercatat.
3. Keputusan rapat tidak hilang: tercatat beserta penanggung jawab, tenggat, dan statusnya, serta muncul kembali di rapat berikutnya.
4. Penyusunan notula lebih ringan berkat bantuan AI, **tanpa** menjadikan AI sebagai penentu isi.

### 1.3 Asumsi yang belum diverifikasi

> **DISCOVERY.** Belum ada pendataan. Sebelum spesifikasi implementasi dibuat, perlu dicek ke Sekretariat: berapa rapat per bulan, berapa persen yang daring, berapa peserta rata-rata, dan di mana notula sekarang disimpan. Angka-angka di dokumen ini memakai perkiraan 10 rapat/bulan @ 2 jam.

## 2. Keputusan Product Owner

Keputusan yang sudah diambil dalam diskusi 2026-10-19:

| # | Keputusan |
| --- | --- |
| 1 | SQ Core punya modul khusus rapat. Nama usulan **Rapat SQ**. |
| 2 | Rapat daring memakai Google Meet yang sudah dipakai yayasan. |
| 3 | Ada bantuan AI untuk menyusun notula. |
| 4 | **Transkripsi memakai Whisper sepenuhnya.** Tidak memakai layanan speech-to-text berbayar. |
| 5 | Tidak ada pembelian langganan Google berbayar untuk keperluan modul ini. |
| 6 | Tahap sekarang adalah perancangan. Belum ada implementasi. |

### 2.1 Temuan yang membentuk keputusan di atas

Tiga temuan penelusuran 2026-10-19 yang membatalkan rencana awal "menumpang transkrip Google":

1. **Langganan yayasan adalah Google AI Plus/Pro, paket konsumen, bukan Google Workspace.** Tidak ada Admin Console, tidak ada akun domain di Google, tidak ada service account. Transkrip tersimpan Meet adalah fitur Workspace Business Standard ke atas, jadi tidak tersedia.
2. **Transkrip bawaan Google Meet tidak mendukung bahasa Indonesia.** Daftar resminya hanya 8 bahasa Eropa dan Asia Timur. Artinya membeli Workspace pun tidak menyelesaikan masalah ini. *(Halaman bantuan Google yang memuat daftar ini sudah lama; layak dites ulang, tapi tidak layak dijadikan taruhan.)*
3. **Google Meet Media API** (akses audio waktu-nyata tanpa bot) masih Developer Preview dan menuntut semua peserta terdaftar di program preview. Tidak dipakai.

Konsekuensinya: **Google Meet turun pangkat menjadi sekadar alat panggil video.** Rapat SQ hanya menyimpan tautannya. Tidak ada integrasi Meet REST API, tidak ada urusan retensi 30 hari, tidak ada Calendar conferenceData. Ini menyederhanakan modul secara berarti.

### 2.2 Google for Nonprofits

Yayasan sedang mengajukan Google for Nonprofits. Posisinya terhadap modul ini:

- Paket gratisnya setara Business Starter — **tidak** ada rekaman maupun transkrip Meet. Tidak menyelesaikan apa pun untuk modul ini.
- Business Standard diskon nonprofit (~$3/pengguna/bulan) punya transkrip, tapi tetap tanpa bahasa Indonesia (§2.1 poin 2). **Jangan membelinya demi notula.**
- Nilainya ada di tempat lain dan cukup besar: akun organisasi, Admin Console, dan service account untuk Calendar/Drive. Itu berguna bagi SQ Core secara umum, termasuk sebagai jalan keluar dari e-mail cPanel/Jagoan.

**Kesimpulan:** teruskan pengajuannya, tetapi rancangan Rapat SQ tidak boleh bergantung pada hasilnya.

## 3. Batas tanggung jawab

| Urusan | **Rapat SQ** | **Di luar modul** |
| --- | --- | --- |
| Jadwal dan undangan | Menyimpan jadwal, agenda, daftar peserta | Google Calendar/Meet dipakai apa adanya oleh penyelenggara |
| Ruang daring | Menyimpan tautan Meet yang ditempel penyelenggara | Google Meet menjalankan panggilannya |
| Kehadiran | Daftar hadir yang ditandai notulis | — |
| Transkripsi | Menerima **teks**, menyimpannya, menandai sumbernya | Whisper berjalan di luar server (§5) |
| Notula | Draf AI, penyuntingan, pengesahan, versi final, arsip | — |
| Keputusan | Register keputusan, penanggung jawab, tenggat, status | Aplikasi domain mengerjakan isinya |
| Struktur peserta | Membaca unit/jabatan dari Organization Directory | HCIS tetap pemilik fakta organisasi (ADR-0007) |
| Pemberitahuan | Menitip ke Kirim SQ (WA) dan e-mail | Kirim SQ yang mengirim |

Yang **tidak** dibangun:

- mesin konferensi video sendiri;
- bot yang ikut masuk ke ruang rapat (§5.4);
- manajemen tugas umum — modul ini menagih keputusan rapat, bukan menjadi task manager yayasan;
- penyimpanan video rapat jangka panjang;
- proses transkripsi di dalam server SQ Core pada tahap awal (§5.2).

## 4. Letak

Mengikuti pola Kirim SQ (ADR-0011): **modul `rapat` di SQ Hub** (API dan web), bukan aplikasi atau proses baru. Alasannya sama — Mi8 tidak punya memori lega, dan rapat adalah kapabilitas lintas domain, bukan domain bisnis.

Konsekuensi: tabel berawalan `rapat_`, rute `/api/rapat/*`, dan modul tidak mengimpor modul SQ Hub lain kecuali auth dan Application Access supaya bisa diekstrak kelak.

## 5. Transkripsi

### 5.1 Prinsip: sumber transkrip bisa diganti

Ini pola yang sudah terbukti di Kirim SQ: cangkangnya milik yayasan, mesinnya bisa diganti. Rapat SQ **menerima teks**, dan menyimpan dari mana teks itu berasal. Modul tidak peduli siapa yang menghasilkannya.

```text
Sumber transkrip (bisa dipilih per rapat)
   ├─ ketik manual oleh notulis            ← R1, selalu tersedia
   ├─ Whisper di laptop notulis            ← R2
   └─ Whisper di server SQ Core            ← R3, setelah ada server memadai
            │
            ▼
      teks transkrip ──► Rapat SQ ──► draf AI ──► notula disahkan
```

Nilai pola ini: apa pun yang berubah di dunia transkripsi lima tahun ke depan, sisa modulnya tidak perlu disentuh.

### 5.2 Kenapa tidak di Mi8

| Model Whisper | Butuh RAM | Muat di Mi8 (~1 GiB sisa) | Layak untuk bahasa Indonesia |
| --- | --- | --- | --- |
| tiny | ~270 MB | Ya | Tidak |
| base | ~390 MB | Ya | Tidak |
| small | ~850 MB | Mepet | Marginal |
| medium | ~2,1 GB | Tidak | Ya |
| large-v3 | ~3,9 GB | Tidak | Ya, terbaik |

Model yang muat tidak cukup akurat; yang cukup akurat tidak muat. Ditambah CPU Mi8 juga melayani HCIS, SPMB, dan Kirim SQ. Jadi transkripsi di Mi8 tidak dipertimbangkan.

### 5.3 Whisper: sifat lisensinya

Whisper berlisensi MIT dan bobot modelnya dirilis terbuka. Begitu diunduh, berkasnya milik yayasan selamanya: tidak ada kuota, tidak ada biaya per menit, tidak perlu internet saat dipakai, dan tidak bisa ditarik dari jauh. Perubahan lisensi pada versi mendatang tidak mengubah versi yang sudah ada. Risiko terkunci pada vendor praktis nol.

"Gratis" di sini berarti tanpa biaya lisensi. Mesin dan listriknya tetap ditanggung yayasan.

### 5.4 Yang ditolak

**Bot yang ikut masuk rapat** (pola Vexa, Attendee, dan produk komersial): satu bot sama dengan satu Chrome headless, ratusan MiB per rapat. Mi8 tidak sanggup, polanya rapuh terhadap perubahan halaman Meet, status Ketentuan Layanannya tidak jelas, dan bot perlu akun Google sendiri. Hanya layak ditinjau ulang kalau kelak ada kebutuhan transkrip waktu-nyata yang nyata.

### 5.5 Kebutuhan mesin untuk R3

#### Berapa yang sebenarnya dibutuhkan

Kalau dijalankan **berurutan** — transkripsi selesai dulu, baru peringkasan — puncak pemakaiannya jauh lebih kecil daripada jumlah keduanya:

| Tahap | Puncak RAM |
| --- | --- |
| Whisper `large-v3` | ~4 GB |
| Model bahasa 9B (Q4) | ~6 GB |
| **Puncak bila berurutan** | **~6 GB** |

Jadi mesin 8 GB sudah cukup; 16 GB hanya untuk kelegaan. Dengan `faster-whisper` di CPU tanpa GPU, rekaman 2 jam selesai kira-kira 30–60 menit sebagai tugas latar belakang.

#### Aturan: jangan satu mesin dengan produksi

Dua beban ini bertolak belakang sifatnya:

| | SQ Core produksi | Pekerjaan AI Rapat SQ |
| --- | --- | --- |
| Harus selalu hidup | Ya | Tidak |
| Ada yang menunggu hasilnya | Ya, pengguna | Tidak, notula boleh besok |
| Pola beban | Kecil tapi terus-menerus | Besar tapi sesekali |
| Boleh gagal lalu diulang | Tidak | Ya |

Satu pekerjaan Whisper 45 menit akan menyedot CPU dan RAM sampai Keycloak tersendat — persis jenis masalah yang sedang diawasi pada Mi8 (OPS-MI8-KC-001, Mi8 3,7 GB dengan sisa ~75 MB pada 2026-10-16). **Transkripsi dan peringkasan tidak boleh berbagi mesin dengan produksi SQ Core.**

Justru karena pekerjaan AI tidak menuntut uptime, mesinnya boleh jauh lebih murah dan tidak perlu berada di data center.

#### Pilihan mesin untuk pekerjaan AI

| Pilihan | Biaya | Catatan |
| --- | --- | --- |
| **Mini PC 32 GB di kantor yayasan** | ~Rp 8 jt sekali beli, listrik ~Rp 300rb/tahun | Audio tidak pernah meninggalkan kantor — menyelesaikan pertanyaan privasi secara tuntas, bukan dengan pagar. Mati listrik hanya berarti notula jadi besok |
| VPS 8 GB terpisah | ~Rp 1,2 jt/tahun, selamanya | Audio keluar ke penyedia hosting |

Angka dari agregator pihak ketiga per 2026-10-19 dan perlu diverifikasi ulang sebelum menjadi dasar belanja.

#### Catatan penyimpanan

Audio 10 rapat @ 2 jam dengan retensi 90 hari hanya sekitar 3,5 GB. Tidak masuk hitungan kapasitas.

#### Di luar lingkup dokumen ini

Kapasitas SQ Core produksi sendiri sudah jatuh tempo terlepas dari modul ini, dan perlu dokumen operasi tersendiri. Rapat SQ tidak boleh dijadikan alasan maupun penyandera keputusan itu.

## 6. Pengenalan pembicara

### 6.1 Apa yang bisa dan tidak bisa

Whisper mengubah suara menjadi teks, tetapi **tidak mengenali siapa yang berbicara**. Memisahkan pembicara adalah pekerjaan terpisah bernama *diarization*; alat terbukanya `pyannote.audio`, dan `WhisperX` menggabungkan keduanya.

Hasilnya berupa **label anonim** — "Pembicara 1", "Pembicara 2" — bukan nama orang. Pemberian nama tetap pekerjaan manusia, tetapi cukup sekali per rapat lewat daftar pilihan dari daftar hadir.

### 6.2 Daring versus luring

Anggapan umum bahwa rapat daring otomatis tahu siapa yang bicara **tidak berlaku di sini**. Rekaman Google Meet juga satu jalur tercampur, bukan per peserta. Yang membedakan hanya mutu audionya:

| | Daring (rekaman Meet) | Luring (rekaman ruangan) |
| --- | --- | --- |
| Bentuk audio | Satu jalur tercampur | Satu jalur tercampur |
| Jarak mikrofon | Dekat mulut masing-masing | Jauh, satu untuk semua |
| Gema dan bising | Kecil | Besar |
| Tumpang tindih bicara | Jarang | Sering |

### 6.3 Apakah luring butuh satu mikrofon per orang

**Tidak, dan tidak disarankan.** Tolok ukur AMI menunjukkan selisihnya kecil:

| Penataan | Tingkat kesalahan diarization |
| --- | --- |
| Satu mikrofon per orang (headset) | ~17% |
| Satu mikrofon jauh di tengah ruangan | ~20% |

Selisih ~3 poin tidak sepadan dengan repotnya mengurus sepuluh rekaman terpisah yang harus disinkronkan, apalagi biayanya.

Yang jauh lebih berdampak: **satu mikrofon konferensi omnidirectional di tengah meja** (perkiraan Rp 500rb–1jt). Mutu rekaman lebih menentukan hasil daripada pilihan model mana pun. Ponsel di saku adalah penyebab kegagalan terbesar, dan tidak ada algoritma yang bisa menambal itu.

Catatan teknis untuk pelaksana: akurasi naik bila jumlah pembicara diberitahukan ke pyannote (`min_speakers`/`max_speakers`) — dan Rapat SQ sudah punya angka itu dari daftar hadir.

### 6.4 Yang tidak diambil: pengenalan suara per orang

Secara teknis mungkin mendaftarkan contoh suara pengurus supaya namanya dikenali otomatis. **Tidak diambil**: contoh suara adalah data biometrik, dan konsekuensi privasi serta persetujuannya tidak sepadan dengan penghematan beberapa klik per rapat.

### 6.5 Yang sebenarnya dibutuhkan notula

Notula resmi tidak menuntut atribusi setiap kalimat. Yang wajib tercatat adalah **keputusan dan penanggung jawabnya**, dan itu diisi notulis dari daftar hadir — bukan ditebak mesin. Diarization adalah kemudahan, bukan syarat. Kalau hasilnya buruk, notula tetap bisa disusun.

## 7. Bantuan AI

### 7.1 Posisi

**AI menyusun draf, manusia mengesahkan.** Notula adalah dokumen resmi yayasan.

Keluaran draf yang direncanakan: ringkasan jalannya rapat, daftar keputusan, daftar tindak lanjut beserta usulan penanggung jawab dan tenggat, dan daftar hal yang belum selesai. Setiap butir menyimpan rujukan ke bagian transkrip asalnya supaya notulis bisa memeriksa.

Aturan:

- draf tidak pernah terbit sendiri; status selalu `draf → disunting → disahkan`;
- nama penanggung jawab hanya boleh dipilih dari Organization Directory, tidak dikarang dari transkrip;
- yang mengesahkan adalah pimpinan rapat, identitasnya tercatat;
- transkrip mentah disimpan terpisah dari notula final, dengan akses lebih sempit.

### 7.2 Keputusan yang masih terbuka: model bahasa untuk meringkas

Keputusan "full Whisper" menyelesaikan transkripsi, **tetapi tidak menyelesaikan peringkasnya**. Menyusun notula dari transkrip butuh model bahasa, dan itu pertanyaan terpisah.

| Pilihan | Biaya | Data keluar? | Catatan |
| --- | --- | --- | --- |
| Model bobot-terbuka lokal (Ollama) | Gratis selamanya | Tidak | Butuh RAM 8 GB ke atas. Bisa di laptop notulis dulu, pola yang sama dengan Whisper |
| API model bahasa | Kecil — transkrip 2 jam ≈ 40rb token, di bawah Rp 1.000 per rapat | Ya, berupa teks | Mutu penalaran lebih tinggi. Teks jauh lebih kecil dan mudah disaring daripada audio |
| Tanpa AI | Gratis | Tidak | Notulis mengetik sendiri. Ini yang berlaku di R1 |

Biaya pada baris kedua kecil karena yang dikirim adalah **teks**, bukan audio.

#### Model terbuka yang relevan

**Sahabat-AI** (GoTo + Indosat Ooredoo Hutchison + AI Singapore) adalah model terbuka Indonesia. Versi Gemma 2 9B instruct-nya dilatih dengan sekitar 448 ribu pasang instruksi bahasa Indonesia, ditambah bahasa Jawa dan Sunda — kebetulan tepat sasaran untuk rapat yayasan. Tersedia dalam format GGUF sehingga bisa dijalankan Ollama. Ada juga varian Llama 3.1 70B yang terlalu besar untuk dijalankan sendiri.

Alternatif umum: Qwen, Gemma, Llama, Mistral.

Kebutuhan mesin:

| Model | RAM (kuantisasi Q4) | Mi8 | Laptop 16 GB | Server 8 GB kelak |
| --- | --- | --- | --- | --- |
| Sahabat-AI 9B | ~6 GB | Tidak | Ya | Mepet |
| Model 14B | ~8,5 GB | Tidak | Ya | Tidak |

Kecepatan di CPU tanpa GPU sekitar 6 token/detik untuk model 8B; draf notula ~1.000 kata selesai sekitar 3 menit. Wajar untuk pekerjaan latar belakang.

#### Perbedaan penting dari kasus Whisper

Jangan menyamakan dua keputusan ini:

- **Transkripsi:** Whisper `large-v3` hanya 1,5 miliar parameter dan setara dengan yang terbaik di pasar. Memilih gratis **tidak mengorbankan mutu**.
- **Peringkasan:** model lokal 9B bukan kelas atas. Peringkat bahasa Indonesia pada Artificial Analysis diduduki sepenuhnya oleh model tertutup berbayar; tidak ada model terbuka di papan atasnya. Memilih gratis **ada harganya**.

Pekerjaannya juga lebih berat: menangkap keputusan dari obrolan berantakan, membedakan usulan dari kesepakatan, dan menangkap siapa yang ditugasi meski namanya tidak disebut eksplisit. Itu menuntut penalaran, bukan pengenalan bunyi.

#### Cara memutuskan

Jangan diputuskan di atas kertas. Gabungkan dengan tes akurasi Whisper (§10): ambil satu rekaman rapat asli, hasilkan transkripnya, lalu berikan teks yang sama ke model lokal **dan** ke API berbayar, dan bandingkan dua draf notulanya.

Kalau yang lokal cukup baik, seluruh jalur menjadi gratis dan tidak ada data yang keluar sama sekali. Kalau selisihnya jauh, keputusannya berdasar bukti.

R1 tidak membutuhkan model bahasa sama sekali, jadi keputusan ini tidak menghalangi modul untuk mulai dipakai.

## 8. Peran

| Peran | Kewenangan |
| --- | --- |
| `rapat_admin` | Sekretariat yayasan. Mengatur jenis rapat, templat agenda, dan hak akses modul |
| Penyelenggara | Membuat rapat, menentukan peserta dan agenda, menempel tautan Meet |
| Notulis | Menandai kehadiran, mengunggah transkrip, menyunting draf notula |
| Pimpinan rapat | Mengesahkan notula. Hanya satu orang per rapat |
| Peserta | Membaca notula yang sudah sah dan tindak lanjut miliknya |

Penunjukan notulis dilakukan penyelenggara per rapat.

## 9. Tahapan

Disusun agar setiap tahap berguna sendiri dan tidak menyandera tahap berikutnya.

### R1 — Kerangka rapat (tanpa AI, tanpa Whisper)

Agenda, peserta, daftar hadir, notula diketik manual, pengesahan, register keputusan, lampiran, dan tautan Meet yang ditempel manual.

Acceptance criteria usulan:
1. Rapat bisa dibuat dengan agenda dan daftar peserta yang diambil dari Organization Directory.
2. Notulis bisa menandai kehadiran dan mengetik notula.
3. Pimpinan rapat bisa mengesahkan; setelah sah, notula terkunci dan tercatat siapa yang mengesahkan dan kapan.
4. Keputusan tercatat dengan penanggung jawab, tenggat, dan status, serta muncul di rapat berikutnya selama belum selesai.
5. Tidak ada komponen AI maupun audio sama sekali.

R1 tidak menuntut satu pun keputusan privasi, dan nilainya sudah nyata.

### R2 — Transkrip dari laptop notulis

Notulis menjalankan Whisper di laptopnya sendiri, lalu mengunggah **teks**-nya. Draf AI menyusul (§7.2 harus diputuskan dulu).

Prasyarat: tes akurasi (§10), spesifikasi laptop notulis, dan keputusan model bahasa.

### R3 — Transkripsi di server

Setelah ada server dengan RAM 8 GB ke atas: unggah **audio**, server yang mentranskripsi dan menjalankan diarization. Beban notulis hilang.

Tidak ada tenggat untuk R3; bergantung pada pengadaan server.

## 10. Risiko

| Risiko | Penanganan |
| --- | --- |
| Akurasi Whisper untuk bahasa Indonesia campur Jawa dan istilah Arab belum diketahui | **Tes dulu dengan rekaman rapat asli sebelum R2 dibangun.** Setengah hari kerja, dan hasilnya menentukan apakah R2 layak sama sekali. Sekalian bandingkan draf notula model lokal versus API (§7.2) |
| Mutu rekaman buruk membuat semuanya sia-sia | Mikrofon konferensi di tengah meja (§6.3); tulis panduan merekam untuk notulis |
| Laptop notulis tidak memadai | Cek spesifikasinya sebelum R2; kalau RAM 4 GB, hanya `small` yang jalan dan hasilnya kemungkinan mengecewakan |
| Draf AI dianggap notula final | Status pengesahan wajib; draf tidak pernah terbit sendiri (§7.1) |
| Rapat sensitif ikut terunggah | Tandai jenis rapat; rapat sensitif dilarang memakai jalur AI dan transkripsi otomatis |
| Modul melebar jadi task manager | Register keputusan hanya menagih keputusan rapat (§3) |

## 11. Keputusan terbuka

| # | Pertanyaan | Saran |
| --- | --- | --- |
| 1 | Nama modul | **Rapat SQ**, sejalan dengan Kirim SQ dan Akun SQ |
| 2 | Model bahasa untuk meringkas (§7.2) | Jangan diputuskan sekarang. Tes model lokal (Sahabat-AI 9B) melawan API pada satu transkrip asli, baru putuskan. R1 tidak terhalang olehnya |
| 3 | Siapa `rapat_admin` | Sekretariat yayasan |
| 4 | Retensi audio dan transkrip mentah | Audio 90 hari, transkrip dan notula selamanya. Angka usulan, belum dihitung terhadap disk |
| 5 | Jenis rapat apa saja yang masuk | Mulai dari rapat pengurus dan rapat unit; rapat sensitif ditandai khusus |
| 6 | Apakah R1 saja sudah cukup untuk setahun ke depan | Mungkin. Putuskan setelah R1 dipakai nyata |

## 12. Langkah berikutnya

1. Wawancara singkat Sekretariat untuk mengganti asumsi §1.3 dengan angka.
2. Tes dengan satu rekaman rapat asli: akurasi Whisper (§10), lalu bandingkan draf notula model lokal versus API (§7.2). Satu tes menjawab dua pertanyaan.
3. Putuskan §11 nomor 1 dan 3. Nomor 2 menunggu hasil tes.
4. Baru setelah itu: ADR bila diperlukan, lalu spesifikasi `HUB-IMPL-0xx` untuk R1 saja.

Sebelum langkah 1–3 selesai, tidak ada kode yang ditulis.

## Lampiran A — Penelusuran repo sejenis (2026-10-19)

Tidak ada yang akan di-fork utuh. Yang diambil polanya.

| Repo | Pola | Pakai untuk |
| --- | --- | --- |
| `Zackriya-Solutions/meeting-minutes` (Meetily, MIT) | Whisper.cpp di perangkat pengguna, ringkasan LLM lokal atau API | Referensi utama R2: pola transkripsi di sisi pengguna, dan bentuk prompt ringkasan |
| `AutohostAI/meeting-notes` | Tanpa bot: transkrip → ringkas → kirim ke peserta | Referensi alur pasca-rapat |
| `m-bain/whisperX` | Whisper + pyannote, penyelarasan waktu dan diarization | Referensi teknis §6 |
| `Vexa-ai/vexa` (Apache-2.0) | Bot joiner + API transkrip | Referensi kontrak API dan model data per-penutur. Botnya tidak dipakai |
| `attendee-labs/attendee` | Bot joiner, Django satu image | Referensi daur hidup bot. Tidak dipakai |

Tidak satu pun dari mereka punya pengesahan notula, register keputusan, atau kaitan ke struktur organisasi. Itu justru bagian yang harus dibangun sendiri — dan bagian yang paling tidak akan berubah oleh perkembangan teknologi.

## Lampiran B — Sumber

- Transkrip Meet dan daftar bahasanya: `support.google.com/meet/answer/12849897`
- Edisi Workspace untuk rekaman dan transkrip: pembanding pihak ketiga, perlu verifikasi ulang
- Google for Nonprofits: `google.com/nonprofits`
- Ukuran model Whisper dan kebutuhan RAM: `openwhispr.com/blog/whisper-model-sizes-explained`
- Tolok ukur diarization AMI: model card `pyannote/speaker-diarization-community-1`
- Sahabat-AI: `huggingface.co/Sahabat-AI`, pengumuman GoTo 14 November 2024
- Peringkat model untuk bahasa Indonesia: `artificialanalysis.ai/models/multilingual/indonesian`

Angka dari sumber pihak ketiga perlu diverifikasi ulang sebelum dipakai sebagai dasar keputusan belanja.
