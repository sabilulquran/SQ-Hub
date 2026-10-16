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

### Centralized account experience

Pengaturan identitas dan keamanan tidak seharusnya diduplikasi di setiap aplikasi domain.

Target experience mengikuti pemisahan berikut:

```text
SQ Identity
  -> authentication engine / IdP

SQ Account Center
  -> profil identitas dasar
  -> email / nomor HP yang diverifikasi sesuai policy
  -> password
  -> MFA dan recovery
  -> sesi / perangkat
  -> logout dan security activity

SQ Hub / SQ Portal / domain apps
  -> menggunakan identity yang sama
  -> tidak membuat ulang account-security settings masing-masing
```

Aplikasi domain seperti HCIS, SPMB, Finance, Recruitment, dan Work tidak menjadi tempat untuk mengganti password, mengatur MFA, recovery, atau credential lifecycle ketika capability tersebut sudah dimiliki SQ Account/SQ Identity.

Menu profil/avatar di aplikasi dapat menyediakan shortcut konsisten seperti `Akun Saya`, `Keamanan`, dan `Keluar`, tetapi account/security management diarahkan ke pengalaman pusat.

Sebaliknya, pengaturan yang benar-benar domain-specific tetap berada di aplikasi pemilik domain. Contoh:

- HCIS: data kepegawaian, jabatan, unit, atasan, kebijakan HR, cuti, kehadiran, payroll;
- SPMB: akses operasional unit, workflow penerimaan, assignment follow-up;
- Finance: role finance, approval authority, cost center, payment workflow;
- Work: project/team configuration dan collaboration rules.

Prinsipnya:

> SQ Account mengelola "siapa saya dan bagaimana akun saya diamankan"; domain application mengelola "apa yang boleh dan perlu saya lakukan di domain tersebut".

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

## Administration model

### SQ Admin Center / platform administration

Administrasi yang benar-benar lintas aplikasi sebaiknya dipusatkan pada pengalaman administratif SQ Hub, bukan dibuat ulang di HCIS, SPMB, Finance, dan aplikasi lain.

Target capability dapat mencakup:

- SQ Account lifecycle dan status identity;
- Application Registry;
- grant/revoke Application Access;
- provisioning dan offboarding lintas aplikasi;
- shared Organizational Unit pada saat master bersama sudah diimplementasikan;
- audit dan security administration yang memang lintas aplikasi;
- konfigurasi platform yang tidak dimiliki satu domain tertentu.

Nama produk final untuk pengalaman ini belum diputuskan. `SQ Admin Center` digunakan sebagai working term.

### Platform administrator is not universal domain superuser

Sentralisasi administrasi platform tidak berarti satu role memperoleh akses penuh ke seluruh business data.

Working role concept:

```text
SQ Platform Administrator
  -> account / identity administration
  -> application access administration
  -> platform/shared organization administration
  -> platform audit/configuration

Domain Administrator
  -> HCIS administration
  -> Finance administration
  -> SPMB administration
  -> Recruitment administration
  -> Work administration
```

Seseorang dapat memiliki role platform administrator dan satu atau beberapa domain role, tetapi keduanya harus eksplisit dan terpisah.

Contoh: SQ Platform Administrator tidak otomatis boleh mengubah payroll HCIS, menyetujui pembayaran Finance, mengubah hasil seleksi SPMB, atau membaca seluruh komunikasi Work hanya karena memiliki kewenangan platform.

Prinsipnya:

> Centralized administration tidak sama dengan centralized authorization.

### Direction for existing HCIS `SUPER_ADMIN`

Existing HCIS `SUPER_ADMIN` saat ini dapat mencampurkan concern platform/account dengan concern administrasi domain HCIS. Target jangka panjang adalah memisahkan concern tersebut secara bertahap.

Conceptual migration:

```text
Before
HCIS SUPER_ADMIN
  -> account/login concerns
  -> access concerns
  -> HCIS system/domain administration

Target
SQ Platform Administrator
  -> account / identity
  -> Application Access
  -> provisioning / offboarding
  -> shared platform administration

HCIS Domain Administrator
  -> HCIS configuration
  -> HCIS authorization
  -> HR business administration
```

Migrasi ini tidak berarti existing `SUPER_ADMIN` harus langsung dihapus pada Foundation v1. Perubahan role dan permission memerlukan specification, migration plan, security review, dan UAT tersendiri.

### Account status vs domain status

Status business dan status digital account harus dibedakan.

Contoh:

```text
HCIS employee.status = resigned
  -> fakta/business state kepegawaian

SQ Account disabled
  -> orang tidak dapat melakukan autentikasi ke ekosistem

SQ Hub Application Access: HCIS revoked
  -> identity tetap aktif, tetapi tidak boleh membuat sesi baru di HCIS
```

Status pegawai `resigned` dapat menjadi trigger workflow offboarding, tetapi tidak boleh disamakan secara implisit dengan credential state tanpa policy yang eksplisit.

