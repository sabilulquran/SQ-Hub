# SQ Hub Engineering Rules

Dokumen ini berlaku untuk manusia, ChatGPT, Codex, dan automation lain yang mengubah repository.

## 1. Source of truth
Urutan otoritas:
1. `docs/product/` untuk tujuan, scope, dan acceptance criteria.
2. `docs/domain/` untuk istilah, ownership, dan perilaku domain.
3. ADR berstatus Accepted di `docs/architecture/adr/`.
4. `docs/specs/` untuk implementation contract task yang sudah scoped.
5. Kontrak API/schema yang relevan.
6. Automated tests.
7. Implementasi kode.

Jika sumber bertentangan, jangan menebak. Perbarui specification/ADR atau eskalasi keputusan.

## 2. Documentation-first
- Fitur baru wajib memiliki specification ID sebelum implementasi.
- Jangan implementasikan requirement yang hanya merupakan inferensi AI.
- Prefer missing feature over invented feature.
- Perubahan perilaku wajib memperbarui dokumen sumber kebenaran yang relevan.
- Asumsi belum diputuskan harus diberi status `DRAFT`, `DISCOVERY`, atau `TBD`.
- Wave 1 implementation wajib mengacu pada salah satu `HUB-IMPL-00x`; jangan mengerjakan task generik seperti "implement SQ Hub".

## 3. Progressive context
Agent tidak boleh membaca seluruh `docs/` secara default.
1. Baca `AGENTS.md`.
2. Baca spec task di `docs/specs/`.
3. Baca hanya product/domain/ADR/security/design/operations/migration docs yang dirujuk spec atau relevan langsung.
4. Inspeksi existing code dan tests.

Untuk Wave 1:
- Keycloak staging -> `HUB-IMPL-001` + ADR-0003 + auth/security/operations docs.
- Registry/Application Access -> `HUB-IMPL-002` + Foundation PRD + ADR-0006.
- HCIS OIDC -> `HUB-IMPL-003` + ADR-0005 + auth policy + HCIS source of truth.

Untuk task identity/auth, minimum baca:
- ADR-0003 (Keycloak);
- ADR-0005 (HCIS auth migration) bila menyentuh HCIS;
- `docs/security/staff-authentication-policy.md`;
- `docs/security/security-baseline.md`;
- cutover plan bila task memengaruhi provisioning/migration/deployment.

Untuk task visual lintas aplikasi, baca `docs/design/hcis-baseline.md` sebelum membuka seluruh frontend HCIS.

## 4. Platform boundaries
- SQ Hub adalah shared digital foundation, bukan ERP monolith.
- Business logic HCIS, SPMB, Finance, Workspace, Academic, dan aplikasi lain tetap dimiliki aplikasi masing-masing.
- Shared capability hanya masuk SQ Hub jika benar-benar lintas aplikasi.
- Ownership setiap data harus eksplisit.
- Aplikasi tidak mengubah data milik domain lain secara langsung tanpa contract/integration yang disepakati.
- Jangan memperkenalkan microservice, event bus, atau shared abstraction besar tanpa kebutuhan nyata dan ADR.

## 5. Identity and access
- Staff authentication terpusat melalui SQ Identity dengan Keycloak sebagai IdP engine (ADR-0003).
- Jangan membuat custom OAuth/OIDC/MFA protocol implementation ketika Keycloak/standard flow memenuhi kebutuhan.
- Password, MFA, recovery, dan IdP session bukan tanggung jawab aplikasi domain.
- Application Access dikelola secara global oleh SQ Hub, bukan menjadi Keycloak role source of truth.
- Permission dan role spesifik domain tetap dimiliki aplikasi domain; jangan memindahkannya ke Keycloak Authorization Services tanpa superseding ADR.
- Technical identity mapping menggunakan OIDC `issuer + sub` sebagai opaque stable identifier; aplikasi tidak boleh bergantung pada formatnya.
- Employee login menggunakan NIP/`employee_number` sebagai primary username; verified unique email dapat menjadi alternate login.
- Staff tanpa NIP menggunakan verified unique email pada Foundation v1; jangan invent Staff number.
- NIK tidak digunakan sebagai username/login identifier.
- Browser app tidak menyimpan access/refresh token di localStorage/sessionStorage.
- Jangan membuat wildcard/shared auth cookie lintas seluruh subdomain.
- Machine-to-machine calls menggunakan dedicated service identity; jangan reuse credential manusia.
- Jangan membuat setiap protected domain request synchronously bergantung pada SQ Hub hanya untuk access checking. Ikuti timing contract pada `HUB-IMPL-002`/`003`.

### HCIS auth migration guardrails
- Preserve existing HCIS local principal `accounts.id` during migration.
- Jangan migrasikan password hash, MFA secret, recovery code, atau session HCIS ke Keycloak.
- Jangan membuat custom Keycloak credential compatibility plugin kecuali ada superseding ADR.
- Production tidak boleh menawarkan local-password login dan OIDC login secara paralel setelah cutover.
- OIDC failure harus fail closed; tidak boleh silent fallback ke local auth.
- Legacy credential retention maksimum 14 hari hanya untuk explicit rollback, lalu wajib dihapus setelah accepted cutover.

