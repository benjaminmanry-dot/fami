#!/usr/bin/env python3
"""Build a polished heirloom-style coordinate quilting art board.

This script is intentionally art-board first. It creates an original
coordinate layout preview and DXF layers from reusable vector motifs.
Use it as a professional benchmark before converting individual areas
into final continuous-line longarm stitch paths.
"""

from __future__ import annotations

import argparse
import json
import math
import zipfile
from dataclasses import dataclass
from pathlib import Path


Point = tuple[float, float]


@dataclass
class PathShape:
    points: list[Point]
    layer: str


BLUE = "#075f86"
BACKGROUND = "#f7f7f4"


def add(points: list[Point], point: Point, tol: float = 0.0003) -> None:
    p = (round(point[0], 5), round(point[1], 5))
    if points and math.hypot(points[-1][0] - p[0], points[-1][1] - p[1]) < tol:
        return
    points.append(p)


def rot_xy(x: float, y: float, rot: float) -> Point:
    c = math.cos(rot)
    s = math.sin(rot)
    return (x * c - y * s, x * s + y * c)


def transform(points: list[Point], cx: float, cy: float, scale: float = 1.0, rot: float = 0.0) -> list[Point]:
    out: list[Point] = []
    for x, y in points:
        xr, yr = rot_xy(x * scale, y * scale, rot)
        out.append((round(cx + xr, 5), round(cy + yr, 5)))
    return out


def cubic(p0: Point, p1: Point, p2: Point, p3: Point, steps: int = 32) -> list[Point]:
    pts: list[Point] = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1.0 - t
        pts.append(
            (
                mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0],
                mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1],
            )
        )
    return pts


def join_segments(*segments: list[Point]) -> list[Point]:
    pts: list[Point] = []
    for segment in segments:
        for point in segment:
            add(pts, point)
    return pts


def rect(x: float, y: float, w: float, h: float) -> list[Point]:
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)]


def circle(cx: float, cy: float, r: float, steps: int = 48) -> list[Point]:
    return [(cx + math.cos(2 * math.pi * i / steps) * r, cy + math.sin(2 * math.pi * i / steps) * r) for i in range(steps + 1)]


def ellipse(cx: float, cy: float, rx: float, ry: float, rot: float = 0.0, steps: int = 60) -> list[Point]:
    pts: list[Point] = []
    for i in range(steps + 1):
        a = 2 * math.pi * i / steps
        x, y = rot_xy(rx * math.cos(a), ry * math.sin(a), rot)
        pts.append((cx + x, cy + y))
    return pts


def pearl_chain_line(a: Point, b: Point, count: int, r: float, layer: str) -> list[PathShape]:
    shapes: list[PathShape] = []
    for i in range(count):
        t = (i + 0.5) / count
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        shapes.append(PathShape(circle(x, y, r, steps=34), layer))
    return shapes


def pearl_chain_polyline(poly: list[Point], count: int, r: float, layer: str) -> list[PathShape]:
    lengths: list[float] = []
    total = 0.0
    for p, q in zip(poly, poly[1:]):
        d = math.hypot(q[0] - p[0], q[1] - p[1])
        lengths.append(d)
        total += d
    shapes: list[PathShape] = []
    if total <= 0:
        return shapes
    for i in range(count):
        target = (i + 0.5) * total / count
        walked = 0.0
        for idx, segment_len in enumerate(lengths):
            if walked + segment_len >= target:
                p = poly[idx]
                q = poly[idx + 1]
                t = (target - walked) / segment_len
                shapes.append(PathShape(circle(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, r, steps=34), layer))
                break
            walked += segment_len
    return shapes


