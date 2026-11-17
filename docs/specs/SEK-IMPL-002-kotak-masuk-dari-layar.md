# SEK-IMPL-002 — Menyambungkan kotak masuk dari layar, bukan dari env

**Status:** DRAFT
**Produk:** SQ Hub — aplikasi Sekretariat SQ, modul kotak masuk
**Owner produk:** Kepala HCM (`sekretariat_admin`, SEK-001 §13 nomor 2)
**Tanggal:** 2026-11-17
**Depends on:**
- [SEK-001](../product/sekretariat-module-design.md) — §5.2 kotak masuk, §7 akses berlapis, §9 privasi, §13 nomor 8 (satu alamat dulu, per unit menyusul)
- [SEK-IMPL-001](SEK-IMPL-001-r1-buku-nomor-arsip-kotak-masuk.md) — R1 yang sudah berjalan di production sejak 2026-11-17; §10 env, D-1 interval 5 menit, D-2 lampiran besar
- `docs/security/security-baseline.md`, ADR-0011 (pola modul di dalam Hub)

**Permintaan owner 2026-11-17:** "untuk mailbox setupnya dari GUI bisa ngga? misalnya admin sekretariat bisa + mailbox baru > proses setup mailbox sampai selesai > kasih akses ke siapa." Ditegaskan kemudian bahwa yang diminta **bukan** membuat alamat email baru di hosting, melainkan **menyambungkan mailbox yang sudah ada** lewat layar, tanpa skrip di server.

## 1. Tujuan dan batas rilis

Hari ini satu-satunya cara menghidupkan kotak masuk adalah mengubah `SEKRETARIAT_IMAP_*` di `final.env` Mi8 lewat SSH, lalu merestart Hub. Itu menutup pintu bagi siapa pun yang bukan operator, dan bertentangan dengan arah yang owner tetapkan 2026-11-12: orang non-teknis harus dapat merawat sistem lewat antarmuka dan runbook.

R2 memindahkan penyambungan mailbox ke layar Pengaturan Sekretariat: admin menambah mailbox, modul membuktikan loginnya, kredensial tersimpan terenkripsi di database, dan penarik email mulai jalan tanpa restart. Ganti sandi mailbox tidak lagi menuntut sesi SSH.

**Termasuk:** daftar mailbox, tambah, uji sambungan, ubah, nonaktifkan, hapus; penyimpanan sandi terenkripsi; penarik email membaca konfigurasi dari database; status sambungan terlihat di layar; hak akses kotak yang jadi tujuan mailbox; audit setiap tindakan.

**Tidak termasuk:**

| Di luar lingkup | Alasan |
| --- | --- |
| Membuat atau menghapus alamat email di hosting | Milik cPanel Jagoan; butuh token yang berwenang atas seluruh domain. Owner menegaskan ini bukan yang diminta |
| Mengirim email dari modul | SEK-001 §13 nomor 9: dinilai di R2 setelah volume terlihat, bukan bagian spesifikasi ini |
| OAuth mailbox (Gmail/Microsoft) | Mailbox yayasan di cPanel memakai sandi; tidak ada kebutuhan nyata |
| Mengubah aturan disposisi | Sudah ada di R1 |

## 2. Keputusan

