# HUB-IMPL-018 — Organization Directory v1

**Status:** ACCEPTED
**Product:** SQ Hub
**Area:** Organization integration / shared directory
**Decision date:** 2026-09-24
**Depends on:** ADR-0001, ADR-0007, Foundation PRD, ownership and integration boundary
**Source contract:** HCIS ORG-006
**First named consumer:** Aset SQ (`application_key=aset-sq`, production origin `https://aset.sabilulquran.or.id`)

## Outcome

Mendefinisikan implementation contract v1 untuk aliran fakta workforce organization dari HCIS ke SQ Hub Organization Directory dan read contract yang dapat dipakai aplikasi lintas domain tanpa mengakses database HCIS.

Keputusan v1 ini menutup discovery pada HUB-IMPL-018 untuk identifier, transport, full-snapshot semantics, version/idempotency, effective date, deactivation, service identity, reconciliation, freshness, last-known-good, privacy, dan read API.

Status **ACCEPTED** mengotorisasi implementasi sesuai kontrak ini. Deployment/production activation tetap membutuhkan review, CI, configuration, migration/recovery evidence, dan operator acceptance terpisah.

## Ownership dan boundary

Tetap berlaku:

- HCIS adalah system of authority dan satu-satunya tempat authoring unit, posisi, penempatan pegawai, effective dates, dan lifecycle pegawai.
- SQ Hub hanya menyimpan projection/read model. Hub tidak menyediakan edit/writeback fakta HCIS.
- Keycloak/Akun SQ adalah identity/authentication engine, bukan organization master.
- Application Access tidak diturunkan dari posisi/unit.
- Domain authorization, approval policy, workflow state, delegation, escalation, dan audit keputusan tetap milik aplikasi domain.
- Tidak ada direct database coupling, dual-write, employee master paralel, organization master paralel, event bus, atau microservice baru pada v1.
- Aset SQ tidak boleh melakukan synchronous HCIS lookup pada setiap request. Aset SQ membaca projection Hub.

## Keputusan v1

### 1. Transport: pull full snapshot

HCIS menyediakan **authenticated full-snapshot HTTP contract**. SQ Hub melakukan pull terhadap endpoint producer; HCIS tidak push ke Hub.

Alasan:
- volume internal masih cocok untuk full snapshot;
- full snapshot memberi bootstrap, retry, replay, dan reconciliation dengan mekanisme yang sama;
- atomicity lebih mudah dibuktikan;
- tidak membutuhkan event bus/message broker;
- tidak membutuhkan ordered delta cursor yang belum ada pada model HCIS.

Delta/event feed bukan bagian v1. Perubahan ke delta harus mempunyai superseding specification/ADR bila kelak diperlukan.

### 2. Source endpoint HCIS

Contract producer v1:

`GET /internal/v1/organization-directory/snapshot?asOf=YYYY-MM-DD`

Aturan:
- `asOf` wajib berupa tanggal kalender `YYYY-MM-DD`;
- tanggal ditafsirkan sebagai **business date Asia/Jakarta**;
- HCIS hanya memilih snapshot ORG-004 berstatus `PUBLISHED` dengan `effective_on <= asOf`;
- same-effective-date revision mengikuti urutan canonical HCIS: `effective_on DESC, published_at DESC, created_at DESC, id DESC`;
- `DRAFT`, `VALIDATED`, dan future-effective snapshot tidak boleh bocor;
- export production default **OFF** sampai real ORG-004 structure untuk penggunaan directory telah diterima operator/Human Capital;
- bila export OFF atau tidak ada valid published snapshot, producer fail closed; **tidak ada fallback ORG-002/legacy dan tidak ada synthetic production fallback**.

### 3. Identifier contract

Row primary key snapshot-local tidak diekspos sebagai business identifier unit/position.

Identifier lintas sistem v1:

| Entity | Source HCIS | External ID |
| --- | --- | --- |
| Unit | `organization_nodes.stable_key` | `hcis:org-node:<uuid>` |
| Position | `organization_positions.stable_key` | `hcis:org-position:<uuid>` |
| Person/employee | `employees.id` | `hcis:employee:<uuid>` |

Keputusan:
- `stable_key` untuk node/position diterima sebagai stable business identifier v1 karena current clone/publish behavior mempertahankannya lintas change set.
- `employees.id` diterima sebagai stable HCIS person key v1. Employee import saat ini melakukan update berdasarkan `employee_number` tanpa mengganti `employees.id`; insert baru membuat UUID baru.
- NIP/`employee_number`, email, nama, title, dan `integration_code` **bukan identifier utama**.
- Consumer tidak boleh melakukan identity join berdasarkan nama/email/NIP.
- Perubahan NIP yang menghasilkan record employee baru tidak boleh disatukan otomatis oleh Hub; koreksi identity harus diselesaikan di HCIS secara eksplisit.