def drafted_heart(size: float = 1.0, echo: bool = True) -> list[list[Point]]:
    """A Bezier-drafted heart with a softer handmade quilting silhouette."""
    outer = join_segments(
        cubic((0.0, -0.78 * size), (-0.58 * size, -0.34 * size), (-1.02 * size, 0.26 * size), (-0.55 * size, 0.58 * size), 28),
        cubic((-0.55 * size, 0.58 * size), (-0.25 * size, 0.78 * size), (-0.05 * size, 0.45 * size), (0.0, 0.28 * size), 20),
        cubic((0.0, 0.28 * size), (0.07 * size, 0.48 * size), (0.32 * size, 0.78 * size), (0.62 * size, 0.54 * size), 20),
        cubic((0.62 * size, 0.54 * size), (1.02 * size, 0.18 * size), (0.54 * size, -0.34 * size), (0.0, -0.78 * size), 28),
    )
    paths = [outer]
    if echo:
        inner = [(x * 0.62, y * 0.62 - size * 0.02) for x, y in outer]
        paths.append(inner)
    return paths


def lotus_drop(size: float = 1.0, echo: bool = True) -> list[list[Point]]:
    outer = join_segments(
        cubic((0, size * 0.82), (-size * 0.75, size * 0.2), (-size * 0.44, -size * 0.72), (0, -size * 0.86), 38),
        cubic((0, -size * 0.86), (size * 0.44, -size * 0.72), (size * 0.75, size * 0.2), (0, size * 0.82), 38),
    )
    paths = [outer]
    if echo:
        inner = [(x * 0.64, y * 0.64 - size * 0.02) for x, y in outer]
        paths.append(inner)
    cleft = join_segments(
        cubic((-size * 0.42, -size * 0.12), (-size * 0.25, -size * 0.48), (-size * 0.06, -size * 0.36), (0, -size * 0.08), 18),
        cubic((0, -size * 0.08), (size * 0.06, -size * 0.36), (size * 0.25, -size * 0.48), (size * 0.42, -size * 0.12), 18),
    )
    paths.append(cleft)
    return paths


def drafted_leaf(size: float = 1.0, echo: bool = True) -> list[list[Point]]:
    outer = join_segments(
        cubic((-size * 0.76, -size * 0.02), (-size * 0.34, size * 0.46), (size * 0.38, size * 0.38), (size * 0.78, size * 0.02), 34),
        cubic((size * 0.78, size * 0.02), (size * 0.24, -size * 0.34), (-size * 0.36, -size * 0.3), (-size * 0.76, -size * 0.02), 34),
    )
    vein = cubic((-size * 0.62, -size * 0.02), (-size * 0.12, size * 0.06), (size * 0.28, size * 0.05), (size * 0.66, size * 0.02), 18)
    paths = [outer, vein]
    if echo:
        paths.append([(x * 0.62, y * 0.62) for x, y in outer])
    return paths


def drafted_rosette(radius: float = 1.0, petals: int = 10, echo: bool = True) -> list[list[Point]]:
    paths: list[list[Point]] = []
    for i in range(petals):
        a = 2 * math.pi * i / petals
        wobble = 1.0 + 0.055 * math.sin(i * 1.7)
        px = math.cos(a) * radius * 0.5 * wobble
        py = math.sin(a) * radius * 0.5 * wobble
        paths.append(ellipse(px, py, radius * 0.14 * wobble, radius * 0.42 * (1.0 + 0.035 * math.cos(i * 2.1)), a, steps=42))
    if echo:
        paths.append(circle(0, 0, radius * 0.72, steps=72))
    paths.append(circle(0, 0, radius * 0.18, steps=42))
    for i in range(petals):
        a = 2 * math.pi * i / petals
        r = radius * (0.25 + 0.012 * math.sin(i * 1.3))
        paths.append(circle(math.cos(a) * r, math.sin(a) * r, radius * 0.043, steps=22))
    return paths


def drafted_scroll(size: float = 1.0, mirror: bool = False) -> list[Point]:
    sign = -1 if mirror else 1
    pts = join_segments(
        cubic((-0.9 * size, -0.08 * size), (-0.38 * size, 0.54 * size * sign), (0.66 * size, 0.48 * size * sign), (0.76 * size, -0.06 * size), 32),
        cubic((0.76 * size, -0.06 * size), (0.88 * size, -0.62 * size * sign), (0.02 * size, -0.72 * size * sign), (-0.04 * size, -0.18 * size * sign), 32),
        cubic((-0.04 * size, -0.18 * size * sign), (-0.08 * size, 0.24 * size * sign), (0.38 * size, 0.26 * size * sign), (0.34 * size, -0.02 * size), 22),
    )
    return pts


