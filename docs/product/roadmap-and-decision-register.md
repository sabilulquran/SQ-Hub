# SQ Hub roadmap and decision register

**Status:** DISCOVERY / DRAFT — not an implementation specification

**Updated:** 2026-10-16

This document reconciles the phase roadmap with accepted repository decisions and
records the product-owner decisions given for the proposed Staff Lifecycle
phase. It does not authorize feature implementation, deployment, or changes to
production systems. Accepted product, domain, ADR, and specification documents
remain authoritative if this register conflicts with them.

## Roadmap status

| Phase | Current status | Next work |
| --- | --- | --- |
| Foundation — Akun SQ and SQ Hub basics | **CLOSED** | None for the accepted baseline. Akun SQ is the native Hub account experience under HUB-IMPL-019; the earlier Account Console label is historical. |
| Identity Lifecycle — staff enter, change, and leave | **Specification ACCEPTED; delivery in progress** | Complete HCIS producer/Hub consumer review, least-privilege Keycloak production proof, and controlled synthetic production UAT before release. |
| Organization Directory — HCIS organization projection | **CLOSED for v1; production accepted** | Operate the accepted sync/read path. SLA deployment and history retention remain operational TBDs; they do not reopen v1 acceptance. |
| Application Platform — onboard more SQ applications | **Foundation exists; expansion is demand-led** | Scope one real consumer at a time. Do not build generic integrations without an identified application and owner. |
| SQ Core WhatsApp gateway — official numbers per domain | **DISCOVERY / future** (Product Owner, 2026-10-17) | SQ Core will get its own WhatsApp gateway module (Baileys) instead of relying on third-party gateways. Each domain has its own official number: Rekrutmen, Keuangan, SPMB, Sosial (charity). Until the module exists, apps send through JalurPesan with one device per official number; StarSender is not used. Apps call a `WhatsAppSender` port so the switch needs no domain logic change. |
| SQ Account / SQ Portal — external identities and journeys | **DISCOVERY** — first journey named: Recruitment (2026-10-16) | Resolve the remaining discovery questions below and accept ADR-0008 before any external identity implementation. No external identity implementation is approved by this roadmap. |

## Identity Lifecycle decisions

These product decisions were supplied by the Product Owner in this project
conversation and incorporated into accepted HUB-IMPL-013. They are not evidence of production UAT.

| Topic | Decision |
| --- | --- |
| Staff eligibility | Verify that the employee exists in HCIS before provisioning an Akun SQ identity. Use an HCIS-owned contract; Hub must not query HCIS tables directly. |
| Staff changes | HCIS remains authority for employment and organization facts. Directory distributes accepted organization facts; a unit/position/status change does not silently grant or revoke Hub Application Access or change domain roles. Access changes stay explicit in SQ Hub and domain permissions stay with each domain app. |
| Operator | An authorized SQ Admin may perform the lifecycle action without a second administrator's approval. Preserve the existing fresh-session, reason, same-origin, and audit safeguards in the accepted Admin Center boundary. |
| Offboarding | Revoke all active SQ Hub Application Access grants, revoke active Platform Administrator membership, and disable the global Akun SQ identity. This does not mutate HCIS employee state or domain permissions. |
| Re-enable | An SQ Admin may re-enable the global identity. Record actor, reason, and outcome. |
| Partial failure | Report each step and its result; keep the operation in partial-failure state; allow safe retry of failed steps. The authorized Admin performs the retry. If unresolved, escalate to the Head of HCM, who owns coordination and closure. Do not call the operation complete until all required steps are verified. |
| Initial password | Send Keycloak's `VERIFY_EMAIL` and `UPDATE_PASSWORD` action email so mailbox ownership is established before first password use. Set the link lifetime explicitly to 12 hours. A send failure leaves the identity with required actions pending and offers a safe retry; Hub never creates or reveals a password. |
| Emergency ownership | Head of HCM owns lifecycle escalation. Technical changes are carried out by an authorized operator through the approved interface/runbook and are audited. |

The proposal's existing safeguard against an administrator offboarding their
own active identity is retained. The exact least-privilege Keycloak policy for
the dedicated identity-management service principal remains an engineering and
security acceptance gate before any live integration; it is not delegated to a
broad administrator credential.

### Remaining release gates for HUB-IMPL-013

