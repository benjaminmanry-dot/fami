from __future__ import annotations

import json
import sys
import tempfile
import unittest
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPT_DIR = SKILL_DIR / "scripts"
FIXTURE = Path(__file__).parent / "fixtures" / "public-offer-v1.json"
sys.path.insert(0, str(SCRIPT_DIR))

from match_20fates_campaigns import match_lead  # noqa: E402
from refresh_20fates_offer import cache_snapshot, source_identity, validate_snapshot  # noqa: E402


class PublicOfferConsumerTests(unittest.TestCase):
    NOW = datetime(2026, 8, 16, 20, tzinfo=timezone.utc)

    def fixture(self) -> dict[str, object]:
        return json.loads(FIXTURE.read_text(encoding="utf-8"))

    def resign(self, snapshot: dict[str, object]) -> None:
        snapshot["source"]["identity"] = source_identity(snapshot["payload"]["offers"])

    def test_valid_live_shaped_v1_adds_only_consumer_receipt(self) -> None:
        snapshot = self.fixture()
        validate_snapshot(snapshot)
        with tempfile.TemporaryDirectory() as directory:
            cached = cache_snapshot(snapshot, Path(directory) / "offer.json", self.NOW)
        self.assertEqual(set(snapshot) | {"fetched_at"}, set(cached))
        for field in snapshot:
            self.assertEqual(snapshot[field], cached[field])
        self.assertEqual("2026-08-16T20:00:00Z", cached["fetched_at"])

    def test_unsupported_major_fails_closed(self) -> None:
        snapshot = self.fixture()
        snapshot["version"] = "public-offer/2"
        with self.assertRaisesRegex(ValueError, "version"):
            validate_snapshot(snapshot)

    def test_missing_or_invalid_envelope_and_payload_fail_closed(self) -> None:
        cases = []
        missing_owner = self.fixture()
        del missing_owner["owner"]
        cases.append(missing_owner)
        invalid_identity = self.fixture()
        invalid_identity["source"]["identity"] = "not-a-hash"
        cases.append(invalid_identity)
        invalid_payload = self.fixture()
        invalid_payload["payload"] = {"offers": "not-an-array"}
        cases.append(invalid_payload)
        missing_offer_field = self.fixture()
        del missing_offer_field["payload"]["offers"][0]["price"]
        cases.append(missing_offer_field)
        for snapshot in cases:
            with self.subTest(snapshot=snapshot):
                with self.assertRaises(ValueError):
                    validate_snapshot(snapshot)

    def test_withdrawn_or_contradictory_offer_fails_closed(self) -> None:
        withdrawn = self.fixture()
        withdrawn["freshness"]["offer_state"] = "withdrawn"
        contradictory = self.fixture()
        contradictory["payload"]["offers"][0]["open_seats"] = 0
        contradictory["payload"]["offers"][0]["has_open_seats"] = False
        self.resign(contradictory)
        for snapshot in (withdrawn, contradictory):
            with self.subTest(snapshot=snapshot):
                with self.assertRaises(ValueError):
                    validate_snapshot(snapshot)

    def test_validation_failure_preserves_existing_cache(self) -> None:
        snapshot = self.fixture()
        snapshot["freshness"]["offer_state"] = "withdrawn"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "offer.json"
            output.write_text("trusted previous cache", encoding="utf-8")
            with self.assertRaises(ValueError):
                cache_snapshot(snapshot, output, self.NOW)
            self.assertEqual("trusted previous cache", output.read_text(encoding="utf-8"))

    def test_epic_quests_aggregate_never_claims_an_open_table(self) -> None:
        snapshot = self.fixture()
        cached = dict(snapshot, fetched_at=self.NOW.isoformat().replace("+00:00", "Z"))
        result = match_lead(
            {
                "qualification_status": "handoff_ready",
                "campaign_interest": "Epic Quests",
                "schedule_or_timezone": "Thursday 9 PM Central",
            },
            cached,
            self.NOW,
        )
        self.assertEqual("Talk with Ben about fit", result["matched_campaign_name"])
        self.assertEqual("", result["matched_schedule"])

    def test_ambiguous_table_evidence_returns_manual_fit(self) -> None:
        snapshot = self.fixture()
        second = deepcopy(snapshot["payload"]["offers"][0])
        second.update(
            {
                "id": "late-table",
                "slug": "late-table",
                "title": "Late Table",
                "canonical_url": "https://20fates.com/campaigns/late-table/",
            }
        )
        second["schedule"] = {
            "day": "Saturday",
            "time": "9:00 PM",
            "time_zone": "America/Chicago",
            "label": "Saturday, 9:00 PM Central",
        }
        snapshot["payload"]["offers"].append(second)
        self.resign(snapshot)
        cached = dict(snapshot, fetched_at=self.NOW.isoformat().replace("+00:00", "Z"))
        result = match_lead(
            {"qualification_status": "handoff_ready", "schedule_or_timezone": "Saturdays Central"},
            cached,
            self.NOW,
        )
        self.assertEqual("Talk with Ben about fit", result["matched_campaign_name"])


if __name__ == "__main__":
    unittest.main()