def feather_plume(size: float = 1.0) -> list[list[Point]]:
    paths = [
        cubic((-size * 0.95, -size * 0.65), (-size * 0.15, -size * 0.25), (size * 0.2, size * 0.45), (size * 0.85, size * 0.92), 45)
    ]
    for i, t in enumerate([0.22, 0.38, 0.54, 0.70]):
        sx = -size * 0.95 + (size * 1.8) * t
        sy = -size * 0.65 + (size * 1.57) * t
        side = -1 if i % 2 else 1
        paths.append(
            join_segments(
                cubic((sx, sy), (sx + side * size * 0.42, sy + size * 0.05), (sx + side * size * 0.46, sy + size * 0.45), (sx + side * size * 0.05, sy + size * 0.36), 22),
                cubic((sx + side * size * 0.05, sy + size * 0.36), (sx - side * size * 0.28, sy + size * 0.22), (sx - side * size * 0.1, sy + size * 0.02), (sx, sy), 18),
            )
        )
    return paths


def clamshell_row(width: float, height: float, count: int) -> list[list[Point]]:
    paths: list[list[Point]] = []
    step = width / count
    for i in range(count):
        x0 = -width / 2 + i * step
        paths.append(cubic((x0, 0), (x0 + step * 0.22, height), (x0 + step * 0.78, height), (x0 + step, 0), 28))
    return paths


def place(paths: list[list[Point]], cx: float, cy: float, scale: float, rot: float, layer: str) -> list[PathShape]:
    return [PathShape(transform(path, cx, cy, scale, rot), layer) for path in paths]


def place_local(
    paths: list[list[Point]],
    cx: float,
    cy: float,
    scale: float,
    rot: float,
    ox: float,
    oy: float,
    motif_rot: float,
    layer: str,
) -> list[PathShape]:
    shapes: list[PathShape] = []
    for path in paths:
        local: list[Point] = []
        for x, y in path:
            xr, yr = rot_xy(x, y, motif_rot)
            local.append((xr + ox, yr + oy))
        shapes.append(PathShape(transform(local, cx, cy, scale, rot), layer))
    return shapes


def path_local(path: list[Point], cx: float, cy: float, scale: float, rot: float, ox: float, oy: float, layer: str) -> PathShape:
    return PathShape(transform([(x + ox, y + oy) for x, y in path], cx, cy, scale, rot), layer)


def scalloped_rect(x: float, y: float, w: float, h: float, scallops: int = 7, amp: float = 0.32) -> list[Point]:
    pts: list[Point] = []
    sx = w / scallops
    sy = h / scallops
    for i in range(scallops):
        x0 = x + sx * i
        add(pts, (x0, y + h))
        for p in cubic((x0, y + h), (x0 + sx * 0.22, y + h + amp), (x0 + sx * 0.78, y + h + amp), (x0 + sx, y + h), 18):
            add(pts, p)
    for i in range(scallops):
        y0 = y + h - sy * i
        for p in cubic((x + w, y0), (x + w + amp, y0 - sy * 0.22), (x + w + amp, y0 - sy * 0.78), (x + w, y0 - sy), 18):
            add(pts, p)
    for i in range(scallops):
        x0 = x + w - sx * i
        for p in cubic((x0, y), (x0 - sx * 0.22, y - amp), (x0 - sx * 0.78, y - amp), (x0 - sx, y), 18):
            add(pts, p)
    for i in range(scallops):
        y0 = y + sy * i
        for p in cubic((x, y0), (x - amp, y0 + sy * 0.22), (x - amp, y0 + sy * 0.78), (x, y0 + sy), 18):
            add(pts, p)
    add(pts, pts[0])
    return pts


