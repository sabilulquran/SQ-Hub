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

## Supersession note — 2026-09-18

ADR-0007 supersedes **only** the part of this ADR that names `Organizational Unit master` as an SQ Hub-owned capability.

The current boundary is:

- workforce organization authoring/system of authority -> HCIS;
- shared Organization Directory projection/distribution -> SQ Hub;
- approval/workflow policy -> each domain application.

All other platform-boundary decisions in ADR-0001 remain in force. The original decision text above is intentionally retained as architectural history.
