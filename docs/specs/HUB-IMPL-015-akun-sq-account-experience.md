# HUB-IMPL-015 — Akun SQ account experience

**Status:** ACCEPTED — login/theme contract retained; user-facing Account Console superseded by HUB-IMPL-019 on 21 September 2026
**Owner:** Product Owner SQ Hub/HCIS — Human Capital YSQ
**Target:** Keycloak 26.7.2 staging realm `sq-staff-staging`

## Tujuan

Menyatukan seluruh permukaan autentikasi dan pengaturan akun dengan nama **Akun SQ** dan tampilan sistem akun yang bersih, fokus, dan familiar. Referensi visual yang disetujui pada 17 September 2026 menjadi arah desain untuk login, password, TOTP, pemulihan, linking Google, logout, dan Account Console.

## Keputusan

- Nama produk yang terlihat pengguna adalah **Akun SQ**. Istilah `SQ Identity` tidak boleh muncul pada UI aktif.
- Login memakai komposisi satu kartu terpusat dengan latar terang, aksen turquoise, dan identitas organisasi yang ringkas. Masuk dengan Google ditempatkan sebagai opsi pertama, diikuti pemisah dan form NIP/email. Panel HCIS, grid dekoratif, serta materi Nilai Utsman tidak digunakan pada layar login.
- Keputusan awal memakai Account Console child theme `keycloak.v3` dipertahankan sebagai compatibility/fallback teknis. Sejak HUB-IMPL-019, Account Console tidak lagi menjadi experience akun final atau destination dari SQ Hub. Fitur credential/security tetap berasal dari Keycloak.
- Realm key, issuer, client ID, nama jaringan, dan identifier teknis lain tidak diubah oleh pekerjaan visual ini.
- Struktur form, action URL, protokol OIDC, MFA, recovery, trusted device, dan kebijakan akses tidak diimplementasikan ulang.

## Cakupan

1. Theme login untuk login biasa, error, password, TOTP, recovery, required action, dan logout.
2. Theme Account Console untuk compatibility/fallback teknis; native Akun SQ user-facing diatur HUB-IMPL-019.
3. Copy Indonesia-first, favicon/logo Akun SQ, layout responsif, focus state, dan error state.
4. Kontrak CI untuk mencegah kembalinya komposisi HCIS atau branding lama.

## Acceptance criteria

- Login normal terpusat, terbaca, tanpa overflow pada 1440×900, 1280×720, dan 390×844. Tidak ada garis atau ornamen bawaan provider yang mengganggu kartu.
- Logo Akun SQ tetap tajam pada layar desktop dan mobile, termasuk saat browser mengisi form otomatis.
- Konten panjang tetap dapat di-scroll.
- `Akun SQ` tampil sebagai nama produk; `SQ Identity`, panel HCIS, dan Nilai Utsman tidak tampil pada theme aktif.
- Realm memakai `loginTheme` dan `accountTheme` bernama `sq-hub` tanpa mengubah issuer.
- Jika Account Console compatibility dibuka oleh operator, ia tetap mewarisi `keycloak.v3` dan tidak boleh merusak branding Akun SQ; namun jalur pengguna normal harus memakai native `/account` sesuai HUB-IMPL-019.
- Template native Keycloak tetap menjadi pemilik form/action autentikasi; override TOTP yang ada tetap mempertahankan `url.loginAction`, `otp`, dan `trustDevice`.
- Tidak ada secret, token, credential, atau data pegawai production di source maupun fixture.

## Batas rollout

Specification ini memberi izin implementasi repository dan verifikasi staging. Deployment production tetap memerlukan langkah operasional terpisah setelah CI dan visual UAT staging lulus.
