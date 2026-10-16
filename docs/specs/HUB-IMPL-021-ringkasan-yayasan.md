# HUB-IMPL-021 — Ringkasan Yayasan

**Status:** DRAFT — not approved for implementation
**Product:** SQ Hub
**Area:** Governance view / cross-application summaries
**Date:** 2026-10-17
**Depends on:** ADR-0001, ADR-0003, ADR-0007, ADR-0009 (PROPOSED), HUB-IMPL-002, HUB-IMPL-005, HUB-IMPL-017, SQ Core app shell
**First named sources:** HCIS (ORG-003 `/board`), Aset SQ (governance role not yet specified), Karir SQ (staffing requests awaiting Yayasan approval)

## Outcome
A member of a Yayasan organ signs in with Akun SQ and lands on **Ringkasan Yayasan** in SQ Hub: one page with a summary card from every SQ Core application they oversee, each linking to that application's own detail page.

Hub only displays the summaries. Each application owns its numbers, its governance permission, and its privacy rules.

## Terms
| Term | Meaning |
| --- | --- |
| Organ Yayasan | Pembina, Pengurus, or Pengawas of Yayasan Sabilul Qur'an. |
| Organ Yayasan membership | Hub-owned record that an Akun SQ identity belongs to an organ for a term. Controls the Hub landing page only. |
| Governance summary | One small, aggregate, read-only response an application publishes in the contract below. |
| Governance role | The application's own permission that allows a principal to read its summary (for example HCIS `FOUNDATION_BOARD`). |

## Scope
In scope:

- Organ Yayasan membership: data, Admin Center management, audit;
- registry fields that declare an application's governance summary;
- the governance summary contract v1 that applications implement;
- Hub fetching summaries as the user through token exchange;
- the Ringkasan Yayasan page on desktop and phone.

Out of scope:

- any domain metric definition (each application specifies its own under its own spec ID);
- drill-down, reports, exports, or actions inside Hub;
- storing, caching across sessions, combining, or trending domain figures in Hub;
- granting domain governance roles from Hub, or syncing them with membership;
- notifications, e-mail digests, or scheduled reports;
- provisioning Akun SQ identities for members who are not Employees (open question in ADR-0009).

## 1. Organ Yayasan membership

### Data
```ts
interface OrganMembership {
  id: string;
  identityIssuer: string;
  identitySubject: string;
  organ: "pembina" | "pengurus" | "pengawas";
  positionLabel?: string;   // for example "Ketua Pengurus"; display only
  termStart: string;        // date
  termEnd?: string;         // date; open-ended if absent
  status: "active" | "ended";
  reason: string;           // required on every change
}
```

A membership is **effective** when `status = "active"`, `termStart <= today`, and `termEnd` is absent or after today. One identity has at most one effective membership.

### Management
- Managed in SQ Admin Center under a new section "Organ Yayasan".
- Only a Platform Administrator holding the new capability `governance.membership.manage` may grant, change, or end a membership. TBD: whether this capability belongs to a separate administrator group (ADR-0009 open question).
- Every change requires a fresh session, a reason, and a same-origin request, and writes a platform audit event (actor, target identity, organ, term, reason, outcome), like Application Access changes in HUB-IMPL-009.
- An administrator cannot grant or end their own membership.
- Offboarding under HUB-IMPL-013 ends any effective membership as an additional step.
- The membership detail page shows, read-only, which participating applications currently return a summary for that identity. This lets an operator see a missing domain role. It never changes domain roles.

## 2. Registry fields
The `applications` registry gains:

| Field | Rule |
| --- | --- |
| `governance_summary_path` | Nullable. A path on the application's `canonical_url` origin, for example `/api/governance/summary`. Absolute URLs and other origins are rejected. |
| `governance_audience` | Nullable. The Keycloak client ID used as the token-exchange audience. Required when the path is set. |
| `governance_order` | Integer for card order. Ties are sorted by name. |

Only a Platform Administrator may change these fields, with the same audit rules as other registry changes.

## 3. Governance summary contract v1
Implemented by each participating application.

### Request
```
GET {canonical_url}{governance_summary_path}
Authorization: Bearer <exchanged access token>
Accept: application/json
```

The application must:

1. validate the token signature, issuer (staff realm), expiry, and that `aud` contains its own client ID;
2. map `iss + sub` to its local principal exactly as its login does; an unmapped identity gets `403`;
3. check its own governance role; no role gets `403`;
4. reject any token whose audience is not its own;
5. accept this bearer token **only** on the governance summary endpoint, never as a general session.

