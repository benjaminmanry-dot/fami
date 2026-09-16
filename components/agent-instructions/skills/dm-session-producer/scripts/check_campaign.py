#!/usr/bin/env python3
"""Check that a campaign workspace has the required DM prep files."""

from __future__ import annotations

import argparse
from pathlib import Path


REQUIRED_FILES = [
    "campaign.md",
    "canon.md",
    "party.md",
    "npcs.md",
    "factions.md",
    "locations.md",
    "threads.md",
]

REQUIRED_DIRS = ["sessions", "prep", "packets"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate campaign workspace shape.")
    parser.add_argument("campaign_dir", help="Path to the campaign workspace.")
    args = parser.parse_args()

    campaign_dir = Path(args.campaign_dir)
    missing = []

    for filename in REQUIRED_FILES:
        if not (campaign_dir / filename).is_file():
            missing.append(filename)

    for dirname in REQUIRED_DIRS:
        if not (campaign_dir / dirname).is_dir():
            missing.append(dirname + "/")

    if missing:
        print("Missing required campaign paths:")
        for item in missing:
            print(f"- {item}")
        return 1

    print("Campaign workspace OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
