# Sosial & Dakwah — Rancangan modul (PRD)

**Status:** DRAFT / DISCOVERY. Dokumen ini tidak mengizinkan implementasi atau perubahan production.
**Spesifikasi:** SOS-001 (usulan). Spesifikasi implementasi belum ada.
**Tanggal:** 2026-11-09 (revisi 0)
**Terkait:** `docs/domain/ownership-and-integration.md`, ADR-0001, ADR-0006 (stack), ADR-0007 (Organization Directory), ADR-0009 (Ringkasan Yayasan), ADR-0010 (realm keluarga), ADR-0011 + `kirim-sq-module-design.md`, `keuangan-module-design.md` (KEU-001 §2, §6.5), `kerja-sq-module-design.md` (KERJA-001 §1.3, §6.10); SPMB `sq-spmb/docs/product/module-design.md` (SPMB-001 §3, §6.7); Keluarga SQ `sq-keluarga/docs/product/module-design.md`; HCIS ADR-0003 (payroll v1 tanpa honor non-pegawai)

## 1. Dasar

### 1.1 Divisi yang dilayani

Menurut Buku Uraian Jabatan (draf HCM, YSQ/HCM/UJ/030–031), unit ini bernama **Divisi Sosial (Fundraising & Dakwah)**. Ia berada langsung di bawah Direktur sebagai salah satu dari lima unit operasional (KERJA-001 §1.3). Isinya:

| Jabatan | Tanggung jawab utama (± beban) |
| --- | --- |
| Kepala Divisi Sosial | Strategi fundraising: donatur, wakaf, program (30%). Hubungan dan database donatur serta laporan penggunaan dana (25%). Program dakwah dan syiar (20%). Koordinasi kampanye dengan Marketing, Komunikasi & Media (15%). Pembinaan staf dan laporan ke Direktur (10%) |
| Staf Dakwah | Kegiatan dakwah dan syiar (35%). Bahan kampanye dakwah (30%). Dukungan fundraising dan layanan donatur (20%). Administrasi dan laporan kegiatan (15%) |
| Pelaksana lepas (freelance) | Mengajar halaqah, kegiatan lapangan, dan kunjungan calon penerima OTA, dengan klaim uang harian |

Profil Yayasan menyebut "Program Sosial dan Dakwah" sebagai salah satu dari empat kelompok unit dan program. Misi ke-5 yayasan menjadi dasar fungsi sosialnya: memberi kemudahan bagi kalangan tidak mampu untuk mengakses pendidikan lewat program sosial yang amanah dan profesional.

### 1.2 Masalah

- **Belum ada database donatur.** Uraian jabatan meminta divisi ini mengelola hubungan donatur dan melaporkan penggunaan dana, tetapi tidak ada sistem yang menyimpannya di SQ Core.
- **Modul lain menunggu Sosial.** SPMB meneruskan pengajuan OTA ke Sosial. Selama Sosial belum punya aplikasi, Tim Sosial mencatat hasilnya di SPMB lewat peran terbatas (SPMB-001 §6.7). Keuangan juga menunggu keputusan potongan SPP OTA dan evaluasi tahunannya, yang sementara ini diketik staf Keuangan dengan rujukan dokumen (KEU-001 §6.5). Keluarga SQ mencatat Sosial sebagai aplikasi "akan datang".
- **Kegiatan dan klaim pelaksana lepas dicatat di spreadsheet.** "Laporan Harian Freelance Divisi Sosial" (Google Sheets, masih dipakai harian per 2026-11-09) berisi log kegiatan dengan foto bukti, klaim uang harian (tarif bawaan Rp50.000), dan transaksi pembayaran. HCIS tidak menanggung honor non-pegawai di payroll v1 (ADR-0003 HCIS).
- **Homepage publik belum ada.** Website utama punya menu **Sosial & Dakwah** (lihat mockup SPMB), dan Product Owner menyebut `sosialdakwah.sabilulquran.or.id` sebagai homepage divisi. Per 2026-11-09 subdomain itu **belum ada di DNS** (NXDOMAIN).

> **DISCOVERY.** Program yang benar-benar berjalan selain OTA dan halaqah, jumlah donatur, rekening penampung donasi, serta cara laporan ke donatur saat ini belum diwawancarakan dengan Kepala Divisi Sosial. Isi §1.2 berasal dari dokumen dan spreadsheet yang terbaca, bukan dari wawancara.

### 1.3 Hasil yang dituju

