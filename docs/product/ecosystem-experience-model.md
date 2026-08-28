# SQ Ecosystem Experience Model

**Status:** DISCOVERY  
**Date:** 2026-08-28  
**Scope:** Product direction after Foundation v1; does not supersede the current accepted staff-focused SQ Hub scope.

## Purpose

Dokumen ini menangkap arah pengalaman pengguna lintas ekosistem Sabilul Qur'an ketika sistem berkembang melampaui HCIS menjadi SPMB, recruitment, finance, workspace/project management, dan domain lain.

Foundation v1 tetap berfokus pada identitas staf, SSO, Application Access, dan integrasi HCIS. Arah di dokumen ini adalah target produk jangka menengah/panjang yang perlu diputuskan melalui specification/ADR sebelum implementasi.

## Core model

Ekosistem dibedakan menjadi tiga konsep produk:

### SQ Account

SQ Account adalah identitas digital seseorang di ekosistem Sabilul Qur'an.

Satu orang idealnya memiliki satu identitas walaupun memiliki lebih dari satu hubungan dengan Yayasan, misalnya:

- pegawai;
- orang tua/wali siswa;
- pendaftar sekolah;
- pelamar pekerjaan;
- mantan pelamar yang kemudian menjadi pegawai;
- kombinasi beberapa persona di atas.

Keycloak/SQ Identity dapat tetap menjadi mesin autentikasi di belakang SQ Account, tetapi perlu keputusan arsitektur lanjutan sebelum identitas publik dan identitas staf digabung atau dimigrasikan dari model realm staf saat ini.

### SQ Hub

SQ Hub adalah **workspace internal** bagi pegawai dan pihak internal yang diberi akses.

Karakter UX-nya app-oriented karena seorang pegawai memang dapat menggunakan beberapa aplikasi/domain dalam pekerjaannya:

- HCIS;
- Work / project management dan komunikasi tim;
- SPMB backoffice;
- Finance;
- Recruitment;
- aplikasi internal lain yang relevan.

SQ Hub menjadi "rumah" kerja pegawai, bukan gerbang wajib. Pengguna tetap boleh membuka deep link langsung ke aplikasi tertentu dan SSO akan mengembalikannya ke tujuan awal setelah autentikasi.

Target pengalaman global SQ Hub antara lain:

- Home yang merangkum hal yang perlu dikerjakan;
- App Switcher;
- My Work / Inbox lintas aplikasi bila kebutuhan integrasinya terbukti;
- notifikasi;
- profil pengguna dan logout;
- visual language yang konsisten lintas aplikasi.

Aplikasi domain tetap independen. SQ Hub tidak mengambil alih business logic HCIS, SPMB, Finance, Recruitment, atau Work.

### SQ Portal

SQ Portal adalah **portal layanan personal untuk pengguna eksternal**.

SQ Portal tidak perlu terasa seperti "hub aplikasi". Pengguna eksternal tidak perlu mengetahui bahwa data mereka berasal dari SPMB, Finance, Recruitment, Assessment, atau sistem domain lain.

Navigasi SQ Portal harus journey-oriented, misalnya:

- Beranda;
- Keluarga / Anak Saya;
- Pendidikan / Pendaftaran;
- Karier / Lamaran Saya;
- Tes;
- Tagihan;
- Dokumen;
- Akun Saya.

Portal memiliki satu home personal, tetapi tidak menggunakan App Switcher internal seperti SQ Hub.

## Experience principles

### Internal: work-oriented

Pertanyaan utama SQ Hub adalah:

> Apa yang perlu saya kerjakan, dan aplikasi apa yang saya gunakan untuk bekerja?

Hak melihat aplikasi ditentukan oleh Application Access. Role dan permission spesifik domain tetap ditentukan oleh aplikasi domain masing-masing.

### External: journey-oriented

Pertanyaan utama SQ Portal adalah:

> Apa urusan saya dengan Sabilul Qur'an, dan apa langkah saya berikutnya?

Pengguna melihat perjalanan dan status, bukan batas teknis antar aplikasi.

## Example journeys

### Parent / guardian and school admission

1. Orang tua membuat SQ Account atau login dari halaman program pendidikan.
2. Menambahkan anak/dependent.
3. Memilih program TK, SD, Pesantren, atau program lain.
4. Membuat pendaftaran.
5. Melengkapi formulir dan dokumen.
6. Mengikuti progres verifikasi, observasi, tes, wawancara, dan hasil seleksi.
7. Jika diperlukan, calon siswa memperoleh akses tes online yang sesuai konteks tanpa memperoleh akses internal.
8. Orang tua melihat tagihan dan pembayaran yang relevan.
9. Setelah siswa diterima, akun orang tua tetap dapat digunakan untuk layanan keluarga berikutnya.
10. Anak lain dapat didaftarkan tanpa membuat akun orang tua baru.

SPMB memiliki sisi domain/backoffice untuk pegawai, sedangkan orang tua melihat pengalaman pendaftaran melalui SQ Portal atau entry point publik yang mengarah ke journey yang sama.

### Job applicant

1. Pelamar membuat SQ Account.
2. Melengkapi profil kandidat sekali: identitas, pendidikan, pengalaman, kompetensi, CV, dan dokumen relevan.
3. Melihat lowongan yang dipublikasikan.
4. Melamar satu atau beberapa posisi tanpa mengisi ulang profil dari nol.
5. Mengikuti progres seleksi: administrasi, tes, wawancara, offering, hired/rejected.
6. Jika status menjadi Hired dan onboarding disahkan, orang yang sama dapat memperoleh persona internal/pegawai dan akses SQ Hub.

