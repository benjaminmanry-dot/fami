#!/usr/bin/env python3
"""Validate a strategy card and compute its base-rate prior score."""

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

REQUIRED_FIELDS = [
    "strategy_id",
    "edge_family",
    "hypothesis",
    "edge_rationale",
    "persistence_reason",
    "decay_or_crowding_risk",
    "market_universe_fit",
    "data_required",
    "execution_feasibility",
    "expected_capacity",
    "benchmark",
    "baseline_strategies",
    "entry_signal",
    "exit_signal",
    "universe_filter",
    "position_sizing_rule",
    "rebalancing_rule",
    "expected_failure_modes",
    "parameter_search_bounds",
    "discovery_budget",
    "stopping_rule",
    "trial_family",
    "negative_controls",
    "simulation_integrity_tests",
    "validation_plan",
    "promotion_gates",
    "prior_scores",
]

NONEMPTY_LIST_FIELDS = [
    "data_required",
    "baseline_strategies",
    "expected_failure_modes",
    "negative_controls",
    "simulation_integrity_tests",
    "promotion_gates",
]


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")


def score_verdict(score: int) -> str:
    if score <= 8:
        return "reject_before_backtesting"
    if score <= 15:
        return "low_priority_exploratory"
    if score <= 21:
        return "eligible_for_small_validation_budget"
    return "strong_candidate_for_disciplined_research_pass"


def validate_card(card: dict[str, Any]) -> tuple[list[str], list[str]]:
    missing: list[str] = []
    invalid: list[str] = []

    for field in REQUIRED_FIELDS:
        if field not in card or card[field] in (None, "", {}):
            missing.append(field)

    for field in NONEMPTY_LIST_FIELDS:
        value = card.get(field)
        if not isinstance(value, list) or not value:
            invalid.append(f"{field} must be a non-empty list")

    prior_scores = card.get("prior_scores")
    if not isinstance(prior_scores, dict):
        invalid.append("prior_scores must be an object")
        return missing, invalid

    for field in PRIOR_FIELDS:
        value = prior_scores.get(field)
        if value is None:
            missing.append(f"prior_scores.{field}")
            continue
        if not isinstance(value, int) or value < 0 or value > 3:
            invalid.append(f"prior_scores.{field} must be an integer from 0 to 3")

    discovery_budget = card.get("discovery_budget")
    if isinstance(discovery_budget, dict):
        max_variants = discovery_budget.get("max_variants")
        if not isinstance(max_variants, int) or max_variants < 0:
            invalid.append("discovery_budget.max_variants must be a non-negative integer")
    elif discovery_budget is not None:
        invalid.append("discovery_budget must be an object")

    return missing, invalid


def build_result(card: dict[str, Any]) -> dict[str, Any]:
    missing, invalid = validate_card(card)
    prior_scores = card.get("prior_scores") if isinstance(card.get("prior_scores"), dict) else {}
    score = sum(
        value
        for key, value in prior_scores.items()
        if key in PRIOR_FIELDS and isinstance(value, int)
    )
    verdict = score_verdict(score)
    recorded_score = card.get("base_rate_prior_score")
    recorded_score_matches = recorded_score in (None, score)

    if recorded_score is not None and recorded_score != score:
        invalid.append(
            f"base_rate_prior_score is {recorded_score}, but prior_scores sum to {score}"
        )

    return {
        "strategy_id": card.get("strategy_id", "unspecified"),
        "edge_family": card.get("edge_family", "unspecified"),
        "base_rate_prior_score": score,
        "max_score": 27,
        "base_rate_prior_verdict": verdict,
        "recorded_score_matches": recorded_score_matches,
        "missing_fields": missing,
        "invalid_fields": invalid,
        "passed_required_checks": not missing and not invalid,
    }


def print_human(result: dict[str, Any]) -> None:
    print(f"Strategy: {result['strategy_id']}")
    print(f"Edge family: {result['edge_family']}")
    print(
        "Base-rate prior score: "
        f"{result['base_rate_prior_score']}/{result['max_score']}"
    )
    print(f"Verdict: {result['base_rate_prior_verdict']}")
    if result["missing_fields"]:
        print("\nMissing fields:")
        for field in result["missing_fields"]:
            print(f"- {field}")
    if result["invalid_fields"]:
        print("\nInvalid fields:")
        for field in result["invalid_fields"]:
            print(f"- {field}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("strategy_card", type=Path)
    parser.add_argument("--out", type=Path, help="Write the scoring result as JSON")
    parser.add_argument(
        "--write-back",
        action="store_true",
        help="Write computed score and verdict back to the strategy card",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON instead of text")
    args = parser.parse_args()

    card = load_json(args.strategy_card)
    result = build_result(card)

    if args.write_back:
        card["base_rate_prior_score"] = result["base_rate_prior_score"]
        card["base_rate_prior_verdict"] = result["base_rate_prior_verdict"]
        write_json(args.strategy_card, card)

    if args.out:
        write_json(args.out, result)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print_human(result)

    if not result["passed_required_checks"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
