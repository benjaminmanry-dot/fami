#!/usr/bin/env python3
"""Merge current source-policy memory into a source-access tracker."""

from __future__ import annotations

import argparse
import csv
from datetime import date, datetime
from pathlib import Path


def norm(value: object) -> str:
    return str(value or "").strip()


def lowered(value: object) -> str:
    return norm(value).lower()


def parse_date(value: object) -> date | None:
    raw = norm(value)[:10]
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def key_for(row: dict[str, str]) -> str:
    if lowered(row.get("source_id")):
        return f"id:{lowered(row.get('source_id'))}"
    url = lowered(row.get("source_url") or row.get("url")).rstrip("/")
    if url:
        return f"url:{url}"
    platform = lowered(row.get("source_platform") or row.get("platform"))
    name = lowered(row.get("community_name") or row.get("source_name"))
    return f"name:{platform}::{name}"


def memory_action(memory: dict[str, str], today: date | None = None) -> tuple[str, str, str]:
    expiry = parse_date(memory.get("expires_at"))
    if expiry and expiry < (today or date.today()):
        return "rules-expired", "re-audit rules before outreach", "Stored permission has expired."
    paid = lowered(memory.get("paid_posts_status"))
    dm = lowered(memory.get("dm_policy"))
    ai_policy = lowered(memory.get("ai_content_policy"))
    ai_evidence = norm(memory.get("ai_content_evidence"))
    admin = lowered(memory.get("admin_permission_status"))
    channel = norm(memory.get("approved_channels") or memory.get("approved_contact_route"))
    channel_is_dm = any(term in channel.lower() for term in ("dm", "direct message", "private message"))
    if paid == "forbidden" or admin == "denied" or (dm == "forbidden" and (not channel or channel_is_dm)):
        return "rejected", "skip", "Rules memory prohibits paid outreach or direct contact."
    manual_only = ai_policy in {"forbidden", "prohibited", "not allowed", "manual only", "manual-only"}
    if not manual_only and (
        ai_policy not in {"allowed", "not restricted", "not_restricted", "not stated", "not_stated"} or not ai_evidence
    ):
        return "audit-rules", "verify AI-content policy before outreach", "AI-content policy is not currently evidenced."
    route_allowed = dm in {"allowed", "opt-in-only", "unclear", ""} or (
        dm == "forbidden" and bool(channel) and not channel_is_dm
    )
    if paid in {"allowed", "allowed-specific-thread"} and route_allowed:
        action = f"use approved route: {channel}" if channel else "use permissioned route"
        note = "Rules memory contains a current allowed route."
        if manual_only:
            action += "; manual-only outreach"
            note += " Ben must write independently without AI-generated language or artifacts."
        return "rules-memory-applied", action, note
    if paid == "admin-approval-required" or dm == "admin-approval-required" or admin in {"requested", "unclear", ""}:
        return "admin-first", "ask admin before outreach", "Admin approval is required or not yet evidenced."
    return "audit-rules", "verify rules before outreach", "Rules memory is not outreach-ready."


def merge_row(source: dict[str, str], memory: dict[str, str], today: date | None = None) -> dict[str, str]:
    merged = dict(source)
    status, next_action, note = memory_action(memory, today)
    mapping = {
        "rules_status": "rules_status",
        "paid_policy": "paid_posts_status",
        "dm_policy": "dm_policy",
        "ai_content_policy": "ai_content_policy",
        "ai_content_evidence": "ai_content_evidence",
        "approved_channels": "approved_channels",
        "admin_contact_path": "approved_contact_route",
        "observed_at": "last_checked",
        "permission_expires_at": "expires_at",
    }
    for target, source_field in mapping.items():
        if norm(memory.get(source_field)):
            merged[target] = norm(memory.get(source_field))
    merged["access_status"] = status
    merged["next_action"] = next_action
    evidence = norm(memory.get("approval_evidence_summary"))
    additions = ["Rules memory applied.", note]
    if evidence:
        additions.append(f"Evidence: {evidence}")
    merged["notes"] = " ".join(part for part in [norm(merged.get("notes")), *additions] if part)
    return merged


def merge_sources(sources: list[dict[str, str]], memory_rows: list[dict[str, str]], today: date | None = None) -> list[dict[str, str]]:
    memory_by_key = {key_for(row): row for row in memory_rows if key_for(row) != "name:::"}
    output = []
    for source in sources:
        memory = memory_by_key.get(key_for(source))
        if not memory and lowered(source.get("url")):
            memory = memory_by_key.get(f"url:{lowered(source.get('url')).rstrip('/')}")
        output.append(merge_row(source, memory, today) if memory else dict(source))
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply current source rules memory to a source-access tracker.")
    parser.add_argument("source_tracker")
    parser.add_argument("rules_memory")
    parser.add_argument("--output", help="Defaults to overwriting source_tracker")
    args = parser.parse_args()

    source_path = Path(args.source_tracker)
    sources = load_csv(source_path)
    if not sources:
        raise SystemExit("No source tracker rows found.")
    merged = merge_sources(sources, load_csv(Path(args.rules_memory)))
    fieldnames = list(dict.fromkeys(key for row in merged for key in row))
    output = Path(args.output) if args.output else source_path
    write_csv(output, merged, fieldnames)
    print(output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
