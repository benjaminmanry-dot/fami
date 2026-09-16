#!/usr/bin/env python3
"""Build a native continuous-line sashing rail for computerized longarm quilting."""

from __future__ import annotations

import argparse
import json
import math
import zipfile
from pathlib import Path

from build_native_border_repeat import BACKGROUND, BLUE, StitchPath, add_leaf, add_open_scroll
from longarm_geometry import Point, path_length, segment_lengths, soften_hard_turns, turn_angles


GUIDE = "#d4d0c8"


def scale_point(width: float, height: float, point: Point) -> Point:
    return (point[0] * width / 8.0, point[1] * height / 1.5)


def bounds(points: list[Point]) -> tuple[float, float, float, float]:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), min(ys), max(xs), max(ys)


def append_path(target: list[Point], points: list[Point]) -> None:
    for point in points:
        if not target or math.hypot(point[0] - target[-1][0], point[1] - target[-1][1]) > 1e-7:
            target.append(point)


def transform(points: list[Point], dx: float = 0.0, dy: float = 0.0, rotate_vertical: bool = False) -> list[Point]:
    if not rotate_vertical:
        return [(round(x + dx, 5), round(y + dy, 5)) for x, y in points]
    return [(round(-y + dx, 5), round(x + dy, 5)) for x, y in points]


def build_native_sashing(width: float, height: float, spacing: float) -> list[Point]:
    p = StitchPath((0.0, 0.0), spacing)

    def s(point: Point) -> Point:
        return scale_point(width, height, point)

    unit = min(width / 8.0, height / 1.5)
    leaf_w = 0.105 * unit
    small_leaf_w = 0.085 * unit

    # The sashing rail is a quieter chain than the border repeat: one flowing
    # vine, alternating small leaves, and modest curls that absorb travel.
    p.curve_to(s((0.28, 0.08)), s((0.58, 0.12)), s((0.86, 0.03)))
    add_leaf(p, s((0.86, 0.03)), s((1.34, 0.33)), leaf_w, mirror=1)
    p.curve_to(s((1.08, -0.08)), s((1.34, -0.24)), s((1.68, -0.22)))
    add_open_scroll(p, s((1.68, -0.22)), s((1.98, -0.17)), s((2.24, 0.02)), mirror=1, scale=0.55 * unit)
    add_leaf(p, s((2.24, 0.02)), s((2.78, -0.28)), small_leaf_w, mirror=-1)
    p.curve_to(s((2.54, 0.12)), s((2.86, 0.23)), s((3.18, 0.17)))
    add_leaf(p, s((3.18, 0.17)), s((3.72, 0.4)), small_leaf_w, mirror=1)
    p.curve_to(s((3.52, 0.02)), s((3.74, -0.18)), s((4.02, -0.18)))
    add_open_scroll(p, s((4.02, -0.18)), s((4.34, -0.1)), s((4.64, 0.08)), mirror=-1, scale=0.5 * unit)
    add_leaf(p, s((4.64, 0.08)), s((5.18, -0.24)), small_leaf_w, mirror=-1)
    p.curve_to(s((4.96, 0.18)), s((5.34, 0.3)), s((5.66, 0.18)))
    add_leaf(p, s((5.66, 0.18)), s((6.16, 0.42)), leaf_w, mirror=1)
    p.curve_to(s((5.98, 0.02)), s((6.26, -0.24)), s((6.62, -0.2)))
    add_open_scroll(p, s((6.62, -0.2)), s((6.92, -0.16)), s((7.16, 0.0)), mirror=1, scale=0.5 * unit)
    add_leaf(p, s((7.16, 0.0)), s((7.62, -0.26)), small_leaf_w, mirror=-1)
    p.curve_to(s((7.36, -0.1)), s((7.72, -0.04)), s((8.0, 0.0)))
    points = soften_hard_turns(p.points, min_angle=172.0, radius=max(0.011 * unit, spacing * 0.58))
    return [(round(x, 5), round(y, 5)) for x, y in points]


def build_chain(points: list[Point], repeats: int) -> list[Point]:
    if repeats <= 1:
        return list(points)
    min_x, _, max_x, _ = bounds(points)
    width = max_x - min_x
    chain: list[Point] = []
    for repeat in range(repeats):
        append_path(chain, transform(points, dx=width * repeat))
    return chain


