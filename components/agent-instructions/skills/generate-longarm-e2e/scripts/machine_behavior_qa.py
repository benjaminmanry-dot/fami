#!/usr/bin/env python3
"""Preflight a longarm quilting DXF for machine-motion risks."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from longarm_geometry import (
    bounds,
    closed_distance,
    distance,
    layer_summary,
    parse_dxf_polylines,
    path_length,
)


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * pct))))
    return ordered[index]


def turn_hotspots(shapes) -> list[dict]:
    hotspots: list[dict] = []
    for shape_index, shape in enumerate(shapes):
        for point_index, (a, b, c) in enumerate(zip(shape.points, shape.points[1:], shape.points[2:]), start=1):
            incoming = distance(a, b)
            outgoing = distance(b, c)
            if incoming < 1e-9 or outgoing < 1e-9:
                continue
            ux, uy = b[0] - a[0], b[1] - a[1]
            vx, vy = c[0] - b[0], c[1] - b[1]
            dot = max(-1.0, min(1.0, (ux * vx + uy * vy) / (incoming * outgoing)))
            hotspots.append(
                {
                    "shape_index": shape_index,
                    "layer": shape.layer,
                    "point_index": point_index,
                    "point": [round(b[0], 5), round(b[1], 5)],
                    "angle": round(math.degrees(math.acos(dot)), 3),
                    "incoming_segment": round(incoming, 5),
                    "outgoing_segment": round(outgoing, 5),
                }
            )
    return hotspots


def segment_hotspots(shapes) -> list[dict]:
    hotspots: list[dict] = []
    for shape_index, shape in enumerate(shapes):
        for segment_index, (a, b) in enumerate(zip(shape.points, shape.points[1:])):
            length = distance(a, b)
            hotspots.append(
                {
                    "shape_index": shape_index,
                    "layer": shape.layer,
                    "segment_index": segment_index,
                    "start": [round(a[0], 5), round(a[1], 5)],
                    "end": [round(b[0], 5), round(b[1], 5)],
                    "length": round(length, 5),
                }
            )
    return hotspots


def sample_hotspots(items: list[dict], *, sort_key: str, reverse: bool, limit: int = 12) -> list[dict]:
    return sorted(items, key=lambda item: item.get(sort_key, 0), reverse=reverse)[:limit]


def heading_degrees(a, b) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


def angle_delta_degrees(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def endpoint_pose(shape, *, sample_steps: int = 8) -> dict:
    points = shape.points
    if len(points) < 2:
        return {}

    start = points[0]
    end = points[-1]
    start_index = min(sample_steps, len(points) - 1)
    end_index = max(0, len(points) - sample_steps - 1)
    start_heading = heading_degrees(start, points[start_index])
    end_heading = heading_degrees(points[end_index], end)
    seam_delta = angle_delta_degrees(start_heading, end_heading)
    return {
        "shape_layer": shape.layer,
        "start_point": [round(start[0], 5), round(start[1], 5)],
        "end_point": [round(end[0], 5), round(end[1], 5)],
        "start_end_x_delta": round(end[0] - start[0], 5),
        "start_end_y_delta": round(end[1] - start[1], 5),
        "start_heading_degrees": round(start_heading, 3),
        "end_heading_degrees": round(end_heading, 3),
        "seam_tangent_delta_degrees": round(seam_delta, 3),
        "sample_steps": min(sample_steps, len(points) - 1),
        "review_note": "For horizontal repeatable paths, the start and end should share a horizontal plane and compatible tangent.",
    }


def write_hotspot_png(path: Path, dxf_path: Path, metrics: dict, size_px: int = 1400) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False

    shapes = parse_dxf_polylines(dxf_path)
    if not shapes:
        return False

    min_x, min_y, max_x, max_y = bounds(shapes)
    width = max(0.01, max_x - min_x)
    height = max(0.01, max_y - min_y)
    margin = max(width, height) * 0.06 + 0.15
    scale = min(size_px / (width + margin * 2), size_px / (height + margin * 2))
    image_w = max(240, int((width + margin * 2) * scale))
    image_h = max(180, int((height + margin * 2) * scale))

    def map_point(point) -> tuple[int, int]:
        x, y = point
        return (
            int(round((x - min_x + margin) * scale)),
            int(round((max_y - y + margin) * scale)),
        )

    image = Image.new("RGB", (image_w, image_h), (247, 247, 244))
    draw = ImageDraw.Draw(image)
    line_width = max(2, int(scale * 0.025))
    marker = max(5, min(12, int(scale * 0.05)))

    for shape in shapes:
        if len(shape.points) >= 2:
            draw.line([map_point(point) for point in shape.points], fill=(7, 95, 134), width=line_width, joint="curve")

    hotspots = metrics.get("hotspots") or {}

    def circle(point, fill, outline=(255, 255, 255), radius=marker) -> None:
        x, y = map_point(point)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill, outline=outline, width=max(1, radius // 3))

    def square(point, fill, outline=(255, 255, 255), radius=marker) -> None:
        x, y = map_point(point)
        draw.rectangle((x - radius, y - radius, x + radius, y + radius), fill=fill, outline=outline, width=max(1, radius // 3))

    def arrow(a, b, fill=(24, 54, 68)) -> None:
        ax, ay = map_point(a)
        bx, by = map_point(b)
        dx = bx - ax
        dy = by - ay
        length = math.hypot(dx, dy)
        if length < 1e-6:
            return
        ux, uy = dx / length, dy / length
        size = max(7, marker + 2)
        tip = (bx, by)
        base = (bx - ux * size, by - uy * size)
        left = (base[0] - uy * size * 0.48, base[1] + ux * size * 0.48)
        right = (base[0] + uy * size * 0.48, base[1] - ux * size * 0.48)
        draw.polygon([tip, left, right], fill=fill)

    def flow_samples(points: list[tuple[float, float]], count: int = 9) -> list[tuple[tuple[float, float], tuple[float, float]]]:
        if len(points) < 2:
            return []
        lengths = [distance(a, b) for a, b in zip(points, points[1:])]
        total = sum(lengths)
        if total < 1e-9:
            return []
        targets = [(index + 1) * total / (count + 1) for index in range(count)]
        samples: list[tuple[tuple[float, float], tuple[float, float]]] = []
        segment_start = points[0]
        walked = 0.0
        target_index = 0
        for segment_end, segment_length in zip(points[1:], lengths):
            while target_index < len(targets) and walked + segment_length >= targets[target_index]:
                offset = targets[target_index] - walked
                t = offset / max(segment_length, 1e-9)
                x = segment_start[0] + (segment_end[0] - segment_start[0]) * t
                y = segment_start[1] + (segment_end[1] - segment_start[1]) * t
                back_t = max(0.0, t - min(0.18, 0.14 / max(segment_length, 1e-9)))
                ax = segment_start[0] + (segment_end[0] - segment_start[0]) * back_t
                ay = segment_start[1] + (segment_end[1] - segment_start[1]) * back_t
                samples.append(((ax, ay), (x, y)))
                target_index += 1
            walked += segment_length
            segment_start = segment_end
        return samples

    primary_shape = max(shapes, key=lambda shape: path_length(shape.points))
    for a, b in flow_samples(primary_shape.points):
        arrow(a, b)
    circle(primary_shape.points[0], (40, 125, 82), radius=marker + 2)
    square(primary_shape.points[-1], (28, 70, 92), radius=marker + 2)

    for item in hotspots.get("cusps", []):
        circle(item.get("point", [0, 0]), (236, 158, 45), radius=max(4, marker - 1))
    for item in hotspots.get("reversals", []):
        circle(item.get("point", [0, 0]), (195, 50, 46), radius=marker + 1)
    for item in hotspots.get("tiny_segments", []):
        start = item.get("start")
        end = item.get("end")
        if isinstance(start, list) and isinstance(end, list) and len(start) >= 2 and len(end) >= 2:
            square(((start[0] + end[0]) / 2, (start[1] + end[1]) / 2), (117, 74, 150), radius=max(4, marker - 2))
    for item in hotspots.get("micro_segments", []):
        start = item.get("start")
        end = item.get("end")
        if isinstance(start, list) and isinstance(end, list) and len(start) >= 2 and len(end) >= 2:
            square(((start[0] + end[0]) / 2, (start[1] + end[1]) / 2), (206, 45, 128), radius=marker + 1)

    legend_x = 14
    legend_y = 12
    legend_rows = [
        ("start", (40, 125, 82)),
        ("end", (28, 70, 92)),
        ("flow", (24, 54, 68)),
        ("reversal", (195, 50, 46)),
        ("cusp", (236, 158, 45)),
        ("tiny segment", (117, 74, 150)),
        ("micro segment", (206, 45, 128)),
    ]
    box_w = 154
    box_h = 22 * len(legend_rows) + 12
    draw.rounded_rectangle((legend_x - 6, legend_y - 6, legend_x + box_w, legend_y + box_h), radius=6, fill=(255, 255, 255), outline=(214, 209, 199))
    for row, (label, color) in enumerate(legend_rows):
        y = legend_y + row * 22
        if label == "flow":
            draw.polygon([(legend_x + 13, y + 10), (legend_x + 1, y + 4), (legend_x + 1, y + 16)], fill=color)
        elif label == "end":
            draw.rectangle((legend_x, y + 4, legend_x + 12, y + 16), fill=color, outline=(255, 255, 255))
        else:
            draw.ellipse((legend_x, y + 4, legend_x + 12, y + 16), fill=color, outline=(255, 255, 255))
        draw.text((legend_x + 20, y + 1), label, fill=(31, 49, 56))

    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    return True


def qa(
    dxf_path: Path,
    *,
    min_segment: float,
    reversal_angle: float,
    cusp_angle: float,
    strict_continuous: bool,
    seam_tangent_check: bool,
    max_seam_tangent_delta: float,
    max_start_end_y_delta: float,
) -> dict:
    shapes = parse_dxf_polylines(dxf_path)
    failures: list[str] = []
    warnings: list[str] = []

    if not shapes:
        return {
            "passes": False,
            "failures": ["DXF contains no usable polylines."],
            "warnings": [],
            "metrics": {},
        }

    segment_details = segment_hotspots(shapes)
    turn_details = turn_hotspots(shapes)
    all_segments = [item["length"] for item in segment_details]
    all_angles = [item["angle"] for item in turn_details]
    total_length = sum(path_length(shape.points) for shape in shapes)
    min_x, min_y, max_x, max_y = bounds(shapes)
    primary_shape = max(shapes, key=lambda shape: path_length(shape.points))
    endpoints = endpoint_pose(primary_shape)

    micro_segments = [item for item in segment_details if item["length"] < min_segment]
    tiny_segments = [item for item in segment_details if min_segment <= item["length"] < min_segment * 2.5]
    reversals = [item for item in turn_details if item["angle"] >= reversal_angle]
    cusps = [item for item in turn_details if cusp_angle <= item["angle"] < reversal_angle]
    tiny_closed_loops = [
        shape
        for shape in shapes
        if closed_distance(shape) < min_segment * 4 and path_length(shape.points) < min_segment * 35
    ]

    if strict_continuous and len(shapes) > 1:
        failures.append("Strict continuous mode expects one ordered stitch path; DXF has multiple polylines.")
    if len(micro_segments) > max(3, len(all_segments) * 0.01):
        failures.append("Too many micro-segments for reliable computerized longarm motion.")
    elif micro_segments:
        warnings.append("A few micro-segments are present; review at machine scale before release.")
    if reversals:
        warnings.append("Potential hard reversals are present; inspect petal tips, heart clefts, and tight scrolls.")
    if len(cusps) > max(40, len(all_angles) * 0.08):
        warnings.append("Many high-angle turns are present; smooth curves where the look does not require a cusp.")
    if tiny_closed_loops:
        warnings.append("Tiny closed loops may over-stitch or knot on dense thread/fabric combinations.")
    if seam_tangent_check and endpoints:
        y_delta = abs(float(endpoints.get("start_end_y_delta", 0.0)))
        seam_delta = float(endpoints.get("seam_tangent_delta_degrees", 0.0))
        if y_delta > max_start_end_y_delta:
            warnings.append(
                f"Repeat endpoints are {y_delta:.5f} inches apart vertically; horizontal chaining may stair-step."
            )
        if seam_delta > max_seam_tangent_delta:
            warnings.append(
                f"Repeat seam tangent changes {seam_delta:.1f} degrees; inspect the join for a visible stitch-path hitch."
            )

    metrics = {
        "shape_count": len(shapes),
        "layer_count": len({shape.layer for shape in shapes}),
        "bounds": [round(min_x, 4), round(min_y, 4), round(max_x, 4), round(max_y, 4)],
        "total_drawn_length": round(total_length, 4),
        "segment_count": len(all_segments),
        "min_segment": round(min(all_segments), 5) if all_segments else 0,
        "p01_segment": round(percentile(all_segments, 0.01), 5),
        "median_segment": round(percentile(all_segments, 0.5), 5),
        "p95_segment": round(percentile(all_segments, 0.95), 5),
        "max_segment": round(max(all_segments), 5) if all_segments else 0,
        "micro_segment_count": len(micro_segments),
        "tiny_segment_count": len(tiny_segments),
        "cusp_turn_count": len(cusps),
        "reversal_turn_count": len(reversals),
        "tiny_closed_loop_count": len(tiny_closed_loops),
        "endpoint_review": endpoints,
        "seam_tangent_checked": seam_tangent_check,
        "seam_tangent_delta_degrees": endpoints.get("seam_tangent_delta_degrees") if endpoints else None,
        "start_end_y_delta": endpoints.get("start_end_y_delta") if endpoints else None,
        "layer_summary": layer_summary(shapes),
        "hotspots": {
            "reversals": sample_hotspots(reversals, sort_key="angle", reverse=True),
            "cusps": sample_hotspots(cusps, sort_key="angle", reverse=True),
            "micro_segments": sample_hotspots(micro_segments, sort_key="length", reverse=False),
            "tiny_segments": sample_hotspots(tiny_segments, sort_key="length", reverse=False),
            "note": "Coordinates are in DXF units and identify review areas, not automatic defects.",
        },
    }

    return {
        "passes": not failures,
        "failures": failures,
        "warnings": warnings,
        "metrics": metrics,
        "thresholds": {
            "min_segment": min_segment,
            "cusp_angle": cusp_angle,
            "reversal_angle": reversal_angle,
            "strict_continuous": strict_continuous,
            "seam_tangent_check": seam_tangent_check,
            "max_seam_tangent_delta": max_seam_tangent_delta,
            "max_start_end_y_delta": max_start_end_y_delta,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dxf", help="DXF file to preflight.")
    parser.add_argument("--out", help="Optional JSON output path.")
    parser.add_argument("--hotspot-png", help="Optional PNG path for a visual machine-hotspot overlay.")
    parser.add_argument("--min-segment", type=float, default=0.003, help="Failure threshold in inches.")
    parser.add_argument("--cusp-angle", type=float, default=135.0, help="Warning threshold for sharp turns.")
    parser.add_argument("--reversal-angle", type=float, default=172.0, help="Warning threshold for near-reversals.")
    parser.add_argument("--strict-continuous", action="store_true", help="Fail if the DXF is not one ordered path.")
    parser.add_argument("--seam-tangent-check", action="store_true", help="Warn on endpoint plane or tangent mismatch for repeatable paths.")
    parser.add_argument("--max-seam-tangent-delta", type=float, default=45.0, help="Warning threshold in degrees for repeat start/end tangent mismatch.")
    parser.add_argument("--max-start-end-y-delta", type=float, default=0.001, help="Warning threshold in inches for horizontal repeat endpoint plane mismatch.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dxf_path = Path(args.dxf)
    result = qa(
        dxf_path,
        min_segment=args.min_segment,
        cusp_angle=args.cusp_angle,
        reversal_angle=args.reversal_angle,
        strict_continuous=args.strict_continuous,
        seam_tangent_check=args.seam_tangent_check,
        max_seam_tangent_delta=args.max_seam_tangent_delta,
        max_start_end_y_delta=args.max_start_end_y_delta,
    )
    if args.hotspot_png and result.get("metrics"):
        hotspot_path = Path(args.hotspot_png)
        if write_hotspot_png(hotspot_path, dxf_path, result["metrics"]):
            result["metrics"]["hotspot_preview"] = str(hotspot_path)
            result["metrics"]["flow_overlay"] = {
                "version": "start-end-direction-v1",
                "arrow_count": 9,
                "review_note": "Overlay marks the ordered stitch path with start, end, and directional flow arrows.",
            }
        else:
            result["metrics"]["hotspot_preview_error"] = "Hotspot PNG could not be created."
    text = json.dumps(result, indent=2)
    print(text)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    return 0 if result["passes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
