# HUB-IMPL-012 — Organizational Unit Master Foundation

**Status:** DRAFT / PROPOSED

**Scope:** SQ Hub Organizational Unit target-model foundation and HCIS migration preparation

**Not authorized by this document:** HCIS cutover, dual-write, production import, live HCIS writes, staging/production deployment

## 1. Intent and ownership boundary

Foundation v1 identifies SQ Hub as the target system of record for shared Organizational Unit master data. The actual migration/cutover from HCIS remains an open reviewed operation. This proposal therefore builds only a non-destructive pre-cutover foundation that can be audited before ownership changes.

Until a separate cutover is accepted: HCIS continues to own its current HR/domain organization behavior; SQ Hub does not write HCIS tables or infer HCIS authority/workflow semantics; no dual-write is introduced; no absence from an SQ Hub import snapshot deletes/deactivates an existing SQ Hub unit; and Admin Center/API responses label the foundation `PRE_CUTOVER`.

Organizational Unit master data is not a universal domain-permission engine. Platform Administrator may administer this platform master but does not become a universal HCIS/domain superuser.

## 2. Proposed stable data model

`organizational_units` contains UUID `id` as internal SQ Hub identity; immutable unique `unit_key` as stable integration key; mutable human `name`; nullable `parent_id`; explicit active state; and created/updated timestamps.

Database and service guards reject self-parent and cycles. Hierarchy output is deterministic by `unit_key`.

`unit_key` is intentionally not an HCIS database ID. Existing HCIS organization UUIDs may be retained only as source references in `organizational_unit_source_mappings` for migration traceability.

`organizational_unit_foundation_state` is seeded as `PRE_CUTOVER`. `CUTOVER_ACCEPTED` exists only as a future state value; this PR contains no action that promotes the state.

## 3. Platform API proposal

Read: `GET /admin/organizational-units`, `GET /admin/organizational-units/hierarchy`.

Mutations: `POST /admin/organizational-units`, `PATCH /admin/organizational-units/:id`, `POST /admin/organizational-units/:id/status`.

Import preparation: `POST /admin/organizational-units/import/inspect`, `POST /admin/organizational-units/import/preview`, `POST /admin/organizational-units/import/apply`.

All endpoints require an authenticated current Platform Administrator and inherit fresh-session enforcement. Mutations additionally require trusted same-Origin requests, server-derived actor, required reason, and fail-closed validation. Status mutation and import apply require explicit `confirm: true`.

## 4. Mutation invariants

- unit key is accepted only on create and immutable afterward;
- duplicate key is rejected by database uniqueness;
- parent must exist;
- self-parent is rejected in service and database;
- cycles are rejected before mutation and by a database trigger;
- activation/deactivation is explicit and audited;
- repository mutations and audit share the same SQL transaction;
- no mutation assigns HCIS/domain permissions.

## 5. HCIS migration preparation

Current HCIS organization models are evidence/reference, not a schema to copy wholesale. HCIS contains richer organization/authority/effective-dating concepts; those domain behaviors remain HCIS-owned unless separately accepted into SQ Hub scope.

### Phase 1 — inspect/source snapshot

`import/inspect` accepts only a sanitized source contract: `sourceRef`, optional `sourceCode`, `name`, nullable `parentSourceRef`, `active`. Unknown HCIS payload fields are rejected. Inspection checks duplicate source refs, missing parents, self-parent, and cycles, with no database write.

### Phase 2 — preview explicit mapping

Every source row requires explicit `sourceRef -> unitKey` mapping. A source UUID/reference is not promoted to SQ Hub `unit_key` automatically.

Preview validates duplicate/missing mappings, duplicate unit keys, unknown mapping source rows, existing source-mapping conflicts, and hierarchy validity. It returns a deterministic SHA-256 fingerprint, create/update/unchanged counts, issues, and `implicitDeletions: 0`. Preview writes nothing.

### Phase 3 — validate conflicts/hierarchy

Validation must be clean before apply. Existing SQ Hub units may be explicitly mapped to a source reference by choosing their stable `unit_key`; this is a reviewed mapping, not database-ID coupling.

### Phase 4 — explicit pre-cutover apply

`import/apply` requires Platform Administrator, trusted Origin, reason, and explicit confirmation. It upserts only reviewed rows and records source mappings plus an import run. Repeating the same source-system + fingerprint is idempotent and returns `noop` with prior sanitized summary.

### Phase 5 — sanitized evidence

`organizational_unit_import_runs` records source system, fingerprint, row count, sanitized counts, actor, reason, and timestamp. It does not persist arbitrary HCIS employee/authority payloads.

## 6. Non-destructive rule

An import snapshot is never interpreted as a complete destructive synchronization set. Units absent from the snapshot are not deleted or implicitly deactivated. This proposal has no delete endpoint. Retirement remains an explicit activate/deactivate mutation with audit.

## 7. Admin Center proposal

`/admin/organization` extends existing Administrasi SQ visual language and clearly displays `PRE-CUTOVER FOUNDATION`. It provides current unit list/state, create unit with stable key/optional parent, explicit activate/deactivate, and sanitized HCIS mapping/import preview.

The UI does not claim HR organization ownership has moved from HCIS. Import apply is intentionally not exposed as a casual browser button in this first proposal; the protected API exists for controlled staging acceptance tooling once the import contract is accepted.

## 8. Audit

Create, update, activate/deactivate, and import apply write `platform_audit_events`. Audit payloads contain operational reason, stable metadata/counts, and import fingerprint; they do not copy HCIS employee-sensitive data.

## 9. Open decisions before acceptance/cutover

1. Exact cutover authority/evidence required to move from `PRE_CUTOVER` to ownership accepted.
2. Whether SQ Hub OU v1 needs effective dating/versioned structure, or that remains HCIS-domain-only initially.
3. Canonical unit-key naming/governance and who may approve migration-quality correction before external use.
4. HCIS connector/export contract and authentication for obtaining the sanitized source snapshot; this PR accepts snapshot data but creates no live cross-domain connector.
5. Whether HCIS later consumes SQ Hub OU via read API, event/outbox, or another owned contract.
6. Reconciliation policy for richer HCIS structures (positions, incumbencies, authority bindings, rollout settings).
7. Cutover rollback window and source-of-truth conflict policy.

Until accepted, this implementation remains a proposal and must not be deployed as ownership cutover.

## 10. Explicit exclusions

No universal Person Registry, guardian identity, applicant unification, public self-registration, SQ Portal, multi-persona account, HCIS authority resolver migration, direct HCIS DB write, or shared `@sq/ui` extraction is introduced.
