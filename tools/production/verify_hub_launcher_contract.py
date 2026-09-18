#!/usr/bin/env python3
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

ISSUER = "https://login.sabilulquran.or.id/realms/sq-staff"
ORIGIN = "https://hub.sabilulquran.or.id"
REDIRECT = f"{ORIGIN}/auth/callback"
LOGOUT = f"{ORIGIN}/"
WEB_EDGE = "sq-hub-production_web_edge"
WEB_ALIAS = "sq-hub-production-web"

COMPOSE = ROOT / "infra/docker-compose.production.yml"
ENV_EXAMPLE = ROOT / "infra/production.env.example"
CADDY = ROOT / "infra/reverse-proxy.caddy.production.example"
CLIENT = ROOT / "infra/keycloak/clients/sq-hub-production.json"
RECONCILE = ROOT / "infra/keycloak/scripts/reconcile-hub-production-client.sh"
SECRET_VERIFY = ROOT / "infra/keycloak/scripts/verify-hub-production-secret-fingerprint.sh"
MASTER_RECOVERY = ROOT / "infra/keycloak/realm/master-production-recovery.json"
MASTER_SMTP = ROOT / "infra/keycloak/master-smtp.env.example"
ACCOUNT_THEME = ROOT / "infra/keycloak/themes/sq-hub/account/theme.properties"
LOGIN_FOOTER = ROOT / "infra/keycloak/themes/sq-hub/login/footer.ftl"
SPEC = ROOT / "docs/specs/HUB-IMPL-016-hub-production-launcher.md"
RUNBOOK = ROOT / "docs/operations/HUB-IMPL-016-production-launcher.md"
STATUS = ROOT / "docs/operations/project-status-2026-09-18.md"