def write_dxf(path: Path, points: list[Point], layer: str) -> None:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
        "0", "POLYLINE", "8", layer[:31] or "native-sashing-rail", "66", "1", "70", "0",
    ]
    for x, y in points:
        lines.extend(["0", "VERTEX", "8", layer[:31] or "native-sashing-rail", "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
    lines.extend(["0", "SEQEND", "0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_svg(path: Path, points: list[Point], title: str, height: float, repeats: int = 1, vertical: bool = False) -> None:
    show_points = transform(build_chain(points, repeats), rotate_vertical=vertical)
    min_x, min_y, max_x, max_y = bounds(show_points)
    margin = 0.28
    view_x = min_x - margin
    view_y = -(max_y + margin)
    view_w = (max_x - min_x) + margin * 2
    view_h = (max_y - min_y) + margin * 2
    stitch_points = " ".join(f"{x:.5f},{-y:.5f}" for x, y in show_points)
    guide_lines: list[str] = []
    if not vertical:
        guide_lines = [
            f'<line x1="{min_x:.5f}" y1="{height / 2:.5f}" x2="{max_x:.5f}" y2="{height / 2:.5f}" stroke="{GUIDE}" stroke-width="0.015" stroke-dasharray="0.08 0.06"/>',
            f'<line x1="{min_x:.5f}" y1="{-height / 2:.5f}" x2="{max_x:.5f}" y2="{-height / 2:.5f}" stroke="{GUIDE}" stroke-width="0.015" stroke-dasharray="0.08 0.06"/>',
        ]
    content = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_x:.4f} {view_y:.4f} {view_w:.4f} {view_h:.4f}">',
        f"<title>{title}</title>",
        f'<rect x="{view_x:.4f}" y="{view_y:.4f}" width="{view_w:.4f}" height="{view_h:.4f}" fill="{BACKGROUND}"/>',
        *guide_lines,
        f'<polyline points="{stitch_points}" fill="none" stroke="{BLUE}" stroke-width="0.03" stroke-linecap="round" stroke-linejoin="round"/>',
        "</svg>",
    ]
    path.write_text("\n".join(content) + "\n", encoding="utf-8")


def write_png(path: Path, points: list[Point], height: float, repeats: int = 1, vertical: bool = False, size_px: int = 1400) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    show_points = transform(build_chain(points, repeats), rotate_vertical=vertical)
    min_x, min_y, max_x, max_y = bounds(show_points)
    margin = 0.28
    scale = min(size_px / ((max_x - min_x) + margin * 2), size_px / ((max_y - min_y) + margin * 2))
    content_w = ((max_x - min_x) + margin * 2) * scale
    content_h = ((max_y - min_y) + margin * 2) * scale
    img_w = max(80, int(content_w))
    img_h = max(80, int(content_h))
    pad_x = max(0.0, (img_w - content_w) / 2)
    pad_y = max(0.0, (img_h - content_h) / 2)
    image = Image.new("RGB", (img_w, img_h), (247, 247, 244))
    draw = ImageDraw.Draw(image)

    def map_point(point: Point) -> tuple[float, float]:
        return (
            pad_x + (point[0] - min_x + margin) * scale,
            pad_y + (max_y - point[1] + margin) * scale,
        )

    if not vertical:
        guide_top = [map_point((min_x, height / 2)), map_point((max_x, height / 2))]
        guide_bottom = [map_point((min_x, -height / 2)), map_point((max_x, -height / 2))]
        draw.line(guide_top, fill=(212, 208, 200), width=max(1, int(scale * 0.015)))
        draw.line(guide_bottom, fill=(212, 208, 200), width=max(1, int(scale * 0.015)))
    draw.line([map_point(point) for point in show_points], fill=(7, 95, 134), width=max(2, int(scale * 0.03)), joint="curve")
    image.save(path)
    return True


def metrics(points: list[Point], width: float, height: float, component: str) -> dict:
    segs = segment_lengths(points)
    turns = turn_angles(points)
    min_x, min_y, max_x, max_y = bounds(points)
    return {
        "component": component,
        "shape_count": 1,
        "point_count": len(points),
        "repeat_width": width,
        "strip_height": height,
        "start": [round(points[0][0], 5), round(points[0][1], 5)],
        "end": [round(points[-1][0], 5), round(points[-1][1], 5)],
        "start_end_x_delta": round(abs(points[-1][0] - points[0][0]), 6),
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
            "Start and end are on the center baseline for sashing repeat chaining.",
            "Motifs are intentionally quieter than border and block components.",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Native Sakura Leaf Sashing Rail")
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=float, default=8.0)
    parser.add_argument("--height", type=float, default=1.5)
    parser.add_argument("--stitch-spacing", type=float, default=0.025)
    parser.add_argument("--repeats", type=int, default=5)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = "native-sakura-leaf-sashing-rail"
    points = build_native_sashing(args.width, args.height, args.stitch_spacing)
    chain = build_chain(points, args.repeats)
    vertical = transform(points, rotate_vertical=True)

    write_dxf(out_dir / f"{base}.dxf", points, "native-sashing-rail")
    write_dxf(out_dir / f"{base}-chained.dxf", chain, "native-sashing-chain")
    write_dxf(out_dir / f"{base}-vertical.dxf", vertical, "native-sashing-vertical")
    write_svg(out_dir / f"{base}.svg", points, args.name, args.height)
    write_svg(out_dir / f"{base}-chained.svg", points, f"{args.name} chained", args.height, repeats=args.repeats)
    write_svg(out_dir / f"{base}-vertical.svg", points, f"{args.name} vertical", args.height, vertical=True)
    write_png(out_dir / f"{base}.png", points, args.height)
    write_png(out_dir / f"{base}-chained.png", points, args.height, repeats=args.repeats)
    write_png(out_dir / f"{base}-vertical.png", points, args.height, vertical=True)

    result = {
        "sashing": metrics(points, args.width, args.height, "sashing-rail"),
        "chained": metrics(chain, args.width * args.repeats, args.height, "sashing-rail-chained"),
        "vertical": metrics(vertical, args.width, args.height, "sashing-rail-vertical"),
    }
    (out_dir / "native-sashing-metrics.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(out_dir / f"{base}-dxf.zip", "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(out_dir / f"{base}.dxf", arcname=f"{base}.dxf")
        zf.write(out_dir / f"{base}-chained.dxf", arcname=f"{base}-chained.dxf")
        zf.write(out_dir / f"{base}-vertical.dxf", arcname=f"{base}-vertical.dxf")
    print(json.dumps({"out": str(out_dir), "metrics": result}, indent=2))
    return 0 if result["sashing"]["start_end_y_delta"] <= 0.001 else 1


if __name__ == "__main__":
    raise SystemExit(main())