1. Setiap donatur tercatat satu kali, beserta riwayat donasinya, kanal yang ia izinkan, dan program yang ia dukung.
2. Setiap donasi punya peruntukan (akad dan program) yang tidak bisa berubah diam-diam, punya tanda terima yang bisa diverifikasi, dan sampai di Kas & Bank Keuangan sebagai **sumber dana terikat**.
3. Keputusan OTA dibuat di Sosial dan sampai ke SPMB dan Keuangan **lewat kontrak**, tanpa diketik ulang.
4. Kegiatan dakwah terjadwal, terlaksana, dan terlaporkan. Klaim pelaksana lepas menjadi permintaan pembayaran yang rapi ke Keuangan.
5. Masyarakat punya satu alamat untuk mengenal program, berdonasi, dan membaca laporan penyaluran.

## 2. Batas tanggung jawab

| Urusan | **Sosial & Dakwah** | **Di luar modul** |
| --- | --- | --- |
| Donatur | Data, segmentasi, riwayat, izin kontak, laporan ke donatur | Keuangan tidak menyimpan profil donatur, hanya rujukan ID |
| Donasi masuk | Mencatat janji dan donasi, mencocokkan bukti transfer, menerbitkan tanda terima donasi | **Keuangan** mengonfirmasi uang benar-benar masuk rekening (§6.2) dan mencatatnya di Kas & Bank (KEU-001 R2) |
| Program dan kampanye | Program, target, periode, progres, laporan | Marketing, Komunikasi & Media memproduksi konten kampanye (lewat Kerja SQ) |
| Beasiswa OTA | Seleksi beasiswa, pasangan donatur asuh, evaluasi tahunan, keputusan potongan SPP | **SPMB** menerima pengajuan dan mengumumkan keputusan akhir. **Keuangan** menerapkan potongan pada tagihan |
| Penyaluran bantuan | Penerima manfaat, keputusan penyaluran, bukti, laporan | **Keuangan** mengeluarkan uangnya lewat permintaan pengeluaran (KEU-001 R3) |
| Kegiatan dakwah | Jadwal, pelaksana, peserta, dokumentasi, laporan | Produksi konten di Marketing, Komunikasi & Media |
| Klaim pelaksana lepas | Log kegiatan, verifikasi Kepala Divisi, rekap klaim per periode | **Keuangan** membayar (R3). **HCIS** memegang data orangnya (kategori `LEPAS`) |
| Homepage publik | Isi dan halaman `sosialdakwah.sabilulquran.or.id` | Website utama hanya menautkan |
| WhatsApp | Menentukan kapan dan isi pesan | Kirim SQ mengirim |

Yang **tidak** dibangun:

- **payment gateway**, virtual account, dan donasi kartu. Transfer manual ke rekening resmi, sama seperti SPMB dan Keuangan;
- **penghimpunan zakat**, sampai yayasan punya dasar hukumnya (§13 nomor 2);
- akuntansi dana. Saldo dana terikat dihitung Keuangan dari Buku Kas per Sumber Dana;
- crowdfunding untuk pihak ketiga dan kampanye atas nama perorangan;
- Dana Sosial Kekeluargaan pegawai (SK HRD 2026-07). Itu urusan HCM, bukan divisi ini.

## 3. Letak

Sosial & Dakwah adalah **domain bisnis** dengan data miliknya sendiri, seperti SPMB dan Keuangan:

- aplikasi sendiri, repository usulan `sabilulquran/sq-sosial`, stack mengikuti ADR-0006;
- **satu alamat untuk publik dan staf:** `sosialdakwah.sabilulquran.or.id` melayani homepage publik, dan `/staf` melayani ruang staf. Ini mengikuti pola SPMB, yang juga melayani halaman publik dan ruang staf dari satu aplikasi;
- database atau schema sendiri. Modul lain membaca dan menulis hanya lewat API Sosial;
- ruang staf masuk dengan Akun SQ staf (`sq-staff`), dengan akses aplikasi lewat SQ Hub Application Access;
- unit dan jabatan dibaca dari Organization Directory (ADR-0007);
- **donatur tidak login** di R1–R4. Laporan sampai lewat WhatsApp atau tautan bertoken yang kedaluwarsa (§13 nomor 4).

**DNS.** Zona `sabilulquran.or.id` ada di akun Cloudflare yayasan, bukan akun yang dipakai agent, jadi rekamannya dibuat oleh pemegang akun tersebut, lewat tunnel Mi8. Jangan arahkan ke hosting lain, untuk menghindari kejadian takeover pada subdomain `ppdb` yang ditinggalkan.

**Kapasitas Mi8.** R0 berupa situs statis tanpa proses baru. R1 menambah satu proses API dan satu web, jadi ukur memori dulu sebelum spesifikasi implementasi (§12).

## 4. Konsep dan entitas

