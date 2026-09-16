#!/usr/bin/env python3
"""Build smooth continuous-line E2E longarm quilting pattern scaffolds.

Outputs SVG, DXF R12, HPGL/PLT, TXT points, previews, and QA notes.
The script is intentionally format-conservative: proprietary longarm
formats should be produced only by verified downstream tooling.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


Point = tuple[float, float]


PRESETS = {
    "botanical-vine": "Alternating leaves, curls, and a soft vine rhythm.",
    "feather-vine": "Open feather plumes on a flowing spine.",
    "shell-echo": "Nested shell arcs with gentle echo fill.",
    "modern-ribbon": "Clean contemporary ribbon waves with restrained echoes.",
    "pearl-scroll": "Scrollwork with small pearl accents for gap control.",
}

REPEAT_BASELINE_TOLERANCE = 0.001


@dataclass
class PatternSpec:
    name: str
    repeat_width: float
    row_height: float
    row_advance: float
    alternate_offset: float
    stitch_spacing: float
    waypoints: list[Point]


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "longarm-e2e"


def fnum(value: float) -> str:
    text = f"{value:.4f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def dist(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def lerp(a: Point, b: Point, t: float) -> Point:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: float) -> Point:
    mt = 1.0 - t
    return (
        mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0],
        mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1],
    )


def scale_points(raw: Sequence[Point], width: float, row_height: float) -> list[Point]:
    return [(x * width, y * row_height) for x, y in raw]


def preset_waypoints(preset: str, width: float, row_height: float) -> list[Point]:
    # Coordinates are normalized: x is repeat width, y is row height centered on baseline.
    if preset == "botanical-vine":
        raw = [
            (0.000, 0.000), (0.035, 0.020), (0.075, 0.180), (0.125, 0.320),
            (0.180, 0.255), (0.205, 0.080), (0.150, -0.010), (0.100, 0.105),
            (0.145, 0.220), (0.215, 0.135), (0.265, 0.000), (0.315, -0.250),
            (0.390, -0.330), (0.440, -0.110), (0.385, 0.045), (0.315, -0.035),
            (0.350, -0.180), (0.425, -0.160), (0.490, 0.000), (0.545, 0.275),
            (0.625, 0.345), (0.680, 0.110), (0.620, -0.045), (0.550, 0.040),
            (0.585, 0.190), (0.660, 0.175), (0.735, 0.000), (0.785, -0.220),
            (0.855, -0.305), (0.915, -0.100), (0.875, 0.040), (0.810, -0.025),
            (0.845, -0.165), (0.925, -0.120), (0.965, -0.015), (1.000, 0.000),
        ]
    elif preset == "feather-vine":
        raw = [
            (0.000, 0.000), (0.045, 0.015), (0.095, 0.120), (0.140, 0.315),
            (0.205, 0.395), (0.255, 0.190), (0.210, 0.045), (0.140, 0.020),
            (0.205, 0.255), (0.305, 0.315), (0.360, 0.055), (0.305, -0.025),
            (0.240, -0.155), (0.295, -0.365), (0.390, -0.330), (0.430, -0.060),
            (0.365, 0.020), (0.455, 0.050), (0.500, 0.000), (0.545, 0.015),
            (0.610, 0.265), (0.705, 0.370), (0.765, 0.105), (0.700, 0.005),
            (0.625, 0.055), (0.695, 0.260), (0.805, 0.240), (0.850, 0.015),
            (0.800, -0.055), (0.735, -0.205), (0.790, -0.370), (0.900, -0.300),
            (0.940, -0.060), (0.895, 0.005), (0.960, -0.015), (1.000, 0.000),
        ]
    elif preset == "shell-echo":
        raw = [
            (0.000, 0.000), (0.045, 0.030), (0.090, 0.210), (0.160, 0.355),
            (0.240, 0.230), (0.280, 0.000), (0.235, -0.155), (0.160, -0.235),
            (0.105, -0.120), (0.150, 0.055), (0.245, 0.095), (0.330, 0.000),
            (0.385, 0.245), (0.485, 0.365), (0.570, 0.115), (0.525, -0.055),
            (0.430, -0.105), (0.385, 0.030), (0.455, 0.165), (0.580, 0.115),
            (0.665, 0.000), (0.720, -0.245), (0.820, -0.360), (0.910, -0.120),
            (0.875, 0.055), (0.775, 0.105), (0.725, -0.020), (0.790, -0.165),
            (0.925, -0.120), (0.965, -0.015), (1.000, 0.000),
        ]
    elif preset == "modern-ribbon":
        raw = [
            (0.000, 0.000), (0.055, 0.060), (0.115, 0.270), (0.195, 0.315),
            (0.270, 0.090), (0.230, -0.135), (0.140, -0.180), (0.100, -0.010),
            (0.185, 0.085), (0.300, 0.035), (0.380, 0.000), (0.455, -0.260),
            (0.565, -0.290), (0.640, -0.015), (0.570, 0.160), (0.465, 0.155),
            (0.425, 0.000), (0.520, -0.080), (0.650, -0.025), (0.735, 0.000),
            (0.795, 0.260), (0.895, 0.280), (0.965, 0.035), (0.935, -0.115),
            (0.850, -0.150), (0.815, -0.005), (0.905, 0.075), (0.970, 0.010),
            (1.000, 0.000),
        ]
    elif preset == "pearl-scroll":
        raw = [
            (0.000, 0.000), (0.035, 0.000), (0.070, 0.120), (0.055, 0.215),
            (0.020, 0.180), (0.055, 0.065), (0.135, 0.045), (0.215, 0.210),
            (0.300, 0.280), (0.365, 0.070), (0.300, -0.060), (0.225, 0.010),
            (0.255, 0.145), (0.355, 0.155), (0.450, 0.000), (0.500, -0.210),
            (0.610, -0.285), (0.690, -0.055), (0.630, 0.060), (0.545, -0.015),
            (0.580, -0.150), (0.690, -0.125), (0.760, 0.000), (0.810, 0.175),
            (0.875, 0.220), (0.920, 0.080), (0.885, -0.005), (0.845, 0.060),
            (0.895, 0.130), (0.965, 0.015), (1.000, 0.000),
        ]
    else:
        raise ValueError(f"Unknown preset: {preset}")
    return scale_points(raw, width, row_height)


def load_spec(args: argparse.Namespace) -> PatternSpec:
    if args.spec:
        data = json.loads(Path(args.spec).read_text(encoding="utf-8"))
        waypoints = [tuple(map(float, p)) for p in data["waypoints"]]
        return PatternSpec(
            name=args.name or data.get("name", "Custom Longarm E2E"),
            repeat_width=float(data.get("repeat_width", args.width or 12.0)),
            row_height=float(data.get("row_height", args.row_height or 6.0)),
            row_advance=float(data.get("row_advance", args.row_advance or 4.4)),
            alternate_offset=float(data.get("alternate_offset", args.offset or 6.0)),
            stitch_spacing=float(data.get("stitch_spacing", args.stitch_spacing or 0.04)),
            waypoints=waypoints,
        )

    width = float(args.width or 12.0)
    row_height = float(args.row_height or 6.0)
    offset = float(args.offset if args.offset is not None else width / 2.0)
    row_advance = float(args.row_advance or row_height * 0.58)
    name = args.name or f"{args.preset.replace('-', ' ').title()} E2E"
    return PatternSpec(
        name=name,
        repeat_width=width,
        row_height=row_height,
        row_advance=row_advance,
        alternate_offset=offset,
        stitch_spacing=float(args.stitch_spacing or 0.04),
        waypoints=preset_waypoints(args.preset, width, row_height),
    )


def catmull_segments(points: Sequence[Point], tension: float = 0.92) -> list[tuple[Point, Point, Point, Point]]:
    segments = []
    for i in range(len(points) - 1):
        p0 = points[i - 1] if i > 0 else points[i]
        p1 = points[i]
        p2 = points[i + 1]
        p3 = points[i + 2] if i + 2 < len(points) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) * tension / 6.0, p1[1] + (p2[1] - p0[1]) * tension / 6.0)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension / 6.0, p2[1] - (p3[1] - p1[1]) * tension / 6.0)
        segments.append((p1, c1, c2, p2))
    return segments


def svg_path(points: Sequence[Point]) -> str:
    segments = catmull_segments(points)
    if not segments:
        return ""
    d = [f"M {fnum(points[0][0])} {fnum(points[0][1])}"]
    for _, c1, c2, p2 in segments:
        d.append(
            "C "
            f"{fnum(c1[0])} {fnum(c1[1])}, "
            f"{fnum(c2[0])} {fnum(c2[1])}, "
            f"{fnum(p2[0])} {fnum(p2[1])}"
        )
    return " ".join(d)


def sample_path(points: Sequence[Point], spacing: float) -> list[Point]:
    sampled: list[Point] = []
    for p0, c1, c2, p3 in catmull_segments(points):
        chord = max(dist(p0, c1) + dist(c1, c2) + dist(c2, p3), dist(p0, p3))
        steps = max(8, int(math.ceil(chord / max(spacing, 0.01))))
        for step in range(steps):
            if sampled and step == 0:
                continue
            sampled.append(cubic(p0, c1, c2, p3, step / steps))
    sampled.append(points[-1])
    return sampled


def bounds(points: Iterable[Point]) -> tuple[float, float, float, float]:
    pts = list(points)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def transform(points: Iterable[Point], dx: float, dy: float) -> list[Point]:
    return [(x + dx, y + dy) for x, y in points]


def angle(a: Point, b: Point) -> float:
    return math.atan2(b[1] - a[1], b[0] - a[0])


def angle_delta(a: float, b: float) -> float:
    value = abs((a - b + math.pi) % (2 * math.pi) - math.pi)
    return math.degrees(value)


def polyline_min_distance(a: Sequence[Point], b: Sequence[Point]) -> float:
    # A light-weight vertex distance approximation is enough for QA warnings.
    step_a = max(1, len(a) // 350)
    step_b = max(1, len(b) // 350)
    best = float("inf")
    for pa in a[::step_a]:
        for pb in b[::step_b]:
            d = dist(pa, pb)
            if d < best:
                best = d
    return best


def backtracking_report(sampled: Sequence[Point], tolerance: float = 0.006) -> tuple[int, float]:
    """Detect direct segment retracing at a machine-scale tolerance.

    This catches the common digitizing failure where a connector is stitched out
    and then immediately or later stitched back along the same segment. It is not
    a general-purpose art critic; visual review is still required.
    """
    seen: dict[tuple[tuple[int, int], tuple[int, int]], int] = {}
    reversals = 0
    total = 0.0
    for idx in range(len(sampled) - 1):
        a = sampled[idx]
        b = sampled[idx + 1]
        length = dist(a, b)
        if length < tolerance:
            continue
        qa = (round(a[0] / tolerance), round(a[1] / tolerance))
        qb = (round(b[0] / tolerance), round(b[1] / tolerance))
        key = (qa, qb)
        reverse = (qb, qa)
        if reverse in seen and idx - seen[reverse] > 2:
            reversals += 1
            total += length
        seen[key] = idx
    return reversals, total


def quality_report(
    spec: PatternSpec,
    sampled: Sequence[Point],
    *,
    repeat_mode: bool = True,
    baseline_tolerance: float = REPEAT_BASELINE_TOLERANCE,
) -> tuple[list[str], dict[str, float]]:
    warnings: list[str] = []
    min_x, min_y, max_x, max_y = bounds(sampled)
    actual_height = max_y - min_y
    actual_width = max_x - min_x
    start = sampled[0]
    end = sampled[-1]
    start_edge_delta = abs(start[0])
    end_edge_delta = abs(end[0] - spec.repeat_width)
    baseline_delta = abs(end[1] - start[1])

    if repeat_mode:
        if start_edge_delta > baseline_tolerance:
            warnings.append(f"Start point is {start_edge_delta:.3f} in from the left repeat edge.")
        if end_edge_delta > baseline_tolerance:
            warnings.append(f"End point is {end_edge_delta:.3f} in from the right repeat edge.")
        if baseline_delta > baseline_tolerance:
            warnings.append(
                f"Start/end horizontal-plane mismatch is {baseline_delta:.4f} in; "
                "computerized longarm repeats will step instead of chaining cleanly."
            )
        if abs(actual_width - spec.repeat_width) > 0.02:
            warnings.append(f"Actual width {actual_width:.3f} differs from repeat width {spec.repeat_width:.3f}.")
    if actual_height > spec.row_height * 1.02:
        warnings.append(f"Path height {actual_height:.3f} exceeds requested row height {spec.row_height:.3f}.")
    if actual_height < spec.row_height * 0.45:
        warnings.append("Path uses less than 45% of the design height; the quilting may look thin.")
    if repeat_mode:
        if spec.row_advance > actual_height * 1.02:
            warnings.append("Row advance may leave visible horizontal channels; tighten it for a nested E2E.")
        if spec.row_advance < actual_height * 0.50:
            warnings.append("Row advance is very tight; machine-test for crowding.")

    if repeat_mode and len(sampled) > 12:
        start_tangent = angle(sampled[0], sampled[min(8, len(sampled) - 1)])
        end_tangent = angle(sampled[-min(9, len(sampled))], sampled[-1])
        seam_delta = angle_delta(start_tangent, end_tangent)
        if seam_delta > 35:
            warnings.append(f"Horizontal repeat tangent changes {seam_delta:.1f} degrees at the seam.")
    else:
        seam_delta = 0.0

    if repeat_mode:
        next_row = transform(sampled, spec.alternate_offset, spec.row_advance)
        row_clearance = polyline_min_distance(sampled, next_row)
        if row_clearance < 0.08:
            warnings.append(f"Nested row clearance is only {row_clearance:.3f} in; check for collisions.")
        if row_clearance > spec.row_height * 0.34:
            warnings.append(f"Nested row clearance is {row_clearance:.3f} in; rows may read as separate stripes.")
    else:
        row_clearance = 0.0

    backtrack_count, backtrack_length = backtracking_report(sampled)
    if backtrack_length > 0.05:
        warnings.append(
            f"Potential backtracking detected: {backtrack_count} reversed segments totaling about {backtrack_length:.3f} in."
        )

    metrics = {
        "actual_width": actual_width,
        "actual_height": actual_height,
        "start_x": start[0],
        "start_y": start[1],
        "end_x": end[0],
        "end_y": end[1],
        "start_edge_delta": start_edge_delta,
        "end_edge_delta": end_edge_delta,
        "baseline_delta": baseline_delta,
        "min_y": min_y,
        "max_y": max_y,
        "point_count": float(len(sampled)),
        "seam_tangent_delta_degrees": seam_delta,
        "nested_row_clearance": row_clearance,
        "backtrack_count": float(backtrack_count),
        "backtrack_length": backtrack_length,
    }
    return warnings, metrics


def svg_document(content: str, view_box: tuple[float, float, float, float], title: str) -> str:
    min_x, min_y, width, height = view_box
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="{fnum(min_x)} {fnum(min_y)} {fnum(width)} {fnum(height)}" width="{fnum(width)}in" height="{fnum(height)}in">
  <title>{title}</title>
  <rect x="{fnum(min_x)}" y="{fnum(min_y)}" width="{fnum(width)}" height="{fnum(height)}" fill="#fbf7ef"/>
{content}
</svg>
'''


def write_single_svg(path: Path, spec: PatternSpec, sampled: Sequence[Point]) -> None:
    min_x, min_y, max_x, max_y = bounds(sampled)
    margin = max(spec.row_height * 0.08, 0.25)
    d = svg_path(spec.waypoints)
    content = f'''  <path d="{d}" fill="none" stroke="#103f4a" stroke-width="0.035" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="{fnum(sampled[0][0])}" cy="{fnum(sampled[0][1])}" r="0.12" fill="#25a04a"/>
  <circle cx="{fnum(sampled[-1][0])}" cy="{fnum(sampled[-1][1])}" r="0.12" fill="#dd4b12"/>
'''
    doc = svg_document(
        content,
        (min_x - margin, min_y - margin, (max_x - min_x) + margin * 2, (max_y - min_y) + margin * 2),
        f"{spec.name} single row preview",
    )
    path.write_text(doc, encoding="utf-8")


def write_nested_svg(path: Path, spec: PatternSpec, sampled: Sequence[Point], rows: int, repeats: int) -> None:
    d = svg_path(spec.waypoints)
    colors = ["#103f4a", "#3f6f52", "#6b4c86", "#9b5a2e"]
    parts = []
    all_points: list[Point] = []
    for row in range(rows):
        dx_row = spec.alternate_offset if row % 2 else 0.0
        dy_row = row * spec.row_advance
        for col in range(repeats):
            dx = dx_row + col * spec.repeat_width
            color = colors[row % len(colors)]
            parts.append(
                f'''  <path d="{d}" transform="translate({fnum(dx)} {fnum(dy_row)})" fill="none" stroke="{color}" stroke-width="0.028" stroke-linecap="round" stroke-linejoin="round"/>'''
            )
            all_points.extend(transform(sampled, dx, dy_row))
    min_x, min_y, max_x, max_y = bounds(all_points)
    margin = max(spec.row_height * 0.08, 0.25)
    doc = svg_document(
        "\n".join(parts) + "\n",
        (min_x - margin, min_y - margin, (max_x - min_x) + margin * 2, (max_y - min_y) + margin * 2),
        f"{spec.name} nested repeat preview",
    )
    path.write_text(doc, encoding="utf-8")


def write_pattern_svg(path: Path, spec: PatternSpec, sampled: Sequence[Point]) -> None:
    min_x, min_y, max_x, max_y = bounds(sampled)
    margin = 0.05
    d = svg_path(spec.waypoints)
    content = f'''  <path id="{slugify(spec.name)}" d="{d}" fill="none" stroke="#000000" stroke-width="0.01" stroke-linecap="round" stroke-linejoin="round"/>'''
    doc = svg_document(
        content,
        (min_x - margin, min_y - margin, (max_x - min_x) + margin * 2, (max_y - min_y) + margin * 2),
        spec.name,
    )
    path.write_text(doc, encoding="utf-8")


def write_txt(path: Path, spec: PatternSpec, sampled: Sequence[Point]) -> None:
    lines = [
        f"# {spec.name}",
        "# x_in,y_in",
    ]
    lines.extend(f"{x:.5f},{y:.5f}" for x, y in sampled)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_dxf(path: Path, spec: PatternSpec, sampled: Sequence[Point]) -> None:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0", "POLYLINE",
        "8", "0", "66", "1", "70", "0",
    ]
    for x, y in sampled:
        lines.extend(["0", "VERTEX", "8", "0", "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
    lines.extend(["0", "SEQEND", "0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_plt(path: Path, sampled: Sequence[Point]) -> None:
    scale = 1016  # HPGL plotter units per inch.
    if not sampled:
        path.write_text("IN;SP0;\n", encoding="utf-8")
        return
    coords = [(round(x * scale), round(y * scale)) for x, y in sampled]
    chunks = ["IN;SP1;", f"PU{coords[0][0]},{coords[0][1]};", "PD"]
    current = []
    for x, y in coords[1:]:
        current.append(f"{x},{y}")
        if len(current) >= 80:
            chunks.append(",".join(current) + ";")
            current = []
    if current:
        chunks.append(",".join(current) + ";")
    chunks.append("PU;SP0;")
    path.write_text("\n".join(chunks) + "\n", encoding="utf-8")


def write_readme(
    path: Path,
    spec: PatternSpec,
    metrics: dict[str, float],
    warnings: Sequence[str],
    files: Sequence[str],
    *,
    repeat_mode: bool = True,
) -> None:
    status = "PASS" if not warnings else "REVIEW"
    mode = "E2E computerized-longarm repeat" if repeat_mode else "Continuous-line computerized-longarm layout"
    lines = [
        f"# {spec.name}",
        "",
        f"QA status: {status}",
        "",
        f"- Design mode: {mode}",
        "- Continuous stitch path: yes, single ordered point stream",
        f"- Start point: {metrics['start_x']:.3f}, {metrics['start_y']:.3f}",
        f"- End point: {metrics['end_x']:.3f}, {metrics['end_y']:.3f}",
        f"- Start/end horizontal-plane delta: {metrics['baseline_delta']:.5f} in",
        f"- Design bounds: {metrics['actual_width']:.3f} in wide by {metrics['actual_height']:.3f} in tall",
        f"- Approximate stitch spacing: {spec.stitch_spacing:.4f} in",
        f"- Point count: {int(metrics['point_count'])}",
        f"- Potential backtracking: {int(metrics.get('backtrack_count', 0))} reversed segments",
    ]
    if repeat_mode:
        lines.extend(
            [
                f"- Repeat width: {spec.repeat_width:.3f} in",
                f"- Recommended vertical row advance: {spec.row_advance:.3f} in",
                f"- Recommended alternate-row offset: {spec.alternate_offset:.3f} in",
                f"- Horizontal seam tangent delta: {metrics['seam_tangent_delta_degrees']:.1f} degrees",
                f"- Estimated nested row clearance: {metrics['nested_row_clearance']:.3f} in",
            ]
        )
    else:
        lines.append(f"- Layout width: {spec.repeat_width:.3f} in")
    lines.extend(["", "Generated files:"])
    lines.extend(f"- {name}" for name in files)
    if warnings:
        lines.extend(["", "QA warnings:"])
        lines.extend(f"- {warning}" for warning in warnings)
    lines.extend(["", "Machine-test before customer release."])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_hqv_with_converter(input_svg: Path, output_hqv: Path, converter: str | None) -> None:
    converter = converter or os.environ.get("LONGARM_HQV_CONVERTER")
    if not converter:
        raise RuntimeError(
            "HQV export requires Pro-Stitcher Designer/Studio or another verified converter. "
            "Set LONGARM_HQV_CONVERTER or pass --hqv-converter."
        )
    if "{input}" in converter or "{output}" in converter:
        command = converter.format(input=str(input_svg), output=str(output_hqv))
        subprocess.run(command, shell=True, check=True)
    else:
        subprocess.run([converter, str(input_svg), str(output_hqv)], check=True)
    if not output_hqv.exists() or output_hqv.stat().st_size == 0:
        raise RuntimeError(f"HQV converter did not create a usable file: {output_hqv}")


def build_outputs(
    spec: PatternSpec,
    out_dir: Path,
    preview_rows: int,
    preview_repeats: int,
    strict: bool,
    hqv_converter: str | None = None,
    require_hqv: bool = False,
    repeat_mode: bool = True,
    qa_artifacts: bool = False,
) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    sampled = sample_path(spec.waypoints, spec.stitch_spacing)
    warnings, metrics = quality_report(spec, sampled, repeat_mode=repeat_mode)
    base = slugify(spec.name)

    files = [f"{base}.dxf"]
    readme_name = "README.md"
    write_dxf(out_dir / files[0], spec, sampled)

    if qa_artifacts:
        qa_files = [
            "single-row-preview.svg",
            "nested-repeat-preview.svg",
            f"{base}.svg",
            f"{base}.plt",
            f"{base}.txt",
            "README.md",
        ]
        files.extend(qa_files)
        write_single_svg(out_dir / qa_files[0], spec, sampled)
        write_nested_svg(out_dir / qa_files[1], spec, sampled, preview_rows, preview_repeats)
        write_pattern_svg(out_dir / qa_files[2], spec, sampled)
        write_plt(out_dir / qa_files[3], sampled)
        write_txt(out_dir / qa_files[4], spec, sampled)

    if qa_artifacts and (hqv_converter or require_hqv or os.environ.get("LONGARM_HQV_CONVERTER")):
        hqv_name = f"{base}.hqv"
        try:
            write_hqv_with_converter(out_dir / f"{base}.svg", out_dir / hqv_name, hqv_converter)
            files.insert(-1, hqv_name)
        except Exception as exc:
            warnings.append(f"HQV export failed: {exc}")
            if require_hqv:
                write_readme(out_dir / readme_name, spec, metrics, warnings, files, repeat_mode=repeat_mode)
                print(f"Wrote {len(files)} files to {out_dir}")
                print("QA status: REVIEW")
                print(f"WARNING: HQV export failed: {exc}")
                return 1
    elif require_hqv:
        warnings.append("HQV export was requested, but the current default workflow is DXF-only. Rerun with --qa-artifacts and a verified converter.")
        print(f"Wrote {len(files)} files to {out_dir}")
        print("QA status: REVIEW")
        for warning in warnings:
            print(f"WARNING: {warning}")
        return 1

    if qa_artifacts:
        write_readme(out_dir / readme_name, spec, metrics, warnings, files, repeat_mode=repeat_mode)

    print(f"Wrote {len(files)} files to {out_dir}")
    print(f"QA status: {'PASS' if not warnings else 'REVIEW'}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    return 1 if strict and warnings else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-presets", action="store_true", help="List built-in motif presets and exit.")
    parser.add_argument("--preset", default="botanical-vine", choices=sorted(PRESETS), help="Built-in motif family.")
    parser.add_argument("--spec", help="Custom JSON spec with name, measurements, and waypoints.")
    parser.add_argument("--name", help="Pattern name.")
    parser.add_argument("--out", default="./longarm-e2e-output", help="Output directory.")
    parser.add_argument("--width", type=float, help="Repeat width in inches.")
    parser.add_argument("--row-height", type=float, help="Nominal row design height in inches.")
    parser.add_argument("--row-advance", type=float, help="Recommended vertical row advance in inches.")
    parser.add_argument("--offset", type=float, help="Alternate-row horizontal offset in inches.")
    parser.add_argument("--stitch-spacing", type=float, default=0.04, help="Approximate point spacing in inches.")
    parser.add_argument("--preview-rows", type=int, default=4, help="Rows in nested preview.")
    parser.add_argument("--preview-repeats", type=int, default=4, help="Horizontal repeats in nested preview.")
    parser.add_argument("--qa-artifacts", action="store_true", help="Also write preview SVGs, PLT/TXT point files, and README QA notes. Default writes only DXF.")
    parser.add_argument("--hqv-converter", help="Verified SVG-to-HQV converter command or executable. Use {input} and {output} placeholders if needed.")
    parser.add_argument("--require-hqv", action="store_true", help="Fail if a real HQV file cannot be generated.")
    parser.add_argument("--strict", action="store_true", help="Exit nonzero when QA warnings are emitted.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.list_presets:
        for name, description in sorted(PRESETS.items()):
            print(f"{name}: {description}")
        return 0
    spec = load_spec(args)
    return build_outputs(
        spec,
        Path(args.out),
        args.preview_rows,
        args.preview_repeats,
        args.strict,
        hqv_converter=args.hqv_converter,
        require_hqv=args.require_hqv,
        qa_artifacts=args.qa_artifacts,
    )


if __name__ == "__main__":
    raise SystemExit(main())
