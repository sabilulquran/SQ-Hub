#!/usr/bin/env python3
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_ISSUER = "https://login.sabilulquran.or.id/realms/sq-staff-staging"

REQUIRED_FILES = [
    ROOT / "docs/operations/HUB-IMPL-003-wave1-closure.md",
    ROOT / "docs/operations/HUB-IMPL-003-production-cutover.md",
    ROOT / "docs/operations/HUB-IMPL-003-api-image-migration.md",
    ROOT / "docs/operations/HUB-IMPL-003-mfa-recovery-uat.md",
    ROOT / "tools/wave1/persona-matrix.py",
    ROOT / "tools/wave1/persona-matrix.example.json",
    ROOT / "tools/wave1/staging-preflight.sh",
    ROOT / "tools/wave1/final-snapshot.sh",
    ROOT / "tools/wave1/rollback-rehearsal.sh",
    ROOT / "tools/wave1/keycloak-backup-restore.sh",
]

FORBIDDEN_PATTERNS = [
    re.compile(r"(?i)client_secret\s*=\s*(?!replace|<|\$|\{)[A-Za-z0-9+/=_-]{16,}"),
    re.compile(r"(?i)totp[_ -]?seed\s*[:=]\s*\S+"),
    re.compile(r"(?i)recovery[_ -]?code\s*[:=]\s*[A-Za-z0-9-]{8,}"),
    re.compile(r"(?i)password\s*[:=]\s*(?!replace|<|\$|\{)[^\s`]{12,}"),
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    for path in REQUIRED_FILES:
        require(path.exists(), f"required Wave 1 closure file missing: {path.relative_to(ROOT)}")

    closure = (ROOT / "docs/operations/HUB-IMPL-003-wave1-closure.md").read_text(encoding="utf-8")
    require("#9 remains authoritative and OPEN" in closure, "closure doc must preserve issue #9 authority")
    require("HUMAN_BROWSER_UAT" in closure, "closure doc must distinguish human/browser UAT")
    require("OPERATOR_SECRET_CONTROL" in closure, "closure doc must distinguish secret-control checks")
    require("PRODUCTION_AUTHORIZATION" in closure, "closure doc must distinguish production authorization")
    require("MANUAL_STAGING_REQUIRED" in closure, "closure doc must preserve manual staging state")

    fixture = json.loads((ROOT / "tools/wave1/persona-matrix.example.json").read_text(encoding="utf-8"))
    require(fixture.get("issuer") == EXPECTED_ISSUER, "persona fixture must use the exact staging issuer")
    require(all("runtime_subject" not in p for p in fixture["personas"]), "example fixture must not contain raw subjects")

    preflight = (ROOT / "tools/wave1/staging-preflight.sh").read_text(encoding="utf-8")
    require(EXPECTED_ISSUER in preflight, "staging preflight must pin exact issuer")
    require("EXPECTED_HCIS_ORIGIN" in preflight and "WAVE1_STAGING_ORIGIN_FAIL" in preflight, "staging preflight must refuse non-staging HCIS origins")
    require("/api/auth/login" in preflight and "/auth/login" in preflight, "preflight must probe known local-auth public paths")

    rollback = (ROOT / "tools/wave1/rollback-rehearsal.sh").read_text(encoding="utf-8")
    require('[[ "$PROJECT" == "hcis-staging" ]]' in rollback, "rollback must guard the staging project")
    require("PRODUCTION_ENV_REFUSED" in rollback, "rollback must reject production-looking env paths")
    require("WAVE1_LOCAL_AUTH_PROBE" in rollback and "WAVE1_OIDC_SSO_PROBE" in rollback, "rollback must require real operator probes")
    require("WAVE1_STAGING_MUTATION_CONFIRMATION" in rollback, "rollback must require explicit staging mutation confirmation")
    require("identity_issuer" in rollback and "identity_subject" in rollback, "rollback must prove identity schema preservation")

    snapshot = (ROOT / "tools/wave1/final-snapshot.sh").read_text(encoding="utf-8")
    require(".well-known/openid-configuration" in snapshot, "snapshot must verify runtime OIDC discovery before PASS")
    require("PRODUCTION_ENV_REFUSED" in snapshot, "snapshot must reject production-looking env paths")

    backup_restore = (ROOT / "tools/wave1/keycloak-backup-restore.sh").read_text(encoding="utf-8")
    require("RESTORE_DB_OVERRIDE_REFUSED" in backup_restore, "backup/restore wrapper must refuse arbitrary restore databases")
    require("RESTORE_DB_COLLIDES_WITH_ACTIVE_DB" in backup_restore, "backup/restore wrapper must reject the active database")

    persona_tool = (ROOT / "tools/wave1/persona-matrix.py").read_text(encoding="utf-8")
    require(EXPECTED_ISSUER in persona_tool, "persona tool must enforce the exact staging issuer")
    require("persona keys must be unique" in persona_tool, "persona tool must reject duplicate personas")

    cutover = (ROOT / "docs/operations/HUB-IMPL-003-production-cutover.md").read_text(encoding="utf-8")
    require("CUTOVER_BLOCKED" in cutover, "production runbook must fail closed while Wave 1 is incomplete")
    require("14 days" in cutover, "production runbook must preserve the maximum 14-day rollback window")
    require("immutable" in cutover.lower(), "production runbook must require immutable version pins")

    migration = (ROOT / "docs/operations/HUB-IMPL-003-api-image-migration.md").read_text(encoding="utf-8")
    require("ghcr.io/sabilulquran/sq-hub-api:sha-" in migration, "API migration doc must use organization-owned immutable images")
    require("DO NOT DEPLOY" in migration, "API migration doc must remain preparation-only")

    text_paths = [p for p in REQUIRED_FILES if p.suffix in {".md", ".py", ".sh", ".json"}]
    for path in text_paths:
        text = path.read_text(encoding="utf-8")
        for pattern in FORBIDDEN_PATTERNS:
            require(pattern.search(text) is None, f"possible credential material in {path.relative_to(ROOT)}")

    print("WAVE1_OFFLINE_CONTRACT_PASS")


if __name__ == "__main__":
    main()
