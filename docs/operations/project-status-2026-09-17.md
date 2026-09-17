# Status UAT identity SQ Hub — 2026-09-17

Dokumen ini merekonsiliasi bukti UAT identity agar skenario yang sudah dilaksanakan dan diterima tidak kembali dijadwalkan hanya karena dipindahkan ke matriks production. Ledger rinci tetap berada di [`HUB-IMPL-003-production-cutover.md`](./HUB-IMPL-003-production-cutover.md), sedangkan bukti live staging yang diterima berada di [`HUB-IMPL-003-staging-uat-evidence.md`](./HUB-IMPL-003-staging-uat-evidence.md).

## Ringkasan untuk pembaca non-engineer

Pengujian inti login HCIS melalui Akun SQ sebenarnya sudah selesai dan diterima di staging pada 28 Agustus 2026. Pengujian itu mencakup login OIDC ke akun HCIS yang benar, pencabutan dan pemulihan Application Access, penolakan login baru ketika layanan pemeriksaan akses SQ Hub berhenti, perilaku sesi yang sudah aktif, logout, login ulang, dan tidak adanya jalan kembali diam-diam ke password lokal HCIS.

Pada 16–17 September 2026, production hanya diuji untuk perbedaan yang memang khusus production menggunakan persona sintetis `UAT-HCIS-001`. Login dengan NIP dan email terverifikasi berhasil menuju akun HCIS yang sama. Akun HCIS yang dibuat `suspended` ditolak dengan benar, identitas Akun SQ tetap aktif, dan akun HCIS berhasil dikembalikan ke keadaan normal. Semua perubahan sementara sudah dipulihkan.

Karena itu, pekerjaan berikutnya bukan mengulang seluruh UAT. Permintaan Forgot Password baru pada 17 September 2026 pukul 11.33 WIB berhasil dicocokkan dari layar sukses Akun SQ, cPanel Track Delivery berstatus `Accepted`, hingga pesan baru di Inbox Gmail. Tester kemudian menyelesaikan reset dan penggunaan ulang tautan yang sama langsung ditolak, sehingga pengiriman serta sifat sekali pakai sudah terbukti.

## Keputusan rilis pemilik produk — 17 September 2026

Pemilik produk memutuskan untuk tidak menjadikan sisa UAT Google, trusted-device, persona tambahan, serta browser storage/cookie sebagai penghambat rilis saat ini. Skenario tersebut tetap berstatus `NOT_RUN`, bukan `PASS`, dan dipindahkan sebagai backlog acceptance yang harus diselesaikan dengan identitas sintetis yang benar.

Tiga rehearsal Keycloak outage (`9.1`-`9.3`) juga dipindahkan ke lingkungan terisolasi/production-like. Production tidak akan dihentikan atau diisolasi untuk mengejar bukti tersebut.

Keputusan ini menerima risiko bahwa bukti live untuk skenario yang tertunda belum tersedia. Ia tidak mengubah kontrak keamanan, tidak mengklaim fitur telah lolos, dan tidak mengizinkan penggunaan akun nyata sebagai data UAT.

## Status yang telah direkonsiliasi

| Hasil | Jumlah | Makna |
| --- | ---: | --- |
| `PASS` | 27 | Memiliki bukti yang memenuhi gate, termasuk continuity akses pegawai biasa tanpa hak Human Capital, penolakan OTP salah, penerbitan trusted state setelah centang + OTP valid, bypass TOTP hanya pada browser yang sama setelah first factor, dan kewajiban TOTP pada profil browser lain. |
| `FAIL` | 0 | Tidak ada kegagalan aktif yang sudah dibuktikan pada ledger. |
| `NOT_RUN` | 28 | Skenario berbeda yang belum dijalankan, terutama persona/otorisasi, recovery lain dan Google, sisa trusted device, serta pemeriksaan browser storage/cookie. Ini bukan pengulangan otomatis dari UAT inti. |
| `BLOCKED` | 3 | Rehearsal gangguan Keycloak yang hanya boleh dilakukan di lingkungan terisolasi atau production-like. |
| **Total** | **58** | Seluruh baris pada ledger production-cutover. |

## Bukti yang tidak perlu diulang

Selama implementation contract yang diuji tidak berubah secara material, bukti live staging yang sudah diterima tetap memenuhi gate yang sama:

- Application Access revoke, penolakan login baru, perilaku sesi aktif, dan restore;
- SQ Hub access-check outage yang fail closed, sesi aktif tetap berjalan, dan recovery;
- logout HCIS, Keycloak RP-initiated logout, dan kewajiban autentikasi ulang;
- tidak adanya fallback diam-diam ke login lokal HCIS.

Bukti tersebut tetap dilabeli sebagai staging evidence. Dokumen tidak mengklaim skenario itu dijalankan di production. Pengulangan hanya diperlukan setelah perubahan material pada implementasi terkait atau bila ada perbedaan production yang benar-benar memengaruhi hasil.

## Delta production yang sudah selesai

