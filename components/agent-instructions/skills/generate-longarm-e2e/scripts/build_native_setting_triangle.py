#!/usr/bin/env python3
"""Build a native continuous-line setting triangle component for longarm quilting."""

from __future__ import annotations

import argparse
import json
import math
import zipfile
from pathlib import Path

from build_native_border_repeat import BACKGROUND, BLUE, StitchPath, add_leaf, add_open_scroll
from longarm_geometry import Point, path_length, segment_lengths, soften_hard_turns, turn_angles


GUIDE = "#d4d0c8"


def scale_point(width: float, depth: float, point: Point) -> Point:
    return (point[0] * width / 6.0, point[1] * depth / 5.0)


def add_petal_loop(path: StitchPath, center: Point, angle: float, length: float, width: float) -> None:
    if math.hypot(path.current[0] - center[0], path.current[1] - center[1]) > 1e-6:
        path.curve_to(
            ((path.current[0] + center[0]) / 2, path.current[1] - 0.02),
            ((path.current[0] + center[0]) / 2, center[1] + 0.02),
            center,
            tension=1.25,
        )
    cx, cy = center
    dx, dy = math.cos(angle), math.sin(angle)
    nx, ny = -dy, dx
    tip = (cx + dx * length, cy + dy * length)
    path.curve_to(
        (cx + dx * length * 0.26 + nx * width, cy + dy * length * 0.26 + ny * width),
        (cx + dx * length * 0.72 + nx * width * 0.5, cy + dy * length * 0.72 + ny * width * 0.5),
        tip,
    )
    path.curve_to(
        (cx + dx * length * 0.72 - nx * width * 0.46, cy + dy * length * 0.72 - ny * width * 0.46),
        (cx + dx * length * 0.26 - nx * width, cy + dy * length * 0.26 - ny * width),
        center,
    )


def add_sakura_rosette(path: StitchPath, center: Point, scale: float) -> None:
    for degrees, length, width in [
        (92, 0.82, 0.21),
        (32, 0.78, 0.2),
        (-34, 0.82, 0.21),
        (-104, 0.7, 0.18),
        (166, 0.74, 0.19),
    ]:
        add_petal_loop(path, center, math.radians(degrees), length * scale, width * scale)
    cx, cy = center
    radius = 0.12 * scale
    start = (cx + radius, cy)
    path.curve_to((cx + radius * 0.7, cy + radius), (cx + radius, cy + radius * 0.7), start, tension=1.5)
    for i in range(1, 15):
        theta = math.tau * i / 14
        path.add_point((cx + math.cos(theta) * radius, cy + math.sin(theta) * radius))


def add_rosette_plume(path: StitchPath, base: Point, center: Point, scale: float) -> None:
    if math.hypot(path.current[0] - base[0], path.current[1] - base[1]) > 1e-6:
        path.curve_to(
            ((path.current[0] + base[0]) / 2, path.current[1] - 0.03),
            ((path.current[0] + base[0]) / 2, base[1] + 0.03),
            base,
        )
    bx, by = base
    cx, cy = center
    path.curve_to(
        (bx + (cx - bx) * 0.26, by + (cy - by) * 0.58 - 0.22 * scale),
        (bx + (cx - bx) * 0.68, by + (cy - by) * 0.88 - 0.18 * scale),
        center,
    )
    add_sakura_rosette(path, center, scale)
    path.curve_to(
        (bx + (cx - bx) * 0.72, by + (cy - by) * 0.72 + 0.28 * scale),
        (bx + (cx - bx) * 0.25, by + (cy - by) * 0.34 + 0.18 * scale),
        base,
    )


def add_feather_leaf(path: StitchPath, base: Point, tip: Point, width: float, mirror: int) -> None:
    if math.hypot(path.current[0] - base[0], path.current[1] - base[1]) > 1e-6:
        path.curve_to(
            ((path.current[0] + base[0]) / 2, path.current[1] - 0.05),
            ((path.current[0] + base[0]) / 2, base[1] + 0.05),
            base,
        )
    add_leaf(path, base, tip, width, mirror=mirror)


def add_open_teardrop(path: StitchPath, base: Point, tip: Point, width: float) -> None:
    if math.hypot(path.current[0] - base[0], path.current[1] - base[1]) > 1e-6:
        path.curve_to(
            ((path.current[0] + base[0]) / 2, path.current[1]),
            ((path.current[0] + base[0]) / 2, base[1]),
            base,
        )
    bx, by = base
    tx, ty = tip
    dx, dy = tx - bx, ty - by
    length = max(1e-6, math.hypot(dx, dy))
    nx, ny = -dy / length * width, dx / length * width
    path.curve_to((bx + dx * 0.2 + nx, by + dy * 0.2 + ny), (bx + dx * 0.72 + nx * 0.5, by + dy * 0.72 + ny * 0.5), tip)
    path.curve_to((bx + dx * 0.72 - nx * 0.5, by + dy * 0.72 - ny * 0.5), (bx + dx * 0.2 - nx, by + dy * 0.2 - ny), base)


