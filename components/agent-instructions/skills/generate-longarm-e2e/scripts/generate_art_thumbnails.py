#!/usr/bin/env python3
"""Generate thumbnail art directions from curated longarm motifs and templates."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
LIB_DIR = SKILL_DIR / "assets" / "artistic-library"


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "coordinate-art"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def motif_by_id(motifs: list[dict]) -> dict[str, dict]:
    return {motif["id"]: motif for motif in motifs}


def pick_motifs(all_motifs: list[dict], requested: list[str]) -> list[dict]:
    by_id = motif_by_id(all_motifs)
    if requested:
        picked = []
        for item in requested:
            key = slugify(item)
            if key in by_id:
                picked.append(by_id[key])
            else:
                match = next((m for m in all_motifs if slugify(m["display_name"]) == key), None)
                if match:
                    picked.append(match)
        if picked:
            return picked
    defaults = [
        "layered-border-frame",
        "framed-diamond",
        "pearl-chain",
        "sakura-rosette",
        "echoed-heart",
        "flourish-scroll",
        "leaf-sprig",
        "feather-plume",
        "clamshell-arc",
        "quiet-rail",
    ]
    return [by_id[key] for key in defaults if key in by_id]


def choose_templates(templates: list[dict], geographies: list[str]) -> list[dict]:
    wanted = {slugify(g) for g in geographies}
    if not wanted:
        wanted = {"focal", "border", "corner", "block", "triangle", "sashing"}
    scored = []
    for template in templates:
        overlap = len(wanted & {slugify(g) for g in template["geographies"]})
        if template["id"] == "whole-quilt-coordinate-layout":
            overlap += 2
        if overlap:
            scored.append((overlap, template))
    scored.sort(key=lambda item: (-item[0], item[1]["id"]))
    return [template for _, template in scored[:6]]


def motif_ids(motifs: list[dict]) -> list[str]:
    return [motif["id"] for motif in motifs]


def motif_for_role(motifs: list[dict], role: str, fallback: str) -> str:
    for motif in motifs:
        if role in motif.get("roles", []) or role in motif.get("geographies", []):
            return motif["id"]
    return fallback


def build_candidate(
    index: int,
    name: str,
    theme: str,
    motifs: list[dict],
    templates: list[dict],
    density: str,
) -> dict:
    modes = [
        {
            "name": "Dense Heirloom",
            "density": 1.18,
            "negative_space": "controlled ornate breathing room",
            "connector_grammar": "pearl bands, scroll stems, and echo halos",
        },
        {
            "name": "Balanced Custom",
            "density": 1.00,
            "negative_space": "moderate framed open zones",
            "connector_grammar": "leaf vine, pearl frames, and quiet rails",
        },
        {
            "name": "Airy Quilt-Supporting",
            "density": 0.86,
            "negative_space": "larger support spaces with restrained accents",
            "connector_grammar": "quiet rails, leaf sprigs, and sparse pearls",
        },
        {
            "name": "Formal Medallion",
            "density": 1.08,
            "negative_space": "symmetrical medallion fields",
            "connector_grammar": "diamond frames, pearl chains, and mirrored scrolls",
        },
        {
            "name": "Botanical Border-Led",
            "density": 0.98,
            "negative_space": "border rhythm balanced by quieter center",
            "connector_grammar": "scroll borders, leaf spines, and corner rosettes",
        },
        {
            "name": "Triangle-Aware Custom",
            "density": 1.02,
            "negative_space": "diagonal triangle space balanced against blocks",
            "connector_grammar": "feather diagonals, clamshell edge fill, and pearls",
        },
    ]
    mode = modes[index % len(modes)]
    by_id = motif_by_id(motifs)
    selected_ids = motif_ids(motifs)
    focal_motifs = selected_ids[:]
    sections = [
        {
            "name": "focal medallion",
            "kind": "focal",
            "template": "heirloom-pearl-diamond-medallion",
            "motifs": focal_motifs,
            "anchors": ["outer frame", "inner mat", "pearl diamond", "center", "corner support"],
            "density": round(mode["density"] + 0.06, 2),
        },
        {
            "name": "outer border",
            "kind": "border",
            "template": "layered-scroll-border-with-corners",
            "motifs": [
                "layered-border-frame",
                "pearl-chain",
                motif_for_role(motifs, "border", "flourish-scroll"),
                motif_for_role(motifs, "connector", "leaf-sprig"),
            ],
            "anchors": ["outer rail", "inner rail", "primary spine", "pearl lane", "corner turn"],
            "density": round(mode["density"], 2),
        },
        {
            "name": "corner turns",
            "kind": "corner",
            "template": "rosette-corner-turn",
            "motifs": ["sakura-rosette", "flourish-scroll", "pearl-chain", "leaf-sprig"],
            "anchors": ["entry axis", "turn rosette", "pearl transition", "exit axis"],
            "density": round(mode["density"] + 0.02, 2),
        },
        {
            "name": "alternate blocks",
            "kind": "block",
            "template": "alternate-floral-block",
            "motifs": ["sakura-rosette", "pearl-chain", "leaf-sprig", "echoed-heart"],
            "anchors": ["soft frame", "small center", "echo halo", "corner accents"],
            "density": round(mode["density"] - 0.03, 2),
        },
        {
            "name": "setting triangles",
            "kind": "triangle",
            "template": "feathered-setting-triangle",
            "motifs": ["feather-plume", "leaf-sprig", "clamshell-arc", "pearl-chain"],
            "anchors": ["broad edge", "diagonal spine", "tapering plumes", "point echo"],
            "density": round(mode["density"] - 0.05, 2),
        },
        {
            "name": "sashing",
            "kind": "sashing",
            "template": "quiet-sashing-chain",
            "motifs": ["quiet-rail", "leaf-sprig", "echoed-heart", "pearl-chain"],
            "anchors": ["sashing rail", "small alternating motif", "tiny accent"],
            "density": round(mode["density"] - 0.09, 2),
        },
    ]
    if index == 2:
        sections[0]["motifs"] = ["framed-diamond", "pearl-chain", "sakura-rosette", "leaf-sprig", "echoed-heart"]
        sections[1]["motifs"] = ["layered-border-frame", "flourish-scroll", "leaf-sprig"]
        sections[5]["motifs"] = ["quiet-rail", "leaf-sprig"]
    if index == 3:
        sections[0]["template"] = "heirloom-pearl-diamond-medallion"
        sections[0]["motifs"] = ["framed-diamond", "pearl-chain", "sakura-rosette", "flourish-scroll", "echoed-heart"]
    if index == 4:
        sections[1]["motifs"] = ["layered-border-frame", "flourish-scroll", "leaf-sprig", "sakura-rosette"]
    if index == 5:
        sections[4]["motifs"] = ["feather-plume", "clamshell-arc", "leaf-sprig", "sakura-rosette"]

    template_ids = [template["id"] for template in templates]
    return {
        "id": f"thumbnail-{index + 1:02d}",
        "name": f"{name} - {mode['name']}",
        "theme": theme,
        "mode": mode["name"],
        "template_family": template_ids,
        "primary_template": "whole-quilt-coordinate-layout",
        "density_band": density,
        "negative_space": mode["negative_space"],
        "connector_grammar": mode["connector_grammar"],
        "curated_asset_ids": sorted(set(m for section in sections for m in section["motifs"] if m in by_id)),
        "sections": sections,
        "hard_rejections": [
            "floating motifs",
            "naked travel connectors",
            "cropped block used as triangle",
            "support sections using full focal motif library",
        ],
    }


def svg_symbol(motif_id: str, x: float, y: float, s: float) -> str:
    stroke = "#075f86"
    if motif_id == "sakura-rosette":
        petals = []
        for i in range(8):
            a = math.pi * 2 * i / 8
            px = x + math.cos(a) * s * 0.42
            py = y + math.sin(a) * s * 0.42
            petals.append(f'<ellipse cx="{px:.3f}" cy="{py:.3f}" rx="{s*0.16:.3f}" ry="{s*0.34:.3f}" transform="rotate({math.degrees(a):.1f} {px:.3f} {py:.3f})"/>')
        return f'<g fill="none" stroke="{stroke}" stroke-width="0.035">{"".join(petals)}<circle cx="{x:.3f}" cy="{y:.3f}" r="{s*0.12:.3f}"/></g>'
    if motif_id == "echoed-heart":
        return f'<path d="M {x:.3f} {y+s*0.2:.3f} C {x-s*0.65:.3f} {y-s*0.35:.3f}, {x-s*0.15:.3f} {y-s*0.78:.3f}, {x:.3f} {y-s*0.32:.3f} C {x+s*0.15:.3f} {y-s*0.78:.3f}, {x+s*0.65:.3f} {y-s*0.35:.3f}, {x:.3f} {y+s*0.2:.3f} Z" fill="none" stroke="{stroke}" stroke-width="0.04"/>'
    if motif_id == "flourish-scroll":
        return f'<path d="M {x-s*0.7:.3f} {y:.3f} C {x-s*0.1:.3f} {y-s*0.8:.3f}, {x+s*0.8:.3f} {y-s*0.2:.3f}, {x+s*0.25:.3f} {y+s*0.25:.3f} C {x-s*0.15:.3f} {y+s*0.55:.3f}, {x-s*0.2:.3f} {y:.3f}, {x+s*0.25:.3f} {y:.3f}" fill="none" stroke="{stroke}" stroke-width="0.04"/>'
    if motif_id == "leaf-sprig":
        return f'<path d="M {x-s*0.6:.3f} {y:.3f} C {x-s*0.1:.3f} {y-s*0.38:.3f}, {x+s*0.25:.3f} {y-s*0.30:.3f}, {x+s*0.6:.3f} {y:.3f} C {x+s*0.1:.3f} {y+s*0.38:.3f}, {x-s*0.25:.3f} {y+s*0.30:.3f}, {x-s*0.6:.3f} {y:.3f} Z" fill="none" stroke="{stroke}" stroke-width="0.04"/>'
    if motif_id == "pearl-chain":
        circles = []
        for i in range(5):
            circles.append(f'<circle cx="{x + (i-2)*s*0.28:.3f}" cy="{y:.3f}" r="{s*0.085:.3f}"/>')
        return f'<g fill="none" stroke="{stroke}" stroke-width="0.035">{"".join(circles)}</g>'
    if motif_id == "feather-plume":
        return f'<path d="M {x-s*0.75:.3f} {y+s*0.55:.3f} C {x-s*0.1:.3f} {y:.3f}, {x+s*0.2:.3f} {y-s*0.4:.3f}, {x+s*0.75:.3f} {y-s*0.65:.3f} M {x-s*0.1:.3f} {y:.3f} C {x-s*0.65:.3f} {y-s*0.15:.3f}, {x-s*0.4:.3f} {y-s*0.55:.3f}, {x:.3f} {y-s*0.38:.3f} M {x+s*0.15:.3f} {y-s*0.18:.3f} C {x+s*0.6:.3f} {y+s*0.05:.3f}, {x+s*0.4:.3f} {y+s*0.45:.3f}, {x+s*0.05:.3f} {y+s*0.28:.3f}" fill="none" stroke="{stroke}" stroke-width="0.04"/>'
    if motif_id == "clamshell-arc":
        return f'<path d="M {x-s*0.7:.3f} {y+s*0.25:.3f} C {x-s*0.35:.3f} {y-s*0.45:.3f}, {x+s*0.35:.3f} {y-s*0.45:.3f}, {x+s*0.7:.3f} {y+s*0.25:.3f}" fill="none" stroke="{stroke}" stroke-width="0.04"/>'
    return f'<circle cx="{x:.3f}" cy="{y:.3f}" r="{s*0.22:.3f}" fill="none" stroke="{stroke}" stroke-width="0.035"/>'


def render_svg(path: Path, candidate: dict) -> None:
    stroke = "#075f86"
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">',
        '<rect x="0" y="0" width="28" height="28" fill="#f7f7f4"/>',
        f'<title>{candidate["name"]}</title>',
        f'<rect x="1" y="1" width="26" height="26" fill="none" stroke="{stroke}" stroke-width="0.05"/>',
        f'<rect x="2" y="2" width="24" height="24" fill="none" stroke="{stroke}" stroke-width="0.04"/>',
        f'<rect x="7" y="7" width="14" height="14" fill="none" stroke="{stroke}" stroke-width="0.04"/>',
        f'<polygon points="14,8.2 19.8,14 14,19.8 8.2,14" fill="none" stroke="{stroke}" stroke-width="0.06"/>',
    ]
    for x in [4, 7, 10, 13, 16, 19, 22, 25]:
        parts.append(svg_symbol("pearl-chain", x, 2.4, 0.8))
        parts.append(svg_symbol("pearl-chain", x, 25.6, 0.8))
    for x in [4.5, 8.5, 12.5, 16.5, 20.5, 24.5]:
        parts.append(svg_symbol("flourish-scroll", x, 4.0, 0.9))
        parts.append(svg_symbol("echoed-heart", x + 0.9, 4.15, 0.75))
        parts.append(svg_symbol("leaf-sprig", x + 1.7, 4.2, 0.65))
        parts.append(svg_symbol("sakura-rosette", x, 24.0, 0.65))
        parts.append(svg_symbol("flourish-scroll", x + 1.2, 24.1, 0.8))
    for y in [7, 10, 13, 16, 19, 22]:
        parts.append(svg_symbol("leaf-sprig", 3.7, y, 0.72))
        parts.append(svg_symbol("echoed-heart", 4.4, y + 0.8, 0.58))
        parts.append(svg_symbol("flourish-scroll", 24.2, y, 0.72))
        parts.append(svg_symbol("sakura-rosette", 24.0, y + 0.9, 0.55))
    parts.append(svg_symbol("sakura-rosette", 14, 14, 1.8))
    for x, y, motif in [(14, 9.7, "echoed-heart"), (18.2, 14, "flourish-scroll"), (14, 18.2, "leaf-sprig"), (9.8, 14, "echoed-heart")]:
        parts.append(svg_symbol(motif, x, y, 1.0))
    for x, y in [(5.5, 5.5), (22.5, 5.5), (5.5, 22.5), (22.5, 22.5)]:
        parts.append(svg_symbol("sakura-rosette", x, y, 0.95))
        parts.append(svg_symbol("pearl-chain", x, y + 0.8, 0.65))
    for x, y in [(4.5, 14), (23.5, 14)]:
        parts.append(f'<polygon points="{x-1.4},{y-3.2} {x+1.6},{y} {x-1.4},{y+3.2}" fill="none" stroke="{stroke}" stroke-width="0.04"/>')
        parts.append(svg_symbol("feather-plume", x, y, 1.0))
        parts.append(svg_symbol("clamshell-arc", x, y + 1.5, 0.8))
    parts.append("</svg>")
    path.write_text("\n".join(parts) + "\n", encoding="utf-8")


def write_markdown(path: Path, candidates: list[dict]) -> None:
    lines = ["# Art Direction Thumbnails", ""]
    for candidate in candidates:
        lines.extend(
            [
                f"## {candidate['id']}: {candidate['mode']}",
                "",
                f"- Primary template: {candidate['primary_template']}",
                f"- Connector grammar: {candidate['connector_grammar']}",
                f"- Negative space: {candidate['negative_space']}",
                "- Sections:",
            ]
        )
        for section in candidate["sections"]:
            lines.append(
                f"  - {section['name']}: {section['template']}; motifs {', '.join(section['motifs'])}; anchors {', '.join(section['anchors'])}"
            )
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Coordinate Design")
    parser.add_argument("--theme", default="professional coordinated longarm quilting")
    parser.add_argument("--geographies", default="focal,border,corner,block,triangle,sashing")
    parser.add_argument("--motifs", help="Optional comma-separated motif ids from assets/artistic-library/motifs.json.")
    parser.add_argument("--density", choices=["open", "medium", "dense"], default="dense")
    parser.add_argument("--count", type=int, default=3)
    parser.add_argument("--out", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    motif_library = load_json(LIB_DIR / "motifs.json")["motifs"]
    template_library = load_json(LIB_DIR / "templates.json")["templates"]
    motifs = pick_motifs(motif_library, parse_csv(args.motifs))
    templates = choose_templates(template_library, parse_csv(args.geographies))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    count = max(1, min(args.count, 6))
    candidates = [
        build_candidate(i, args.name, args.theme, motifs, templates, args.density)
        for i in range(count)
    ]
    for candidate in candidates:
        render_svg(out_dir / f"{candidate['id']}.svg", candidate)
    (out_dir / "thumbnail-options.json").write_text(json.dumps({"candidates": candidates}, indent=2) + "\n", encoding="utf-8")
    write_markdown(out_dir / "thumbnail-options.md", candidates)
    print(json.dumps({"count": len(candidates), "out": str(out_dir)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