def leaf_chain_band(cx: float, cy: float, width: float, count: int, scale: float, rot: float, layer: str) -> list[PathShape]:
    shapes: list[PathShape] = []
    step = width / count
    for i in range(count):
        lx = -width / 2 + step * (i + 0.5)
        shapes.extend(place_local(drafted_leaf(0.52, echo=True), cx, cy, scale, rot, lx, 0.0, 0.0 if i % 2 == 0 else math.pi, layer))
        shapes.append(PathShape(transform(cubic((lx - step * 0.52, -0.05), (lx - step * 0.2, 0.35), (lx + step * 0.2, 0.35), (lx + step * 0.52, -0.05), 20), cx, cy, scale, rot), layer))
    return shapes


def medallion_flower(cx: float, cy: float, scale: float, rot: float, layer: str) -> list[PathShape]:
    shapes: list[PathShape] = []
    for i in range(12):
        a = 2 * math.pi * i / 12
        shapes.extend(place_local(lotus_drop(0.58, echo=True), cx, cy, scale, rot, math.cos(a) * 1.05, math.sin(a) * 1.05, a - math.pi / 2, layer))
    shapes.extend(place_local(drafted_rosette(0.74, petals=12, echo=True), cx, cy, scale, rot, 0.0, 0.0, 0.0, layer))
    shapes.append(PathShape(transform(circle(0, 0, 1.72, steps=88), cx, cy, scale, rot), layer))
    shapes.append(PathShape(transform(circle(0, 0, 1.12, steps=72), cx, cy, scale, rot), layer))
    for i in range(16):
        a = 2 * math.pi * i / 16
        shapes.append(PathShape(transform(circle(math.cos(a) * 0.48, math.sin(a) * 0.48, 0.055, steps=20), cx, cy, scale, rot), layer))
    return shapes


def drafted_vine(width: float, count: int) -> list[Point]:
    pts: list[Point] = []
    segments = count * 2
    step = width / segments
    for i in range(segments):
        x0 = -width / 2 + i * step
        x1 = x0 + step
        y0 = 0.06 * math.sin(i * 0.9)
        y1 = 0.06 * math.sin((i + 1) * 0.9)
        crest = (0.34 if i % 2 == 0 else -0.26) * (1.0 + 0.12 * math.sin(i * 1.31))
        seg = cubic((x0, y0), (x0 + step * 0.34, crest), (x0 + step * 0.72, crest * 0.86), (x1, y1), 22)
        for p in seg:
            add(pts, p)
    return pts


def integrated_border_band(cx: float, cy: float, width: float, count: int, scale: float, rot: float, layer: str) -> list[PathShape]:
    shapes: list[PathShape] = []
    shapes.append(PathShape(transform(drafted_vine(width, count), cx, cy, scale, rot), layer))
    step = width / count
    for i in range(count):
        x = -width / 2 + step * (i + 0.5) + 0.08 * math.sin(i * 1.9)
        motif_scale = 1.0 + 0.045 * math.sin(i * 1.37)
        up = 1 if i % 2 == 0 else -1
        shapes.append(
            PathShape(
                transform(
                    cubic((x - step * 0.52, -0.04), (x - step * 0.23, 0.62 + 0.04 * up), (x + step * 0.23, 0.68 - 0.03 * up), (x + step * 0.52, -0.04), 34),
                    cx,
                    cy,
                    scale,
                    rot,
                ),
                layer,
            )
        )
        shapes.extend(place_local(lotus_drop(0.54 * motif_scale, echo=True), cx, cy, scale, rot, x, 0.55 + 0.04 * math.cos(i), 0.03 * up, layer))
        shapes.extend(place_local(drafted_heart(0.38 * (1.0 - 0.03 * up), echo=True), cx, cy, scale, rot, x, -0.58, 0.04 * up, layer))
        shapes.extend(place_local(drafted_leaf(0.44, echo=True), cx, cy, scale, rot, x - step * 0.28, -0.08, -0.18 * up, layer))
        shapes.extend(place_local(drafted_leaf(0.44, echo=True), cx, cy, scale, rot, x + step * 0.28, -0.08, math.pi + 0.18 * up, layer))
        if i in (0, count - 1):
            shapes.extend(place_local(drafted_rosette(0.36, petals=8, echo=True), cx, cy, scale, rot, x, 0.04, 0.0, layer))
        else:
            shapes.append(path_local(drafted_scroll(0.52, mirror=i % 2 == 0), cx, cy, scale, rot, x + step * 0.34, 0.1 * up, layer))
    return shapes


