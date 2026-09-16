#!/usr/bin/env python3
"""Compare native coordinate packages against a baseline package."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


MANIFEST_NAMES = [
    "native-sakura-coordinate-set-manifest.json",
    "native-coordinate-set-manifest.json",
]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def find_manifest(root: Path) -> Path:
    if root.is_file():
        return root
    for name in MANIFEST_NAMES:
        path = root / name
        if path.exists():
            return path
    matches = sorted(root.glob("*coordinate*manifest*.json"))
    if matches:
        return matches[0]
    raise FileNotFoundError(f"No coordinate package manifest found in {root}")


def load_art_critique(manifest: dict, package_root: Path) -> dict:
    art = manifest.get("art_critique") or {}
    candidates: list[Path] = []
    if art.get("path"):
        candidates.append(package_root / art["path"])
    candidates.append(package_root / "native-package-art-critique.json")

    payload: dict = {}
    for path in candidates:
        if path.exists():
            payload = load_json(path)
            break

    if not payload and art:
        return {
            "available": art.get("passes") is not None,
            "passes": art.get("passes"),
            "score": art.get("score"),
            "warning_count": len(art.get("warnings", [])),
            "failure_count": len(art.get("failures", [])),
            "warnings": art.get("warnings", []),
            "failures": art.get("failures", []),
            "machine_warning_scope": ((art.get("metrics") or {}).get("machine_warning_scope") or {}),
            "seam_join_scope": ((art.get("metrics") or {}).get("seam_join_scope") or {}),
            "line_character": {},
        }

    metrics = payload.get("metrics") or {}
    return {
        "available": bool(payload),
        "passes": payload.get("passes") if payload else None,
        "score": payload.get("score") if payload else None,
        "warning_count": len(payload.get("warnings", [])) if payload else None,
        "failure_count": len(payload.get("failures", [])) if payload else None,
        "warnings": payload.get("warnings", []) if payload else [],
        "failures": payload.get("failures", []) if payload else [],
        "machine_warning_scope": metrics.get("machine_warning_scope") or {},
        "seam_join_scope": metrics.get("seam_join_scope") or {},
        "line_character": metrics.get("line_character") or {},
    }


def count_qa(items: list[dict]) -> dict:
    failures: list[str] = []
    warning_count = 0
    production_warning_count = 0
    companion_warning_count = 0
    passed_count = 0
    total_count = 0
    production_target_count = 0
    companion_target_count = 0
    micro_segments = 0
    reversals = 0
    cusps = 0
    tiny_loops = 0
    for item in items:
        dxf_files = item.get("dxf_files") or []
        primary = str(dxf_files[0]).replace("\\", "/") if dxf_files else ""
        for qa in item.get("qa", []):
            dxf = str(qa.get("dxf", "")).replace("\\", "/")
            is_primary = bool(primary and dxf == primary)
            total_count += 1
            if is_primary:
                production_target_count += 1
            else:
                companion_target_count += 1
            if qa.get("passes"):
                passed_count += 1
            failures.extend(qa.get("failures", []))
            qa_warning_count = len(qa.get("warnings", []))
            warning_count += qa_warning_count
            if is_primary:
                production_warning_count += qa_warning_count
            else:
                companion_warning_count += qa_warning_count
            metrics = qa.get("metrics") or {}
            micro_segments += int(metrics.get("micro_segment_count") or 0)
            reversals += int(metrics.get("reversal_turn_count") or 0)
            cusps += int(metrics.get("cusp_turn_count") or 0)
            tiny_loops += int(metrics.get("tiny_closed_loop_count") or 0)
    return {
        "target_count": total_count,
        "passed_count": passed_count,
        "failure_count": len(failures),
        "warning_count": warning_count,
        "production_target_count": production_target_count,
        "companion_or_stress_target_count": companion_target_count,
        "production_warning_count": production_warning_count,
        "companion_or_stress_warning_count": companion_warning_count,
        "micro_segment_count": micro_segments,
        "reversal_turn_count": reversals,
        "cusp_turn_count": cusps,
        "tiny_closed_loop_count": tiny_loops,
    }


def count_seam_joins(items: list[dict]) -> dict:
    checked = 0
    clean = 0
    flagged = 0
    max_tangent_delta = 0.0
    max_y_delta = 0.0
    flagged_targets: list[str] = []
    for component in items:
        for qa in component.get("qa", []):
            metrics = qa.get("metrics") or {}
            is_checked = bool(qa.get("seam_tangent_check") or metrics.get("seam_tangent_checked"))
            if not is_checked:
                continue
            checked += 1
            thresholds = qa.get("thresholds") or {}
            max_allowed_delta = float(thresholds.get("max_seam_tangent_delta", 45.0) or 45.0)
            max_allowed_y = float(thresholds.get("max_start_end_y_delta", 0.001) or 0.001)
            tangent_delta = metrics.get("seam_tangent_delta_degrees")
            y_delta = metrics.get("start_end_y_delta")
            if isinstance(tangent_delta, (int, float)):
                max_tangent_delta = max(max_tangent_delta, abs(float(tangent_delta)))
            if isinstance(y_delta, (int, float)):
                max_y_delta = max(max_y_delta, abs(float(y_delta)))
            repeat_warnings = [item for item in qa.get("warnings", []) if "Repeat" in str(item) or "tangent" in str(item)]
            issue = bool(repeat_warnings)
            if isinstance(tangent_delta, (int, float)) and tangent_delta > max_allowed_delta:
                issue = True
            if isinstance(y_delta, (int, float)) and abs(y_delta) > max_allowed_y:
                issue = True
            if issue:
                flagged += 1
                flagged_targets.append(qa.get("dxf") or component.get("id") or "unknown repeat")
            else:
                clean += 1
    return {
        "checked_target_count": checked,
        "clean_target_count": clean,
        "flagged_target_count": flagged,
        "max_seam_tangent_delta_degrees": round(max_tangent_delta, 3),
        "max_start_end_y_delta": round(max_y_delta, 5),
        "flagged_targets": flagged_targets,
    }


def count_flow_overlays(items: list[dict]) -> dict:
    qa_targets = 0
    overlay_count = 0
    missing_targets: list[str] = []
    for component in items:
        for qa in component.get("qa", []):
            qa_targets += 1
            metrics = qa.get("metrics") or {}
            overlay = metrics.get("flow_overlay") or {}
            if overlay.get("version"):
                overlay_count += 1
            else:
                missing_targets.append(qa.get("dxf") or component.get("id") or "unknown target")
    return {
        "target_count": qa_targets,
        "overlay_count": overlay_count,
        "missing_overlay_count": len(missing_targets),
        "missing_targets": missing_targets,
    }


def primary_qa(component: dict) -> dict | None:
    dxf_files = component.get("dxf_files") or []
    if not dxf_files:
        return None
    primary = dxf_files[0]
    for qa in component.get("qa", []):
        if qa.get("dxf") == primary:
            return qa
    return (component.get("qa") or [None])[0]


def visual_metrics(root: Path, preview_rel: str | None) -> dict | None:
    if not preview_rel:
        return None
    path = root / preview_rel
    if not path.exists():
        return {"available": False, "preview": preview_rel}
    try:
        from PIL import Image
    except Exception:
        return {"available": False, "preview": preview_rel, "reason": "Pillow unavailable"}

    with Image.open(path) as raw:
        image = raw.convert("RGB")
    width, height = image.size
    blue_pixels: list[tuple[int, int]] = []
    for y in range(height):
        for x in range(width):
            r, g, b = image.getpixel((x, y))
            blue_line = b > r + 35 and g > r + 30 and b < 190 and g < 170
            if blue_line:
                blue_pixels.append((x, y))
    if not blue_pixels:
        return {
            "available": True,
            "preview": preview_rel,
            "ink_pixel_ratio": 0.0,
            "foreground_width_ratio": 0.0,
            "foreground_height_ratio": 0.0,
        }
    xs = [point[0] for point in blue_pixels]
    ys = [point[1] for point in blue_pixels]
    min_x = min(xs)
    max_x = max(xs)
    min_y = min(ys)
    max_y = max(ys)
    center_x = (min_x + max_x + 1) / (2 * max(1, width))
    center_y = (min_y + max_y + 1) / (2 * max(1, height))
    return {
        "available": True,
        "preview": preview_rel,
        "image_size": [width, height],
        "ink_pixel_ratio": round(len(blue_pixels) / max(1, width * height), 6),
        "foreground_width_ratio": round((max_x - min_x + 1) / max(1, width), 4),
        "foreground_height_ratio": round((max_y - min_y + 1) / max(1, height), 4),
        "foreground_center_x_ratio": round(center_x, 4),
        "foreground_center_y_ratio": round(center_y, 4),
        "center_x_offset": round(abs(center_x - 0.5), 4),
        "center_y_offset": round(abs(center_y - 0.5), 4),
        "margin_left_ratio": round(min_x / max(1, width), 4),
        "margin_right_ratio": round((width - 1 - max_x) / max(1, width), 4),
        "margin_top_ratio": round(min_y / max(1, height), 4),
        "margin_bottom_ratio": round((height - 1 - max_y) / max(1, height), 4),
    }


def component_summary(
    root: Path,
    component: dict,
    density_by_component: dict[str, dict],
    line_character_by_component: dict[str, dict],
) -> dict:
    qa = primary_qa(component)
    qa_metrics = (qa or {}).get("metrics") or {}
    density = density_by_component.get(component.get("id"), {})
    line_character = line_character_by_component.get(component.get("id"), {})
    return {
        "id": component.get("id"),
        "geography": component.get("geography"),
        "density_role": component.get("density_role"),
        "motif_count": len(component.get("motifs", [])),
        "omitted_motif_count": len(component.get("omitted_motifs", [])),
        "dxf_count": len(component.get("dxf_files", [])),
        "qa_target_count": len(component.get("qa", [])),
        "primary_qa_passes": bool((qa or {}).get("passes")),
        "warning_count": sum(len(item.get("warnings", [])) for item in component.get("qa", [])),
        "failure_count": sum(len(item.get("failures", [])) for item in component.get("qa", [])),
        "drawn_length": qa_metrics.get("total_drawn_length"),
        "segment_count": qa_metrics.get("segment_count"),
        "reversal_turn_count": qa_metrics.get("reversal_turn_count"),
        "cusp_turn_count": qa_metrics.get("cusp_turn_count"),
        "relative_density": density.get("relative_to_median"),
        "density_band": density.get("density_band"),
        "visual": visual_metrics(root, component.get("preview")),
        "line_character": {
            "angle_entropy": line_character.get("angle_entropy"),
            "straightish_turn_ratio": line_character.get("straightish_turn_ratio"),
            "expressive_turn_ratio": line_character.get("expressive_turn_ratio"),
            "unique_signature_ratio": line_character.get("unique_signature_ratio"),
        }
        if line_character
        else {},
    }


def normalize(root: Path) -> dict:
    manifest_path = find_manifest(root)
    manifest = load_json(manifest_path)
    package_root = manifest_path.parent
    components = manifest.get("components", [])
    art_critique = load_art_critique(manifest, package_root)
    density_items = ((manifest.get("density_summary") or {}).get("items") or [])
    density_by_component = {item.get("component"): item for item in density_items}
    component_items = [
        component_summary(package_root, item, density_by_component, art_critique.get("line_character") or {})
        for item in components
    ]
    art_summary = dict(art_critique)
    art_summary.pop("line_character", None)
    return {
        "root": str(package_root),
        "manifest": str(manifest_path),
        "name": manifest.get("name"),
        "machine_status": manifest.get("machine_status"),
        "art_status": manifest.get("art_status"),
        "component_builds_passed": bool(manifest.get("component_builds_passed")),
        "strict_machine_qa_passed": bool(manifest.get("strict_machine_qa_passed")),
        "role_aware_balance_passed": bool((manifest.get("density_summary") or {}).get("role_aware_balance_passed", True)),
        "review_flags": (manifest.get("density_summary") or {}).get("review_flags", []),
        "component_ids": [item.get("id") for item in component_items],
        "component_count": len(component_items),
        "contact_sheet": manifest.get("contact_sheet"),
        "contact_sheet_layout": manifest.get("contact_sheet_layout") or {},
        "dxf_package": manifest.get("dxf_package"),
        "art_critique": art_summary,
        "qa": count_qa(components),
        "seam_join": count_seam_joins(components),
        "flow_overlay": count_flow_overlays(components),
        "components": {item["id"]: item for item in component_items if item.get("id")},
    }


def numeric_delta(candidate: Any, baseline: Any) -> float | None:
    if isinstance(candidate, bool) or isinstance(baseline, bool):
        return None
    if isinstance(candidate, (int, float)) and isinstance(baseline, (int, float)):
        return round(float(candidate) - float(baseline), 5)
    return None


def ratio(candidate: Any, baseline: Any) -> float | None:
    if not isinstance(candidate, (int, float)) or not isinstance(baseline, (int, float)):
        return None
    if abs(float(baseline)) < 1e-9:
        return None
    return round(float(candidate) / float(baseline), 5)


def compare_components(candidate: dict, baseline: dict | None) -> tuple[list[str], list[str], list[dict]]:
    regressions: list[str] = []
    improvements: list[str] = []
    component_deltas: list[dict] = []

    baseline_components = (baseline or {}).get("components", {})
    for component_id, cand in candidate["components"].items():
        base = baseline_components.get(component_id)
        if not cand["primary_qa_passes"]:
            regressions.append(f"{component_id} primary DXF does not pass strict machine QA.")
        if cand["failure_count"]:
            regressions.append(f"{component_id} has QA failures.")
        if not cand.get("visual", {}).get("available", False):
            regressions.append(f"{component_id} preview metrics are unavailable.")
        if not base:
            improvements.append(f"{component_id} is present in the candidate package.")
            continue

        delta = {
            "component": component_id,
            "drawn_length_delta": numeric_delta(cand.get("drawn_length"), base.get("drawn_length")),
            "drawn_length_ratio": ratio(cand.get("drawn_length"), base.get("drawn_length")),
            "relative_density_delta": numeric_delta(cand.get("relative_density"), base.get("relative_density")),
            "warning_delta": numeric_delta(cand.get("warning_count"), base.get("warning_count")),
            "reversal_delta": numeric_delta(cand.get("reversal_turn_count"), base.get("reversal_turn_count")),
            "visual_ink_ratio_delta": None,
            "visual_width_ratio_delta": None,
            "visual_height_ratio_delta": None,
            "visual_center_x_offset_delta": None,
            "visual_center_y_offset_delta": None,
            "angle_entropy_delta": None,
            "straightish_turn_ratio_delta": None,
            "unique_signature_ratio_delta": None,
        }
        cand_visual = cand.get("visual") or {}
        base_visual = base.get("visual") or {}
        if cand_visual.get("available") and base_visual.get("available"):
            delta["visual_ink_ratio_delta"] = numeric_delta(cand_visual.get("ink_pixel_ratio"), base_visual.get("ink_pixel_ratio"))
            delta["visual_width_ratio_delta"] = numeric_delta(cand_visual.get("foreground_width_ratio"), base_visual.get("foreground_width_ratio"))
            delta["visual_height_ratio_delta"] = numeric_delta(cand_visual.get("foreground_height_ratio"), base_visual.get("foreground_height_ratio"))
            delta["visual_center_x_offset_delta"] = numeric_delta(cand_visual.get("center_x_offset"), base_visual.get("center_x_offset"))
            delta["visual_center_y_offset_delta"] = numeric_delta(cand_visual.get("center_y_offset"), base_visual.get("center_y_offset"))

            if ratio(cand_visual.get("ink_pixel_ratio"), base_visual.get("ink_pixel_ratio")) is not None:
                ink_ratio = ratio(cand_visual.get("ink_pixel_ratio"), base_visual.get("ink_pixel_ratio"))
                if ink_ratio is not None and ink_ratio < 0.82:
                    regressions.append(f"{component_id} preview has materially less line presence than the baseline.")
                elif ink_ratio is not None and ink_ratio > 1.12:
                    improvements.append(f"{component_id} preview has more line presence than the baseline.")
            if (delta["visual_center_y_offset_delta"] or 0) > 0.08:
                regressions.append(f"{component_id} preview framing is less vertically centered than the baseline.")
            elif (delta["visual_center_y_offset_delta"] or 0) < -0.08:
                improvements.append(f"{component_id} preview framing is more vertically centered.")
            if (delta["visual_center_x_offset_delta"] or 0) > 0.08:
                regressions.append(f"{component_id} preview framing is less horizontally centered than the baseline.")
            elif (delta["visual_center_x_offset_delta"] or 0) < -0.08:
                improvements.append(f"{component_id} preview framing is more horizontally centered.")

        length_ratio = delta["drawn_length_ratio"]
        if component_id in {"focal-medallion", "block-component", "border-repeat", "setting-triangle"}:
            if length_ratio is not None and length_ratio < 0.86:
                regressions.append(f"{component_id} drawn-line development dropped materially.")
        if cand["dxf_count"] < base["dxf_count"]:
            regressions.append(f"{component_id} has fewer DXF outputs than the baseline.")
        if cand["motif_count"] < base["motif_count"] and component_id == "focal-medallion":
            regressions.append("Focal medallion lost motif vocabulary compared with the baseline.")
        if cand["warning_count"] > base["warning_count"] + 3:
            regressions.append(f"{component_id} has materially more machine-QA warnings than the baseline.")
        if cand["warning_count"] < base["warning_count"]:
            improvements.append(f"{component_id} reduces machine-QA warnings.")
        cand_line = cand.get("line_character") or {}
        base_line = base.get("line_character") or {}
        if cand_line and base_line:
            delta["angle_entropy_delta"] = numeric_delta(cand_line.get("angle_entropy"), base_line.get("angle_entropy"))
            delta["straightish_turn_ratio_delta"] = numeric_delta(
                cand_line.get("straightish_turn_ratio"),
                base_line.get("straightish_turn_ratio"),
            )
            delta["unique_signature_ratio_delta"] = numeric_delta(
                cand_line.get("unique_signature_ratio"),
                base_line.get("unique_signature_ratio"),
            )
            if component_id in {"focal-medallion", "setting-triangle", "block-component"}:
                if (delta["angle_entropy_delta"] or 0) < -0.035:
                    regressions.append(f"{component_id} line-character variety regressed.")
                elif (delta["angle_entropy_delta"] or 0) > 0.025:
                    improvements.append(f"{component_id} line-character variety improved.")
                if (delta["straightish_turn_ratio_delta"] or 0) > 0.05:
                    regressions.append(f"{component_id} has a more mathematical straightish-turn profile.")
                elif (delta["straightish_turn_ratio_delta"] or 0) < -0.04:
                    improvements.append(f"{component_id} has a less mathematical straightish-turn profile.")
                if (delta["unique_signature_ratio_delta"] or 0) < -0.055:
                    regressions.append(f"{component_id} unique line signatures dropped materially.")
        component_deltas.append(delta)

    for component_id in baseline_components:
        if component_id not in candidate["components"]:
            regressions.append(f"{component_id} is missing from the candidate package.")

    return regressions, improvements, component_deltas


def compare(candidate_root: Path, baseline_root: Path | None = None) -> dict:
    candidate = normalize(candidate_root)
    baseline = normalize(baseline_root) if baseline_root else None

    regressions: list[str] = []
    improvements: list[str] = []

    if not candidate["component_builds_passed"]:
        regressions.append("Candidate component builds did not all pass.")
    if not candidate["strict_machine_qa_passed"]:
        regressions.append("Candidate strict machine QA did not pass.")
    if not candidate["role_aware_balance_passed"]:
        regressions.append("Candidate role-aware density review did not pass.")
    if candidate["review_flags"]:
        regressions.extend(candidate["review_flags"])
    if not candidate["art_critique"].get("available"):
        regressions.append("Candidate is missing a native package art critique.")
    elif candidate["art_critique"].get("passes") is False:
        regressions.append("Candidate native package art critique does not pass.")
    if not candidate["contact_sheet"]:
        regressions.append("Candidate is missing a contact sheet.")
    if not candidate["dxf_package"]:
        regressions.append("Candidate is missing a DXF package.")
    if candidate["seam_join"]["checked_target_count"] == 0:
        regressions.append("Candidate is missing repeat seam tangent checks for chainable outputs.")
    if candidate["seam_join"]["flagged_target_count"] > 0:
        regressions.append("Candidate repeat seam tangent checks flag chainable outputs.")
    if candidate["flow_overlay"]["overlay_count"] < candidate["qa"]["target_count"]:
        regressions.append("Candidate is missing stitch-flow overlays for one or more QA targets.")

    if baseline:
        machine_qa_delta = {
            "warning_delta": numeric_delta(candidate["qa"].get("warning_count"), baseline["qa"].get("warning_count")),
            "production_warning_delta": numeric_delta(
                candidate["qa"].get("production_warning_count"),
                baseline["qa"].get("production_warning_count"),
            ),
            "companion_or_stress_warning_delta": numeric_delta(
                candidate["qa"].get("companion_or_stress_warning_count"),
                baseline["qa"].get("companion_or_stress_warning_count"),
            ),
            "micro_segment_delta": numeric_delta(
                candidate["qa"].get("micro_segment_count"),
                baseline["qa"].get("micro_segment_count"),
            ),
        }
        if candidate["component_count"] < baseline["component_count"]:
            regressions.append("Candidate has fewer components than the baseline.")
        if candidate["qa"]["target_count"] < baseline["qa"]["target_count"]:
            regressions.append("Candidate has fewer strict QA targets than the baseline.")
        if candidate["seam_join"]["checked_target_count"] < baseline["seam_join"].get("checked_target_count", 0):
            regressions.append("Candidate has fewer repeat seam tangent checks than the baseline.")
        if candidate["seam_join"]["flagged_target_count"] > baseline["seam_join"].get("flagged_target_count", 0):
            regressions.append("Candidate introduces more flagged repeat seam joins than the baseline.")
        if candidate["seam_join"]["checked_target_count"] > baseline["seam_join"].get("checked_target_count", 0):
            improvements.append("Candidate adds repeat seam tangent checks for chainable outputs.")
        if candidate["seam_join"]["clean_target_count"] > baseline["seam_join"].get("clean_target_count", 0):
            improvements.append("Candidate increases clean repeat seam join coverage.")
        if candidate["seam_join"]["flagged_target_count"] < baseline["seam_join"].get("flagged_target_count", 0):
            improvements.append("Candidate reduces flagged repeat seam joins.")
        if candidate["flow_overlay"]["overlay_count"] < baseline["flow_overlay"].get("overlay_count", 0):
            regressions.append("Candidate has fewer stitch-flow overlays than the baseline.")
        if candidate["flow_overlay"]["overlay_count"] > baseline["flow_overlay"].get("overlay_count", 0):
            improvements.append("Candidate adds stitch-flow overlays to the review package.")
        cand_contact_layout = (candidate.get("contact_sheet_layout") or {}).get("mode")
        base_contact_layout = (baseline.get("contact_sheet_layout") or {}).get("mode")
        if cand_contact_layout == "role-aware review board" and base_contact_layout != cand_contact_layout:
            improvements.append("Candidate uses a role-aware contact-sheet review board.")
        elif base_contact_layout == "role-aware review board" and cand_contact_layout != base_contact_layout:
            regressions.append("Candidate lost the role-aware contact-sheet review-board layout.")
        if candidate["qa"]["warning_count"] > baseline["qa"]["warning_count"] + 8:
            regressions.append("Candidate has materially more machine-QA warnings than the baseline.")
        if candidate["qa"]["production_warning_count"] > baseline["qa"].get("production_warning_count", 0) + 2:
            regressions.append("Candidate has materially more production machine-QA warnings than the baseline.")
        if candidate["qa"]["companion_or_stress_warning_count"] > baseline["qa"].get("companion_or_stress_warning_count", 0) + 6:
            regressions.append("Candidate has materially more companion/stress machine-QA warnings than the baseline.")
        if candidate["qa"]["micro_segment_count"] > baseline["qa"]["micro_segment_count"] + 2:
            regressions.append("Candidate introduces more micro-segment risk than the baseline.")
        if candidate["qa"]["warning_count"] < baseline["qa"]["warning_count"]:
            improvements.append("Candidate reduces total machine-QA warnings.")
        if candidate["qa"]["production_warning_count"] < baseline["qa"].get("production_warning_count", 0):
            improvements.append("Candidate reduces production machine-QA warnings.")
        if candidate["qa"]["companion_or_stress_warning_count"] < baseline["qa"].get("companion_or_stress_warning_count", 0):
            improvements.append("Candidate reduces companion/stress machine-QA warnings.")
        cand_art = candidate["art_critique"]
        base_art = baseline["art_critique"]
        cand_scope = cand_art.get("machine_warning_scope") or {}
        base_scope = base_art.get("machine_warning_scope") or {}
        production_warning_delta = numeric_delta(
            cand_scope.get("production_warning_count"),
            base_scope.get("production_warning_count"),
        )
        companion_warning_delta = numeric_delta(
            cand_scope.get("companion_or_stress_warning_count"),
            base_scope.get("companion_or_stress_warning_count"),
        )
        if base_art.get("available") and cand_art.get("available"):
            art_score_delta = numeric_delta(cand_art.get("score"), base_art.get("score"))
            art_warning_delta = numeric_delta(cand_art.get("warning_count"), base_art.get("warning_count"))
            art_failure_delta = numeric_delta(cand_art.get("failure_count"), base_art.get("failure_count"))
            if art_score_delta is not None and art_score_delta < -5:
                regressions.append("Candidate native package art-critique score regressed materially.")
            elif art_score_delta is not None and art_score_delta > 2:
                improvements.append("Candidate native package art-critique score improved.")
            if art_warning_delta is not None and art_warning_delta > 2:
                regressions.append("Candidate adds multiple art-critique warnings.")
            elif art_warning_delta is not None and art_warning_delta < 0:
                improvements.append("Candidate reduces art-critique warnings.")
            if art_failure_delta is not None and art_failure_delta > 0:
                regressions.append("Candidate adds art-critique failures.")
        else:
            art_score_delta = None
            art_warning_delta = None
            art_failure_delta = None
    else:
        machine_qa_delta = None
        art_score_delta = None
        art_warning_delta = None
        art_failure_delta = None
        production_warning_delta = None
        companion_warning_delta = None

    component_regressions, component_improvements, component_deltas = compare_components(candidate, baseline)
    regressions.extend(component_regressions)
    improvements.extend(component_improvements)

    winner = "candidate"
    if regressions:
        winner = "needs-review"
    elif baseline:
        if not improvements and all(
            math.isclose((delta.get("drawn_length_delta") or 0), 0, abs_tol=1e-5)
            for delta in component_deltas
        ):
            winner = "tie"

    return {
        "passes": winner in {"candidate", "tie"},
        "winner": winner,
        "regressions": regressions,
        "improvements": improvements,
        "candidate": candidate,
        "baseline": baseline,
        "component_deltas": component_deltas,
        "machine_qa_delta": machine_qa_delta,
        "art_critique_delta": {
            "score_delta": art_score_delta,
            "warning_delta": art_warning_delta,
            "warning_count_delta": art_warning_delta,
            "failure_delta": art_failure_delta,
            "production_warning_delta": production_warning_delta,
            "companion_or_stress_warning_delta": companion_warning_delta,
        }
        if baseline
        else None,
        "review_note": "This guards package quality and visual/QA drift. It does not replace human art approval or machine testing.",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", required=True, help="Candidate package directory or manifest JSON.")
    parser.add_argument("--baseline", help="Baseline package directory or manifest JSON.")
    parser.add_argument("--out", help="Optional JSON output path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = compare(Path(args.candidate), Path(args.baseline) if args.baseline else None)
    text = json.dumps(result, indent=2)
    print(text)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    return 0 if result["passes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
