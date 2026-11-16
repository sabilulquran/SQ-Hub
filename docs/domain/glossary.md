# SQ Hub Glossary

**Status:** ACCEPTED. Ecosystem terms added 2026-11-16 (ADR-0014).

Gunakan istilah ini secara konsisten. Jangan membuat sinonim baru tanpa kebutuhan nyata.

## Ecosystem terms (ADR-0014)

- **SQ Hub** — seluruh ekosistem aplikasi Yayasan Sabilul Qur'an: satu nama payung, satu akun per orang per portal, aplikasi yang berdampingan. Bila yang dimaksud hanya bagian bersama, tulis **platform SQ Hub** (atau sebut bagiannya: Beranda, Akun SQ, Admin SQ, Direktori Organisasi). Repo `SQ-Hub` memuat bagian platform itu dan aplikasi yang berjalan di proses Hub.
- **Portal** — pintu masuk untuk satu kelompok pengguna, dengan jenis akunnya. Ada enam (tabel di bawah).
- **Aplikasi** (application) — sistem yang mengurus satu bidang dan memegang data serta aturannya, misalnya HCIS, Aset SQ, Karir SQ, Kirim SQ, Kerja SQ. Sebuah aplikasi tetap disebut aplikasi di proses mana pun ia berjalan; tidak pernah "modul".
- **Modul** (module) — bagian di dalam satu aplikasi, misalnya Cuti dan Payroll di dalam HCIS.
- **Wajah** (face) — cara satu aplikasi tampil di satu portal. Ada empat: **Kelola** (pegawai yang berwenang mengoperasikan aplikasinya, di Portal Pegawai), **Layanan mandiri** (orang yang datanya diurus, di portal orang itu), **Laporan** (organ yayasan, di Portal Organ), **Publik** (siapa saja, di Situs publik). Datanya tetap satu; wajah hanya cara menampilkan.
- **Beranda** — halaman awal platform SQ Hub yang menampilkan aplikasi yang boleh dibuka seseorang.
- **Akun SQ** — satu akun per orang per portal, dan tempat mengelola kredensial sendiri.
- **Admin SQ** (Pusat Admin) — konsol untuk akun, Application Access, dan (target) peran.
- **SQ Core** — istilah lama untuk SQ Hub. Tidak dipakai lagi, kecuali pada nama teknis yang tidak dilihat pengguna (repo `sq-core-ops`, skrip `sq-core-*.sh`, database `sqcore_*`, nama berkas) dan pada catatan lama.

### Portals

| Portal | Pengguna | Akun |
| --- | --- | --- |
| **Portal Admin** | Admin akun, akses, dan peran | Akun staf dengan peran admin |
| **Portal Pegawai** | Pegawai | Akun staf (realm `sq-staff`) |
| **Portal Organ** | Pembina, Pengurus, Pengawas | Keanggotaan organ pada akun realm staf |
| **Portal Keluarga** (Keluarga SQ) | Orang tua dan wali | Akun keluarga (realm `sq-keluarga`) |
| **Portal Pelamar** | Pelamar kerja | Akun pelamar (realm rekrutmen) |
| **Situs publik** | Siapa saja | Tanpa login |

Alamat tiap portal, daftar aplikasi, dan statusnya ada di [`docs/product/struktur-sq-hub.md`](../product/struktur-sq-hub.md) (STRUKTUR-001).

### Reading older documents

ADR, specification, catatan rilis, dan runbook lama tidak ditulis ulang. Saat membacanya (ADR-0014 D8):

| Older wording | Means now |
| --- | --- |
| "SQ Core" | SQ Hub (ekosistem) |
| "SQ Hub" sebagai platform atau aplikasi | Bagian platform SQ Hub: Beranda, Akun SQ, Admin SQ, direktori dan registry |
| "modul SQ Hub", "shared module" | Aplikasi yang berjalan di dalam proses Hub (ADR-0014 D6) |
| "Ringkasan Yayasan" (ADR-0009) | Wajah Laporan; pintu masuknya bagi organ adalah Portal Organ (ADR-0012) |
| "Workspace (future)" | Kerja SQ |
| "Finance", "Academic", "Asset" | Keuangan, Sekolah, Aset SQ |

