#!/usr/bin/env python3
"""Compile separated quilting DXF polylines into one continuous stitch candidate."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from longarm_geometry import Point, Polyline, bounds, distance, parse_dxf_polylines, path_length, segment_lengths, turn_angles
from route_continuous_paths import nearest_route


DEFAULT_GRAMMAR = Path(__file__).resolve().parents[1] / "assets" / "artistic-library" / "anchor-grammar.json"


def load_grammar(path: Path | None) -> dict:
    grammar_path = path or DEFAULT_GRAMMAR
    if grammar_path.exists():
        return json.loads(grammar_path.read_text(encoding="utf-8"))
    return {"layer_connector_rules": []}


def parse_csv(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def within_window(shape: Polyline, x_min: float | None, x_max: float | None, y_min: float | None, y_max: float | None) -> bool:
    cx, cy = shape_center(shape)
    if x_min is not None and cx < x_min:
        return False
    if x_max is not None and cx > x_max:
        return False
    if y_min is not None and cy < y_min:
        return False
    if y_max is not None and cy > y_max:
        return False
    return True


def filter_shapes(
    shapes: list[Polyline],
    layers: set[str],
    exclude_layers: set[str],
    x_min: float | None,
    x_max: float | None,
    y_min: float | None,
    y_max: float | None,
) -> list[Polyline]:
    result = []
    for shape in shapes:
        if layers and shape.layer not in layers:
            continue
        if shape.layer in exclude_layers:
            continue
        if not within_window(shape, x_min, x_max, y_min, y_max):
            continue
        result.append(shape)
    return result


def shape_center(shape: Polyline) -> Point:
    xs = [x for x, _ in shape.points]
    ys = [y for _, y in shape.points]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def directional_route(shapes: list[Polyline], axis: str) -> dict:
    if not shapes:
        return {"route": []}
    if axis == "input":
        ordered = list(enumerate(shapes))
    else:
        axis_index = 0 if axis == "x-scan" else 1
        other_index = 1 - axis_index
        ordered = sorted(
            list(enumerate(shapes)),
            key=lambda item: (shape_center(item[1])[axis_index], shape_center(item[1])[other_index]),
        )

    route = []
    current: Point | None = None
    travel_segments = []
    draw_length = 0.0
    for shape_index, shape in ordered:
        start = shape.points[0]
        end = shape.points[-1]
        if current is None:
            reversed_shape = end[0] < start[0] if axis == "x-scan" else end[1] < start[1] if axis == "y-scan" else False
            current = shape.points[0] if reversed_shape else shape.points[-1]
        else:
            reversed_shape = distance(current, end) < distance(current, start)
            target = end if reversed_shape else start
            travel_segments.append(
                {
                    "from": [round(current[0], 5), round(current[1], 5)],
                    "to": [round(target[0], 5), round(target[1], 5)],
                    "length": round(distance(current, target), 5),
                }
            )
            current = start if reversed_shape else end
        draw_length += path_length(shape.points)
        route.append({"shape_index": shape_index, "reversed": reversed_shape})
    return {
        "shape_count": len(shapes),
        "draw_length": round(draw_length, 5),
        "travel_length": round(sum(item["length"] for item in travel_segments), 5),
        "max_travel": round(max([item["length"] for item in travel_segments] or [0]), 5),
        "route": route,
        "travel_segments": travel_segments,
    }


def unit_vector(a: Point, b: Point) -> tuple[float, float]:
    length = max(distance(a, b), 1e-9)
    return ((b[0] - a[0]) / length, (b[1] - a[1]) / length)


def cubic(a: Point, c1: Point, c2: Point, b: Point, steps: int) -> list[Point]:
    points: list[Point] = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = mt**3 * a[0] + 3 * mt**2 * t * c1[0] + 3 * mt * t**2 * c2[0] + t**3 * b[0]
        y = mt**3 * a[1] + 3 * mt**2 * t * c1[1] + 3 * mt * t**2 * c2[1] + t**3 * b[1]
        points.append((x, y))
    return points


def soft_s_curve(a: Point, b: Point, sign: int = 1) -> list[Point]:
    span = distance(a, b)
    if span < 1e-7:
        return [b]
    ux, uy = unit_vector(a, b)
    nx, ny = -uy, ux
    offset = min(0.18, max(0.015, span * 0.14)) * sign
    c1 = (a[0] + ux * span * 0.33 + nx * offset, a[1] + uy * span * 0.33 + ny * offset)
    c2 = (a[0] + ux * span * 0.66 - nx * offset, a[1] + uy * span * 0.66 - ny * offset)
    steps = max(4, min(32, math.ceil(span / 0.055)))
    return cubic(a, c1, c2, b, steps)


def pearl_chain(a: Point, b: Point, sign: int = 1) -> list[Point]:
    span = distance(a, b)
    if span < 0.22:
        return soft_s_curve(a, b, sign)
    ux, uy = unit_vector(a, b)
    nx, ny = -uy, ux
    count = max(2, min(18, int(span / 0.18)))
    radius = min(0.055, max(0.025, span / (count * 5.0)))
    points: list[Point] = []
    for i in range(1, count + 1):
        t = i / (count + 1)
        cx = a[0] + (b[0] - a[0]) * t
        cy = a[1] + (b[1] - a[1]) * t
        tangent = (cx + nx * radius * sign, cy + ny * radius * sign)
        points.append(tangent)
        loop_steps = 10
        for j in range(1, loop_steps + 1):
            theta = 2 * math.pi * j / loop_steps
            px = cx + nx * radius * math.cos(theta) * sign + ux * radius * math.sin(theta)
            py = cy + ny * radius * math.cos(theta) * sign + uy * radius * math.sin(theta)
            points.append((px, py))
    points.extend(soft_s_curve(points[-1] if points else a, b, sign))
    return points


def smooth_vine(a: Point, b: Point, sign: int = 1, with_leaves: bool = True) -> list[Point]:
    span = distance(a, b)
    if span < 0.28:
        return soft_s_curve(a, b, sign)
    ux, uy = unit_vector(a, b)
    nx, ny = -uy, ux
    base = soft_s_curve(a, b, sign)
    if not with_leaves:
        return base
    points: list[Point] = []
    leaf_gap = max(0.34, min(0.62, span / 5.0))
    leaf_count = max(1, min(7, int(span / leaf_gap)))
    insertion = {round((i + 1) * len(base) / (leaf_count + 1)): i for i in range(leaf_count)}
    for index, point in enumerate(base):
        points.append(point)
        if index in insertion:
            local_sign = sign if insertion[index] % 2 == 0 else -sign
            amp = min(0.11, max(0.045, span * 0.035))
            shoulder = (point[0] + nx * amp * 0.55 * local_sign, point[1] + ny * amp * 0.55 * local_sign)
            tip = (
                point[0] + ux * amp * 0.45 + nx * amp * 1.35 * local_sign,
                point[1] + uy * amp * 0.45 + ny * amp * 1.35 * local_sign,
            )
            return_side = (
                point[0] - ux * amp * 0.35 + nx * amp * 0.6 * local_sign,
                point[1] - uy * amp * 0.35 + ny * amp * 0.6 * local_sign,
            )
            points.extend([shoulder, tip, return_side, point])
    return points


def connector_style(layer_a: str, layer_b: str, grammar: dict, fallback: str) -> tuple[str, str | None, float]:
    layer_text = f"{layer_a} {layer_b}".lower()
    for rule in grammar.get("layer_connector_rules", []):
        terms = [term.lower() for term in rule.get("layer_contains", [])]
        if any(term in layer_text for term in terms):
            return rule.get("connector", fallback), rule.get("anchor"), float(rule.get("max_plain_travel", 0.18))
    return fallback, None, 0.18


def make_connector(a: Point, b: Point, style: str, sign: int) -> list[Point]:
    if style == "pearl-chain":
        return pearl_chain(a, b, sign)
    if style in {"smooth-vine", "corner-vine"}:
        return smooth_vine(a, b, sign, with_leaves=True)
    if style in {"echo-travel", "quiet-rail"}:
        return smooth_vine(a, b, sign, with_leaves=False)
    return soft_s_curve(a, b, sign)


def append_points(path: list[Point], points: list[Point]) -> None:
    if not points:
        return
    if path and distance(path[-1], points[0]) < 1e-7:
        path.extend(points[1:])
    else:
        path.extend(points)


def route_shapes(shapes: list[Polyline], route_method: str) -> dict:
    if route_method == "nearest":
        return nearest_route(list(enumerate(shapes)))
    return directional_route(shapes, route_method)


def compile_path(
    shapes: list[Polyline],
    grammar: dict,
    fallback_connector: str,
    max_warning: float,
    route_method: str,
    force_connector: bool,
) -> tuple[list[Point], dict]:
    if not shapes:
        return [], {"passes": False, "failures": ["No polylines selected."], "warnings": []}
    route = route_shapes(shapes, route_method)
    by_index = {index: shape for index, shape in enumerate(shapes)}
    compiled: list[Point] = []
    connectors: list[dict] = []
    warnings: list[str] = []
    failures: list[str] = []

    previous_shape: Polyline | None = None
    for order, item in enumerate(route["route"]):
        shape = by_index[item["shape_index"]]
        motif_points = list(reversed(shape.points)) if item["reversed"] else shape.points
        if order == 0:
            append_points(compiled, motif_points)
            previous_shape = shape
            continue
        assert previous_shape is not None
        start = motif_points[0]
        current = compiled[-1]
        gap = distance(current, start)
        if force_connector:
            style, anchor, plain_limit = fallback_connector, "forced-connector", max_warning
        else:
            style, anchor, plain_limit = connector_style(previous_shape.layer, shape.layer, grammar, fallback_connector)
        connector_points = make_connector(current, start, style, 1 if order % 2 == 0 else -1)
        append_points(compiled, connector_points)
        append_points(compiled, motif_points)
        if gap > max_warning:
            warnings.append(f"Connector {order} spans {gap:.3f} inches; review whether this should be redrawn as a designed spine or frame.")
        if gap > plain_limit * 4:
            warnings.append(f"Connector {order} is far beyond the plain-travel comfort limit for {anchor or 'default anchor'} grammar.")
        connectors.append(
            {
                "order": order,
                "from_layer": previous_shape.layer,
                "to_layer": shape.layer,
                "style": style,
                "anchor": anchor,
                "direct_gap": round(gap, 5),
                "point_count": len(connector_points),
                "review_required": gap > max_warning,
            }
        )
        previous_shape = shape

    segments = segment_lengths(compiled)
    turns = turn_angles(compiled)
    micro_segments = [value for value in segments if value < 0.003]
    hard_turns = [value for value in turns if value > 172]
    if micro_segments:
        failures.append("Compiled path introduced micro-segments below 0.003 inches.")
    if hard_turns:
        warnings.append("Compiled path contains near-reversal turns; inspect connector transitions.")

    min_x, min_y, max_x, max_y = bounds([Polyline("compiled-stitch", compiled)])
    manifest = {
        "passes": not failures,
        "failures": failures,
        "warnings": warnings,
        "shape_count_in": len(shapes),
        "shape_count_out": 1 if compiled else 0,
        "connector_count": len(connectors),
        "review_connector_count": sum(1 for item in connectors if item["review_required"]),
        "input_draw_length": round(sum(path_length(shape.points) for shape in shapes), 5),
        "compiled_draw_length": round(path_length(compiled), 5),
        "bounds": [round(min_x, 5), round(min_y, 5), round(max_x, 5), round(max_y, 5)],
        "segment_count": len(segments),
        "min_segment": round(min(segments), 5) if segments else 0,
        "max_segment": round(max(segments), 5) if segments else 0,
        "hard_turn_count": len(hard_turns),
        "route": route["route"],
        "route_method": route_method,
        "connectors": connectors,
        "notes": [
            "This compiler creates an explicit one-polyline stitch candidate.",
            "Long connectors are candidates for redesign as border spines, vines, pearl bands, frames, or echo travel.",
            "Use component-level compilation for production review; full art-board compilation is diagnostic unless the whole quilt stitches as one file.",
        ],
    }
    return compiled, manifest


def write_dxf(path: Path, points: list[Point], layer: str = "compiled-stitch") -> None:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
        "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
        "0", "POLYLINE", "8", layer[:31] or "compiled-stitch", "66", "1", "70", "0",
    ]
    for x, y in points:
        lines.extend(["0", "VERTEX", "8", layer[:31] or "compiled-stitch", "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0.00000"])
    lines.extend(["0", "SEQEND", "0", "ENDSEC", "0", "EOF"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_png(path: Path, points: list[Point], size: int = 1400) -> bool:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    if len(points) < 2:
        return False
    min_x = min(x for x, _ in points)
    max_x = max(x for x, _ in points)
    min_y = min(y for _, y in points)
    max_y = max(y for _, y in points)
    margin = 0.5
    scale = min(size / max(1e-6, (max_x - min_x) + margin * 2), size / max(1e-6, (max_y - min_y) + margin * 2))
    width = max(50, int(((max_x - min_x) + margin * 2) * scale))
    height = max(50, int(((max_y - min_y) + margin * 2) * scale))
    image = Image.new("RGB", (width, height), (247, 247, 244))
    draw = ImageDraw.Draw(image)

    def map_point(point: Point) -> tuple[float, float]:
        return ((point[0] - min_x + margin) * scale, (max_y - point[1] + margin) * scale)

    draw.line([map_point(point) for point in points], fill=(7, 95, 134), width=max(2, int(scale * 0.035)), joint="curve")
    image.save(path)
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dxf", help="Input DXF containing motif/component polylines.")
    parser.add_argument("--out", required=True, help="Output compiled one-path DXF.")
    parser.add_argument("--manifest", help="Optional JSON manifest path.")
    parser.add_argument("--preview-png", help="Optional PNG preview path.")
    parser.add_argument("--layers", help="Comma-separated layer names to include.")
    parser.add_argument("--exclude-layers", help="Comma-separated layer names to exclude.")
    parser.add_argument("--x-min", type=float, help="Only include shapes whose center is at or right of this x value.")
    parser.add_argument("--x-max", type=float, help="Only include shapes whose center is at or left of this x value.")
    parser.add_argument("--y-min", type=float, help="Only include shapes whose center is at or above this y value.")
    parser.add_argument("--y-max", type=float, help="Only include shapes whose center is at or below this y value.")
    parser.add_argument("--grammar", help="Optional anchor grammar JSON. Defaults to skill asset grammar.")
    parser.add_argument("--connector", default="soft-s-curve", choices=["soft-s-curve", "smooth-vine", "pearl-chain", "echo-travel", "quiet-rail"])
    parser.add_argument("--force-connector", action="store_true", help="Use --connector for every travel connection instead of grammar-selected styles.")
    parser.add_argument("--route", default="nearest", choices=["nearest", "x-scan", "y-scan", "input"], help="Route ordering strategy.")
    parser.add_argument("--max-review-gap", type=float, default=0.45, help="Connector gap above this distance requires human/art review.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    shapes = parse_dxf_polylines(Path(args.dxf))
    shapes = filter_shapes(shapes, parse_csv(args.layers), parse_csv(args.exclude_layers), args.x_min, args.x_max, args.y_min, args.y_max)
    grammar = load_grammar(Path(args.grammar) if args.grammar else None)
    compiled, manifest = compile_path(shapes, grammar, args.connector, args.max_review_gap, args.route, args.force_connector)
    if compiled:
        write_dxf(Path(args.out), compiled)
    if args.manifest:
        Path(args.manifest).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if args.preview_png and compiled:
        write_png(Path(args.preview_png), compiled)
    summary = {
        "passes": manifest["passes"],
        "failures": manifest["failures"],
        "warning_count": len(manifest["warnings"]),
        "shape_count_in": manifest["shape_count_in"],
        "shape_count_out": manifest["shape_count_out"],
        "connector_count": manifest["connector_count"],
        "review_connector_count": manifest["review_connector_count"],
        "compiled_draw_length": manifest["compiled_draw_length"],
        "route_method": manifest.get("route_method"),
        "min_segment": manifest["min_segment"],
        "max_segment": manifest["max_segment"],
        "out": str(Path(args.out)),
    }
    print(json.dumps(summary, indent=2))
    return 0 if manifest["passes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
