#!/usr/bin/env python3
"""Match qualified prospects to fresh, schedule-compatible 20Fates campaigns."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from refresh_20fates_offer import validate_snapshot
from score_leads import classify_lead, load_rows, norm


DEFAULT_CAMPAIGNS = Path(__file__).resolve().parent.parent / "assets" / "20fates-campaigns.json"
GENERAL_NAME = "Talk with Ben about fit"
GENERAL_URL = "https://20fates.com/"
MAX_CACHE_AGE_DAYS = 7
DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def load_offer(path: Path) -> dict[str, object]:
    data = json.loads(path.read_text(encoding="utf-8"))
    validate_snapshot(data, require_fetched_at=True)
    return data


def parse_timestamp(value: object) -> datetime | None:
    raw = norm(value)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)


def offer_cache_state(offer: dict[str, object], now: datetime | None = None) -> tuple[str, str]:
    try:
        validate_snapshot(offer, require_fetched_at=True)
    except ValueError as exc:
        return "invalid", str(exc)
    observed = parse_timestamp(offer.get("fetched_at"))
    if not observed:
        return "invalid", "offer cache has no valid fetched_at receipt"
    age = ((now or datetime.now(timezone.utc)) - observed).total_seconds() / 86400
    if age < -1:
        return "invalid", "offer cache fetched_at receipt is in the future"
    if age > MAX_CACHE_AGE_DAYS:
        return "stale", f"offer cache was fetched more than {MAX_CACHE_AGE_DAYS} days ago"
    return "fresh", "public-offer cache is current"


def lead_schedule_text(lead: dict[str, object]) -> str:
    return norm(lead.get("schedule_or_timezone")).lower()


def allowed_days(text: str) -> set[str]:
    days = {day for day in DAYS if re.search(rf"\b{day}s?\b", text)}
    if "weeknight" in text:
        days.update(DAYS[:5])
    if "weekend" in text:
        days.update(DAYS[5:])
    for day in tuple(days):
        if re.search(rf"(?:\bno\b|\bnot\b|except|cannot|can't|unavailable)[^.;,]{{0,30}}\b{day}s?\b", text):
            days.discard(day)
        if re.search(rf"\b{day}s?\b[^.;,]{{0,25}}(?:doesn't work|do not work|unavailable)", text):
            days.discard(day)
    return days


def hour_24(raw_hour: str, meridiem: str) -> int:
    hour = int(raw_hour) % 12
    return hour + (12 if meridiem.lower() == "pm" else 0)


def timezone_offset_to_central(text: str) -> int | None:
    """Return hours to add to a prospect's local time to get Central time."""
    zones = (
        (("eastern", " est", " edt", " et "), -1),
        (("central", " cst", " cdt", " ct ", "austin", "texas"), 0),
        (("mountain", " mst", " mdt", " mt "), 1),
        (("pacific", " pst", " pdt", " pt "), 2),
    )
    padded = f" {text.lower()} "
    for terms, offset in zones:
        if any(term in padded for term in terms):
            return offset
    return None


def campaign_day_hour(schedule: dict[str, object]) -> tuple[str, int] | None:
    day = norm(schedule.get("day")).lower()
    time = norm(schedule.get("time")).lower()
    if "/" in day or time == "multiple times":
        return None
    match = re.fullmatch(r"(\d{1,2}):\d{2}\s*(am|pm)", time)
    return (day, hour_24(match.group(1), match.group(2))) if day in DAYS and match else None


def time_is_compatible(text: str, campaign_hour: int) -> bool:
    offset = timezone_offset_to_central(text)
    if offset is None:
        return False
    local_campaign_hour = (campaign_hour - offset) % 24
    exact = re.findall(r"\b(\d{1,2})(?::\d{2})?\s*(am|pm)\b", text)
    after = re.search(r"(?:after|later than)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)", text)
    before = re.search(r"(?:before|earlier than)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)", text)
    if after and campaign_hour < (hour_24(after.group(1), after.group(2)) + offset) % 24:
        return False
    if before and campaign_hour > (hour_24(before.group(1), before.group(2)) + offset) % 24:
        return False
    if "morning" in text and local_campaign_hour >= 12:
        return False
    if "afternoon" in text and not 12 <= local_campaign_hour < 18:
        return False
    if "evening" in text and local_campaign_hour < 17:
        return False
    if exact and not after and not before:
        central_hours = {(hour_24(hour, meridiem) + offset) % 24 for hour, meridiem in exact}
        return campaign_hour in central_hours
    return True


