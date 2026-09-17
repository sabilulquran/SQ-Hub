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
| Pengaturan akun | Info pribadi | **Masih Account Console Keycloak bawaan** |
| Pengaturan akun | Keamanan akun | **Masih Account Console Keycloak bawaan** |
| Pengaturan akun | Aplikasi/sesi | **Masih Account Console Keycloak bawaan** |

Theme repository hanya memiliki dua override halaman: `footer.ftl` untuk panel identitas bersama dan `login-otp.ftl` untuk TOTP/trusted device. Halaman autentikasi lain mewarisi struktur `keycloak.v2`, sehingga masih dapat diberi bahasa Akun SQ melalui message bundle dan stylesheet. Account Console adalah aplikasi Keycloak yang terpisah; login theme tidak mengubahnya.

## Aturan nama produk

| Tempat | Nama yang dipakai |
| --- | --- |
| Login, pemulihan, TOTP, logout, email, dan pengaturan keamanan pengguna | **Akun SQ** |
| Workspace/launcher dan Administrasi SQ | **SQ Hub** / **Administrasi SQ** |
| Aplikasi kepegawaian | **HCIS** |
| Engine, issuer, realm key, client ID, kode, dan dokumentasi arsitektur | **Keycloak** atau **SQ Identity** bila istilah teknis diperlukan |

Pengguna tidak perlu melihat `SQ Identity` sebagai nama produk. Nama itu tetap sah pada identifier teknis dan dokumen arsitektur agar issuer, realm, dan integrasi tidak berubah.

## Temuan dan arah berikutnya

Perubahan nama kecil yang sudah termasuk `HUB-IMPL-010` adalah:

- display name realm staging memakai `Akun SQ Staging`;
- state menunggu di SQ Hub menyebut `Akun SQ`, bukan `SQ Identity`.

Pekerjaan berikutnya yang memerlukan specification terpisah adalah Account Console. Scope-nya harus menentukan apakah cukup memakai extension point/theme resmi Keycloak atau membutuhkan pendekatan lain untuk menyatukan Info pribadi, Keamanan akun, dan Aplikasi dengan bahasa visual Akun SQ. Implementasi tidak boleh mengubah OIDC issuer, realm key, MFA/recovery, atau hak akses aplikasi.
