#!/usr/bin/env python3
"""Classify communities by access, policy readiness, and test priority."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, datetime
from pathlib import Path


def norm(value: object) -> str:
    return str(value or "").strip()


def source_evidence(row: dict[str, object]) -> str:
    fields = (
        "platform",
        "community_name",
        "visibility",
        "access_path",
        "access_status",
        "rules_status",
        "paid_posts_status",
        "commercial_policy",
        "dm_policy",
        "DM_policy",
        "admin_permission_status",
        "permission_evidence",
        "ai_content_policy",
        "ai_content_evidence",
        "approved_channels",
        "niche",
        "audience_age_evidence",
        "activity_evidence",
    )
    return " | ".join(norm(row.get(field)) for field in fields).lower()


def parse_date(value: object) -> date | None:
    raw = norm(value)[:10]
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def classify_community(row: dict[str, object], today: date | None = None) -> dict[str, str]:
    text = source_evidence(row)
    reasons: list[str] = []
    paid_status = norm(row.get("paid_posts_status") or row.get("commercial_policy")).lower()
    admin_status = norm(row.get("admin_permission_status")).lower()
    rules = " | ".join((norm(row.get("rules_status")), norm(row.get("permission_evidence")))).lower()
    forbidden = (
        paid_status in {"forbidden", "prohibited", "not allowed"}
        or admin_status in {"denied", "forbidden"}
        or any(term in rules for term in ("no paid games", "no solicitation", "no soliciting", "no advertising", "no promotion"))
    )
    dm_forbidden = any(term in text for term in ("do not dm", "no dms", "dms forbidden", "dm forbidden"))
    minors = any(term in text for term in ("minors only", "under 18", "kids only", "children only", "youth group", "high school"))
    hostile = any(term in text for term in ("hostile to paid", "anti-paid", "fake group", "spammy", "inactive group"))
    expiry = parse_date(row.get("permission_expires_at") or row.get("expires_at"))
    expired = bool(expiry and expiry < (today or date.today()))
    ai_policy = norm(row.get("ai_content_policy")).lower()
    ai_evidence = norm(row.get("ai_content_evidence")).lower()
    ai_forbidden = ai_policy in {"forbidden", "prohibited", "not allowed", "manual only", "manual-only"} or any(
        term in " | ".join((ai_policy, ai_evidence))
        for term in ("ai-generated content is not permitted", "ai generated content is not permitted")
    )
    ai_evidenced = bool(ai_evidence) and ai_policy in {
        "allowed", "not restricted", "not_restricted", "not stated", "not_stated"
    }
    ai_state = "manual_only" if ai_forbidden else "permitted" if ai_evidenced else "unknown"
    visibility = norm(row.get("visibility")).lower()
    access = norm(row.get("access_status") or row.get("access_path")).lower()
    has_access = visibility == "public" or any(term in access for term in ("joined", "granted", "public", "available"))
    allowed = any(term in text for term in ("paid posts allowed", "rules allow", "admin approved", "permission granted", "allowed-specific", "opt-in", "public reply allowed", "specific thread"))
    admin_first = any(term in text for term in ("admin approval required", "admin-approval-required", "ask admin"))
    unclear = not allowed or any(term in text for term in ("unknown", "unclear", "not checked"))

    if forbidden or minors or hostile:
        readiness, priority = "reject", "none"
        if forbidden:
            reasons.append("commercial contact is prohibited")
        if minors:
            reasons.append("community is minors-focused")
        if hostile:
            reasons.append("source is hostile, inactive, fake, or spammy")
    elif expired:
        readiness, priority = "audit_rules", "low"
        reasons.append("stored permission has expired")
    elif not has_access and visibility not in {"public"}:
        readiness = "request_access" if norm(row.get("access_path") or row.get("admin_contact_path")) else "blocked"
        priority = "low" if readiness == "request_access" else "none"
        reasons.append("legitimate access is not yet established")
    elif admin_first:
        readiness, priority = "request_access", "low"
        reasons.append("admin approval is required before research or outreach")
    elif unclear or ai_state == "unknown":
        readiness, priority = "audit_rules", "low"
        reasons.append("commercial, contact, and AI-content rules need current evidence")
    else:
        readiness = "test"
        high_signal = any(term in text for term in ("looking for dm", "lfg", "paid games", "adult players", "recent daily", "recent weekly"))
        priority = "high" if high_signal else "medium"
        reasons.append("access and a permitted commercial route are evidenced")
        if ai_state == "manual_only":
            reasons.append("retain for qualification; Ben-authored outreach only, with no AI-generated language or artifacts")
        if dm_forbidden:
            reasons.append("direct messages remain prohibited; use only the evidenced public route")

    return {
        "source_readiness": readiness,
        "source_priority": priority,
        "source_readiness_reason": "; ".join(reasons),
        "ai_content_state": ai_state,
    }


def load_rows(path: Path) -> list[dict[str, object]]:
    if str(path) == "-":
        data = json.loads(sys.stdin.read())
    elif path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return [dict(row) for row in csv.DictReader(handle)]
    if isinstance(data, dict):
        data = data.get("communities", data.get("rows", []))
    if not isinstance(data, list):
        raise ValueError("JSON input must be a list or contain a communities/rows list")
    return [dict(row) for row in data]


def write_rows(rows: list[dict[str, object]], output_format: str, output: str | None) -> None:
    if output_format == "json":
        content = json.dumps(rows, indent=2, ensure_ascii=False) + "\n"
        if output:
            Path(output).write_text(content, encoding="utf-8")
        else:
            sys.stdout.write(content)
        return
    fieldnames = list(dict.fromkeys(key for row in rows for key in row))
    handle = open(output, "w", encoding="utf-8", newline="") if output else sys.stdout
    try:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    finally:
        if output:
            handle.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify D&D communities for permissioned acquisition tests.")
    parser.add_argument("input", help="Input CSV/JSON path, or '-' for JSON from stdin")
    parser.add_argument("--format", choices=("csv", "json"), default="csv")
    parser.add_argument("--output")
    args = parser.parse_args()
    output = []
    for source_row in load_rows(Path(args.input)):
        row = dict(source_row)
        for legacy in ("community_score", "risk_level", "recommended_next_action"):
            row.pop(legacy, None)
        row.update(classify_community(row))
        output.append(row)
    write_rows(output, args.format, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
