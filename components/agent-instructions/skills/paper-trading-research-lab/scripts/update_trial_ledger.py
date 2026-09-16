#!/usr/bin/env python3
"""Append a trial entry to a JSONL research ledger."""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROMOTION_STATUSES = [
    "reject",
    "research_more",
    "paper_trade",
    "pause",
    "promote_to_review",
]

REQUIRED_LEDGER_FIELDS = [
    "timestamp",
    "strategy_id",
    "edge_family",
    "base_rate_prior_score",
    "discovery_budget",
    "data_version",
    "universe_version",
    "parameter_set",
    "trial_family",
    "train_period",
    "validation_period",
    "test_period",
    "number_of_trials_so_far",
    "promotion_status",
]


def git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True
        ).strip()
    except Exception:
        return None


def load_json(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def json_object(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise argparse.ArgumentTypeError(f"invalid JSON object: {exc}") from exc
    if not isinstance(parsed, dict):
        raise argparse.ArgumentTypeError("value must be a JSON object")
    return parsed


def key_value(value: str) -> tuple[str, Any]:
    key, separator, raw_value = value.partition("=")
    if not separator or not key:
        raise argparse.ArgumentTypeError("expected KEY=VALUE")
    try:
        parsed_value: Any = json.loads(raw_value)
    except json.JSONDecodeError:
        parsed_value = raw_value
    return key, parsed_value


def merged_object(base: dict[str, Any] | None, pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    merged = dict(base or {})
    for key, value in pairs:
        merged[key] = value
    return merged


def ledger_entries(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
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


def first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", {}, []):
            return value
    return None


def discovery_budget_from(card: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    card_budget = card.get("discovery_budget")
    if isinstance(card_budget, dict) and card_budget:
        return card_budget
    max_variants = manifest.get("max_variants_this_run")
    if isinstance(max_variants, int) and max_variants >= 0:
        return {
            "max_variants": max_variants,
            "max_data_versions": 1,
            "max_universes": 1,
            "source": "manifest",
        }
    return {}


def build_entry(args: argparse.Namespace) -> dict[str, Any]:
    explicit = load_json(args.entry)
    card = load_json(args.strategy_card)
    manifest = load_json(args.manifest)

    ledger_path = args.ledger
    existing_entries = ledger_entries(ledger_path)
    strategy_id = first_present(
        args.strategy_id,
        explicit.get("strategy_id"),
        card.get("strategy_id"),
        manifest.get("strategy_id"),
    )
    existing_for_strategy = [
        entry for entry in existing_entries if entry.get("strategy_id") == strategy_id
    ]

    parameter_set = merged_object(args.parameter_set_json, args.parameter)
    if not parameter_set and isinstance(explicit.get("parameter_set"), dict):
        parameter_set = explicit["parameter_set"]
    if not parameter_set and isinstance(manifest.get("parameter_bounds"), dict):
        parameter_set = {"bounds_tested": manifest["parameter_bounds"]}

    entry = {
        **explicit,
        "timestamp": first_present(
            args.timestamp,
            explicit.get("timestamp"),
            datetime.now(timezone.utc).isoformat(),
        ),
        "strategy_id": strategy_id,
        "hypothesis_id": first_present(args.hypothesis_id, explicit.get("hypothesis_id")),
        "edge_family": first_present(
            args.edge_family,
            explicit.get("edge_family"),
            card.get("edge_family"),
            manifest.get("edge_family"),
        ),
        "base_rate_prior_score": first_present(
            args.base_rate_prior_score,
            explicit.get("base_rate_prior_score"),
            card.get("base_rate_prior_score"),
            manifest.get("base_rate_prior_score"),
        ),
        "discovery_budget": first_present(
            args.discovery_budget_json,
            explicit.get("discovery_budget"),
            discovery_budget_from(card, manifest),
        ),
        "git_commit": first_present(args.git_commit, explicit.get("git_commit"), git_commit()),
        "data_version": first_present(
            args.data_version,
            explicit.get("data_version"),
            manifest.get("data_version"),
        ),
        "universe_version": first_present(
            args.universe_version,
            explicit.get("universe_version"),
            card.get("universe_version"),
            manifest.get("asset_universe"),
            "unspecified",
        ),
        "parameter_set": parameter_set,
        "trial_family": first_present(
            args.trial_family,
            explicit.get("trial_family"),
            card.get("trial_family"),
        ),
        "train_period": first_present(
            args.train_period,
            explicit.get("train_period"),
            (card.get("validation_plan") or {}).get("train_period")
            if isinstance(card.get("validation_plan"), dict)
            else None,
        ),
        "validation_period": first_present(
            args.validation_period,
            explicit.get("validation_period"),
            (card.get("validation_plan") or {}).get("validation_period")
            if isinstance(card.get("validation_plan"), dict)
            else None,
        ),
        "test_period": first_present(
            args.test_period,
            explicit.get("test_period"),
            (card.get("validation_plan") or {}).get("test_period")
            if isinstance(card.get("validation_plan"), dict)
            else None,
        ),
        "number_of_trials_so_far": first_present(
            args.number_of_trials_so_far,
            explicit.get("number_of_trials_so_far"),
            len(existing_for_strategy) + 1,
        ),
        "in_sample_metrics": first_present(
            merged_object(args.in_sample_metrics_json, args.in_sample_metric),
            explicit.get("in_sample_metrics"),
            {},
        ),
        "out_of_sample_metrics": first_present(
            merged_object(args.out_of_sample_metrics_json, args.out_of_sample_metric),
            explicit.get("out_of_sample_metrics"),
            {},
        ),
        "negative_control_results": first_present(
            merged_object(args.negative_control_results_json, args.negative_control_result),
            explicit.get("negative_control_results"),
            {},
        ),
        "simulation_integrity_summary": first_present(
            merged_object(args.simulation_integrity_json, args.simulation_integrity),
            explicit.get("simulation_integrity_summary"),
            {},
        ),
        "friction_capacity_summary": first_present(
            merged_object(args.friction_capacity_json, args.friction_capacity),
            explicit.get("friction_capacity_summary"),
            {},
        ),
        "portfolio_contribution_summary": first_present(
            merged_object(args.portfolio_contribution_json, args.portfolio_contribution),
            explicit.get("portfolio_contribution_summary"),
            {},
        ),
        "promotion_status": first_present(
            args.promotion_status,
            explicit.get("promotion_status"),
            "research_more",
        ),
        "rejection_reason": first_present(
            args.rejection_reason,
            explicit.get("rejection_reason"),
        ),
    }
    return {key: value for key, value in entry.items() if value is not None}


def validate_entry(entry: dict[str, Any]) -> list[str]:
    missing = [
        field
        for field in REQUIRED_LEDGER_FIELDS
        if field not in entry or entry[field] in (None, "", {}, [])
    ]
    status = entry.get("promotion_status")
    if status not in PROMOTION_STATUSES:
        missing.append(
            "promotion_status must be one of " + ", ".join(PROMOTION_STATUSES)
        )
    if entry.get("promotion_status") == "reject" and not entry.get("rejection_reason"):
        missing.append("rejection_reason is required when promotion_status is reject")
    return missing


def append_jsonl(path: Path, entry: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, sort_keys=True))
        handle.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--entry", type=Path, help="Existing JSON entry to append")
    parser.add_argument("--strategy-card", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--timestamp")
    parser.add_argument("--strategy-id")
    parser.add_argument("--hypothesis-id")
    parser.add_argument("--edge-family")
    parser.add_argument("--base-rate-prior-score", type=int)
    parser.add_argument("--discovery-budget-json", type=json_object)
    parser.add_argument("--git-commit")
    parser.add_argument("--data-version")
    parser.add_argument("--universe-version")
    parser.add_argument("--trial-family")
    parser.add_argument("--train-period")
    parser.add_argument("--validation-period")
    parser.add_argument("--test-period")
    parser.add_argument("--number-of-trials-so-far", type=int)
    parser.add_argument("--promotion-status", choices=PROMOTION_STATUSES)
    parser.add_argument("--rejection-reason")
    parser.add_argument("--parameter-set-json", type=json_object)
    parser.add_argument("--in-sample-metrics-json", type=json_object)
    parser.add_argument("--out-of-sample-metrics-json", type=json_object)
    parser.add_argument("--negative-control-results-json", type=json_object)
    parser.add_argument("--simulation-integrity-json", type=json_object)
    parser.add_argument("--friction-capacity-json", type=json_object)
    parser.add_argument("--portfolio-contribution-json", type=json_object)
    parser.add_argument("--parameter", type=key_value, action="append", default=[])
    parser.add_argument("--in-sample-metric", type=key_value, action="append", default=[])
    parser.add_argument("--out-of-sample-metric", type=key_value, action="append", default=[])
    parser.add_argument("--negative-control-result", type=key_value, action="append", default=[])
    parser.add_argument("--simulation-integrity", type=key_value, action="append", default=[])
    parser.add_argument("--friction-capacity", type=key_value, action="append", default=[])
    parser.add_argument("--portfolio-contribution", type=key_value, action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    entry = build_entry(args)
    missing = validate_entry(entry)
    if missing:
        print("Ledger entry is incomplete:")
        for field in missing:
            print(f"- {field}")
        raise SystemExit(2)

    if args.dry_run:
        print(json.dumps(entry, indent=2, sort_keys=True))
        return

    append_jsonl(args.ledger, entry)
    print(f"Appended trial {entry['number_of_trials_so_far']} to {args.ledger}")


if __name__ == "__main__":
    main()
