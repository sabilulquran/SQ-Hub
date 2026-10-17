# ADR-0010: External Keycloak Realm for Families (`sq-keluarga`)

**Status:** ACCEPTED (Product Owner, 2026-10-17)
**Date:** 2026-10-17
**Related:** ADR-0002, ADR-0003, ADR-0008; Keluarga SQ `sq-keluarga/docs/product/module-design.md` (KEL-001); SPMB SQ `sq-spmb/docs/product/module-design.md` (SPMB-001, revision 4)

## Context
SPMB (student admissions) is the second external journey in SQ Core, after Recruitment (ADR-0008). In discovery on 2026-10-17 the Product Owner decided:

- Parents sign in with the **family card number (nomor Kartu Keluarga, KK)**. There is **one account per KK**. Children on the KK are recorded once and reused for every application. They also become admissions prospects for later years.
- The account is not only for SPMB. It is the family's account for **Keluarga SQ**, a family portal at `keluarga.sabilulquran.or.id`. Keluarga SQ will later carry billing (Keuangan), learning progress (Sekolah), and announcements.
- The whole parent admissions journey runs on `spmb.sabilulquran.or.id` with the same account and the same family shell. A parent who is signed in on one host must not have to sign in again on the other.
- Staff who are also parents may activate family access from their **staff Akun SQ**, after an explicit confirmation. Their biodata comes from HCIS.
- Data is kept indefinitely and bound to the family account.

ADR-0008 left open whether later external journeys such as SPMB applicants or guardians reuse the candidate realm `sq-karir` or get their own.

Families differ from candidates:

- The login identifier is a household document number, not a personal one.
- The account lives for many years, from a child's admission until the youngest child leaves.
- It will hold financial and minors' data across several domains.
- Some holders are staff.
- Recruitment's blacklist, retention, and "Karir" branding do not fit families.

## Decision
- Families authenticate through a **dedicated external realm `sq-keluarga`** in the existing Keycloak instance. `sq-staff` and `sq-karir` are unchanged. Sign-in pages are at `login.sabilulquran.or.id/realms/sq-keluarga`.
- **Identifier and credentials:** the user signs in with **nomor KK (16 digits) + kata sandi**. Each KK maps to exactly one Keycloak user.
- **KK stays out of Keycloak, following the NIK pattern in ADR-0008 / REC-IMPL-001:**
  - The Keycloak username is a random opaque ID. Keycloak stores only `kk_hmac` (HMAC-SHA256 with a pepper), never the KK.
  - Sign-in, registration, and reset look users up by `kk_hmac`.
  - KK never appears in tokens, URLs, Keycloak events, or error messages.
  - Token mappers for username, email, and phone are not issued to family clients.
- **Registration:** self-registration with KK, holder name, a WhatsApp number verified by one-time code, and a kata sandi. Email is optional, for recovery.
- **More than one parent:** an account may hold **more than one verified WhatsApp number**, for example father and mother. Each number can receive sign-in recovery codes. Every successful code records which number was used, so the family portal can log which parent acted.
- **Reset:** reset sends a one-time code to a stored WhatsApp number (preferred) or email, shown masked.
- **Families migrated from the SPMB Google Form history:**
  - pre-created with `kk_hmac`, no kata sandi, and their old WhatsApp number as an unverified attribute;
  - registering with that KK is rejected as "already registered", and they use reset to create a kata sandi.
- **Anti-abuse:** registration, sign-in, and reset are rate-limited per IP, per KK, and per number, with Cloudflare Turnstile after repeated attempts. This is needed because "KK already registered" reveals that the family has dealt with the Yayasan.
- **Clients:**

  | Client | Host | Purpose |
  | --- | --- | --- |
  | `spmb-keluarga` | `spmb.sabilulquran.or.id` | Parent admissions journey |
  | `keluarga-web` | `keluarga.sabilulquran.or.id` | Family portal |

  - Both use the server-side Authorization Code + PKCE pattern with host-only HttpOnly sessions.
  - The shared Keycloak SSO session on `login.sabilulquran.or.id` gives the "sign in once" behaviour; the second app gets a silent redirect.
  - SPMB staff screens remain a separate client in `sq-staff` under SQ Hub Application Access.
- **Staff who are parents use identity brokering, not cross-realm tokens:**
  - `sq-keluarga` has `sq-staff` configured as an OIDC identity provider ("Masuk dengan Akun SQ"). The staff user authenticates in `sq-staff`, and Keycloak issues an `sq-keluarga` token to the family client.
  - The ADR-0008 rule that a client never accepts tokens from another realm still holds.
  - On first broker login, Keycloak creates a family-realm user linked to the staff identity, with no KK. Keluarga SQ then runs the activation step: confirmation, HCIS biodata, nomor KK, and, if that KK already has an account, a code sent to that account's WhatsApp number.
  - Keluarga SQ maps both the KK user and the brokered staff user to the same family record. Mapping is by `issuer + sub` and is held in the application, not by merging Keycloak users. This allows two staff parents on one KK.
  - When the staff identity is disabled (offboarding), brokered sign-in stops. The family keeps signing in with KK + kata sandi.
  - A staff Akun SQ never gains family access without the explicit activation step. Family access never grants anything in `sq-staff`.
