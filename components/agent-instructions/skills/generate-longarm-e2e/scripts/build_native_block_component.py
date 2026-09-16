#!/usr/bin/env python3
"""Build a native continuous-line block component for computerized longarm quilting."""

from __future__ import annotations

import argparse
import json
import math
import zipfile
from pathlib import Path

from build_native_border_repeat import BACKGROUND, BLUE, StitchPath, add_leaf, add_open_scroll
from longarm_geometry import Point, path_length, segment_lengths, soften_hard_turns, turn_angles


GUIDE = "#d4d0c8"


def scale_point(size: float, point: Point) -> Point:
    return (point[0] * size / 6.0, point[1] * size / 6.0)


def bounds(points: list[Point]) -> tuple[float, float, float, float]:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), min(ys), max(xs), max(ys)


def append_path(target: list[Point], points: list[Point]) -> None:
    for point in points:
        if not target or math.hypot(point[0] - target[-1][0], point[1] - target[-1][1]) > 1e-7:
            target.append(point)


def mirror_block(points: list[Point], size: float) -> list[Point]:
    return [(round(size - x, 5), y) for x, y in reversed(points)]


def build_row(points: list[Point], repeats: int) -> list[Point]:
    if repeats <= 1:
        return list(points)
    min_x, _, max_x, _ = bounds(points)
    width = max_x - min_x
    row: list[Point] = []
    for repeat in range(repeats):
        append_path(row, [(round(x + width * repeat, 5), y) for x, y in points])
    return row


def add_petal_loop(path: StitchPath, center: Point, angle: float, length: float, width: float) -> None:
    if math.hypot(path.current[0] - center[0], path.current[1] - center[1]) > 1e-6:
        path.curve_to(
            ((path.current[0] + center[0]) / 2, path.current[1]),
            ((path.current[0] + center[0]) / 2, center[1]),
            center,
            tension=1.25,
        )
    cx, cy = center
    dx, dy = math.cos(angle), math.sin(angle)
    nx, ny = -dy, dx
    tip = (cx + dx * length, cy + dy * length)
    path.curve_to(
        (cx + dx * length * 0.25 + nx * width, cy + dy * length * 0.25 + ny * width),
        (cx + dx * length * 0.74 + nx * width * 0.48, cy + dy * length * 0.74 + ny * width * 0.48),
        tip,
    )
    path.curve_to(
        (cx + dx * length * 0.74 - nx * width * 0.48, cy + dy * length * 0.74 - ny * width * 0.48),
        (cx + dx * length * 0.25 - nx * width, cy + dy * length * 0.25 - ny * width),
        center,
    )


def add_sakura_rosette(path: StitchPath, center: Point, scale: float) -> None:
    petals = [
        (92, 0.78, 0.2),
        (30, 0.86, 0.22),
        (-36, 0.82, 0.2),
        (-108, 0.74, 0.19),
        (168, 0.82, 0.2),
    ]
    cx, cy = center
    hub_radius = 0.055 * scale
    for degrees, length, width in petals:
        angle = math.radians(degrees)
        petal_base = (cx + math.cos(angle) * hub_radius, cy + math.sin(angle) * hub_radius)
        add_petal_loop(path, petal_base, angle, length * scale, width * scale)
    cx, cy = center
    radius = 0.13 * scale
    start = (cx + radius, cy)
    path.curve_to((cx + radius * 0.7, cy + radius), (cx + radius, cy + radius * 0.7), start, tension=1.5)
    for i in range(1, 16):
        theta = math.tau * i / 15
        path.add_point((cx + math.cos(theta) * radius, cy + math.sin(theta) * radius))


