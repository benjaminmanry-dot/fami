#!/usr/bin/env python3
"""Build a native continuous-line border repeat for computerized longarm quilting."""

from __future__ import annotations

import argparse
import json
import math
import zipfile
from pathlib import Path

from longarm_geometry import Point, path_length, segment_lengths, soften_hard_turns, turn_angles


BLUE = "#075f86"
BACKGROUND = "#f7f7f4"


class StitchPath:
    def __init__(self, start: Point, spacing: float) -> None:
        self.points: list[Point] = [start]
        self.spacing = spacing

    @property
    def current(self) -> Point:
        return self.points[-1]

    def add_point(self, point: Point) -> None:
        if math.hypot(point[0] - self.current[0], point[1] - self.current[1]) >= max(0.004, self.spacing * 0.2):
            self.points.append(point)

    def curve_to(self, c1: Point, c2: Point, end: Point, tension: float = 1.0) -> None:
        start = self.current
        estimate = (
            math.hypot(c1[0] - start[0], c1[1] - start[1])
            + math.hypot(c2[0] - c1[0], c2[1] - c1[1])
            + math.hypot(end[0] - c2[0], end[1] - c2[1])
        )
        steps = max(5, math.ceil(estimate / max(0.006, self.spacing * tension)))
        for i in range(1, steps + 1):
            t = i / steps
            mt = 1 - t
            x = mt**3 * start[0] + 3 * mt**2 * t * c1[0] + 3 * mt * t**2 * c2[0] + t**3 * end[0]
            y = mt**3 * start[1] + 3 * mt**2 * t * c1[1] + 3 * mt * t**2 * c2[1] + t**3 * end[1]
            self.add_point((x, y))


def add_leaf(path: StitchPath, base: Point, tip: Point, width: float, mirror: int) -> None:
    if math.hypot(path.current[0] - base[0], path.current[1] - base[1]) > 1e-6:
        path.curve_to(
            ((path.current[0] + base[0]) / 2, path.current[1] + 0.08),
            ((path.current[0] + base[0]) / 2, base[1] + 0.08),
            base,
        )
    bx, by = base
    tx, ty = tip
    dx, dy = tx - bx, ty - by
    length = max(1e-6, math.hypot(dx, dy))
    nx, ny = -dy / length * width * mirror, dx / length * width * mirror
    tip_left = (tx - dx * 0.035 + nx * 0.2, ty - dy * 0.035 + ny * 0.2)
    tip_right = (tx - dx * 0.035 - nx * 0.18, ty - dy * 0.035 - ny * 0.18)
    vein_tip = (tx - dx * 0.075, ty - dy * 0.075)
    path.curve_to((bx + dx * 0.2 + nx, by + dy * 0.2 + ny), (bx + dx * 0.68 + nx, by + dy * 0.68 + ny), tip_left)
    path.curve_to((tx + nx * 0.08, ty + ny * 0.08), (tx - nx * 0.08, ty - ny * 0.08), tip_right, tension=1.45)
    path.curve_to((bx + dx * 0.68 - nx * 0.82, by + dy * 0.68 - ny * 0.82), (bx + dx * 0.2 - nx * 0.72, by + dy * 0.2 - ny * 0.72), base)
    path.curve_to((bx + dx * 0.25, by + dy * 0.12), (bx + dx * 0.68, by + dy * 0.84), vein_tip)
    path.curve_to((bx + dx * 0.64 - nx * 0.24, by + dy * 0.64 - ny * 0.24), (bx + dx * 0.2 - nx * 0.3, by + dy * 0.2 - ny * 0.3), base)


def add_pearl(path: StitchPath, center: Point, radius: float, start_angle: float = math.pi) -> None:
    cx, cy = center
    start = (cx + math.cos(start_angle) * radius, cy + math.sin(start_angle) * radius)
    path.curve_to(
        ((path.current[0] + start[0]) / 2, path.current[1]),
        ((path.current[0] + start[0]) / 2, start[1]),
        start,
        tension=1.3,
    )
    for i in range(1, 17):
        theta = start_angle + math.tau * i / 16
        path.add_point((cx + math.cos(theta) * radius, cy + math.sin(theta) * radius))


