# SQ Hub roadmap and decision register

**Status:** DISCOVERY / DRAFT — not an implementation specification

**Updated:** 2026-10-19

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
| Governance view — Ringkasan Yayasan | **Specification ACCEPTED** 2026-10-17 | Domain specs first (HCIS board-view role and summary endpoint, Aset SQ governance role), then Hub implementation. Production activation needs owner approval. |
| Kirim SQ — shared WhatsApp sending path | **DISCOVERY** — KIRIM-001 design merged; ADR-0011 **ACCEPTED** (Product Owner, 2026-10-17) | Kirim SQ is an SQ Hub shared capability: the `kirim` module in `apps/api`, no new process on Mi8, no Baileys in SQ Core. The engine is replaceable per device (`log` default, `jalurpesan` for the trial with 2 numbers `hcis` and `spmb`, later its own JalurPesan instance or Meta Cloud API). Consumer apps never call JalurPesan directly; they use their own `WhatsAppSender` port with `log` + `kirim` adapters. Inbox and reply are built once in Kirim SQ and opened from a WhatsApp menu in each module; conversations are kept indefinitely; `kirim_admin` is the Kepala HCM. Admin at `kirim.sabilulquran.or.id` through Application Access. KIRIM-IMPL-001 (R1) ACCEPTED by the PO on 2026-10-17; R1 implemented in the repository (module `kirim`, admin screens Nomor and Antrean, `KIRIM_ENABLED=false` by default); next: owner-approved production steps (KIRIM-IMPL-001 §15). This replaces the earlier plan for a Baileys gateway module inside SQ Core. |
| Rapat SQ — meetings, minutes, and decision register | **DISCOVERY** — RAPAT-001 design drafted 2026-10-19 (revision 1); no ADR, no specification, no implementation | Owner decisions of 2026-10-19: the module is built, transcription is **Whisper only** (no paid speech-to-text), and no paid Google subscription is bought for it. Three findings shaped this: the foundation is on consumer Google AI Plus/Pro, not Workspace, so Meet transcripts are unavailable; Meet's built-in transcripts do not support Indonesian, so buying Workspace would not help either; and the Meet Media API is still Developer Preview. Google Meet is therefore demoted to a plain video-call tool whose link is pasted in by hand — no Meet or Calendar API integration at all, which makes the module simpler than first drafted. Transcription is a replaceable source (manual typing, Whisper on the minute-taker's laptop, later Whisper on an 8 GB server) following the Kirim SQ engine pattern; joining bots stay rejected. Staged as R1 framework (agenda, attendance, ratified minutes, decision register — no AI, no audio, no privacy decision needed), R2 laptop transcripts, R3 server transcription. Still open: the summarizing language model is a **separate** decision from the Whisper decision and is deliberately unresolved — unlike Whisper, which matches the market's best at 1.5B parameters, an open-weight 9B summarizer is not frontier-class, so choosing free has a real quality cost here. Candidates include Sahabat-AI (Indonesian, with Javanese and Sundanese, runnable under Ollama) against a paid API. Next: interview the Sekretariat for real meeting numbers, then run one test on a real recording that answers both questions at once — Whisper accuracy, and local versus API minute drafts — before R2 is built. R1 needs no language model at all, so it is not blocked. Google for Nonprofits is worth pursuing for organization accounts and service accounts, but this module must not depend on it. See `docs/product/rapat-sq-module-design.md`. |
| SQ Account / SQ Portal — external identities and journeys | **DISCOVERY** — Recruitment (ADR-0008 ACCEPTED); families for SPMB and Keluarga SQ (ADR-0010 ACCEPTED, 2026-10-17) | Implementation specs next (shared external-identity provider with REC-IMPL-001, SPMB-IMPL-001, KEL-IMPL-001); each production step needs owner approval. No external identity implementation is approved by this roadmap. |

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

## Governance view

On 2026-10-17 the Product Owner noted that members of the Yayasan organs
(Pembina, Pengurus, Pengawas) have no landing page of their own: the only
governance page is HCIS `/board`, while Aset SQ, Karir SQ, Keuangan, and SPMB
also need oversight. The Product Owner asked for a design of a Hub landing page
for them.

The design is ADR-0009 and HUB-IMPL-021, both ACCEPTED on 2026-10-17: Hub shows one
summary card per application, each application owns its figures, governance
role, and privacy rules, and Hub fetches summaries as the user through token
exchange. Hub stores no domain data.

Product Owner decisions of 2026-10-17:

| Topic | Decision |
| --- | --- |
| Membership authority | SQ Admin records organ membership and terms in Admin Center. |
| Accounts | Organ members are added manually. Salaried Pengurus may already be staff; both cases are designed in HUB-IMPL-021. |
| Landing | Every member lands on Ringkasan Yayasan, including members who are also staff. |
| Pengawas | Same summaries as Pembina and Pengurus. |
| Token exchange | Approved in principle; applying it on Mi8VPS needs owner approval at rollout. |
| Salaried Pengurus | HCIS Employees when paid through HCIS payroll; they keep their staff Akun SQ. |
| Two-step verification | Required for every organ member. |
| HCIS board access | HCIS adds a board-view role for `EMPLOYEE` accounts; `FOUNDATION_BOARD` stays for members who are not staff. |
| End of term | For a member who is not staff, the same action revokes access and disables the Akun SQ. |
| Later employment | A member who becomes an Employee keeps the same Akun SQ. |

No open questions remain. The Product Owner accepted ADR-0009 and HUB-IMPL-021 on 2026-10-17.

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
- `docs/architecture/adr/0011-kirim-sq-shared-whatsapp-capability.md` — Kirim SQ
  as a shared WhatsApp capability with a replaceable engine (ACCEPTED).
- `docs/product/kirim-sq-module-design.md` — KIRIM-001 module design.
- `docs/product/rapat-sq-module-design.md` — RAPAT-001 module design
  (DRAFT/DISCOVERY; owner decisions in §2, open questions in §11).
- `docs/product/foundation-prd.md` — Directory operational TBDs and Foundation
  boundaries.