```text
FUNDRAISING (R1)
Donatur ──► Donasi ──► Tanda terima donasi
   │           │  akad (infak/sedekah · wakaf · lainnya) + program  ──► Keuangan: penerimaan per Sumber Dana
   │           └─ Janji donasi / donasi rutin (jadwal)
   └─ Izin kontak, segmen, riwayat interaksi
Program ──► Kampanye (target, periode, progres)  ──► Homepage publik

OTA (R2)
Pengajuan OTA (dari SPMB) ──► Seleksi Sosial ──► Keputusan ──► SPMB (keputusan akhir) + Keuangan (potongan)
Anak asuh ◄──► Donatur asuh (pasangan, opsional)       Evaluasi tahunan ──► keputusan SPP tahun berikut

DAKWAH & KEGIATAN (R3)
Kegiatan (jadwal, tempat, pelaksana) ──► Log pelaksanaan (foto, peserta) ──► Klaim ──► Rekap periode ──► Keuangan

PENYALURAN (R4)
Penerima manfaat ──► Usulan penyaluran ──► Persetujuan ──► Keuangan: pengeluaran ──► Bukti + laporan
```

| Entitas | Isi utama | Catatan |
| --- | --- | --- |
| **Donatur** | Jenis (perorangan, lembaga, komunitas), nama, nama tampilan (boleh "Hamba Allah"), kontak, alamat, **izin kontak per kanal**, segmen, catatan relasi | Data pribadi. Nomor WA dan e-mail disamarkan di daftar. Donatur yang juga orang tua murid atau pegawai cukup diberi rujukan ID, tanpa menyalin datanya |
| **Program** | Nama, jenis (`OTA / Pembangunan / Dakwah / Bantuan / Umum`), akad yang diterima, unit terkait, status | Program menentukan peruntukan dana; daftarnya tidak di-hardcode |
| **Kampanye** | Program, judul, target nominal (opsional), periode, halaman publik, progres | Progres dihitung dari donasi yang sudah dikonfirmasi Keuangan, bukan diketik |
| **Donasi** | Donatur (boleh anonim), program, **akad**, nominal bulat rupiah, tanggal, metode (`Transfer / Tunai / Barang`), bukti, status `Dilaporkan → Dicocokkan → Dikonfirmasi`, atau `Ditolak` | Akad dan program tidak bisa diubah setelah Dikonfirmasi; koreksi lewat **pemindahan peruntukan** yang beralasan dan butuh izin donatur (§5.2) |
| **Donasi rutin** | Donatur, program, nominal, pola bulanan, tanggal pengingat | Hanya pengingat. Tidak ada penarikan otomatis |
| **Donasi barang** | Uraian, perkiraan nilai, penerima, foto | Dicatat untuk laporan dan tanda terima; tidak masuk Buku Kas. Bila menjadi aset tetap, diserahkan ke Aset SQ |
| **Tanda terima donasi** | Nomor, donatur, nominal, akad, program, QR verifikasi | Terbit setelah Dikonfirmasi (§8) |
| **Pengajuan OTA** | Rujukan pendaftaran SPMB, anak, data ekonomi (snapshot), dokumen, hasil seleksi masuk | Datang dari SPMB; Sosial tidak menyalin seluruh pendaftaran |
| **Anak asuh** | Rujukan anak (Keluarga SQ), unit, besaran potongan (uang masuk, SPP), periode berlaku, status | Data anak tetap milik Keluarga SQ |
| **Pasangan donatur asuh** | Donatur, anak asuh atau "dana OTA umum", nominal komitmen, periode | Pasangan bernama hanya bila donatur memintanya (§13 nomor 3) |
| **Evaluasi OTA** | Tahun, anak asuh, kondisi ekonomi terbaru, rekomendasi, keputusan | Hasilnya menjadi keputusan potongan SPP tahun berikut |
| **Kegiatan** | Jenis (kajian, halaqah, daurah, kunjungan, bakti sosial), jadwal, tempat, unit/mitra, pelaksana, sasaran | Kegiatan berulang (mis. halaqah mingguan) memakai pola jadwal |
| **Log pelaksanaan** | Kegiatan, pelaksana, tanggal, jam, peserta (jumlah), foto/nota, uraian | Menggantikan sheet `Log_Kegiatan` |
| **Klaim** | Log, kategori (`Uang harian / Penggantian biaya`), nominal, status `Diajukan → Diverifikasi → Direkap → Dibayar` | Tarif bawaan per kategori diatur Kepala Divisi; mulai dari tarif sheet saat ini |
| **Penerima manfaat** | Perorangan atau keluarga, alamat, kondisi, dokumen, persetujuan pemakaian data | Data paling sensitif di modul ini (§9) |
| **Penyaluran** | Penerima, program, bentuk (uang/barang), nominal, alasan, penyetuju, rujukan pengeluaran Keuangan, bukti serah terima | Uang keluar hanya lewat Keuangan |
| **Laporan** | Periode, program, ringkasan terhimpun dan tersalur, cerita kegiatan, foto yang sudah lolos izin | Versi publik selalu agregat |