def add_open_scroll(path: StitchPath, entry: Point, center: Point, exit_point: Point, mirror: int, scale: float) -> None:
    if math.hypot(path.current[0] - entry[0], path.current[1] - entry[1]) > 1e-6:
        path.curve_to(
            ((path.current[0] + entry[0]) / 2, path.current[1] + 0.04 * scale),
            ((path.current[0] + entry[0]) / 2, entry[1] + 0.08 * scale),
            entry,
        )
    ex, ey = entry
    cx, cy = center
    ox = cx - 0.34 * scale * mirror
    path.curve_to((ex + 0.12 * scale, ey + 0.18 * scale), (ox, cy + 0.34 * scale), (ox, cy))
    radius = 0.34 * scale
    angle0 = math.pi if mirror > 0 else 0.0
    for i in range(1, 34):
        t = i / 33
        theta = angle0 + mirror * math.tau * 1.18 * t
        r = radius * (1 - 0.68 * t)
        path.add_point((cx + math.cos(theta) * r, cy + math.sin(theta) * r))
    path.curve_to((cx + 0.2 * scale * mirror, cy + 0.22 * scale), (exit_point[0] - 0.24 * scale, exit_point[1] + 0.08 * scale), exit_point)


def build_native_border(width: float, spacing: float) -> list[Point]:
    w = width
    scale = w / 6.0
    p = StitchPath((0.0, 0.0), spacing)

    def s(point: Point) -> Point:
        return (point[0] * scale, point[1] * scale)

    # Entry vine, leaf, and scroll are the actual through-route.
    p.curve_to(s((0.1, 0.0)), s((0.24, 0.0)), s((0.36, 0.03)), tension=0.8)
    p.curve_to(s((0.52, 0.08)), s((0.66, 0.28)), s((0.82, 0.28)))
    add_leaf(p, s((0.82, 0.28)), s((1.36, 0.48)), 0.18 * scale, mirror=1)
    p.curve_to(s((1.18, 0.36)), s((1.42, 0.3)), s((1.56, 0.18)))
    add_open_scroll(p, s((1.56, 0.18)), s((1.92, 0.04)), s((2.22, 0.38)), mirror=1, scale=scale)

    # Central crest: outer drop, inner echo, and lower heart are one route from
    # left entry to right exit, so the motif is stitch-native.
    p.curve_to(s((2.3, 0.82)), s((2.62, 1.24)), s((3.0, 1.36)))
    p.curve_to(s((3.38, 1.24)), s((3.7, 0.82)), s((3.78, 0.4)))
    p.curve_to(s((3.54, 0.88)), s((3.25, 1.07)), s((3.0, 1.08)))
    p.curve_to(s((2.75, 1.07)), s((2.48, 0.75)), s((2.42, 0.42)))
    p.curve_to(s((2.18, 0.06)), s((2.34, -0.44)), s((2.68, -0.43)))
    p.curve_to(s((2.88, -0.43)), s((2.96, -0.2)), s((3.0, -0.04)))
    p.curve_to(s((3.05, -0.22)), s((3.2, -0.43)), s((3.42, -0.43)))
    p.curve_to(s((3.76, -0.42)), s((3.9, 0.08)), s((3.58, 0.42)))
    p.curve_to(s((3.62, 0.4)), s((3.64, 0.39)), s((3.66, 0.38)))

    # Exit scroll, leaf, and vine finish on the same horizontal plane.
    add_open_scroll(p, s((3.88, 0.36)), s((4.18, 0.04)), s((4.48, 0.28)), mirror=-1, scale=scale)
    add_leaf(p, s((4.48, 0.28)), s((5.04, 0.48)), 0.18 * scale, mirror=-1)
    p.curve_to(s((5.04, 0.28)), s((5.36, 0.08)), s((5.68, 0.02)))
    p.curve_to(s((5.8, 0.0)), s((5.92, 0.0)), s((6.0, 0.0)), tension=0.8)
    points = soften_hard_turns(p.points, min_angle=172.0, radius=max(0.014 * scale, spacing * 0.62))
    return [(round(x, 5), round(y, 5)) for x, y in points]


def bounds(points: list[Point]) -> tuple[float, float, float, float]:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), min(ys), max(xs), max(ys)


