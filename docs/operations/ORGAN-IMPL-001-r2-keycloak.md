# ORGAN-IMPL-001 R2 — Keycloak and configuration for deciding in the Portal Organ Yayasan

**Status:** §1 and §2 APPLIED to the realm on 2026-11-18. §3 to §7 not started: both flags are off, so nothing has changed for anyone. Each step follows the SQ Core release rules (dry run first, report afterwards, never at 19 UTC).

**Scope:** realm `sq-staff`, the existing client `sq-organ`, a new audience-only client for decisions, and the realm's Level of Authentication. R1 (`ORGAN-IMPL-001-keycloak.md`) is a prerequisite and is already live.

**Specification:** ORGAN-IMPL-001 §4.2, ADR-0012 D4; HCIS ORG-015 (`docs/domain/organ-decision-route.md`).

## 0. What has to be true before anything is switched on

| Condition | Why |
| --- | --- |
| The realm issues `acr = "2"` for TOTP, and that value survives token exchange | The whole separation rests on it (D4). The probe in §4 is what proves it; until it passes, R2 stays off |
| HCIS runs a release with ORG-015 | Without it the decision routes answer 404 and the portal has nothing to call |
| The leave workflow rollout is `STRUCTURE` | While it is `LEGACY` no approval step falls to an organ account, so the list is empty by construction (ORG-013) |

The third is not a blocker for switching R2 on: an empty list is correct and harmless. It is a blocker for seeing anything happen.

## 1. Level of Authentication in the realm — APPLIED 2026-11-18

`organ-r2-keycloak.sh stepup` in `sq-core-ops` does this, and `stepup-off` undoes it.

What the realm looked like before it ran told us the original plan would not work. The bound browser
flow is `akun-sq-browser-trusted-device`, and its conditional 2FA sub-flow holds `OTP Form`, `WebAuthn`
and `Recovery Authentication Code Form` all **DISABLED**; the only enabled second factor is
`sq-trusted-device-otp` (HUB-IMPL-012). So there was no OTP step to give a Level of Authentication to,
and the one step that existed is precisely the one that must never reach level 2 — a remembered device
is not a fresh proof. `acr.loa.map` was unset on both the realm and `sq-organ`.

What is in place now is a conditional sub-flow of its own, **inside** the flow's `forms` sub-flow:

```
akun-sq-browser-trusted-device forms
  Username Password Form                  REQUIRED      priority 0
  … Browser - Conditional 2FA             CONDITIONAL   priority 10   (unchanged)
  organ-stepup-loa2                       CONDITIONAL   priority 1000 (new)
    Condition - Level of Authentication   REQUIRED      level 2, max age 900s
    OTP Form                              REQUIRED
```

Inside `forms`, never beside the top level's alternatives. Keycloak throws away every ALTERNATIVE on a
level that also holds a REQUIRED or an enabled CONDITIONAL — `DefaultAuthenticationFlow` in
`keycloak-services-26.7.2.jar` carries the literal *"REQUIRED and ALTERNATIVE elements at same level!
Those alternative executions will be ignored"* followed by a `clear()`. A conditional at the top level
would therefore, the moment it fired, drop Cookie, the identity-provider redirector and `forms` itself,
and the step-up would reach an OTP form with nobody signed in. The `forms` level holds no alternative.

Two details that cost a run each, and are worth keeping:

- The `forms` sub-flow's alias carries the bound flow's name and so contains spaces. kcadm does not
  encode the path (`Illegal character in path at index 95`), so the script encodes it itself.
- A new execution is created with priority 0, tying with the username-password form, and two executions
  tied at 0 order arbitrarily. `lower-priority` then swaps 0 with 0 and does nothing. The requirement
  and an explicit priority go in one `PUT …/executions`.

900 seconds matches `STEP_UP_MAX_AGE_SECONDS` in `organ-decisions/service.ts`: the realm and the portal
have to agree on how long a proof stays fresh.

`acr.loa.map` is `{"1":1,"2":2}` on the client `sq-organ` **only**, not on the realm, so no other
application's `acr` claim changed. `sq-hub` has neither the map nor the decision scope.

A trusted device (HUB-IMPL-012) and a recovery code must **not** reach level 2 (`DRAFT`, T-3). The
structure makes that so by construction — the step-up sub-flow contains `auth-otp-form` and nothing
else — but it is still to be confirmed with a real sign-in, in §4.

### What was checked after it was applied

