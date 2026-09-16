#!/usr/bin/env python3
"""Critique a native coordinate package for professional longarm art risks."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path

from compare_native_coordinate_package import find_manifest, normalize
from longarm_geometry import parse_dxf_polylines, path_length, resample_by_distance, segment_lengths, turn_angles


REQUIRED_COMPONENTS = {
    "focal-medallion": "rich focal medallion",
    "border-repeat": "straight border repeat",
    "corner-turn": "matching corner turn",
    "setting-triangle": "setting triangle",
    "sashing-rail": "quiet sashing rail",
    "block-component": "supporting block",
}

SUPPORT_COMPONENTS = {
    "border-repeat",
    "corner-turn",
    "setting-triangle",
    "sashing-rail",
    "block-component",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def component_lookup(manifest: dict) -> dict[str, dict]:
    return {item.get("id"): item for item in manifest.get("components", []) if item.get("id")}


def density_lookup(manifest: dict) -> dict[str, dict]:
    items = ((manifest.get("density_summary") or {}).get("items") or [])
    return {item.get("component"): item for item in items if item.get("component")}


def entropy(values: list[int]) -> float:
    if not values:
        return 0.0
    counts = Counter(values)
    total = len(values)
    raw = -sum((count / total) * math.log(count / total, 2) for count in counts.values())
    maximum = math.log(max(1, len(counts)), 2)
    return round(raw / maximum, 4) if maximum else 0.0


def angle_bin(angle: float) -> int:
    if angle < 2:
        return 0
    if angle < 8:
        return 1
    if angle < 20:
        return 2
    if angle < 45:
        return 3
    if angle < 90:
        return 4
    if angle < 135:
        return 5
    if angle < 172:
        return 6
    return 7


def line_character_summary(points: list[tuple[float, float]]) -> dict:
    segs = segment_lengths(points)
    angles = turn_angles(points)
    bins = [angle_bin(angle) for angle in angles]
    straightish = [angle for angle in angles if angle < 2.0]
    expressive = [angle for angle in angles if 8.0 <= angle < 135.0]
    cusps = [angle for angle in angles if 135.0 <= angle < 172.0]
    reversals = [angle for angle in angles if angle >= 172.0]
    unique_signature_count = len({(round(a, 1), round(b, 3)) for a, b in zip(angles, segs[1:])})
    return {
        "point_count": len(points),
        "segment_count": len(segs),
        "angle_count": len(angles),
        "angle_entropy": entropy(bins),
        "straightish_turn_ratio": round(len(straightish) / max(1, len(angles)), 4),
        "expressive_turn_ratio": round(len(expressive) / max(1, len(angles)), 4),
        "cusp_turn_count": len(cusps),
        "reversal_turn_count": len(reversals),
        "unique_signature_ratio": round(unique_signature_count / max(1, len(angles)), 4),
    }


def line_character(dxf_path: Path) -> dict:
    if not dxf_path.exists():
        return {"available": False, "reason": "DXF is missing."}
    shapes = parse_dxf_polylines(dxf_path)
    if not shapes:
        return {"available": False, "reason": "DXF has no usable polylines."}

    points = shapes[0].points
    length = path_length(points)
    design_spacing = 0.08
    design_points = resample_by_distance(points, design_spacing)
    design_summary = line_character_summary(design_points)
    machine_summary = line_character_summary(points)

    return {
        "available": True,
        "shape_count": len(shapes),
        "point_count": len(points),
        "design_point_count": len(design_points),
        "design_scale_spacing": design_spacing,
        "drawn_length": round(length, 4),
        "segment_count": design_summary["segment_count"],
        "angle_count": design_summary["angle_count"],
        "angle_entropy": design_summary["angle_entropy"],
        "straightish_turn_ratio": design_summary["straightish_turn_ratio"],
        "expressive_turn_ratio": design_summary["expressive_turn_ratio"],
        "cusp_turn_count": design_summary["cusp_turn_count"],
        "reversal_turn_count": design_summary["reversal_turn_count"],
        "unique_signature_ratio": design_summary["unique_signature_ratio"],
        "machine_scale": machine_summary,
    }


def motif_distribution(components: dict[str, dict]) -> dict:
    focal = components.get("focal-medallion") or {}
    support = [components[key] for key in SUPPORT_COMPONENTS if key in components]
    support_with_all = [
        item.get("id")
        for item in support
        if set(item.get("motifs", [])) >= set(focal.get("motifs", [])) and focal.get("motifs")
    ]
    support_without_omissions = [item.get("id") for item in support if not item.get("omitted_motifs")]
    motif_sets = {
        key: sorted(item.get("motifs", []))
        for key, item in components.items()
    }
    distinct_sets = {tuple(value) for value in motif_sets.values()}
    return {
        "focal_motif_count": len(focal.get("motifs", [])),
        "max_support_motif_count": max([len(item.get("motifs", [])) for item in support] or [0]),
        "support_components_with_full_focal_vocabulary": support_with_all,
        "support_components_without_omitted_motifs": support_without_omissions,
        "distinct_motif_sets": len(distinct_sets),
        "motif_sets": motif_sets,
    }


def role_checks(normalized: dict, manifest: dict) -> tuple[list[str], list[str], list[str], dict]:
    failures: list[str] = []
    warnings: list[str] = []
    strengths: list[str] = []
    metrics: dict = {}

    components = component_lookup(manifest)
    density = density_lookup(manifest)
    missing = [label for key, label in REQUIRED_COMPONENTS.items() if key not in components]
    if missing:
        failures.append("Missing native coordinate components: " + ", ".join(missing) + ".")
    else:
        strengths.append("The package includes all required native coordinate geographies.")

    if not normalized["strict_machine_qa_passed"]:
        failures.append("Strict machine QA did not pass for the package.")
    elif normalized["qa"]["failure_count"] == 0:
        strengths.append("All listed DXFs pass strict machine QA.")

    if not normalized["role_aware_balance_passed"]:
        failures.append("Role-aware density review did not pass.")
    elif not normalized["review_flags"]:
        strengths.append("Role-aware density review has no flags.")

    distribution = motif_distribution(components)
    metrics["motif_distribution"] = distribution
    if distribution["focal_motif_count"] < 5:
        failures.append("Focal medallion does not carry enough motif vocabulary.")
    elif distribution["focal_motif_count"] >= distribution["max_support_motif_count"]:
        strengths.append("The focal carries the richest or equal-richest motif vocabulary.")

    if distribution["support_components_with_full_focal_vocabulary"]:
        failures.append(
            "Supporting components repeat the full focal vocabulary: "
            + ", ".join(distribution["support_components_with_full_focal_vocabulary"])
            + "."
        )
    if distribution["support_components_without_omitted_motifs"]:
        warnings.append(
            "Some support components omit no motifs; support geographies should usually leave something out: "
            + ", ".join(distribution["support_components_without_omitted_motifs"])
            + "."
        )
    if distribution["distinct_motif_sets"] >= 5:
        strengths.append("Motif sets vary across geographies.")
    else:
        warnings.append("Motif sets may not vary enough across coordinate geographies.")

    normalized_components = normalized["components"]
    focal = normalized_components.get("focal-medallion", {})
    block = normalized_components.get("block-component", {})
    if focal.get("drawn_length") and block.get("drawn_length"):
        ratio = focal["drawn_length"] / max(0.001, block["drawn_length"])
        metrics["focal_to_block_length_ratio"] = round(ratio, 3)
        if ratio < 1.08:
            warnings.append("Focal medallion drawn-line development is close to or below the supporting block.")
        else:
            strengths.append("Focal medallion has more drawn-line development than the supporting block.")

    preview_framing: dict[str, dict] = {}
    for key, item in normalized_components.items():
        visual = item.get("visual") or {}
        preview_framing[key] = {
            "ink_pixel_ratio": visual.get("ink_pixel_ratio"),
            "foreground_width_ratio": visual.get("foreground_width_ratio"),
            "foreground_height_ratio": visual.get("foreground_height_ratio"),
            "center_x_offset": visual.get("center_x_offset"),
            "center_y_offset": visual.get("center_y_offset"),
            "margins": {
                "left": visual.get("margin_left_ratio"),
                "right": visual.get("margin_right_ratio"),
                "top": visual.get("margin_top_ratio"),
                "bottom": visual.get("margin_bottom_ratio"),
            },
        }
        if not visual.get("available"):
            failures.append(f"{key} preview metrics are unavailable.")
            continue
        ink = visual.get("ink_pixel_ratio") or 0
        width_ratio = visual.get("foreground_width_ratio") or 0
        height_ratio = visual.get("foreground_height_ratio") or 0
        center_x_offset = visual.get("center_x_offset") or 0
        center_y_offset = visual.get("center_y_offset") or 0
        if key in {"focal-medallion", "setting-triangle", "block-component"} and ink < 0.018:
            warnings.append(f"{key} preview may read too sparse for its geography.")
        if key == "focal-medallion" and (width_ratio < 0.52 or height_ratio < 0.68):
            warnings.append("Focal medallion may not occupy enough of its review field.")
        if key == "border-repeat" and width_ratio < 0.9:
            warnings.append("Border chained preview does not use enough horizontal repeat space.")
        if key == "sashing-rail" and height_ratio > 0.62:
            warnings.append("Sashing rail may be visually too dominant for a quiet support strip.")
        if key in {"focal-medallion", "setting-triangle", "block-component"} and center_y_offset > 0.11:
            warnings.append(f"{key} preview framing is vertically off-center in the review field.")
        if key in {"border-repeat", "sashing-rail"} and center_y_offset > 0.14:
            warnings.append(f"{key} preview framing is vertically off-center for a strip component.")
        if center_x_offset > 0.09:
            warnings.append(f"{key} preview framing is horizontally off-center.")

    for key, item in density.items():
        rel = item.get("relative_to_median")
        if key == "focal-medallion" and isinstance(rel, (int, float)) and rel < 0.82:
            warnings.append("Focal medallion density proxy is low compared with the package median.")
        if key == "sashing-rail" and isinstance(rel, (int, float)) and rel > 3.1:
            warnings.append("Sashing rail density proxy is high; inspect whether it reads ropy.")

    metrics["preview_framing"] = preview_framing
    return failures, warnings, strengths, metrics


def line_checks(package_root: Path, manifest: dict) -> tuple[list[str], list[str], list[str], dict]:
    failures: list[str] = []
    warnings: list[str] = []
    strengths: list[str] = []
    metrics: dict[str, dict] = {}

    for component_id, item in component_lookup(manifest).items():
        dxf_files = item.get("dxf_files") or []
        if not dxf_files:
            failures.append(f"{component_id} has no DXF files.")
            continue
        character = line_character(package_root / dxf_files[0])
        metrics[component_id] = character
        if not character.get("available"):
            failures.append(f"{component_id} line character could not be inspected.")
            continue
        if character["shape_count"] != 1:
            failures.append(f"{component_id} should be one ordered stitch path.")
        if character["unique_signature_ratio"] < 0.16 and component_id not in {"border-repeat", "sashing-rail"}:
            warnings.append(f"{component_id} line character may be overly formulaic.")
        if (
            component_id in {"focal-medallion", "setting-triangle", "block-component"}
            and character["angle_entropy"] < 0.42
            and character["straightish_turn_ratio"] > 0.66
        ):
            warnings.append(f"{component_id} still has a mathematically smooth line-character risk; inspect the preview for hand-drafted warmth.")
        if character["straightish_turn_ratio"] > 0.92 and character["expressive_turn_ratio"] < 0.05:
            warnings.append(f"{component_id} may read as a plain path with too little motif articulation.")
        if component_id in {"focal-medallion", "block-component"} and character["drawn_length"] < 45:
            warnings.append(f"{component_id} may be underdeveloped for a block-scale component.")
        if character["angle_entropy"] >= 0.78:
            strengths.append(f"{component_id} has varied turn character.")
        if character["reversal_turn_count"] > 10:
            warnings.append(f"{component_id} has many hard reversals; inspect petal tips, heart clefts, and scrolls.")

    return failures, warnings, strengths, metrics


def machine_warning_scope(manifest: dict, normalized: dict) -> tuple[list[str], list[str], dict]:
    warnings: list[str] = []
    strengths: list[str] = []
    production_components: list[str] = []
    production_warning_count = 0
    companion_warning_count = 0
    production_micro_segments = 0
    production_reversals = 0
    production_cusps = 0
    production_tiny_segments = 0
    production_targets = 0
    companion_targets = 0

    for component in manifest.get("components", []):
        dxf_files = component.get("dxf_files") or []
        primary_dxf = dxf_files[0] if dxf_files else None
        component_had_warning = False
        for qa in component.get("qa", []):
            metrics = qa.get("metrics") or {}
            is_primary = qa.get("dxf") == primary_dxf
            if is_primary:
                production_targets += 1
                production_warning_count += len(qa.get("warnings", []))
                production_micro_segments += int(metrics.get("micro_segment_count") or 0)
                production_reversals += int(metrics.get("reversal_turn_count") or 0)
                production_cusps += int(metrics.get("cusp_turn_count") or 0)
                production_tiny_segments += int(metrics.get("tiny_segment_count") or 0)
                component_had_warning = component_had_warning or bool(qa.get("warnings"))
            else:
                companion_targets += 1
                companion_warning_count += len(qa.get("warnings", []))
        if component_had_warning:
            production_components.append(component.get("id") or component.get("geography") or "unknown component")

    metrics = {
        "production_target_count": production_targets,
        "companion_or_stress_target_count": companion_targets,
        "production_warning_count": production_warning_count,
        "companion_or_stress_warning_count": companion_warning_count,
        "total_warning_count": normalized["qa"]["warning_count"],
        "production_warning_components": production_components,
        "production_micro_segment_count": production_micro_segments,
        "production_reversal_turn_count": production_reversals,
        "production_cusp_turn_count": production_cusps,
        "production_tiny_segment_count": production_tiny_segments,
        "review_note": "Production targets are the first DXF listed for each component; companion and stress targets include mirrors, chains, rows, and orientation checks.",
    }

    if production_micro_segments:
        warnings.append("Primary production DXFs include micro-segment risk; revise before delivery.")
    elif production_warning_count:
        warnings.append(
            "Primary production DXFs with machine-warning hotspots: "
            + ", ".join(production_components)
            + ". Review overlay maps before release; mirrored, chained, row, and orientation warnings are stress-test repeats."
        )
    elif normalized["qa"]["warning_count"]:
        strengths.append("Machine warnings are limited to companion or stress-test outputs; primary production DXFs are warning-free.")
    else:
        strengths.append("No machine-warning hotspots were recorded across production or stress-test DXFs.")

    return warnings, strengths, metrics


def seam_join_scope(manifest: dict) -> tuple[list[str], list[str], dict]:
    warnings: list[str] = []
    strengths: list[str] = []
    rows: list[dict] = []
    flagged: list[str] = []

    for component in manifest.get("components", []):
        for qa in component.get("qa", []):
            metrics = qa.get("metrics") or {}
            checked = bool(qa.get("seam_tangent_check") or metrics.get("seam_tangent_checked"))
            if not checked:
                continue
            thresholds = qa.get("thresholds") or {}
            max_delta = float(thresholds.get("max_seam_tangent_delta", 45.0) or 45.0)
            max_y_delta = float(thresholds.get("max_start_end_y_delta", 0.001) or 0.001)
            seam_delta = metrics.get("seam_tangent_delta_degrees")
            y_delta = metrics.get("start_end_y_delta")
            endpoint = metrics.get("endpoint_review") or {}
            qa_warnings = [item for item in qa.get("warnings", []) if "Repeat" in item or "tangent" in item]
            issue = bool(qa_warnings)
            if isinstance(seam_delta, (int, float)) and seam_delta > max_delta:
                issue = True
            if isinstance(y_delta, (int, float)) and abs(y_delta) > max_y_delta:
                issue = True
            row = {
                "component": component.get("id"),
                "geography": component.get("geography"),
                "dxf": qa.get("dxf"),
                "seam_tangent_delta_degrees": seam_delta,
                "start_end_y_delta": y_delta,
                "start_point": endpoint.get("start_point"),
                "end_point": endpoint.get("end_point"),
                "start_heading_degrees": endpoint.get("start_heading_degrees"),
                "end_heading_degrees": endpoint.get("end_heading_degrees"),
                "max_seam_tangent_delta": max_delta,
                "max_start_end_y_delta": max_y_delta,
                "warnings": qa_warnings,
                "passes_join_review": not issue,
            }
            rows.append(row)
            if issue:
                flagged.append(component.get("id") or qa.get("dxf") or "unknown repeat")

    metrics = {
        "checked_target_count": len(rows),
        "flagged_target_count": len(flagged),
        "flagged_components": flagged,
        "targets": rows,
        "review_note": "Seam join review is applied only to repeatable borders, sashing rails, and row-chain outputs.",
    }

    if not rows:
        warnings.append("No repeat seam tangent checks were recorded for chainable coordinate components.")
    elif flagged:
        warnings.append("Repeat seam tangent review flagged chainable targets: " + ", ".join(flagged) + ".")
    else:
        strengths.append("Repeatable border, sashing, and row-chain seam tangents are within tolerance.")

    return warnings, strengths, metrics


def critique(package_root: Path) -> dict:
    manifest_path = find_manifest(package_root)
    manifest = load_json(manifest_path)
    normalized = normalize(manifest_path)
    root = manifest_path.parent

    failures: list[str] = []
    warnings: list[str] = []
    strengths: list[str] = []
    recommendations: list[str] = []
    score = 100

    role_failures, role_warnings, role_strengths, role_metrics = role_checks(normalized, manifest)
    line_failures, line_warnings, line_strengths, line_metrics = line_checks(root, manifest)
    machine_warnings, machine_strengths, machine_metrics = machine_warning_scope(manifest, normalized)
    seam_warnings, seam_strengths, seam_metrics = seam_join_scope(manifest)
    failures.extend(role_failures + line_failures)
    warnings.extend(role_warnings + line_warnings + machine_warnings + seam_warnings)
    strengths.extend(role_strengths + line_strengths + machine_strengths + seam_strengths)

    score -= len(failures) * 20
    score -= len(warnings) * 4
    if normalized["qa"]["micro_segment_count"] > 0:
        failures.append("Package includes micro-segment machine risk.")
        score -= 20

    if failures:
        recommendations.append("Revise the failed components before treating this as a coordinate package candidate.")
    elif score < 84:
        recommendations.append("Revise the warnings most visible in the contact sheet before customer-facing delivery.")
    else:
        recommendations.append("Proceed to regression comparison against the best available package, then human art approval and machine test.")

    metrics = {
        "manifest": str(manifest_path),
        "component_count": normalized["component_count"],
        "strict_qa_target_count": normalized["qa"]["target_count"],
        "machine_warning_count": normalized["qa"]["warning_count"],
        "machine_warning_scope": machine_metrics,
        "seam_join_scope": seam_metrics,
        "role": role_metrics,
        "line_character": line_metrics,
    }
    score = max(0, min(100, score))
    return {
        "passes": not failures and score >= 80,
        "score": score,
        "failures": failures,
        "warnings": warnings,
        "strengths": strengths,
        "recommendations": recommendations,
        "metrics": metrics,
        "review_note": "This is an automatic professional-risk critique, not a substitute for human art approval or machine testing.",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", help="Native coordinate package directory or manifest JSON.")
    parser.add_argument("--out", help="Optional JSON output path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = critique(Path(args.package))
    text = json.dumps(result, indent=2)
    print(text)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    return 0 if result["passes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
