#!/usr/bin/env python3
"""Create a numbered session folder for the DM Session Producer workflow."""

from __future__ import annotations

import argparse
from pathlib import Path


def next_session_number(sessions_dir: Path) -> int:
    numbers = []
    if sessions_dir.exists():
        for child in sessions_dir.iterdir():
            if child.is_dir() and child.name.isdigit():
                numbers.append(int(child.name))
    return max(numbers, default=0) + 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a session folder.")
    parser.add_argument("campaign_dir", help="Path to the campaign workspace.")
    parser.add_argument("--number", type=int, help="Session number to create.")
    args = parser.parse_args()

    campaign_dir = Path(args.campaign_dir)
    sessions_dir = campaign_dir / "sessions"
    number = args.number or next_session_number(sessions_dir)
    session_dir = sessions_dir / f"{number:03d}"
    session_dir.mkdir(parents=True, exist_ok=True)

    raw_notes = session_dir / "raw.md"
    if not raw_notes.exists():
        raw_notes.write_text(
            f"# Raw Notes: Session {number:03d}\n\n"
            "Paste rough notes, transcript excerpts, or table bullets here.\n",
            encoding="utf-8",
        )

    print(session_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