| Check | Result |
| --- | --- |
| `sq-organ` authorization endpoint with PKCE, no `acr_values` | `200`, the ordinary username and password form |
| the same with `acr_values=2` | `200`, the ordinary username and password form (the OTP step comes after it) |
| Keycloak `runtime.log` | no "REQUIRED and ALTERNATIVE elements at same level" warning |
| `stepup` run twice more | no change, and the sub-flow stays the last step of `forms` |

Rollback is `organ-r2-keycloak.sh stepup-off`. The backup each run writes to
`/data/local/mi8vps/backups/organ-r2-flow-<stamp>.json` is the flow as it was.

## 2. The decision audience client — APPLIED 2026-11-18

Create an OpenID Connect client `hcis-organ-decision`:

- Client authentication On, but **no flow enabled**: Standard flow Off, Direct access grants Off, Implicit Off, Service accounts Off. It exists only so there is an audience to name, and must never be a way in.
- No redirect URI, no web origin.

Then, in the realm's client scopes, create an **optional** scope `sq-organ-decision-hcis`:

- Protocol mapper of type Audience, included client audience `hcis-organ-decision`, add to access token On.
- Assign it to `sq-organ` as **Optional**, never Default.

The scope must not be assigned to `sq-hub`. SQ Hub never decides (ADR-0012 D4).

`organ-r2-keycloak.sh audience` does this. After it ran, `hcis-organ-decision` reports
`standardFlowEnabled`, `serviceAccountsEnabled` and `directAccessGrantsEnabled` all false with no
redirect URI, and `sq-organ`'s optional scopes are `sq-governance-aset-sq`, `sq-governance-hcis`,
`sq-governance-karir-sq`, `sq-organ-decision-hcis`. `sq-hub` does not have the decision scope.

## 3. Configuration

HCIS production env (ORG-015-1):

```text
GOVERNANCE_DECISIONS_ENABLED=true
GOVERNANCE_DECISION_AUDIENCE=hcis-organ-decision
GOVERNANCE_DECISION_ALLOWED_CLIENTS=sq-organ
```

SQ Hub production env:

```text
PORTAL_ORGAN_DECISIONS_ENABLED=true
```

Registry, in Admin Center (or the registry SQL used for the Karir card): set application `hcis` `decision_path` to `/governance/decisions` and `decision_audience` to `hcis-organ-decision`. The registry refuses a decision audience equal to that application's governance summary audience.

## 4. Probes before switching on

| Probe | Expected |
| --- | --- |
| Exchange from a member's `sq-organ` token to `hcis-organ-decision` with scope `sq-organ-decision-hcis` | `200`; the decoded token has `azp = sq-organ`, `aud` contains `hcis-organ-decision`, **and `acr` is `"2"`** |
| The same exchange without the scope | `aud` without the decision audience |
| The decision token presented to `GET /governance/summary` | `403 FORBIDDEN_AUDIENCE` |
| A summary token presented to `GET /governance/decisions` | `403 FORBIDDEN_AUDIENCE` |
| The same decision token presented twice to `GET /governance/decisions` | first `200`, second `409 DECISION_TOKEN_SPENT` |
| A token minted 61 seconds earlier | `401 TOKEN_TOO_OLD` |
| Sign in with a trusted device, then exchange | `acr` is not `"2"`, and the decision route answers `403 STEP_UP_REQUIRED` |
| `https://organ…/api/organ/decisions` with a session that has not stepped up | `403` with `step_up_required` and the step-up path |

The `acr` probe is the one ADR-0012 D4 made R2 wait for. If it fails, stop: leave both flags off and report. Nothing else in this file is worth applying without it.

## 5. Order

1. Realm: Level of Authentication (§1), then the trusted-device check.
2. Client and scope (§2).
3. HCIS release with ORG-015, flags still off.
4. SQ Hub release with R2, flag still off.
5. Registry fields for `hcis`.
6. Probes (§4), which need only the exchange and the HCIS routes.
7. Switch `GOVERNANCE_DECISIONS_ENABLED` on, then `PORTAL_ORGAN_DECISIONS_ENABLED`.

Between 7a and 7b the portal still links to `/board`, which keeps working.

## 6. Rollback

1. `PORTAL_ORGAN_DECISIONS_ENABLED=false` and restart SQ Hub. The Keputusan tab returns to counts and links, exactly as R1.
2. `GOVERNANCE_DECISIONS_ENABLED=false` and restart HCIS. Both decision routes answer 404.
3. The registry fields may be cleared, the client and scope may stay. Migration `0026` and HCIS `0166` are additive.

HCIS `/board` keeps the approval box throughout, so an organ member is never left without a way to decide.