Aturan umum, sama dengan Keuangan:

- uang memakai **bilangan bulat rupiah**;
- dokumen dan catatan yang sudah terbit **tidak diubah atau dihapus**; koreksi selalu baris baru;
- progres kampanye dan saldo dana terikat **selalu dihitung**, tidak diketik;
- yang mengusulkan tidak menyetujui usulannya sendiri, dan yang menyetujui tidak membayar;
- aksi yang diulang (retry) tidak menggandakan donasi atau klaim.

## 5. Alur utama

### 5.1 Donasi transfer

1. Donatur mentransfer ke **rekening resmi program** yang tercantum di homepage, lalu melapor lewat formulir **Konfirmasi donasi** di homepage atau lewat WhatsApp Sosial. Isinya nama tampilan, nominal, tanggal, program, akad, dan foto bukti.
2. Staf Sosial **mencocokkan** laporan dengan donatur yang ada, atau membuat donatur baru. Donasi tanpa laporan yang terlihat di mutasi bank dicatat staf dari mutasi.
3. **Kasir Keuangan mengonfirmasi** bahwa dana benar ada di rekening. Sebelum Keuangan R1–R2 berjalan, peran Kasir dijalankan di dalam aplikasi Sosial oleh orang Keuangan (pola Petugas Keuangan di SPMB).
4. Setelah Dikonfirmasi, tanda terima terbit dan, bila donatur mengizinkan, dikirim lewat Kirim SQ bersama ucapan terima kasih. Penerimaan diteruskan ke Keuangan sebagai mutasi masuk dengan **Sumber Dana** sesuai program dan akad.

Donasi tunai di kantor mengikuti alur yang sama, dengan Kasir menerima uang langsung.

### 5.2 Peruntukan dana

- **Akad dan program mengikat.** Dana OTA hanya untuk OTA; wakaf hanya untuk peruntukan wakaf. Setiap donasi membawa keduanya sampai Keuangan.
- Bila program selesai dengan sisa dana, atau donatur salah memilih program, peruntukan dipindah lewat **Pemindahan peruntukan**: beralasan, disetujui Kepala Divisi, dan untuk dana terikat butuh izin donatur yang tercatat. Keuangan menerima pemindahan itu sebagai mutasi antar Sumber Dana.
- **Dana operasional (hak amil).** Bagian donasi yang boleh dipakai untuk biaya operasional divisi belum punya aturan tertulis, jadi bawaan R1 adalah **0%**: semua donasi tersalur penuh ke programnya (§13 nomor 1).

### 5.3 OTA

```text
SPMB: Daftar + ajukan OTA ─► Seleksi masuk ─► (lulus) ─► Sosial: Seleksi beasiswa ─► Keputusan ─► SPMB: keputusan akhir
                                                                     │
                                                                     └─► Keuangan: potongan uang masuk (lewat serah terima SPMB) + potongan SPP
```

1. SPMB mengirim **Pengajuan OTA** saat pendaftar lulus seleksi masuk (SPMB-001 §6.7 butir 4). Isinya snapshot data ekonomi, dokumen OTA, hasil seleksi masuk, dan rujukan anak.
2. Tim Sosial menilai: verifikasi dokumen, **kunjungan rumah** bila perlu (sekarang tercatat sebagai kegiatan "kunjungan calon OTA"), lalu rekomendasi.
3. **Kepala Divisi Sosial memutuskan** `Disetujui (besaran uang masuk + SPP, sesuai tabel program beasiswa SPMB)` atau `Tidak disetujui`. Keputusan dikirim ke SPMB dengan versi dan kunci idempotensi. SPMB yang mengumumkan.
4. Potongan **uang masuk** sampai ke Keuangan lewat serah terima SPMB (KEU-001 §6.1). Potongan **SPP** dikirim Sosial langsung ke Keuangan sebagai keputusan berlaku per tahun ajaran, dengan rujukan keputusan.
5. **Evaluasi tahunan:** setiap Mei (DRAFT), Sosial meninjau semua anak asuh aktif. Hasilnya `Lanjut / Ubah besaran / Berhenti`, dikirim ke Keuangan sebelum tagihan SPP tahun ajaran baru diterbitkan.
6. **Donatur asuh** menerima laporan berkala tentang anak asuhnya: kehadiran dan capaian hafalan secara ringkas, **tanpa** dokumen ekonomi, alamat, atau rapor mentah. Nama anak hanya ditampilkan bila orang tua mengizinkan. Bila tidak, laporan memakai inisial.

Sampai Sosial R2 berjalan, jalur sementara di SPMB (peran Tim Sosial terbatas) dan di Keuangan (entri staf beralasan) tetap dipakai. Begitu kontrak aktif, jalur itu dimatikan.

