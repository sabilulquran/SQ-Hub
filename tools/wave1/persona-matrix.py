#!/usr/bin/env python3
import argparse
import hashlib
import json
import sys
from pathlib import Path

REQUIRED = {
    "ordinary_employee",
    "manager",
    "human_capital_admin",
    "privileged_super_admin",
    "non_employee_staff",
    "hcis_local_suspended",
    "globally_disabled_keycloak",
    "revoked_application_access",
    "wrong_unknown_mapping",
}

ALLOWED_OUTCOMES = {"PENDING", "PASS", "FAIL", "MANUAL_STAGING_REQUIRED"}
EXPECTED_ISSUER = "https://login.sabilulquran.or.id/realms/sq-staff-staging"


def subject_handle(value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
    return f"sub-sha256:{digest}"


def sanitize_persona(persona: dict) -> dict:
    required_fields = {"key", "synthetic_identifier", "expected", "result"}
    missing = required_fields - set(persona)
    if missing:
        raise ValueError(f"persona {persona.get('key', '<unknown>')} missing fields: {sorted(missing)}")
    if persona["result"] not in ALLOWED_OUTCOMES:
        raise ValueError(f"persona {persona['key']} has invalid result {persona['result']}")
    if not persona["synthetic_identifier"]:
        raise ValueError(f"persona {persona['key']} requires a synthetic_identifier")
    if not persona["synthetic_identifier"].endswith(".invalid"):
        raise ValueError(f"persona {persona['key']} must use a synthetic .invalid identifier")
    out = {
        "key": persona["key"],
        "synthetic_identifier": persona["synthetic_identifier"],
        "expected": persona["expected"],
        "result": persona["result"],
    }
    subject = persona.get("runtime_subject")
    if subject:
        out["subject_handle"] = subject_handle(subject)
    if persona.get("notes"):
        out["notes"] = persona["notes"]
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and sanitize the Wave 1 synthetic persona matrix")
    parser.add_argument("input", type=Path, help="runtime JSON input; may contain raw runtime_subject values")
    parser.add_argument("--output", type=Path, help="write sanitized JSON report")
    args = parser.parse_args()

    data = json.loads(args.input.read_text(encoding="utf-8"))
    personas = data.get("personas")
    if not isinstance(personas, list):
        raise ValueError("input must contain a personas array")

    if data.get("issuer") != EXPECTED_ISSUER:
        raise ValueError("input must use the exact accepted staging issuer")
    sanitized = [sanitize_persona(p) for p in personas]
    keys = {p["key"] for p in sanitized}
    if len(keys) != len(sanitized):
        raise ValueError("persona keys must be unique")
    missing = REQUIRED - keys
    extras = keys - REQUIRED
    if missing:
        raise ValueError(f"missing required personas: {sorted(missing)}")
    if extras:
        raise ValueError(f"unexpected persona keys: {sorted(extras)}")

    report = {
        "schema": "sq-hub-wave1-persona-matrix-v1",
        "issuer": EXPECTED_ISSUER,
        "personas": sanitized,
    }
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        sys.stdout.write(encoded)
    print("PERSONA_MATRIX_SANITIZED_PASS", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"PERSONA_MATRIX_FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
