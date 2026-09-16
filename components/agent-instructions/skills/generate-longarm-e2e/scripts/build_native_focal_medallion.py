#!/usr/bin/env python3
"""Build a native continuous-line focal medallion for computerized longarm quilting."""

from __future__ import annotations

import argparse
import json
import math
import zipfile
from pathlib import Path

from build_native_block_component import add_echo_heart, add_sakura_rosette
from build_native_border_repeat import BACKGROUND, BLUE, StitchPath, add_leaf, add_open_scroll
from longarm_geometry import Point, path_length, segment_lengths, soften_hard_turns, turn_angles


GUIDE = "#d4d0c8"


def scale_point(size: float, point: Point) -> Point:
    return (point[0] * size / 8.0, point[1] * size / 8.0)


def bounds(points: list[Point]) -> tuple[float, float, float, float]:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), min(ys), max(xs), max(ys)


def mirror_medallion(points: list[Point], size: float) -> list[Point]:
    return [(round(size - x, 5), y) for x, y in reversed(points)]


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
    path.curve_to((bx + dx * 0.22 + nx, by + dy * 0.22 + ny), (bx + dx * 0.72 + nx * 0.56, by + dy * 0.72 + ny * 0.56), tip)
    path.curve_to((bx + dx * 0.72 - nx * 0.5, by + dy * 0.72 - ny * 0.5), (bx + dx * 0.22 - nx, by + dy * 0.22 - ny), base)


def add_partial_halo(path: StitchPath, center: Point, radius: float, start_angle: float, end_angle: float, steps: int) -> None:
    cx, cy = center
    start = (cx + math.cos(start_angle) * radius, cy + math.sin(start_angle) * radius)
    path.curve_to(
        ((path.current[0] + start[0]) / 2, path.current[1]),
        ((path.current[0] + start[0]) / 2, start[1]),
        start,
        tension=1.2,
    )
    for i in range(1, steps + 1):
        t = i / steps
        theta = start_angle + (end_angle - start_angle) * t
        lilt = 1.0 + 0.024 * math.sin(math.pi * 3.0 * t) + 0.012 * math.sin(math.pi * 7.0 * t)
        show_radius = radius * lilt
        path.add_point((cx + math.cos(theta) * show_radius, cy + math.sin(theta) * show_radius))


def build_native_medallion(size: float, spacing: float) -> list[Point]:
    p = StitchPath((size / 2, 0.0), spacing)

    def s(point: Point) -> Point:
        return scale_point(size, point)

    scale = size / 8.0

    # Start at the lower point, build the bottom motif, then rise into the
    # left frame. This makes the entry point feel like part of the medallion.
    p.curve_to(s((3.86, 0.28)), s((4.0, 0.62)), s((4.0, 1.02)))
    add_echo_heart(p, s((4.0, 1.02)), 0.72 * scale, mirror=1)
    p.curve_to(s((3.42, 0.9)), s((2.34, 1.12)), s((1.82, 1.58)))
    add_leaf(p, s((1.82, 1.58)), s((1.12, 1.0)), 0.18 * scale, mirror=-1)
    p.curve_to(s((1.3, 1.86)), s((1.02, 2.44)), s((1.16, 3.0)))
    add_open_scroll(p, s((1.16, 3.0)), s((1.58, 3.16)), s((1.98, 3.58)), mirror=1, scale=0.78 * scale)
    add_leaf(p, s((1.98, 3.58)), s((1.1, 4.26)), 0.18 * scale, mirror=1)

    # Left upper arc and top flame give the medallion a real frame/halo, not a
    # floating central flower.
    p.curve_to(s((2.16, 4.5)), s((2.44, 5.58)), s((3.18, 6.22)))
    add_leaf(p, s((3.18, 6.22)), s((2.66, 6.98)), 0.17 * scale, mirror=-1)
    p.curve_to(s((3.34, 6.56)), s((3.68, 6.88)), s((4.0, 7.12)))
    add_open_teardrop(p, s((4.0, 7.12)), s((4.0, 7.72)), 0.19 * scale)
    add_open_teardrop(p, s((4.02, 7.1)), s((4.24, 7.48)), 0.09 * scale)

    # Drop into the focal flower through an S-shaped stem rather than a
    # straight travel line.
    p.curve_to(s((4.46, 6.24)), s((3.22, 5.62)), s((3.58, 4.68)))
    add_leaf(p, s((3.58, 4.68)), s((2.98, 5.08)), 0.14 * scale, mirror=-1)
    p.curve_to(s((3.72, 4.42)), s((3.9, 4.18)), s((4.0, 4.0)))
    add_sakura_rosette(p, s((4.0, 4.0)), 1.18 * scale)
    p.curve_to(s((4.18, 4.18)), s((4.4, 4.34)), s((4.58, 4.28)))
    add_leaf(p, s((4.58, 4.28)), s((5.1, 4.76)), 0.12 * scale, mirror=1)
    p.curve_to(s((4.42, 4.18)), s((4.16, 4.08)), s((4.0, 4.0)))

    # Partial echo halo adds focal richness without closing off the route.
    add_partial_halo(p, s((4.0, 4.0)), 1.15 * scale, math.radians(205), math.radians(338), 58)
    p.curve_to(s((5.18, 3.88)), s((5.62, 4.42)), s((6.02, 4.0)))
    add_leaf(p, s((6.02, 4.0)), s((6.92, 4.62)), 0.19 * scale, mirror=-1)

    # Right-side support uses the same vocabulary at a different scale.
    p.curve_to(s((6.42, 3.52)), s((6.88, 2.74)), s((6.56, 2.1)))
    add_open_scroll(p, s((6.56, 2.1)), s((6.08, 1.96)), s((5.64, 1.58)), mirror=-1, scale=0.8 * scale)
    add_leaf(p, s((5.64, 1.58)), s((6.52, 1.02)), 0.18 * scale, mirror=-1)
    p.curve_to(s((5.1, 1.16)), s((4.52, 0.86)), s((4.04, 0.78)))
    add_leaf(p, s((4.04, 0.78)), s((4.72, 0.38)), 0.13 * scale, mirror=-1)

    # Close the medallion on the original lower point with a visible vine.
    p.curve_to(s((4.26, 0.5)), s((4.12, 0.18)), (size / 2, 0.0))
    points = soften_hard_turns(p.points, min_angle=172.0, radius=max(0.014 * scale, spacing * 0.62))
    return [(round(x, 5), round(y, 5)) for x, y in points]