### Response `200`
```ts
interface GovernanceSummaryV1 {
  contractVersion: 1;
  applicationKey: string;          // must equal the registry key
  title: string;                   // card title, for example "SDM", "Aset"
  dataAsOf: string;                // ISO timestamp of the data the figures describe
  metrics: Array<{                 // 1 to 6 items, in display order
    key: string;
    label: string;                 // plain Indonesian, for example "Pegawai aktif"
    value: number | null;          // null => shown as "Belum tersedia"
    unit?: Unit;
    tone?: "normal" | "attention";
    headline?: boolean;            // candidate for the headline strip; at most 1 per application
    trend?: {                      // optional sparkline and change
      points: Array<{ period: string; value: number | null }>;   // "2026-10"; 6 to 12 monthly points, oldest first
      change?: { value: number; unit: Unit | "poin"; direction: "up" | "down" | "flat"; good?: "up" | "down" };
    };
  }>;
  charts?: GovernanceChart[];      // 0 to 2 charts
  attention?: Array<{              // 0 to 3 items
    label: string;                 // for example "Permintaan formasi menunggu persetujuan Yayasan"
    count: number;
    href: string;                  // absolute URL on the same origin as canonical_url
  }>;
  detailUrl: string;               // absolute URL on the same origin as canonical_url
}

type Unit = "orang" | "unit" | "item" | "persen" | "rupiah" | "hari";

type GovernanceChart = {
  key: string;
  title: string;                   // for example "Pegawai aktif per bulan"
  unit: Unit;
  dataAsOf: string;
} & (
  | { kind: "trend";               // line over time, optional bars for a second count on the same scale
      periods: string[];           // 6 to 12 monthly periods, oldest first
      series: Array<{ key: string; label: string; mark: "line" | "bar"; values: Array<number | null> }>; // 1 or 2
    }
  | { kind: "ranking";             // horizontal bars, largest first
      items: Array<{ label: string; value: number }>;   // 1 to 8; the rest folded into "Lainnya"
    }
  | { kind: "composition";         // horizontal stacked bars, one per category
      parts: Array<{ key: string; label: string }>;     // 2 or 3 parts, fixed order
      items: Array<{ label: string; values: number[] }>; // 1 to 6
    }
  | { kind: "stages";              // ordered stages of one process, each a count
      items: Array<{ label: string; value: number }>;   // 2 to 6, in process order
    }
  | { kind: "target";              // actual against a planned figure per group
      items: Array<{ label: string; target: number; actual: number }>; // 1 to 8
    }
);
```

### Chart rules
- Hub draws charts; applications send only data. Applications never send colours, chart-library options, images, or HTML.
- The five kinds are the whole set for v1. A new kind needs a spec change so every module looks the same.
- Every chart has one value scale. Two figures with different scales are two charts.
- Trend data is history the application computes from its own records (for example HCIS from effective-dated employment). Hub never stores past summaries to build a trend.
- A group in `ranking`, `composition`, or `target` is an organizational unit or a category, never a person. The privacy rules below apply to every value in a chart.
- If an application cannot produce history yet, it omits `trend` and `charts`. The card still works with metrics only.

### Privacy rules
- Values are counts, sums, or ratios over a group. No names, NIP, NIK, e-mail, phone, dates of birth, account numbers, document references, or free text copied from records.
- A figure that would describe one identifiable person (for example a count of 1 in a small unit) is not broken down further. The overall total may still be shown.
- Labels are fixed strings chosen by the application, not data values.
- The application specifies each metric's meaning and permission in its own spec (for example HCIS ORG-003-F still forbids attendance and payroll aggregates).
- Financial figures (budgets, realisation, cash, payroll totals) appear only after the owning application has its own spec that defines them and authorizes the organs to see them. Until then a card leaves them out; Hub never derives them.

### Errors
| Response | Meaning | Hub behaviour |
| --- | --- | --- |
| `403` | Not mapped or no governance role | Card not shown. |
| `404` | Endpoint not deployed | Card not shown; logged for operators. |
| `5xx`, timeout, invalid body | Application problem | Card shows "Tidak dapat dimuat" with a retry button. |

## 4. Hub fetch behaviour
- Hub requests summaries only for applications that are `active`, have `governance_summary_path` set, and for which the user has active Application Access, and only when the user has an effective membership.
- For each application, Hub exchanges the user's session access token for a token with `audience = governance_audience` (Keycloak standard token exchange, no refresh token issued). Hub's OIDC client is allowed to exchange only to audiences registered here.
- Requests run in parallel with a 3-second timeout each. One failing application never blocks the page.
- Hub validates the response against the contract, including item limits, chart kinds, and that every series has one value per period. It drops the card if `applicationKey` does not match, or if `detailUrl` or any `href` is not on the application's own origin. An invalid chart is dropped on its own; the rest of the card still shows.
- Hub keeps a summary in memory for at most 60 seconds per session and never writes it to the database, logs, or audit events. Logs record only application key, status code, and latency.
- Hub renders all strings as text, never as HTML.
- Exchanged tokens never reach the browser.

### Browser contract
`GET /api/governance/summaries` requires a Hub session and an effective membership (`403` otherwise):

```ts
interface GovernanceSnapshot {
  membership: { organ: "pembina" | "pengurus" | "pengawas"; positionLabel?: string };
  cards: Array<
    | { applicationKey: string; state: "ready"; summary: GovernanceSummaryV1 }
    | { applicationKey: string; state: "failed"; name: string }
  >;
  generatedAt: string;
}
```

