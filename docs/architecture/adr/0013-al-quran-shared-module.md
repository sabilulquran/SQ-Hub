# ADR-0013: Al-Qur'an as an SQ Hub Shared Module

**Status:** ACCEPTED by the Product Owner on 2026-11-13 (decisions in `docs/product/quran-module-design.md` §2). Items marked `DRAFT` are agent defaults awaiting confirmation.
**Date:** 2026-11-13
**Specification:** QURAN-001 (`docs/product/quran-module-design.md`). Implementation needs its own `QURAN-IMPL-001`.
**Related:** ADR-0001, ADR-0003, ADR-0007, ADR-0008, ADR-0010, ADR-0011; HCIS REWARD-001 (`docs/domain/rewards.md` in the HCIS repository)

## Context

On 2026-11-13 the Product Owner asked for a Qur'an reader that staff open from HCIS on the web, that stays available when HCIS gets a mobile app, and that families can also open. The Product Owner then decided:

1. The module is called **"Al-Qur'an"**, without an "SQ" suffix.
2. It follows the **Kirim SQ pattern**: its own module, opened from HCIS and from Keluarga SQ, not part of either.
3. The reading screen is the **Mushaf Madinah page**: 604 pages, 15 lines, laid out exactly as the printed copy.
4. Reading is counted by **tapping an ayah and choosing "Tandai terakhir baca"**. Automatic page counting and a manual entry exist only for when someone forgot to mark.
5. Bookmarks can cover **one ayah or a run of ayahs**.
6. Groups are **not created by users**. They are premade: the **whole foundation** and **each unit**.
7. The scoreboard is **visible to everyone**, per person, filtered by the whole foundation or by a unit, for **weekly, monthly, and all-time** periods.
8. Reading is **not** used in performance evaluation. It feeds an **award** (penghargaan), and the award is based **only on the scoreboard**.

The need spans applications: HCIS (staff entry point and the award), Keluarga SQ (family reading), and later the HCIS and Keluarga mobile apps. ADR-0001 admits a shared capability when the need is real across applications, and here two existing applications are named consumers.

Mi8VPS still has about 1 GiB of free memory, which is why ADR-0011 and the Kerja SQ design put their modules inside SQ Hub rather than in a new process.

## Decision

- **Location: the `quran` module in SQ Hub** (API and web). No new process on Mi8.
  - Tables use the `quran_` prefix; routes are `/api/quran/*` for browsers and apps, `/internal/quran/*` for consumer applications.
  - Address **`quran.sabilulquran.or.id`**, with the same edge pattern as `kirim` and `kerja`: `/api/*` to the Hub API with the prefix stripped, everything else to the Hub web, `/internal/*` answered 404 at the edge.
  - Module code imports no other SQ Hub module except auth, Application Access, and the Organization Directory read model, so it can be extracted later.
- **Responsibility boundary.**
  - The Al-Qur'an module owns the Qur'an content and its verified copy, the mushaf screen, last-read marks, reading records, bookmarks, the premade groups' scoreboards, and their audit.
  - HCIS owns the award: who is a candidate, who decides, what is announced, and the employee's award history (REWARD-001). HCIS reads the scoreboard; it never writes reading records.
  - Organization Directory (ADR-0007) supplies people, units, and each person's current primary unit. Groups are derived from it at read time; the module keeps no copy of the organization.
  - Keluarga SQ owns family accounts and family data (ADR-0010). The Al-Qur'an module stores only the reading data of a family identity.
- **Content is verbatim and sourced.** Arabic text, page layout, fonts, and translation come from their original publishers, not from any third-party app. Each source's licence terms are recorded and met (attribution, no modification, notice kept). The bundled copy is checked by automated tests (ayah counts, page boundaries, checksums). The HafalanKu app inspected on 2026-11-13 is reference only; none of its data or code is reused.
- **Two realms, two clients, one module.** Staff sign in through `sq-staff` and need Application Access `al-quran`. Families sign in through `sq-keluarga` with a separate client, in line with ADR-0008 (a client never accepts tokens from another realm) and ADR-0010 (future family-facing domains become `sq-keluarga` clients). Records are keyed by `issuer + sub`. A person who has both a staff and a family identity has two separate records (DRAFT: no merge without a separate ADR).
- **Only staff appear on scoreboards.** Family identities read, mark, and bookmark, but belong to no group and are never ranked. Scoreboard routes reject family tokens. Application Access does not apply to `sq-keluarga`; a family identity is admitted by an active Keluarga SQ account.
- **Mobile apps use the same API.** A future HCIS or Keluarga mobile app calls `/api/quran/*` with a token of its own realm and may cache the content package for offline reading. No second copy of the content or the rules is built in a mobile app.
- **Consumer contract for HCIS:** a read-only scoreboard endpoint under `/internal/quran/v1/*`, authenticated with an `sq-staff` client-credentials token for audience `sq-hub-quran` and scope `quran.scoreboard.read`, returning one snapshot per final month with Organization Directory person and unit ids (`hcis:employee:<uuid>`, `hcis:org-node:<stable_key>`) and the Directory version used, never names or identity subjects. Every consumer read is audited.

## Alternatives considered

- **Inside HCIS.** Simplest for staff, but families would need staff accounts or a second copy, and the Kirim pattern was asked for. Rejected by the Product Owner on 2026-11-13.
- **Its own application and process.** Clean separation, but costs about 80–120 MiB of RSS on Mi8. Rejected for now for the same reason as ADR-0011; the module boundary keeps extraction possible.
- **Scanned page images** (the approach in the inspected app). Faithful, but each page is a picture: heavy to serve, ayah tapping needs a separate box map, and image rights are unclear. Rejected in favour of per-page fonts with the published 15-line layout.
- **Reflowed Uthmani text with page boundaries only.** Light, but line breaks would not match the printed copy, which breaks visual memorisation. Rejected.
- **User-created groups with invite codes.** Rejected by the Product Owner on 2026-11-13; groups are premade.

## Release gates (not design questions)

- Licence terms of every bundled resource confirmed and recorded before QURAN-IMPL-001 is accepted (QURAN-001 §5.2).
- Memory: measure Hub API RSS before and after, as for Kirim SQ (93 → 122 MiB) and Kerja SQ.
- Disk: about 40 MB of content and fonts per edition; reading records are small (estimated well under 50 MB a year at 200 staff).
- The DNS owner adds `quran.sabilulquran.or.id`; the zone is in the foundation's own Cloudflare account.
- Production steps follow the owner's release rules of 2026-10-27.
- The family client in `sq-keluarga` is a separate production step (R4).

## Consequences

- SQ Hub gains a module that every staff member opens, so it is the first Hub module whose daily users are the whole workforce rather than an admin group. The memory gate is measured, not assumed.
- Application Access `al-quran` must be granted to every active staff member. Access stays explicit, as the Hub register requires: an admin grants it in bulk once, and granting it to new staff is an explicit onboarding step, never an automatic consequence of a Directory change (DRAFT).
- HCIS gains a new capability, REWARD-001, whose first and only criterion in R1 is this scoreboard.
- Showing every person's reading to every colleague is a deliberate Product Owner choice. The design limits what is shown (pages, active days, khatam; no reading times) and keeps it out of performance evaluation.
- This ADR does not authorize implementation or production changes.