## Platform terms

- **SQ Identity** — capability identity dan authentication pada platform SQ Hub (nama yang dilihat pengguna: Akun SQ), yang nantinya menggunakan mature self-hosted Identity Provider sebagai mesin autentikasi/SSO.
- **Identity** — representasi global seorang pengguna internal di SQ Hub. Identity memiliki technical identifier yang stabil dan diperlakukan sebagai opaque identifier oleh aplikasi domain.
- **Staff** — manusia internal Sabilul Qur'an yang dapat memperoleh Identity dan akses aplikasi. Staff tidak identik dengan Employee record; tidak semua Staff harus memiliki Employee record atau NIP.
- **Staff Identifier** — identifier yang mudah digunakan manusia untuk proses login/administrasi. Untuk Employee, gunakan kembali NIP/nomor pegawai bila tersedia; jangan membuat nomor identitas paralel tanpa kebutuhan nyata. Policy fallback untuk Staff tanpa NIP ditentukan pada specification identity.
- **Employee** — data kepegawaian milik HCIS.
- **Application** — lihat **Aplikasi** di atas; bentuk Inggris yang dipakai di kontrak dan kode (Application Registry, Application Access).
- **Application Registry** — daftar resmi aplikasi di SQ Hub, dikelola di Admin SQ.
- **Application Access** — izin sebuah Identity untuk membuka Application tertentu.
- **Role** — sekumpulan tanggung jawab/permission dalam konteks aplikasi domain tertentu, kecuali dinyatakan lain.
- **Permission** — kemampuan spesifik yang diberikan oleh aplikasi/domain.
- **Authentication** — proses membuktikan siapa pengguna yang sedang masuk.
- **Authorization** — proses menentukan apa yang boleh dilakukan pengguna setelah identity diketahui.
- **SSO / Single Sign-On** — pengalaman ketika staff cukup melakukan authentication sekali dan dapat berpindah ke aplikasi lain yang diizinkan tanpa memasukkan credential lagi.
- **Organizational Unit** — unit organisasi tenaga kerja resmi yang di-author dan dimiliki HCIS sebagai system of authority.
- **Organization Directory** — read model/distribution layer milik platform SQ Hub (Direktori Organisasi) yang memproyeksikan fakta organisasi dari HCIS untuk dibaca aplikasi lain; bukan authoring system atau second master.
- **Domain** — area bisnis dengan ownership aturan dan data yang jelas, misalnya Human Capital, Admissions, atau Finance.
- **Data Owner / System of Record** — domain/sistem yang berwenang membuat dan mengubah data resmi tertentu.
- **Integration Contract** — interface yang disepakati untuk pertukaran data atau tindakan lintas domain, biasanya API/schema/event contract sesuai kebutuhan.
- **Design System** — prinsip, tokens, komponen, dan pola UI bersama yang membuat aplikasi di SQ Hub konsisten.
- **Hub Launcher** — peluncur aplikasi: daftar aplikasi yang dapat dibuka seseorang, tampil di Beranda dan di header tiap aplikasi.

## Reserved distinctions
- Identity != Employee.
- Staff != Employee.
- Staff Identifier != technical Identity identifier.
- Application Access != domain permission.
- Authentication != authorization.
- Organizational Unit != arbitrary label/string unit di aplikasi lokal.
- Organization Directory != workforce organization authoring/master.
- Organization facts != approval policy atau workflow state.
- Shared capability != business logic yang kebetulan dipakai di dua file.
- Aplikasi != Modul. Tempat kode berjalan (proses Hub atau program sendiri) tidak mengubah sebutannya.
- SQ Hub (ekosistem) != platform SQ Hub (bagian bersama) != Beranda (halaman awal).
- Portal != Aplikasi. Keluarga SQ dan Portal Organ adalah portal.