### 5.4 Kegiatan dan klaim pelaksana lepas

1. Kepala Divisi atau Staf Dakwah membuat **Kegiatan**, satu kali atau berulang, dan menetapkan pelaksananya.
2. Pelaksana mengisi **Log pelaksanaan** dari ponsel: jam, peserta, foto atau nota. Log yang telat lebih dari 3 hari (DRAFT) butuh alasan.
3. Klaim terbentuk otomatis dari log, memakai tarif bawaan kategorinya. Penggantian biaya wajib disertai nota.
4. Kepala Divisi **memverifikasi**. Di akhir periode (bawaan bulanan), aplikasi menyusun **rekap per pelaksana**, yang dikirim ke Keuangan sebagai satu permintaan pengeluaran per pelaksana. Status klaim menjadi Dibayar setelah Keuangan membayar.
5. Pelaksana lepas masuk dengan Akun SQ staf. Orangnya tercatat di HCIS dengan kategori kepegawaian `LEPAS`, sehingga Identity Lifecycle yang membuka dan menutup aksesnya.

### 5.5 Penyaluran bantuan

1. Penerima manfaat dicatat dengan persetujuan pemakaian data.
2. Staf mengusulkan penyaluran: program, nominal atau barang, dan alasannya. Kepala Divisi menyetujui. Penyaluran di atas **Rp5.000.000 per penerima per program per tahun** (DRAFT) juga butuh persetujuan Direktur.
3. Uang keluar lewat permintaan pengeluaran Keuangan (KEU-001 R3), dengan Sumber Dana program itu. Saldo dana terikat yang tidak cukup membuat permintaan ditolak oleh Keuangan.
4. Bukti serah terima (tanda tangan atau foto) diunggah. Penyaluran menjadi bahan laporan.

## 6. Integrasi dengan modul lain

Prinsipnya sama dengan KEU-001 §6: pemilik data yang menulis, peristiwa membawa snapshot dan nomor versi, kunci idempotensi stabil per peristiwa (mis. `sos:ota-<id>:keputusan:v3`), dan jalur manual sementara di modul penerima selama API belum ada.

### 6.1 SPMB

- **SPMB → Sosial:** Pengajuan OTA yang lulus seleksi masuk (§5.3 butir 1), serta penarikan atau pindah program pendaftar yang pengajuannya sedang diproses.
- **Sosial → SPMB:** keputusan OTA dengan besaran. SPMB tidak mengubah keputusan itu, hanya mengumumkannya.
- Perubahan di SPMB: peran **Tim Sosial (OTA)** dicabut setelah adapter aktif. Status "Diteruskan ke Sosial" mengikuti versi keputusan dari Sosial.

### 6.2 Keuangan

- **Penerimaan donasi:** Sosial mengirim donasi Dikonfirmasi (nominal, akad, program, rujukan donatur) dan Keuangan mencatatnya sebagai penerimaan per Sumber Dana. Konfirmasi uang masuk dilakukan Kasir (§5.1 butir 3).
- **Sumber Dana:** setiap pasangan program × akad menjadi satu Sumber Dana di Keuangan. Keuangan menyediakan saldo per Sumber Dana untuk laporan Sosial.
- **Potongan SPP OTA:** keputusan berlaku per tahun ajaran, menjadi Penyesuaian di tagihan dengan rujukan keputusan Sosial (KEU-001 §6.5).
- **Pengeluaran:** penyaluran dan rekap klaim menjadi permintaan pengeluaran. Sosial menerima balik statusnya (Disetujui, Dibayar, Ditolak).
- Sebelum Keuangan punya API, keempatnya dicatat lewat peran Kasir di Sosial dan entri staf beralasan di Keuangan.

### 6.3 Keluarga SQ

- Sosial hanya menyimpan **rujukan anak dan keluarga**. Nama, NIK, dan KK tetap dibaca dari Keluarga SQ bila perlu.
- Keluarga melihat status pengajuan OTA lewat SPMB, bukan lewat Sosial. Besaran potongan SPP terlihat di tagihan Keuangan.
- Persetujuan orang tua untuk menampilkan nama anak ke donatur asuh dicatat di Keluarga SQ (R2) dan dibaca Sosial.

### 6.4 Kirim SQ

- Pesan: terima kasih + tanda terima, pengingat donasi rutin, laporan kampanye, laporan anak asuh, dan pengingat jadwal kegiatan untuk pelaksana.
- Lewat port `WhatsAppSender` dengan adapter `log` dan `kirim`. Kirim SQ sudah mencatat **Sosial** sebagai calon pemakai dengan nomor sendiri (KIRIM-001 §1 dan §7). Sampai memori Mi8 cukup, Sosial memakai adapter `log` dan nomor yang ada secara manual (§13 nomor 6).
- **Pesan hanya dikirim ke donatur yang mengizinkan kanal itu.** Setiap pesan siaran punya cara berhenti berlangganan.
- **AI boleh menyarankan balasan** di kotak masuk, tetapi staf yang mengedit dan mengirimnya. Tidak ada balasan otomatis.