- Login menggunakan NIP: `PASS`.
- Login menggunakan verified unique email: `PASS`.
- Kedua cara login menuju principal HCIS lokal yang sama: `PASS`.
- Expired reset/action link ditolak tanpa membuat sesi: `PASS`.
- HCIS-local suspended ditolak tanpa menonaktifkan identity global, kemudian berhasil dipulihkan: `PASS`.
- Persona pegawai biasa dapat membuka modul Kehadiran dan ditolak dari antrean administrasi Human Capital: `PASS`.
- Profil browser kedua tetap meminta TOTP dan tidak memperoleh trusted state ketika opsi trust dibiarkan kosong: `PASS`.
- Keycloak identity sempat dinonaktifkan untuk persiapan skenario, tetapi browser denial tidak dijalankan; state sudah dipulihkan sehingga baris ini tetap `NOT_RUN`.

Keadaan akhir persona sintetis telah diverifikasi aman: akun HCIS dan Employee aktif, Keycloak enabled dan email verified, exact OIDC mapping tersedia, serta Application Access aktif. Tidak ada mutation yang masih tertinggal.

## Rencana tindak lanjut pengalaman Akun SQ

**Status: DISCOVERY — belum menjadi scope implementasi pada UAT ini.** Pemilik produk mencatat bahwa pengalaman login dan pengaturan akun Keycloak masih terasa seperti antarmuka provider dan membutuhkan perbaikan produk. Pekerjaan ini harus diberi specification ID tersendiri sebelum implementasi dan tidak boleh mengubah protokol OIDC, kebijakan MFA, atau hasil gate keamanan.

Rencana discovery mencakup:

- audit visual dan usability untuk login, recovery, OTP/TOTP, error, logout, serta Account Console pada desktop dan mobile;
- penyatuan bahasa, hierarki, navigasi, brand, dan bantuan kontekstual antara halaman login dengan pengaturan akun;
- pengurangan istilah teknis Keycloak/credential yang terlihat pengguna, tanpa menyembunyikan keputusan keamanan;
- pemeriksaan aksesibilitas keyboard, focus state, label, error feedback, dan responsive overflow;
- pilihan implementasi melalui theme, message bundle, dan extension point resmi terlebih dahulu; template fork atau penggantian Account Console memerlukan alasan, risiko upgrade, serta specification/ADR yang sesuai;
- visual UAT manusia untuk seluruh state autentikasi yang sudah menjadi gate, agar perbaikan tampilan tidak melemahkan alur recovery, Google, TOTP, atau trusted device.

Temuan ini tidak mengubah status ledger saat ini. UAT keamanan tetap dilanjutkan pada runtime yang ada, sedangkan redesign harus dikerjakan dalam task terpisah agar bukti acceptance tidak tercampur dengan perubahan visual baru.

## Backlog setelah rilis

1. **Siapkan fixture Google yang benar-benar terpisah.** Akun Google tanpa pasangan dapat dipakai untuk membuktikan penolakan `4.1`. Untuk linking `4.2`-`4.5`, email yang diklaim Google harus sama dengan verified unique email Akun SQ yang memang dimiliki persona sintetis. Alias Gmail bertanda `+` tidak cukup bila Google mengklaim alamat dasar. Credential tetap dipegang tester dan tidak dicatat.
2. **Gunakan TOTP persona sintetis yang sudah didaftarkan.** Pada 17 September 2026, read-only production inventory memverifikasi `UAT-HCIS-001` memiliki credential `otp` dan `password`. Persona ini dapat dipakai untuk sebagian besar matriks trusted-device. Persona privileged terpisah tetap diperlukan untuk policy comparison, TOTP wajib, dan recovery authentication code. Secret, QR, OTP, dan recovery code tidak boleh dicatat.
3. **Eksekusi sisa skenario dalam urutan yang menjaga state.** Skenario unchecked, wrong OTP, checked+valid, same browser, dan other browser sudah selesai. Berikutnya jalankan baseline storage/cookie, Google linking/login, password-reset invalidation, TOTP replacement invalidation, lalu disabled-user denial. Catat state awal dan rollback untuk setiap mutation.
4. **Jalankan hanya negative case lain yang masih berbeda bila diwajibkan.** Yang tersisa antara lain global Keycloak disable melalui browser, missing Application Access yang berbeda dari revoked access, dan unknown `issuer + sub` mapping. Pengujian revoke/restore dan tautan reset tidak perlu diulang.
5. **Jalankan Keycloak outage hanya di target terisolasi bila tetap menjadi gate.** Jangan menghentikan Keycloak production. Tiga baris outage ini tetap `BLOCKED` sampai target aman tersedia atau pemilik produk mengeluarkannya dari scope rilis.
6. **Tutup acceptance backlog setelah fixture dan lingkungan tersedia.** Issue #9 tetap terbuka sebagai pelacak pekerjaan tertunda; ia tidak lagi menjadi penghambat rilis berdasarkan keputusan pemilik produk di atas.

## Aturan pencatatan selanjutnya

Setiap hasil harus menyebutkan skenario, lingkungan asal bukti, waktu, persona sintetis/redacted, dan hasilnya. Source code, konfigurasi, atau health check saja tidak boleh menggantikan bukti browser. Sebaliknya, bukti live yang sudah diterima tidak boleh dihapus atau direset menjadi `NOT_RUN` tanpa alasan perubahan material yang terdokumentasi.