### 4. Person ↔ Akun SQ identity mapping

Aset Saya membutuhkan pemetaan login ke person.

Producer boleh memproyeksikan hanya opaque identity reference yang sudah terikat pada employee HCIS:
- `issuer`;
- `subject` / OIDC `sub`.

Hub dapat menyediakan lookup person by `issuer + subject`.

Tidak diproyeksikan:
- password/hash;
- token;
- session;
- client secret;
- email akun hanya untuk identity matching;
- Keycloak group/role sebagai organisasi.

Absennya mapping identity tidak menghapus person dari directory; person masih dapat dipilih sebagai custodian sesuai policy consumer, tetapi self lookup tidak boleh ditebak dari email/NIP.

### 5. Version dan ordering semantics

Full snapshot v1 tidak memakai monotonic delta cursor.

Envelope producer membawa:
- `schemaVersion = hcis-organization-directory.v1`;
- `source.system = hcis`;
- `source.snapshotId = organization_change_sets.id`;
- `source.effectiveOn`;
- `source.publishedAt`;
- `source.createdAt`;
- `asOf`;
- `version = sha256:<hex>`, content digest atas payload canonical yang tervalidasi;
- `generatedAt`;
- count metadata.

Semantics:
- `version` adalah **content identity**, bukan angka urut dan tidak boleh dibandingkan dengan `>`/`<`;
- source snapshot order hanya menjelaskan ORG-004 revision selection;
- perubahan person master yang tidak mengubah change set tetap mengubah content digest;
- Hub hanya menjalankan satu apply per directory source pada satu waktu;
- karena transport full snapshot, tidak ada "gap delta" yang perlu dilewati; reconciliation adalah full re-pull + validation + digest comparison.

### 6. Idempotency dan atomic apply

- Pull ulang yang menghasilkan `version` sama bersifat idempotent.
- Hub boleh memperbarui successful-sync metadata tanpa menulis ulang seluruh projection bila version sama.
- Version berbeda hanya boleh menjadi visible setelah seluruh payload lolos schema/referential validation dan commit database atomik selesai.
- Consumer tidak boleh melihat campuran dua version.
- Kegagalan validasi/apply mempertahankan last-known-good.

### 7. Effective-date semantics

Semua date-only field memakai `YYYY-MM-DD`, inclusive:
- `effectiveFrom <= asOf`;
- `effectiveTo == null || effectiveTo >= asOf`.

Producer mempertahankan source effective dates. Hub tidak menggeser tanggal berdasarkan UTC.

Directory current search menggunakan `asOf` projection yang terakhir berhasil disinkronkan. Historical business transaction tetap harus menyimpan unit/person reference dan version/as-of yang digunakan bila domain membutuhkan audit historis.

### 8. Deactivation, retirement, deletion

Person:
- source status tetap `active|inactive|resigned`;
- `active=true` hanya bila HCIS employee `status='active'` dan `removed_at IS NULL`;
- inactive/resigned/removed diproyeksikan sebagai `active=false`; bukan hard delete.

Unit/position:
- `active` dan `effectiveTo` dari HCIS dipertahankan.
- Entity yang sebelumnya terlihat namun tidak ada pada full snapshot baru tidak dianggap "never existed". Hub menandainya sebagai source-absent/tombstoned, mengeluarkannya dari active search, dan tetap dapat mengembalikan identifier/display minimum untuk referential continuity.
- Hub tidak menulis retirement kembali ke HCIS.

Hard-delete person bukan normal lifecycle v1 dan tidak boleh dipakai sebagai offboarding signal.

### 9. Minimum projection / privacy

Unit:
- id;
- name;
- node type;
- parent unit id;
- active;
- effectiveFrom/effectiveTo.

Position:
- id;
- unit id;
- title;
- parent position id;
- active;
- effectiveFrom/effectiveTo.

Person:
- id;
- employeeNumber untuk authorized internal search/display;
- displayName;
- active;
- employmentStatus bila tersedia;
- startedOn/endedOn bila tersedia;
- current primary unit id bila tersedia;
- current structural position ids dan primary structural position id bila tersedia;
- opaque OIDC identity refs bila mapped.

