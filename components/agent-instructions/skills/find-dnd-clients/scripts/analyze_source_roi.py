#!/usr/bin/env python3
"""Analyze explicit acquisition stages, retained seats, and Ben's time cost."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


YES = {"1", "true", "yes", "y"}
PERMISSION_VERIFIED = {"allowed", "verified", "current", "admin approved", "admin-approved"}
APPROVED = {"approved"}
REPLIED = {"replied", "positive", "negative", "qualified", "not_fit"}
CONVERSATION_STARTED = {"started", "active", "qualified", "not_fit", "completed"}
CONVERSATION_QUALIFIED = {"qualified", "fit", "completed_qualified"}
SESSION_ZERO_INVITED = {"invited", "booked", "completed", "declined", "no_show"}
SESSION_ZERO_BOOKED = {"booked", "completed", "no_show"}
SESSION_ZERO_COMPLETED = {"completed"}
PAID_SEAT = {"paid", "active", "joined", "booked"}


def norm(value: object) -> str:
    return str(value or "").strip()


def lowered(value: object) -> str:
    return norm(value).lower()


def explicit_yes(value: object) -> bool:
    return lowered(value) in YES


def number(value: object) -> float:
    try:
        return float(norm(value).replace("$", "").replace(",", ""))
    except ValueError:
        return 0.0


def load_rows(path: Path) -> list[dict[str, object]]:
    if str(path) == "-":
        data = json.loads(sys.stdin.read())
    elif path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return [dict(row) for row in csv.DictReader(handle)]
    if isinstance(data, dict):
        data = data.get("opportunities", data.get("rows", []))
    if not isinstance(data, list):
        raise ValueError("JSON input must be a list or contain an opportunities/rows list")
    return [dict(row) for row in data]


def source_key(row: dict[str, object], group_by: str) -> str:
    platform = norm(row.get("source_platform")) or "unknown platform"
    community = norm(row.get("community_name")) or "unknown community"
    campaign = norm(row.get("campaign_joined") or row.get("matched_campaign_name")) or "unmatched"
    if group_by == "source_platform":
        return platform
    if group_by == "community_name":
        return community
    if group_by == "matched_campaign_name":
        return campaign
    if group_by == "source_url":
        return norm(row.get("source_url")) or "unknown source"
    if group_by == "platform_campaign":
        return f"{platform} | {campaign}"
    return f"{platform} | {community}"


def rate(numerator: int, denominator: int) -> str:
    percent = 0.0 if not denominator else numerator / denominator * 100
    return f"{numerator}/{denominator} ({percent:.1f}%)"


def recommendation(bucket: dict[str, float]) -> str:
    contacted = int(bucket["contacted"])
    replied = int(bucket["replied"])
    qualified = int(bucket["owner_conversations_qualified"])
    paid = int(bucket["paid_seats"])
    retained = int(bucket["retained_4_weeks"])
    if contacted < 10:
        return "promising, insufficient evidence" if paid or retained else "insufficient evidence"
    if paid >= 2:
        return "evidence supports continued testing"
    if paid == 1:
        return "promising, insufficient evidence"
    if qualified >= 3:
        return "diagnose conversation-to-seat"
    if contacted >= 20 and (replied == 0 or qualified == 0):
        return "deprioritize"
    return "insufficient evidence"


def analyze(rows: list[dict[str, object]], group_by: str = "platform_community") -> list[dict[str, object]]:
    grouped: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    labels: dict[str, dict[str, str]] = {}
    for row in rows:
        key = source_key(row, group_by)
        labels.setdefault(
            key,
            {
                "source_platform": norm(row.get("source_platform")),
                "community_name": norm(row.get("community_name")),
                "matched_campaign_name": norm(row.get("campaign_joined") or row.get("matched_campaign_name")),
            },
        )
        bucket = grouped[key]
        bucket["opportunities"] += 1

        permission_verified = lowered(row.get("permission_state") or row.get("permission_status")) in PERMISSION_VERIFIED
        approved = lowered(row.get("approval_status")) in APPROVED
        contacted = bool(norm(row.get("contacted_at")))
        replied = lowered(row.get("reply_status")) in REPLIED
        conversation = lowered(row.get("owner_conversation_status"))
        session_zero = lowered(row.get("session_zero_status"))
        paid = lowered(row.get("paid_seat_status")) in PAID_SEAT or explicit_yes(row.get("paid_seat_booked"))
        retained = explicit_yes(row.get("retained_4_weeks"))

        bucket["permission_verified"] += permission_verified
        bucket["approved"] += approved
        bucket["contacted"] += contacted
        bucket["replied"] += replied
        bucket["owner_conversations_started"] += conversation in CONVERSATION_STARTED
        bucket["owner_conversations_qualified"] += conversation in CONVERSATION_QUALIFIED
        bucket["session_zero_invited"] += session_zero in SESSION_ZERO_INVITED
        bucket["session_zero_booked"] += session_zero in SESSION_ZERO_BOOKED
        bucket["session_zero_completed"] += session_zero in SESSION_ZERO_COMPLETED
        bucket["paid_seats"] += paid
        bucket["retained_4_weeks"] += retained
        bucket["total_deal_value"] += number(row.get("deal_value"))
        bucket["research_minutes"] += number(row.get("research_minutes"))
        bucket["review_minutes"] += number(row.get("review_minutes"))
        bucket["conversation_minutes"] += number(row.get("conversation_minutes"))

    report: list[dict[str, object]] = []
    for key, bucket in grouped.items():
        opportunities = int(bucket["opportunities"])
        permission_verified = int(bucket["permission_verified"])
        approved = int(bucket["approved"])
        contacted = int(bucket["contacted"])
        replied = int(bucket["replied"])
        conversations = int(bucket["owner_conversations_started"])
        qualified = int(bucket["owner_conversations_qualified"])
        invited = int(bucket["session_zero_invited"])
        booked = int(bucket["session_zero_booked"])
        completed = int(bucket["session_zero_completed"])
        paid = int(bucket["paid_seats"])
        retained = int(bucket["retained_4_weeks"])
        total_minutes = bucket["research_minutes"] + bucket["review_minutes"] + bucket["conversation_minutes"]
        report.append(
            {
                "group_by": group_by,
                "source_key": key,
                **labels[key],
                "opportunities": opportunities,
                "permission_verified": permission_verified,
                "approved": approved,
                "contacted": contacted,
                "replied": replied,
                "owner_conversations_started": conversations,
                "owner_conversations_qualified": qualified,
                "session_zero_invited": invited,
                "session_zero_booked": booked,
                "session_zero_completed": completed,
                "paid_seats": paid,
                "retained_4_weeks": retained,
                "total_deal_value": f"{bucket['total_deal_value']:.2f}",
                "ben_time_minutes": f"{total_minutes:.1f}",
                "permission_verification_rate": rate(permission_verified, opportunities),
                "approval_rate": rate(approved, permission_verified),
                "contact_rate": rate(contacted, approved),
                "reply_rate": rate(replied, contacted),
                "conversation_start_rate": rate(conversations, replied),
                "conversation_qualification_rate": rate(qualified, conversations),
                "session_zero_invite_rate": rate(invited, qualified),
                "session_zero_booking_rate": rate(booked, invited),
                "session_zero_completion_rate": rate(completed, booked),
                "paid_seat_rate": rate(paid, qualified),
                "retention_rate": rate(retained, paid),
                "recommended_action": recommendation(bucket),
            }
        )
    report.sort(key=lambda item: (-int(item["retained_4_weeks"]), -int(item["paid_seats"]), str(item["source_key"])))
    return report


def write_rows(rows: list[dict[str, object]], output_format: str, output: str | None) -> None:
    if output_format == "json":
        content = json.dumps(rows, indent=2, ensure_ascii=False) + "\n"
        if output:
            Path(output).write_text(content, encoding="utf-8")
        else:
            sys.stdout.write(content)
        return
    fieldnames = list(rows[0]) if rows else []
    handle = open(output, "w", encoding="utf-8", newline="") if output else sys.stdout
    try:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        if fieldnames:
            writer.writeheader()
            writer.writerows(rows)
    finally:
        if output:
            handle.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze explicit 20Fates acquisition stages and source ROI.")
    parser.add_argument("input", help="Acquisition CSV/JSON path, or '-' for JSON from stdin")
    parser.add_argument(
        "--group-by",
        choices=("source_platform", "community_name", "matched_campaign_name", "source_url", "platform_community", "platform_campaign"),
        default="platform_community",
    )
    parser.add_argument("--format", choices=("csv", "json"), default="csv")
    parser.add_argument("--output")
    args = parser.parse_args()
    write_rows(analyze(load_rows(Path(args.input)), args.group_by), args.format, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
