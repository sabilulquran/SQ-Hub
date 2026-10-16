# ADR-0008: External Keycloak Realm for Recruitment Candidates

**Status:** PROPOSED
**Date:** 2026-10-16

## Context
Recruitment is the first external journey for SQ Core. The Product Owner decided on 2026-10-16 that Recruitment is its own SQ Core application, outside HCIS, and that candidates sign in with Akun SQ in a separate external realm (see `docs/product/roadmap-and-decision-register.md`).

ADR-0002 and ADR-0003 cover staff identity only. Candidates differ from staff: anyone may register, they are not in the HCIS employee master, there are many more of them, most never become staff, and their data has different retention needs. Putting them in the staff realm would mix self-registered accounts with HCIS-verified identities and weaken the staff realm's policies.

## Decision
- Candidates authenticate through a dedicated external realm in the existing Keycloak instance. The staff realm is unchanged.
- Candidates sign in with **NIK and kata sandi** (Product Owner decision, 2026-10-16). NIK is unique in the external realm. ADR-0002's rule that NIK is never a login username still applies to the staff realm.
- The external realm allows self-registration with NIK, full name, a WhatsApp number verified by one-time code, and a kata sandi. Email is optional, for recovery. Staff realm self-registration stays disabled.
- Password reset sends a one-time code to the stored WhatsApp number (preferred) or email, both shown masked. The WhatsApp code step is a Keycloak authenticator in the external realm only; codes and credentials stay in Keycloak, never in Karir SQ.
- Applicants migrated from SIRE are pre-created with their NIK as login identifier and no kata sandi, carrying their old WhatsApp number and email as unverified attributes. If they try to register, the NIK is rejected as already registered and they are sent to sign in, where they use password reset to create a kata sandi. They never fill a new registration form.
- Because NIK is a national identity number, it must not appear in OIDC tokens (`preferred_username`), URLs, Keycloak event logs, or error messages; login events record no username or only a hash. Register, sign-in, and reset are rate-limited per IP and per NIK, with an anti-bot challenge after repeated attempts, since "NIK already registered" reveals that the person applied.
- The Karir SQ candidate portal is an OIDC client of the external realm. Recruitment staff screens (HC reviewers, interviewers) are an OIDC client of the staff realm and follow normal SQ Hub Application Access.
- Candidates on the recruitment blacklist are disabled in the external realm and cannot sign in; the sign-in page shows a neutral message only. Karir SQ owns the blacklist and asks Keycloak to disable or re-enable the account.
- Recruitment owns candidate profiles, applications, and selection data. Keycloak holds only the candidate's credentials and sign-in identity.
- SQ Hub Application Access, the launcher, Admin Center, and Organization Directory do not apply to external-realm identities.
- Tokens from one realm are never accepted by a client of the other realm.
- A hired candidate does not become a staff identity by moving or linking their external account. HCIS creates the Employee through its own contract, and staff identity provisioning then follows HUB-IMPL-013. The external account may be disabled or retained per the retention policy.

## Open questions (must be resolved before ACCEPTED)
- Which WhatsApp authenticator to use (maintained extension or in-house) and how it reaches the WhatsApp adapter.
- How Keycloak keeps NIK out of `preferred_username` and event logs: a generated opaque username plus a custom authenticator that looks the user up by NIK attribute, or a supported event/token mapper configuration.
- Anti-abuse for self-registration: rate limits, CAPTCHA, email-domain rules.
- Whether candidate MFA is offered or required.
- Retention and deletion of rejected or inactive candidate accounts.
- Branding: same Akun SQ theme as staff, or a candidate variant.
- Hostname for the external realm's login pages.
- Mi8VPS capacity: one more realm in the same Keycloak adds little memory, but registration traffic during an open recruitment period must be measured.

## Consequences
- Staff realm security and lifecycle stay as accepted; no candidate can appear in staff Admin Center or Directory views.
- A second realm adds configuration, theme, backup, and export work to the existing Keycloak operations.
- About 2,800 historical SIRE applications (Oct 2021 – Sep 2026) will be merged into candidate accounts, so the realm starts with existing users and needs an import procedure, not only self-registration.
- Recruitment must define its own candidate-to-hire hand-off to HCIS; there is no automatic identity promotion.
- Later external journeys (for example SPMB applicants or guardians) may reuse this realm or need their own; that choice is deferred to their own discovery.
