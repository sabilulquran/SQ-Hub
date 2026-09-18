# HUB-IMPL-018 — Organization Directory foundation

**Status:** DISCOVERY  
**Product:** SQ Hub  
**Area:** Organization integration / shared directory  
**Depends on:** ADR-0001, ADR-0007, Foundation PRD, ownership and integration boundary

## Outcome

Mendefinisikan calon implementation contract untuk projection/distribution struktur organisasi dari HCIS ke SQ Hub Organization Directory tanpa memindahkan authoring, business workflow, atau approval engine ke Hub.

Specification ini **tidak mengotorisasi implementasi** API, database, migration, worker, event bus, message broker, UI, atau deployment.

## Goals

- mempertahankan HCIS sebagai system of authority dan authoring workforce organization;
- menyediakan calon contract terautentikasi HCIS → Hub;
- menyediakan calon read contract Hub → aplikasi domain;
- mendefinisikan kebutuhan versioning, effective dating, last-known-good, staleness, reconciliation, idempotency, privacy, service identity, dan audit metadata;
- menetapkan boundary approval snapshot untuk consumer domain;
- menyiapkan acceptance criteria untuk fase implementasi mendatang.

## Non-goals

- memindahkan Organizational Unit master ke SQ Hub;
- membuat organization authoring UI di Hub;
- direct database integration ke HCIS;
- dual-write HCIS/Hub;
- menjadikan Keycloak organization master;
- membuat central approval engine;
- memindahkan approval policy, workflow state, delegation, escalation, domain authorization, atau decision audit ke Hub;
- menentukan SLA, identifier global, snapshot/delta mechanism, conflict policy, atau retention sebelum discovery selesai;
- mengimplementasikan runtime pada PR discovery ini.

## Producer dan consumers

### Producer

**HCIS** adalah producer dan system of authority untuk:

- unit organisasi tenaga kerja;
- posisi/jabatan;
- penempatan pegawai;
- hubungan atasan;
- effective dates;
- data ketenagakerjaan terkait yang memang dibutuhkan oleh contract.

### Hub consumer / distributor

**SQ Hub Organization Directory** mengonsumsi contract HCIS sebagai projection/read model dan mendistribusikan fakta organisasi yang diperlukan lintas aplikasi.

Hub tidak mengedit fakta tersebut dan tidak menulis balik perubahan organisasi ke HCIS.

### Domain consumers

Finance, Workspace, dan aplikasi domain lain mengonsumsi read contract Organization Directory sesuai kebutuhan dan authorization masing-masing.

Consumer tidak boleh menganggap data directory sebagai approval decision; directory hanya memasok fakta organisasi.

## Candidate contract properties

### Snapshot vs delta

Mekanisme ingestion **TBD**:

- full snapshot;
- delta/change feed;
- atau kombinasi keduanya.

Keputusan harus mempertimbangkan correctness, recovery, reconciliation, volume, dan operability. Jangan mengimplementasikan event bus/message broker hanya untuk memenuhi kontrak ini tanpa keputusan arsitektur terpisah.

### Versioning

Contract harus memiliki version yang memungkinkan:

- consumer mengetahui projection yang digunakan;
- Hub mendeteksi urutan/gap/duplikasi sesuai mekanisme yang akhirnya dipilih;
- domain transaction menyimpan referensi organization version yang dipakai untuk resolution.

Exact version format dan ordering semantics: **TBD**.

### Identifier

Identifier HCIS saat ini tidak otomatis menjadi identifier lintas aplikasi.

Discovery implementasi wajib mengaudit:

- stability;
- uniqueness;
- lifecycle/reuse;
- environment semantics;
- mapping requirements.

Bentuk global identifier dan mapping contract: **TBD**.

### Effective dating

Contract harus mempertahankan effective dates dari HCIS sehingga consumer dapat memahami fakta yang berlaku pada waktu tertentu.

Exact temporal model, timezone semantics, interval rules, dan query contract: **TBD**.

### Last-known-good

Hub harus dapat mempertahankan last-known-good projection yang sudah tervalidasi.

Ketika HCIS sementara tidak tersedia:

- read contract dapat melayani last-known-good;
- response/metadata harus mengungkap staleness secara eksplisit;
- Hub tidak boleh menganggap stale projection sebagai sinkronisasi baru;
- Hub tidak boleh membuat data pengganti.

### Staleness visibility

Metadata calon contract minimum harus dapat menyampaikan secara konseptual:

- `source`;
- `version`;
- `synchronized_at` dan/atau `as_of`;
- indikator staleness.

Exact field names/wire format dapat berubah pada implementation spec lanjutan.

### Reconciliation

Implementation mendatang harus memiliki mekanisme reconciliation yang dapat:

- membandingkan projection dengan source contract;
- mendeteksi missing/duplicate/out-of-order state sesuai mekanisme yang dipilih;
- aman dijalankan ulang;
- menghasilkan evidence/audit metadata;
- tidak menulis langsung ke database HCIS.

Cadence, alert threshold, dan conflict handling: **TBD**.

### Idempotency

Ingestion/reconciliation harus dirancang idempotent sehingga retry tidak menciptakan duplicate organization state atau divergent projection.

Exact idempotency key/algorithm: **TBD**.

## Security, privacy, dan service identity

