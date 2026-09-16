#!/usr/bin/env python3
"""Generate blank acquisition and source-policy trackers."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


ACQUISITION_FIELDS = [
    "opportunity_id", "source_platform", "source_url", "community_name", "research_query", "posted_at", "observed_at",
    "lead_age_days", "recency_bucket", "observed_evidence", "quoted_intent", "audience_age_evidence", "guardian_evidence",
    "guardian_contact_route",
    "paid_openness_evidence", "permission_status", "permission_evidence", "permission_expires_at", "ai_content_policy",
    "ai_content_evidence", "contact_route",
    "contact_url", "desired_system", "desired_style", "player_count", "schedule_or_timezone", "inferred_fit",
    "inference_confidence", "unknowns", "hard_disqualifiers", "qualification_blockers", "qualification_status", "priority",
    "paid_openness_state", "permission_state", "ai_content_state", "audience_age_state", "contact_audience",
    "outreach_generation_allowed", "matched_campaign_id", "matched_campaign_name", "matched_campaign_url",
    "matched_schedule", "campaign_match_confidence", "campaign_match_reason", "campaign_availability", "campaign_price",
    "offer_claims_status", "offer_cache_observed_at", "handoff_route", "website_url", "outreach_draft", "approval_status",
    "pipeline_stage", "contacted_at", "reply_status", "owner_conversation_route", "owner_conversation_status",
    "session_zero_status", "paid_seat_status", "campaign_joined", "retained_4_weeks", "lost_reason", "win_reason",
    "research_minutes", "review_minutes", "conversation_minutes", "deal_value", "next_action", "notes",
]

COMMUNITY_FIELDS = [
    "source_id", "platform", "community_name", "source_url", "research_query", "observed_at", "visibility", "access_path",
    "access_status", "rules_status", "paid_posts_status", "dm_policy", "ai_content_policy", "ai_content_evidence", "ai_content_state",
    "admin_permission_status", "permission_evidence",
    "permission_expires_at", "approved_channels", "admin_contact_path", "audience_age_evidence", "niche",
    "geography_or_timezone", "activity_evidence", "source_readiness", "source_priority", "source_readiness_reason",
    "next_action", "notes",
]

SOURCE_ACCESS_FIELDS = [
    "source_id", "platform", "source_name", "url", "visibility", "access_status", "account_status", "signup_url", "login_url",
    "suggested_username", "account_email_needed", "account_verification_notes", "how_to_access", "permission_needed",
    "rules_status", "paid_policy", "dm_policy", "ai_content_policy", "ai_content_evidence", "approved_channels",
    "admin_contact_path", "lead_age_limit_days", "observed_at",
    "permission_expires_at", "next_action", "notes",
]

SOURCE_RULES_MEMORY_FIELDS = [
    "source_id", "source_platform", "community_name", "source_url", "visibility", "access_status", "rules_status",
    "paid_posts_status", "dm_policy", "ai_content_policy", "ai_content_evidence", "admin_permission_status",
    "approved_channels", "approved_contact_route",
    "approval_evidence_summary", "approved_by", "approved_at", "expires_at", "last_checked", "next_action", "notes",
]

SOURCE_ROI_FIELDS = [
    "group_by", "source_key", "source_platform", "community_name", "matched_campaign_name", "opportunities", "permission_verified", "approved", "contacted", "replied",
    "owner_conversations_started", "owner_conversations_qualified", "session_zero_invited", "session_zero_booked",
    "session_zero_completed", "paid_seats", "retained_4_weeks", "total_deal_value", "ben_time_minutes", "permission_verification_rate", "approval_rate", "contact_rate",
    "reply_rate", "conversation_start_rate", "conversation_qualification_rate", "session_zero_invite_rate",
    "session_zero_booking_rate", "session_zero_completion_rate", "paid_seat_rate", "retention_rate", "recommended_action",
]


TRACKERS = {
    "community": ("community-tracker.csv", COMMUNITY_FIELDS),
    "acquisition": ("acquisition-tracker.csv", ACQUISITION_FIELDS),
    "source_access": ("source-access-tracker.csv", SOURCE_ACCESS_FIELDS),
    "source_rules_memory": ("source-rules-memory.csv", SOURCE_RULES_MEMORY_FIELDS),
    "source_roi": ("source-roi-report.csv", SOURCE_ROI_FIELDS),
}


def write_csv(path: Path, fields: list[str], overwrite: bool) -> None:
    if path.exists() and not overwrite:
        raise FileExistsError(f"{path} already exists. Use --overwrite to replace it.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerow(fields)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate blank 20Fates acquisition trackers.")
    parser.add_argument("--out-dir", default=".")
    parser.add_argument("--kind", choices=(*TRACKERS, "core", "all"), default="core")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    kinds = list(TRACKERS) if args.kind == "all" else ["community", "acquisition"] if args.kind == "core" else [args.kind]
    for kind in kinds:
        filename, fields = TRACKERS[kind]
        write_csv(Path(args.out_dir) / filename, fields, args.overwrite)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
