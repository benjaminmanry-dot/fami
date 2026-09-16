#!/usr/bin/env python3
"""Classify D&D prospects using observed evidence and explicit safety gates."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path


MINOR_TERMS = (
    "under 18",
    "minor only",
    "minors only",
    "minors-focused",
    "teen",
    "kid",
    "child",
    "children",
    "youth",
    "middle school",
    "high school",
)
ADULT_TERMS = ("adult", "adults", "18+", "21+", "over 18")
LEGAL_GUARDIAN_TERMS = ("legal guardian", "court-appointed guardian", "custodial parent", "parent and legal guardian")
PAID_POSITIVE_TERMS = (
    "paid dm",
    "paid dungeon master",
    "professional dm",
    "professional dungeon master",
    "hire a dm",
    "hire a dungeon master",
    "pay-to-play",
    "pay to play",
    "willing to pay",
    "open to paid",
    "paid is fine",
    "budget",
)
PAID_NEGATIVE_TERMS = (
    "free only",
    "unpaid only",
    "no paid",
    "not open to paid",
    "not willing to pay",
    "paid games forbidden",
    "no pay-to-play",
    "not looking for a paid game",
    "not looking for paid",
    "declined paid",
    "answered no when asked about paid",
    "not open to a paid",
    "excludes paid",
)
INTENT_TERMS = (
    "looking for a dm",
    "looking for dm",
    "looking for an experienced dm",
    "looking for a seasoned dm",
    "looking for a dungeon master",
    "need a dm",
    "needs a dm",
    "seeks a dm",
    "seeking a dm",
    "dm-for-hire",
    "hire a dm",
    "hire a dungeon master",
    "group needs",
    "someone to run",
    "dm wanted",
)
PERMISSION_ALLOWED_TERMS = (
    "allowed",
    "admin approved",
    "approved",
    "permission granted",
    "rules allow",
    "opt-in",
    "public reply",
    "dms open",
    "dm invited",
    "dm me",
    "message me",
    "email me",
    "text me",
    "call me",
    "contact invited",
)
COMMERCIAL_FORBIDDEN_TERMS = (
    "no solicitation",
    "no soliciting",
    "no advertising",
    "no promotion",
)
DM_FORBIDDEN_TERMS = ("do not dm", "no dms", "dms forbidden", "dm forbidden")
UNKNOWN_VALUES = {"", "unknown", "unclear", "n/a", "na", "not provided", "pending"}
AI_FORBIDDEN_TERMS = (
    "ai-generated content is not permitted",
    "ai generated content is not permitted",
    "ai-generated content prohibited",
    "ai generated content prohibited",
    "ai content forbidden",
)


def norm(value: object) -> str:
    return str(value or "").strip()


def contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def evidence_text(row: dict[str, object]) -> str:
    """Return observed prospect evidence only; never drafts, notes, or outcomes."""
    fields = (
        "observed_evidence",
        "public_evidence_summary",
        "quoted_intent",
        "quoted_public_intent_if_available",
        "audience_age_evidence",
        "paid_openness_evidence",
        "paid_openness",
        "desired_system",
        "desired_style",
        "player_count",
        "schedule_or_timezone",
    )
    return " | ".join(norm(row.get(field)) for field in fields).lower()


def stated_ages(text: str) -> list[int]:
    ages: set[int] = set()
    for first, second in re.findall(
        r"\bages?\s*(?:are|is|:)?\s*(\d{1,2})(?:\s*(?:-|to|and|,)\s*(\d{1,2}))?",
        text,
    ):
        ages.add(int(first))
        if second:
            ages.add(int(second))
    ages.update(int(value) for value in re.findall(r"\b(\d{1,2})\s*(?:-?years?[- ]old|y/?o)\b", text))
    ages.update(
        int(value)
        for value in re.findall(
            r"\b(?:player|players|participant|son|daughter|child)\s+(?:is|are|aged?)\s*(\d{1,2})\b",
            text,
        )
    )
    ages.update(
        int(value)
        for value in re.findall(
            r"\b(?:prospect|player|participant)\s+says?\s+(?:he|she|they)\s+(?:is|are)\s+(\d{1,2})\b",
            text,
        )
    )
    if re.fullmatch(r"\s*\d{1,2}(?:\s*[-,]\s*\d{1,2})*\s*", text):
        ages.update(int(value) for value in re.findall(r"\d{1,2}", text))
    return sorted(ages)


def parse_date(value: object) -> date | None:
    raw = norm(value)
    if raw.lower() in UNKNOWN_VALUES:
        return None
    candidate = raw[:10]
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(candidate, fmt).date()
        except ValueError:
            continue
    return None


def lead_age_days(row: dict[str, object], today: date | None = None) -> int | None:
    raw = norm(row.get("lead_age_days") or row.get("age_days"))
    if raw.lower() not in UNKNOWN_VALUES:
        try:
            return max(0, int(float(raw)))
        except ValueError:
            pass
    posted = parse_date(row.get("posted_at") or row.get("posted_date") or row.get("post_date"))
    if not posted:
        return None
    observed = parse_date(row.get("observed_at") or row.get("observed_date")) or today or date.today()
    return max(0, (observed - posted).days)


def recency_bucket(age_days: int | None) -> str:
    if age_days is None:
        return "unknown"
    if age_days <= 3:
        return "fresh"
    if age_days <= 7:
        return "current"
    if age_days <= 21:
        return "aging"
    return "stale"


def audience_age_state(row: dict[str, object]) -> str:
    """Classify age evidence without inferring adulthood from platform context."""
    age_text = " | ".join(
        norm(row.get(field))
        for field in ("audience_age_evidence", "observed_evidence", "public_evidence_summary")
    ).lower()
    age_field = norm(row.get("audience_age_evidence")).lower()
    ages = stated_ages(age_field)
    explicit_minor = (
        contains_any(age_text, MINOR_TERMS)
        or any(age < 18 for age in ages)
        or bool(re.search(r"\b(?:1[0-7]|[1-9])[- ]year[- ]old\b", age_text))
    )
    if explicit_minor:
        guardian_evidence = norm(row.get("guardian_evidence")).lower()
        guardian_route = norm(row.get("guardian_contact_route"))
        if contains_any(guardian_evidence, LEGAL_GUARDIAN_TERMS) and guardian_route:
            return "guardian_managed_minor"
        return "explicit_minor"
    if contains_any(age_text, ADULT_TERMS) or (ages and min(ages) >= 18):
        return "adult_confirmed"
    return "unknown"


def permission_state(row: dict[str, object], today: date | None = None) -> tuple[str, str]:
    expiry = parse_date(row.get("permission_expires_at") or row.get("expires_at"))
    if expiry and expiry < (today or date.today()):
        return "expired", "permission evidence has expired"

    evidence = " | ".join(norm(row.get(field)) for field in ("permission_evidence", "contact_permission_evidence")).lower()
    permission_status = norm(row.get("permission_status")).lower()
    paid_status = norm(row.get("paid_posts_status")).lower()
    admin_status = norm(row.get("admin_permission_status")).lower()
    dm_policy = " | ".join(norm(row.get(field)) for field in ("dm_policy", "DM_policy")).lower()
    rules_status = norm(row.get("rules_status")).lower()
    route = norm(row.get("contact_route")).lower()
    text = " | ".join((evidence, permission_status, paid_status, admin_status, dm_policy, rules_status))

    broad_forbidden = (
        permission_status in {"forbidden", "denied", "prohibited", "not allowed"}
        or
        paid_status in {"forbidden", "prohibited", "not allowed"}
        or admin_status in {"denied", "forbidden"}
        or contains_any(" | ".join((evidence, rules_status)), COMMERCIAL_FORBIDDEN_TERMS)
    )
    dm_route = any(term in route for term in ("dm", "direct message", "private message"))
    if broad_forbidden or (dm_route and contains_any(" | ".join((evidence, dm_policy)), DM_FORBIDDEN_TERMS)):
        return "forbidden", "commercial contact is prohibited"
    if not evidence:
        return "unknown", "commercial/contact permission is not evidenced"
    public_reply = any(term in route for term in ("public reply", "forum reply", "comment"))
    public_reply_allowed = contains_any(evidence, ("public reply", "reply allowed", "comment allowed", "specific thread"))
    if public_reply and public_reply_allowed:
        return "allowed", "the recorded public reply route is allowed"
    if contains_any(text, PERMISSION_ALLOWED_TERMS):
        return "allowed", "an allowed contact route is evidenced"
    return "unknown", "commercial/contact permission is unclear"


def paid_state(row: dict[str, object], text: str) -> str:
    paid_text = " | ".join(
        norm(row.get(field))
        for field in (
            "paid_openness_evidence",
            "paid_openness",
            "observed_evidence",
            "public_evidence_summary",
            "quoted_intent",
            "quoted_public_intent_if_available",
        )
    ).lower()
    if contains_any(paid_text, PAID_NEGATIVE_TERMS):
        return "not_open"
    if paid_text in {"yes", "true", "open", "explicit"} or contains_any(paid_text, PAID_POSITIVE_TERMS):
        return "open"
    return "unknown"


def ai_content_state(row: dict[str, object]) -> tuple[str, str]:
    """Return whether this skill may create text intended for the source/prospect."""
    policy = norm(row.get("ai_content_policy")).lower()
    evidence = norm(row.get("ai_content_evidence")).lower()
    observed = " | ".join(
        norm(row.get(field))
        for field in ("observed_evidence", "public_evidence_summary", "quoted_intent")
    ).lower()
    observed_no_ai = bool(re.search(r"(?:^|[\s\[(])no\s+a\.?i\.?(?:$|[\s\]).,!;:])", observed))
    if policy in {"forbidden", "prohibited", "not allowed", "manual only", "manual-only", "no ai", "no-ai"} or contains_any(
        " | ".join((policy, evidence)), AI_FORBIDDEN_TERMS
    ) or observed_no_ai:
        return "manual_only", "source or prospect prohibits AI-generated content; this skill cannot draft outreach"
    if policy in {"allowed", "not restricted", "not_restricted", "not stated", "not_stated"} and evidence:
        return "permitted", "current rules evidence records no applicable AI-content restriction"
    return "unknown", "AI-content policy is not evidenced"


def hard_disqualifiers(row: dict[str, object], today: date | None = None) -> list[str]:
    text = evidence_text(row)
    reasons: list[str] = []
    if audience_age_state(row) == "explicit_minor":
        reasons.append("explicit minor without an evidenced legal guardian managing contact")
    if paid_state(row, text) == "not_open":
        reasons.append("prospect or source excludes paid games")
    permission, _ = permission_state(row, today)
    if permission == "forbidden":
        reasons.append("commercial contact is forbidden")
    if contains_any(text, ("scraped private", "unauthorized private", "private member list", "private email")):
        reasons.append("private data lacks legitimate access")
    if contains_any(text, ("fake group", "spammy", "inactive group", "hostile to paid")):
        reasons.append("source is inactive, fake, spammy, or hostile")
    return list(dict.fromkeys(reasons))


def classify_lead(row: dict[str, object], today: date | None = None) -> dict[str, object]:
    """Return deterministic gates, priority, and handoff route for one opportunity."""
    text = evidence_text(row)
    age_days = lead_age_days(row, today)
    disqualifiers = hard_disqualifiers(row, today)
    permission, permission_reason = permission_state(row, today)
    ai_state, ai_reason = ai_content_state(row)
    age_state = audience_age_state(row)
    paid = paid_state(row, text)
    route = norm(row.get("contact_route"))
    blockers: list[str] = []

    if age_days is None:
        blockers.append("posting age is unknown")
    elif age_days > 21:
        blockers.append("opportunity is older than 21 days")
    if permission != "allowed":
        blockers.append(permission_reason)
    if ai_state == "unknown":
        blockers.append(ai_reason)
    if not route:
        blockers.append("no permitted contact route is recorded")

    has_intent = contains_any(text, INTENT_TERMS)
    if disqualifiers:
        status, priority, handoff = "reject", "none", "none"
    elif blockers:
        status, priority, handoff = "hold", "none", "none"
    elif age_state == "unknown":
        status, priority, handoff = "verify_age_or_guardian", "medium", "verify_age_or_guardian"
    elif paid == "unknown":
        status, priority, handoff = "clarify_paid_openness", "medium", "clarify_paid_openness"
    elif has_intent:
        status, handoff = "handoff_ready", "direct_owner_conversation"
        priority = "high" if age_days is not None and age_days <= 3 else "medium"
    else:
        status, priority, handoff = "review", "low", "website_first"

    return {
        "qualification_status": status,
        "priority": priority,
        "handoff_route": handoff,
        "lead_age_days": "" if age_days is None else age_days,
        "recency_bucket": recency_bucket(age_days),
        "paid_openness_state": paid,
        "permission_state": permission,
        "ai_content_state": ai_state,
        "audience_age_state": age_state,
        "contact_audience": {
            "adult_confirmed": "adult_prospect",
            "guardian_managed_minor": "guardian_only",
            "unknown": "age_verification_only",
        }.get(age_state, "none"),
        "outreach_generation_allowed": ai_state == "permitted",
        "hard_disqualifiers": "; ".join(disqualifiers),
        "qualification_blockers": "; ".join(dict.fromkeys(blockers)),
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
        data = data.get("opportunities", data.get("leads", data.get("rows", [])))
    if not isinstance(data, list):
        raise ValueError("JSON input must be a list or contain an opportunities/leads/rows list")
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
    parser = argparse.ArgumentParser(description="Classify D&D acquisition opportunities from CSV or JSON.")
    parser.add_argument("input", help="Input CSV/JSON path, or '-' for JSON from stdin")
    parser.add_argument("--format", choices=("csv", "json"), default="csv")
    parser.add_argument("--output")
    args = parser.parse_args()

    output: list[dict[str, object]] = []
    for source_row in load_rows(Path(args.input)):
        row = dict(source_row)
        for legacy in ("lead_score", "recommendation", "score_breakdown"):
            row.pop(legacy, None)
        row.update(classify_lead(row))
        output.append(row)
    write_rows(output, args.format, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