def build_native_triangle(width: float, depth: float, spacing: float) -> list[Point]:
    p = StitchPath((0.0, 0.0), spacing)

    def s(point: Point) -> Point:
        return scale_point(width, depth, point)

    sx = width / 6.0
    sy = depth / 5.0
    unit = min(sx, sy)

    # The stitch spine follows the triangular geography: left broad edge down
    # to the point, then back up to the right broad edge. Detail grows inward
    # from that spine instead of floating in the middle of the patch.
    p.curve_to(s((0.26, -0.2)), s((0.52, -0.48)), s((0.78, -0.82)))
    add_feather_leaf(p, s((0.78, -0.82)), s((1.62, -0.62)), 0.18 * unit, mirror=-1)
    add_feather_leaf(p, s((0.78, -0.82)), s((1.34, -0.38)), 0.1 * unit, mirror=1)
    p.curve_to(s((0.96, -1.08)), s((1.12, -1.34)), s((1.28, -1.58)))
    add_open_scroll(p, s((1.28, -1.58)), s((1.72, -1.58)), s((2.12, -1.84)), mirror=1, scale=unit)
    add_feather_leaf(p, s((2.12, -1.84)), s((2.92, -1.26)), 0.2 * unit, mirror=1)
    add_feather_leaf(p, s((2.12, -1.84)), s((2.52, -1.12)), 0.11 * unit, mirror=-1)
    p.curve_to(s((1.8, -2.12)), s((1.96, -2.42)), s((2.18, -2.72)))
    add_feather_leaf(p, s((2.18, -2.72)), s((3.06, -2.28)), 0.2 * unit, mirror=1)
    add_feather_leaf(p, s((2.18, -2.72)), s((2.68, -2.04)), 0.11 * unit, mirror=-1)
    p.curve_to(s((2.3, -3.08)), s((2.54, -3.42)), s((2.72, -3.72)))
    add_feather_leaf(p, s((2.72, -3.72)), s((3.28, -3.38)), 0.15 * unit, mirror=1)
    p.curve_to(s((2.88, -4.04)), s((2.96, -4.26)), s((3.0, -4.48)))

    # Point echo keeps the V-turn soft and gives the triangle a finished tip.
    add_open_teardrop(p, s((3.0, -4.48)), s((3.0, -4.9)), 0.14 * unit)

    p.curve_to(s((3.16, -4.2)), s((3.38, -3.88)), s((3.64, -3.56)))
    add_feather_leaf(p, s((3.64, -3.56)), s((2.98, -3.18)), 0.15 * unit, mirror=-1)
    p.curve_to(s((3.82, -3.16)), s((4.04, -2.82)), s((4.22, -2.52)))
    add_feather_leaf(p, s((4.22, -2.52)), s((3.22, -2.1)), 0.2 * unit, mirror=-1)
    add_feather_leaf(p, s((4.22, -2.52)), s((3.62, -1.82)), 0.11 * unit, mirror=1)
    p.curve_to(s((4.42, -2.14)), s((4.58, -1.76)), s((4.72, -1.4)))
    add_open_scroll(p, s((4.72, -1.4)), s((4.92, -1.06)), s((5.12, -0.82)), mirror=-1, scale=unit)
    add_feather_leaf(p, s((5.12, -0.82)), s((5.64, -0.44)), 0.16 * unit, mirror=-1)
    add_feather_leaf(p, s((5.12, -0.82)), s((5.44, -0.22)), 0.09 * unit, mirror=1)
    p.curve_to(s((5.34, -0.42)), s((5.72, -0.18)), s((6.0, 0.0)))
    points = soften_hard_turns(p.points, min_angle=172.0, radius=max(0.014 * unit, spacing * 0.62))
    return [(round(x, 5), round(y, 5)) for x, y in points]


def mirror_triangle(points: list[Point], width: float) -> list[Point]:
    return [(round(width - x, 5), y) for x, y in reversed(points)]


def bounds(points: list[Point]) -> tuple[float, float, float, float]:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), min(ys), max(xs), max(ys)


