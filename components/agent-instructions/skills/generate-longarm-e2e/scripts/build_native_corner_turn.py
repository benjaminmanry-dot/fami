#!/usr/bin/env python3
"""Build a native continuous-line border corner turn for computerized longarm quilting."""

from __future__ import annotations

import argparse
import json
import math
import zipfile
from pathlib import Path

from build_native_border_repeat import (
    BACKGROUND,
    BLUE,
    StitchPath,
    add_leaf,
    add_open_scroll,
    build_native_border,
)
from longarm_geometry import Point, path_length, segment_lengths, turn_angles


def scaled(size: float, point: Point) -> Point:
    factor = size / 6.0
    return (point[0] * factor, point[1] * factor)


def add_petal_loop(path: StitchPath, center: Point, angle: float, length: float, width: float) -> None:
    if math.hypot(path.current[0] - center[0], path.current[1] - center[1]) > 1e-6:
        path.curve_to(
            ((path.current[0] + center[0]) / 2, path.current[1]),
            ((path.current[0] + center[0]) / 2, center[1]),
            center,
            tension=1.3,
        )
    cx, cy = center
    dx, dy = math.cos(angle), math.sin(angle)
    nx, ny = -dy, dx
    tip = (cx + dx * length, cy + dy * length)
    path.curve_to(
        (cx + dx * length * 0.28 + nx * width, cy + dy * length * 0.28 + ny * width),
        (cx + dx * length * 0.72 + nx * width * 0.45, cy + dy * length * 0.72 + ny * width * 0.45),
        tip,
    )
    path.curve_to(
        (cx + dx * length * 0.72 - nx * width * 0.45, cy + dy * length * 0.72 - ny * width * 0.45),
        (cx + dx * length * 0.28 - nx * width, cy + dy * length * 0.28 - ny * width),
        center,
    )


def add_corner_rosette(path: StitchPath, center: Point, scale: float) -> None:
    for degrees, length, width in [
        (132, 0.82, 0.22),
        (82, 0.9, 0.24),
        (25, 0.84, 0.22),
        (-38, 0.9, 0.23),
        (-105, 0.82, 0.22),
    ]:
        add_petal_loop(path, center, math.radians(degrees), length * scale, width * scale)
    # A small open center circuit gives the rosette a focal point without
    # becoming a dense knot.
    cx, cy = center
    radius = 0.13 * scale
    start = (cx + radius, cy)
    path.curve_to((cx + radius * 0.8, cy + radius), (cx + radius, cy + radius * 0.8), start, tension=1.5)
    for i in range(1, 15):
        theta = math.tau * i / 14
        path.add_point((cx + math.cos(theta) * radius, cy + math.sin(theta) * radius))


def build_native_corner(size: float, spacing: float) -> list[Point]:
    """Return a top-right corner component from (0, 0) to (size, -size)."""
    p = StitchPath((0.0, 0.0), spacing)

    def s(point: Point) -> Point:
        return scaled(size, point)

    scale = size / 6.0

    # Enter from the horizontal border and immediately become a designed turn,
    # not a diagonal travel shortcut.
    p.curve_to(s((0.32, -0.1)), s((0.72, -0.18)), s((1.08, -0.08)))
    add_leaf(p, s((1.08, -0.08)), s((1.62, 0.18)), 0.18 * scale, mirror=1)
    p.curve_to(s((1.32, -0.22)), s((1.52, -0.68)), s((1.88, -0.88)))
    add_open_scroll(p, s((1.88, -0.88)), s((2.18, -1.18)), s((2.62, -1.78)), mirror=1, scale=scale)

    # Corner rosette: a true sakura-style turn motif with route-native petals.
    p.curve_to(s((2.34, -2.12)), s((2.72, -2.5)), s((3.24, -2.72)))
    add_corner_rosette(p, s((3.24, -2.72)), scale)

    # Exit scroll and leaf rotate the grammar onto the side border.
    p.curve_to(s((3.92, -3.18)), s((4.38, -3.78)), s((4.62, -4.16)))
    add_open_scroll(p, s((4.62, -4.16)), s((4.86, -4.46)), s((5.02, -4.74)), mirror=-1, scale=scale)
    add_leaf(p, s((5.02, -4.74)), s((5.36, -5.28)), 0.18 * scale, mirror=-1)
    p.curve_to(s((5.48, -5.34)), s((5.88, -5.7)), s((6.0, -6.0)))
    return [(round(x, 5), round(y, 5)) for x, y in p.points]


def transform(points: list[Point], dx: float = 0.0, dy: float = 0.0, rotate_down: bool = False, origin: Point = (0.0, 0.0)) -> list[Point]:
    if not rotate_down:
        return [(round(x + dx, 5), round(y + dy, 5)) for x, y in points]
    ox, oy = origin
    return [(round(ox + y + dx, 5), round(oy - x + dy, 5)) for x, y in points]


def append_path(target: list[Point], points: list[Point]) -> None:
    for point in points:
        if not target or math.hypot(point[0] - target[-1][0], point[1] - target[-1][1]) > 1e-7:
            target.append(point)


