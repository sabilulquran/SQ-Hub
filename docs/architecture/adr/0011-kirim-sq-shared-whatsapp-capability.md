# ADR-0011: Kirim SQ as an SQ Hub Shared WhatsApp Capability

**Status:** PROPOSED (awaiting Product Owner acceptance)
**Date:** 2026-10-17
**Related:** ADR-0001, ADR-0006, ADR-0010; `docs/product/kirim-sq-module-design.md` (KIRIM-001, revision 1); SPMB SQ `sq-spmb/docs/product/module-design.md` (SPMB-001 §6.8, §8); JalurPesan `jalurpesan.web.id/README.md`

## Context
Several SQ Core applications need to send WhatsApp messages, and one needs to receive them. On 2026-10-17 the Product Owner decided:

- The module is named **Kirim SQ**.
- Kirim SQ is a **shell owned by the Yayasan**: data, rules, and history. The actual sending is done by a replaceable **engine**. For now the engine is **JalurPesan**, the Baileys multi-device gateway already running on Mi8 at `127.0.0.1:3401`.
- SQ Core **does not install Baileys** now. Mi8 has about 1 GiB MemAvailable, so a second Baileys process is not worth it.
- The trial uses **2 numbers**: `resmi` (official Yayasan notifications) and `spmb` (official SPMB number, two-way).
- **Business logic stays in the consumer applications.** Kirim SQ manages devices and the sending path, not message content or business flow.

ADR-0001 allows SQ Hub to own only capabilities that are truly shared across applications, and says hypothetical reuse is not enough. The cross-application need is real:

| Consumer | Need | Source |
| --- | --- | --- |
| Keluarga SQ | Verification and recovery codes for family accounts | ADR-0010 |
| SPMB | Status notifications, reminders, registration links; inbound WhatsApp becomes a Peminat (lead); later a shared inbox | SPMB-001 §6.8, §8 |
| HCIS | Staff notifications (payslip, leave, attendance), invitations | Planned |
| Karir SQ | Test and interview invitations, application status | Planned |
| Keuangan | Bills and receipts (official PDF) | Planned |

Media and Sosial (announcements, programme information, donors) are further planned consumers.

Without a shared capability, each application would integrate with JalurPesan on its own. Every engine change would then touch every application, and device health, rate limits, opt-outs, and audit would be duplicated or missing.

The roadmap previously recorded a future SQ Core WhatsApp gateway module that would run Baileys itself. This ADR replaces that direction with a shell plus a swappable engine.

## Decision
- **Kirim SQ is an SQ Hub shared capability.** It is justified under ADR-0001 by the consumers listed above, at least two of which (Keluarga SQ and SPMB) are already designed against it.
- **Location: the `kirim` module in `apps/api`.** There is no new process on Mi8.
  - The send worker runs inside the SQ Hub API process. Estimated extra memory is under 20 MiB.
  - Tables use the `kirim_` prefix in the SQ Hub database. Routes live under `/internal/kirim/*` (consumer API) and `/api/admin/kirim/*` (admin).
  - Module code imports no other SQ Hub module except auth and Application Access, so it can be extracted into its own application later.
- **Responsibility boundary:**
  - Kirim SQ owns devices (registration, pairing, connection status, purpose), the queue, retry, per-number rate limits, safe sending hours, idempotency, status tracking, inbound forwarding to the module that owns the number, the do-not-contact list, audit, and per-consumer quotas.
  - Consumer applications decide **when** and **to whom** to send, compose their own content, templates, and PDFs, store delivery status in their own data, and process inbound messages (for example SPMB creating a Peminat).
  - Kirim SQ does not build per-domain templates, CRM or contact data, unrelated mass broadcast, or full conversation storage. A shared inbox is later work and needs its own privacy decision.
- **The engine is replaceable.** One internal provider contract (`sendText`, `sendDocument`, `deviceStatus`, `startPairing`, `pullEvents`) with adapters:

  | Provider | Use |
  | --- | --- |
  | `log` | **Default.** Development, staging, and before a number is ready. Sends nothing; marks the message sent with a `dry_run` flag. |
  | `jalurpesan` | Trial and early production. One JalurPesan platform `sq-core`; each Kirim SQ device is one JalurPesan tenant. |
  | `jalurpesan` (own instance) | When SQ Core moves to its own server. Same adapter, different URL and keys. |
  | `meta-cloud` | If the Yayasan adopts the official WhatsApp Business Platform. |

  The provider is selected **per device in configuration**, not in code, so an engine change needs no release. Moving a number to another engine requires re-pairing it; history in `kirim_outbox` is kept.