def write_dxf(path: Path, points: list[Point], layer: str = "native-setting-triangle") -> None:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
        "0", "POLYLINE", "8", layer[:31], "66", "1", "70", "0",
    ]
    for x, y in points:
        lines.extend(["0", "VERTEX", "8", layer[:31], "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
    lines.extend(["0", "SEQEND", "0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_svg(path: Path, points: list[Point], width: float, depth: float, title: str, mirrored: bool = False) -> None:
    show_points = mirror_triangle(points, width) if mirrored else points
    min_x, min_y, max_x, max_y = bounds(show_points + [(0, 0), (width, 0), (width / 2, -depth)])
    margin = 0.35
    view_x = min_x - margin
    view_y = -(max_y + margin)
    view_w = (max_x - min_x) + margin * 2
    view_h = (max_y - min_y) + margin * 2
    guide_points = f"0,0 {width:.5f},0 {width/2:.5f},{depth:.5f} 0,0"
    stitch_points = " ".join(f"{x:.5f},{-y:.5f}" for x, y in show_points)
    content = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_x:.4f} {view_y:.4f} {view_w:.4f} {view_h:.4f}">',
        f"<title>{title}</title>",
        f'<rect x="{view_x:.4f}" y="{view_y:.4f}" width="{view_w:.4f}" height="{view_h:.4f}" fill="{BACKGROUND}"/>',
        f'<polyline points="{guide_points}" fill="none" stroke="{GUIDE}" stroke-width="0.02" stroke-dasharray="0.10 0.08"/>',
        f'<polyline points="{stitch_points}" fill="none" stroke="{BLUE}" stroke-width="0.035" stroke-linecap="round" stroke-linejoin="round"/>',
        "</svg>",
    ]
    path.write_text("\n".join(content) + "\n", encoding="utf-8")


def write_png(path: Path, points: list[Point], width: float, depth: float, mirrored: bool = False, size_px: int = 1200) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    show_points = mirror_triangle(points, width) if mirrored else points
    min_x, min_y, max_x, max_y = bounds(show_points + [(0, 0), (width, 0), (width / 2, -depth)])
    margin = 0.35
    scale = min(size_px / ((max_x - min_x) + margin * 2), size_px / ((max_y - min_y) + margin * 2))
    img_w = max(80, int(((max_x - min_x) + margin * 2) * scale))
    img_h = max(80, int(((max_y - min_y) + margin * 2) * scale))
    image = Image.new("RGB", (img_w, img_h), (247, 247, 244))
    draw = ImageDraw.Draw(image)

    def map_point(point: Point) -> tuple[float, float]:
        return ((point[0] - min_x + margin) * scale, (max_y - point[1] + margin) * scale)

    guide = [(0, 0), (width, 0), (width / 2, -depth), (0, 0)]
    draw.line([map_point(point) for point in guide], fill=(212, 208, 200), width=max(1, int(scale * 0.02)))
    draw.line([map_point(point) for point in show_points], fill=(7, 95, 134), width=max(2, int(scale * 0.035)), joint="curve")
    image.save(path)
    return True


def metrics(points: list[Point], width: float, depth: float, component: str) -> dict:
    segs = segment_lengths(points)
    turns = turn_angles(points)
    min_x, min_y, max_x, max_y = bounds(points)
    return {
        "component": component,
        "shape_count": 1,
        "point_count": len(points),
        "width": width,
        "depth": depth,
        "start": [round(points[0][0], 5), round(points[0][1], 5)],
        "end": [round(points[-1][0], 5), round(points[-1][1], 5)],
        "start_end_y_delta": round(abs(points[-1][1] - points[0][1]), 6),
        "bounds": [round(min_x, 5), round(min_y, 5), round(max_x, 5), round(max_y, 5)],
        "drawn_length": round(path_length(points), 5),
        "segment_count": len(segs),
        "min_segment": round(min(segs), 5) if segs else 0,
        "max_segment": round(max(segs), 5) if segs else 0,
        "hard_turn_count": len([angle for angle in turns if angle >= 172]),
        "cusp_turn_count": len([angle for angle in turns if angle >= 135]),
        "notes": [
            "One native continuous stitch path.",
            "Triangle enters and exits on the broad-edge baseline.",
            "Feather, scroll, and leaf motifs taper toward the triangle point.",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Native Sakura Feather Setting Triangle")
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=float, default=6.0)
    parser.add_argument("--depth", type=float, default=5.0)
    parser.add_argument("--stitch-spacing", type=float, default=0.025)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = "native-sakura-feather-setting-triangle"
    mirror_base = f"{base}-mirrored"
    points = build_native_triangle(args.width, args.depth, args.stitch_spacing)
    mirrored = mirror_triangle(points, args.width)

    write_dxf(out_dir / f"{base}.dxf", points, "native-setting-triangle")
    write_dxf(out_dir / f"{mirror_base}.dxf", mirrored, "native-setting-tri-mirror")
    write_svg(out_dir / f"{base}.svg", points, args.width, args.depth, args.name)
    write_svg(out_dir / f"{mirror_base}.svg", points, args.width, args.depth, f"{args.name} mirrored", mirrored=True)
    write_png(out_dir / f"{base}.png", points, args.width, args.depth)
    write_png(out_dir / f"{mirror_base}.png", points, args.width, args.depth, mirrored=True)

    result = {
        "triangle": metrics(points, args.width, args.depth, "setting-triangle"),
        "mirrored": metrics(mirrored, args.width, args.depth, "setting-triangle-mirrored"),
    }
    (out_dir / "native-triangle-metrics.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(out_dir / f"{base}-dxf.zip", "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(out_dir / f"{base}.dxf", arcname=f"{base}.dxf")
        zf.write(out_dir / f"{mirror_base}.dxf", arcname=f"{mirror_base}.dxf")
    print(json.dumps({"out": str(out_dir), "metrics": result}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