PLACEHOLDER_DIGEST = "0" * 64


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def read(path: Path) -> str:
    require(path.exists(), f"required file missing: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def service_block(compose: str, service: str) -> str:
    match = re.search(
        rf"(?ms)^  {re.escape(service)}:\n(.*?)(?=^  [a-zA-Z0-9_-]+:\n|^networks:\n)",
        compose,
    )
    require(match is not None, f"missing service block: {service}")
    return match.group(1)


def validate_network_contract(compose: str, caddy: str) -> None:
    web = service_block(compose, "web")
    api = service_block(compose, "api")

    require("name: sq-hub-production" in compose, "production compose must use stable project name")
    require("name: sq-hub-production_backend" in compose, "backend network name must be explicit")
    require(f"name: {WEB_EDGE}" in compose, "dedicated Hub web edge network must be explicit")
    require("sq-hub-production-web" in web, "web must publish a unique edge alias")
    require("edge_proxy" not in web, "Hub web must never join shared edge_proxy")
    require("aliases:\n          - api" in api, "generic api alias must remain on private Hub backend")
    require("internal: true" in compose, "Hub backend must remain internal")

    require(f"{WEB_ALIAS}:80" in caddy, "containerized Caddy must use unique Hub web DNS upstream")
    require(
        re.search(r"(?m)^\s*reverse_proxy(?:\s+@\S+)?\s+127[.]0[.]0[.]1(?::\d+)?\s*$", caddy) is None,
        "containerized Caddy must not use loopback upstream",
    )
    require("reverse_proxy @oidc_callback sq-hub-production-web:80" in caddy,
            "callback must go through Hub web boundary")
    require("reverse_proxy @api sq-hub-production-web:80" in caddy,
            "API path must go through Hub web boundary")
    require("api:3100" not in caddy, "Caddy must not bypass web and target generic API alias")


def validate_oidc_contract(compose: str, client: dict) -> None:
    require(ISSUER in compose, "production compose must pin exact issuer")
    require(ORIGIN in compose, "production compose must pin exact Hub origin")
    require(REDIRECT in compose, "production compose must pin exact callback")
    require(LOGOUT in compose, "production compose must pin exact logout redirect")
    require("SQ_HUB_OIDC_CLIENT_ID: sq-hub" in compose, "production compose must use distinct sq-hub client")
    require("sq-hub-staging" not in compose, "production compose must not reuse staging Hub client")
    require("sq-staff-staging" not in compose, "production compose must not reuse staging realm")
    require('HUB_COOKIE_SECURE: "true"' in compose, "production cookies must be Secure")

    require(client.get("clientId") == "sq-hub", "desired client id must be sq-hub")
    require(client.get("publicClient") is False, "production Hub client must be confidential")
    require(client.get("standardFlowEnabled") is True, "standard flow must be enabled")
    require(client.get("implicitFlowEnabled") is False, "implicit flow must be disabled")
    require(client.get("directAccessGrantsEnabled") is False, "direct access grants must be disabled")
    require(client.get("serviceAccountsEnabled") is False, "browser client service accounts must be disabled")
    require(client.get("redirectUris") == [REDIRECT], "redirect URI must be exact")
    require(client.get("webOrigins") == [ORIGIN], "web origin must be exact")
    attrs = client.get("attributes", {})
    require(attrs.get("pkce.code.challenge.method") == "S256", "PKCE must be S256")
    require(attrs.get("post.logout.redirect.uris") == LOGOUT, "post logout redirect must be exact")
    require("secret" not in client, "desired client state must not contain client secret")


def validate_secret_rotation_contract(reconcile: str, secret_verify: str, runbook: str) -> None:
    require('REALM="${KEYCLOAK_REALM:-sq-staff}"' in reconcile,
            "reconcile script must default exact production realm")
    require('[[ "$REALM" == "sq-staff" ]]' in reconcile,
            "reconcile script must fail closed outside production realm")
    require("sq-staff-staging" not in reconcile, "production reconcile must not target staging")
    require("HUB_PRODUCTION_CLIENT_SECRET_HANDOFF_REQUIRED" in reconcile,
            "secret handling must stop at operator handoff")

    require("client-secret" in secret_verify, "fingerprint verifier must read Keycloak client secret")
    require("SQ_HUB_PRODUCTION_ENV_FILE" in secret_verify, "fingerprint verifier must read production secret file")
    require("docker inspect" in secret_verify, "fingerprint verifier must inspect running API environment")
    require("KEYCLOAK_SECRET_FINGERPRINT" in secret_verify, "fingerprint verifier must emit non-secret Keycloak hash")
    require("API_CONTAINER_SECRET_FINGERPRINT" in secret_verify, "fingerprint verifier must emit non-secret API hash")
    require('[[ "$keycloak_fp" == "$file_fp" ]]' in secret_verify,
            "fingerprint verifier must compare Keycloak and file")
    require('[[ "$file_fp" == "$container_fp" ]]' in secret_verify,
            "fingerprint verifier must reject stale running API secret")
    require("--force-recreate api" in runbook,
            "runbook must require API recreation after secret rotation")


def validate_brand_and_recovery(master: dict, smtp: str, account_theme: str, login_footer: str) -> None:
    require(master.get("realm") == "master", "master recovery desired state must target master realm")
    require(master.get("displayName") == "Akun SQ", "master login display name must be Akun SQ")
    require(master.get("loginTheme") == "sq-hub", "master login theme must be sq-hub")
    require(master.get("accountTheme") == "sq-hub", "master account theme must be sq-hub")
    require(master.get("resetPasswordAllowed") is True, "master Forgot Password desired state must be enabled")
    require("password" not in {key.lower() for key in master}, "master desired state must contain no SMTP password")
    require("KEYCLOAK_MASTER_SMTP_PASSWORD=" in smtp, "SMTP shape must reserve runtime-only password input")
    require("KEYCLOAK_MASTER_SMTP_PASSWORD=\n" in smtp, "SMTP example must not contain a password")
    require("logo=img/ysq-mark.png" in account_theme, "Account Console must use organization mark")
    require("img/ysq-mark.png" in login_footer, "login footer must use organization mark")


def expect_rejected(label: str, operation) -> None:
    try:
        operation()
    except AssertionError:
        return
    raise AssertionError(f"regression guard did not reject: {label}")


def run_regression_guards(compose: str, caddy: str, client: dict, reconcile: str,
                          secret_verify: str, runbook: str) -> None:
    bad_collision = compose.replace(
        "      web_edge:\n        aliases:\n          - sq-hub-production-web",
        "      web_edge:\n        aliases:\n          - sq-hub-production-web\n      edge_proxy: {}",
    )
    expect_rejected(
        "shared edge alias collision",
        lambda: validate_network_contract(bad_collision, caddy),
    )

    bad_loopback = caddy.replace("sq-hub-production-web:80", "127.0.0.1:18201")
    expect_rejected(
        "containerized Caddy loopback upstream",
        lambda: validate_network_contract(compose, bad_loopback),
    )

    stale_guard = secret_verify.replace('[[ "$file_fp" == "$container_fp" ]]', 'true # stale guard removed')
    expect_rejected(
        "API not recreated after secret rotation",
        lambda: validate_secret_rotation_contract(reconcile, stale_guard, runbook),
    )

    bad_callback = json.loads(json.dumps(client))
    bad_callback["redirectUris"] = [f"{ORIGIN}/wrong-callback"]
    expect_rejected(
        "wrong production callback",
        lambda: validate_oidc_contract(compose, bad_callback),
    )

    bad_logout = json.loads(json.dumps(client))
    bad_logout["attributes"]["post.logout.redirect.uris"] = f"{ORIGIN}/signed-out"
    expect_rejected(
        "wrong production logout redirect",
        lambda: validate_oidc_contract(compose, bad_logout),
    )


def main() -> None:
    compose = read(COMPOSE)
    env = read(ENV_EXAMPLE)
    caddy = read(CADDY)
    reconcile = read(RECONCILE)
    secret_verify = read(SECRET_VERIFY)
    spec = read(SPEC)
    runbook = read(RUNBOOK)
    status = read(STATUS)
    account_theme = read(ACCOUNT_THEME)
    login_footer = read(LOGIN_FOOTER)
    smtp = read(MASTER_SMTP)
    client = json.loads(read(CLIENT))
    master = json.loads(read(MASTER_RECOVERY))

    validate_network_contract(compose, caddy)
    validate_oidc_contract(compose, client)
    validate_secret_rotation_contract(reconcile, secret_verify, runbook)
    validate_brand_and_recovery(master, smtp, account_theme, login_footer)

    require("127.0.0.1" in compose, "production host smoke ports must default to loopback")
    require("postgres:" not in compose and "keycloak:" not in compose and "hcis:" not in compose,
            "production launcher compose must not own database/Keycloak/HCIS services")
    require("image: ${SQ_HUB_API_IMAGE:" in compose and "image: ${SQ_HUB_WEB_IMAGE:" in compose,
            "production images must be explicit env inputs")
    require("ghcr.io/sabilulquran/sq-hub-api@sha256:" in env, "API image example must use digest form")
    require("ghcr.io/sabilulquran/sq-hub-web@sha256:" in env, "web image example must use digest form")
    require(":latest" not in env and ":staging" not in env, "production env must not suggest mutable tags")
    require("sq-staff-staging" not in env and "hub-staging" not in env,
            "production env must not contain staging endpoints")

    for text, label in ((spec, "spec"), (runbook, "runbook"), (status, "status")):
        require("Akun SQ" in text, f"{label} must use Akun SQ user-facing identity brand")
        require("SQ Hub" in text, f"{label} must preserve SQ Hub portal brand")

    require("OPERATOR-VERIFIED" in runbook, "runbook must distinguish operator runtime evidence")
    require("operator" in status.lower(), "status must attribute runtime evidence to operator")
    require("email recovery" in status.lower() and "belum boleh diklaim aktif" in status.lower(),
            "status must not claim SMTP recovery active")

    forbidden_secret_patterns = [
        re.compile(r"(?i)client[_ -]?secret\s*[:=]\s*(?!replace|<|\$|\{)[A-Za-z0-9+/=_-]{20,}"),
        re.compile(r"(?i)password\s*[:=]\s*(?!replace|<|\$|\{|$)[^\s`]{12,}"),
        re.compile(r"(?i)recovery[_ -]?code\s*[:=]\s*[A-Za-z0-9-]{8,}"),
        re.compile(r"(?i)totp[_ -]?(?:seed|secret)\s*[:=]\s*\S+"),
    ]
    for path in (
        ENV_EXAMPLE, CLIENT, RECONCILE, SECRET_VERIFY, MASTER_RECOVERY,
        MASTER_SMTP, SPEC, RUNBOOK, STATUS,
    ):
        text_value = read(path)
        for pattern in forbidden_secret_patterns:
            require(pattern.search(text_value) is None, f"possible committed secret in {path.relative_to(ROOT)}")

    require(PLACEHOLDER_DIGEST in env,
            "production env example must retain explicit non-deployable digest placeholder")

    run_regression_guards(compose, caddy, client, reconcile, secret_verify, runbook)

    print("HUB_PRODUCTION_LAUNCHER_CONTRACT_PASS")


if __name__ == "__main__":
    main()