- **Ownership:**
  - **Keluarga SQ** owns the family account record, family data, children, consents, and the principal mapping. Keycloak holds only credentials and the sign-in identity.
  - SPMB reads family data through Keluarga SQ's contract. It owns applications, selection, and the registration fee.
  - Children never get Keycloak identities in this realm.
- **WhatsApp codes:**
  - The Keycloak provider calls a loopback, HMAC-signed relay owned by Keluarga SQ.
  - The relay sends through **Kirim SQ** (`docs/product/kirim-sq-module-design.md`) with `jenis: "kode"`, on the device set in Keluarga SQ configuration (default `resmi`). It never calls JalurPesan directly. *(Amended 2026-10-17, Product Owner: Kirim SQ replaces the earlier plan to send through JalurPesan on the official SPMB number, so account codes keep working if the busy SPMB number is limited by WhatsApp. See KEL-IMPL-001 §16.)*
  - Email codes use the realm SMTP.
- **Provider:** the in-house provider planned for `sq-karir` in REC-IMPL-001 is built as **one external-identity provider configured per realm**:
  - identifier type (NIK for `sq-karir`, KK for `sq-keluarga`);
  - pepper;
  - relay URL;
  - texts.

  It is not written as two copies.
- **SQ Hub surfaces do not apply** to family-realm identities: Application Access, launcher, Admin Center, Directory, and Ringkasan Yayasan. The single exception is a launcher entry, **Keluarga · Daftarkan anak**, shown to active staff. It opens the brokered sign-in and grants nothing by itself.
- **Theme:** the same Akun SQ theme as staff, without staff-only actions. The title follows the client: **"SPMB"** when the sign-in starts from `spmb-keluarga`, **"Keluarga"** from `keluarga-web`.
- **Retention:** accounts are retained indefinitely. A family may ask for deletion; the Admin Keluarga SQ handles it and the outcome is recorded. Keluarga SQ decides whether an active child relationship blocks deletion.
- **MFA:** not offered to families in the first release.

## Alternatives considered
- **Reuse `sq-karir` for families.** It would add one less realm, but it would mix job candidates with parents under one identifier rule. NIK and KK would both have to be optional and unique in one realm, and "Karir" branding and blacklist rules would apply to families. Rejected.
- **Put families in `sq-staff`.** This breaks ADR-0002/0008: self-registered accounts would sit next to HCIS-verified staff and weaken staff policies. Rejected.
- **One Keycloak user per parent (NIK login) and a family group in the app.** This gives cleaner per-person audit. The Product Owner chose KK login and one account per KK. Per-parent logins may be reconsidered in Keluarga SQ K1 if separated parents need them. Deferred.
- **Family clients accept `sq-staff` tokens directly.** No brokering is needed, but it breaks the ADR-0008 cross-realm rule. Staff access to the family portal would then fall under Hub Application Access, forcing a grant for every employee. Rejected.
- **Link the staff identity to the KK user inside Keycloak (federated identity link).** This keeps one Keycloak user. Keycloak allows one link per identity provider per user, so two staff parents on one KK cannot both link, and re-linking needs Keycloak admin operations. Rejected in favour of application-level principal mapping.

## Product Owner decisions (2026-10-17)
- **Migrated history after a WhatsApp code:** a migrated family sees its historical children and applications right after a successful code sent to the WhatsApp number on record. A family that adds a number not on record sees nothing migrated until staff verify the KK document.
- **Code channel when WhatsApp delivery fails** (Kirim SQ unavailable, rejects the code, or the device is disconnected): fall back to email when the family has one. Otherwise show "Kode belum bisa dikirim, coba lagi beberapa menit lagi" with the SPMB loket phone number. No third-party SMS fallback without a separate decision.

No open questions remain.

## Release gates (not design questions)
- Mi8VPS memory headroom with a third realm, the provider, SPMB, and Keluarga SQ running (at least 700 MiB MemAvailable, as in ADR-0008).
- Owner approval for each production step: realm, provider configuration, identity-provider link to `sq-staff`, clients, and migration import.
- The DNS owner adds `keluarga.sabilulquran.or.id` and `spmb.sabilulquran.or.id`. The zone is in the Yayasan's own Cloudflare account.

## Consequences
- Keycloak operations grow to three realms, with their own configuration, theme variants, backup, and export.
- REC-IMPL-001's provider becomes shared work. Karir SQ and SPMB/Keluarga SQ must agree on its configuration surface before either ships.
- Keluarga SQ becomes the owner of the family account record even when SPMB ships first. If Keluarga SQ K0 is late, SPMB hosts the account and family-data screens temporarily and calls Keluarga SQ's API. The data never lives in SPMB.
- Staff-parent brokering adds a dependency on `sq-staff` availability for those users only. KK sign-in remains available to them.
- Future family-facing domains (Keuangan, Sekolah) become clients of `sq-keluarga` and read family data from Keluarga SQ. They do not create their own parent accounts.
