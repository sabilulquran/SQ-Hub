# Runbook: mesin WhatsApp Kirim

**Untuk siapa:** pemegang `kirim_admin` (Kepala HCM) dan siapa pun yang menjaga Mi8. Tidak perlu bisa memprogram.
**Berlaku sejak:** 2026-11-17 (KIRIM-IMPL-005, amandemen ADR-0011).

---

## 1. Apa yang berjalan

| Nama | Apa itu | Di mana |
| --- | --- | --- |
| **Kirim** | Halaman admin dan API: kartu, nomor, antrean, jam kirim, daftar jangan hubungi, kunci API. | Bagian dari SQ Hub, `kirim.sabilulquran.or.id` |
| **Mesin Sabilul Qur'an** (`kirim-wa`) | Program yang benar-benar memegang sesi WhatsApp tiap nomor. Satu program untuk semua nomor. | Proses sendiri di Mi8, hanya bisa dihubungi dari dalam Mi8 |
| **JalurPesan** | Mesin lama. Dipertahankan mati sebagai jalur mundur. | `/srv/jalurpesan` di Mi8 |

Setiap nomor di Kirim memakai **satu** mesin, dan itu bisa berbeda antar nomor. Di halaman **Nomor**, buka sebuah nomor → **Ubah** → bagian "Ganti mesin WhatsApp".

Yang penting dipahami: **satu sesi WhatsApp hanya boleh hidup di satu mesin.** Kalau dua mesin memegang sesi yang sama, WhatsApp akan memutus salah satunya dan sesi bisa rusak.

---

## 2. Membaca status sebuah nomor

Halaman **Nomor** di Kirim menampilkan status tiap nomor:

| Status | Artinya | Yang perlu dilakukan |
| --- | --- | --- |
| **Tersambung** | Nomor hidup dan bisa kirim/terima. | Tidak ada. |
| **Terputus** | Mesin kehilangan sambungan. Biasanya pulih sendiri dalam beberapa detik sampai menit (HP kehilangan sinyal, Mi8 baru nyala). | Tunggu 5 menit. Kalau masih terputus, lihat §4. |
| **Menunggu pairing** | Sedang menampilkan kode QR atau kode pairing, menunggu dipindai. | Pindai dari WhatsApp di HP nomor itu. |
| **Belum dipasang** | Nomor ada di Kirim, tapi belum pernah disambungkan ke WhatsApp. | Tekan **Pasang** lalu pindai QR. |
| **Nonaktif** | Nomor sengaja dimatikan. | Tidak ada. |

Status disegarkan sendiri paling lambat satu menit sekali. Setelah menekan tombol, tunggu sebentar lalu muat ulang halaman.

---

## 3. Setelah Mi8 mati atau di-restart

Tidak ada yang perlu dilakukan. Mesin menyimpan kunci sesi tiap nomor di berkas, dan menyambungkan semua nomor sendiri saat nyala kembali — satu per satu, dengan jeda, supaya HP tidak kewalahan. Biasanya semua nomor kembali **Tersambung** dalam 1–2 menit.

Kalau setelah 10 menit ada nomor yang masih **Terputus**, lanjut ke §4.

---

## 4. Menyambungkan ulang sebuah nomor

Urut dari yang paling ringan. Berhenti begitu nomor kembali **Tersambung**.

1. **Tunggu.** Mesin mencoba sendiri beberapa kali. Lima menit dulu.
2. **Periksa HP nomor itu.** WhatsApp di HP harus online, dan di **Perangkat tertaut** harus masih ada perangkat Sabilul Qur'an. Kalau perangkat itu hilang dari daftar, berarti sesi sudah dicabut dari HP: langsung ke langkah 4.
3. **Sambungkan ulang dari Kirim.** Nomor → **Sambungkan ulang**. Ini memakai kunci sesi yang sudah ada; tidak perlu memindai apa pun.
4. **Pasang ulang (pindai QR).** Nomor → **Pasang** → pindai kode QR dari WhatsApp di HP nomor itu (Setelan → Perangkat tertaut → Tautkan perangkat).
   **Riwayat percakapan tidak hilang.** Riwayat ada di basis data Kirim, bukan di sesi WhatsApp. Yang baru hanya sesinya.

> **Jangan** menekan **Putuskan** untuk memperbaiki nomor yang terputus. Putuskan berarti keluar dari WhatsApp, dan setelah itu wajib pindai QR lagi.

---

## 5. Memindahkan sebuah nomor antar mesin

Dilakukan satu nomor per langkah, tidak pernah dua sekaligus. Yang bisa dikerjakan dari halaman Kirim:

1. Nomor → **Jeda antrean**. (Tanpa ini, perpindahan ditolak.)
2. Tunggu sampai tidak ada pesan berstatus "diserahkan" di halaman **Antrean** untuk nomor itu.
3. Nomor → **Ubah** → "Ganti mesin WhatsApp" → pilih mesinnya → isi **Alasan** → **Simpan**.
4. Nomor → **Lanjutkan antrean**.
5. Tunggu sampai status kembali **Tersambung** (paling lama satu menit), lalu kirim satu pesan uji.

Kalau nomor tidak mau tersambung di mesin baru, ikuti §4 langkah 4 (pindai QR).

