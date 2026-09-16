#!/usr/bin/env python3
"""Score coordinate quilting thumbnail art directions before digitizing."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


FULL_LIBRARY_TOLERANCE = 0


def score_candidate(candidate: dict) -> dict:
    score = 0
    failures: list[str] = []
    warnings: list[str] = []

    sections = candidate.get("sections", [])
    if candidate.get("primary_template"):
        score += 10
    else:
        failures.append("No primary composition template.")

    template_family = candidate.get("template_family", [])
    if len(template_family) >= 4:
        score += 8
    else:
        warnings.append("Few composition templates represented.")

    hierarchy_count = max((len(section.get("anchors", [])) for section in sections), default=0)
    if hierarchy_count >= 4:
        score += 14
    else:
        failures.append("Insufficient hierarchy anchors.")

    if sections and all(section.get("template") for section in sections):
        score += 10
    else:
        failures.append("A section lacks a section template.")

    if sections and all(section.get("anchors") for section in sections):
        score += 12
    else:
        failures.append("A section lacks structural anchors.")

    section_kinds = {section.get("kind") for section in sections}
    required_kinds = {"focal", "border", "corner", "block", "triangle", "sashing"}
    if required_kinds <= section_kinds:
        score += 10
    else:
        missing = sorted(required_kinds - section_kinds)
        warnings.append(f"Missing expected geographies: {', '.join(missing)}.")

    focal = next((section for section in sections if section.get("kind") == "focal"), None)
    focal_motifs = set(focal.get("motifs", [])) if focal else set()
    if focal and len(focal_motifs) >= 5:
        score += 8
    else:
        failures.append("Focal section does not carry a rich motif library.")

    support_sections = [section for section in sections if section.get("kind") != "focal"]
    if support_sections and focal_motifs:
        full_supports = [
            section.get("name", "unnamed")
            for section in support_sections
            if set(section.get("motifs", [])) >= focal_motifs
        ]
        if full_supports:
            failures.append(f"Support sections contain full focal library: {', '.join(full_supports)}.")
        else:
            score += 10

    triangle = next((section for section in sections if section.get("kind") == "triangle"), None)
    if triangle and {"feather-plume", "clamshell-arc", "leaf-sprig"} & set(triangle.get("motifs", [])):
        score += 8
    else:
        failures.append("Triangle section lacks triangle-aware motifs.")

    densities = [
        float(section["density"])
        for section in sections
        if isinstance(section.get("density"), (int, float))
    ]
    if densities:
        spread = max(densities) - min(densities)
        if spread <= 0.22:
            score += 8
        else:
            failures.append(f"Density spread {spread:.2f} is too large.")

    rejection_text = " ".join(candidate.get("hard_rejections", [])).lower()
    if "floating" in rejection_text and "naked" in rejection_text:
        score += 6
    else:
        failures.append("Hard rejections do not name floating motifs and naked connectors.")

    curated_assets = candidate.get("curated_asset_ids", [])
    if len(curated_assets) >= 7:
        score += 4
    else:
        warnings.append("Too few curated motif assets used.")

    if score > 100:
        score = 100
    return {
        "id": candidate.get("id"),
        "name": candidate.get("name"),
        "score": score,
        "passes": score >= 85 and not failures,
        "failures": failures,
        "warnings": warnings,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("thumbnail_json", help="Path to thumbnail-options.json from generate_art_thumbnails.py.")
    parser.add_argument("--threshold", type=int, default=85)
    parser.add_argument("--out", help="Optional path for art-thumbnail-scores.json.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    data = json.loads(Path(args.thumbnail_json).read_text(encoding="utf-8"))
    candidates = data.get("candidates", [])
    results = [score_candidate(candidate) for candidate in candidates]
    best = max(results, key=lambda item: item["score"], default=None)
    output = {
        "threshold": args.threshold,
        "best_id": best["id"] if best else None,
        "best_score": best["score"] if best else 0,
        "passes": bool(best and best["score"] >= args.threshold and best["passes"]),
        "results": results,
    }
    text = json.dumps(output, indent=2)
    print(text)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    return 0 if output["passes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
