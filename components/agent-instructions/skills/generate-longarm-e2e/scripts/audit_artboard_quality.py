#!/usr/bin/env python3
"""Audit a quilting art-board DXF for visual readiness before digitizing."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path


Point = tuple[float, float]


def parse_dxf_polylines(path: Path) -> list[dict]:
    tokens = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    shapes: list[dict] = []
    current: dict | None = None
    i = 0
    while i < len(tokens) - 1:
        code = tokens[i].strip()
        value = tokens[i + 1].strip()
        if code == "0" and value == "POLYLINE":
            current = {"layer": "0", "points": []}
            shapes.append(current)
        elif current is not None and code == "8":
            current["layer"] = value
        elif current is not None and code == "0" and value == "VERTEX":
            x = y = None
            j = i + 2
            while j < len(tokens) - 1:
                c = tokens[j].strip()
                v = tokens[j + 1].strip()
                if c == "0":
                    break
                if c == "10":
                    x = float(v)
                elif c == "20":
                    y = float(v)
                j += 2
            if x is not None and y is not None:
                current["points"].append((x, y))
        elif code == "0" and value == "SEQEND":
            current = None
        i += 2
    return [shape for shape in shapes if len(shape["points"]) >= 2]


def path_length(points: list[Point]) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:]))


def bounds(shapes: list[dict]) -> tuple[float, float, float, float]:
    xs = [x for shape in shapes for x, _ in shape["points"]]
    ys = [y for shape in shapes for _, y in shape["points"]]
    return min(xs), min(ys), max(xs), max(ys)


def sample_points(points: list[Point], spacing: float = 0.08) -> list[Point]:
    samples: list[Point] = []
    for a, b in zip(points, points[1:]):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        steps = max(1, math.ceil(length / spacing))
        for i in range(steps):
            t = i / steps
            samples.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    if points:
        samples.append(points[-1])
    return samples


def occupancy(shapes: list[dict], region: tuple[float, float, float, float], grid: int = 28) -> float:
    min_x, min_y, max_x, max_y = region
    cells: set[tuple[int, int]] = set()
    for shape in shapes:
        for x, y in sample_points(shape["points"]):
            if min_x <= x <= max_x and min_y <= y <= max_y:
                ix = min(grid - 1, max(0, int((x - min_x) / (max_x - min_x) * grid)))
                iy = min(grid - 1, max(0, int((y - min_y) / (max_y - min_y) * grid)))
                cells.add((ix, iy))
    return len(cells) / (grid * grid)


def layer_lengths(shapes: list[dict]) -> dict[str, float]:
    lengths: dict[str, float] = defaultdict(float)
    for shape in shapes:
        lengths[shape["layer"]] += path_length(shape["points"])
    return {layer: round(length, 3) for layer, length in sorted(lengths.items())}


def audit(shapes: list[dict]) -> dict:
    failures: list[str] = []
    warnings: list[str] = []
    min_x, min_y, max_x, max_y = bounds(shapes)
    layers = sorted({shape["layer"] for shape in shapes})
    total_length = sum(path_length(shape["points"]) for shape in shapes)

    if len(shapes) < 900:
        failures.append("Art board has too few vector shapes for heirloom coordinate complexity.")
    if len(layers) < 12:
        failures.append("Art board has too few semantic layers.")
    if total_length < 1200:
        failures.append("Drawn line length is too low for dense heirloom coordinate work.")

    width = max_x - min_x
    height = max_y - min_y
    outer = (min_x, min_y, max_x, max_y)
    focal = (min_x + width * 0.27, min_y + height * 0.27, max_x - width * 0.27, max_y - height * 0.27)
    border_top = (min_x, max_y - height * 0.22, max_x, max_y)
    border_bottom = (min_x, min_y, max_x, min_y + height * 0.22)
    border_left = (min_x, min_y, min_x + width * 0.22, max_y)
    border_right = (max_x - width * 0.22, min_y, max_x, max_y)

    occ = {
        "overall": round(occupancy(shapes, outer), 3),
        "focal": round(occupancy(shapes, focal), 3),
        "top_border": round(occupancy(shapes, border_top), 3),
        "bottom_border": round(occupancy(shapes, border_bottom), 3),
        "left_border": round(occupancy(shapes, border_left), 3),
        "right_border": round(occupancy(shapes, border_right), 3),
    }
    if occ["focal"] < 0.11:
        warnings.append("Focal area may still be too open compared with the reference standard.")
    border_values = [occ["top_border"], occ["bottom_border"], occ["left_border"], occ["right_border"]]
    if min(border_values) < 0.08:
        warnings.append("At least one border region may be too sparse.")
    if max(border_values) / max(0.001, min(border_values)) > 1.75:
        warnings.append("Border density is uneven from side to side.")

    required_layers = {
        "outer-pearls",
        "top-border",
        "bottom-border",
        "left-border",
        "right-border",
        "focal-frame",
        "focal-motif",
        "focal-point-motifs",
        "inner-sashing",
        "corners",
    }
    missing = sorted(required_layers - set(layers))
    if missing:
        failures.append(f"Missing required art layers: {', '.join(missing)}.")

    return {
        "passes": not failures,
        "failures": failures,
        "warnings": warnings,
        "shape_count": len(shapes),
        "layer_count": len(layers),
        "bounds": [round(min_x, 3), round(min_y, 3), round(max_x, 3), round(max_y, 3)],
        "total_drawn_length": round(total_length, 3),
        "occupancy": occ,
        "layer_lengths": layer_lengths(shapes),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dxf", help="Art-board DXF generated by build_heirloom_coordinate.py or similar.")
    parser.add_argument("--out", help="Optional JSON output path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    shapes = parse_dxf_polylines(Path(args.dxf))
    result = audit(shapes)
    text = json.dumps(result, indent=2)
    print(text)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    return 0 if result["passes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