`WorkspaceSnapshot` gains `capabilities.governanceView: boolean` so the shell knows whether to offer the page.

## 5. Ringkasan Yayasan page
Route: `/yayasan`, titled "Ringkasan Yayasan".

- After login, an identity with an effective membership lands on `/yayasan`. Others land on `/` as today. TBD: whether a member who is also staff should land on `/` instead (ADR-0009 open question).
- Header follows the SQ Core app shell. The account menu shows the organ badge, for example "Pengurus Yayasan". The launcher offers "Ringkasan Yayasan" first for members, then Beranda and apps.
- Page top: greeting, organ badge, and "Data per <time>" using the oldest `dataAsOf` among ready cards.
- **Headline strip:** up to 4 tiles, one per application in `governance_order`, from the metric marked `headline`. Each tile shows the value, the change, and a sparkline from `trend`.
- **Module sections:** one section per application in `governance_order`, holding its charts (up to 2), its remaining metrics, and a "Lihat rincian" link to `detailUrl`. On desktop, charts sit two per row.
- **Perlu perhatian:** one combined list of `attention` items from every ready card, each naming its application and linking to its `href`. An application that failed shows here as "Tidak dapat dimuat" with a retry button.
- A metric with `tone = "attention"` uses the "Perlu perhatian" style, not an error style. Change colour follows `good`: a change in the good direction uses the success tone, otherwise the warning tone; without `good` it stays neutral.
- A `null` value reads "Belum tersedia"; a `null` point leaves a gap in a line, never a zero.
- Charts follow the SQ Core design system: one categorical palette in fixed order (series colour follows the series key, never its position), thin marks, recessive grid, legend whenever there are two or more series, and a hover tooltip with exact values. Each chart offers "Lihat tabel" showing the same data as a table, so no value relies on colour alone.
- Below the cards: "Aplikasi Anda", the ordinary app grid from `WorkspaceSnapshot`.
- No application returns a card: the page explains in plain words that no application has connected a summary for this account yet, and still shows "Aplikasi Anda".
- Phones: headline tiles in a 2×2 grid, sections and charts one per row, no horizontal scroll, and bottom navigation includes "Ringkasan".

## 6. Domain work this spec depends on
Each item needs its own spec ID in its own repository. They are listed here only to name the first sources.

| Application | Work |
| --- | --- |
| HCIS | Publish ORG-003 aggregates through contract v1 for `FOUNDATION_BOARD`, with a monthly active-headcount trend and a headcount-by-unit ranking if effective-dated history supports them (to be confirmed). Add bearer validation on that endpoint only. Allow a `FOUNDATION_BOARD` account to be mapped through the existing OIDC identity mapping. |
| Aset SQ | Specify a governance role (read-only, organization scope, no mutation) and what to publish, for example asset condition by category (`composition`). |
| Karir SQ | Publish open vacancies, candidates per selection stage (`stages`), and staffing requests awaiting Yayasan approval as an attention item. The approval itself stays in Karir SQ. |
| Keuangan, SPMB | Implement contract v1 when they are built. Keuangan first specifies which financial figures the organs may see (for example budget against realisation per unit as `target`). |

## Rollout
1. Accept ADR-0009 and this spec after the open questions are answered.
2. Configure and prove token exchange on Mi8VPS with allowed and forbidden audience probes.
3. Ship Hub membership, registry fields, and the page behind `capabilities.governanceView`, with HCIS as the first source.
4. Add Aset SQ, then Karir SQ.

Every production change on Mi8VPS needs explicit owner approval.

## Rollback
- Removing a registry `governance_summary_path` removes that card at once.
- Ending all memberships returns members to the ordinary Beranda.
- Hub stores no domain data, so nothing needs to be purged.

## Acceptance criteria
1. Without an effective membership, `/api/governance/summaries` returns `403` and the user lands on `/`.
2. A membership outside its term is not effective.
3. Membership grant, change, and end require fresh session, reason, and `governance.membership.manage`; each writes one audit event. Self-grant is refused.
4. Hub requests only active applications with a summary path and active Application Access.
5. A domain `403` or `404` hides the card. A timeout or invalid body shows "Tidak dapat dimuat" without delaying other cards beyond 3 seconds.
6. A response with a mismatched `applicationKey`, or a link to another origin, is dropped.
7. Exchanged tokens never reach the browser. Summary bodies never appear in the database, logs, or audit events.
8. A token exchanged for one application is refused by another application.
9. A domain app refuses the exchanged token on any endpoint other than its governance summary.
10. Revoking Application Access or ending the membership removes the card on the next request after the 60-second cache.
11. The page passes error, loading, empty, forbidden, and phone-width checks.
12. Each of the five chart kinds renders from contract data alone, with a hover tooltip and a "Lihat tabel" view that show the same values.
13. A chart with a wrong kind, too many items, or mismatched series length is dropped without hiding the rest of its card.
14. A series keeps its colour when another series is absent.