Target pengalaman kandidat-to-employee:

```text
SQ Account
  -> Candidate profile
  -> Application
  -> Hired
  -> Employee record/onboarding
  -> Internal access granted
  -> SQ Hub + HCIS + Work (sesuai kebutuhan)
```

Akun pelamar tidak perlu dibuang dan dibuat ulang sebagai akun pegawai apabila desain identity linkage memungkinkan transisi aman tersebut.

### Person with multiple personas

Satu orang dapat sekaligus menjadi pegawai dan orang tua siswa.

Contoh:

```text
Ahmad / satu SQ Account
  -> Persona Pegawai -> SQ Hub
  -> Persona Orang Tua -> SQ Portal
  -> Candidate history -> Karier
```

Data domain tetap terpisah. Kesamaan identity tidak berarti semua data antar persona boleh terlihat silang tanpa authorization dan privacy rule eksplisit.

## Product boundaries

### SQ Hub owns

- shared identity integration untuk internal;
- Application Registry dan Application Access;
- internal workspace shell/home/app navigation jika dibangun;
- shared design system dan cross-application conventions;
- shared capabilities yang benar-benar lintas aplikasi.

### SQ Portal owns

- external authenticated portal shell;
- journey-oriented navigation;
- external profile/account UX yang memang shared;
- presentation/orchestration pengalaman lintas domain untuk pengguna eksternal;
- deep links ke entry point pendidikan, karier, tagihan, dan journey lain.

SQ Portal tidak memiliki business rule admission, recruitment, finance, assessment, atau academic. Rule tersebut tetap dimiliki domain sumbernya.

### Domain applications own

- SPMB: admission lifecycle dan backoffice;
- Recruitment: vacancy, candidate pipeline, assessment/interview workflow;
- Finance: invoice/tagihan/payment domain rules;
- HCIS: employee dan HR domain;
- Work: task/project/team communication domain;
- domain lain sesuai ownership masing-masing.

## Repository strategy

**Working recommendation:** dokumentasi ecosystem-level tetap berada di repository `SQ-Hub` selama masih dalam discovery karena keputusan identity, access, integration, dan experience model memengaruhi seluruh foundation.

Ketika implementasi SQ Portal dimulai, **SQ Portal sebaiknya menjadi repository/deployment terpisah** dari `SQ-Hub`, misalnya `imadjinasi/SQ-Portal`.

Alasannya:

- SQ Hub adalah internal shared foundation/workspace, sedangkan SQ Portal memiliki public/external attack surface;
- deployment dan scaling lifecycle dapat berbeda;
- release Portal tidak harus mengubah foundation;
- portal shell dapat berkembang tanpa mencampurkan business UI eksternal ke codebase platform internal;
- batas ownership tetap jelas.

Repository SQ Portal hanya memiliki portal experience dan integration layer yang diperlukan. Business logic SPMB, Recruitment, Finance, dan domain lain tidak dipindahkan ke repo tersebut.

Keputusan repository ini adalah rekomendasi discovery dan perlu difinalkan sebelum implementation spec pertama SQ Portal.

## Entry points

Pengguna tidak wajib selalu memulai dari portal home.

Contoh:

- `karier.sabilulquran.or.id/...` -> lihat lowongan -> login/create account -> kembali ke lowongan;
- `daftar.sabilulquran.or.id/...` -> pilih program -> login/create account -> mulai pendaftaran;
- `portal.sabilulquran.or.id` -> melihat keseluruhan hubungan personal dengan Yayasan.

SQ Portal menjadi consolidated personal home, sementara entry point publik tetap boleh domain/journey-specific.

## Important open decisions

Sebelum implementasi eksternal, keputusan berikut wajib dispesifikasikan dan sebagian kemungkinan memerlukan ADR:

1. Apakah SQ Account publik dan staf menggunakan satu Keycloak realm atau boundary identity lain.
2. Strategi migrasi dari realm `sq-staff-staging` bila model identity diperluas.
3. Self-registration, email/phone verification, password recovery, anti-abuse, rate limiting, dan MFA policy untuk pengguna eksternal.
4. Aturan account linking dan duplicate-person resolution.
5. Model persona/relationship tanpa menjadikan SQ Hub sebagai universal business database.
6. Parent/guardian-child relationship, consent, dan perlindungan data anak.
7. Candidate-to-employee transition dan authority yang boleh membuka akses internal.
8. Model authorization eksternal untuk portal tanpa menyalahgunakan Application Access internal.
9. Data ownership dan API contract antara Portal dengan SPMB, Recruitment, Finance, Assessment, dan domain lain.
10. Nama produk/domain final untuk SQ Portal dan entry point publik.

## Non-goals for current Foundation v1

Dokumen ini tidak mengubah target UAT/cutover HCIS yang sedang berjalan. Foundation v1 tetap dapat diselesaikan dengan model staff identity yang ada.

Jangan memperluas current staging implementation menjadi public self-registration atau universal Person Registry hanya berdasarkan dokumen discovery ini.

## Direction summary

```text
                     SQ Account
                one person identity
                       |
          +------------+------------+
          |                         |
       SQ Portal                  SQ Hub
       external                   internal
    journey-oriented            work/app-oriented
          |                         |
  education / career       HCIS / Work / SPMB
  tests / billing          Finance / Recruitment
          |                         |
          +--------- domain applications --------+
```

Product intent:

- satu orang tidak perlu membuat identitas baru untuk setiap hubungan dengan Yayasan;
- internal dan external experience tetap dipisahkan dengan jelas;
- domain boundaries tetap kuat;
- pengalaman pengguna dapat terasa terpadu tanpa membangun ERP monolith.