- HCIS → Hub menggunakan dedicated machine/service identity, bukan credential manusia.
- Authentication dan authorization service-to-service wajib eksplisit dan least privilege.
- Secret/token tidak disimpan di payload, audit metadata, atau repository.
- Project only the minimum workforce facts required by cross-application consumers.
- Data pribadi/ketenagakerjaan yang tidak diperlukan tidak boleh disalin ke Hub hanya karena tersedia di HCIS.
- Consumer read access harus dibatasi sesuai kebutuhan aplikasi.
- Keycloak tidak menjadi organization master.

Exact service credential mechanism/audience/scope contract: **TBD** dan harus mengikuti security source of truth saat implementation.

## Audit metadata

Implementation mendatang harus dapat merekam metadata operasional yang cukup untuk menjawab:

- source contract/version apa yang diproses;
- kapan sinkronisasi dimulai/selesai;
- outcome;
- jumlah atau fingerprint non-sensitive yang relevan untuk reconciliation;
- error category tanpa secret/PII yang tidak diperlukan.

Audit sync tidak menggantikan audit keputusan/transaksi pada aplikasi domain.

## Approval snapshot contract

Hub tidak menjalankan approval.

Ketika domain app menggunakan Organization Directory untuk menentukan kandidat approver/scope dan transaksi diajukan, domain app harus menyimpan minimum secara konseptual:

- approver yang sudah di-resolve;
- organization version yang digunakan;
- effective time / `as_of` yang digunakan;
- domain-specific decision/audit metadata yang diperlukan.

Perubahan struktur organisasi berikutnya tidak boleh otomatis menulis ulang approval yang sedang berjalan. Re-resolution hanya terjadi jika domain tersebut memiliki aturan eksplisit.

Exact snapshot schema tetap milik domain dan **TBD** per consumer.

## Migration stages

Calon tahapan implementasi:

1. **Source audit** — inventaris field, lifecycle, identifier, effective dates, dan volume HCIS.
2. **Contract definition** — pilih identifier/version/snapshot-delta/security semantics.
3. **Projection build** — bangun read model Hub tanpa mengubah HCIS authoring.
4. **Reconciliation validation** — uji idempotency, gap detection, last-known-good, staleness.
5. **Consumer pilot** — satu consumer membaca Hub dengan fallback/behavior yang terdefinisi.
6. **Consumer migration** — pindahkan shared reads lain secara bertahap setelah evidence cukup.
7. **Cleanup** — hentikan jalur read paralel yang sudah tidak diperlukan tanpa menghapus source authority HCIS.

Tidak ada stage yang memindahkan authoring ke Hub.

## Rollback / recovery concept

Recovery harus memprioritaskan correctness source:

- HCIS tetap authority dan tidak di-rollback untuk menyesuaikan projection Hub;
- projection Hub dapat dibangun ulang dari source contract yang tervalidasi bila desain retention/version memungkinkan;
- consumer dapat memakai last-known-good sesuai staleness policy;
- deployment rollback tidak boleh memerlukan destructive database write ke HCIS;
- exact retention, replay window, checkpoint, dan rebuild procedure: **TBD**.

## Open decisions

Sebelum implementation dapat berstatus ACCEPTED, minimum keputusan berikut harus ditutup atau memiliki contract eksplisit:

- SLA/freshness target;
- global identifier dan mapping HCIS;
- snapshot vs delta;
- version scheme dan ordering semantics;
- effective-date wire/query semantics;
- conflict/gap handling;
- retention/history/replay window;
- reconciliation cadence dan alerting;
- service identity audience/scope;
- read authorization model per consumer;
- consumer behavior thresholds saat stale;
- operational capacity/volume assumptions.

## Acceptance criteria untuk fase implementasi mendatang

Implementation specification berikutnya harus membuktikan minimum:

1. HCIS tetap satu-satunya authoring/system of authority untuk workforce organization.
2. Tidak ada direct database coupling, dual-write, parallel master, atau Keycloak organization master.
3. HCIS → Hub contract terautentikasi dengan dedicated service identity dan least privilege.
4. Ingestion/reconciliation idempotent dan retry-safe.
5. Version/effective dating dipertahankan end-to-end.
6. Hub dapat melayani last-known-good dan mengungkap staleness secara eksplisit.
7. Reconciliation mendeteksi divergence/gap sesuai contract yang dipilih.
8. Data minimization dan privacy review lulus; secret/credential/PII tidak perlu tidak masuk payload/audit.
9. Consumer dapat membaca directory tanpa akses database HCIS.
10. Approval policy/workflow tetap di domain app, dan transaction snapshot menyimpan resolved approver + organization version/effective time.
11. Perubahan organisasi tidak diam-diam mengubah approval berjalan tanpa aturan domain eksplisit.
12. Recovery/rebuild/rollback procedure diuji tanpa destructive write ke HCIS.
13. CI/typecheck/lint/test/build untuk implementation terkait lulus.
14. Tidak ada klaim production deployment/validation tanpa evidence operator terpisah.

## Runtime status

HUB-IMPL-018 adalah **DISCOVERY**. Dokumen ini tidak menyatakan dynamic organization, ORG-004, Organization Directory API, projection worker, atau consumer integration sudah deployed maupun production-validated.
