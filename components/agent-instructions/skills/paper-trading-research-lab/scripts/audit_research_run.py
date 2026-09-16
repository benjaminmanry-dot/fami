#!/usr/bin/env python3
"""Audit a paper-trading research run for missing controls and artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


PRIOR_FIELDS = [
    "rationale_strength",
    "evidence_quality",
    "market_fit",
    "data_feasibility",
    "execution_feasibility",
    "robustness_expectation",
    "decay_and_crowding_risk",
    "portfolio_distinctness",
    "simplicity",
]

CANDIDATE_INTAKE_REQUIRED = [
    "candidate_id",
    "edge_family",
    "hypothesis",
    "edge_rationale",
    "exploratory_budget",
    "fastest_falsification_test",
    "non_promotable_until_full_strategy_card",
]

STRATEGY_CARD_REQUIRED = [
    "strategy_id",
    "edge_family",
    "hypothesis",
    "edge_rationale",
    "discovery_budget",
    "trial_family",
    "negative_controls",
    "simulation_integrity_tests",
    "validation_plan",
    "promotion_gates",
    "prior_scores",
    "base_rate_prior_score",
]

MANIFEST_REQUIRED = [
    "strategy_id",
    "edge_family",
    "edge_rationale",
    "data_version",
    "max_variants_this_run",
    "negative_controls",
    "simulation_integrity_tests",
    "multiple_testing_methods",
    "portfolio_checks",
    "promotion_gates",
]

LEDGER_REQUIRED = [
    "strategy_id",
    "edge_family",
    "base_rate_prior_score",
    "discovery_budget",
    "data_version",
    "universe_version",
    "parameter_set",
    "trial_family",
    "number_of_trials_so_far",
    "promotion_status",
]

ARTIFACT_PATTERNS = {
    "exploration": ["candidate_intake"],
    "discovery": ["strategy_card", "manifest"],
    "backtest": ["data_audit", "friction", "backtest"],
    "validation": ["validation", "negative", "simulation_integrity", "parameter_stability"],
    "promotion": [
        "validation",
        "negative",
        "simulation_integrity",
        "parameter_stability",
        "portfolio",
    ],
    "paper": ["paper"],
}

FULL_CARD_STAGES = {"discovery", "backtest", "validation", "promotion", "paper"}
FULL_MANIFEST_STAGES = {"backtest", "validation", "promotion", "paper"}
LEDGER_REQUIRED_STAGES = {"backtest", "validation", "promotion", "paper"}
SIMULATION_HARD_GATE_STAGES = {"promotion", "paper"}


def load_json(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def load_jsonl(path: Path | None) -> list[dict[str, Any]]:
    if path is None or not path.exists():
        return []
    entries: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for index, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{index} is invalid JSONL: {exc}") from exc
            if not isinstance(parsed, dict):
                raise ValueError(f"{path}:{index} must be a JSON object")
            entries.append(parsed)
    return entries


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")


def find_simulation_integrity_report(
    explicit_path: Path | None, artifacts_dir: Path | None
) -> Path | None:
    if explicit_path is not None:
        return explicit_path
    if artifacts_dir is None or not artifacts_dir.exists():
        return None
    exact = artifacts_dir / "simulation_integrity.json"
    if exact.exists():
        return exact
    matches = sorted(artifacts_dir.rglob("*simulation_integrity*.json"))
    return matches[0] if matches else None


def missing_fields(data: dict[str, Any], required: list[str]) -> list[str]:
    return [field for field in required if data.get(field) in (None, "", {}, [])]


def score_prior(card: dict[str, Any]) -> int | None:
    prior_scores = card.get("prior_scores")
    if not isinstance(prior_scores, dict):
        return None
    values = []
    for field in PRIOR_FIELDS:
        value = prior_scores.get(field)
        if not isinstance(value, int):
            return None
        values.append(value)
    return sum(values)


def audit_candidate_intake(intake: dict[str, Any]) -> tuple[list[str], list[str]]:
    issues: list[str] = []
    warnings: list[str] = []
    missing = missing_fields(intake, CANDIDATE_INTAKE_REQUIRED)
    issues.extend(f"candidate_intake missing {field}" for field in missing)

    budget = intake.get("exploratory_budget")
    if isinstance(budget, dict):
        max_variants = budget.get("max_variants")
        if not isinstance(max_variants, int) or max_variants < 0:
            issues.append("candidate_intake exploratory_budget.max_variants is invalid")
    elif budget is not None:
        issues.append("candidate_intake exploratory_budget must be an object")

    if intake.get("non_promotable_until_full_strategy_card") is not True:
        issues.append("candidate_intake must be explicitly non-promotable")

    if not intake.get("known_blockers"):
        warnings.append("candidate_intake has no known_blockers listed")

    return issues, warnings


def stage_patterns(stage: str) -> list[str]:
    if stage == "exploration":
        return ARTIFACT_PATTERNS["exploration"]
    if stage == "discovery":
        return ARTIFACT_PATTERNS["discovery"]
    if stage == "backtest":
        return ARTIFACT_PATTERNS["discovery"] + ARTIFACT_PATTERNS["backtest"]
    if stage == "validation":
        return (
            ARTIFACT_PATTERNS["discovery"]
            + ARTIFACT_PATTERNS["backtest"]
            + ARTIFACT_PATTERNS["validation"]
        )
    if stage == "promotion":
        return (
            ARTIFACT_PATTERNS["discovery"]
            + ARTIFACT_PATTERNS["backtest"]
            + ARTIFACT_PATTERNS["promotion"]
        )
    return (
        ARTIFACT_PATTERNS["discovery"]
        + ARTIFACT_PATTERNS["backtest"]
        + ARTIFACT_PATTERNS["validation"]
        + ARTIFACT_PATTERNS["paper"]
    )


def artifact_inventory(path: Path | None) -> list[str]:
    if path is None or not path.exists():
        return []
    return [
        item.name.lower()
        for item in path.rglob("*")
        if item.is_file() and not item.name.startswith(".")
    ]


def audit_strategy_card(card: dict[str, Any]) -> tuple[list[str], list[str]]:
    issues: list[str] = []
    warnings: list[str] = []
    missing = missing_fields(card, STRATEGY_CARD_REQUIRED)
    issues.extend(f"strategy_card missing {field}" for field in missing)

    computed_score = score_prior(card)
    recorded_score = card.get("base_rate_prior_score")
    if computed_score is None:
        issues.append("strategy_card prior_scores are incomplete or non-integer")
    elif recorded_score != computed_score:
        issues.append(
            "strategy_card base_rate_prior_score does not match prior_scores "
            f"({recorded_score} != {computed_score})"
        )
    elif computed_score <= 15:
        warnings.append(
            f"base-rate prior score is low ({computed_score}); keep the budget small"
        )

    negative_controls = card.get("negative_controls")
    if isinstance(negative_controls, list) and len(negative_controls) < 2:
        warnings.append("strategy_card has fewer than two negative controls")

    simulation_integrity_tests = card.get("simulation_integrity_tests")
    if isinstance(simulation_integrity_tests, list) and len(simulation_integrity_tests) < 3:
        issues.append("strategy_card has too few simulation_integrity_tests")

    validation_plan = card.get("validation_plan")
    if isinstance(validation_plan, dict):
        for field in ["multiple_testing_adjustment", "cost_sensitivity"]:
            if not validation_plan.get(field):
                issues.append(f"validation_plan missing {field}")

    return issues, warnings


def audit_manifest(manifest: dict[str, Any]) -> tuple[list[str], list[str]]:
    issues = [
        f"manifest missing {field}" for field in missing_fields(manifest, MANIFEST_REQUIRED)
    ]
    warnings: list[str] = []
    max_variants = manifest.get("max_variants_this_run")
    if isinstance(max_variants, int) and max_variants == 0:
        warnings.append("manifest max_variants_this_run is 0")
    return issues, warnings


def audit_simulation_integrity(
    report_path: Path | None, stage: str
) -> tuple[list[str], list[str], dict[str, Any]]:
    issues: list[str] = []
    warnings: list[str] = []
    report: dict[str, Any] = {}
    hard_gate = stage in SIMULATION_HARD_GATE_STAGES

    if report_path is None:
        if stage == "exploration":
            return issues, warnings, report
        if hard_gate:
            issues.append("simulation_integrity.json is required for promotion and paper stages")
        else:
            warnings.append("simulation_integrity.json is missing")
        return issues, warnings, report

    if not report_path.exists():
        message = f"simulation integrity report does not exist: {report_path}"
        if hard_gate:
            issues.append(message)
        else:
            warnings.append(message)
        return issues, warnings, report

    report = load_json(report_path)
    status = report.get("status")
    if status != "pass":
        message = f"simulation integrity status is {status!r}, expected 'pass'"
        if hard_gate:
            issues.append(message)
        else:
            warnings.append(message)

    if hard_gate and report.get("strategy_results_supplied") is not True:
        issues.append("simulation integrity report lacks strategy-result controls")
    elif stage == "validation" and report.get("strategy_results_supplied") is not True:
        warnings.append("simulation integrity report lacks strategy-result controls")

    tests = report.get("tests")
    if not isinstance(tests, list) or not tests:
        message = "simulation integrity report has no tests"
        if hard_gate:
            issues.append(message)
        else:
            warnings.append(message)
    elif len(tests) < 8:
        warnings.append("simulation integrity report has fewer tests than expected")

    if isinstance(tests, list):
        failed_tests = [
            test.get("name", "unnamed")
            for test in tests
            if isinstance(test, dict) and test.get("status") == "fail"
        ]
        warning_tests = [
            test.get("name", "unnamed")
            for test in tests
            if isinstance(test, dict) and test.get("status") == "warn"
        ]
        if hard_gate:
            issues.extend(f"simulation integrity failed: {name}" for name in failed_tests)
        else:
            warnings.extend(f"simulation integrity failed: {name}" for name in failed_tests)
        warnings.extend(f"simulation integrity warning: {name}" for name in warning_tests)

    return issues, warnings, report


def audit_ledger(
    entries: list[dict[str, Any]],
    strategy_id: str | None,
    max_variants: int | None,
    stage: str,
) -> tuple[list[str], list[str], list[dict[str, Any]]]:
    issues: list[str] = []
    warnings: list[str] = []
    if not entries:
        if stage == "exploration":
            return issues, warnings, []
        message = "trial ledger is missing or empty"
        if stage in LEDGER_REQUIRED_STAGES:
            issues.append(message)
        else:
            warnings.append(message)
        return issues, warnings, []

    matching = [
        entry for entry in entries if strategy_id is None or entry.get("strategy_id") == strategy_id
    ]
    if not matching:
        message = f"trial ledger has no entries for strategy_id {strategy_id}"
        if stage in LEDGER_REQUIRED_STAGES:
            issues.append(message)
        else:
            warnings.append(message)
        return issues, warnings, []

    for index, entry in enumerate(matching, start=1):
        for field in missing_fields(entry, LEDGER_REQUIRED):
            issues.append(f"ledger entry {index} missing {field}")
        if entry.get("promotion_status") == "reject" and not entry.get("rejection_reason"):
            issues.append(f"ledger entry {index} rejects without rejection_reason")
        if entry.get("promotion_status") in ("paper_trade", "promote_to_review"):
            if not entry.get("negative_control_results"):
                issues.append(f"ledger entry {index} promotes without negative controls")
            if not entry.get("friction_capacity_summary"):
                issues.append(f"ledger entry {index} promotes without friction/capacity")

    if isinstance(max_variants, int) and max_variants > 0 and len(matching) > max_variants:
        issues.append(
            f"trial ledger has {len(matching)} entries, exceeding max_variants {max_variants}"
        )

    trial_numbers = [
        entry.get("number_of_trials_so_far")
        for entry in matching
        if isinstance(entry.get("number_of_trials_so_far"), int)
    ]
    if trial_numbers and sorted(trial_numbers) != trial_numbers:
        warnings.append("trial numbers are not in ascending order")

    return issues, warnings, matching


def audit_artifacts(
    artifacts_dir: Path | None, stage: str
) -> tuple[list[str], list[str], list[str]]:
    warnings: list[str] = []
    issues: list[str] = []
    inventory = artifact_inventory(artifacts_dir)
    if artifacts_dir is None:
        warnings.append("no artifacts directory provided")
        return issues, warnings, inventory
    if not artifacts_dir.exists():
        issues.append(f"artifacts directory does not exist: {artifacts_dir}")
        return issues, warnings, inventory

    patterns = stage_patterns(stage)
    for pattern in patterns:
        if not any(pattern in name for name in inventory):
            message = f"missing artifact matching '{pattern}' for {stage} stage"
            if stage == "exploration" or (
                stage == "validation" and pattern == "simulation_integrity"
            ):
                warnings.append(message)
            else:
                issues.append(message)
    return issues, warnings, inventory


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strategy-card", type=Path)
    parser.add_argument("--candidate-intake", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--artifacts-dir", type=Path)
    parser.add_argument("--simulation-integrity-report", type=Path)
    parser.add_argument(
        "--stage",
        choices=["exploration", "discovery", "backtest", "validation", "promotion", "paper"],
        default="validation",
    )
    parser.add_argument("--out", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    intake = load_json(args.candidate_intake)
    card = load_json(args.strategy_card)
    manifest = load_json(args.manifest)
    entries = load_jsonl(args.ledger)

    strategy_id = (
        card.get("strategy_id")
        or intake.get("candidate_id")
        or manifest.get("strategy_id")
    )
    max_variants = None
    if isinstance(card.get("discovery_budget"), dict):
        max_variants = card["discovery_budget"].get("max_variants")
    if max_variants is None:
        max_variants = manifest.get("max_variants_this_run")

    issues: list[str] = []
    warnings: list[str] = []

    intake_issues: list[str] = []
    intake_warnings: list[str] = []
    card_issues: list[str] = []
    card_warnings: list[str] = []
    manifest_issues: list[str] = []
    manifest_warnings: list[str] = []

    if args.stage == "exploration":
        if intake:
            intake_issues, intake_warnings = audit_candidate_intake(intake)
        elif card:
            card_issues, card_warnings = audit_strategy_card(card)
        else:
            intake_issues.append("exploration requires candidate_intake.json or strategy_card.json")
    elif args.stage in FULL_CARD_STAGES:
        card_issues, card_warnings = audit_strategy_card(card)

    if args.stage in FULL_MANIFEST_STAGES:
        manifest_issues, manifest_warnings = audit_manifest(manifest)
    elif manifest:
        manifest_issues, manifest_warnings = audit_manifest(manifest)

    ledger_issues, ledger_warnings, matching_entries = audit_ledger(
        entries, strategy_id, max_variants, args.stage
    )
    artifact_issues, artifact_warnings, artifacts = audit_artifacts(
        args.artifacts_dir, args.stage
    )
    sim_report_path = find_simulation_integrity_report(
        args.simulation_integrity_report, args.artifacts_dir
    )
    sim_issues, sim_warnings, sim_report = audit_simulation_integrity(
        sim_report_path, args.stage
    )

    issues.extend(
        intake_issues
        + card_issues
        + manifest_issues
        + ledger_issues
        + artifact_issues
        + sim_issues
    )
    warnings.extend(
        intake_warnings
        + card_warnings
        + manifest_warnings
        + ledger_warnings
        + artifact_warnings
    )
    warnings.extend(sim_warnings)

    status = "pass"
    if issues:
        status = "fail"
    elif warnings:
        status = "warn"

    result = {
        "status": status,
        "stage": args.stage,
        "strategy_id": strategy_id,
        "issues": issues,
        "warnings": warnings,
        "ledger_entries_for_strategy": len(matching_entries),
        "simulation_integrity_report": str(sim_report_path) if sim_report_path else None,
        "simulation_integrity_status": sim_report.get("status"),
        "artifacts_seen": artifacts,
    }

    if args.out:
        write_json(args.out, result)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"Audit status: {status}")
        print(f"Strategy: {strategy_id or 'unspecified'}")
        print(f"Ledger entries: {len(matching_entries)}")
        if sim_report_path:
            print(f"Simulation integrity: {sim_report.get('status')} ({sim_report_path})")
        if issues:
            print("\nIssues:")
            for issue in issues:
                print(f"- {issue}")
        if warnings:
            print("\nWarnings:")
            for warning in warnings:
                print(f"- {warning}")

    if issues:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
