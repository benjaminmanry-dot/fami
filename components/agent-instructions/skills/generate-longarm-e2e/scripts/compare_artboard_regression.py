#!/usr/bin/env python3
"""Compare a candidate coordinate art board against a previous benchmark."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_artifact(root: Path, names: list[str]) -> dict:
    if root.is_file():
        return load_json(root)
    for name in names:
        data = load_json(root / name)
        if data:
            return data
    return {}


def audit_metrics(audit: dict) -> dict:
    occ = audit.get("occupancy") or {}
    return {
        "passes": bool(audit.get("passes", False)),
        "shape_count": audit.get("shape_count", 0),
        "layer_count": audit.get("layer_count", 0),
        "total_drawn_length": audit.get("total_drawn_length", 0),
        "overall_occupancy": occ.get("overall", 0),
        "focal_occupancy": occ.get("focal", 0),
        "weakest_border_occupancy": min(
            [
                occ.get("top_border", 0),
                occ.get("bottom_border", 0),
                occ.get("left_border", 0),
                occ.get("right_border", 0),
            ]
            or [0]
        ),
    }


def style_metrics(style: dict) -> dict:
    stamped = ((style.get("metrics") or {}).get("stamped_repetition") or {})
    regularity = ((style.get("metrics") or {}).get("center_regularity") or {})
    return {
        "passes": bool(style.get("passes", False)) if style else None,
        "score": style.get("score"),
        "warning_count": len(style.get("warnings", [])) if style else None,
        "failure_count": len(style.get("failures", [])) if style else None,
        "stamped_ratio": stamped.get("stamped_ratio"),
        "regularity_ratio": regularity.get("regularity_ratio"),
    }


def machine_metrics(machine: dict) -> dict:
    metrics = machine.get("metrics") or {}
    return {
        "passes": bool(machine.get("passes", False)) if machine else None,
        "micro_segment_count": metrics.get("micro_segment_count"),
        "reversal_turn_count": metrics.get("reversal_turn_count"),
        "tiny_closed_loop_count": metrics.get("tiny_closed_loop_count"),
    }


def delta(candidate: dict, baseline: dict) -> dict:
    result: dict[str, float] = {}
    for key, value in candidate.items():
        base = baseline.get(key)
        if isinstance(value, bool) or isinstance(base, bool):
            continue
        if isinstance(value, (int, float)) and isinstance(base, (int, float)):
            result[key] = round(value - base, 4)
    return result


def compare(candidate_root: Path, baseline_root: Path | None) -> dict:
    candidate_audit = resolve_artifact(candidate_root, ["artboard-audit.json"])
    candidate_style = resolve_artifact(candidate_root, ["style-critique.json"])
    candidate_machine = resolve_artifact(candidate_root, ["machine-qa.json"])

    baseline_audit = resolve_artifact(baseline_root, ["artboard-audit.json"]) if baseline_root else {}
    baseline_style = resolve_artifact(baseline_root, ["style-critique.json"]) if baseline_root else {}
    baseline_machine = resolve_artifact(baseline_root, ["machine-qa.json"]) if baseline_root else {}

    candidate = {
        "audit": audit_metrics(candidate_audit),
        "style": style_metrics(candidate_style),
        "machine": machine_metrics(candidate_machine),
    }
    baseline = {
        "audit": audit_metrics(baseline_audit),
        "style": style_metrics(baseline_style),
        "machine": machine_metrics(baseline_machine),
    }

    regressions: list[str] = []
    improvements: list[str] = []

    if not candidate["audit"]["passes"]:
        regressions.append("Candidate art-board audit does not pass.")
    if candidate["style"]["passes"] is False:
        regressions.append("Candidate style critique does not pass.")
    if candidate["machine"]["passes"] is False:
        regressions.append("Candidate machine QA does not pass.")

    if baseline_audit:
        audit_delta = delta(candidate["audit"], baseline["audit"])
        if audit_delta.get("focal_occupancy", 0) < -0.04:
            regressions.append("Candidate focal occupancy dropped materially from the baseline.")
        if audit_delta.get("weakest_border_occupancy", 0) < -0.035:
            regressions.append("Candidate weakest border occupancy dropped materially from the baseline.")
        if audit_delta.get("shape_count", 0) > 50:
            improvements.append("Candidate adds meaningful art-board complexity.")
        if audit_delta.get("total_drawn_length", 0) > 30:
            improvements.append("Candidate adds meaningful drawn-line development.")
        if audit_delta.get("focal_occupancy", 0) > 0.03:
            improvements.append("Candidate improves focal development.")
    else:
        audit_delta = {}

    if baseline_style and candidate_style:
        style_delta = delta(candidate["style"], baseline["style"])
        if style_delta.get("score", 0) < -5:
            regressions.append("Candidate style score regressed by more than five points.")
        if style_delta.get("stamped_ratio", 0) > 0.08:
            regressions.append("Candidate has more obvious stamped repetition than the baseline.")
        if style_delta.get("score", 0) > 4:
            improvements.append("Candidate style score improves on the baseline.")
    else:
        style_delta = {}

    if baseline_machine and candidate_machine:
        machine_delta = delta(candidate["machine"], baseline["machine"])
        if machine_delta.get("micro_segment_count", 0) > 10:
            regressions.append("Candidate introduces more micro-segment machine risk.")
        if machine_delta.get("micro_segment_count", 0) < 0:
            improvements.append("Candidate reduces micro-segment machine risk.")
    else:
        machine_delta = {}

    winner = "candidate"
    if regressions:
        winner = "needs-review"
    elif baseline_style and candidate_style:
        cand_score = candidate["style"].get("score") or 0
        base_score = baseline["style"].get("score") or 0
        if cand_score < base_score:
            winner = "baseline"
        elif cand_score == base_score:
            winner = "tie"

    return {
        "passes": winner in {"candidate", "tie"},
        "winner": winner,
        "regressions": regressions,
        "improvements": improvements,
        "candidate": candidate,
        "baseline": baseline if baseline_root else None,
        "deltas": {
            "audit": audit_delta,
            "style": style_delta,
            "machine": machine_delta,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", required=True, help="Candidate output directory or JSON artifact.")
    parser.add_argument("--baseline", help="Optional baseline output directory or JSON artifact.")
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
