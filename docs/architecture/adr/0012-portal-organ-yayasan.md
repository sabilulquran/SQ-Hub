# ADR-0012: Portal Organ Yayasan at organ.sabilulquran.or.id

**Status:** ACCEPTED by the Product Owner on 2026-11-12 (decisions 1–8 of 2026-11-03, go-ahead 2026-11-12). Items marked `DRAFT` are agent defaults awaiting confirmation.
**Date:** 2026-11-12
**Supersedes:** ADR-0009 for the organs' entry point. ADR-0009's contract rules (domains own the numbers, per-user token exchange, aggregate-only summaries) stay in force.
**Specification:** ORGAN-IMPL-001 (`docs/specs/ORGAN-IMPL-001-portal-organ.md`)
**Related:** ADR-0001, ADR-0003, ADR-0009, HUB-IMPL-021, HUB-IMPL-023; HCIS ORG-003, ORG-010, ORG-013 (`docs/domain/organ-account-approver.md`), GOV-001 (`docs/product/organ-portal-concept.md`)

## Context

ADR-0009 gave the organs (Pembina, Pengurus, Pengawas; about 6–7 people, changing each term) a Ringkasan Yayasan page inside SQ Hub. On 2026-11-03 the Product Owner decided that the organs should not use the staff launcher at all:

1. They get their own application at **`organ.sabilulquran.or.id`**.
2. They do not reach the modules directly; they see reports and decide what falls to them.
3. A salaried Pengurus, who is an HCIS Employee, still uses HCIS self-service for their own leave and payslip.
4. **The approval screen is in the portal; the approval engine stays in the owning application** (HCIS, Karir SQ).
5. Organ accounts may be approvers (HCIS ORG-013, implemented and released 2026-11-03).
6. No new approval rules: the flows that already reach organ positions are used (HCIS LEAVE-003-N Director leave; Karir SQ REC-IMPL-006 MPP final approval when the Director seat is vacant).
7. Reports are visual and come with an analysis written by the Claude API.
8. A monthly report is generated automatically once each module's data for the month is submitted or approved.

Constraints: Mi8VPS has about 1 GiB of free memory, so a new long-running process is costly (ADR-0011 made the same call). Membership of the organs, Application Access, the governance registry, and token exchange already exist in SQ Hub (HUB-IMPL-021).

## Decision

### D1 Hostname, client, and session of its own
- The portal is served at `organ.sabilulquran.or.id` with its own Keycloak OIDC client (`sq-organ`, staff realm), its own host-only session cookie, and its own web bundle. TOTP stays mandatory (HUB-IMPL-021).
- Only an identity with an **effective Organ Yayasan membership** may sign in. Anyone else gets a plain refusal page with a link to SQ Hub.
- Hub's `/yayasan` becomes a redirect to the portal once the portal is live. Members who are also staff keep Hub for their staff work.

### D2 Runs inside the SQ Hub API process (`DRAFT`, recommended)
The portal's backend is a separate route group in the existing SQ Hub API, selected by host, with its own web bundle in this repository (`apps/organ-web`). Reasons:
- no new process on Mi8VPS;
- it reuses the membership records, the registry fields, the token-exchange client, and the governance-summary validation that HUB-IMPL-021 already built and proved;
- membership administration stays in SQ Admin Center, where the Platform Administrator already works.

The route group never serves the staff launcher, and the staff host never serves portal routes. A later split into its own process is a deployment change, not a contract change.

### D3 Domains own numbers, decisions, and rules
ADR-0001 and ADR-0009 hold. The portal:
- fetches each application's governance summary **as the user** (token exchange) and renders it;
- lists the user's pending approval steps from each owning application and forwards the user's decision to that application as the user;
- never evaluates a domain permission, never computes a domain figure, and never stores live domain data.

