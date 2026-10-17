# ADR-0009: Ringkasan Yayasan — Governance View in SQ Hub

**Status:** ACCEPTED by the Product Owner on 2026-10-17
**Date:** 2026-10-17
**Specification:** HUB-IMPL-021 (ACCEPTED)

## Context
The Yayasan organs (Pembina, Pengurus, Pengawas) need read-only oversight across SQ Core. Today only HCIS has it: the `FOUNDATION_BOARD` principal and the `/board` aggregate dashboard (HCIS ORG-003). Aset SQ has no governance role, and Karir SQ, Keuangan, and SPMB are coming.

A member of an organ who signs in with Akun SQ lands in the ordinary Hub launcher. The only governance page they can reach is inside HCIS. That makes HCIS look like the Yayasan's home, although it covers only workforce. The Product Owner asked on 2026-10-17 for a landing page that belongs to the organs and spans every module.

ADR-0001 keeps business logic and data in each domain application. ADR-0007 keeps workforce organization in HCIS. SQ Hub must not become a reporting warehouse or evaluate domain permissions.

## Decision
- SQ Hub gets a governance landing page, **Ringkasan Yayasan**, for identities with an active **Organ Yayasan membership**.
- **Hub shows, domain apps own the numbers.** Each domain app that takes part publishes one read-only **governance summary** endpoint in a shared contract (HUB-IMPL-021). Hub fetches the summaries for the signed-in user at request time and renders one card per app. Hub does not store, combine, or compute domain figures.
- Each domain app decides on its own whether the caller may see its summary, using its own governance role (for example HCIS `FOUNDATION_BOARD`). A Hub membership never grants a domain permission. If the app refuses, its card is not shown.
- A summary carries figures, short monthly trends, and chart data in a small fixed set of chart kinds. Hub draws every chart in one visual style; applications send data only, never colours, images, or markup. Trend history is computed by the owning application from its own records; Hub never keeps past summaries.
- Summaries are aggregate only. They carry no names, identifiers, contact details, documents, or per-person rows. Each app keeps its own privacy rules, as HCIS does for `/board`.
- Every card links to a detail page in the owning app. Drill-down, reports, and any action (such as Yayasan approval of a staffing request in Karir SQ) happen in that app, never in Hub.
- Hub calls the domain endpoint **as the user**: it exchanges the user's Hub session token for a short-lived token whose audience is the target app, using Keycloak standard token exchange. The domain app validates that token and maps `issuer + sub` to its local principal as it does at login. Hub does not use its own service identity to vouch for a user.
- **Organ Yayasan membership** is a new Hub-owned record: identity, organ (Pembina, Pengurus, Pengawas), term start/end, status. It is managed in SQ Admin Center with the existing fresh-session, reason, and audit safeguards. It only controls the Hub landing page and which summaries Hub requests. It is separate from Platform Administrator membership and from HCIS organization positions.
- The registry marks which applications publish a governance summary and where. An application is asked only if it is active, publishes a summary, and the user has active Application Access to it.

## Alternatives considered
- **Board dashboard only inside each app (status quo).** Keeps boundaries simple, but there is no shared landing page, and each new module adds another place to look. Rejected by the Product Owner.
- **Hub copies domain data into its own reporting store.** Gives one fast dashboard but makes Hub a second owner of HCIS, Aset, and Keuangan data, duplicates privacy rules, and breaks ADR-0001. Rejected.
- **Hub calls domains with its service identity and names the user.** Simpler than token exchange, but every domain would trust Hub's claim about who the user is. One compromised Hub credential could then read every domain's governance data. Rejected.
- **The browser calls each domain directly.** Domain sessions are host-only cookies, and browser tokens are not allowed. The user would need a live session in every app. Rejected.
- **Embedded widgets (iframes) from each app.** Needs a login inside each frame and `frame-ancestors` exceptions on Akun SQ. Rejected.
- **A separate governance application.** This may be right later if the organs need their own workflows, such as resolutions or decrees. For read-only oversight, the Hub landing page is enough. Deferred.

## Product Owner decisions (2026-10-17)
All given in a project conversation on 2026-10-17.

- **Authority:** SQ Admin (Platform Administrator) records organ membership and terms in Admin Center. No separate governance administrator group.
- **Accounts:** organ members are added manually by SQ Admin. Some Pengurus are salaried, so a member may or may not already be staff. Both cases are designed in HUB-IMPL-021 section 1.
- **Landing:** every member with an effective membership lands on Ringkasan Yayasan, including members who are also staff. Beranda stays one click away.
- **Pengawas:** sees the same summaries as Pembina and Pengurus. Hub does not vary summaries by organ.
- **Token exchange:** approved in principle. Engineering prepares the Keycloak configuration; applying it on Mi8VPS still needs the owner's approval at rollout.
- **Salaried Pengurus:** recorded as Employees in HCIS when their pay goes through HCIS payroll. They keep their staff Akun SQ and follow HUB-IMPL-013.
- **Two-step verification:** required for every organ member, as for privileged staff, because they see organization-wide figures.
- **HCIS board access for an Employee:** HCIS adds a board-view permission that can be given to an `EMPLOYEE` account as a role. `FOUNDATION_BOARD` stays for members who are not staff. This needs an HCIS spec change.
- **End of term, member who is not staff:** the same Admin Center action revokes their Application Access and disables their Akun SQ, with a preview and reason.
- **Member who later becomes an Employee:** keeps the same Akun SQ. HCIS maps that identity to the new Employee account; HUB-IMPL-013 does not create a second one.

No open questions remain.

## Consequences
- Hub gains one new outbound dependency per participating app. A slow or failing app degrades only its own card.
- Charts with trends need history in each application. An application that cannot produce history yet publishes figures only, and its section has no chart.
- Each participating app must add a governance role, the summary endpoint, and bearer-token validation for that endpoint. HCIS can reuse its ORG-003 aggregates. Aset SQ needs a new governance role first.
- New modules (Keuangan, SPMB) can join by publishing the summary contract, with no Hub release beyond a registry update.
- Organ membership and domain governance roles are granted in two places. Admin Center should show both so an operator can see a mismatch, but it must not sync them automatically.
- If the organs later need actions or documents of their own, that is a new domain application, not an extension of Hub.
