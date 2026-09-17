# Status UAT identity SQ Hub — 2026-09-17

Dokumen ini merekonsiliasi bukti UAT identity agar skenario yang sudah dilaksanakan dan diterima tidak kembali dijadwalkan hanya karena dipindahkan ke matriks production. Ledger rinci tetap berada di [`HUB-IMPL-003-production-cutover.md`](./HUB-IMPL-003-production-cutover.md), sedangkan bukti live staging yang diterima berada di [`HUB-IMPL-003-staging-uat-evidence.md`](./HUB-IMPL-003-staging-uat-evidence.md).

## Ringkasan untuk pembaca non-engineer

Pengujian inti login HCIS melalui Akun SQ sebenarnya sudah selesai dan diterima di staging pada 28 Agustus 2026. Pengujian itu mencakup login OIDC ke akun HCIS yang benar, pencabutan dan pemulihan Application Access, penolakan login baru ketika layanan pemeriksaan akses SQ Hub berhenti, perilaku sesi yang sudah aktif, logout, login ulang, dan tidak adanya jalan kembali diam-diam ke password lokal HCIS.

Pada 16–17 September 2026, production hanya diuji untuk perbedaan yang memang khusus production menggunakan persona sintetis `UAT-HCIS-001`. Login dengan NIP dan email terverifikasi berhasil menuju akun HCIS yang sama. Akun HCIS yang dibuat `suspended` ditolak dengan benar, identitas Akun SQ tetap aktif, dan akun HCIS berhasil dikembalikan ke keadaan normal. Semua perubahan sementara sudah dipulihkan.

Karena itu, pekerjaan berikutnya bukan mengulang seluruh UAT. Fokus berikutnya adalah memperbaiki pengiriman email Forgot Password production yang tidak konsisten, lalu menguji ulang hanya alur recovery yang terdampak. Pengujian recovery/Google dan trusted device adalah fitur tambahan yang belum tercakup dalam UAT inti lama; pemilik produk perlu menetapkan apakah fitur tersebut harus selesai sebelum penerimaan rilis sekarang atau dikelola sebagai paket UAT terpisah.

## Status yang telah direkonsiliasi

| Hasil | Jumlah | Makna |
| --- | ---: | --- |
| `PASS` | 19 | Memiliki bukti yang memenuhi gate, termasuk accepted staging evidence yang ruang lingkupnya dicatat secara eksplisit. |
| `FAIL` | 1 | Forgot Password production kadang menampilkan respons berhasil tetapi email baru tidak diterima. |
| `NOT_RUN` | 35 | Skenario berbeda yang belum dijalankan, terutama persona/otorisasi, recovery dan Google, trusted device, serta pemeriksaan browser storage/cookie. Ini bukan pengulangan otomatis dari UAT inti. |
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
- Keycloak identity sempat dinonaktifkan untuk persiapan skenario, tetapi browser denial tidak dijalankan; state sudah dipulihkan sehingga baris ini tetap `NOT_RUN`.

Keadaan akhir persona sintetis telah diverifikasi aman: akun HCIS dan Employee aktif, Keycloak enabled dan email verified, exact OIDC mapping tersedia, serta Application Access aktif. Tidak ada mutation yang masih tertinggal.

## Langkah berikutnya

1. **Perbaiki pengiriman Forgot Password production.** Periksa konfigurasi/antrean/log pengiriman secara aman tanpa menyalin token atau data pribadi. Setelah diperbaiki, ulangi hanya delivery, single-use link, dan expired-link bila perubahan dapat memengaruhinya.
2. **Tetapkan scope rilis fitur tambahan.** Putuskan apakah recovery/Google (`HUB-IMPL-011`) dan trusted device (`HUB-IMPL-012`) menjadi syarat penerimaan rilis sekarang atau paket UAT terpisah. Jangan menyebut 35 `NOT_RUN` sebagai kegagalan proyek sebelum scope ini diputuskan.
3. **Jalankan hanya negative case yang masih berbeda bila diwajibkan.** Yang tersisa antara lain global Keycloak disable melalui browser, missing Application Access yang berbeda dari revoked access, dan unknown `issuer + sub` mapping. Pengujian revoke/restore tidak perlu diulang.
4. **Jalankan Keycloak outage hanya di target terisolasi bila tetap menjadi gate.** Jangan menghentikan Keycloak production. Tiga baris outage ini tetap `BLOCKED` sampai target aman tersedia atau pemilik produk mengeluarkannya dari scope rilis.
5. **Berikan final acceptance setelah scope dipilih dan delta wajib selesai.** Issue #9 tetap terbuka selama masih ada gate yang dipilih untuk rilis dengan status `FAIL`, `NOT_RUN`, atau `BLOCKED`.

## Aturan pencatatan selanjutnya

Setiap hasil harus menyebutkan skenario, lingkungan asal bukti, waktu, persona sintetis/redacted, dan hasilnya. Source code, konfigurasi, atau health check saja tidak boleh menggantikan bukti browser. Sebaliknya, bukti live yang sudah diterima tidak boleh dihapus atau direset menjadi `NOT_RUN` tanpa alasan perubahan material yang terdokumentasi.
