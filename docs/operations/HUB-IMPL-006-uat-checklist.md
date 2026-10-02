> **RETIRED / ARCHIVED — DO NOT DEPLOY — DO NOT RECREATE.** Staging references and staging commands in this document are historical evidence. The production VPS is production-only by owner decision of 2 October 2026. See the permanent-retirement runbook; historical staging instructions do not authorize deployment.

# HUB-IMPL-006 staging visual UAT checklist

**Scope:** visual-only follow-up for SQ Hub branding parity with the accepted HCIS baseline.

## Required checks

- Desktop sidebar shows the YSQ mark directly at the same visual scale/proportion as HCIS.
- The mark is not wrapped in a decorative white rounded tile.
- Product copy remains `SQ Hub`.
- Organization copy remains `Yayasan Sabilul Qur'an`.
- Header/mobile lockup remains readable at approximately 390x844.
- Account trigger remains usable.
- Bottom navigation remains usable with no horizontal overflow.
- HCIS launcher remains visible for the synthetic UAT identity with active Application Access.
- Authentication/session behavior is unchanged.
- Production is untouched.

This checklist requires no revoke/restore, logout, Keycloak mutation, database mutation, or infrastructure change.
