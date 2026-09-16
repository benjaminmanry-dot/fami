#!/usr/bin/env python3
"""Create an art-board plan before digitizing a coordinate longarm set."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path


DENSITY_BANDS = {
    "open": {
        "stitch_spacing": "0.050-0.070 in",
        "line_spacing_goal": "broad open fills with restrained echoes",
        "fill_score": 0.75,
    },
    "medium": {
        "stitch_spacing": "0.035-0.050 in",
        "line_spacing_goal": "moderate echoes, pearls, curls, leaves, or feathers",
        "fill_score": 1.00,
    },
    "dense": {
        "stitch_spacing": "0.025-0.035 in",
        "line_spacing_goal": "heirloom detail with careful machine testing",
        "fill_score": 1.25,
    },
}

MOTIF_LIBRARY = {
    "layered-border-frame": {
        "label": "layered border frame",
        "roles": ["border", "corner", "focal", "block"],
        "weight": 1.10,
        "source_cue": "outer border, border pearls, inner border",
        "entry_exit": "border-band midline; exit on matching plane for chained border sections",
        "variants": ["scalloped outer edge", "pearl inset", "inner echo", "mitered corner turn"],
    },
    "pearl-chain": {
        "label": "pearl chain",
        "roles": ["border", "sashing", "corner", "focal", "block", "triangle"],
        "weight": 0.85,
        "source_cue": "border pearls, inner pearls, flower pearl combination",
        "entry_exit": "tangent pearl-to-pearl travel along a guide curve",
        "variants": ["uniform pearls", "graduated pearls", "oval pearls", "corner pearl cluster"],
    },
    "focal-flower-rosette": {
        "label": "focal flower or rosette",
        "roles": ["focal", "block", "corner"],
        "weight": 1.20,
        "source_cue": "flower, flower inside circle, sunflower-like project vocabulary",
        "entry_exit": "petal root or center-ring tangent; exit through echo or leaf",
        "variants": ["sunflower-like rosette", "sakura notch petals", "lotus rosette", "daisy ring"],
    },
    "flower-echo": {
        "label": "flower echo",
        "roles": ["focal", "block", "corner", "triangle"],
        "weight": 0.95,
        "source_cue": "flower echo",
        "entry_exit": "echo halo bridges to frame, scroll, or next motif",
        "variants": ["full halo", "partial halo", "rotated echo layer", "scalloped echo"],
    },
    "floral-pearl-combo": {
        "label": "floral pearl combination",
        "roles": ["focal", "block", "corner"],
        "weight": 1.15,
        "source_cue": "flower pearl combination",
        "entry_exit": "pearl ring to petal echo",
        "variants": ["pearl ring center", "seed center", "alternating seed and petal center"],
    },
    "flourish-scroll": {
        "label": "flourish scroll",
        "roles": ["border", "focal", "block", "corner", "triangle"],
        "weight": 1.00,
        "source_cue": "flourish, move/rotate/resize motif process",
        "entry_exit": "scroll stem is the continuous route",
        "variants": ["single curl", "mirrored curl pair", "scroll with leaf", "scroll with small pearl"],
    },
    "echoed-heart": {
        "label": "echoed heart",
        "roles": ["border", "focal", "block", "corner", "sashing"],
        "weight": 0.95,
        "source_cue": "Block of Hearts",
        "entry_exit": "heart bottom or side tangent; exit through echo or scroll base",
        "variants": ["open heart", "double echo heart", "heart in scroll", "small sashing heart"],
    },
    "leaf-chain": {
        "label": "leaf chain or vine",
        "roles": ["border", "sashing", "focal", "block", "triangle"],
        "weight": 0.90,
        "source_cue": "fabric-derived motifs and flowing border support",
        "entry_exit": "continuous vine spine",
        "variants": ["simple leaf chain", "double leaves", "leaf plus pearl", "leaf plus curl"],
    },
    "feather-triangle": {
        "label": "feather triangle",
        "roles": ["triangle", "corner", "border"],
        "weight": 1.05,
        "source_cue": "Fairy Feather Triangle",
        "entry_exit": "diagonal spine from broad side to taper",
        "variants": ["open feather", "feather plus pearl", "feather plus echo", "partial feather"],
    },
    "clamshell-fill": {
        "label": "clamshell fill",
        "roles": ["triangle", "background", "block", "border"],
        "weight": 0.80,
        "source_cue": "Clam Shell Fill",
        "entry_exit": "baseline or arc endpoints",
        "variants": ["regular clamshell", "elongated clamshell", "bowed-edge clamshell"],
    },
    "wavy-piano-keys": {
        "label": "wavy piano keys",
        "roles": ["border", "sashing", "background"],
        "weight": 0.75,
        "source_cue": "Wavy Piano Keys",
        "entry_exit": "boundary-to-boundary channel travel",
        "variants": ["narrow keys", "wide keys", "scalloped keys", "alternating high-low keys"],
    },
    "crosshatch-framed-mat": {
        "label": "crosshatch or framed mat",
        "roles": ["focal", "block", "background"],
        "weight": 0.85,
        "source_cue": "Crosshatch Square and framed picture-mat approach",
        "entry_exit": "frame corner through mat boundary",
        "variants": ["crosshatch square", "diamond mat", "pearl-edged mat", "open mat"],
    },
    "concentric-ditch-lines": {
        "label": "concentric ditch-to-edge lines",
        "roles": ["border", "background"],
        "weight": 0.65,
        "source_cue": "concentric evenly spaced lines for busy border fabric",
        "entry_exit": "contour progression from ditch to edge",
        "variants": ["straight", "curved", "scalloped", "echo around applique"],
    },
}

DEFAULT_MOTIFS = [
    "layered-border-frame",
    "pearl-chain",
    "focal-flower-rosette",
    "flower-echo",
    "floral-pearl-combo",
    "flourish-scroll",
    "echoed-heart",
    "leaf-chain",
    "feather-triangle",
    "clamshell-fill",
]

GEOGRAPHY_TEMPLATES = {
    "focal": {
        "skeleton": "center medallion with framed mat, pearl ring, scroll quarters, and controlled corner motifs",
        "must_have": ["focal-flower-rosette", "flower-echo", "pearl-chain"],
        "optional_roles": ["focal", "block"],
        "digitizing_order": "frame, focal center, echo ring, quarter scrolls, corner motifs, exit through frame",
    },
    "block": {
        "skeleton": "complete block composition with center motif, echo frame, and two to four corner accents",
        "must_have": [],
        "optional_roles": ["block", "focal", "background"],
        "digitizing_order": "enter frame, stitch center, add echoes, resolve corners, exit on frame tangent",
    },
    "border": {
        "skeleton": "directional border band with outer containment, primary scroll/vine rhythm, pearl or echo band, and inner containment",
        "must_have": ["layered-border-frame"],
        "optional_roles": ["border", "sashing"],
        "digitizing_order": "outer containment, primary spine, motif repeats, pearl/echo band, inner containment, planned corner turn",
    },
    "triangle": {
        "skeleton": "diagonal or radial flow from broad edge into triangle point with tapering echoes",
        "must_have": [],
        "optional_roles": ["triangle"],
        "digitizing_order": "broad-edge entry, diagonal spine, tapering motif fragments, point echo, broad-edge exit",
    },
    "sashing": {
        "skeleton": "quiet continuous chain that repeats one shared grammar without competing with blocks",
        "must_have": [],
        "optional_roles": ["sashing", "border"],
        "digitizing_order": "left entry, repeated small motif chain, right exit on same plane",
    },
    "corner": {
        "skeleton": "intentional corner turn that changes direction without cropped motifs",
        "must_have": [],
        "optional_roles": ["corner", "block", "border"],
        "digitizing_order": "enter from one border axis, turn through rosette/scroll/pearl cluster, exit on adjacent axis",
    },
    "background": {
        "skeleton": "supporting fill that balances density around focal areas",
        "must_have": [],
        "optional_roles": ["background", "block", "triangle"],
        "digitizing_order": "frame or boundary entry, repeated fill, crop-aware exit",
    },
}


@dataclass
class Section:
    name: str
    count: int
    kind: str


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "coordinate-artwork"


def parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def normalize_motif(value: str) -> str:
    slug = slugify(value)
    if slug in MOTIF_LIBRARY:
        return slug
    for key, data in MOTIF_LIBRARY.items():
        if slugify(data["label"]) == slug:
            return key
    return slug


def parse_sections(value: str) -> list[Section]:
    sections: list[Section] = []
    for raw in parse_csv(value):
        parts = [part.strip() for part in raw.split(":") if part.strip()]
        name = parts[0]
        count = 1
        kind = infer_kind(name)
        if len(parts) >= 2:
            try:
                count = max(1, int(parts[1]))
            except ValueError:
                kind = infer_kind(parts[1])
        if len(parts) >= 3:
            kind = infer_kind(parts[2])
        sections.append(Section(name=name, count=count, kind=kind))
    return sections


def infer_kind(value: str) -> str:
    slug = slugify(value)
    if "triangle" in slug:
        return "triangle"
    if "sashing" in slug:
        return "sashing"
    if "border" in slug:
        return "border"
    if "corner" in slug:
        return "corner"
    if "background" in slug or "fill" in slug:
        return "background"
    if "focal" in slug or "medallion" in slug or "center" in slug:
        return "focal"
    return "block"


def motif_data(key: str) -> dict:
    if key in MOTIF_LIBRARY:
        return MOTIF_LIBRARY[key]
    return {
        "label": key.replace("-", " "),
        "roles": ["focal", "block", "border", "triangle", "sashing", "corner", "background"],
        "weight": 0.90,
        "source_cue": "custom user motif translated into quilting grammar",
        "entry_exit": "define entry and exit anchors before digitizing",
        "variants": ["focal version", "supporting fragment", "small accent"],
    }


def choose_support_motifs(available: list[str], kind: str, support_index: int) -> list[str]:
    template = GEOGRAPHY_TEMPLATES.get(kind, GEOGRAPHY_TEMPLATES["block"])
    selected: list[str] = []
    for key in template["must_have"]:
        if key in available and key not in selected:
            selected.append(key)

    role_matches = [key for key in available if kind in motif_data(key)["roles"]]
    if not role_matches:
        role_matches = available[:]
    role_matches = role_matches[support_index % len(role_matches):] + role_matches[: support_index % len(role_matches)]
    desired = 2 if kind in {"sashing", "triangle", "background"} else 3
    if len(available) <= desired:
        desired = max(1, len(available) - 1)

    for key in role_matches:
        if key not in selected:
            selected.append(key)
        if len(selected) >= desired:
            break

    if len(selected) >= len(available) and len(available) > 1:
        selected = selected[:-1]
    return selected


def density_score(motifs: list[str], band: str) -> float:
    if not motifs:
        return DENSITY_BANDS[band]["fill_score"]
    avg = sum(float(motif_data(key)["weight"]) for key in motifs) / len(motifs)
    return round(avg * DENSITY_BANDS[band]["fill_score"], 2)


def build_plan(args: argparse.Namespace) -> dict:
    motifs = [normalize_motif(value) for value in parse_csv(args.motifs)] if args.motifs else DEFAULT_MOTIFS[:]
    sections = parse_sections(args.sections)
    if not sections:
        raise ValueError("At least one quilt section is required.")
    focal_name = args.focal or next((section.name for section in sections if section.kind == "focal"), sections[0].name)

    support_index = 0
    planned_sections = []
    motif_counts = {key: 0 for key in motifs}
    for section in sections:
        is_focal = section.name.lower() == focal_name.lower() or section.kind == "focal"
        if is_focal:
            mix = motifs[:]
            role = "focal"
        else:
            mix = choose_support_motifs(motifs, section.kind, support_index)
            role = "support"
            support_index += 1
        for key in mix:
            motif_counts[key] = motif_counts.get(key, 0) + section.count
        template = GEOGRAPHY_TEMPLATES.get(section.kind, GEOGRAPHY_TEMPLATES["block"])
        planned_sections.append(
            {
                "name": section.name,
                "kind": section.kind,
                "count": section.count,
                "role": role,
                "composition_skeleton": template["skeleton"],
                "motifs": [{"key": key, **motif_data(key)} for key in mix],
                "omitted_motifs": [key for key in motifs if key not in mix],
                "density_band": args.density,
                "density_score": density_score(mix, args.density),
                "digitizing_order": template["digitizing_order"],
                "art_board_notes": art_board_notes(section.kind, mix),
                "reject_if": reject_rules(section.kind),
            }
        )

    return {
        "name": args.name,
        "theme": args.theme,
        "source_basis": [
            "SusanManry.com Mexican Stars design process: quilt-led motifs and continuous-line conversion",
            "SusanManry.com Sunflower Love project vocabulary: layered borders, pearls, triangles, flourishes, flower echoes, flower-pearl combinations",
            "SusanManry.com Custom Quilting with Pro-Stitcher: precise areas for blocks, borders, triangles, and irregular spaces",
        ],
        "density_guidance": DENSITY_BANDS[args.density],
        "motif_library": [{"key": key, **motif_data(key)} for key in motifs],
        "focal_section": focal_name,
        "sections": planned_sections,
        "art_gate": [
            "full art-board preview exists before DXF",
            "every geography has a boundary-aware skeleton",
            "motifs lock into frames, spines, corners, or boundaries",
            "focal section contains the full motif family",
            "support sections omit at least one focal motif",
            "density scores stay in a comparable visual band",
            "no section reads as floating motifs or icons connected by naked travel lines",
            "borders and corners have planned turns",
            "triangles taper into the point and are not cropped blocks",
        ],
    }


def art_board_notes(kind: str, motifs: list[str]) -> list[str]:
    labels = [motif_data(key)["label"] for key in motifs]
    motif_text = ", ".join(labels)
    if kind == "border":
        return [
            f"Lay out {motif_text} on a continuous border spine.",
            "Add an outer containment, an inner containment, and a planned corner turn.",
            "Use pearls or echoes as visible connectors, not hidden travel.",
        ]
    if kind == "triangle":
        return [
            f"Use partial {motif_text} forms along a diagonal or radial spine.",
            "Scale motifs down toward the point instead of cropping them.",
            "Keep the broad edge visually balanced with adjacent blocks.",
        ]
    if kind == "sashing":
        return [
            f"Keep {motif_text} rhythmic and quieter than focal blocks.",
            "Maintain same-plane start/end behavior for repeatable strips.",
        ]
    if kind == "focal":
        return [
            f"Use the full motif family: {motif_text}.",
            "Build a center, frame, pearl/echo layer, scroll support, and corner interest.",
        ]
    return [
        f"Compose {motif_text} as a complete area, not a cropped excerpt.",
        "Use a frame, center, echoes, and corner details to control negative space.",
    ]


def reject_rules(kind: str) -> list[str]:
    base = [
        "floating motifs with obvious connectors",
        "large accidental empty zones",
        "density outside the coordinate set band",
    ]
    if kind == "border":
        base.extend(["no corner strategy", "single unframed repeat"])
    if kind == "triangle":
        base.extend(["square block squeezed into triangle", "awkward partial motifs at the point"])
    if kind == "sashing":
        base.extend(["overly ornate fill that competes with blocks"])
    return base


def write_markdown(path: Path, plan: dict) -> None:
    lines = [
        f"# {plan['name']}",
        "",
        f"Theme: {plan['theme']}",
        f"Focal section: {plan['focal_section']}",
        f"Density: {plan['density_guidance']['stitch_spacing']} - {plan['density_guidance']['line_spacing_goal']}",
        "",
        "## Motif Library",
        "",
    ]
    for motif in plan["motif_library"]:
        lines.append(f"- {motif['label']}: {motif['source_cue']}; entry/exit: {motif['entry_exit']}.")
    lines.extend(
        [
            "",
            "## Sections",
            "",
            "| Section | Role | Kind | Motifs | Density | Skeleton |",
            "|---|---|---|---|---:|---|",
        ]
    )
    for section in plan["sections"]:
        motif_text = ", ".join(motif["label"] for motif in section["motifs"])
        lines.append(
            f"| {section['name']} | {section['role']} | {section['kind']} | {motif_text} | {section['density_score']:.2f} | {section['composition_skeleton']} |"
        )
    lines.extend(["", "## Art Gate", ""])
    for check in plan["art_gate"]:
        lines.append(f"- {check}")
    lines.append("")
    lines.append("Do not generate DXF until this art plan has been converted into a visual preview and passes the art gate.")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Coordinate Artwork Plan")
    parser.add_argument("--theme", default="original coordinated longarm quilting set")
    parser.add_argument("--motifs", help="Comma-separated motif keys or labels. Defaults to the SusanManry.com-informed grammar.")
    parser.add_argument("--sections", required=True, help="Comma-separated geographies, e.g. focal:1:focal,outer border:4:border,triangles:8:triangle.")
    parser.add_argument("--focal", help="Name of the focal section. Defaults to section kind focal or the first section.")
    parser.add_argument("--density", choices=sorted(DENSITY_BANDS), default="medium")
    parser.add_argument("--out", help="Optional output directory for coordinate-artwork-plan.json and .md.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    plan = build_plan(args)
    text = json.dumps(plan, indent=2)
    print(text)
    if args.out:
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "coordinate-artwork-plan.json").write_text(text + "\n", encoding="utf-8")
        write_markdown(out_dir / "coordinate-artwork-plan.md", plan)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