| # | Keputusan | Status |
| --- | --- | --- |
| M-1 | Satu mailbox = satu baris `sekretariat_mailbox`, **terikat pada satu kotak** (`sekretariat_kotak`). Tujuan pertama adalah kotak yayasan; alamat per unit menyusul tanpa perubahan model, sesuai SEK-001 §13 nomor 8 | ACCEPTED (turunan SEK-001) |
| M-2 | Sandi mailbox disimpan **terenkripsi** di database dengan AES-256-GCM dan amplop `v1.<kid>.<iv>.<ct>.<tag>` yang terikat AAD — format yang sama dengan yang sudah berjalan di Kirim SQ. Kuncinya di env Mi8: `SEKRETARIAT_DATA_KEYS` (`kid:base64(32 byte)`, dipisah koma, yang pertama dipakai menulis), sebentuk dengan `KIRIM_DATA_KEYS`, sehingga rotasi kunci mungkin sejak awal | DRAFT |
| M-2a | Kodenya **milik Sekretariat** (`modules/sekretariat/crypto.ts`), bukan impor dari modul Kirim. Kirim sedang melayani production, dan memekarkan kelasnya menjadi utilitas bersama berarti menyentuh modul itu di dalam PR yang tujuannya lain. Bila kelak ada konsumen ketiga, pemekaran ke `lib/` pantas jadi PR tersendiri dengan review-nya sendiri | DRAFT |
| M-3 | Sandi **tidak pernah dikirim balik ke browser**, dalam bentuk apa pun, juga tidak bertopeng. Layar hanya menampilkan apakah sandi sudah terisi. Mengubah sandi berarti mengetik yang baru | ACCEPTED |
| M-4 | Mailbox baru **wajib lulus uji login** sebelum tersimpan aktif. Simpan tanpa uji tidak disediakan | ACCEPTED |
| M-5 | Konfigurasi di database **menggantikan** env. Bila ada baris mailbox aktif, `SEKRETARIAT_IMAP_*` dan `SEKRETARIAT_MAIL_MODE` diabaikan. Env tetap dibaca hanya bila tabel kosong, supaya pemasangan yang sudah ada tidak mendadak berhenti | DRAFT |
| M-6 | Penarik email membaca ulang daftar mailbox **setiap putaran** (5 menit, SEK-IMPL-001 D-1), jadi menambah atau menonaktifkan mailbox berlaku tanpa restart Hub | ACCEPTED |
| M-7 | Kegagalan satu mailbox **tidak mematikan** mailbox lain maupun modul. Barisnya menyimpan galat terakhir dan waktunya, dan layar menampilkannya | ACCEPTED (SEK-IMPL-001 kriteria 6) |
| M-8 | Setelah lima kegagalan autentikasi berturut-turut, mailbox **ditandai `auth_gagal`** dan berhenti dicoba sampai admin menyimpannya lagi. Ini melindungi mailbox dari penguncian oleh hosting | DRAFT |
| M-9 | Hanya `sekretariat_admin` yang melihat dan mengubah layar ini. Penarikan tetap **baca-saja**: modul tidak pernah menghapus atau memindahkan email di mailbox aslinya (SEK-001 §9) | ACCEPTED |
| M-10 | "Kasih akses ke siapa" pada layar ini berarti **siapa yang membaca kotak tujuan mailbox itu**, memakai petugas dan pemegang disposisi yang sudah ada di R1. Tidak ada model hak akses baru | ACCEPTED |
| M-11 | Menghapus mailbox **tidak menghapus surat masuk** yang sudah teregister. Surat yang sudah masuk adalah catatan, bukan cermin mailbox | ACCEPTED |
| M-12 | Host, port, dan pengguna boleh dilihat admin; sandi dan kunci tidak pernah masuk log, audit, atau pesan galat | ACCEPTED |

## 3. Peran dan akses

Layar Pengaturan › Kotak masuk hanya untuk `sekretariat_admin` (SEK-001 §7). Peran itu sudah mewajibkan MFA karena memegang akses kotak yayasan, jadi tidak ada aturan baru.

Di layar yang sama admin melihat siapa yang membaca kotak tujuan: daftar petugas kotak itu dan pemegang disposisi, dengan tautan ke pengaturan yang sudah ada. Itu menjawab bagian "kasih akses ke siapa" tanpa membuat model izin kedua (M-10).

## 4. Yang dilihat admin

**Daftar.** Tiap mailbox satu baris: alamat, kotak tujuan, keadaan (`aktif`, `nonaktif`, `auth_gagal`), waktu tarikan terakhir, jumlah surat masuk dari mailbox itu, dan galat terakhir bila ada. Kosong pada awalnya, dengan satu ajakan menambah.

**Tambah dan ubah.** Pop-up, bukan panel samping, mengikuti aturan SQ Suite 2026-11-13. Isinya alamat, host, port (bawaan 993), pengguna (bawaan sama dengan alamat), sandi, dan kotak tujuan. Tombolnya "Uji dan simpan": modul menyambung sungguhan, dan hanya menyimpan bila berhasil. Gagal menampilkan sebabnya dengan kalimat yang dapat ditindaklanjuti — sandi ditolak, host tidak ditemukan, sertifikat tidak cocok, sambungan habis waktu — tanpa membocorkan apa pun yang rahasia.