def border_under_scroll_band(cx: float, cy: float, width: float, count: int, scale: float, rot: float, layer: str) -> list[PathShape]:
    shapes: list[PathShape] = []
    step = width / count
    for i in range(count):
        if i in (0, count - 1):
            continue
        x = -width / 2 + step * (i + 0.5)
        small = 1.0 + 0.05 * math.cos(i * 1.2)
        shapes.append(PathShape(transform(cubic((x - step * 0.38, -0.12), (x - step * 0.1, -0.45), (x + step * 0.28, -0.42), (x + step * 0.42, -0.1), 26), cx, cy, scale, rot), layer))
        shapes.append(path_local(drafted_scroll(0.38 * small, mirror=i % 2 == 0), cx, cy, scale, rot, x - step * 0.18, -0.26, layer))
        if i % 2 == 0:
            shapes.append(path_local(drafted_scroll(0.32 * small, mirror=True), cx, cy, scale, rot, x + step * 0.22, -0.3, layer))
        shapes.extend(place_local(drafted_leaf(0.3, echo=False), cx, cy, scale, rot, x, -0.12, 0.02 * i, layer))
    return shapes


def corner_turn(cx: float, cy: float, scale: float, rot: float, layer: str) -> list[PathShape]:
    shapes: list[PathShape] = []
    shapes.append(PathShape(transform(cubic((-1.7, 0.0), (-0.8, 1.3), (0.9, 1.2), (1.55, 0.18), 42), cx, cy, scale, rot), layer))
    shapes.append(PathShape(transform(cubic((0.0, -1.7), (1.3, -0.8), (1.2, 0.9), (0.18, 1.55), 42), cx, cy, scale, rot), layer))
    shapes.extend(place_local(drafted_rosette(0.58, petals=9, echo=True), cx, cy, scale, rot, 0.0, 0.0, 0.0, layer))
    shapes.extend(place_local(lotus_drop(0.52, echo=True), cx, cy, scale, rot, 0.88, 0.84, -0.78, layer))
    shapes.extend(place_local(drafted_leaf(0.46, echo=True), cx, cy, scale, rot, -0.78, 0.72, 0.34, layer))
    shapes.extend(place_local(drafted_leaf(0.46, echo=True), cx, cy, scale, rot, 0.72, -0.78, 1.2, layer))
    shapes.append(path_local(drafted_scroll(0.62, mirror=False), cx, cy, scale, rot, 1.2, -0.12, layer))
    shapes.append(path_local(drafted_scroll(0.62, mirror=True), cx, cy, scale, rot, -0.12, 1.2, layer))
    return shapes


def framed_sprig_cluster(cx: float, cy: float, scale: float, rot: float, layer: str) -> list[PathShape]:
    shapes: list[PathShape] = []
    shapes.append(PathShape(transform(cubic((-1.48, -0.48), (-0.88, 0.62), (0.72, 0.66), (1.5, -0.18), 46), cx, cy, scale, rot), layer))
    shapes.append(PathShape(transform(cubic((-1.28, -0.78), (-0.48, -0.38), (0.62, -0.42), (1.26, -0.68), 32), cx, cy, scale, rot), layer))
    shapes.extend(place_local(drafted_heart(0.48, echo=True), cx, cy, scale, rot, -0.64, 0.16, -0.12, layer))
    shapes.extend(place_local(drafted_rosette(0.32, petals=8, echo=True), cx, cy, scale, rot, 0.28, -0.18, 0.0, layer))
    shapes.extend(place_local(drafted_leaf(0.42, echo=True), cx, cy, scale, rot, 0.86, 0.28, 0.18, layer))
    shapes.extend(place_local(drafted_leaf(0.36, echo=False), cx, cy, scale, rot, -1.06, -0.26, -0.22, layer))
    shapes.append(path_local(drafted_scroll(0.46, mirror=False), cx, cy, scale, rot, 1.02, -0.28, layer))
    return shapes


