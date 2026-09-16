#!/usr/bin/env python3
"""Ingest an original or user-permitted motif asset into the curated library."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from longarm_geometry import Point, bounds_from_points, parse_dxf_polylines, path_length


FLOAT_RE = re.compile(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?")


def split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def parse_svg_points(value: str) -> list[Point]:
    numbers = [float(match.group(0)) for match in FLOAT_RE.finditer(value)]
    return [(numbers[i], numbers[i + 1]) for i in range(0, len(numbers) - 1, 2)]


def parse_svg(path: Path) -> list[list[Point]]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    paths: list[list[Point]] = []
    for match in re.finditer(r"<(?:polyline|polygon)\b[^>]*\bpoints=[\"']([^\"']+)[\"']", text, flags=re.I):
        points = parse_svg_points(match.group(1))
        if len(points) >= 2:
            paths.append(points)
    for match in re.finditer(r"<path\b[^>]*\bd=[\"']([^\"']+)[\"']", text, flags=re.I):
        points = parse_svg_points(match.group(1))
        if len(points) >= 2:
            paths.append(points)
    return paths


def parse_asset(path: Path) -> list[list[Point]]:
    suffix = path.suffix.lower()
    if suffix == ".svg":
        return parse_svg(path)
    if suffix == ".dxf":
        return [shape.points for shape in parse_dxf_polylines(path)]
    raise ValueError("Only SVG and DXF motif assets are currently supported.")


def normalize(paths: list[list[Point]]) -> dict:
    all_points = [point for item in paths for point in item]
    min_x, min_y, max_x, max_y = bounds_from_points(all_points)
    width = max_x - min_x
    height = max_y - min_y
    scale = max(width, height, 1e-9)
    normalized = []
    for item in paths:
        normalized.append(
            [
                [round((x - min_x) / scale, 6), round((y - min_y) / scale, 6)]
                for x, y in item
            ]
        )
    return {
        "source_bounds": [round(min_x, 6), round(min_y, 6), round(max_x, 6), round(max_y, 6)],
        "normalized_bounds": [0.0, 0.0, round(width / scale, 6), round(height / scale, 6)],
        "paths": normalized,
        "path_count": len(paths),
        "point_count": len(all_points),
        "source_drawn_length": round(sum(path_length(item) for item in paths), 6),
    }


def motif_record(args: argparse.Namespace, geometry: dict) -> dict:
    return {
        "version": 1,
        "id": args.id,
        "display_name": args.name,
        "source_asset": str(Path(args.asset).resolve()),
        "permission_note": args.permission_note,
        "curation_status": args.status,
        "roles": split_csv(args.roles),
        "geographies": split_csv(args.geographies),
        "anchors": split_csv(args.anchors),
        "density": args.density,
        "hierarchy": args.hierarchy,
        "variants": split_csv(args.variants),
        "entry_exit": args.entry_exit,
        "misuse": args.misuse,
        "style_notes": split_csv(args.style_notes),
        "machine_notes": split_csv(args.machine_notes),
        "geometry": geometry,
        "copyright_boundary": (
            "Store only original Codex-created motifs, user-owned motifs, or assets the user has explicit permission to reuse. "
            "Do not ingest commercial quilting designs from public reference sites as reusable assets."
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("asset", help="Original or user-permitted SVG/DXF motif asset.")
    parser.add_argument("--id", required=True, help="Stable motif id, e.g. sakura-rosette-v2.")
    parser.add_argument("--name", required=True, help="Display name.")
    parser.add_argument("--permission-note", required=True, help="Why this asset may be stored and reused.")
    parser.add_argument("--roles", default="support", help="Comma-separated roles.")
    parser.add_argument("--geographies", default="focal,block,border", help="Comma-separated quilt geographies.")
    parser.add_argument("--anchors", default="spine,frame,tangent", help="Comma-separated anchor names.")
    parser.add_argument("--density", type=float, default=1.0)
    parser.add_argument("--hierarchy", default="secondary")
    parser.add_argument("--variants", default="")
    parser.add_argument("--entry-exit", default="Enter and exit through a tangent anchor.")
    parser.add_argument("--misuse", default="Do not scatter as a floating icon.")
    parser.add_argument("--style-notes", default="")
    parser.add_argument("--machine-notes", default="")
    parser.add_argument("--status", default="candidate", choices=["candidate", "approved", "retired"])
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).resolve().parents[1] / "assets" / "artistic-library" / "curated-motifs"),
        help="Directory for the generated motif JSON.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    asset = Path(args.asset)
    paths = parse_asset(asset)
    if not paths:
        print(json.dumps({"passes": False, "failure": "No usable vector paths found."}, indent=2))
        return 1
    geometry = normalize(paths)
    record = motif_record(args, geometry)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.id}.motif.json"
    out_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passes": True, "out": str(out_path), "geometry": geometry}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
