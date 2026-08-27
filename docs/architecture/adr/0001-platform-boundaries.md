# ADR-0001: SQ Hub Platform Boundaries

**Status:** ACCEPTED
**Date:** 2026-08-27

## Context
Sabilul Qur'an akan memiliki beberapa aplikasi seperti HCIS, SPMB, Finance, Workspace, dan Academic. Dibutuhkan integrasi dan pengalaman bersama tanpa membuat satu ERP monolith.

## Decision
SQ Hub menjadi shared digital platform foundation. SQ Hub hanya memiliki capability lintas aplikasi yang benar-benar shared, termasuk identity integration, Organizational Unit master, Application Registry/Access, Hub Launcher, dan design-system foundation.

Business logic domain tetap dimiliki aplikasi masing-masing.

Aplikasi domain boleh berada pada repo, deployment, dan lifecycle maintenance yang berbeda.

## Consequences
- HCIS dan SPMB tidak menjadi module business di repo SQ Hub.
- Satu aplikasi dapat maintenance/deploy tanpa mewajibkan aplikasi lain berhenti.
- Integrasi lintas domain membutuhkan contract yang eksplisit.
- Shared capability baru harus membuktikan kebutuhan lintas aplikasi; reuse hipotetis bukan alasan yang cukup.