Tidak diproyeksikan:
- NIK;
- alamat;
- telepon;
- payroll/payslip;
- rekening;
- medical/biometric;
- dokumen pegawai;
- free-text removal/acting/reporting reasons;
- raw import source snapshot;
- approval history;
- role/capability grants;
- raw audit payload.

### 10. Service identity HCIS → Hub pull

Caller producer endpoint adalah dedicated Keycloak client-credentials identity:

- recommended client id: `sq-hub-organization-directory`;
- token issuer: production/staging Akun SQ realm sesuai environment;
- audience: `hcis-organization-directory`;
- required scope: `organization-directory.read`.

HCIS memverifikasi JWT lokal melalui Keycloak JWKS dan wajib memeriksa:
- signature;
- issuer;
- audience;
- expiry/not-before oleh library;
- allowlisted `azp`/`client_id`;
- required scope.

Credential manusia, Hub browser cookie, atau Aset user token tidak boleh dipakai untuk producer pull.

### 11. Freshness, retry, last-known-good

Target operational v1:
- target pull cadence: **5 menit**;
- projection dianggap **STALE setelah 15 menit** sejak successful synchronization terakhir;
- Hub tetap dapat melayani last-known-good saat HCIS gagal/unavailable;
- Hub tidak mengubah `synchronizedAt` pada failed pull;
- no last-known-good => directory read gagal `503 DIRECTORY_UNAVAILABLE`.

Retry:
- transient source/network error: retry pada run berikutnya; scheduler boleh memakai backoff 1m → 2m → 5m, maksimum cadence normal 5m;
- auth 401/403 dan schema validation failure diperlakukan sebagai configuration/contract incident, bukan retry loop agresif;
- response 4xx karena invalid request tidak diretry otomatis.

Tidak ada hard expiry yang diam-diam menghapus LKG. Consumer menerima staleness metadata dan menerapkan risk policy domainnya.

### 12. Reconciliation

Reconciliation v1 = full-pull validation:
1. fetch snapshot untuk business date target;
2. validate schema version, identifier namespaces, references, duplicates, effective periods;
3. hitung/validasi content digest;
4. bandingkan version/counts dengan current LKG;
5. atomic apply atau idempotent no-op;
6. record sync attempt/outcome tanpa payload PII;
7. expose status/freshness.

Operator harus dapat memicu reconciliation manual memakai mekanisme yang sama. Rebuild projection dilakukan dari HCIS full snapshot; tidak ada destructive write ke HCIS.

### 13. Observability

Minimum sync metadata:
- attempt id/correlation id;
- start/finish timestamp;
- result `APPLIED|UNCHANGED|FAILED`;
- source snapshot id;
- source version;
- asOf;
- counts;
- error category;
- synchronizedAt untuk last success.

Log/audit tidak menyimpan token, credential, full person payload, NIP list, atau nama massal.

## HCIS producer response shape

Contoh hanya memakai synthetic data:

```json
{
  "schemaVersion": "hcis-organization-directory.v1",
  "source": {
    "system": "hcis",
    "snapshotId": "00000000-0000-4000-8000-000000000101",
    "effectiveOn": "2026-09-01",
    "publishedAt": "2026-09-01T01:00:00.000Z",
    "createdAt": "2026-08-25T01:00:00.000Z"
  },
  "asOf": "2026-09-24",
  "version": "sha256:<hex>",
  "generatedAt": "2026-09-24T01:30:00.000Z",
  "counts": { "units": 2, "positions": 2, "people": 3 },
  "units": [],
  "positions": [],
  "people": []
}
```

Exact field constraints are shared by ORG-006 and automated contract tests; implementation may add backward-compatible metadata but may not weaken privacy or identity semantics silently.

## SQ Hub → Aset SQ read contract

Read API adalah machine-to-machine API Hub, bukan public browser API.

Aset SQ tetap memakai:
- Application Access key: `aset-sq`;
- allowed production origin: `https://aset.sabilulquran.or.id`.

Directory read sendiri memakai dedicated machine identity, recommended client id `aset-sq-directory`, bukan browser/OIDC credential pengguna. Scope minimum `organization-directory.read`.

### Common metadata

Setiap successful response membawa:

```json
{
  "directory": {
    "source": "hcis",
    "version": "sha256:<hex>",
    "asOf": "2026-09-24",
    "synchronizedAt": "2026-09-24T01:30:00.000Z",
    "stale": false,
    "staleForSeconds": 0
  }
}
```

### Unit endpoints

- `GET /internal/v1/organization-directory/units?q=<text>&active=true|false&limit=<n>&cursor=<opaque>`
- `GET /internal/v1/organization-directory/units/{unitId}`
- `GET /internal/v1/organization-directory/units/{unitId}/ancestry`

