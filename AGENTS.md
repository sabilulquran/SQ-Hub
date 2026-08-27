# SQ Hub Engineering Rules

Dokumen ini berlaku untuk manusia, ChatGPT, Codex, dan automation lain yang mengubah repository.

## 1. Source of truth
Urutan otoritas:
1. `docs/product/` untuk tujuan, scope, dan acceptance criteria.
2. `docs/domain/` untuk istilah, ownership, dan perilaku domain.
3. ADR berstatus Accepted di `docs/architecture/adr/`.
4. Kontrak API/schema yang relevan.
5. Automated tests.
6. Implementasi kode.

Jika sumber bertentangan, jangan menebak. Perbarui specification/ADR atau eskalasi keputusan.

## 2. Documentation-first
- Fitur baru wajib memiliki specification ID sebelum implementasi.
- Jangan implementasikan requirement yang hanya merupakan inferensi AI.
- Prefer missing feature over invented feature.
- Perubahan perilaku wajib memperbarui dokumen sumber kebenaran yang relevan.
- Asumsi belum diputuskan harus diberi status `DRAFT`, `DISCOVERY`, atau `TBD`.

## 3. Progressive context
Agent tidak boleh membaca seluruh `docs/` secara default.
1. Baca `AGENTS.md`.
2. Baca spec task.
3. Baca hanya domain/ADR/security/design/operations docs yang dirujuk spec atau relevan langsung.
4. Inspeksi existing code dan tests.

## 4. Platform boundaries
- SQ Hub adalah shared digital foundation, bukan ERP monolith.
- Business logic HCIS, SPMB, Finance, Workspace, Academic, dan aplikasi lain tetap dimiliki aplikasi masing-masing.
- Shared capability hanya masuk SQ Hub jika benar-benar lintas aplikasi.
- Ownership setiap data harus eksplisit.
- Aplikasi tidak mengubah data milik domain lain secara langsung tanpa contract/integration yang disepakati.
- Jangan memperkenalkan microservice, event bus, atau shared abstraction besar tanpa kebutuhan nyata dan ADR.

## 5. Identity and access
- Staff authentication terpusat melalui SQ Identity.
- Password, MFA, recovery, dan session identity bukan tanggung jawab aplikasi domain.
- Application Access dikelola secara global oleh SQ Hub.
- Permission dan role spesifik domain tetap dimiliki aplikasi domain.
- Technical identity identifier diperlakukan sebagai opaque stable identifier; aplikasi tidak boleh bergantung pada formatnya.
- Untuk Employee, NIP/nomor pegawai dapat menjadi human login identifier. Staff tanpa NIP mengikuti policy identifier yang ditetapkan secara eksplisit.
- NIK tidak digunakan sebagai username/login identifier.

## 6. Organization
Organizational Unit adalah target shared master milik SQ Hub. Existing HCIS organization data tetap operasional sampai migration/cutover eksplisit selesai. Jangan membuat master unit paralel atau dual-write tanpa aturan sinkronisasi yang terdokumentasi.

## 7. Design system
- Semua aplikasi SQ Hub harus menggunakan prinsip visual, design tokens, dan shared UI patterns yang sama.
- Jangan menciptakan pola UI baru jika pola yang sesuai sudah ada.
- Komponen shared baru dibuat saat reuse nyata atau kebutuhan lintas aplikasi terbukti.
- Business-specific UI tetap berada di aplikasi domain.

## 8. Security and privacy
- Gunakan data sintetis untuk development, prompt, test, screenshot, dan demo.
- Jangan commit secret, credential, token, production dump, atau data pribadi production.
- Terapkan least privilege.
- Auth, application access, cryptography, audit, dan migration memerlukan review tambahan.
- Jangan memberi agent AI unrestricted write access ke production database.

## 9. Environments and operations
Development/staging dan production harus terpisah secara logis walaupun dapat berada pada VPS yang sama. Agent tidak boleh menggunakan production sebagai playground development. Operational changes mengikuti `docs/operations/operational-baseline.md`.

## 10. Quality gates
Sebelum merge:
- acceptance criteria terpenuhi;
- typecheck/lint/test/build lulus ketika sudah tersedia;
- security-sensitive change memiliki test relevan;
- dokumentasi sinkron;
- migration memiliki recovery plan;
- tidak ada secret atau data production di diff;
- AI review memeriksa invented requirement, over-abstraction, unnecessary dependency, hidden authorization, destructive migration, silent fallback, dan data leakage.

## 11. Pull request discipline
- Satu PR memiliki tujuan dan scope jelas.
- Sertakan specification ID, perubahan perilaku, risiko, test evidence, dan rollback/recovery jika relevan.
- Jangan mencampur refactor besar dengan perubahan perilaku tanpa alasan kuat.
- Jangan menonaktifkan test atau melemahkan security agar perubahan lolos.