def diamond_flourish(cx: float, cy: float, scale: float, rot: float, layer: str) -> list[PathShape]:
    shapes: list[PathShape] = []
    shapes.append(PathShape(transform(cubic((-2.0, 0.0), (-1.05, 1.0), (1.05, 1.0), (2.0, 0.0), 48), cx, cy, scale, rot), layer))
    shapes.append(PathShape(transform(cubic((-1.78, -0.28), (-0.88, -1.08), (0.88, -1.08), (1.78, -0.28), 48), cx, cy, scale, rot), layer))
    shapes.append(path_local(drafted_scroll(0.62, mirror=False), cx, cy, scale, rot, -1.18, 0.16, layer))
    shapes.append(path_local(drafted_scroll(0.62, mirror=True), cx, cy, scale, rot, 1.18, 0.16, layer))
    shapes.extend(place_local(drafted_leaf(0.5, echo=True), cx, cy, scale, rot, -0.76, -0.4, -0.18, layer))
    shapes.extend(place_local(drafted_leaf(0.5, echo=True), cx, cy, scale, rot, 0.76, -0.4, math.pi + 0.18, layer))
    return shapes


def build_artboard() -> list[PathShape]:
    shapes: list[PathShape] = []
    # Frames and pearl rails
    outer_scallop = scalloped_rect(1.55, 1.55, 26.9, 26.9, scallops=6, amp=0.35)
    shapes.append(PathShape(rect(0.7, 0.7, 28.6, 28.6), "outer-frame"))
    shapes.append(PathShape(outer_scallop, "outer-frame"))
    shapes.append(PathShape(scalloped_rect(1.92, 1.92, 26.16, 26.16, scallops=6, amp=0.24), "outer-frame"))
    shapes.extend(pearl_chain_polyline(outer_scallop, 176, 0.105, "outer-pearls"))
    shapes.append(PathShape(rect(6.15, 6.15, 17.7, 17.7), "inner-frame"))
    shapes.append(PathShape(rect(7.0, 7.0, 16.0, 16.0), "inner-frame"))

    # Ornate border repeats ride on visible vines so motifs feel drafted into the borders.
    shapes.extend(integrated_border_band(15.0, 25.55, 20.6, 6, 1.0, 0.0, "top-border"))
    shapes.extend(integrated_border_band(15.0, 4.45, 20.6, 6, 1.0, math.pi, "bottom-border"))
    shapes.extend(integrated_border_band(4.45, 15.0, 20.6, 6, 1.0, math.pi / 2, "left-border"))
    shapes.extend(integrated_border_band(25.55, 15.0, 20.6, 6, 1.0, -math.pi / 2, "right-border"))
    shapes.extend(border_under_scroll_band(15.0, 24.35, 19.6, 5, 1.0, 0.0, "top-border"))
    shapes.extend(border_under_scroll_band(15.0, 5.65, 19.6, 5, 1.0, math.pi, "bottom-border"))
    # Corners
    for cx, cy, rot in [(4.3, 4.3, 0.0), (25.7, 4.3, math.pi / 2), (25.7, 25.7, math.pi), (4.3, 25.7, -math.pi / 2)]:
        shapes.extend(corner_turn(cx, cy, 1.25, rot, "corners"))
    # Inner sashing bands
    shapes.extend(leaf_chain_band(15, 6.55, 14.2, 7, 1.0, 0.0, "inner-sashing"))
    shapes.extend(leaf_chain_band(15, 23.45, 14.2, 7, 1.0, math.pi, "inner-sashing"))
    shapes.extend(leaf_chain_band(6.55, 15, 14.2, 7, 1.0, math.pi / 2, "inner-sashing"))
    shapes.extend(leaf_chain_band(23.45, 15, 14.2, 7, 1.0, -math.pi / 2, "inner-sashing"))
    # Central diamond and pearls
    diamond_outer = [(15, 21.15), (21.15, 15), (15, 8.85), (8.85, 15), (15, 21.15)]
    diamond_inner = [(15, 20.15), (20.15, 15), (15, 9.85), (9.85, 15), (15, 20.15)]
    diamond_mid = [(15, 20.65), (20.65, 15), (15, 9.35), (9.35, 15), (15, 20.65)]
    shapes.append(PathShape(diamond_outer, "focal-frame"))
    shapes.append(PathShape(diamond_mid, "focal-frame"))
    shapes.append(PathShape(diamond_inner, "focal-frame"))
    shapes.extend(pearl_chain_polyline(diamond_mid, 72, 0.105, "focal-pearls"))
    # Focal center
    shapes.extend(medallion_flower(15, 15, 1.0, 0.0, "focal-motif"))
    # Diamond point motifs
    for cx, cy, rot in [(15, 19.22, 0), (19.22, 15, math.pi / 2), (15, 10.78, math.pi), (10.78, 15, -math.pi / 2)]:
        shapes.extend(place(lotus_drop(1.02, echo=True), cx, cy, 1.0, rot, "focal-point-motifs"))
        shapes.extend(place(drafted_heart(0.56, echo=True), cx + math.cos(rot - math.pi / 2) * 1.16, cy + math.sin(rot - math.pi / 2) * 1.16, 1.0, rot, "focal-point-motifs"))
        shapes.append(PathShape(transform(drafted_scroll(0.78, mirror=False), cx + math.cos(rot + math.pi / 2) * 1.04, cy + math.sin(rot + math.pi / 2) * 1.04, 1.0, rot), "focal-point-motifs"))
        shapes.append(PathShape(transform(drafted_scroll(0.78, mirror=True), cx - math.cos(rot + math.pi / 2) * 1.04, cy - math.sin(rot + math.pi / 2) * 1.04, 1.0, rot), "focal-point-motifs"))
    # Block support motifs are attached to local vines instead of floating in open field.
    for cx, cy, rot in [(9.4, 9.4, 0.68), (20.6, 9.4, 2.46), (20.6, 20.6, -2.46), (9.4, 20.6, -0.68)]:
        shapes.extend(framed_sprig_cluster(cx, cy, 1.12, rot, "block-support"))
    # Additional balanced scroll fill around the medallion.
    for cx, cy, rot in [(12.0, 17.8, 0.2), (18.0, 17.8, math.pi - 0.2), (18.0, 12.2, math.pi + 0.2), (12.0, 12.2, -0.2)]:
        shapes.append(PathShape(transform(drafted_scroll(0.96, mirror=False), cx, cy, 1.0, rot), "focal-scroll-fill"))
        shapes.append(PathShape(transform(drafted_scroll(0.62, mirror=True), cx + math.cos(rot) * 0.92, cy + math.sin(rot) * 0.92, 1.0, rot), "focal-scroll-fill"))
        shapes.extend(place(drafted_leaf(0.52, echo=True), cx + math.cos(rot) * 1.08, cy + math.sin(rot) * 1.08, 1.0, rot, "focal-scroll-fill"))
    for cx, cy, rot in [(15, 17.05, 0.0), (17.05, 15, -math.pi / 2), (15, 12.95, math.pi), (12.95, 15, math.pi / 2)]:
        shapes.extend(diamond_flourish(cx, cy, 0.72, rot, "focal-scroll-fill"))
    # Triangle-aware coordinate motifs are represented as tapered side fills in
    # the whole-quilt preview; the actual triangle component is exported below.
    for cx, cy, rot in [(5.18, 15, math.pi / 2), (24.82, 15, -math.pi / 2)]:
        shapes.extend(place(feather_plume(0.92), cx, cy, 1.0, rot, "triangle-fill"))
        shapes.extend(place(clamshell_row(2.0, 0.35, 4), cx, cy - 2.05, 1.0, rot, "triangle-fill"))
        shapes.extend(place(clamshell_row(1.6, 0.3, 3), cx, cy + 2.08, 1.0, rot, "triangle-fill"))
    return shapes


