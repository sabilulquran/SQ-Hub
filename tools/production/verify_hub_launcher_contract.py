#!/usr/bin/env python3
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

ISSUER = "https://login.sabilulquran.or.id/realms/sq-staff"
ORIGIN = "https://hub.sabilulquran.or.id"
REDIRECT = f"{ORIGIN}/auth/callback"
LOGOUT = f"{ORIGIN}/"

COMPOSE = ROOT / "infra/docker-compose.production.yml"
ENV_EXAMPLE = ROOT / "infra/production.env.example"
CADDY = ROOT / "infra/reverse-proxy.caddy.production.example"
CLIENT = ROOT / "infra/keycloak/clients/sq-hub-production.json"
RECONCILE = ROOT / "infra/keycloak/scripts/reconcile-hub-production-client.sh"
SPEC = ROOT / "docs/specs/HUB-IMPL-016-hub-production-launcher.md"
RUNBOOK = ROOT / "docs/operations/HUB-IMPL-016-production-launcher.md"

PLACEHOLDER_DIGEST = "0" * 64


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def read(path: Path) -> str:
    require(path.exists(), f"required file missing: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def main() -> None:
    compose = read(COMPOSE)
    env = read(ENV_EXAMPLE)
    caddy = read(CADDY)
    reconcile = read(RECONCILE)
    spec = read(SPEC)
    runbook = read(RUNBOOK)
    client = json.loads(read(CLIENT))

    require(ISSUER in compose, "production compose must pin exact issuer")
    require(ORIGIN in compose, "production compose must pin exact Hub origin")
    require(REDIRECT in compose, "production compose must pin exact callback")
    require(LOGOUT in compose, "production compose must pin exact logout redirect")
    require("SQ_HUB_OIDC_CLIENT_ID: sq-hub" in compose, "production compose must use distinct sq-hub client")
    require("sq-hub-staging" not in compose, "production compose must not reuse staging Hub client")
    require("sq-staff-staging" not in compose, "production compose must not reuse staging realm")
    require("HUB_COOKIE_SECURE: \"true\"" in compose, "production cookies must be Secure")
    require("127.0.0.1" in compose, "production ports must default to loopback")
    require("postgres:" not in compose and "keycloak:" not in compose and "hcis:" not in compose,
            "production launcher compose must not own database/Keycloak/HCIS services")
    require("image: ${SQ_HUB_API_IMAGE:" in compose and "image: ${SQ_HUB_WEB_IMAGE:" in compose,
            "production images must be explicit env inputs")

    require("ghcr.io/sabilulquran/sq-hub-api@sha256:" in env, "API image example must use digest form")
    require("ghcr.io/sabilulquran/sq-hub-web@sha256:" in env, "web image example must use digest form")
    require(":latest" not in env and ":staging" not in env, "production env must not suggest mutable tags")
    require("sq-staff-staging" not in env and "hub-staging" not in env, "production env must not contain staging endpoints")

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

    require('REALM="${KEYCLOAK_REALM:-sq-staff}"' in reconcile, "reconcile script must default exact production realm")
    require('[[ "$REALM" == "sq-staff" ]]' in reconcile, "reconcile script must fail closed outside production realm")
    require("sq-staff-staging" not in reconcile, "production reconcile must not target staging")
    require("HUB_PRODUCTION_CLIENT_SECRET_HANDOFF_REQUIRED" in reconcile, "secret handling must stop at operator handoff")
    require("get clients" in reconcile and "kcadm update" in reconcile, "reconciliation must be convergent")

    require("reverse_proxy @oidc_callback 127.0.0.1:18201" in caddy, "callback must go through Hub web boundary")
    require("reverse_proxy @api 127.0.0.1:18201" in caddy, "API path must go through Hub web boundary")
    require("127.0.0.1:18200" not in caddy, "public edge must not target API loopback directly")

    for text, label in ((spec, "spec"), (runbook, "runbook")):
        require("REPOSITORY_READY" in text, f"{label} must distinguish repository readiness")
        require("DEPLOYED" in text, f"{label} must distinguish deployed state")
        require("BROWSER_VERIFIED" in text, f"{label} must distinguish browser verification")
        require("accountTheme=sq-hub" in text, f"{label} must preserve Account Console activation boundary")

    forbidden_secret_patterns = [
        re.compile(r"(?i)client[_ -]?secret\s*[:=]\s*(?!replace|<|\$|\{)[A-Za-z0-9+/=_-]{20,}"),
        re.compile(r"(?i)password\s*[:=]\s*(?!replace|<|\$|\{)[^\s`]{12,}"),
        re.compile(r"(?i)recovery[_ -]?code\s*[:=]\s*[A-Za-z0-9-]{8,}"),
        re.compile(r"(?i)totp[_ -]?(?:seed|secret)\s*[:=]\s*\S+"),
    ]
    for path in (ENV_EXAMPLE, CLIENT, RECONCILE, SPEC, RUNBOOK):
        text = read(path)
        for pattern in forbidden_secret_patterns:
            require(pattern.search(text) is None, f"possible committed secret in {path.relative_to(ROOT)}")

    # The example digest is intentionally non-deployable and must remain a placeholder.
    require(PLACEHOLDER_DIGEST in env, "production env example must retain explicit non-deployable digest placeholder")

    print("HUB_PRODUCTION_LAUNCHER_CONTRACT_PASS")


if __name__ == "__main__":
    main()
