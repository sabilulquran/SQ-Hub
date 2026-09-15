# Organizational Unit Migration / Cutover Proposal

**Status:** DRAFT / PROPOSED — PRE-CUTOVER ONLY  
**Related:** HUB-IMPL-014, Foundation PRD, HCIS organization architecture evidence

## Purpose

Define the migration boundary without declaring that Organizational Unit ownership has already moved from HCIS to SQ Hub.

## Current evidence

HCIS has both an earlier current-state organization mapping and a richer dynamic organization structure implementation. The richer model includes organizational nodes plus positions, incumbencies, authority bindings, reporting overrides, rollout modes, and workflow-resolution semantics. Those concepts prove that HCIS organization data is not merely a flat unit table.

SQ Hub HUB-IMPL-014 deliberately proposes only the shared Organizational Unit master: stable unit identity, name, parent, and active state. It does not absorb HCIS authority/workflow semantics.

## Identity mapping rule

Cross-system identity is an SQ Hub `unit_key`, not an HCIS row ID/UUID. Migration tooling requires an explicit reviewed mapping:

```text
HCIS sourceRef (evidence only) -> SQ Hub unitKey (stable integration identity)
```

An HCIS UUID may be retained as `source_ref` for traceability. It must not become the SQ Hub unit key automatically.

## Proposed rehearsal sequence

1. Obtain a sanitized HCIS unit/node snapshot through a future HCIS-owned contract.
2. Inspect the snapshot without writes.
3. Produce explicit `sourceRef -> unitKey` mappings.
4. Preview creates/updates/conflicts/hierarchy and verify `implicitDeletions = 0`.
5. Apply only to an approved SQ Hub staging/pre-cutover dataset through explicit protected invocation.
6. Re-run the same fingerprint and prove idempotent `noop`.
7. Produce sanitized counts/fingerprint evidence.
8. Compare HCIS consumer requirements and define the post-cutover read/integration contract.
9. Obtain separate cutover approval before changing system-of-record behavior anywhere.

## Cutover is not part of HUB-IMPL-014

HUB-IMPL-014 does not switch HCIS reads to SQ Hub, write HCIS tables, turn on dual-write, deactivate/delete HCIS units, migrate positions/incumbencies/authority bindings, alter HCIS approval routing, or promote foundation state to `CUTOVER_ACCEPTED`.

Those are separate reviewed operations with rollback and reconciliation requirements.