def bounds(shapes: list[PathShape]) -> tuple[float, float, float, float]:
    xs = [x for shape in shapes for x, _ in shape.points]
    ys = [y for shape in shapes for _, y in shape.points]
    return min(xs), min(ys), max(xs), max(ys)


def svg_points(points: list[Point]) -> str:
    return " ".join(f"{x:.4f},{-y:.4f}" for x, y in points)


def write_svg(path: Path, shapes: list[PathShape], title: str) -> None:
    min_x, min_y, max_x, max_y = bounds(shapes)
    margin = 0.7
    content = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{min_x - margin:.3f} {-max_y - margin:.3f} {(max_x - min_x) + margin * 2:.3f} {(max_y - min_y) + margin * 2:.3f}">',
        f"<title>{title}</title>",
        f'<rect x="{min_x - margin:.3f}" y="{-max_y - margin:.3f}" width="{(max_x - min_x) + margin * 2:.3f}" height="{(max_y - min_y) + margin * 2:.3f}" fill="{BACKGROUND}"/>',
    ]
    for shape in shapes:
        content.append(
            f'<polyline points="{svg_points(shape.points)}" fill="none" stroke="{BLUE}" stroke-width="0.045" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    content.append("</svg>")
    path.write_text("\n".join(content) + "\n", encoding="utf-8")


def write_dxf(path: Path, shapes: list[PathShape]) -> None:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
    ]
    for shape in shapes:
        layer = shape.layer[:31] or "0"
        lines.extend(["0", "POLYLINE", "8", layer, "66", "1", "70", "0"])
        for x, y in shape.points:
            lines.extend(["0", "VERTEX", "8", layer, "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
        lines.extend(["0", "SEQEND"])
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_png(path: Path, shapes: list[PathShape], size: int = 1800) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    min_x, min_y, max_x, max_y = bounds(shapes)
    margin = 0.8
    scale = min(size / ((max_x - min_x) + margin * 2), size / ((max_y - min_y) + margin * 2))
    width = int(((max_x - min_x) + margin * 2) * scale)
    height = int(((max_y - min_y) + margin * 2) * scale)
    img = Image.new("RGB", (width, height), (247, 247, 244))
    draw = ImageDraw.Draw(img)

    def map_pt(point: Point) -> tuple[float, float]:
        return ((point[0] - min_x + margin) * scale, (max_y - point[1] + margin) * scale)

    stroke_width = max(2, int(scale * 0.045))
    for shape in shapes:
        mapped = [map_pt(point) for point in shape.points]
        if len(mapped) >= 2:
            draw.line(mapped, fill=(7, 95, 134), width=stroke_width, joint="curve")
    img.save(path)
    return True


def art_metrics(shapes: list[PathShape]) -> dict:
    min_x, min_y, max_x, max_y = bounds(shapes)
    layers = sorted(set(shape.layer for shape in shapes))
    path_lengths = []
    for shape in shapes:
        length = 0.0
        for a, b in zip(shape.points, shape.points[1:]):
            length += math.hypot(b[0] - a[0], b[1] - a[1])
        path_lengths.append(length)
    return {
        "shape_count": len(shapes),
        "layer_count": len(layers),
        "layers": layers,
        "bounds": [round(min_x, 3), round(min_y, 3), round(max_x, 3), round(max_y, 3)],
        "total_drawn_length": round(sum(path_lengths), 3),
        "median_path_length": round(sorted(path_lengths)[len(path_lengths) // 2], 3) if path_lengths else 0,
        "max_path_length": round(max(path_lengths), 3) if path_lengths else 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Heirloom Coordinate Art Board")
    parser.add_argument("--out", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    shapes = build_artboard()
    base = "heirloom-coordinate-art-board"
    write_svg(out_dir / f"{base}.svg", shapes, args.name)
    write_dxf(out_dir / f"{base}.dxf", shapes)
    write_png(out_dir / f"{base}.png", shapes)
    metrics = art_metrics(shapes)
    (out_dir / "art-metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    zip_path = out_dir / f"{base}-dxf.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(out_dir / f"{base}.dxf", arcname=f"{base}.dxf")
    print(json.dumps({"out": str(out_dir), "metrics": metrics}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