### D4 Decisions go through a separate, write-scoped exchanged token
Deciding is a mutation, so it does not reuse the read token of the summary:
- a separate audience per application for decisions (for HCIS `hcis-organ-decision`), separate from `GOVERNANCE_SUMMARY_AUDIENCE`;
- `azp` must be the portal client `sq-organ`, never `sq-hub`;
- the token must carry proof of TOTP (`acr`) from the current session;
- the domain keeps its own checks: step ownership, capability, self-approval by person, audit.

This is the "token exchange on the decision route" that HCIS ORG-013-3 left `TBD`. It needs an ORG-010 amendment in HCIS and Keycloak configuration on Mi8VPS. Until both exist, the portal links to HCIS `/board` for decisions (cookie session, already live).

### D5 Monthly reports are composed from immutable monthly snapshots
- Each application decides when its month is **closed** and then publishes an immutable **monthly governance snapshot** (aggregate only, the summary contract plus `period` and `revision`).
- HCIS's close marker is the payroll period of that month reaching `APPROVED`, exposed only as "month final" with no period id or amount (`DRAFT`, GOV-001). The other applications define theirs in their own specs.
- The portal stores the composed monthly report: the snapshots it received, their revisions, and the analysis text. **This is the one narrow exception to ADR-0009's "Hub never keeps past summaries"**: the stored values are aggregates that the owning application already published as final, the owner of each figure stays the application, and a reopened month arrives as a new revision rather than an edit.
- A section whose application has not closed the month reads "Belum final", never a provisional figure.

### D6 Analysis by the Claude API, from aggregates only
- Input: only the aggregate values already shown on the page, the period, and the metric labels. No names, identifiers, per-person rows, approval contents, or free text written by users. The approval queue goes in only as counts and ages.
- Output: 3–5 bullets in Indonesian, each citing the metric keys it rests on. The portal rejects a bullet whose cited keys are not in the input and drops the whole analysis when nothing valid is left.
- Model: `claude-opus-5-5` with structured output and server-side refusal fallback. The model id, the input hash, and the time are stored with the text. Text is labelled "Dibuat AI" and is never regenerated silently.
- The API key lives in the Hub server environment only; it never reaches the browser.

### D7 Collective decisions are out of scope
Every organ decision in the portal is individual. Meetings, circulars, and quorum need their own specification first.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Keep Ringkasan Yayasan inside SQ Hub (ADR-0009 as is) | Rejected by the Product Owner on 2026-11-03: the organs should not land in the staff launcher. |
| A separate repository and process | A second process on a 1 GiB device, and a second copy of membership, registry, and token exchange. Possible later without contract changes (D2). |
| Approve inside the portal with its own rules | Breaks ADR-0001 and owner decision 6; two places would decide who approves. |
| Reuse the summary read token for decisions | One leaked read token could approve; no proof of TOTP; rejected by the ORG-013 review. |
| Portal keeps a reporting store of live data | Breaks ADR-0009; only published final monthly snapshots are kept (D5). |
| No AI analysis, or AI over raw data | The owner asked for analysis; raw data would cross the privacy boundary the dashboards keep. |

## Consequences

- SQ Hub gains a second public host and OIDC client. The Cloudflare record lives in the Yayasan's Cloudflare account, which only the owner can change.
- HCIS needs an ORG-010 amendment for the decision audience (D4) and a monthly snapshot endpoint (D5). Karir SQ, SPMB, and Aset SQ each need a governance summary and, for monthly reports, a close marker.
- The Anthropic API becomes an external processor of aggregate figures. No personal data is sent.
- Rollback is a redirect back to Hub `/yayasan` and HCIS `/board`; nothing in the domains depends on the portal.

## Rollout

1. ORGAN-IMPL-001 R1: host, client, sign-in gate, dashboard from existing summaries, approval inbox with links to the owning applications.
2. HCIS ORG-010 amendment and the decision audience; then deciding inside the portal (R2).
3. Monthly snapshots and reports with the Claude analysis (R3), HCIS first.
4. Karir SQ, Aset SQ, SPMB summaries and close markers as each one ships.

Every production step follows the SQ Core release rules (dry run, backup before migrations, candidate gate, automatic rollback on failed verification, never at 19 UTC).