### 6.5 Kerja SQ dan Marketing, Komunikasi & Media

- Permintaan konten kampanye dan materi syiar diajukan lewat **pintu permintaan** ruang Marketing, Komunikasi & Media di Kerja SQ (KERJA-001 §6.10). Sosial tidak membuat alur permintaan desain sendiri.
- Ruang kerja divisi di Kerja SQ dipakai untuk tugas internal. Kegiatan dakwah yang perlu jadwal, pelaksana, dan klaim tetap dicatat di modul ini.

### 6.6 HCIS

- Pelaksana lepas tercatat di HCIS sebagai `LEPAS`. HCIS tidak menghitung honornya (di luar payroll v1); rekap klaim dibayar Keuangan.
- Staf Dakwah dan Kepala Divisi adalah pegawai biasa. Modul ini tidak menyimpan data kepegawaian.

### 6.7 SQ Hub

- **Organization Directory:** unit dan jabatan untuk peran dan persetujuan.
- **Application Access:** siapa boleh membuka ruang staf. Peran di dalam aplikasi diatur modul ini.
- **Ringkasan Yayasan (ADR-0009):** dana terhimpun dan tersalur per program, jumlah donatur aktif, jumlah anak asuh, dan kegiatan terlaksana per bulan. Hanya angka agregat.

### 6.8 Aset SQ

Donasi barang yang menjadi aset tetap (mis. kendaraan, peralatan, atau wakaf tanah dan bangunan) diserahkan ke Aset SQ dengan rujukan donasi dan tanda terimanya.

## 7. Peran

| Peran | Kewenangan | Tidak bisa |
| --- | --- | --- |
| Kepala Divisi Sosial | Semua data divisi, memutuskan OTA, menyetujui penyaluran dan pemindahan peruntukan, memverifikasi klaim, mengatur program dan tarif | Mengonfirmasi uang masuk; menyetujui penyaluran yang ia usulkan sendiri di atas batas (naik ke Direktur) |
| Staf Dakwah | Donatur, mencatat dan mencocokkan donasi, kegiatan, log, usulan penyaluran, menyiapkan laporan | Memutuskan OTA, menyetujui penyaluran, mengonfirmasi uang masuk |
| Pelaksana lepas | Melihat jadwalnya, mengisi log dan klaim **miliknya sendiri** | Melihat donatur, penerima manfaat, dan klaim orang lain |
| Kasir (Keuangan) | Mengonfirmasi donasi masuk, membayar rekap klaim dan penyaluran | Mengubah peruntukan dana |
| Direktur | Menyetujui penyaluran di atas batas, membaca semua laporan | — |
| Pengamat (Pengurus, Pengawas) | Membaca laporan agregat | Membaca data pribadi donatur dan penerima |

Peran yang bisa membuka data donatur atau penerima manfaat wajib MFA (`staff-authentication-policy.md`). Divisi ini kecil (dua orang tetap), jadi pemisahan wewenang bergantung pada Kasir dan Direktur sebagai pihak kedua. Batas persetujuan di §5.5 dibuat dengan kondisi itu dalam pikiran.

## 8. Dokumen resmi

| Dokumen | Nomor usulan |
| --- | --- |
| Tanda terima donasi | `TTD/SOS/<tahun>/<urut>` |
| Keputusan beasiswa OTA | `KEP/SOS/OTA/<tahun ajaran>/<urut>` |
| Berita acara penyaluran | `BAP/SOS/<tahun>/<urut>` |

- Urutan tanpa lompatan per jenis per periode, dijamin database. PDF dibuat sekali saat terbit, disimpan dengan checksum, dan ber-QR verifikasi.
- **Halaman verifikasi** di `sosialdakwah.sabilulquran.or.id/v/<kode>` hanya menampilkan nomor, tanggal, nominal, program, dan nama tampilan donatur.
- Tanda terima donasi bukan kuitansi penagihan, jadi tidak mengikuti standar tagihan SPMB-001 §7.1. Kewajiban bea meterai dan apakah tanda terima bisa dipakai donatur sebagai pengurang penghasilan kena pajak perlu dikonfirmasi ke konsultan pajak yayasan (§13 nomor 7).

## 9. Privasi, keamanan, audit

