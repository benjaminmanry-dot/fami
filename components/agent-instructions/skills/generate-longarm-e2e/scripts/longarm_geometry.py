#!/usr/bin/env python3
"""Shared geometry helpers for longarm quilting DXF review scripts."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


Point = tuple[float, float]


@dataclass
class Polyline:
    layer: str
    points: list[Point]


def parse_dxf_polylines(path: Path) -> list[Polyline]:
    tokens = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    shapes: list[Polyline] = []
    current: Polyline | None = None
    i = 0
    while i < len(tokens) - 1:
        code = tokens[i].strip()
        value = tokens[i + 1].strip()
        if code == "0" and value == "POLYLINE":
            current = Polyline(layer="0", points=[])
            shapes.append(current)
        elif current is not None and code == "8":
            current.layer = value
        elif current is not None and code == "0" and value == "VERTEX":
            x = y = None
            j = i + 2
            while j < len(tokens) - 1:
                c = tokens[j].strip()
                v = tokens[j + 1].strip()
                if c == "0":
                    break
                if c == "10":
                    try:
                        x = float(v)
                    except ValueError:
                        x = None
                elif c == "20":
                    try:
                        y = float(v)
                    except ValueError:
                        y = None
                j += 2
            if x is not None and y is not None:
                current.points.append((x, y))
        elif code == "0" and value == "SEQEND":
            current = None
        i += 2
    return [shape for shape in shapes if len(shape.points) >= 2]


def path_length(points: list[Point]) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:]))


def shape_length(shape: Polyline) -> float:
    return path_length(shape.points)


def all_points(shapes: Iterable[Polyline]) -> list[Point]:
    return [point for shape in shapes for point in shape.points]


def bounds_from_points(points: list[Point]) -> tuple[float, float, float, float]:
    if not points:
        return (0.0, 0.0, 0.0, 0.0)
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return (min(xs), min(ys), max(xs), max(ys))


def bounds(shapes: Iterable[Polyline]) -> tuple[float, float, float, float]:
    return bounds_from_points(all_points(shapes))


def shape_bounds(shape: Polyline) -> tuple[float, float, float, float]:
    return bounds_from_points(shape.points)


def distance(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def segment_lengths(points: list[Point]) -> list[float]:
    return [distance(a, b) for a, b in zip(points, points[1:])]


def turn_angles(points: list[Point]) -> list[float]:
    angles: list[float] = []
    for a, b, c in zip(points, points[1:], points[2:]):
        ux, uy = b[0] - a[0], b[1] - a[1]
        vx, vy = c[0] - b[0], c[1] - b[1]
        lu = math.hypot(ux, uy)
        lv = math.hypot(vx, vy)
        if lu < 1e-9 or lv < 1e-9:
            continue
        dot = max(-1.0, min(1.0, (ux * vx + uy * vy) / (lu * lv)))
        angles.append(math.degrees(math.acos(dot)))
    return angles


def turn_angle(a: Point, b: Point, c: Point) -> float:
    ux, uy = b[0] - a[0], b[1] - a[1]
    vx, vy = c[0] - b[0], c[1] - b[1]
    lu = math.hypot(ux, uy)
    lv = math.hypot(vx, vy)
    if lu < 1e-9 or lv < 1e-9:
        return 0.0
    dot = max(-1.0, min(1.0, (ux * vx + uy * vy) / (lu * lv)))
    return math.degrees(math.acos(dot))


def soften_hard_turns(points: list[Point], *, min_angle: float = 172.0, radius: float = 0.016) -> list[Point]:
    if len(points) < 3:
        return list(points)

    softened: list[Point] = [points[0]]
    for index, (a, b, c) in enumerate(zip(points, points[1:], points[2:]), start=1):
        angle = turn_angle(a, b, c)
        incoming = distance(a, b)
        outgoing = distance(b, c)
        if angle < min_angle or incoming < 1e-6 or outgoing < 1e-6:
            softened.append(b)
            continue

        r = min(radius, incoming * 0.38, outgoing * 0.38)
        if r < 0.003:
            softened.append(b)
            continue

        ux, uy = (b[0] - a[0]) / incoming, (b[1] - a[1]) / incoming
        vx, vy = (c[0] - b[0]) / outgoing, (c[1] - b[1]) / outgoing
        cross = ux * vy - uy * vx
        sign = 1.0 if cross >= 0 else -1.0
        nx, ny = -uy * sign, ux * sign
        before = (b[0] - ux * r + nx * r * 0.18, b[1] - uy * r + ny * r * 0.18)
        cap = (b[0] + nx * r * 0.64, b[1] + ny * r * 0.64)
        after = (b[0] + vx * r - nx * r * 0.18, b[1] + vy * r - ny * r * 0.18)

        for point in (before, cap, after):
            if distance(softened[-1], point) > 1e-6:
                softened.append(point)

    if distance(softened[-1], points[-1]) > 1e-6:
        softened.append(points[-1])
    return softened


def closed_distance(shape: Polyline) -> float:
    if not shape.points:
        return 0.0
    return distance(shape.points[0], shape.points[-1])


def layer_summary(shapes: Iterable[Polyline]) -> dict[str, dict[str, float | int]]:
    summary: dict[str, dict[str, float | int]] = {}
    for shape in shapes:
        item = summary.setdefault(shape.layer, {"shape_count": 0, "length": 0.0})
        item["shape_count"] = int(item["shape_count"]) + 1
        item["length"] = float(item["length"]) + shape_length(shape)
    for item in summary.values():
        item["length"] = round(float(item["length"]), 3)
    return dict(sorted(summary.items()))


def sample_points(points: list[Point], spacing: float = 0.08) -> list[Point]:
    samples: list[Point] = []
    for a, b in zip(points, points[1:]):
        length = distance(a, b)
        steps = max(1, math.ceil(length / spacing))
        for i in range(steps):
            t = i / steps
            samples.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    if points:
        samples.append(points[-1])
    return samples


def resample_by_distance(points: list[Point], spacing: float) -> list[Point]:
    if len(points) < 2 or spacing <= 0:
        return list(points)

    samples: list[Point] = [points[0]]
    carried = 0.0
    segment_start = points[0]

    for segment_end in points[1:]:
        remaining_length = distance(segment_start, segment_end)
        while remaining_length > 1e-9 and carried + remaining_length >= spacing:
            needed = spacing - carried
            t = needed / remaining_length
            new_point = (
                segment_start[0] + (segment_end[0] - segment_start[0]) * t,
                segment_start[1] + (segment_end[1] - segment_start[1]) * t,
            )
            samples.append(new_point)
            segment_start = new_point
            remaining_length = distance(segment_start, segment_end)
            carried = 0.0
        carried += remaining_length
        segment_start = segment_end

    if samples[-1] != points[-1] and distance(samples[-1], points[-1]) >= spacing * 0.25:
        samples.append(points[-1])
    return samples
