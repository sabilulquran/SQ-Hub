# AI-Assisted Development Workflow

**Status:** ACCEPTED

## Goal
SQ Hub dikembangkan secara AI-assisted dengan source of truth, task boundary, verification, dan review yang mencegah invented requirements dan low-quality generated code.

## Workflow
```text
Product/domain specification
        -> architecture/security/design/operations references
        -> implementation
        -> local verification
        -> pull request
        -> adversarial AI review
        -> human review
        -> CI/final verification
        -> merge
```

Review dapat dimulai sebelum PR dibuka, tetapi merge decision harus berdasarkan diff PR dan evidence verification terbaru.

## Task contract
Setiap implementation task minimum menyebutkan:
- repository dan branch;
- specification ID;
- expected outcome;
- explicit non-goals;
- relevant docs;
- required verification.

Agent tidak boleh redesign requirement saat diminta implementasi.

## Context loading
1. Baca `AGENTS.md`.
2. Baca specification task.
3. Baca hanya referenced/relevant ADR, domain, security, design, atau operations docs.
4. Inspeksi code/tests yang berkaitan.
5. Jangan preload seluruh documentation tree.

## Implementation rules
- Prefer minimal implementation yang memenuhi spec.
- Jangan menambah fitur "sekalian".
- Jangan menambah abstraction/dependency tanpa kebutuhan konkret.
- Business rule tidak boleh hanya hidup di UI.
- Authorization harus ditegakkan server-side.
- Jangan membuat fallback diam-diam yang menyembunyikan data/configuration error.
- Gunakan synthetic data saja.

## Verification
Environment-dependent claim seperti build/test/migration berhasil hanya boleh dibuat setelah benar-benar dijalankan di environment yang sesuai.

Ketika tooling tersedia, verification minimum meliputi:
- typecheck;
- lint;
- unit/integration tests;
- build;
- migration validation bila ada;
- browser/E2E smoke test untuk perubahan UI/flow penting.

## Adversarial AI review
Reviewer harus mencari alasan perubahan belum layak merge, terutama:
- invented requirement;
- over-engineering atau abstraction prematur;
- duplicate source of truth;
- unnecessary dependency;
- authorization hanya di client;
- data ownership violation;
- destructive migration;
- retry/duplicate side effect;
- sensitive-data leakage;
- silent fallback;
- UI pattern yang menyimpang dari design system;
- test yang sekadar mengafirmasi implementasi tanpa memverifikasi behavior.

Builder dan reviewer idealnya diperlakukan sebagai peran terpisah. Reviewer menilai specification dan diff, bukan hanya penjelasan builder.

## Human approval required
- product scope changes;
- security policy;
- identity provider selection/cutover;
- role/application-access policy changes;
- cross-domain ownership changes;
- production migration/cutover;
- destructive data operation;
- production deployment.

## Skills and MCP
Skills dapat dibuat setelah workflow stabil untuk mengenkode proses berulang; Skill bukan source of truth requirement.

MCP/connectors dapat digunakan untuk memberi agent akses terkontrol ke repo, docs, dev/staging systems, tests, dan logs. MCP tidak menggantikan specification. Production write access harus dibatasi dan tidak diberikan secara default.