def build_chain(size: float, spacing: float, top_repeats: int, side_repeats: int) -> list[Point]:
    border = build_native_border(size, spacing)
    corner = build_native_corner(size, spacing)
    chain: list[Point] = []
    for repeat in range(top_repeats):
        append_path(chain, transform(border, dx=size * repeat))
    corner_origin_x = size * top_repeats
    append_path(chain, transform(corner, dx=corner_origin_x))
    side_origin = (corner_origin_x + size, -size)
    for repeat in range(side_repeats):
        side = transform(border, rotate_down=True, origin=(side_origin[0], side_origin[1] - size * repeat))
        append_path(chain, side)
    return chain


def bounds(points: list[Point]) -> tuple[float, float, float, float]:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), min(ys), max(xs), max(ys)


def write_dxf(path: Path, points: list[Point], layer: str) -> None:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
        "0", "POLYLINE", "8", layer[:31] or "native-corner-turn", "66", "1", "70", "0",
    ]
    for x, y in points:
        lines.extend(["0", "VERTEX", "8", layer[:31] or "native-corner-turn", "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
    lines.extend(["0", "SEQEND", "0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_svg(path: Path, points: list[Point], title: str) -> None:
    min_x, min_y, max_x, max_y = bounds(points)
    margin = 0.4
    view_x = min_x - margin
    view_y = -(max_y + margin)
    view_w = (max_x - min_x) + margin * 2
    view_h = (max_y - min_y) + margin * 2
    content = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_x:.4f} {view_y:.4f} {view_w:.4f} {view_h:.4f}">',
        f"<title>{title}</title>",
        f'<rect x="{view_x:.4f}" y="{view_y:.4f}" width="{view_w:.4f}" height="{view_h:.4f}" fill="{BACKGROUND}"/>',
        '<polyline points="'
        + " ".join(f"{x:.5f},{-y:.5f}" for x, y in points)
        + f'" fill="none" stroke="{BLUE}" stroke-width="0.035" stroke-linecap="round" stroke-linejoin="round"/>',
        "</svg>",
    ]
    path.write_text("\n".join(content) + "\n", encoding="utf-8")


def write_png(path: Path, points: list[Point], size_px: int = 1400) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    min_x, min_y, max_x, max_y = bounds(points)
    margin = 0.4
    scale = min(size_px / ((max_x - min_x) + margin * 2), size_px / ((max_y - min_y) + margin * 2))
    img_w = max(80, int(((max_x - min_x) + margin * 2) * scale))
    img_h = max(80, int(((max_y - min_y) + margin * 2) * scale))
    image = Image.new("RGB", (img_w, img_h), (247, 247, 244))
    draw = ImageDraw.Draw(image)

    def map_point(point: Point) -> tuple[float, float]:
        return ((point[0] - min_x + margin) * scale, (max_y - point[1] + margin) * scale)

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
        "size": size,
        "start": [round(points[0][0], 5), round(points[0][1], 5)],
        "end": [round(points[-1][0], 5), round(points[-1][1], 5)],
        "bounds": [round(min_x, 5), round(min_y, 5), round(max_x, 5), round(max_y, 5)],
        "drawn_length": round(path_length(points), 5),
        "segment_count": len(segs),
        "min_segment": round(min(segs), 5) if segs else 0,
        "max_segment": round(max(segs), 5) if segs else 0,
        "hard_turn_count": len([angle for angle in turns if angle >= 172]),
        "cusp_turn_count": len([angle for angle in turns if angle >= 135]),
        "notes": [
            "One native continuous stitch path.",
            "Corner starts on the horizontal border baseline and exits on the vertical border baseline.",
            "Use the chain preview to judge whether straight-repeat and corner grammar coordinate.",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Native Sakura Heart Corner Turn")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=float, default=6.0)
    parser.add_argument("--stitch-spacing", type=float, default=0.025)
    parser.add_argument("--top-repeats", type=int, default=2)
    parser.add_argument("--side-repeats", type=int, default=2)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    corner_base = "native-sakura-heart-corner-turn"
    chain_base = "native-border-corner-chain"
    corner = build_native_corner(args.size, args.stitch_spacing)
    chain = build_chain(args.size, args.stitch_spacing, args.top_repeats, args.side_repeats)

    write_dxf(out_dir / f"{corner_base}.dxf", corner, "native-corner-turn")
    write_svg(out_dir / f"{corner_base}.svg", corner, args.name)
    write_png(out_dir / f"{corner_base}.png", corner)
    write_dxf(out_dir / f"{chain_base}.dxf", chain, "native-border-corner-chain")
    write_svg(out_dir / f"{chain_base}.svg", chain, f"{args.name} chain test")
    write_png(out_dir / f"{chain_base}.png", chain)

    result = {
        "corner": metrics(corner, args.size, "corner"),
        "chain": metrics(chain, args.size, "border-corner-chain"),
    }
    (out_dir / "native-corner-metrics.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(out_dir / f"{corner_base}-dxf.zip", "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(out_dir / f"{corner_base}.dxf", arcname=f"{corner_base}.dxf")
        zf.write(out_dir / f"{chain_base}.dxf", arcname=f"{chain_base}.dxf")
    print(json.dumps({"out": str(out_dir), "metrics": result}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
