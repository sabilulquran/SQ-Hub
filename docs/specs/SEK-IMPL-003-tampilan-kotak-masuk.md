# SEK-IMPL-003 — Tampilan Sekretariat: kotak masuk yang mudah dipakai, pengaturan yang tidak menumpuk

**Status:** DRAFT
**Produk:** SQ Hub — aplikasi Sekretariat SQ
**Owner produk:** Kepala HCM (`sekretariat_admin`)
**Tanggal:** 2026-11-18
**Depends on:**
- [SEK-IMPL-001](SEK-IMPL-001-r1-buku-nomor-arsip-kotak-masuk.md) dan [SEK-IMPL-002](SEK-IMPL-002-kotak-masuk-dari-layar.md) — perilaku yang sudah berjalan; spesifikasi ini tidak mengubah aturan bisnisnya
- [`docs/design/sq-core-app-shell.md`](../design/sq-core-app-shell.md) — shell SQ Suite dan aturan "Detail views open as a pop-up" (keputusan owner 2026-11-13)

**Permintaan owner 2026-11-18**, setelah membuka Sekretariat di production: "tampilannya ga jelas. GUI/UXnya kacau … pengaturan menumpuk, terus interactive box menggeser layout … saya mau email itu feelnya kaya gmail gitu. mudah orang pakai." Owner meminta perbaikan memakai metode *unslop* tanpa melanggar aturan brand.

## 1. Temuan di production

| # | Temuan | Di mana |
| --- | --- | --- |
| 1 | Beranda adalah dinding 18 kartu sama besar, hampir semuanya bertuliskan "Tidak ada yang baru" | Ringkasan |
| 2 | Formulir muncul di tengah halaman dan mendorong isi ke bawah: catat surat fisik, disposisi, tandai selesai | Kotak masuk, surat masuk |
| 3 | Pengaturan adalah satu halaman panjang berisi lima panel, masing-masing dengan formulir tambah yang selalu terbuka | Pengaturan |
| 4 | Admin harus mengetik dan membaca `hcis:employee:<uuid>` mentah untuk menunjuk orang | Petugas, pemberi disposisi |
| 5 | Pengirim tampil mentah (`"cPanel on …" <cpanel@…>`), isi surat tampil di kotak huruf monospace bergulir seperti kode | Kotak masuk, surat masuk |
| 6 | Shell memakai baris tab di atas, padahal pedoman SQ Suite menetapkan sidebar navigasi di desktop dan navigasi bawah di ponsel | Seluruh aplikasi |
| 7 | Menutup sesuatu dengan Kembali menggulir halaman ke atas | Seluruh aplikasi |

## 2. Arah

- **Produk.** Meja tata usaha yayasan: surat masuk lewat email dan kertas, diteruskan ke unit yang menindaklanjuti, dan surat keluar yang bernomor.
- **Karakter.** Tertib, tenang, cepat dibaca.
- **Dunia.** Map surat dan buku agenda. Brand SQ Suite tidak berubah: token warna, tipografi, logo, dan tema terang/gelap dari baseline HCIS (ADR-0004).
- **Momen.** Surat yang dibuka: blok pengirim seperti kop, isi diset untuk dibaca, lampiran sebagai berkas yang bisa diambil.
- **Tanda.** Titik belum dibaca, dipakai di baris surat dan di kotak pada navigasi, tidak di tempat lain.

## 3. Keputusan

