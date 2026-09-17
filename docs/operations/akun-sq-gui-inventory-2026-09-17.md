# Inventaris GUI Akun SQ — 2026-09-17

## Tujuan

Dokumen ini memetakan halaman yang dilihat pengguna pada `login.sabilulquran.or.id` dan menetapkan batas penggunaan nama produk sebelum pekerjaan UX Account Console dimulai. Ini bukan perubahan protokol, kebijakan MFA, atau hak akses.

## Peta halaman

Ada **15 jenis layar** yang perlu diperlakukan sebagai satu perjalanan Akun SQ:

| Kelompok | Layar pengguna | Status tampilan saat ini |
| --- | --- | --- |
| Masuk | login biasa dan error kredensial | Theme Akun SQ aktif |
| Masuk | pilihan Google dan linking ke akun yang sudah ada | Theme Akun SQ aktif pada sisi Keycloak; halaman Google milik Google |
| Verifikasi | TOTP/trusted device dan pilihan metode lain | Theme Akun SQ aktif; OTP memiliki template sempit sendiri |
| Verifikasi | recovery code | Mewarisi theme Akun SQ dari Keycloak |
| Pemulihan | minta reset password, konfirmasi email terkirim, reset password, serta tautan kedaluwarsa/error | Mewarisi theme Akun SQ dari Keycloak |
| Aktivasi | verifikasi email, update password, update profil | Mewarisi theme Akun SQ dari Keycloak |
| Keamanan | konfigurasi TOTP dan tampilan recovery code | Mewarisi theme Akun SQ dari Keycloak |
| Keluar | konfirmasi logout dan kembali setelah logout | Mewarisi theme Akun SQ dari Keycloak |
| Pengaturan akun | Info pribadi | Target theme Akun SQ `keycloak.v3` pada HUB-IMPL-015 |
| Pengaturan akun | Keamanan akun | Target theme Akun SQ `keycloak.v3` pada HUB-IMPL-015 |
| Pengaturan akun | Aplikasi/sesi | Target theme Akun SQ `keycloak.v3` pada HUB-IMPL-015 |

Theme login hanya mengubah `footer.ftl` untuk identitas Akun SQ dan `login-otp.ftl` untuk TOTP/trusted device. Halaman autentikasi lain mewarisi struktur `keycloak.v2`. HUB-IMPL-015 menambahkan child theme Account Console berbasis `keycloak.v3`, sehingga pengaturan akun memakai bahasa visual yang sama tanpa menyalin logika credential atau sesi Keycloak.

## Aturan nama produk

| Tempat | Nama yang dipakai |
| --- | --- |
| Login, pemulihan, TOTP, logout, email, dan pengaturan keamanan pengguna | **Akun SQ** |
| Workspace/launcher dan Administrasi SQ | **SQ Hub** / **Administrasi SQ** |
| Aplikasi kepegawaian | **HCIS** |
| Engine, issuer, realm key, client ID, kode, dan dokumentasi arsitektur historis | **Keycloak** atau identifier teknis yang sudah ada |

Pengguna tidak perlu melihat `SQ Identity` sebagai nama produk. Nama itu tetap sah pada identifier teknis dan dokumen arsitektur agar issuer, realm, dan integrasi tidak berubah.

## Temuan dan arah berikutnya

Perubahan nama yang sudah termasuk `HUB-IMPL-010` dan disempurnakan `HUB-IMPL-015` adalah:

- display name realm staging memakai `Akun SQ`;
- seluruh state pengguna menyebut `Akun SQ`.

HUB-IMPL-015 memilih extension point resmi `keycloak.v3` untuk Account Console. Implementasi menyatukan Info pribadi, Keamanan akun, dan Aplikasi dengan bahasa visual Akun SQ tanpa mengubah OIDC issuer, realm key, MFA/recovery, atau hak akses aplikasi.
