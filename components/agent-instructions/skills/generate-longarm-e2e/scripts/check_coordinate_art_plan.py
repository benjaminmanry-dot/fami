#!/usr/bin/env python3
"""Check a coordinate art-board plan before DXF digitizing."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


MAX_DENSITY_SPREAD = 0.25


def motif_keys(section: dict) -> set[str]:
    return {motif.get("key", "") for motif in section.get("motifs", []) if motif.get("key")}


def check_plan(plan: dict) -> tuple[list[str], list[str]]:
    failures: list[str] = []
    warnings: list[str] = []
    sections = plan.get("sections", [])
    library = {motif.get("key", "") for motif in plan.get("motif_library", []) if motif.get("key")}

    if not sections:
        failures.append("No sections found.")
        return failures, warnings
    if not library:
        failures.append("No motif library found.")

    focal_sections = [section for section in sections if section.get("role") == "focal"]
    if not focal_sections:
        failures.append("No focal section found.")
    for section in focal_sections:
        missing = sorted(library - motif_keys(section))
        if missing:
            failures.append(f"Focal section '{section.get('name')}' omits motif(s): {', '.join(missing)}.")

    for section in sections:
        name = section.get("name", "unnamed section")
        kind = section.get("kind", "unknown")
        keys = motif_keys(section)
        if not section.get("composition_skeleton"):
            failures.append(f"Section '{name}' has no composition skeleton.")
        if not keys:
            failures.append(f"Section '{name}' has no motifs.")
        if section.get("role") == "support" and library and keys >= library:
            failures.append(f"Support section '{name}' contains the full motif library.")
        if kind == "border" and "layered-border-frame" not in keys:
            warnings.append(f"Border section '{name}' does not include layered-border-frame.")
        if kind == "triangle" and not ({"feather-triangle", "clamshell-fill", "leaf-chain", "flower-echo"} & keys):
            failures.append(f"Triangle section '{name}' lacks a triangle-friendly motif.")
        if kind == "sashing" and len(keys) > 3:
            warnings.append(f"Sashing section '{name}' may be too busy for a supporting geography.")
        if "floating motifs" not in " ".join(section.get("reject_if", [])):
            warnings.append(f"Section '{name}' does not explicitly reject floating motifs.")

    density_scores = [
        float(section["density_score"])
        for section in sections
        if isinstance(section.get("density_score"), (int, float))
    ]
    if len(density_scores) >= 2:
        spread = max(density_scores) - min(density_scores)
        if spread > MAX_DENSITY_SPREAD:
            failures.append(
                f"Density spread is {spread:.2f}, above the {MAX_DENSITY_SPREAD:.2f} coordinate threshold."
            )

    art_gate = plan.get("art_gate", [])
    needed_gate_terms = ["art-board preview", "boundary-aware skeleton", "floating"]
    gate_text = " ".join(str(item).lower() for item in art_gate)
    for term in needed_gate_terms:
        if term not in gate_text:
            failures.append(f"Art gate does not mention '{term}'.")

    return failures, warnings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", help="Path to coordinate-artwork-plan.json.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable results.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    failures, warnings = check_plan(plan)
    result = {"ok": not failures, "failures": failures, "warnings": warnings}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("OK" if result["ok"] else "FAILED")
        for failure in failures:
            print(f"FAIL: {failure}")
        for warning in warnings:
            print(f"WARN: {warning}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