def write_dxf(path: Path, points: list[Point], layer: str) -> None:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
        "0", "POLYLINE", "8", layer[:31] or "native-focal-medallion", "66", "1", "70", "0",
    ]
    for x, y in points:
        lines.extend(["0", "VERTEX", "8", layer[:31] or "native-focal-medallion", "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
    lines.extend(["0", "SEQEND", "0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_svg(path: Path, points: list[Point], size: float, title: str) -> None:
    min_x, min_y, max_x, max_y = bounds(points + [(0, 0), (size, 0), (size, size), (0, size)])
    margin = 0.4
    view_x = min_x - margin
    view_y = -(max_y + margin)
    view_w = (max_x - min_x) + margin * 2
    view_h = (max_y - min_y) + margin * 2
    guide_square = f"0,0 {size:.5f},0 {size:.5f},{-size:.5f} 0,{-size:.5f} 0,0"
    guide_diamond = f"{size/2:.5f},{-size*0.12:.5f} {size*0.88:.5f},{-size/2:.5f} {size/2:.5f},{-size*0.88:.5f} {size*0.12:.5f},{-size/2:.5f} {size/2:.5f},{-size*0.12:.5f}"
    guide_cross = [
        f'<line x1="{size/2:.5f}" y1="0" x2="{size/2:.5f}" y2="{-size:.5f}" stroke="{GUIDE}" stroke-width="0.012" stroke-dasharray="0.08 0.06"/>',
        f'<line x1="0" y1="{-size/2:.5f}" x2="{size:.5f}" y2="{-size/2:.5f}" stroke="{GUIDE}" stroke-width="0.012" stroke-dasharray="0.08 0.06"/>',
    ]
    stitch_points = " ".join(f"{x:.5f},{-y:.5f}" for x, y in points)
    content = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_x:.4f} {view_y:.4f} {view_w:.4f} {view_h:.4f}">',
        f"<title>{title}</title>",
        f'<rect x="{view_x:.4f}" y="{view_y:.4f}" width="{view_w:.4f}" height="{view_h:.4f}" fill="{BACKGROUND}"/>',
        f'<polyline points="{guide_square}" fill="none" stroke="{GUIDE}" stroke-width="0.018" stroke-dasharray="0.10 0.08"/>',
        f'<polyline points="{guide_diamond}" fill="none" stroke="{GUIDE}" stroke-width="0.014" stroke-dasharray="0.08 0.06"/>',
        *guide_cross,
        f'<polyline points="{stitch_points}" fill="none" stroke="{BLUE}" stroke-width="0.035" stroke-linecap="round" stroke-linejoin="round"/>',
        "</svg>",
    ]
    path.write_text("\n".join(content) + "\n", encoding="utf-8")


def write_png(path: Path, points: list[Point], size: float, size_px: int = 1300) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    min_x, min_y, max_x, max_y = bounds(points + [(0, 0), (size, 0), (size, size), (0, size)])
    margin = 0.4
    scale = min(size_px / ((max_x - min_x) + margin * 2), size_px / ((max_y - min_y) + margin * 2))
    img_w = max(80, int(((max_x - min_x) + margin * 2) * scale))
    img_h = max(80, int(((max_y - min_y) + margin * 2) * scale))
    image = Image.new("RGB", (img_w, img_h), (247, 247, 244))
    draw = ImageDraw.Draw(image)

    def map_point(point: Point) -> tuple[float, float]:
        return ((point[0] - min_x + margin) * scale, (max_y - point[1] + margin) * scale)

    guide_square = [(0, 0), (size, 0), (size, size), (0, size), (0, 0)]
    guide_diamond = [(size / 2, size * 0.12), (size * 0.88, size / 2), (size / 2, size * 0.88), (size * 0.12, size / 2), (size / 2, size * 0.12)]
    guide_width = max(1, int(scale * 0.016))
    draw.line([map_point(point) for point in guide_square], fill=(212, 208, 200), width=guide_width)
    draw.line([map_point(point) for point in guide_diamond], fill=(212, 208, 200), width=guide_width)
    draw.line([map_point((size / 2, 0)), map_point((size / 2, size))], fill=(212, 208, 200), width=max(1, int(scale * 0.01)))
    draw.line([map_point((0, size / 2)), map_point((size, size / 2))], fill=(212, 208, 200), width=max(1, int(scale * 0.01)))
    draw.line([map_point(point) for point in points], fill=(7, 95, 134), width=max(2, int(scale * 0.035)), joint="curve")
    image.save(path)
    return True


def metrics(points: list[Point], size: float, component: str) -> dict:
    segs = segment_lengths(points)
    turns = turn_angles(points)
    min_x, min_y, max_x, max_y = bounds(points)
    return {
        "component": component,
        "shape_count": 1,
        "point_count": len(points),
        "medallion_size": size,
        "start": [round(points[0][0], 5), round(points[0][1], 5)],
        "end": [round(points[-1][0], 5), round(points[-1][1], 5)],
        "start_end_distance": round(math.hypot(points[-1][0] - points[0][0], points[-1][1] - points[0][1]), 6),
        "bounds": [round(min_x, 5), round(min_y, 5), round(max_x, 5), round(max_y, 5)],
        "drawn_length": round(path_length(points), 5),
        "segment_count": len(segs),
        "min_segment": round(min(segs), 5) if segs else 0.0,
        "max_segment": round(max(segs), 5) if segs else 0.0,
        "hard_turn_count": len([angle for angle in turns if angle >= 172]),
        "cusp_turn_count": len([angle for angle in turns if angle >= 135]),
        "notes": [
            "One native continuous stitch path.",
            "Closed lower-point medallion route.",
            "Focal design contains rosette, halo, hearts, leaves, scrolls, and a top flame/echo.",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Native Sakura Focal Medallion")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=float, default=8.0)
    parser.add_argument("--stitch-spacing", type=float, default=0.025)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = "native-sakura-focal-medallion"
    points = build_native_medallion(args.size, args.stitch_spacing)
    mirrored = mirror_medallion(points, args.size)

    write_dxf(out_dir / f"{base}.dxf", points, "native-focal-medallion")
    write_dxf(out_dir / f"{base}-mirrored.dxf", mirrored, "native-focal-mirror")
    write_svg(out_dir / f"{base}.svg", points, args.size, args.name)
    write_svg(out_dir / f"{base}-mirrored.svg", mirrored, args.size, f"{args.name} mirrored")
    write_png(out_dir / f"{base}.png", points, args.size)
    write_png(out_dir / f"{base}-mirrored.png", mirrored, args.size)

    result = {
        "medallion": metrics(points, args.size, "focal-medallion"),
        "mirrored": metrics(mirrored, args.size, "focal-medallion-mirrored"),
    }
    (out_dir / "native-focal-medallion-metrics.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(out_dir / f"{base}-dxf.zip", "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(out_dir / f"{base}.dxf", arcname=f"{base}.dxf")
        zf.write(out_dir / f"{base}-mirrored.dxf", arcname=f"{base}-mirrored.dxf")
    print(json.dumps({"out": str(out_dir), "metrics": result}, indent=2))
    return 0 if result["medallion"]["start_end_distance"] <= 0.001 else 1


if __name__ == "__main__":
    raise SystemExit(main())