- **Penerima manfaat dan data ekonomi OTA** adalah data paling sensitif di SQ Core setelah gaji. Data ini hanya terlihat oleh Kepala Divisi dan staf yang menangani kasusnya, tidak pernah tampil di homepage atau laporan publik, dan tidak masuk log atau payload audit umum.
- **Foto penerima dan anak** hanya dipublikasikan dengan persetujuan tertulis yang tercatat, dan tunduk pada kebijakan perlindungan anak Marketing, Komunikasi & Media. Bawaannya: tanpa wajah anak.
- **Donatur anonim** tampil sebagai "Hamba Allah" di semua keluaran publik dan laporan ke donatur lain. Identitas aslinya hanya terlihat oleh peran berwenang.
- Kontak donatur hanya dipakai untuk kanal yang diizinkan. Permintaan hapus data donatur menyamarkan profil, tetapi tetap menyimpan catatan donasinya untuk audit dana.
- Bukti transfer, nota, dan dokumen OTA disimpan privat dengan tautan sementara; PDF, JPEG, PNG, maks. 5 MiB.
- Audit mencatat pembuatan dan perubahan donatur, setiap donasi beserta perubahan statusnya, pemindahan peruntukan, keputusan OTA, verifikasi klaim, penyaluran, pengiriman pesan siaran, dan setiap peristiwa lintas modul beserta versinya.
- Formulir publik (konfirmasi donasi) dilindungi Turnstile dan pembatas laju, tidak meminta data selain yang diperlukan, dan tidak pernah menampilkan data donatur lain.

## 10. Tampilan

Mengikuti SQ Core design system C dan app shell. Teks antarmuka menulis "Sabilul Qur'an", tidak disingkat "SQ".

**Homepage publik** (`sosialdakwah.sabilulquran.or.id`):

- Beranda: siapa kami, program unggulan, kampanye berjalan beserta progresnya, jadwal kajian terdekat;
- Program: satu halaman per program (OTA, pembangunan, dakwah, bantuan), dengan rekening resmi dan cara berdonasi;
- Kegiatan: jadwal kajian dan halaqah yang terbuka untuk umum;
- Laporan: laporan berkala per program (PDF), angka terhimpun dan tersalur;
- Konfirmasi donasi, dan verifikasi tanda terima (`/v/<kode>`);
- Kontak: WhatsApp Sosial.

Website utama menautkan menu **Sosial & Dakwah** ke sini.

**Ruang staf** (`/staf`): **Ringkasan**, **Donatur**, **Donasi** (Masuk, Perlu dicocokkan, Donasi rutin), **Program & kampanye**, **OTA** (Pengajuan, Anak asuh, Evaluasi), **Kegiatan** (Jadwal, Log, Klaim), **Penyaluran**, **Laporan**, **Pengaturan**.

Pelaksana lepas memakai tampilan ponsel yang hanya berisi **Jadwal saya** dan **Isi laporan kegiatan**.

Aksen kategori: belum dipilih (biru dipakai SPMB, oranye dipakai Karir).

## 11. Tahapan

| Rilis | Isi | Menggantikan |
| --- | --- | --- |
| **R0 · Homepage** | Situs statis: beranda, program, rekening resmi, jadwal kegiatan, kontak WhatsApp, laporan PDF. Isi diperbarui lewat repository. Tanpa proses baru di Mi8 | Belum ada |
| **R1 · Donatur & donasi** | Donatur, program, kampanye, donasi (transfer, tunai, barang), konfirmasi donasi publik, peran Kasir, tanda terima + verifikasi, progres kampanye di homepage, pengiriman ke Keuangan (adapter manual sampai KEU R2), pesan terima kasih | Catatan donatur yang tersebar |
| **R2 · OTA** | Pengajuan dari SPMB, seleksi, keputusan ke SPMB dan Keuangan, anak asuh, pasangan donatur asuh, evaluasi tahunan, laporan anak asuh | Peran Tim Sosial terbatas di SPMB; entri staf beralasan di Keuangan |
| **R3 · Kegiatan & klaim** | Jadwal kegiatan, log dari ponsel, klaim, verifikasi, rekap per periode ke Keuangan | Spreadsheet "Laporan Harian Freelance Divisi Sosial" |
| **R4 · Penyaluran** | Penerima manfaat, usulan, persetujuan, permintaan pengeluaran, bukti, laporan publik agregat | Belum diketahui (DISCOVERY) |

Urutan R1–R3 adalah **saran**, bukan keputusan (§13 nomor 5). R3 menggantikan spreadsheet yang dipakai setiap hari dan tidak bergantung pada modul lain, jadi R3 bisa didahulukan bila Kepala Divisi lebih membutuhkannya. R2 harus siap sebelum gelombang SPMB yang membuka OTA. Program OTA ditutup untuk 2026/2027, jadi tenggatnya paling cepat SPMB 2027/2028.