def add_echo_heart(path: StitchPath, base: Point, size: float, mirror: int) -> None:
    if math.hypot(path.current[0] - base[0], path.current[1] - base[1]) > 1e-6:
        path.curve_to(
            ((path.current[0] + base[0]) / 2, path.current[1]),
            ((path.current[0] + base[0]) / 2, base[1]),
            base,
        )
    bx, by = base
    m = mirror
    path.curve_to((bx + 0.18 * size * m, by + 0.42 * size), (bx + 0.62 * size * m, by + 0.52 * size), (bx + 0.58 * size * m, by + 0.12 * size))
    path.curve_to((bx + 0.54 * size * m, by - 0.22 * size), (bx + 0.16 * size * m, by - 0.22 * size), (bx, by - 0.56 * size))
    path.curve_to((bx - 0.16 * size * m, by - 0.22 * size), (bx - 0.54 * size * m, by - 0.22 * size), (bx - 0.58 * size * m, by + 0.12 * size))
    path.curve_to((bx - 0.62 * size * m, by + 0.52 * size), (bx - 0.18 * size * m, by + 0.42 * size), base)
    path.curve_to((bx + 0.12 * size * m, by + 0.24 * size), (bx + 0.35 * size * m, by + 0.16 * size), (bx + 0.34 * size * m, by + 0.02 * size))
    path.curve_to((bx + 0.32 * size * m, by - 0.16 * size), (bx + 0.08 * size * m, by - 0.18 * size), (bx, by - 0.38 * size))
    path.curve_to((bx - 0.08 * size * m, by - 0.18 * size), (bx - 0.32 * size * m, by - 0.16 * size), (bx - 0.34 * size * m, by + 0.02 * size))
    path.curve_to((bx - 0.35 * size * m, by + 0.16 * size), (bx - 0.12 * size * m, by + 0.24 * size), base)


def build_native_block(size: float, spacing: float) -> list[Point]:
    p = StitchPath((0.0, 0.0), spacing)

    def s(point: Point) -> Point:
        return scale_point(size, point)

    scale = size / 6.0

    # Bottom-left entry becomes the lower block support instead of a naked
    # connector. The design then moves through a soft diamond skeleton.
    p.curve_to(s((0.12, 0.0)), s((0.28, 0.0)), s((0.42, 0.04)), tension=0.8)
    p.curve_to(s((0.62, 0.18)), s((0.78, 0.46)), s((0.98, 0.62)))
    add_leaf(p, s((0.98, 0.62)), s((1.46, 1.14)), 0.15 * scale, mirror=1)
    p.curve_to(s((1.14, 0.95)), s((1.2, 1.48)), s((1.0, 2.02)))
    add_open_scroll(p, s((1.0, 2.02)), s((1.32, 2.28)), s((1.72, 2.7)), mirror=1, scale=0.75 * scale)
    add_leaf(p, s((1.72, 2.7)), s((0.9, 3.34)), 0.17 * scale, mirror=1)

    # Upper arc and top leaf create containment before the central rosette.
    p.curve_to(s((1.9, 3.46)), s((2.32, 4.38)), s((3.0, 4.7)))
    add_leaf(p, s((3.0, 4.7)), s((3.58, 5.18)), 0.15 * scale, mirror=-1)
    p.curve_to(s((2.78, 4.28)), s((2.6, 3.62)), s((3.0, 3.0)))

    add_sakura_rosette(p, s((3.0, 3.0)), 0.95 * scale)

    # Right-side support balances the left but is not a stamped copy.
    p.curve_to(s((3.42, 3.36)), s((4.0, 3.54)), s((4.54, 3.16)))
    add_leaf(p, s((4.54, 3.16)), s((5.24, 3.78)), 0.16 * scale, mirror=-1)
    p.curve_to(s((4.8, 2.94)), s((5.1, 2.42)), s((4.92, 1.94)))
    add_open_scroll(p, s((4.92, 1.94)), s((4.62, 1.7)), s((4.22, 1.34)), mirror=-1, scale=0.72 * scale)
    add_leaf(p, s((4.22, 1.34)), s((5.0, 0.88)), 0.16 * scale, mirror=-1)

    # The lower heart is a supporting echo motif and returns the route toward
    # the exit baseline.
    p.curve_to(s((3.86, 1.1)), s((3.48, 0.98)), s((3.0, 1.04)))
    add_echo_heart(p, s((3.0, 1.04)), 0.76 * scale, mirror=1)
    p.curve_to(s((3.48, 0.7)), s((3.92, 0.62)), s((4.3, 0.7)))
    add_leaf(p, s((4.3, 0.7)), s((4.88, 1.04)), 0.14 * scale, mirror=1)
    p.curve_to(s((4.58, 0.52)), s((5.0, 0.34)), s((5.42, 0.36)))
    add_leaf(p, s((5.42, 0.36)), s((5.84, 0.78)), 0.12 * scale, mirror=1)
    p.curve_to(s((5.62, 0.24)), s((5.72, 0.06)), s((5.82, 0.02)))
    p.curve_to(s((5.88, 0.0)), s((5.95, 0.0)), s((6.0, 0.0)), tension=0.8)
    points = soften_hard_turns(p.points, min_angle=172.0, radius=max(0.014 * scale, spacing * 0.62))
    return [(round(x, 5), round(y, 5)) for x, y in points]


