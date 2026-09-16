#!/usr/bin/env python3
"""Lay out motif objects inside a square and connect them without retracing."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import build_e2e_pattern as e2e


Point = tuple[float, float]


def add(points: list[Point], point: Point) -> None:
    if points and e2e.dist(points[-1], point) < 0.0005:
        return
    points.append((round(point[0], 5), round(point[1], 5)))


def ellipse(points: list[Point], cx: float, cy: float, rx: float, ry: float, rot: float, steps: int = 72) -> None:
    cosr = math.cos(rot)
    sinr = math.sin(rot)
    start = math.pi
    for i in range(steps + 1):
        a = start + 2 * math.pi * i / steps
        x = rx * math.cos(a)
        y = ry * math.sin(a)
        add(points, (cx + x * cosr - y * sinr, cy + x * sinr + y * cosr))


def sakura_point(cx: float, cy: float, outer: float, rot: float, angle: float) -> Point:
    u = (5 * (angle - rot) + math.pi) % (2 * math.pi) - math.pi
    cleft = math.exp(-(u / 0.25) ** 2)
    radius = outer * (0.72 + 0.24 * math.cos(u) - 0.06 * cleft)
    return (cx + radius * math.cos(angle), cy + radius * math.sin(angle))


def sakura(points: list[Point], cx: float, cy: float, outer: float, rot: float) -> None:
    start_angle = rot + math.pi
    for i in range(181):
        add(points, sakura_point(cx, cy, outer, rot, start_angle + 2 * math.pi * i / 180))
    ellipse(points, cx, cy, outer * 0.16, outer * 0.11, rot + 0.15, steps=32)
    add(points, sakura_point(cx, cy, outer, rot, start_angle))


def pearl(points: list[Point], cx: float, cy: float, radius: float) -> None:
    ellipse(points, cx, cy, radius, radius, 0.0, steps=48)


def motif(points: list[Point], kind: str, cx: float, cy: float, size: float, index: int) -> None:
    if kind == "mixed":
        kind = ["sakura", "leaf", "pearl"][index % 3]
    if kind == "sakura":
        sakura(points, cx, cy, size * 0.42, math.pi / 2 + (index % 4) * 0.35)
    elif kind == "leaf":
        ellipse(points, cx, cy, size * 0.34, size * 0.16, (index % 6) * 0.45, steps=56)
    elif kind == "pearl":
        pearl(points, cx, cy, size * 0.20)
    else:
        raise ValueError(f"Unknown motif: {kind}")


def square_positions(count: int, size: float, margin: float) -> list[Point]:
    grid = math.ceil(math.sqrt(count))
    gap = (size - 2 * margin) / max(1, grid - 1)
    rows: list[list[Point]] = []
    for row in range(grid):
        y = size / 2 - (margin + row * gap)
        row_points = []
        for col in range(grid):
            x = margin + col * gap
            row_points.append((x, y))
        if row % 2:
            row_points.reverse()
        rows.append(row_points)
    return [point for row in rows for point in row][:count]


def build_spec(args: argparse.Namespace) -> e2e.PatternSpec:
    size = args.size
    margin = args.margin if args.margin is not None else size * 0.16
    positions = square_positions(args.objects, size, margin)
    points: list[Point] = [(0.0, 0.0)]
    object_size = min((size - 2 * margin) / max(2, math.ceil(math.sqrt(args.objects))), size * 0.22)
    for idx, (cx, cy) in enumerate(positions):
        # Connect to each motif once, stitch the object loop, then leave for the next object.
        add(points, (cx - object_size * 0.45, cy))
        motif(points, args.motif, cx, cy, object_size, idx)
    add(points, (size, 0.0))
    return e2e.PatternSpec(
        name=args.name,
        repeat_width=size,
        row_height=size,
        row_advance=size * 0.55,
        alternate_offset=size / 2,
        stitch_spacing=args.stitch_spacing,
        waypoints=points,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Square Object Layout")
    parser.add_argument("--out", default="./square-object-layout")
    parser.add_argument("--size", type=float, default=10.0, help="Square side length in inches.")
    parser.add_argument("--margin", type=float, help="Inset margin in inches.")
    parser.add_argument("--objects", type=int, default=9, help="Number of objects to place.")
    parser.add_argument("--motif", choices=["sakura", "leaf", "pearl", "mixed"], default="mixed")
    parser.add_argument("--stitch-spacing", type=float, default=0.025)
    parser.add_argument("--qa-artifacts", action="store_true", help="Also write source spec and QA previews. Default writes only DXF.")
    parser.add_argument("--hqv-converter", help="Verified SVG-to-HQV converter command or executable.")
    parser.add_argument("--require-hqv", action="store_true")
    parser.add_argument("--strict", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    spec = build_spec(args)
    out_dir = Path(args.out)
    result = e2e.build_outputs(
        spec,
        out_dir,
        preview_rows=1,
        preview_repeats=1,
        strict=args.strict,
        hqv_converter=args.hqv_converter,
        require_hqv=args.require_hqv,
        repeat_mode=False,
        qa_artifacts=args.qa_artifacts,
    )
    if args.qa_artifacts:
        spec_json = {
            "name": spec.name,
            "repeat_width": spec.repeat_width,
            "row_height": spec.row_height,
            "row_advance": spec.row_advance,
            "alternate_offset": spec.alternate_offset,
            "stitch_spacing": spec.stitch_spacing,
            "waypoints": spec.waypoints,
            "layout": {
                "type": "square-object-layout",
                "objects": args.objects,
                "motif": args.motif,
                "path_rule": "serpentine Hamiltonian route; visit each object once; no connector retracing",
            },
        }
        (out_dir / f"{e2e.slugify(spec.name)}-spec.json").write_text(json.dumps(spec_json, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    raise SystemExit(main())