## 12. Risiko

| Risiko | Penanganan |
| --- | --- |
| Memori Mi8 tidak cukup untuk satu aplikasi lagi | R0 statis tanpa proses. Ukur sebelum spesifikasi R1; opsi menggabungkan R3 ke aplikasi lain ditolak karena data klaim milik divisi ini |
| Dana terikat terpakai di luar peruntukannya | Akad dan program terkunci setelah Dikonfirmasi; pemindahan beralasan dengan izin donatur; Keuangan menolak pengeluaran melebihi saldo Sumber Dana |
| Divisi kecil sehingga satu orang memegang semua langkah | Konfirmasi uang masuk oleh Kasir Keuangan; persetujuan Direktur di atas batas; audit lengkap |
| Data penerima manfaat atau anak bocor ke publik | Laporan publik selalu agregat; foto butuh persetujuan tercatat; bawaannya tanpa wajah anak |
| Pesan siaran dianggap spam dan nomor WhatsApp diblokir | Hanya ke donatur yang mengizinkan; berhenti berlangganan; nomor Sosial terpisah dari nomor modul lain (KIRIM-001) |
| Menghimpun zakat atau wakaf uang tanpa dasar hukum | Bawaannya tidak menerima zakat; wakaf uang hanya bila syaratnya terpenuhi (§13 nomor 2) |
| Subdomain dibuat di luar tunnel Mi8 lalu ditinggalkan | DNS hanya lewat tunnel Mi8, dan dihapus bila layanan dipensiunkan |

## 13. Keputusan terbuka

Semua saran di bawah adalah asumsi **DRAFT** sampai Product Owner atau Kepala Divisi Sosial menetapkannya.

| # | Pertanyaan | Saran |
| --- | --- | --- |
| 1 | Berapa bagian donasi boleh dipakai untuk biaya operasional divisi? | **0%** sampai ada kebijakan tertulis; semua tersalur ke programnya |
| 2 | Akad apa yang diterima? | **Infak/sedekah dan donasi program.** Zakat **tidak** diterima sampai yayasan punya izin LAZ atau menjadi UPZ (UU 23/2011). Wakaf uang hanya bila yayasan terdaftar sebagai nazhir di BWI; wakaf benda dicatat sebagai donasi barang dan diserahkan ke Aset SQ |
| 3 | OTA: dana dikumpulkan bersama atau satu donatur untuk satu anak? | **Dana OTA umum** sebagai bawaan. Pasangan bernama hanya bila donatur memintanya dan orang tua mengizinkan |
| 4 | Apakah donatur perlu login? | **Tidak** di R1–R4. Laporan lewat WhatsApp dan tautan bertoken. Realm donatur dinilai ulang bila donatur rutin melewati ±200 orang |
| 5 | Urutan rilis | **R0 → R3 → R1 → R2 → R4** bila Kepala Divisi lebih butuh mengganti spreadsheet klaim; **R0 → R1 → R2 → R3 → R4** bila fundraising lebih mendesak |
| 6 | Nomor WhatsApp Sosial | Tunda sampai memori Mi8 cukup; sementara pakai adapter `log` dan kirim manual dari nomor divisi |
| 7 | Bea meterai dan status pajak tanda terima donasi | Konfirmasi ke konsultan pajak yayasan sebelum R1 |
| 8 | Batas penyaluran yang butuh Direktur | Rp5.000.000 per penerima per program per tahun |
| 9 | Jadwal evaluasi OTA tahunan | Mei, supaya keputusan sampai sebelum tagihan SPP Juli |
| 10 | Rekening penampung donasi | Satu rekening per kelompok akad (infak, wakaf), bukan per program. Program dibedakan lewat laporan donatur atau kode unik |

## 14. Langkah berikutnya

1. Wawancara Kepala Divisi Sosial: program yang berjalan, jumlah dan bentuk data donatur sekarang, rekening yang dipakai, cara laporan ke donatur, dan jawaban §13 nomor 1, 2, 3, 5, 10. Hasilnya mengganti catatan DISCOVERY di §1.2.
2. Pemegang akun Cloudflare yayasan membuat rekaman `sosialdakwah` lewat tunnel Mi8 saat R0 siap terbit, tidak lebih awal.
3. R0 (homepage statis) boleh dikerjakan setelah langkah 1, karena tidak menambah proses dan tidak menyimpan data pribadi.
4. Ukur kapasitas Mi8 untuk satu aplikasi lagi.
5. Konfirmasi pajak dan meterai (§13 nomor 7).
6. Baru setelah itu: ADR bila diperlukan, lalu spesifikasi implementasi `SOS-IMPL-001` untuk rilis pertama setelah R0.

Selain R0, tidak ada kode yang ditulis sebelum langkah 1–5 selesai.
