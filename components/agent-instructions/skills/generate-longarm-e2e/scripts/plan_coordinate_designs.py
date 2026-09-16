#!/usr/bin/env python3
"""Plan motif distribution for a coordinated longarm quilting design set."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path


DENSITY_BANDS = {
    "open": {
        "stitch_spacing": "0.050-0.070 in",
        "density_scale": 0.78,
        "notes": "larger negative spaces, fewer echoes, broad graceful connectors",
    },
    "medium": {
        "stitch_spacing": "0.035-0.050 in",
        "density_scale": 1.00,
        "notes": "moderate negative spaces, restrained echoes, occasional pearls or curls",
    },
    "dense": {
        "stitch_spacing": "0.025-0.035 in",
        "density_scale": 1.22,
        "notes": "closer fill, smaller motifs, machine-test carefully for stiffness",
    },
}

CONNECTORS = [
    "flowing vine",
    "pearl chain",
    "ribbon spine",
    "soft echo line",
    "curl-and-leaf travel",
    "feathered connector",
]

FILL_ACCENTS = [
    "single echo",
    "double echo",
    "small pearls",
    "open curl",
    "leaf sprig",
    "background ribbon",
    "corner curl",
    "petal echo",
]

GEOGRAPHY_NOTES = {
    "border": "directional continuous spine; turn corners intentionally; avoid clipped end motifs",
    "block": "complete block thought; one dominant motif plus smaller echoes or accents",
    "blocks": "complete block thoughts; rotate or scale the motif mix between neighboring blocks",
    "triangle": "diagonal flow, partial motifs, tapering echoes; do not force a square design into the triangle",
    "triangles": "diagonal flow, partial motifs, tapering echoes; vary corners and setting triangles",
    "sashing": "simpler motif mix; coordinate quietly without competing with focal areas",
    "corner": "small-scale version of the border grammar with an intentional turn",
    "corners": "small-scale versions of the border grammar with intentional turns",
    "focal": "full motif library and strongest visual statement",
    "background": "reduced motif mix with enough connector fill to balance open space",
}


@dataclass
class Section:
    name: str
    count: int
    kind: str


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "coordinate-design-set"


def parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def parse_sections(value: str) -> list[Section]:
    sections: list[Section] = []
    for raw in parse_csv(value):
        parts = [part.strip() for part in raw.split(":") if part.strip()]
        name = parts[0]
        count = 1
        kind = slugify(name)
        if len(parts) >= 2:
            try:
                count = max(1, int(parts[1]))
            except ValueError:
                kind = slugify(parts[1])
        if len(parts) >= 3:
            kind = slugify(parts[2])
        sections.append(Section(name=name, count=count, kind=kind))
    return sections


def choose_subset(elements: list[str], index: int, desired: int) -> list[str]:
    if len(elements) <= 1:
        return elements[:]
    desired = max(1, min(desired, len(elements) - 1))
    rotated = elements[index % len(elements):] + elements[: index % len(elements)]
    subset = rotated[:desired]
    omitted = set(elements) - set(subset)
    if not omitted:
        subset = subset[:-1]
    return subset


def section_density(base_scale: float, index: int) -> float:
    offsets = [0.00, 0.04, -0.04, 0.07, -0.07, 0.02, -0.02]
    return round(base_scale + offsets[index % len(offsets)], 2)


def build_plan(args: argparse.Namespace) -> dict:
    elements = parse_csv(args.elements)
    if not elements:
        raise ValueError("At least one motif element is required.")
    sections = parse_sections(args.sections)
    if not sections:
        raise ValueError("At least one quilt geography section is required.")

    focal_name = args.focal or next((s.name for s in sections if "focal" in s.kind), sections[0].name)
    density = DENSITY_BANDS[args.density]
    shared_connector = args.connector or CONNECTORS[len(elements) % len(CONNECTORS)]

    planned_sections = []
    motif_counts = {element: 0 for element in elements}
    support_index = 0
    for idx, section in enumerate(sections):
        is_focal = section.name.lower() == focal_name.lower() or "focal" in section.kind
        if is_focal:
            mix = elements[:]
            role = "focal"
        else:
            desired = 1 if len(elements) == 2 else min(len(elements) - 1, 2 + (support_index % 2))
            mix = choose_subset(elements, support_index, desired)
            role = "support"
            support_index += 1
        for element in mix:
            motif_counts[element] += section.count
        geography_note = GEOGRAPHY_NOTES.get(section.kind, GEOGRAPHY_NOTES.get(slugify(section.name), "adapt motif scale and connector flow to this quilt geography"))
        accent = FILL_ACCENTS[(idx + len(mix)) % len(FILL_ACCENTS)]
        planned_sections.append(
            {
                "name": section.name,
                "kind": section.kind,
                "count": section.count,
                "role": role,
                "motifs": mix,
                "omitted_motifs": [element for element in elements if element not in mix],
                "connector_grammar": shared_connector,
                "accent": accent,
                "density_scale": section_density(density["density_scale"], idx),
                "geography_note": geography_note,
                "drafting_note": drafting_note(section.kind, mix, accent),
            }
        )

    underused = [element for element, count in motif_counts.items() if count < 2 and len(sections) > 1]
    if underused:
        rebalance(planned_sections, elements, underused, motif_counts)

    return {
        "name": args.name,
        "motif_library": elements,
        "focal_section": focal_name,
        "density_band": args.density,
        "density_guidance": density,
        "shared_connector_grammar": shared_connector,
        "sections": planned_sections,
        "quality_checks": [
            "focal section contains the full motif library",
            "supporting sections contain some, but not all, motifs",
            "density scales stay in the same visual band",
            "each important motif appears in more than one geography when possible",
            "each geography is drawn as its own continuous-line DXF",
        ],
    }


def drafting_note(kind: str, motifs: list[str], accent: str) -> str:
    motif_text = ", ".join(motifs)
    if "triangle" in kind:
        return f"Use partial {motif_text} forms along the diagonal with {accent}; taper the fill into the point."
    if "border" in kind:
        return f"Run {motif_text} along the border spine with {accent}; plan corner turns before drawing."
    if "sashing" in kind:
        return f"Keep {motif_text} small and rhythmic with {accent}; let this area support the blocks."
    if "focal" in kind:
        return f"Combine all focal motifs ({motif_text}) with {accent}; make this the most complete design."
    return f"Feature {motif_text} with {accent}; vary scale or rotation from neighboring sections."


def rebalance(planned_sections: list[dict], elements: list[str], underused: list[str], motif_counts: dict[str, int]) -> None:
    supports = [section for section in planned_sections if section["role"] == "support"]
    if not supports:
        return
    for idx, element in enumerate(underused):
        target = supports[idx % len(supports)]
        if element not in target["motifs"] and len(target["motifs"]) < max(1, len(elements) - 1):
            target["motifs"].append(element)
            target["omitted_motifs"] = [motif for motif in elements if motif not in target["motifs"]]
            motif_counts[element] += target["count"]


def write_markdown(path: Path, plan: dict) -> None:
    lines = [
        f"# {plan['name']}",
        "",
        f"Focal section: {plan['focal_section']}",
        f"Motif library: {', '.join(plan['motif_library'])}",
        f"Density band: {plan['density_band']} ({plan['density_guidance']['stitch_spacing']})",
        f"Shared connector grammar: {plan['shared_connector_grammar']}",
        "",
        "| Section | Role | Count | Motifs | Omitted | Density | Note |",
        "|---|---:|---:|---|---|---:|---|",
    ]
    for section in plan["sections"]:
        lines.append(
            "| {name} | {role} | {count} | {motifs} | {omitted} | {density:.2f} | {note} |".format(
                name=section["name"],
                role=section["role"],
                count=section["count"],
                motifs=", ".join(section["motifs"]),
                omitted=", ".join(section["omitted_motifs"]) or "-",
                density=section["density_scale"],
                note=section["drafting_note"],
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="Coordinate Design Set")
    parser.add_argument("--elements", required=True, help="Comma-separated motif library, e.g. star,heart,sunflower,tricycle.")
    parser.add_argument("--sections", required=True, help="Comma-separated quilt geographies. Use name:count or name:count:kind when useful.")
    parser.add_argument("--focal", help="Name of the focal section. Defaults to a section named focal, otherwise first section.")
    parser.add_argument("--density", choices=sorted(DENSITY_BANDS), default="medium")
    parser.add_argument("--connector", help="Shared connector grammar, e.g. flowing vine or pearl chain.")
    parser.add_argument("--out", help="Optional output directory for coordinate-plan.json and coordinate-plan.md.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    plan = build_plan(args)
    text = json.dumps(plan, indent=2)
    print(text)
    if args.out:
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "coordinate-plan.json").write_text(text + "\n", encoding="utf-8")
        write_markdown(out_dir / "coordinate-plan.md", plan)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
