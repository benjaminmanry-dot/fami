#!/usr/bin/env python3
"""Combine lightweight campaign prep into one Markdown table document."""

from __future__ import annotations

import argparse
from pathlib import Path


DEFAULT_PARTS = [
    "session_plan.md",
    "dm_running_notes.md",
    "roll20_checklist.md",
    "asset_prompt_list.md",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile lightweight session prep into one Markdown file.")
    parser.add_argument("campaign_dir", help="Path to the campaign workspace.")
    parser.add_argument("number", type=int, help="Session number.")
    parser.add_argument(
        "--parts",
        nargs="*",
        default=DEFAULT_PARTS,
        help="Prep filenames to include, in order.",
    )
    args = parser.parse_args()

    campaign_dir = Path(args.campaign_dir)
    session_id = f"{args.number:03d}"
    prep_dir = campaign_dir / "prep" / session_id
    legacy_prep_dir = campaign_dir / "prep" / f"session-{session_id}"
    if not prep_dir.exists() and legacy_prep_dir.exists():
        prep_dir = legacy_prep_dir

    output_path = prep_dir / "compiled_session_notes.md"

    chunks = [f"# Compiled Session Notes: Session {session_id}\n"]
    for filename in args.parts:
        path = prep_dir / filename
        if path.exists():
            chunks.append(f"\n\n<!-- Source: {path.as_posix()} -->\n")
            chunks.append(path.read_text(encoding="utf-8").strip())

    output_path.write_text("\n".join(chunks).strip() + "\n", encoding="utf-8")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