1. Review and deploy HCIS-ID-001 producer plus the Hub consumer under a controlled production change.
2. Prove the dedicated service identity's fine-grained Keycloak permissions using allowed and forbidden API probes.
3. Rehearse partial-failure recovery and Head of HCM escalation with isolated synthetic cases.
4. Complete controlled production UAT and quality gates before declaring release acceptance.

These gates are technical contract and security work; they do not change the
product decisions above.

## Organization Directory

HUB-IMPL-018 v1 is accepted and production runtime/consumer evidence is recorded
in `docs/operations/HUB-IMPL-018-production-acceptance-2026-09-25.md`. HCIS
remains the workforce organization authority; SQ Hub is the projection and
distribution layer. Do not create an Organizational Unit master in Hub or
switch HCIS ownership based on historical HUB-IMPL-014 proposal branches.

The v1 contract already defines a five-minute reconciliation cadence and a
15-minute stale boundary. Availability SLO and synchronization-attempt/history
retention remain TBD in the source documents. They should be decided with the
service owner when an operational SLO or audit-retention requirement is needed;
they are not prerequisites for the accepted Identity Lifecycle scope.

## Application Platform

The shared baseline already includes application registry, Application Access,
OIDC/SSO, launcher, Admin Center, and the accepted Organization Directory read
contract. There is no global implementation task for “all apps.” For each
future consumer, scope only the named app's owner, identity/access contract,
logout/session behavior, Directory data needs, and production acceptance.

## SQ Account / SQ Portal

External identities and personal journeys remain outside Foundation v1. Defer
Portal product and architecture decisions until a first external journey,
domain owner, and data source are named. At that discovery gate, use the
existing `ecosystem-experience-model.md` as exploration material and resolve,
at minimum:

- initial audience/journey and product/domain name;
- staff versus external identity boundary and realm/migration strategy;
- self-registration, verified identifiers, recovery, anti-abuse, and MFA;
- account linking and duplicate-person resolution;
- personas and relationships, including child/guardian consent and privacy;
- who may approve an external-to-staff transition;
- external authorization and API/data ownership per domain;
- platform-admin scope/break-glass and any migration of legacy HCIS admin roles.

Until that discovery is accepted, these questions are not implementation
requirements and must not be answered by code defaults.

### Recruitment decisions (2026-10-16)

These product decisions were supplied by the Product Owner in a project
conversation. They name the first external journey; they do not approve
implementation or any production change.

| Topic | Decision |
| --- | --- |
| Initial journey | Recruitment: candidates apply and follow their selection process. |
| Application placement | Recruitment is its own SQ Core application, outside HCIS. HCIS stays the authority for employment; a hired candidate becomes an Employee only through an HCIS-owned contract. This supersedes the HCIS capability-map placement of REC-001 as an HCIS workspace. |
| Identity boundary | Candidates use Akun SQ in a separate external Keycloak realm, not the staff realm. See ADR-0008 (PROPOSED). |
| Product name | Karir SQ. The app lockup reads "Karir" above the gold Sabilul Qur'an wordmark. |
| Staffing requests | A staffing request is approved by the unit head, then by the Yayasan, before a vacancy opens. |
| SIRE migration | Applicants and their data move from the SIRE spreadsheet. Existing applicants sign in without creating a new account. |
| Candidate sign-in | Candidates sign in with NIK and kata sandi. A former applicant who tries to register is told the NIK is already registered, signs in, and creates a kata sandi through password reset with a WhatsApp or email code. NIK stays out of tokens, URLs and logs. |

Decisions of 2026-10-17: the domain owner is the Head of HCM; candidate data is
retained without automatic deletion; the career portal is
`karir.sabilulquran.or.id`; candidate sign-in uses the same Akun SQ theme as
staff. Product details (screening questions, multiple applications, scoring)
live in the Karir SQ module design (sabilulquran/karir-sq).

Still open for the Recruitment discovery: anti-abuse, recovery, MFA for
candidates, and who approves the candidate-to-staff transition.

## Decision sources

- `docs/operations/project-status-2026-09-23.md` — Foundation closure.
- `docs/operations/HUB-IMPL-018-production-acceptance-2026-09-25.md` — Directory
  runtime and production acceptance.
- `docs/specs/HUB-IMPL-019-native-akun-sq-experience.md` — native Akun SQ
  account boundary.
- `docs/product/admin-center-foundation.md` — platform administration and Go 5C
  boundary.
- `docs/architecture/adr/0007-hcis-authored-organization-directory.md` — HCIS
  ownership of workforce organization.
- `docs/product/foundation-prd.md` — Directory operational TBDs and Foundation
  boundaries.
