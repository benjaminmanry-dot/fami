#!/usr/bin/env python3
"""Check a native coordinate package against the golden acceptance gates."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from compare_native_coordinate_package import find_manifest, load_json, normalize


REQUIRED_COMPONENTS = {
    "focal-medallion",
    "border-repeat",
    "corner-turn",
    "setting-triangle",
    "sashing-rail",
    "block-component",
}

GOLDEN_SUITE_PATH = Path(__file__).resolve().parents[1] / "references" / "golden-acceptance-suite.md"


def as_list(value: Any) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def gate(name: str, passed: bool, details: dict | None = None) -> dict:
    return {"name": name, "passes": bool(passed), "details": details or {}}


def existing(package_root: Path, relative_path: str | None) -> bool:
    return bool(relative_path and (package_root / relative_path).exists())


def component_ids(normalized: dict) -> set[str]:
    return set((normalized.get("components") or {}).keys())


def support_components(normalized: dict) -> list[dict]:
    components = normalized.get("components") or {}
    return [value for key, value in components.items() if key != "focal-medallion"]


def regression_payload(package_root: Path) -> dict:
    path = package_root / "native-package-regression-comparison.json"
    if not path.exists():
        return {"available": False, "path": None}
    payload = load_json(path)
    payload["available"] = True
    payload["path"] = str(path)
    return payload


def build_report(package_root: Path, min_art_score: float, max_golden_tangent_delta: float) -> dict:
    manifest_path = find_manifest(package_root)
    package_root = manifest_path.parent
    normalized = normalize(package_root)

    qa = normalized.get("qa") or {}
    art = normalized.get("art_critique") or {}
    seam = normalized.get("seam_join") or {}
    flow = normalized.get("flow_overlay") or {}
    components = normalized.get("components") or {}
    focal = components.get("focal-medallion") or {}
    support = support_components(normalized)
    regression = regression_payload(package_root)

    ids = component_ids(normalized)
    missing_components = sorted(REQUIRED_COMPONENTS - ids)
    support_without_omissions = [
        item.get("id")
        for item in support
        if int(item.get("omitted_motif_count") or 0) == 0
    ]
    max_support_motif_count = max([int(item.get("motif_count") or 0) for item in support] or [0])
    review_flags = as_list(normalized.get("review_flags"))

    dxf_package = normalized.get("dxf_package")
    contact_sheet = normalized.get("contact_sheet")
    report_rel = normalized.get("review_report") or "native-package-review-report.html"

    gates = [
        gate("golden_suite_reference_available", GOLDEN_SUITE_PATH.exists(), {"path": str(GOLDEN_SUITE_PATH)}),
        gate(
            "required_coordinate_components_present",
            not missing_components and len(ids) >= len(REQUIRED_COMPONENTS),
            {"required": sorted(REQUIRED_COMPONENTS), "present": sorted(ids), "missing": missing_components},
        ),
        gate(
            "handoff_artifacts_present",
            existing(package_root, dxf_package) and existing(package_root, contact_sheet) and existing(package_root, report_rel),
            {"dxf_package": dxf_package, "contact_sheet": contact_sheet, "review_report": report_rel},
        ),
        gate("component_builds_passed", bool(normalized.get("component_builds_passed")), {"value": normalized.get("component_builds_passed")}),
        gate("strict_machine_qa_passed", bool(normalized.get("strict_machine_qa_passed")), {"value": normalized.get("strict_machine_qa_passed")}),
        gate(
            "all_qa_targets_passed",
            int(qa.get("target_count") or 0) >= 13
            and int(qa.get("passed_count") or 0) == int(qa.get("target_count") or 0)
            and int(qa.get("failure_count") or 0) == 0,
            {"target_count": qa.get("target_count"), "passed_count": qa.get("passed_count"), "failure_count": qa.get("failure_count")},
        ),
        gate(
            "zero_machine_warnings",
            int(qa.get("warning_count") or 0) == 0,
            {
                "warning_count": qa.get("warning_count"),
                "production_warning_count": qa.get("production_warning_count"),
                "companion_or_stress_warning_count": qa.get("companion_or_stress_warning_count"),
            },
        ),
        gate(
            "zero_machine_reversals_and_micro_segments",
            int(qa.get("reversal_turn_count") or 0) == 0
            and int(qa.get("micro_segment_count") or 0) == 0
            and int(qa.get("tiny_closed_loop_count") or 0) == 0,
            {
                "reversal_turn_count": qa.get("reversal_turn_count"),
                "micro_segment_count": qa.get("micro_segment_count"),
                "tiny_closed_loop_count": qa.get("tiny_closed_loop_count"),
            },
        ),
        gate(
            "seam_joins_golden_clean",
            int(seam.get("checked_target_count") or 0) >= 4
            and int(seam.get("flagged_target_count") or 0) == 0
            and float(seam.get("max_start_end_y_delta") or 0.0) <= 0.001
            and float(seam.get("max_seam_tangent_delta_degrees") or 999.0) <= max_golden_tangent_delta,
            {
                "checked_target_count": seam.get("checked_target_count"),
                "flagged_target_count": seam.get("flagged_target_count"),
                "max_start_end_y_delta": seam.get("max_start_end_y_delta"),
                "max_seam_tangent_delta_degrees": seam.get("max_seam_tangent_delta_degrees"),
                "max_allowed_tangent_delta_degrees": max_golden_tangent_delta,
            },
        ),
        gate(
            "stitch_flow_overlays_complete",
            int(flow.get("target_count") or 0) >= 13
            and int(flow.get("overlay_count") or 0) == int(flow.get("target_count") or 0)
            and int(flow.get("missing_overlay_count") or 0) == 0,
            {
                "target_count": flow.get("target_count"),
                "overlay_count": flow.get("overlay_count"),
                "missing_overlay_count": flow.get("missing_overlay_count"),
                "missing_targets": flow.get("missing_targets"),
            },
        ),
        gate(
            "art_critique_golden_score",
            bool(art.get("passes"))
            and float(art.get("score") or 0.0) >= min_art_score
            and int(art.get("warning_count") or 0) == 0
            and int(art.get("failure_count") or 0) == 0,
            {
                "score": art.get("score"),
                "minimum_score": min_art_score,
                "warning_count": art.get("warning_count"),
                "failure_count": art.get("failure_count"),
            },
        ),
        gate(
            "motif_hierarchy_present",
            int(focal.get("motif_count") or 0) >= max_support_motif_count
            and int(focal.get("motif_count") or 0) >= 5
            and not support_without_omissions,
            {
                "focal_motif_count": focal.get("motif_count"),
                "max_support_motif_count": max_support_motif_count,
                "support_components_without_omissions": support_without_omissions,
            },
        ),
        gate(
            "role_aware_density_review_clean",
            bool(normalized.get("role_aware_balance_passed")) and not review_flags,
            {"role_aware_balance_passed": normalized.get("role_aware_balance_passed"), "review_flags": review_flags},
        ),
        gate(
            "regression_comparison_clean",
            bool(regression.get("available")) and bool(regression.get("passes")) and not as_list(regression.get("regressions")),
            {
                "available": regression.get("available"),
                "passes": regression.get("passes"),
                "winner": regression.get("winner"),
                "regression_count": len(as_list(regression.get("regressions"))),
                "improvements": as_list(regression.get("improvements")),
            },
        ),
    ]

    passed_count = sum(1 for item in gates if item["passes"])
    total_count = len(gates)
    return {
        "package_root": str(package_root),
        "manifest": str(manifest_path),
        "suite_reference": str(GOLDEN_SUITE_PATH),
        "passes": passed_count == total_count,
        "score": round(100.0 * passed_count / max(1, total_count), 2),
        "passed_gate_count": passed_count,
        "gate_count": total_count,
        "failed_gates": [item for item in gates if not item["passes"]],
        "gates": gates,
        "human_review_required": True,
        "human_review_note": (
            "This check validates measurable golden gates only. Compare the contact sheet against "
            "references/golden-acceptance-suite.md for visual intentionality, then machine-test before publication."
        ),
        "copyright_note": (
            "The golden suite is a benchmark list. Do not copy, trace, vectorize, or closely imitate referenced quilts."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", help="Native coordinate package directory or manifest JSON.")
    parser.add_argument("--out", help="Optional JSON report path.")
    parser.add_argument("--min-art-score", type=float, default=95.0)
    parser.add_argument("--max-golden-tangent-delta", type=float, default=10.0)
    args = parser.parse_args()

    package_path = Path(args.package).resolve()
    package_root = package_path.parent if package_path.is_file() else package_path
    report = build_report(package_root, args.min_art_score, args.max_golden_tangent_delta)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    status = "PASS" if report["passes"] else "FAIL"
    print(f"{status} golden acceptance: {report['passed_gate_count']}/{report['gate_count']} gates, score {report['score']}")
    if report["failed_gates"]:
        for item in report["failed_gates"]:
            print(f"- {item['name']}: {json.dumps(item['details'], sort_keys=True)}")
    if args.out:
        print(f"Report: {args.out}")
    return 0 if report["passes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
