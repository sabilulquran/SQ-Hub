# ADR-0014: SQ Suite Is the Ecosystem — Terms, Portals, and Application Faces

**Status:** ACCEPTED by the Product Owner on 2026-11-16 (decisions made in chat that day). Items marked `DRAFT` are agent defaults awaiting confirmation.
**Date:** 2026-11-16
**Living map:** [`docs/product/struktur-sq-suite.md`](../../product/struktur-sq-suite.md) (STRUKTUR-001). That document is the single source for the list of applications, their portals, and their status.
**Amends:** ADR-0001 (placement rule, D6 below). **Related:** ADR-0002, ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0012, ADR-0013.

## Context

The Product Owner's original picture was an ecosystem like Google's: one umbrella name, one account, and applications that sit side by side under it. By November 2026 the documents no longer described that picture consistently:

- "SQ Core" was used everywhere as the name of the whole, but no document defined it, and three documents listed different members.
- "SQ Hub" meant the platform in ADR-0001, the launcher page at `hub.sabilulquran.or.id`, and sometimes the whole. "Hub" also reads as one place, like a portal of its own.
- "Modul" meant both a part of HCIS (Cuti, Payroll) and a whole product such as Kirim SQ or Kerja SQ.
- "Portal" was used for the family portal, the careers portal, and the Portal Organ without a definition.
- ADR-0001 says business logic does not live in SQ Hub, yet Kerja SQ, Sekretariat SQ, Rapat SQ, and Al-Qur'an are designed as modules inside the Hub process.
- Status documents (README, target architecture, roadmap, the specification index) had drifted from production.

The Product Owner asked for the structure to be put in order thoroughly before any other work continues.

## Decision

### D1 One umbrella name: SQ Suite
The whole ecosystem of Yayasan Sabilul Qur'an applications is called **SQ Suite**: a set of separate applications designed to be used together, with one account, one look, and one place to manage access. The term **"SQ Core" is retired**. It stays only in technical names that users never see (D7) and in historical records (D8).

**SQ Hub keeps one meaning:** the landing page and launcher at `hub.sabilulquran.or.id`, where a person sees the applications they may open. In technical documents "the SQ Hub platform" also names the shared services in the `SQ-Hub` repository (D5). SQ Hub is never the name of the whole.

### D2 Four terms, one meaning each

| Term | Meaning | Example |
| --- | --- | --- |
| **SQ Suite** | The whole ecosystem | — |
| **Portal** | The entry point for one group of users, with that group's account type | Portal Pegawai, Portal Organ |
| **Aplikasi** (application) | A system that looks after one domain and owns its data and rules | HCIS, Aset SQ, Karir SQ |
| **Modul** (module) | A part inside one application | Cuti and Payroll inside HCIS |

HCIS, Aset SQ, Kirim SQ, Kerja SQ and the rest are **applications**, never "modules", whatever process they run in.

### D3 Portals
There is one portal per group of users:

| Portal | Users | Account |
| --- | --- | --- |
| **Portal Admin** | Administrators of accounts, access, and roles | Staff account with an admin role |
| **Portal Pegawai** | Staff | Staff account (realm `sq-staff`) |
| **Portal Organ** | Pembina, Pengurus, Pengawas | Organ membership on a staff-realm account |
| **Portal Keluarga** | Parents and guardians | Family account (realm `sq-keluarga`) |
| **Portal Pelamar** | Job applicants | Applicant account (recruitment realm) |
| **Situs publik** | Anyone | No sign-in |

Portal Admin stands on its own because it governs access to every other portal. "Keluarga SQ" and "Portal Organ" are the portals themselves, not applications inside them.

### D4 An application has up to four faces

| Face | For whom | Shown in |
| --- | --- | --- |
| **Kelola** | Staff authorised to operate the application | Portal Pegawai |
| **Layanan mandiri** | The person the data is about (staff member, family, applicant) | That person's portal |
| **Laporan** | The foundation's organs: summaries and the decisions that are theirs to make | Portal Organ |
| **Publik** | Anyone, without sign-in | Situs publik |

Rules:
1. Every application that holds foundation data must provide a **Laporan** face (the governance summary contract of ADR-0009/ADR-0012). Organ members never operate an application.
2. The **Kelola** face is only for staff who were given that authority. Other staff do not see the application unless it has a Layanan mandiri face for them.
3. The data stays in one place. Faces are ways of showing it; they never copy it into another owner.

The application × portal matrix is kept in STRUKTUR-001.

