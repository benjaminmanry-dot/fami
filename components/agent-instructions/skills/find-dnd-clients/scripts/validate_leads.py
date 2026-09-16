#!/usr/bin/env python3
"""Validate acquisition records before drafting or outreach approval."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from score_leads import classify_lead, load_rows, norm


REQUIRED_RESEARCH_FIELDS = (
    ("source_url",),
    ("observed_at", "observed_date"),
    ("observed_evidence", "public_evidence_summary"),
    ("audience_age_evidence",),
    ("permission_evidence", "contact_permission_evidence"),
    ("ai_content_policy",),
    ("ai_content_evidence",),
    ("contact_route",),
)


def validate_row(row: dict[str, object], index: int) -> dict[str, object]:
    missing = ["/".join(names) for names in REQUIRED_RESEARCH_FIELDS if not any(norm(row.get(name)) for name in names)]
    result = classify_lead(row)
    return {
        "row": index,
        "opportunity_id": norm(row.get("opportunity_id") or row.get("lead_id")) or f"row-{index}",
        "missing_fields": missing,
        **result,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate acquisition CSV/JSON rows.")
    parser.add_argument("input", help="Input CSV/JSON path")
    parser.add_argument(
        "--fail-on-blocked",
        "--fail-on-reject",
        dest="fail_on_blocked",
        action="store_true",
        help="Exit 1 if any row is rejected, held, or missing required research evidence.",
    )
    args = parser.parse_args()

    rows = load_rows(Path(args.input))
    results = [validate_row(row, index + 1) for index, row in enumerate(rows)]
    blocked = [item for item in results if item["qualification_status"] in {"reject", "hold"} or item["missing_fields"]]
    report = {"row_count": len(rows), "blocked_count": len(blocked), "results": results}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 1 if args.fail_on_blocked and blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
