#!/usr/bin/env python3
"""Critique a coordinate quilting art board for professional style risks."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from longarm_geometry import bounds, layer_summary, parse_dxf_polylines, path_length, shape_bounds


REPEAT_FRIENDLY_TERMS = (
    "pearl",
    "frame",
    "rail",
    "sashing",
    "clamshell",
    "outer",
    "ditch",
    "key",
)

REQUIRED_HIERARCHY_TERMS = {
    "focal": "a focal motif or medallion",
    "border": "designed border lanes",
    "corner": "corner-turn logic",
    "sashing": "sashing or inner rail support",
}


def load_audit(path: str | None) -> dict:
    if not path:
        return {}
    audit_path = Path(path)
    if not audit_path.exists():
        return {}
    return json.loads(audit_path.read_text(encoding="utf-8"))


def is_repeat_friendly(layer: str) -> bool:
    layer_lc = layer.lower()
    return any(term in layer_lc for term in REPEAT_FRIENDLY_TERMS)


def center(point_bounds: tuple[float, float, float, float]) -> tuple[float, float]:
    min_x, min_y, max_x, max_y = point_bounds
    return ((min_x + max_x) / 2, (min_y + max_y) / 2)


def stamped_repetition(shapes: list) -> dict:
    groups: dict[str, Counter[tuple[float, float, float]]] = defaultdict(Counter)
    for shape in shapes:
        if is_repeat_friendly(shape.layer):
            continue
        min_x, min_y, max_x, max_y = shape_bounds(shape)
        width = round(max_x - min_x, 2)
        height = round(max_y - min_y, 2)
        length = round(path_length(shape.points), 2)
        groups[shape.layer][(width, height, length)] += 1

    repeated_shapes = 0
    repeated_groups = []
    non_repeat_shapes = 0
    for layer, counter in groups.items():
        non_repeat_shapes += sum(counter.values())
        for signature, count in counter.items():
            if count >= 5:
                repeated_shapes += count
                repeated_groups.append(
                    {
                        "layer": layer,
                        "signature": list(signature),
                        "count": count,
                    }
                )
    ratio = repeated_shapes / max(1, non_repeat_shapes)
    return {
        "non_repeat_shape_count": non_repeat_shapes,
        "repeated_shape_count": repeated_shapes,
        "stamped_ratio": round(ratio, 3),
        "largest_groups": sorted(repeated_groups, key=lambda item: item["count"], reverse=True)[:10],
    }


def center_regularities(shapes: list) -> dict:
    candidates = [shape for shape in shapes if not is_repeat_friendly(shape.layer)]
    if not candidates:
        return {"x_bin_peak": 0, "y_bin_peak": 0, "regularity_ratio": 0.0}
    x_bins: Counter[float] = Counter()
    y_bins: Counter[float] = Counter()
    for shape in candidates:
        cx, cy = center(shape_bounds(shape))
        x_bins[round(cx * 2) / 2] += 1
        y_bins[round(cy * 2) / 2] += 1
    peak = max(max(x_bins.values()), max(y_bins.values()))
    return {
        "x_bin_peak": max(x_bins.values()),
        "y_bin_peak": max(y_bins.values()),
        "regularity_ratio": round(peak / max(1, len(candidates)), 3),
    }


def hierarchy_layers(shapes: list) -> dict:
    layers = sorted({shape.layer for shape in shapes})
    lower_layers = [layer.lower() for layer in layers]
    missing = []
    for term, label in REQUIRED_HIERARCHY_TERMS.items():
        if not any(term in layer for layer in lower_layers):
            missing.append(label)
    return {"layers": layers, "missing_hierarchy": missing}


def region_balance_from_audit(audit: dict) -> dict:
    occ = audit.get("occupancy") or {}
    if not occ:
        return {"available": False}
    border_values = [
        occ.get("top_border", 0),
        occ.get("bottom_border", 0),
        occ.get("left_border", 0),
        occ.get("right_border", 0),
    ]
    ratio = max(border_values) / max(0.001, min(border_values))
    return {
        "available": True,
        "focal": occ.get("focal", 0),
        "overall": occ.get("overall", 0),
        "border_balance_ratio": round(ratio, 3),
        "weakest_border_occupancy": min(border_values),
    }


def critique(dxf_path: Path, audit_path: str | None = None) -> dict:
    shapes = parse_dxf_polylines(dxf_path)
    audit = load_audit(audit_path)
    failures: list[str] = []
    warnings: list[str] = []
    strengths: list[str] = []
    recommendations: list[str] = []
    score = 100

    if not shapes:
        return {
            "passes": False,
            "score": 0,
            "failures": ["DXF contains no usable polylines."],
            "warnings": [],
            "strengths": [],
            "recommendations": ["Regenerate the art board from a valid coordinate design script."],
        }

    min_x, min_y, max_x, max_y = bounds(shapes)
    hierarchy = hierarchy_layers(shapes)
    stamped = stamped_repetition(shapes)
    regularity = center_regularities(shapes)
    balance = region_balance_from_audit(audit)

    if audit and not audit.get("passes", False):
        failures.append("The density/layer art-board audit did not pass.")
        score -= 25
    for warning in audit.get("warnings", []):
        warnings.append(f"Audit warning: {warning}")
        score -= 4

    if hierarchy["missing_hierarchy"]:
        failures.append("Missing hierarchy: " + ", ".join(hierarchy["missing_hierarchy"]) + ".")
        score -= 18
    else:
        strengths.append("Layer names show focal, border, corner, and sashing hierarchy.")

    if len(shapes) >= 900:
        strengths.append("Art-board complexity is in the heirloom coordinate range.")
    else:
        warnings.append("Shape count may still be light for a reference-grade coordinate preview.")
        score -= 8

    if stamped["stamped_ratio"] > 0.42:
        failures.append("Too much non-pearl/non-frame motif work repeats with identical signatures.")
        score -= 20
    elif stamped["stamped_ratio"] > 0.25:
        warnings.append("Several motif groups repeat with near-identical size and length; vary scale or line character.")
        score -= 10
    elif stamped["stamped_ratio"] > 0.12:
        warnings.append("Some repeated motif signatures remain; acceptable if they are intentionally mirrored coordinates.")
        score -= 4
    else:
        strengths.append("Non-frame motifs show useful variation rather than obvious stamping.")

    if regularity["regularity_ratio"] > 0.2:
        warnings.append("Motif centers are highly regular; soften placement unless the section is intentionally gridded.")
        score -= 7

    if balance["available"]:
        if balance["focal"] < 0.42:
            warnings.append("Focal occupancy is low for the uploaded heirloom reference standard.")
            score -= 8
        else:
            strengths.append("Focal occupancy reads developed enough for a coordinate art board.")
        if balance["border_balance_ratio"] > 1.45:
            warnings.append("Border density differs enough that the quilt may read uneven side to side.")
            score -= 6
        else:
            strengths.append("Border density is reasonably balanced across geographies.")

    if audit.get("layer_count", 0) >= 14 or len({shape.layer for shape in shapes}) >= 14:
        strengths.append("Semantic layer count supports separate border, block, triangle, sashing, and focal review.")
    else:
        warnings.append("Layer count is low for area-aware coordinate review.")
        score -= 5

    if not failures and score >= 86:
        recommendations.append("Proceed to machine-behavior QA and route planning, then review the PNG visually.")
    else:
        recommendations.append("Revise motif integration, line character, or geography balance before treating the DXF as publishable.")

    metrics = {
        "bounds": [round(min_x, 3), round(min_y, 3), round(max_x, 3), round(max_y, 3)],
        "shape_count": len(shapes),
        "layer_count": len({shape.layer for shape in shapes}),
        "layer_summary": layer_summary(shapes),
        "stamped_repetition": stamped,
        "center_regularity": regularity,
        "region_balance": balance,
    }

    score = max(0, min(100, score))
    return {
        "passes": not failures and score >= 80,
        "score": score,
        "failures": failures,
        "warnings": warnings,
        "strengths": strengths,
        "recommendations": recommendations,
        "metrics": metrics,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dxf", help="Coordinate art-board DXF.")
    parser.add_argument("--audit", help="Optional artboard-audit.json path.")
    parser.add_argument("--out", help="Optional JSON output path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = critique(Path(args.dxf), args.audit)
    text = json.dumps(result, indent=2)
    print(text)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    return 0 if result["passes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