def write_dxf(path: Path, points: list[Point], layer: str = "native-border-repeat") -> None:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
        "0", "POLYLINE", "8", layer[:31], "66", "1", "70", "0",
    ]
    for x, y in points:
        lines.extend(["0", "VERTEX", "8", layer[:31], "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
    lines.extend(["0", "SEQEND", "0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def svg_polyline(points: list[Point], y_offset: float = 0.0, x_offset: float = 0.0) -> str:
    return " ".join(f"{x + x_offset:.5f},{-(y + y_offset):.5f}" for x, y in points)


def write_svg(path: Path, points: list[Point], title: str, repeats: int = 1) -> None:
    min_x, min_y, max_x, max_y = bounds(points)
    width = max_x - min_x
    margin = 0.35
    view = (
        min_x - margin,
        -(max_y + margin),
        width * repeats + margin * 2,
        (max_y - min_y) + margin * 2,
    )
    content = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view[0]:.4f} {view[1]:.4f} {view[2]:.4f} {view[3]:.4f}">',
        f"<title>{title}</title>",
        f'<rect x="{view[0]:.4f}" y="{view[1]:.4f}" width="{view[2]:.4f}" height="{view[3]:.4f}" fill="{BACKGROUND}"/>',
    ]
    for repeat in range(repeats):
        content.append(
            f'<polyline points="{svg_polyline(points, x_offset=width * repeat)}" fill="none" stroke="{BLUE}" stroke-width="0.035" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    content.append("</svg>")
    path.write_text("\n".join(content) + "\n", encoding="utf-8")


def write_png(path: Path, points: list[Point], repeats: int = 1, size: int = 1400) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    min_x, min_y, max_x, max_y = bounds(points)
    width_units = max_x - min_x
    margin = 0.35
    scale = min(size / (width_units * repeats + margin * 2), size / ((max_y - min_y) + margin * 2))
    img_w = int((width_units * repeats + margin * 2) * scale)
    img_h = int(((max_y - min_y) + margin * 2) * scale)
    image = Image.new("RGB", (img_w, img_h), (247, 247, 244))
    draw = ImageDraw.Draw(image)

    def map_point(point: Point, repeat: int) -> tuple[float, float]:
        return ((point[0] + width_units * repeat - min_x + margin) * scale, (max_y - point[1] + margin) * scale)

    stroke = max(2, int(scale * 0.035))
    for repeat in range(repeats):
        draw.line([map_point(point, repeat) for point in points], fill=(7, 95, 134), width=stroke, joint="curve")
    image.save(path)
    return True


def metrics(points: list[Point], width: float) -> dict:
    segs = segment_lengths(points)
    turns = turn_angles(points)
    min_x, min_y, max_x, max_y = bounds(points)
    return {
        "point_count": len(points),
        "shape_count": 1,
        "repeat_width": width,
        "start": [round(points[0][0], 5), round(points[0][1], 5)],
        "end": [round(points[-1][0], 5), round(points[-1][1], 5)],
        "start_end_y_delta": round(abs(points[-1][1] - points[0][1]), 6),
        "bounds": [round(min_x, 5), round(min_y, 5), round(max_x, 5), round(max_y, 5)],
        "drawn_length": round(path_length(points), 5),
        "segment_count": len(segs),
        "min_segment": round(min(segs), 5) if segs else 0.0,
        "max_segment": round(max(segs), 5) if segs else 0.0,
        "hard_turn_count": len([angle for angle in turns if angle >= 172]),
        "cusp_turn_count": len([angle for angle in turns if angle >= 135]),
        "notes": [
            "One native continuous stitch path.",
            "Start and end are on the same horizontal plane for border repeat chaining.",
            "Motifs are drafted around the stitch route instead of compiled from separated paths.",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Native Sakura Heart Border Repeat")
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=float, default=6.0)
    parser.add_argument("--stitch-spacing", type=float, default=0.025)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = "native-sakura-heart-border-repeat"
    points = build_native_border(args.width, args.stitch_spacing)
    write_dxf(out_dir / f"{base}.dxf", points)
    write_svg(out_dir / f"{base}.svg", points, args.name)
    write_svg(out_dir / f"{base}-chained.svg", points, f"{args.name} chained", repeats=4)
    write_png(out_dir / f"{base}.png", points)
    write_png(out_dir / f"{base}-chained.png", points, repeats=4)
    result = metrics(points, args.width)
    (out_dir / "native-border-metrics.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(out_dir / f"{base}-dxf.zip", "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(out_dir / f"{base}.dxf", arcname=f"{base}.dxf")
    print(json.dumps({"out": str(out_dir), "metrics": result}, indent=2))
    return 0 if result["start_end_y_delta"] <= 0.001 else 1


if __name__ == "__main__":
    raise SystemExit(main())
