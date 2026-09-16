#!/usr/bin/env python3
"""Plan nearest-neighbor continuous routing through quilting DXF polylines."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from longarm_geometry import Point, Polyline, distance, parse_dxf_polylines, path_length


def nearest_route(items: list[tuple[int, Polyline]]) -> dict:
    if not items:
        return {
            "shape_count": 0,
            "draw_length": 0.0,
            "travel_length": 0.0,
            "max_travel": 0.0,
            "route": [],
            "travel_segments": [],
        }

    unused = items[:]
    start_index = min(
        range(len(unused)),
        key=lambda idx: (unused[idx][1].points[0][0], unused[idx][1].points[0][1]),
    )
    first = unused.pop(start_index)
    route = [{"shape_index": first[0], "reversed": False}]
    current = first[1].points[-1]
    travel_segments: list[dict] = []
    draw_length = path_length(first[1].points)

    while unused:
        best: tuple[float, int, bool, Point, Point] | None = None
        for idx, (shape_index, shape) in enumerate(unused):
            start = shape.points[0]
            end = shape.points[-1]
            candidates = [
                (distance(current, start), idx, False, current, start),
                (distance(current, end), idx, True, current, end),
            ]
            local_best = min(candidates, key=lambda item: item[0])
            if best is None or local_best[0] < best[0]:
                best = local_best
        assert best is not None
        travel, idx, reversed_shape, from_point, to_point = best
        shape_index, shape = unused.pop(idx)
        travel_segments.append(
            {
                "from": [round(from_point[0], 5), round(from_point[1], 5)],
                "to": [round(to_point[0], 5), round(to_point[1], 5)],
                "length": round(travel, 5),
            }
        )
        route.append({"shape_index": shape_index, "reversed": reversed_shape})
        draw_length += path_length(shape.points)
        current = shape.points[0] if reversed_shape else shape.points[-1]

    travel_length = sum(segment["length"] for segment in travel_segments)
    return {
        "shape_count": len(items),
        "draw_length": round(draw_length, 5),
        "travel_length": round(travel_length, 5),
        "max_travel": round(max([segment["length"] for segment in travel_segments] or [0.0]), 5),
        "route": route,
        "travel_segments": travel_segments,
    }


def route_by_layer(shapes: list[Polyline], max_travel: float, strict: bool) -> dict:
    grouped: dict[str, list[tuple[int, Polyline]]] = defaultdict(list)
    for index, shape in enumerate(shapes):
        grouped[shape.layer].append((index, shape))

    failures: list[str] = []
    warnings: list[str] = []
    layers = {}
    total_travel = 0.0
    total_draw = 0.0
    long_travel_count = 0

    for layer, items in sorted(grouped.items()):
        routed = nearest_route(items)
        long_travels = [segment for segment in routed["travel_segments"] if segment["length"] > max_travel]
        routed["long_travel_count"] = len(long_travels)
        layers[layer] = routed
        total_travel += routed["travel_length"]
        total_draw += routed["draw_length"]
        long_travel_count += len(long_travels)
        if long_travels:
            message = f"Layer '{layer}' needs {len(long_travels)} travel move(s) longer than {max_travel:.3f} inches."
            if strict:
                failures.append(message)
            else:
                warnings.append(message)

    if not shapes:
        failures.append("DXF contains no usable polylines.")

    return {
        "passes": not failures,
        "failures": failures,
        "warnings": warnings,
        "totals": {
            "shape_count": len(shapes),
            "layer_count": len(layers),
            "draw_length": round(total_draw, 5),
            "planned_travel_length": round(total_travel, 5),
            "long_travel_count": long_travel_count,
            "max_travel_threshold": max_travel,
        },
        "layers": layers,
        "notes": [
            "This is a route-planning artifact, not a substitute for redigitizing continuous-line motifs.",
            "Long travel moves should normally become designed vines, frames, pearls, echoes, or explicit connector motifs.",
        ],
    }


def write_polyline(lines: list[str], layer: str, points: list[Point]) -> None:
    if len(points) < 2:
        return
    lines.extend(["0", "POLYLINE", "8", layer[:31] or "0", "66", "1", "70", "0"])
    for x, y in points:
        lines.extend(["0", "VERTEX", "8", layer[:31] or "0", "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
    lines.extend(["0", "SEQEND"])


def write_routed_dxf(path: Path, shapes: list[Polyline], manifest: dict) -> None:
    by_index = {index: shape for index, shape in enumerate(shapes)}
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
    ]
    for layer, data in manifest["layers"].items():
        for item in data["route"]:
            shape = by_index[item["shape_index"]]
            points = list(reversed(shape.points)) if item["reversed"] else shape.points
            write_polyline(lines, layer, points)
        for segment in data["travel_segments"]:
            write_polyline(
                lines,
                "travel-check",
                [(segment["from"][0], segment["from"][1]), (segment["to"][0], segment["to"][1])],
            )
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dxf", help="DXF to route.")
    parser.add_argument("--out", help="Optional route manifest JSON path.")
    parser.add_argument("--routed-dxf", help="Optional diagnostic DXF with route order and travel-check layer.")
    parser.add_argument("--max-travel", type=float, default=0.18, help="Travel warning threshold in inches.")
    parser.add_argument("--strict", action="store_true", help="Fail when any layer needs travel over the threshold.")
    parser.add_argument("--print-full", action="store_true", help="Print the full manifest instead of a compact summary.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    shapes = parse_dxf_polylines(Path(args.dxf))
    result = route_by_layer(shapes, args.max_travel, args.strict)
    text = json.dumps(result, indent=2)
    summary = {
        "passes": result["passes"],
        "failure_count": len(result["failures"]),
        "warning_count": len(result["warnings"]),
        "totals": result["totals"],
        "worst_layers": sorted(
            [
                {
                    "layer": layer,
                    "shape_count": data["shape_count"],
                    "travel_length": data["travel_length"],
                    "max_travel": data["max_travel"],
                    "long_travel_count": data["long_travel_count"],
                }
                for layer, data in result["layers"].items()
            ],
            key=lambda item: (item["long_travel_count"], item["max_travel"]),
            reverse=True,
        )[:8],
        "notes": result["notes"],
    }
    print(text if args.print_full else json.dumps(summary, indent=2))
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    if args.routed_dxf:
        write_routed_dxf(Path(args.routed_dxf), shapes, result)
    return 0 if result["passes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