## 6. Organization
- HCIS adalah system of authority dan tempat authoring untuk workforce organization: unit organisasi, posisi/jabatan, penempatan pegawai, hubungan atasan, effective dates, dan data ketenagakerjaan terkait.
- SQ Hub memiliki shared **Organization Directory** sebagai read model/distribution layer lintas aplikasi; Hub tidak mengedit fakta organisasi milik HCIS.
- Integrasi HCIS -> Hub menggunakan authenticated controlled contract dan dedicated service identity. Jangan direct database coupling.
- Jangan membuat dual-write HCIS/Hub, master organisasi paralel, atau menjadikan Keycloak organization master.
- Approval policy, workflow state, delegation, escalation, domain authorization, dan audit keputusan tetap dimiliki aplikasi domain. SQ Hub bukan central approval engine.
- Hub hanya menyediakan fakta organisasi untuk candidate approver/scope. Domain app menyimpan resolved-approver snapshot beserta organization version/effective time saat transaksi diajukan; perubahan struktur berikutnya tidak boleh diam-diam menulis ulang approval berjalan tanpa aturan domain eksplisit.
- Organization Directory harus mendukung last-known-good projection dan metadata source/version/synchronized_at atau as_of/staleness sesuai ADR-0007 dan HUB-IMPL-018.
- SLA, global identifier, snapshot/delta, conflict handling, dan retention tetap DISCOVERY/TBD sampai diputuskan eksplisit.

## 7. Engineering stack
- Foundation stack mengikuti ADR-0006: TypeScript/Node.js, Fastify/PostgreSQL untuk API, React/Vite/Tailwind untuk web saat dibutuhkan.
- Jangan copy semua dependency HCIS; tambahkan hanya dependency yang digunakan.
- Repo tetap independently deployable dari HCIS.
- Jangan membuat shared package sebelum ada consumer/reuse nyata dan distribution strategy yang diterima.

## 8. Design system
- HCIS visual system pada snapshot yang ditetapkan ADR-0004 adalah baseline awal SQ Design System.
- Semua aplikasi SQ Hub harus menggunakan prinsip visual, semantic tokens, dan shared UI patterns yang senada dengan baseline tersebut.
- SQ Identity/Keycloak harus ditheme mengikuti SQ design language; jangan menerima default provider UI sebagai final product experience.
- Jangan menciptakan pola UI baru jika pola HCIS/SQ yang sesuai sudah ada.
- Jangan menyalin business-specific HCIS component lalu menganggapnya generic shared component.
- Komponen shared baru dibuat saat reuse nyata atau kebutuhan lintas aplikasi terbukti.
- Business-specific UI tetap berada di aplikasi domain.
- Setelah shared primitives tersedia di SQ Hub, SQ Hub menjadi canonical source untuk design system lintas produk.

## 9. Security and privacy
- Gunakan data sintetis untuk development, prompt, test, screenshot, dan demo.
- Jangan commit secret, credential, token, production dump, atau data pribadi production.
- Terapkan least privilege.
- Auth, application access, cryptography, audit, dan migration memerlukan review tambahan.
- Jangan memberi agent AI unrestricted write access ke production database atau Keycloak admin API.

## 10. Environments and operations
Development/staging dan production harus terpisah secara logis walaupun dapat berada pada VPS yang sama. Agent tidak boleh menggunakan production sebagai playground development. Operational changes mengikuti `docs/operations/operational-baseline.md`.

Wave 1 staging hostnames:
- `login.sabilulquran.or.id` (SQ Identity staging uses the `sq-staff-staging` realm and separate staging data/configuration);
- `hub-staging.sabilulquran.or.id`;
- `hcis-staging.sabilulquran.or.id`.

## 11. Quality gates
Sebelum merge:
- acceptance criteria terpenuhi;
- typecheck/lint/test/build lulus ketika sudah tersedia;
- security-sensitive change memiliki test relevan;
- dokumentasi sinkron;
- migration memiliki recovery plan;
- tidak ada secret atau data production di diff;
- AI review memeriksa invented requirement, over-abstraction, unnecessary dependency, hidden authorization, destructive migration, silent fallback, data leakage, design drift, dan unintended runtime coupling.

Untuk auth/OIDC migration, verification juga wajib memeriksa identity mapping, fail-closed behavior, token storage, cookie security, Application Access, local authorization continuity, logout, backup/restore, dan rollback rehearsal.

## 12. Pull request discipline
- Satu PR memiliki tujuan dan scope jelas.
- Sertakan specification ID, perubahan perilaku, risiko, test evidence, dan rollback/recovery jika relevan.
- Jangan mencampur refactor besar dengan perubahan perilaku tanpa alasan kuat.
- Jangan menonaktifkan test atau melemahkan security agar perubahan lolos.