def write_dxf(path: Path, points: list[Point], layer: str) -> None:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
        "0", "POLYLINE", "8", layer[:31] or "native-block", "66", "1", "70", "0",
    ]
    for x, y in points:
        lines.extend(["0", "VERTEX", "8", layer[:31] or "native-block", "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
    lines.extend(["0", "SEQEND", "0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_svg(path: Path, points: list[Point], size: float, title: str) -> None:
    min_x, min_y, max_x, max_y = bounds(points + [(0, 0), (size, 0), (size, size), (0, size)])
    margin = 0.35
    view_x = min_x - margin
    view_y = -(max_y + margin)
    view_w = (max_x - min_x) + margin * 2
    view_h = (max_y - min_y) + margin * 2
    guide_square = f"0,0 {size:.5f},0 {size:.5f},{-size:.5f} 0,{-size:.5f} 0,0"
    guide_diamond = f"{size/2:.5f},{-size*0.17:.5f} {size*0.83:.5f},{-size/2:.5f} {size/2:.5f},{-size*0.83:.5f} {size*0.17:.5f},{-size/2:.5f} {size/2:.5f},{-size*0.17:.5f}"
    stitch_points = " ".join(f"{x:.5f},{-y:.5f}" for x, y in points)
    content = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_x:.4f} {view_y:.4f} {view_w:.4f} {view_h:.4f}">',
        f"<title>{title}</title>",
        f'<rect x="{view_x:.4f}" y="{view_y:.4f}" width="{view_w:.4f}" height="{view_h:.4f}" fill="{BACKGROUND}"/>',
        f'<polyline points="{guide_square}" fill="none" stroke="{GUIDE}" stroke-width="0.018" stroke-dasharray="0.10 0.08"/>',
        f'<polyline points="{guide_diamond}" fill="none" stroke="{GUIDE}" stroke-width="0.012" stroke-dasharray="0.08 0.06"/>',
        f'<polyline points="{stitch_points}" fill="none" stroke="{BLUE}" stroke-width="0.035" stroke-linecap="round" stroke-linejoin="round"/>',
        "</svg>",
    ]
    path.write_text("\n".join(content) + "\n", encoding="utf-8")


def write_png(path: Path, points: list[Point], size: float, size_px: int = 1200) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    min_x, min_y, max_x, max_y = bounds(points + [(0, 0), (size, 0), (size, size), (0, size)])
    margin = 0.35
    scale = min(size_px / ((max_x - min_x) + margin * 2), size_px / ((max_y - min_y) + margin * 2))
    img_w = max(80, int(((max_x - min_x) + margin * 2) * scale))
    img_h = max(80, int(((max_y - min_y) + margin * 2) * scale))
    image = Image.new("RGB", (img_w, img_h), (247, 247, 244))
    draw = ImageDraw.Draw(image)

    def map_point(point: Point) -> tuple[float, float]:
        return ((point[0] - min_x + margin) * scale, (max_y - point[1] + margin) * scale)

    guide_square = [(0, 0), (size, 0), (size, size), (0, size), (0, 0)]
    guide_diamond = [(size / 2, size * 0.17), (size * 0.83, size / 2), (size / 2, size * 0.83), (size * 0.17, size / 2), (size / 2, size * 0.17)]
    guide_width = max(1, int(scale * 0.018))
    draw.line([map_point(point) for point in guide_square], fill=(212, 208, 200), width=guide_width)
    draw.line([map_point(point) for point in guide_diamond], fill=(212, 208, 200), width=guide_width)
    draw.line([map_point(point) for point in points], fill=(7, 95, 134), width=max(2, int(scale * 0.035)), joint="curve")
    image.save(path)
    return True


def write_row_svg(path: Path, points: list[Point], size: float, repeats: int, title: str) -> None:
    row = build_row(points, repeats)
    min_x, min_y, max_x, max_y = bounds(row + [(0, 0), (size * repeats, 0), (size * repeats, size), (0, size)])
    margin = 0.35
    view_x = min_x - margin
    view_y = -(max_y + margin)
    view_w = (max_x - min_x) + margin * 2
    view_h = (max_y - min_y) + margin * 2
    stitch_points = " ".join(f"{x:.5f},{-y:.5f}" for x, y in row)
    content = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_x:.4f} {view_y:.4f} {view_w:.4f} {view_h:.4f}">',
        f"<title>{title}</title>",
        f'<rect x="{view_x:.4f}" y="{view_y:.4f}" width="{view_w:.4f}" height="{view_h:.4f}" fill="{BACKGROUND}"/>',
    ]
    for repeat in range(repeats):
        x0 = repeat * size
        guide_square = f"{x0:.5f},0 {x0 + size:.5f},0 {x0 + size:.5f},{-size:.5f} {x0:.5f},{-size:.5f} {x0:.5f},0"
        content.append(f'<polyline points="{guide_square}" fill="none" stroke="{GUIDE}" stroke-width="0.018" stroke-dasharray="0.10 0.08"/>')
    content.append(f'<polyline points="{stitch_points}" fill="none" stroke="{BLUE}" stroke-width="0.035" stroke-linecap="round" stroke-linejoin="round"/>')
    content.append("</svg>")
    path.write_text("\n".join(content) + "\n", encoding="utf-8")