### D5 What makes it one ecosystem
The applications stay separate programs behind the scenes, as Google's are. What unites them is shared, and belongs to the SQ Hub platform (the `SQ-Hub` repository):

- **Akun SQ** — one account per person per portal, and one place to manage one's own credentials;
- **Admin SQ** — one console for accounts, Application Access, and (target) roles;
- **SQ Hub** — the landing page and launcher that lists the applications a person may open;
- **the shared top bar** — the SQ mark, the application's name, the launcher, and the account menu on every application (target; a separate piece of work);
- the Organization Directory, the Application Registry, Kirim SQ as the shared WhatsApp capability, and the design system.

### D6 Where an application runs (amends ADR-0001)
Where the code runs is a technical property recorded per application in STRUKTUR-001. It is not a product category and it does not change what the application is called.

- **Default: its own program and database**, as ADR-0001 says. This always applies to applications that hold sensitive personal data, payroll, finance, or student records.
- **It may run inside the SQ Hub process** when one of these holds:
  1. it is a capability other applications call (Kirim SQ, ADR-0011);
  2. it only shows data owned by others and has no domain data or rules of its own (Portal Organ, ADR-0012);
  3. it is a small application whose data is not sensitive, and the server's memory is the constraint. This is a **compromise**, recorded as such, and the application moves to its own program when memory allows or its data grows more sensitive (Kerja SQ, Sekretariat SQ, Rapat SQ, Al-Qur'an).
- Hosting inside the Hub process never changes ownership: the application still owns its tables (own prefix), its rules, and its release flag, and other applications reach it only through a contract.

### D7 Technical names stay
Repository names (`sq-core-ops`), script and file names on the server (`sq-core-launch.sh`), database names (`sqcore_*`), Keycloak client IDs, and specification IDs keep their current names. Renaming them is risky and no user sees them.

### D8 Reading older documents
Accepted ADRs, specifications, release records, and runbooks are history and are not rewritten. When reading them:

| Older wording | Means now |
| --- | --- |
| "SQ Core" | SQ Suite (the ecosystem) |
| "SQ Hub" as a platform or application | Unchanged: the SQ Hub platform (landing page and launcher, Akun SQ, Admin SQ, the directory and registry) |
| "modul SQ Hub", "shared module" | An application that runs inside the Hub process (D6) |
| "Ringkasan Yayasan" (ADR-0009) | The Laporan face; its entry point for organ members is Portal Organ (ADR-0012) |
| "Workspace (future)" | Kerja SQ |
| "Finance", "Academic", "Asset" | Keuangan, Sekolah, Aset SQ |

Living documents (README, AGENTS, vision, glossary, ownership table, roadmap, the specification index, and text shown to users) use the new terms.

### D9 Names
Applications follow the pattern **"<Nama> SQ"**. Exceptions kept by decision: **HCIS**, **Portal Organ**, and **Al-Qur'an** (ADR-0013). `DRAFT`: HCIS and Portal Organ keep their names rather than becoming "SDM SQ" or "Organ SQ".

## Consequences

- One document (STRUKTUR-001) answers "what exists, for whom, and in what state". Other documents link to it instead of keeping their own lists.
- A new application is placed in the matrix (portals and faces) and given a placement under D6 before its design starts.
- ADR-0001's boundary stays: domain rules belong to the application. D6 only records when sharing a process is allowed, and names the existing compromises.
- The shared top bar and the single role console are targets, not yet built. Until then the launcher inside each application and each application's own role page remain.
- Systems outside SQ Suite that are still in use, or were retired, are listed in STRUKTUR-001 so nothing runs unrecorded.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Keep "SQ Core" for the whole | It was never defined, reads as technical, and each document gave it a different membership. |
| Call the whole "SQ Hub" (the first decision on 2026-11-16, replaced the same day) | "Hub" reads as one place, and the same name already means the launcher page; the confusion would return as "which SQ Hub?". |
| Other umbrella names considered: SQ Digital, SQ One, Semesta SQ, an acronym | Too technical, not descriptive enough, or not to the owner's taste. "Suite" says what it is: separate applications meant to be used as one set. |
| Move every application's code into the Hub process so "everything is in one place" | One fault or release would stop everything, payroll and admission data would share a database, and months of rewriting would change nothing a user sees. The unity users feel comes from D5. |
| Keep "modul" for applications hosted in the Hub process | It hides the fact that Kerja SQ or Sekretariat SQ are applications with their own data, and it clashes with modules inside HCIS. |
| Treat admin as a face inside Portal Pegawai | It governs access to all portals, including those staff never see. |