Ancestry:
- mengembalikan chain dari requested unit ke root;
- cycle/missing-parent adalah projection integrity error dan harus fail closed;
- Aset SQ dapat memakai chain sebagai **fakta scope**, tetapi keputusan permission tetap milik Aset SQ.

### Person endpoints

- `GET /internal/v1/organization-directory/people?q=<name-or-employee-number>&active=true|false&unitId=<unitId>&limit=<n>&cursor=<opaque>`
- `GET /internal/v1/organization-directory/people/{personId}`
- `GET /internal/v1/organization-directory/people/by-identity?issuer=<issuer>&subject=<sub>`

Search tidak mengembalikan email/telepon/NIK.

### Error contract

- `400 INVALID_REQUEST`
- `401 UNAUTHENTICATED`
- `403 FORBIDDEN_CLIENT`
- `404 DIRECTORY_ENTRY_NOT_FOUND`
- `409 DIRECTORY_INTEGRITY_ERROR`
- `503 DIRECTORY_UNAVAILABLE` bila belum pernah ada LKG valid.

Stale LKG tetap `200` dengan `stale=true`, bukan disamarkan sebagai fresh.

## Aset SQ usage boundary

Directory v1 mendukung:
- owning-unit selection dari unit search;
- custodian lookup dari person search;
- scope authorization input dari unit ancestry;
- Aset Saya dari person-by-identity;
- offboarding detection dari `person.active=false`.

Aset SQ wajib menyimpan stable `unitId/personId` pada record domainnya. Aset SQ tidak menyimpan employee/org master paralel dan tidak mengubah directory.

Perubahan directory tidak otomatis memindahkan custody/ownership asset yang sudah tercatat. Offboarding merupakan trigger/input untuk workflow Aset SQ, bukan silent reassignment.

## Rollout

1. Merge/review contract Hub dan ORG-006 producer contract HCIS.
2. Implement/test producer HCIS dengan export gate default OFF.
3. Implement Hub projection + sync/reconciliation + read API dalam PR Hub runtime terpisah bila belum berada pada perubahan ini.
4. Provision dedicated service identities/secrets per environment.
5. Bootstrap staging dengan synthetic/staging-approved data.
6. Verify idempotency, stale/LKG, invalid snapshot rejection, deactivation, identity lookup, ancestry.
7. Human Capital accepts real ORG-004 structure for directory use.
8. Enable HCIS export, bootstrap production Hub projection, verify counts/digest/status without printing production person data.
9. Onboard Aset SQ adapter using `aset-sq-directory`.
10. No direct HCIS fallback is introduced.

## Rollback / recovery

HCIS producer rollback:
- disable export gate;
- revert code/config release if needed;
- no organization data migration/writeback is required by producer read endpoint.

Hub rollback:
- keep last-known-good projection;
- roll back runtime code without mutating HCIS;
- projection may be rebuilt from a valid full snapshot.

Consumer rollback:
- disable Aset integration/feature path as domain policy permits;
- do not switch to direct HCIS database/API per-request fallback.

## Acceptance criteria

1. HCIS remains sole authoring/system of authority.
2. Identifier mapping is deterministic and documented.
3. Full snapshot producer uses dedicated service identity, expected issuer/audience/client/scope.
4. Producer exports no DRAFT/VALIDATED/future-effective snapshot.
5. Producer is disabled by default until accepted real structure; no legacy/synthetic production fallback.
6. Version is content-addressed and retries are idempotent.
7. Person deactivation is explicit; no hard-delete offboarding semantics.
8. Hub projection applies atomically and retains LKG on failure.
9. Freshness/staleness metadata is visible to every consumer.
10. Reconciliation is full-pull, repeatable, and does not write HCIS.
11. Unit/person search, one-record reads, ancestry, and identity lookup are contractually defined.
12. Aset SQ can implement its adapter without HCIS DB access or live HCIS dependency per request.
13. Privacy projection excludes unnecessary employment/security data.
14. Tests cover authorization, schema validation, effective dates, deactivation, idempotency/retry behavior, failure/LKG, and ancestry integrity where runtime exists.
15. Migration/recovery/rollout/rollback are documented.
16. Typecheck/lint/test/build pass for runtime-changing PRs.
17. No secret or production person data is committed/logged.
18. No merge or deployment is implied by specification acceptance.

## Runtime status

Contract v1: **ACCEPTED**.

This specification does not itself claim that the Hub projection/read API is deployed. Runtime status must be evidenced by its implementation PR and environment-specific acceptance.