- **No Baileys inside SQ Core.** Neither SQ Hub nor any consumer application installs or runs Baileys. WhatsApp sessions live only in the engine.
- **Consumers never call JalurPesan directly.** Each consumer application sends through its own port (for example `WhatsAppSender`) with two adapters:
  - `log` (default), so consumer development does not wait for Kirim SQ;
  - `kirim`, an HTTP client for the KIRIM-001 §5 contract.

  A direct JalurPesan adapter is allowed only as an emergency path with Product Owner approval.
- **Consumer contract:** `POST /internal/kirim/messages` with an `Idempotency-Key`, authenticated with an `sq-staff` client-credentials token for audience `sq-hub-kirim`. Kirim SQ calls back the consumer's HMAC-signed webhook with `message.status`, `message.received`, and `device.status`. The consumer API is loopback-only and blocked at the edge.
- **Access goes through Application Access.** The admin screens are at `kirim.sabilulquran.or.id`, served by the existing SQ Hub web and API processes through host routing at the edge. Kirim SQ is registered in SQ Hub Application Access as the application "Kirim SQ", and its Launcher tile shows only to staff who have access. Roles are `kirim_admin` (IT team) and the optional `kirim_operator` (a department officer, limited to their own application's numbers and queue). Admin screens show metadata and masked numbers only, never message content.

## Alternatives considered
- **Kirim SQ as its own application.** It would release independently, and ADR-0001 would allow it. It costs one more Node process on Mi8 (about 80–120 MiB RSS). Rejected for now because of Mi8 memory; the module boundary keeps extraction possible.
- **A Baileys gateway inside SQ Core.** This is the earlier roadmap direction. It would run a second Baileys process next to JalurPesan on a host with about 1 GiB MemAvailable. Rejected by the Product Owner on 2026-10-17; it can return as another provider when SQ Core has its own server.
- **Each application integrates with JalurPesan directly.** No shared module is needed, but engine changes, device health, rate limits, opt-outs, and audit would be repeated in every application, and a blocked number could not be isolated by purpose. Rejected.

## Release gates (not design questions)
- Mi8 memory: measure JalurPesan RSS and MemAvailable before pairing and for 7 days. Stop adding numbers and plan an engine move if the 7-day average MemAvailable is below 900 MiB or JalurPesan RSS keeps rising.
- Owner approval for each production step: devices and pairing, provider configuration, consumer registration, and the `kirim.sabilulquran.or.id` route.
- The DNS owner adds `kirim.sabilulquran.or.id` when the admin screens are built. The zone is in the Yayasan's own Cloudflare account.
- Open product questions in KIRIM-001 §13 (message retention, `kirim_admin` holders, the number used for `resmi`, build order with SPMB R0, safe sending hours) are settled before the implementation specification is accepted.

## Consequences
- SQ Hub gains a runtime dependency path for messaging: when SQ Hub is releasing or down, consumers keep the request on their side and retry with the same idempotency key. No domain request depends synchronously on SQ Hub, in line with the target architecture.
- Kirim SQ ships with SQ Hub releases until it is extracted.
- The load moves to JalurPesan (estimated 30–80 MiB per number, not yet measured). JalurPesan session backup is not yet consistent; if Mi8 fails, numbers are re-paired.
- SPMB-IMPL-001 replaces its direct JalurPesan adapter with `log` + `kirim`. Inbound messages to the SPMB number arrive through Kirim SQ's `message.received` webhook.
- Keluarga SQ's code relay (ADR-0010, KEL-IMPL-001) sends through Kirim SQ with `jenis: "kode"`. This is the "SQ Core WhatsApp gateway" that ADR-0010 refers to; the Keycloak provider does not change.
- Separating numbers by purpose (`resmi` and `spmb`) means a blocked conversational number does not stop payroll or billing notifications. Messages are not rerouted automatically to another number.
- A Kirim SQ implementation specification is still needed. This ADR does not authorize implementation or production changes.