**Keadaan layar.** Memuat, kosong, galat, terlarang, dan tampilan ponsel, seperti layar Sekretariat lain.

## 5. Model data

Tabel baru `sekretariat_mailbox`:

| Kolom | Isi |
| --- | --- |
| `id` | uuid |
| `alamat` | alamat email, unik |
| `host`, `port`, `pengguna` | pengaturan IMAPS; port bawaan 993 |
| `sandi_terenkripsi` | bytea, AES-256-GCM (M-2) |
| `kotak_id` | kotak tujuan, rujukan `sekretariat_kotak` (M-1) |
| `status` | `aktif`, `nonaktif`, `auth_gagal` |
| `gagal_berturut` | pencacah untuk M-8 |
| `galat_terakhir`, `galat_pada` | sebab kegagalan terakhir, tanpa rahasia |
| `tarik_terakhir_pada` | waktu putaran sukses terakhir |
| `dibuat_oleh`, `dibuat_pada`, `diubah_oleh`, `diubah_pada` | jejak |

`sekretariat_mail_state` yang sudah ada (UID dan UIDVALIDITY per mailbox) ditautkan ke `sekretariat_mailbox.id` supaya idempotensi tarikan tetap berlaku per mailbox.

## 6. Keamanan

Kunci `SEKRETARIAT_DATA_KEYS` dibuat sekali di Mi8 dan tidak pernah masuk repository. Kuncinya milik Sekretariat sendiri, tidak diturunkan dari secret OIDC, sehingga merotasi secret OIDC tidak membuat kredensial tersimpan tak terbaca. Kehilangan kunci berarti kredensial tersimpan tidak dapat dibaca; pemulihannya adalah mengetik ulang sandi mailbox di layar, bukan prosedur khusus. Menambah `kid` baru di depan daftar cukup untuk rotasi, dan baris lama tetap terbaca selama kunci lamanya masih terdaftar; menulis ulang baris lama dengan kunci baru belum disediakan dan dicatat `TBD`.

AAD tiap baris adalah `sekretariat:sekretariat_mailbox:sandi:<id baris>`, sehingga ciphertext satu mailbox tidak dapat dipindahkan ke baris mailbox lain.

Setiap tindakan admin menulis tepat satu baris `sekretariat_audit`: `mailbox.tambah`, `mailbox.ubah`, `mailbox.uji`, `mailbox.nonaktif`, `mailbox.hapus`. Metadata memuat alamat dan kotak tujuan, tidak pernah sandi.

Perubahan ini **mengubah SEK-001 §9**, yang hari ini berbunyi kredensial mailbox hanya ada di secret Mi8. Kalimat itu diperbarui: yang tinggal di env hanyalah kunci enkripsi; kredensial mailbox ada di database dalam keadaan terenkripsi.

## 7. Uji

- **Unit:** enkripsi bolak-balik; ciphertext berbeda untuk nilai sama (nonce acak); kunci salah gagal tanpa membocorkan apa pun; sandi tidak pernah muncul pada hasil serialisasi baris.
- **API:** tanpa `sekretariat_admin` → 403; simpan dengan kredensial salah → tidak ada baris tersimpan; simpan berhasil → satu baris, satu audit, sandi tidak ada di jawaban; ubah tanpa mengisi sandi → sandi lama tetap; lima kegagalan autentikasi → status `auth_gagal` dan tidak dicoba lagi; hapus mailbox → surat masuknya tetap ada.
- **Penarik:** tabel kosong → env dipakai (M-5); satu baris aktif → env diabaikan; mailbox gagal tidak menghentikan mailbox lain; UID yang sama dua kali → satu baris surat.

## 8. Rilis

Satu migration aditif, satu env baru, tanpa perubahan rute edge dan tanpa client Keycloak baru. Urutannya: migration, isi `SEKRETARIAT_SECRET_KEY`, rilis, lalu admin menyambungkan mailbox dari layar. Rollback adalah rilis sebelumnya; barisnya tertinggal tanpa dibaca, dan env lama masih dihormati karena M-5.

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-11-17 | DRAFT pertama, dari permintaan owner hari itu |