| # | Keputusan | Status |
| --- | --- | --- |
| T-1 | Shell mengikuti pedoman SQ Suite: header dengan logo, peluncur, dan menu akun; sidebar navigasi 248 px (rel ikon 56 px pada 768–1023 px); navigasi bawah paling banyak lima tujuan di ponsel. Menu akun bersama menjadi satu-satunya tempat keluar dan ganti tampilan | ACCEPTED (pedoman shell) |
| T-2 | Sidebar sekaligus daftar folder: setiap kotak masuk yang boleh dibuka, dengan jumlah belum dibaca. Lebih dari empat kotak: kotak yayasan, kotak yang ada surat baru atau disposisi terbuka, dan kotak yang sedang dibuka tetap tampil; sisanya dilipat di "Kotak lain" | DRAFT |
| T-3 | Beranda adalah kotak masuk pertama yang boleh dibuka, seperti aplikasi email. Halaman Ringkasan dihapus; isinya pindah ke sidebar (jumlah per kotak), ke halaman Surat keluar (penerbit), dan ke Pengaturan (status penarik email) | DRAFT |
| T-4 | Baris kotak masuk: titik belum dibaca, pengirim, perihal dengan cuplikan isi, ikon lampiran, tanggal ringkas (jam untuk hari ini, tanggal dan bulan tahun ini, tanggal pendek sebelumnya, menurut kalender WIB). "Belum dibaca" sama dengan status `baru`; tidak ada status baca per orang | DRAFT |
| T-5 | Satu kotak pencarian atas pengirim, perihal, dan isi, serta saringan status, di toolbar setinggi tetap di atas daftar. Mengetik atau menyaring tidak menggeser baris | ACCEPTED |
| T-6 | Surat dibuka sebagai pop-up di atas daftarnya (`/kotak/<id>?surat=<id>`), sehingga Kembali menutupnya dan daftar tidak bergerak. Tautan lama `/surat-masuk/<id>` tetap bekerja dan mendarat di pop-up yang sama | ACCEPTED (aturan pop-up) |
| T-7 | Catat surat fisik, disposisi, dan tandai selesai dibuka sebagai pop-up. Disposisi dan tandai selesai bertumpuk sekali di atas surat yang terbuka, sesuai batas pedoman | ACCEPTED |
| T-8 | Pengaturan dipecah menjadi satu halaman per urusan: alamat email, penerbit, petugas, pemberi disposisi, nomor awal. Tiap halaman berupa daftar dengan satu tombol yang membuka formulir pop-up | ACCEPTED |
| T-9 | Orang dipilih dengan mencari nama atau NIP di Organization Directory dan selalu tampil dengan namanya. Admin tidak pernah mengetik atau membaca `hcis:employee:<uuid>` | ACCEPTED |
| T-10 | Pencabutan petugas dan pemberi disposisi meminta alasan, menggantikan kalimat bawaan "Dicabut lewat layar pengaturan." | ACCEPTED |
| T-11 | Isi surat diset sebagai teks bacaan dengan baris yang dijaga, bukan kotak kode. Email HTML tetap ditampilkan dari bagian teksnya; merender HTML email butuh sanitasi tersendiri dan berada di luar spesifikasi ini | DRAFT |

## 4. Kontrak yang berubah

Semua aditif; konsumen lama tidak terganggu.

| Rute | Perubahan |
| --- | --- |
| `GET /sekretariat/kotak/:id/surat` | parameter baru `q` (dicari di pengirim, perihal, isi; wildcard LIKE di-escape; maksimal 100 karakter; disaring sebelum batas halaman sesuai ENG-LIST-001). Tiap baris mendapat `cuplikan` (180 karakter pertama isi, spasi dilipat) dan `lampiran` (jumlah berkas hidup) |
| `GET /admin/sekretariat/orang?q=` | baru: orang aktif dari Organization Directory yang nama atau NIP-nya cocok, minimal dua karakter, paling banyak 25. Aturan yang sama dengan pencarian orang di Kerja |
| `GET /admin/sekretariat/petugas`, `/disposisi-pemegang` | tiap baris mendapat `nama` dari Organization Directory, `null` bila orangnya tidak ditemukan |

Hak akses tidak berubah: daftar dan pencarian tetap melewati `requireKotak`, pencarian orang hanya untuk `sekretariat_admin`. Cuplikan isi hanya tampil kepada orang yang memang boleh membuka surat itu.

## 5. Uji

- **Web:** rute baru, termasuk satu halaman per urusan pengaturan; pengirim dipecah menjadi nama dan alamat; tanggal ringkas mengikuti kalender WIB, bukan zona peramban.
- **API:** pencarian menemukan surat lewat perihal dan isi, `%` diperlakukan harfiah; cuplikan dan jumlah lampiran ikut dalam daftar; pencarian orang menolak bukan admin dan butuh dua karakter; daftar petugas membawa nama.

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-11-18 | DRAFT pertama dari permintaan owner hari itu |