Begitu pula local account status pada aplikasi existing dapat dipertahankan untuk compatibility selama migrasi, tetapi bukan pola default yang harus direplikasi ke aplikasi baru jika concern tersebut sudah dimiliki oleh SQ Account/Application Access.

## Product boundaries

### SQ Hub owns

- shared identity integration untuk internal;
- Application Registry dan Application Access;
- internal workspace shell/home/app navigation jika dibangun;
- centralized platform administration untuk capability lintas aplikasi;
- shared design system dan cross-application conventions;
- shared capabilities yang benar-benar lintas aplikasi.

### SQ Account / Identity owns

- credential lifecycle;
- authentication;
- password, MFA, dan recovery;
- verified account identifiers sesuai policy;
- account security/session experience;
- identity-level enable/disable policy.

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
- domain-specific authorization dan configuration;
- domain lain sesuai ownership masing-masing.

## Repository strategy

**Working recommendation:** dokumentasi ecosystem-level tetap berada di repository `SQ-Hub` selama masih dalam discovery karena keputusan identity, access, integration, dan experience model memengaruhi seluruh foundation.

Repository implementasi SQ Portal sudah disiapkan terpisah di **`imadjinasi/SQ-Portal`** (`https://github.com/imadjinasi/SQ-Portal`). Repository ini menjadi target implementasi/deployment SQ Portal ketika specification dan ADR yang diperlukan sudah diterima.

Alasannya:

- SQ Hub adalah internal shared foundation/workspace, sedangkan SQ Portal memiliki public/external attack surface;
- deployment dan scaling lifecycle dapat berbeda;
- release Portal tidak harus mengubah foundation;
- portal shell dapat berkembang tanpa mencampurkan business UI eksternal ke codebase platform internal;
- batas ownership tetap jelas.

Repository SQ Portal hanya memiliki portal experience dan integration layer yang diperlukan. Business logic SPMB, Recruitment, Finance, dan domain lain tidak dipindahkan ke repo tersebut.

Keputusan repository sudah diarahkan ke `imadjinasi/SQ-Portal`; implementasi tetap menunggu specification/ADR agar boundary identity, authorization, dan integration tidak diinventasikan saat coding.

## Entry points

Pengguna tidak wajib selalu memulai dari portal home.

Contoh:

- `karier.sabilulquran.or.id/...` -> lihat lowongan -> login/create account -> kembali ke lowongan;
- `daftar.sabilulquran.or.id/...` -> pilih program -> login/create account -> mulai pendaftaran;
- `portal.sabilulquran.or.id` -> melihat keseluruhan hubungan personal dengan Yayasan.

SQ Portal menjadi consolidated personal home, sementara entry point publik tetap boleh domain/journey-specific.

## Important open decisions

Sebelum implementasi eksternal dan perluasan admin model, keputusan berikut wajib dispesifikasikan dan sebagian kemungkinan memerlukan ADR:

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
11. Scope, privilege boundary, dan break-glass policy untuk `SQ Platform Administrator`.
12. Bentuk final SQ Account Center dan SQ Admin Center: route/deployment terpisah atau surface di SQ Hub.
13. Migration path dari HCIS `SUPER_ADMIN` dan local account administration ke platform/domain roles yang terpisah.
14. Policy yang menghubungkan employee lifecycle, offboarding, Application Access, dan SQ Account disable tanpa hidden coupling.

## Non-goals for current Foundation v1

Dokumen ini tidak mengubah target UAT/cutover HCIS yang sedang berjalan. Foundation v1 tetap dapat diselesaikan dengan model staff identity yang ada.

Jangan memperluas current staging implementation menjadi public self-registration atau universal Person Registry hanya berdasarkan dokumen discovery ini.

Jangan menghapus atau mengubah semantics existing HCIS `SUPER_ADMIN`/account status hanya berdasarkan dokumen discovery ini; perubahan tersebut membutuhkan specification dan migration plan tersendiri.

## Direction summary

```text
                         SQ Account
                    one person identity
                           |
             +-------------+-------------+
             |                           |
         SQ Portal                    SQ Hub
         external                     internal
      journey-oriented              work/app-oriented
             |                           |
  education / career         HCIS / Work / SPMB / Finance
  tests / billing                 / Recruitment / ...
                                         |
                                  SQ Admin Center
                                  platform scope only
             |                           |
             +-------- domain applications --------+
```

Product intent:

- satu orang tidak perlu membuat identitas baru untuk setiap hubungan dengan Yayasan;
- account/security management dipusatkan dan tidak diduplikasi per aplikasi;
- internal dan external experience tetap dipisahkan dengan jelas;
- platform administration dipusatkan tanpa menciptakan universal domain superuser;
- domain boundaries dan domain authorization tetap kuat;
- pengalaman pengguna dapat terasa terpadu tanpa membangun ERP monolith.
