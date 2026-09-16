from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPT_DIR = SKILL_DIR / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from analyze_source_roi import analyze  # noqa: E402
from generate_crm_csv import (  # noqa: E402
    ACQUISITION_FIELDS,
    COMMUNITY_FIELDS,
    SOURCE_ACCESS_FIELDS,
    SOURCE_ROI_FIELDS,
    SOURCE_RULES_MEMORY_FIELDS,
    TRACKERS,
)
from match_20fates_campaigns import match_lead  # noqa: E402
from merge_rules_memory import memory_action  # noqa: E402
from refresh_20fates_offer import source_identity  # noqa: E402
from score_communities import classify_community  # noqa: E402
from score_leads import classify_lead  # noqa: E402


def run_cli(script: str, *args: str, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run(
        [sys.executable, str(SCRIPT_DIR / script), *args],
        input=input_text,
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )


class QualificationTests(unittest.TestCase):
    def base_row(self) -> dict[str, object]:
        return {
            "observed_evidence": "Adult group looking for a DM for a weekly D&D campaign.",
            "quoted_intent": "We need a DM and are open to a paid professional game.",
            "audience_age_evidence": "All players are adults, ages 28-41.",
            "paid_openness_evidence": "Explicitly open to a paid DM.",
            "permission_status": "allowed",
            "permission_evidence": "Rules allow one reply to active LFG posts.",
            "ai_content_policy": "not stated",
            "ai_content_evidence": "Current rules were checked; no AI-content restriction is stated.",
            "contact_route": "public reply",
            "lead_age_days": "1",
            "schedule_or_timezone": "Saturday evenings Central",
        }

    def test_explicit_adult_paid_opportunity_is_handoff_ready(self) -> None:
        result = classify_lead(self.base_row())
        self.assertEqual("handoff_ready", result["qualification_status"])
        self.assertEqual("direct_owner_conversation", result["handoff_route"])
        self.assertEqual("high", result["priority"])

    def test_modified_dm_request_still_counts_as_direct_intent(self) -> None:
        row = self.base_row()
        row["observed_evidence"] = "Adult group looking for an experienced DM for weekly D&D."
        row["quoted_intent"] = ""
        result = classify_lead(row)
        self.assertEqual("handoff_ready", result["qualification_status"])

    def test_generated_fields_cannot_change_qualification(self) -> None:
        row = self.base_row()
        row["paid_openness_evidence"] = "unknown"
        row["quoted_intent"] = "We need a DM."
        clean = classify_lead(row)
        contaminated = deepcopy(row)
        contaminated.update(
            {
                "outreach_draft": "I run a paid professional campaign and have seats open.",
                "notes": "Strong paid lead; direct owner call.",
                "next_action": "Book voice call",
                "paid_seat_status": "paid",
            }
        )
        self.assertEqual(clean, classify_lead(contaminated))
        self.assertEqual("clarify_paid_openness", clean["qualification_status"])

    def test_explicit_minor_without_guardian_is_rejected(self) -> None:
        row = self.base_row()
        row["observed_evidence"] = "A 15-year-old player is looking for a reliable paid DM."
        row["audience_age_evidence"] = "The player is 15; no guardian involvement is stated."
        result = classify_lead(row)
        self.assertEqual("reject", result["qualification_status"])
        self.assertIn("minor", str(result["hard_disqualifiers"]))

    def test_legal_guardian_managed_minor_is_eligible(self) -> None:
        row = self.base_row()
        row["observed_evidence"] = "A parent is looking for a reliable paid DM for their 15-year-old."
        row["audience_age_evidence"] = "The player is 15."
        row["guardian_evidence"] = "The adult legal guardian is the prospect and manages all communication."
        row["guardian_contact_route"] = "Public reply to the legal guardian."
        result = classify_lead(row)
        self.assertEqual("handoff_ready", result["qualification_status"])
        self.assertEqual("guardian_managed_minor", result["audience_age_state"])
        self.assertEqual("guardian_only", result["contact_audience"])

    def test_guardian_claim_without_guardian_route_is_rejected(self) -> None:
        row = self.base_row()
        row["observed_evidence"] = "A parent is looking for a paid DM for their 15-year-old."
        row["audience_age_evidence"] = "The player is 15."
        row["guardian_evidence"] = "The adult legal guardian manages communication."
        result = classify_lead(row)
        self.assertEqual("reject", result["qualification_status"])

    def test_parent_label_does_not_infer_legal_guardianship(self) -> None:
        row = self.base_row()
        row["observed_evidence"] = "A parent is looking for a paid DM for their 15-year-old."
        row["audience_age_evidence"] = "The player is 15."
        row["guardian_evidence"] = "An adult parent authored the post."
        row["guardian_contact_route"] = "Public reply to the parent."
        self.assertEqual("reject", classify_lead(row)["qualification_status"])

    def test_plain_language_paid_decline_is_rejected(self) -> None:
        row = self.base_row()
        row["quoted_intent"] = "No."
        row["paid_openness_evidence"] = "Explicitly answered no when asked about paid games."
        self.assertEqual("reject", classify_lead(row)["qualification_status"])

    def test_unknown_age_is_retained_for_verification(self) -> None:
        row = self.base_row()
        row["audience_age_evidence"] = "Age is not stated; the post describes a group of 4 players."
        row["observed_evidence"] = "Group looking for a DM."
        result = classify_lead(row)
        self.assertEqual("verify_age_or_guardian", result["qualification_status"])
        self.assertEqual("verify_age_or_guardian", result["handoff_route"])
        self.assertEqual("unknown", result["audience_age_state"])
        self.assertEqual("age_verification_only", result["contact_audience"])
        self.assertEqual("", result["hard_disqualifiers"])

    def test_unknown_age_no_ai_signal_is_retained_without_a_draft(self) -> None:
        row = self.base_row()
        row["observed_evidence"] = "Group looking for a paid DM. No AI."
        row["audience_age_evidence"] = "Age is not stated in the current public post."
        result = classify_lead(row)
        self.assertEqual("verify_age_or_guardian", result["qualification_status"])
        self.assertEqual("manual_only", result["ai_content_state"])
        self.assertFalse(result["outreach_generation_allowed"])

    def test_plain_language_adult_age_is_detected(self) -> None:
        row = self.base_row()
        row["audience_age_evidence"] = "The prospect says they are 18 and turning 19 soon."
        self.assertEqual("adult_confirmed", classify_lead(row)["audience_age_state"])

    def test_unknown_permission_holds(self) -> None:
        row = self.base_row()
        row["permission_status"] = "unclear"
        row["permission_evidence"] = ""
        self.assertEqual("hold", classify_lead(row)["qualification_status"])

    def test_no_dms_does_not_block_an_allowed_public_reply(self) -> None:
        row = self.base_row()
        row["permission_evidence"] = "Public replies are allowed; unsolicited DMs are forbidden."
        row["dm_policy"] = "DMs forbidden"
        row["contact_route"] = "public reply"
        self.assertEqual("handoff_ready", classify_lead(row)["qualification_status"])
        row["contact_route"] = "direct message"
        self.assertEqual("reject", classify_lead(row)["qualification_status"])

    def test_ai_content_prohibition_stops_before_drafting(self) -> None:
        row = self.base_row()
        row["ai_content_policy"] = "forbidden"
        row["ai_content_evidence"] = "Site rules: AI-generated content is not permitted."
        result = classify_lead(row)
        self.assertEqual("handoff_ready", result["qualification_status"])
        self.assertEqual("manual_only", result["ai_content_state"])
        self.assertEqual("direct_owner_conversation", result["handoff_route"])
        self.assertFalse(result["outreach_generation_allowed"])
        self.assertNotIn("cannot draft outreach", result["qualification_blockers"])

    def test_prospect_no_ai_request_overrides_source_policy(self) -> None:
        row = self.base_row()
        row["observed_evidence"] = "Adult group looking for a paid DM. No AI."
        result = classify_lead(row)
        self.assertEqual("handoff_ready", result["qualification_status"])
        self.assertEqual("manual_only", result["ai_content_state"])
        self.assertFalse(result["outreach_generation_allowed"])


class OfferAndMatchingTests(unittest.TestCase):
    NOW = datetime(2026, 8, 12, 12, tzinfo=timezone.utc)

    def offer(self, fetched_at: datetime | None = None) -> dict[str, object]:
        stamp = fetched_at or self.NOW
        offers = [
            {
                "id": "open-table",
                "slug": "open-table",
                "title": "Open Table",
                "status": "open",
                "open_seats": 2,
                "has_open_seats": True,
                "schedule": {
                    "day": "Saturday",
                    "time": "4:00 PM",
                    "time_zone": "America/Chicago",
                    "label": "Saturday, 4:00 PM Central",
                },
                "price": "$40/week",
                "canonical_url": "https://20fates.com/campaigns/open-table/",
            },
            {
                "id": "full-table",
                "slug": "full-table",
                "title": "Full Table",
                "status": "full",
                "open_seats": 0,
                "has_open_seats": False,
                "schedule": {
                    "day": "Saturday",
                    "time": "9:00 PM",
                    "time_zone": "America/Chicago",
                    "label": "Saturday, 9:00 PM Central",
                },
                "price": "$40/week",
                "canonical_url": "https://20fates.com/campaigns/full-table/",
            },
        ]
        return {
            "contract": "public-offer-snapshot",
            "version": "public-offer/1",
            "owner": "20fates-website",
            "source": {"identity": source_identity(offers)},
            "freshness": {
                "source_identity": "source.identity",
                "offer_state": "current",
                "consumer_observation": "fetched_at",
            },
            "visibility": "public",
            "payload": {"offers": offers},
            "fetched_at": stamp.isoformat().replace("+00:00", "Z"),
        }

    def lead(self) -> dict[str, object]:
        return {
            "qualification_status": "handoff_ready",
            "schedule_or_timezone": "Saturdays Central",
            "desired_style": "heroic fantasy",
        }

    def test_only_open_campaign_is_eligible(self) -> None:
        result = match_lead(self.lead(), self.offer(), self.NOW)
        self.assertEqual("open-table", result["matched_campaign_id"])
        self.assertEqual("open", result["campaign_availability"])

    def test_missing_schedule_returns_general_conversation(self) -> None:
        lead = self.lead()
        lead["schedule_or_timezone"] = ""
        result = match_lead(lead, self.offer(), self.NOW)
        self.assertEqual("Talk with Ben about fit", result["matched_campaign_name"])
        self.assertEqual("general", result["campaign_match_confidence"])

    def test_time_is_compared_in_the_prospects_timezone(self) -> None:
        lead = self.lead()
        lead["schedule_or_timezone"] = "Saturday 5 PM Eastern"
        result = match_lead(lead, self.offer(), self.NOW)
        self.assertEqual("open-table", result["matched_campaign_id"])
        lead["schedule_or_timezone"] = "Saturday 4 PM Eastern"
        result = match_lead(lead, self.offer(), self.NOW)
        self.assertEqual("Talk with Ben about fit", result["matched_campaign_name"])

    def test_specific_time_without_timezone_does_not_force_a_match(self) -> None:
        lead = self.lead()
        lead["schedule_or_timezone"] = "Saturday at 4 PM"
        result = match_lead(lead, self.offer(), self.NOW)
        self.assertEqual("Talk with Ben about fit", result["matched_campaign_name"])

    def test_stale_offer_blocks_offer_claims(self) -> None:
        result = match_lead(self.lead(), self.offer(self.NOW - timedelta(days=8)), self.NOW)
        self.assertEqual("blocked", result["offer_claims_status"])
        self.assertEqual("", result["campaign_price"])

    def test_paid_openness_question_does_not_expose_campaign_claims(self) -> None:
        lead = self.lead()
        lead["qualification_status"] = "clarify_paid_openness"
        lead["schedule_or_timezone"] = "Saturday 5 PM Eastern"
        result = match_lead(lead, self.offer(), self.NOW)
        self.assertEqual("Talk with Ben about fit", result["matched_campaign_name"])
        self.assertEqual("blocked", result["offer_claims_status"])
        self.assertEqual("", result["campaign_price"])

    def test_age_verification_does_not_expose_campaign_claims(self) -> None:
        lead = self.lead()
        lead["qualification_status"] = "verify_age_or_guardian"
        lead["schedule_or_timezone"] = "Saturday 5 PM Eastern"
        result = match_lead(lead, self.offer(), self.NOW)
        self.assertEqual("Talk with Ben about fit", result["matched_campaign_name"])
        self.assertEqual("blocked", result["offer_claims_status"])
        self.assertEqual("", result["campaign_price"])

class OutcomeAndPolicyTests(unittest.TestCase):
    def test_free_text_does_not_create_outcomes(self) -> None:
        report = analyze(
            [
                {
                    "source_platform": "test",
                    "community_name": "test",
                    "notes": "Did not reach voice booked; no seat retained.",
                    "next_action": "Contact tomorrow and book Session Zero.",
                }
            ]
        )[0]
        self.assertEqual(0, report["contacted"])
        self.assertEqual(0, report["owner_conversations_started"])
        self.assertEqual(0, report["paid_seats"])

    def test_permission_and_approval_are_explicit_funnel_stages(self) -> None:
        report = analyze(
            [
                {
                    "source_platform": "test",
                    "permission_state": "allowed",
                    "approval_status": "approved",
                    "contacted_at": "2026-08-12T12:00:00-05:00",
                },
                {
                    "source_platform": "test",
                    "notes": "Permission verified and Ben approved outreach.",
                },
            ],
            "source_platform",
        )[0]
        self.assertEqual(1, report["permission_verified"])
        self.assertEqual(1, report["approved"])
        self.assertEqual("1/2 (50.0%)", report["permission_verification_rate"])

    def test_one_win_never_produces_scale_verdict(self) -> None:
        one_of_one = analyze(
            [{"source_platform": "a", "contacted_at": "2026-08-12", "paid_seat_status": "paid"}],
            "source_platform",
        )[0]
        one_of_hundred = analyze(
            [
                {
                    "source_platform": "b",
                    "contacted_at": f"2026-08-{(index % 28) + 1:02d}",
                    "paid_seat_status": "paid" if index == 0 else "",
                }
                for index in range(100)
            ],
            "source_platform",
        )[0]
        self.assertEqual("promising, insufficient evidence", one_of_one["recommended_action"])
        self.assertEqual("promising, insufficient evidence", one_of_hundred["recommended_action"])
        self.assertNotIn("scale", one_of_one["recommended_action"])
        self.assertNotIn("scale", one_of_hundred["recommended_action"])

    def test_expired_rules_memory_is_not_outreach_ready(self) -> None:
        status, action, _ = memory_action(
            {"paid_posts_status": "allowed", "dm_policy": "allowed", "expires_at": "2026-08-01"},
            date(2026, 8, 12),
        )
        self.assertEqual("rules-expired", status)
        self.assertIn("re-audit", action)

    def test_community_has_no_numeric_vanity_score(self) -> None:
        result = classify_community(
            {
                "visibility": "public",
                "rules_status": "rules allow paid posts",
                "paid_posts_status": "paid posts allowed",
                "dm_policy": "public reply allowed",
                "ai_content_policy": "not stated",
                "ai_content_evidence": "Current rules checked; no AI-content restriction stated.",
                "audience_age_evidence": "adult players",
                "activity_evidence": "recent weekly LFG posts",
            }
        )
        self.assertEqual("test", result["source_readiness"])
        self.assertNotIn("score", result)

    def test_community_can_allow_public_replies_while_forbidding_dms(self) -> None:
        result = classify_community(
            {
                "visibility": "public",
                "rules_status": "paid posts allowed in the LFG thread",
                "paid_posts_status": "allowed",
                "dm_policy": "DMs forbidden",
                "ai_content_policy": "not stated",
                "ai_content_evidence": "Current rules checked; no AI-content restriction stated.",
                "permission_evidence": "Public reply allowed in the LFG thread; no DMs.",
                "audience_age_evidence": "adult players",
            }
        )
        self.assertEqual("test", result["source_readiness"])
        self.assertIn("direct messages remain prohibited", result["source_readiness_reason"])

    def test_ai_forbidden_community_remains_testable_but_manual_only(self) -> None:
        result = classify_community(
            {
                "visibility": "public",
                "rules_status": "paid replies allowed in explicitly paid LFG posts",
                "paid_posts_status": "allowed",
                "dm_policy": "public reply allowed",
                "ai_content_policy": "forbidden",
                "ai_content_evidence": "Site rules prohibit content created in whole or in part through AI.",
                "audience_age_evidence": "adult players",
            }
        )
        self.assertEqual("test", result["source_readiness"])
        self.assertEqual("manual_only", result["ai_content_state"])
        self.assertIn("Ben-authored outreach", result["source_readiness_reason"])

    def test_ai_forbidden_rules_memory_preserves_route_as_manual_only(self) -> None:
        status, action, _ = memory_action(
            {
                "paid_posts_status": "allowed",
                "dm_policy": "allowed",
                "ai_content_policy": "forbidden",
            },
            date(2026, 8, 12),
        )
        self.assertEqual("rules-memory-applied", status)
        self.assertIn("manual-only", action)

    def test_no_dm_rule_preserves_an_approved_public_manual_route(self) -> None:
        status, action, _ = memory_action(
            {
                "paid_posts_status": "allowed-specific-thread",
                "dm_policy": "forbidden",
                "approved_channels": "public reply in the prospect's LFG thread",
                "ai_content_policy": "forbidden",
            },
            date(2026, 8, 12),
        )
        self.assertEqual("rules-memory-applied", status)
        self.assertIn("manual-only", action)

    def test_rules_memory_needs_ai_policy_evidence(self) -> None:
        status, action, _ = memory_action(
            {"paid_posts_status": "allowed", "dm_policy": "allowed"},
            date(2026, 8, 12),
        )
        self.assertEqual("audit-rules", status)
        self.assertIn("AI-content policy", action)

    def test_template_and_generator_schema_match(self) -> None:
        schemas = {
            "acquisition-tracker-template.csv": ACQUISITION_FIELDS,
            "community-tracker-template.csv": COMMUNITY_FIELDS,
            "source-access-tracker-template.csv": SOURCE_ACCESS_FIELDS,
            "source-rules-memory-template.csv": SOURCE_RULES_MEMORY_FIELDS,
            "source-roi-template.csv": SOURCE_ROI_FIELDS,
        }
        for filename, expected in schemas.items():
            with self.subTest(filename=filename):
                with (SKILL_DIR / "assets" / filename).open(encoding="utf-8", newline="") as handle:
                    self.assertEqual(expected, next(csv.reader(handle)))
        self.assertEqual(("acquisition-tracker.csv", ACQUISITION_FIELDS), TRACKERS["acquisition"])

    def test_command_line_workflow(self) -> None:
        lead = {
            "opportunity_id": "smoke-1",
            "source_url": "https://example.test/post",
            "observed_at": "2026-08-12",
            "lead_age_days": "1",
            "observed_evidence": "Adult group looking for a DM.",
            "quoted_intent": "We need a DM and are open to a paid professional game.",
            "audience_age_evidence": "All adults.",
            "paid_openness_evidence": "Open to a paid DM.",
            "permission_status": "allowed",
            "permission_evidence": "Public reply allowed.",
            "ai_content_policy": "not stated",
            "ai_content_evidence": "Current rules checked; no AI-content restriction stated.",
            "contact_route": "public reply",
            "schedule_or_timezone": "Wednesday 6 PM Central",
        }
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            offer_path = output / "campaigns.json"
            offers = [
                {
                    "id": "thrones",
                    "slug": "thrones",
                    "title": "Thrones of the Djinni Lords",
                    "status": "open",
                    "open_seats": 2,
                    "has_open_seats": True,
                    "schedule": {
                        "day": "Wednesday",
                        "time": "6:00 PM",
                        "time_zone": "America/Chicago",
                        "label": "Wednesday, 6:00 PM Central",
                    },
                    "price": "$40/week",
                    "canonical_url": "https://20fates.com/campaigns/thrones/",
                }
            ]
            offer_path.write_text(
                json.dumps(
                    {
                        "contract": "public-offer-snapshot",
                        "version": "public-offer/1",
                        "owner": "20fates-website",
                        "source": {"identity": source_identity(offers)},
                        "freshness": {
                            "source_identity": "source.identity",
                            "offer_state": "current",
                            "consumer_observation": "fetched_at",
                        },
                        "visibility": "public",
                        "payload": {"offers": offers},
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                    }
                ),
                encoding="utf-8",
            )
            run_cli("generate_crm_csv.py", "--out-dir", directory, "--kind", "all")
            classified = output / "classified.json"
            matched = output / "matched.json"
            run_cli("score_leads.py", "-", "--format", "json", "--output", str(classified), input_text=json.dumps([lead]))
            run_cli("validate_leads.py", str(classified), "--fail-on-blocked")
            run_cli(
                "match_20fates_campaigns.py",
                str(classified),
                "--campaigns",
                str(offer_path),
                "--format",
                "json",
                "--output",
                str(matched),
            )
            result = json.loads(matched.read_text(encoding="utf-8"))[0]
            self.assertEqual("Thrones of the Djinni Lords", result["matched_campaign_name"])
            self.assertTrue((output / "acquisition-tracker.csv").exists())


if __name__ == "__main__":
    unittest.main()
