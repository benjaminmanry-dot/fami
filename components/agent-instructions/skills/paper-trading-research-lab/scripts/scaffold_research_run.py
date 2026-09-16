#!/usr/bin/env python3
"""Create a reproducible research-run manifest for a trading strategy candidate."""

from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def git_commit() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True
        ).strip()
    except Exception:
        return None


@dataclass
class ResearchRunManifest:
    created_at_utc: str
    strategy_id: str
    hypothesis: str
    edge_family: str
    edge_rationale: str
    asset_universe: str
    data_version: str
    git_commit: str | None
    mode: str = "research"
    candidate_source: str = "unspecified"
    evidence_sources: list[str] = field(default_factory=list)
    base_rate_prior_score: int | None = None
    trial_count_before_run: int = 0
    max_variants_this_run: int = 0
    parameter_bounds: dict[str, Any] = field(default_factory=dict)
    friction_assumptions: dict[str, Any] = field(default_factory=dict)
    assumptions: dict[str, Any] = field(default_factory=dict)
    negative_controls: list[str] = field(default_factory=list)
    simulation_integrity_tests: list[str] = field(default_factory=list)
    multiple_testing_methods: list[str] = field(default_factory=list)
    portfolio_checks: list[str] = field(default_factory=list)
    promotion_gates: list[str] = field(default_factory=list)


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strategy-id", required=True)
    parser.add_argument("--hypothesis", required=True)
    parser.add_argument("--edge-family", required=True)
    parser.add_argument("--edge-rationale", required=True)
    parser.add_argument("--candidate-source", default="unspecified")
    parser.add_argument("--evidence-source", action="append", default=[])
    parser.add_argument("--base-rate-prior-score", type=int)
    parser.add_argument("--asset-universe", default="unspecified")
    parser.add_argument("--data-version", default="unspecified")
    parser.add_argument("--trial-count-before-run", type=int, default=0)
    parser.add_argument("--max-variants-this-run", type=int, default=0)
    parser.add_argument("--parameter-bounds-json", type=json_object)
    parser.add_argument("--friction-assumptions-json", type=json_object)
    parser.add_argument("--assumptions-json", type=json_object)
    parser.add_argument("--parameter-bound", type=key_value, action="append", default=[])
    parser.add_argument("--friction-assumption", type=key_value, action="append", default=[])
    parser.add_argument("--assumption", type=key_value, action="append", default=[])
    parser.add_argument("--out", default="runs/manifest.json")
    args = parser.parse_args()

    manifest = ResearchRunManifest(
        created_at_utc=datetime.now(timezone.utc).isoformat(),
        strategy_id=args.strategy_id,
        hypothesis=args.hypothesis,
        edge_family=args.edge_family,
        edge_rationale=args.edge_rationale,
        asset_universe=args.asset_universe,
        data_version=args.data_version,
        git_commit=git_commit(),
        candidate_source=args.candidate_source,
        evidence_sources=args.evidence_source,
        base_rate_prior_score=args.base_rate_prior_score,
        trial_count_before_run=args.trial_count_before_run,
        max_variants_this_run=args.max_variants_this_run,
        parameter_bounds=merged_object(args.parameter_bounds_json, args.parameter_bound),
        friction_assumptions=merged_object(
            args.friction_assumptions_json, args.friction_assumption
        ),
        assumptions=merged_object(args.assumptions_json, args.assumption),
        negative_controls=[
            "Shuffled labels or returns",
            "Randomized signal direction",
            "Delayed signal",
            "Synthetic no-edge data where feasible",
        ],
        simulation_integrity_tests=[
            "No-edge synthetic market fixture",
            "Shuffled-label or shuffled-return placebo",
            "Look-ahead trap",
            "Corporate-action split fixture",
            "Order-timing next-bar fill fixture",
            "Known-edge baseline recovery where feasible",
        ],
        multiple_testing_methods=[
            "Deflated Sharpe Ratio when selecting among many variants",
            "PBO/CSCV or SPA/Reality Check when comparing broad model families",
        ],
        portfolio_checks=[
            "Correlation to benchmark and existing candidates",
            "Drawdown overlap",
            "Marginal risk-adjusted contribution",
            "Turnover and execution conflicts",
        ],
        promotion_gates=[
            "Plausible edge-family rationale and acceptable base-rate prior",
            "No known look-ahead or survivorship bias",
            "Positive out-of-sample expectancy after costs",
            "Robust to 2x estimated costs",
            "Drawdown within policy",
            "Parameter neighborhood stability",
            "Multiple-testing adjustment documented",
            "Negative controls fail as expected",
            "Acceptable marginal portfolio contribution if part of a portfolio",
        ],
    )

    output_path = Path(args.out)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(asdict(manifest), indent=2), encoding="utf-8")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