def write_row_png(path: Path, points: list[Point], size: float, repeats: int, size_px: int = 1800) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    row = build_row(points, repeats)
    min_x, min_y, max_x, max_y = bounds(row + [(0, 0), (size * repeats, 0), (size * repeats, size), (0, size)])
    margin = 0.35
    scale = min(size_px / ((max_x - min_x) + margin * 2), size_px / ((max_y - min_y) + margin * 2))
    img_w = max(80, int(((max_x - min_x) + margin * 2) * scale))
    img_h = max(80, int(((max_y - min_y) + margin * 2) * scale))
    image = Image.new("RGB", (img_w, img_h), (247, 247, 244))
    draw = ImageDraw.Draw(image)

    def map_point(point: Point) -> tuple[float, float]:
        return ((point[0] - min_x + margin) * scale, (max_y - point[1] + margin) * scale)

    guide_width = max(1, int(scale * 0.018))
    for repeat in range(repeats):
        x0 = repeat * size
        guide_square = [(x0, 0), (x0 + size, 0), (x0 + size, size), (x0, size), (x0, 0)]
        draw.line([map_point(point) for point in guide_square], fill=(212, 208, 200), width=guide_width)
    draw.line([map_point(point) for point in row], fill=(7, 95, 134), width=max(2, int(scale * 0.035)), joint="curve")
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
        "block_size": size,
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
            "Start and end sit on the bottom baseline for row chaining.",
            "Block uses a soft diamond skeleton, focal rosette, supporting leaves, scrolls, and lower echo heart.",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Native Sakura Diamond Block")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=float, default=6.0)
    parser.add_argument("--stitch-spacing", type=float, default=0.025)
    parser.add_argument("--row-repeats", type=int, default=3)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = "native-sakura-diamond-block"
    points = build_native_block(args.size, args.stitch_spacing)
    mirrored = mirror_block(points, args.size)
    row = build_row(points, args.row_repeats)

    write_dxf(out_dir / f"{base}.dxf", points, "native-block")
    write_dxf(out_dir / f"{base}-mirrored.dxf", mirrored, "native-block-mirror")
    write_dxf(out_dir / f"{base}-row.dxf", row, "native-block-row")
    write_svg(out_dir / f"{base}.svg", points, args.size, args.name)
    write_svg(out_dir / f"{base}-mirrored.svg", mirrored, args.size, f"{args.name} mirrored")
    write_row_svg(out_dir / f"{base}-row.svg", points, args.size, args.row_repeats, f"{args.name} row")
    write_png(out_dir / f"{base}.png", points, args.size)
    write_png(out_dir / f"{base}-mirrored.png", mirrored, args.size)
    write_row_png(out_dir / f"{base}-row.png", points, args.size, args.row_repeats)

    result = {
        "block": metrics(points, args.size, "block"),
        "mirrored": metrics(mirrored, args.size, "block-mirrored"),
        "row": metrics(row, args.size * args.row_repeats, "block-row"),
    }
    (out_dir / "native-block-metrics.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(out_dir / f"{base}-dxf.zip", "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(out_dir / f"{base}.dxf", arcname=f"{base}.dxf")
        zf.write(out_dir / f"{base}-mirrored.dxf", arcname=f"{base}-mirrored.dxf")
        zf.write(out_dir / f"{base}-row.dxf", arcname=f"{base}-row.dxf")
    print(json.dumps({"out": str(out_dir), "metrics": result}, indent=2))
    return 0 if result["block"]["start_end_y_delta"] <= 0.001 else 1


if __name__ == "__main__":
    raise SystemExit(main())