def compatible_schedules(lead: dict[str, object], campaign: dict[str, object]) -> list[str]:
    text = lead_schedule_text(lead)
    days = allowed_days(text)
    if not text or not days:
        return []
    schedule = campaign.get("schedule")
    if not isinstance(schedule, dict):
        return []
    parsed = campaign_day_hour(schedule)
    if parsed and parsed[0] in days and time_is_compatible(text, parsed[1]):
        return [norm(schedule.get("label"))]
    return []


def explicit_interest(lead: dict[str, object], campaign: dict[str, object]) -> bool:
    explicit = " | ".join(
        norm(lead.get(field))
        for field in ("campaign_interest", "desired_campaign", "observed_evidence", "quoted_intent")
    ).lower()
    campaign_id = norm(campaign.get("id")).lower()
    name = norm(campaign.get("title")).lower()
    return bool(explicit and (campaign_id in explicit or name in explicit))


def general_match(reason: str, offer: dict[str, object], claims: str = "allowed") -> dict[str, object]:
    return {
        "matched_campaign_id": "",
        "matched_campaign_name": GENERAL_NAME,
        "matched_campaign_url": GENERAL_URL,
        "matched_schedule": "",
        "campaign_match_confidence": "general",
        "campaign_match_reason": reason,
        "campaign_availability": "",
        "campaign_price": "",
        "offer_claims_status": claims,
        "offer_cache_observed_at": norm(offer.get("fetched_at")),
    }


def match_lead(lead: dict[str, object], offer: dict[str, object], now: datetime | None = None) -> dict[str, object]:
    state, state_reason = offer_cache_state(offer, now)
    if state != "fresh":
        return general_match(f"No offer claims: {state_reason}.", offer, "blocked")

    status = norm(lead.get("qualification_status"))
    if not status:
        status = str(classify_lead(lead)["qualification_status"])
    if status in {"reject", "hold", "verify_age_or_guardian", "clarify_paid_openness"}:
        return general_match(f"No campaign claim while qualification status is {status}.", offer, "blocked")

    candidates: list[tuple[bool, dict[str, object], list[str]]] = []
    for campaign in offer["payload"]["offers"]:
        if campaign["status"] != "open":
            continue
        schedules = compatible_schedules(lead, campaign)
        if not schedules:
            continue
        interest = explicit_interest(lead, campaign)
        candidates.append((interest, campaign, schedules))

    if not candidates:
        return general_match("No current campaign has evidenced schedule compatibility; let Ben assess fit.", offer)

    interested = [candidate for candidate in candidates if candidate[0]]
    supported = interested or candidates
    if len(supported) != 1:
        return general_match("More than one current table fits the available evidence; let Ben assess fit.", offer)

    interest, campaign, schedules = supported[0]
    confidence = "high" if interest else "medium"
    reasons = [f"Schedule evidence matches {', '.join(schedules)}."]
    if interest:
        reasons.append("The prospect explicitly named this campaign.")
    return {
        "matched_campaign_id": norm(campaign.get("id")),
        "matched_campaign_name": norm(campaign.get("title")),
        "matched_campaign_url": norm(campaign.get("canonical_url")),
        "matched_schedule": " | ".join(schedules),
        "campaign_match_confidence": confidence,
        "campaign_match_reason": " ".join(reasons),
        "campaign_availability": norm(campaign.get("status")),
        "campaign_price": norm(campaign.get("price")),
        "offer_claims_status": "allowed",
        "offer_cache_observed_at": norm(offer.get("fetched_at")),
    }


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
    parser = argparse.ArgumentParser(description="Match qualified opportunities to current 20Fates campaigns.")
    parser.add_argument("input", help="Acquisition CSV/JSON path, or '-' for JSON from stdin")
    parser.add_argument("--campaigns", default=str(DEFAULT_CAMPAIGNS), help="Generated 20Fates offer cache")
    parser.add_argument("--format", choices=("csv", "json"), default="csv")
    parser.add_argument("--output")
    args = parser.parse_args()

    offer = load_offer(Path(args.campaigns))
    output = []
    for source_row in load_rows(Path(args.input)):
        row = dict(source_row)
        for legacy in ("campaign_match_score", "booking_url", "seat_angle", "likely_objection"):
            row.pop(legacy, None)
        row.update(match_lead(row, offer))
        output.append(row)
    write_rows(output, args.format, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
