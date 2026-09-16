#!/usr/bin/env python3
"""Refresh the local cache from the versioned public 20Fates offer snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


PUBLIC_OFFER_URL = "https://20fates.com/campaign-offers.v1.json"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "assets" / "20fates-campaigns.json"
MAX_DOCUMENT_BYTES = 1_000_000
CONTRACT = "public-offer-snapshot"
VERSION = "public-offer/1"
OWNER = "20fates-website"
SITE_ORIGIN = "https://20fates.com"
TIME_ZONE = "America/Chicago"
DAYS = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}
PRICE_PATTERN = re.compile(r"^\$(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?/(?:hour|week)$")
KEBAB_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TIME_PATTERN = re.compile(r"^(?:1[0-2]|[1-9]):[0-5][0-9] (?:AM|PM)$")
CONTROL_PATTERN = re.compile(r"[\x00-\x1f\x7f]")


def _exact_object(value: object, field: str, keys: tuple[str, ...]) -> dict[str, object]:
    if type(value) is not dict:
        raise ValueError(f"{field} must be an object")
    if set(value) != set(keys):
        raise ValueError(f"{field} must contain exactly {', '.join(keys)}")
    return value


def _required_string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(f"{field} must be a non-empty trimmed string")
    if len(value) > 500 or CONTROL_PATTERN.search(value):
        raise ValueError(f"{field} must be a short single-line string")
    return value


def _parse_timestamp(value: object, field: str) -> datetime:
    raw = _required_string(value, field)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ValueError(f"{field} must identify UTC")
    return parsed.astimezone(timezone.utc)


def source_identity(offers: object) -> str:
    encoded = json.dumps(offers, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _validate_offer(offer: object, index: int) -> tuple[str, str]:
    at = f"payload.offers[{index}]"
    item = _exact_object(
        offer,
        at,
        ("id", "slug", "title", "status", "open_seats", "has_open_seats", "schedule", "price", "canonical_url"),
    )
    offer_id = _required_string(item["id"], f"{at}.id")
    slug = _required_string(item["slug"], f"{at}.slug")
    title = _required_string(item["title"], f"{at}.title")
    status = _required_string(item["status"], f"{at}.status")
    if not KEBAB_PATTERN.fullmatch(offer_id) or not KEBAB_PATTERN.fullmatch(slug):
        raise ValueError(f"{at}.id and slug must be lowercase kebab-case")
    if status not in {"open", "full"}:
        raise ValueError(f"{at}.status must be open or full for {VERSION}")

    seats = item["open_seats"]
    has_seats = item["has_open_seats"]
    if type(seats) is not int or seats < 0 or type(has_seats) is not bool:
        raise ValueError(f"{at} must contain a non-negative integer seat count and boolean seat signal")
    if has_seats != (seats > 0) or (status == "open") != has_seats:
        raise ValueError(f"{at} has contradictory status, open_seats, and has_open_seats")

    schedule = _exact_object(item["schedule"], f"{at}.schedule", ("day", "time", "time_zone", "label"))
    day = _required_string(schedule["day"], f"{at}.schedule.day")
    time = _required_string(schedule["time"], f"{at}.schedule.time")
    zone = _required_string(schedule["time_zone"], f"{at}.schedule.time_zone")
    label = _required_string(schedule["label"], f"{at}.schedule.label")
    if zone != TIME_ZONE:
        raise ValueError(f"{at}.schedule.time_zone must be {TIME_ZONE}")
    aggregate_days = [part.strip() for part in day.split("/")] if "/" in day else []
    if aggregate_days:
        if time != "Multiple times" or len(aggregate_days) < 2 or any(part not in DAYS for part in aggregate_days):
            raise ValueError(f"{at}.schedule is an invalid multi-table aggregate")
        if any(part not in label for part in aggregate_days) or not label.endswith(" Central"):
            raise ValueError(f"{at}.schedule.label contradicts its aggregate schedule")
    elif day not in DAYS or not TIME_PATTERN.fullmatch(time) or label != f"{day}, {time} Central":
        raise ValueError(f"{at}.schedule fields contradict one another")
    if offer_id == "epic-quests" and not aggregate_days:
        raise ValueError("Epic Quests must remain a multi-table aggregate in public-offer/1")

    price = _required_string(item["price"], f"{at}.price")
    url = _required_string(item["canonical_url"], f"{at}.canonical_url")
    if not PRICE_PATTERN.fullmatch(price):
        raise ValueError(f"{at}.price is not a supported public price")
    if url != f"{SITE_ORIGIN}/campaigns/{slug}/":
        raise ValueError(f"{at}.canonical_url contradicts its slug")
    return offer_id, title


def validate_snapshot(snapshot: object, *, require_fetched_at: bool = False) -> dict[str, object]:
    keys = ("contract", "version", "owner", "source", "freshness", "visibility", "payload")
    if require_fetched_at:
        keys += ("fetched_at",)
    document = _exact_object(snapshot, "envelope", keys)
    if document["contract"] != CONTRACT:
        raise ValueError(f"contract must be {CONTRACT}")
    if document["version"] != VERSION:
        raise ValueError(f"version must be {VERSION}")
    if document["owner"] != OWNER:
        raise ValueError(f"owner must be {OWNER}")
    if document["visibility"] != "public":
        raise ValueError("visibility must be public")

    source = _exact_object(document["source"], "source", ("identity",))
    identity = _required_string(source["identity"], "source.identity")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", identity):
        raise ValueError("source.identity must be a deterministic SHA-256 identity")

    freshness = _exact_object(
        document["freshness"],
        "freshness",
        ("source_identity", "offer_state", "consumer_observation"),
    )
    if freshness["source_identity"] != "source.identity":
        raise ValueError("freshness.source_identity must reference source.identity")
    if freshness["offer_state"] != "current":
        raise ValueError("freshness.offer_state is not current; current offer claims are withdrawn")
    if freshness["consumer_observation"] != "fetched_at":
        raise ValueError("freshness.consumer_observation must assign fetched_at to the consumer")

    payload = _exact_object(document["payload"], "payload", ("offers",))
    offers = payload["offers"]
    if not isinstance(offers, list) or not offers:
        raise ValueError("payload.offers must be a non-empty array")
    identities = [_validate_offer(offer, index) for index, offer in enumerate(offers)]
    if len({item[0] for item in identities}) != len(identities):
        raise ValueError("payload offers contain duplicate stable IDs")
    if len({item[1] for item in identities}) != len(identities):
        raise ValueError("payload offers contain duplicate titles")
    if identity != source_identity(offers):
        raise ValueError("source.identity does not match payload.offers")
    if require_fetched_at:
        _parse_timestamp(document["fetched_at"], "fetched_at")
    return document


def _no_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_snapshot(raw: bytes) -> dict[str, object]:
    if len(raw) > MAX_DOCUMENT_BYTES:
        raise ValueError("public offer snapshot exceeds the size limit")
    try:
        snapshot = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("public offer snapshot is not valid UTF-8 JSON") from exc
    return validate_snapshot(snapshot)


def fetch_snapshot() -> dict[str, object]:
    request = Request(PUBLIC_OFFER_URL, headers={"Accept": "application/json", "User-Agent": "20Fates-Growth-Desk/1.0"})
    with urlopen(request, timeout=20) as response:
        if response.headers.get_content_type() != "application/json":
            raise ValueError("public offer endpoint did not return application/json")
        return parse_snapshot(response.read(MAX_DOCUMENT_BYTES + 1))


def cache_snapshot(
    snapshot: dict[str, object],
    output: Path,
    fetched_at: datetime | None = None,
) -> dict[str, object]:
    validate_snapshot(snapshot)
    stamp = (fetched_at or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
    cached = {**snapshot, "fetched_at": stamp.isoformat().replace("+00:00", "Z")}
    validate_snapshot(cached, require_fetched_at=True)
    content = json.dumps(cached, indent=2, ensure_ascii=False) + "\n"

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", newline="\n", dir=output.parent, prefix=f".{output.name}.", suffix=".tmp", delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return cached


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh the generated 20Fates public-offer cache.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    try:
        cache_snapshot(fetch_snapshot(), Path(args.output))
    except (OSError, ValueError) as exc:
        parser.exit(1, f"Offer cache not updated: {exc}\n")
    print(Path(args.output).resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