**Yang ditolak Kirim, dan mengapa:**

| Pesan | Artinya |
| --- | --- |
| "Jeda antrean nomor ini dulu." | Langkah 1 belum dilakukan. |
| "Masih ada pesan diserahkan yang menunggu status." | Ada pesan yang sudah diberikan ke mesin lama tapi belum jelas terkirim atau belum. Tunggu sampai habis. |
| "Nomor WhatsApp yang sama juga ada di …" | Ada dua nomor Kirim untuk satu akun WhatsApp. Gabungkan dulu ("Pakai nomor yang sudah aktif"), baru pindahkan. Ini penjaga atas kejadian `spmb-2`, waktu kotak masuk SPMB berhenti menerima karena ada dua nomor untuk satu akun. |

**Pemindahan yang menyalin kunci sesi** (supaya tidak perlu pindai QR) melibatkan berkas di Mi8 dan dikerjakan oleh yang memegang akses Mi8; langkahnya ada di KIRIM-IMPL-005 §9.1.

---

## 5a. Kalau sebuah nomor minta dipindai QR setelah pindah mesin

Ini **bisa terjadi** dan bukan tanda ada yang rusak. Memindahkan nomor berusaha membawa sesi WhatsApp-nya ikut pindah, tetapi WhatsApp kadang mencabut tautan perangkatnya saat sambungan berpindah. Terjadi pada nomor HCIS 2026-11-17.

Yang perlu diketahui:

- **Tidak ada cadangan yang bisa menolong.** Cadangan melindungi dari berkas yang hilang, bukan dari tautan yang dicabut WhatsApp. Kalau WhatsApp bilang perangkatnya sudah keluar, satu-satunya jalan adalah memindai QR lagi.
- **Tidak ada pesan yang hilang.** Pesan keluar menunggu di antrean sampai nomor tersambung lagi, lalu dikirim. Pesan masuk tetap di WhatsApp dan diambil saat sesi hidup.
- **Riwayat percakapan tidak hilang.** Riwayat ada di basis data Kirim, bukan di sesi WhatsApp.
- Karena itu: **pindahkan nomor hanya ketika ada yang siap memindai QR**, terutama nomor HCIS yang dipakai HCIS, Karir, Keluarga, dan SPMB sekaligus.

Caranya: kartu nomor itu, lalu **Pasang**, lalu pindai kode QR dari WhatsApp di HP nomor tersebut (Setelan, Perangkat tertaut, Tautkan perangkat).

## 6. Yang tidak boleh dilakukan

- **Jangan menghapus folder `/srv/sq-hub/shared/kirim-wa/auth/`** atau isinya. Di situlah kunci sesi tiap nomor. Menghapusnya berarti setiap nomor harus dipindai QR ulang.
- **Jangan menyalakan JalurPesan kembali untuk nomor yang sudah pindah.** Dua mesin memegang satu sesi akan memutus dan bisa merusak sesinya.
- **Jangan menekan Putuskan atau Reset** hanya untuk "menyegarkan" sebuah nomor; keduanya membuang sesi.
- **Jangan merilis pada jam 19 UTC** (jam 02.00 WIB): itu jam backup.
- **Jangan mengirim pesan uji ke nomor itu sendiri lewat Kirim.** Chat ke diri sendiri tidak pernah mendapat tanda terima, jadi pesannya menggantung di antrean dan menahan penggantian mesin. Kirim pesan uji ke nomor yayasan yang lain.
- **Jangan dua orang menyentuh layar Nomor bersamaan**, dan jangan menekan "Sambungkan ulang" ketika ada yang sedang memindahkan nomor. Dua jalur yang berjalan bersamaan membuat nomor ganda, dan itu yang dulu membuat kotak masuk SPMB tuli.

---

## 7. Kalau mesin mati sama sekali

Gejalanya: semua nomor jadi **Terputus** bersamaan, dan pesan menumpuk di halaman **Antrean** tanpa ada yang gagal.

Tidak ada pesan yang hilang. Pesan keluar menunggu di antrean dan dikirim setelah mesin hidup; pesan masuk tetap di WhatsApp dan diambil saat sesi tersambung kembali.

Pengawas Mi8 menyalakan ulang mesin yang mati dalam waktu sekitar dua menit, sendiri. Kalau setelah 10 menit semua nomor masih terputus, itu untuk yang memegang akses Mi8:

```bash
ssh mi8vps-root "chroot /data/local/ubuntu26 /usr/bin/env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3310/health"
```

`200` berarti mesin hidup dan masalahnya bukan di situ. Apa pun selain `200` berarti mesin mati; pengawas akan menyalakannya, dan kalau tidak, jalankan `/data/local/mi8vps/sq-core-launch.sh kirim-wa`.

---

## 8. Bagi pemanggil API dari luar

Tidak ada yang berubah. Alamat, kunci `krm_…`, bentuk permintaan dan jawaban, serta webhook tetap sama pada kedua mesin. Dokumentasinya tetap [`panduan-api-gateway-aplikasi-luar.md`](panduan-api-gateway-aplikasi-luar.md) dan halaman publik `kirim.sabilulquran.or.id/dokumentasi-api`.
