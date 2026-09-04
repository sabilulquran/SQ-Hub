# HUB-IMPL-003 repository governance observations

**Status:** READ-ONLY OBSERVATION  
**Administration changes:** NONE

These observations were collected while preparing Wave 1 closure. They are recommendations only; this branch does not mutate repository or organization administration settings.

## SQ Hub main protection

At the start of this work, GitHub reported `sabilulquran/SQ-Hub` branch `main` at `827375f31a6ab2badaf9ee0214f2089ec722a8af` with branch protection disabled and no required status-check contexts configured.

Recommendation after the parallel Wave 1 work is reconciled:

- protect `main` against direct pushes;
- require pull requests;
- require the repository CI checks that are actually stable and relevant before merge;
- include the dedicated Wave 1 acceptance-contract job while Wave 1 closure remains active, then deliberately decide whether it remains a permanent gate;
- require branches to be current with the target branch if the team chooses that merge policy;
- avoid making a check required until its trigger guarantees that the check is created for every PR that must satisfy it.

## HCIS main protection

The authoritative HCIS repository was resolved by frozen commits as `sabilulquran/hcisysq`. Its `main` branch was also observed as unprotected with no required status checks at audit time.

Recommendation: apply the same PR/CI governance principle there, especially because HCIS production deployment and authentication code now coexist with active feature development. This Agent 2 branch does not change HCIS repository administration.

## Package/image publishing assumptions

SQ Hub API staging publishing already uses GitHub Actions package write permission and the organization repository owner in the image name:

```text
ghcr.io/${github.repository_owner}/sq-hub-api
```

The workflow publishes immutable `sha-<source SHA>` images and a mutable `staging` convenience tag on `main` pushes. Wave 1 evidence and controlled deployment should use immutable SHA/digest identity rather than treating `staging` as provenance.

Operational assumptions to verify before relying on the publisher as a release gate:

- the repository GitHub Actions token continues to have package write access to the organization package namespace;
- package visibility/pull permissions allow the staging host to authenticate and pull the organization image;
- an immutable image digest is captured before deployment;
- the workflow source-ref dispatch is restricted operationally to reviewed commits for acceptance use;
- package retention policies do not delete the pinned rollback/acceptance artifact before the required operational window ends.

## Recommended governance change order

1. Let the three parallel implementation branches finish and reach green CI.
2. Reconcile/merge through normal review; do not bypass CI for protection setup.
3. Identify the exact check names consistently emitted on PRs.
4. Enable `main` protection/rules with those required checks.
5. Verify a test PR cannot merge when a required check fails.
6. Document package pull credentials/permissions and immutable-image retention as an operations responsibility.

No settings were mutated by this audit.
