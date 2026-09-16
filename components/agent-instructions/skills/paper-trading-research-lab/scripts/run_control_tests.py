#!/usr/bin/env python3
"""Run simulation-integrity diagnostics on synthetic market fixtures."""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any


REQUIRED_DATASETS = [
    "synthetic_manifest.json",
    "no_edge_daily.csv",
    "known_trend_daily.csv",
    "known_mean_reversion_daily.csv",
    "corporate_action_raw.csv",
    "corporate_action_adjusted.csv",
    "order_timing_fixture.csv",
]


def read_json(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
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


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def add_test(
    tests: list[dict[str, Any]],
    name: str,
    passed: bool,
    detail: str,
    *,
    severity: str = "blocker",
) -> None:
    tests.append(
        {
            "name": name,
            "status": "pass" if passed else ("warn" if severity == "warning" else "fail"),
            "severity": severity,
            "detail": detail,
        }
    )


def autocorrelation(values: list[float]) -> float | None:
    if len(values) < 3:
        return None
    left = values[:-1]
    right = values[1:]
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    left_den = math.sqrt(sum((x - left_mean) ** 2 for x in left))
    right_den = math.sqrt(sum((y - right_mean) ** 2 for y in right))
    if left_den == 0 or right_den == 0:
        return None
    return numerator / (left_den * right_den)


def close_returns(rows: list[dict[str, str]]) -> list[float]:
    by_symbol: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        by_symbol[row["symbol"]].append(row)
    returns: list[float] = []
    for symbol_rows in by_symbol.values():
        symbol_rows.sort(key=lambda item: item["date"])
        previous_close: float | None = None
        for row in symbol_rows:
            close = float(row["close"])
            if previous_close is not None and previous_close > 0:
                returns.append(math.log(close / previous_close))
            previous_close = close
    return returns


def max_abs_return(rows: list[dict[str, str]]) -> float:
    returns = close_returns(rows)
    return max((abs(item) for item in returns), default=0.0)


def assert_ohlc(rows: list[dict[str, str]], tests: list[dict[str, Any]], name: str) -> None:
    bad_rows = 0
    for row in rows:
        open_price = float(row["open"])
        high = float(row["high"])
        low = float(row["low"])
        close = float(row["close"])
        if high < max(open_price, close) or low > min(open_price, close) or low <= 0:
            bad_rows += 1
    add_test(
        tests,
        f"{name}_ohlc_sanity",
        bad_rows == 0,
        f"{bad_rows} impossible OHLC rows",
    )


def next_business_day(day: date) -> date:
    current = day + timedelta(days=1)
    while current.weekday() >= 5:
        current += timedelta(days=1)
    return current


def metric(section: dict[str, Any], *names: str) -> float | None:
    for name in names:
        value = section.get(name)
        if isinstance(value, (int, float)):
            return float(value)
    return None


def bool_metric(section: dict[str, Any], name: str) -> bool | None:
    value = section.get(name)
    return value if isinstance(value, bool) else None


def run_dataset_tests(args: argparse.Namespace, tests: list[dict[str, Any]]) -> None:
    synthetic_dir = args.synthetic_dir
    for name in REQUIRED_DATASETS:
        add_test(
            tests,
            f"dataset_exists_{name}",
            (synthetic_dir / name).exists(),
            f"{synthetic_dir / name}",
        )

    missing = [name for name in REQUIRED_DATASETS if not (synthetic_dir / name).exists()]
    if missing:
        return

    no_edge_rows = read_csv(synthetic_dir / "no_edge_daily.csv")
    trend_rows = read_csv(synthetic_dir / "known_trend_daily.csv")
    mean_reversion_rows = read_csv(synthetic_dir / "known_mean_reversion_daily.csv")
    raw_rows = read_csv(synthetic_dir / "corporate_action_raw.csv")
    adjusted_rows = read_csv(synthetic_dir / "corporate_action_adjusted.csv")
    timing_rows = read_csv(synthetic_dir / "order_timing_fixture.csv")

    for dataset_name, rows in [
        ("no_edge", no_edge_rows),
        ("known_trend", trend_rows),
        ("known_mean_reversion", mean_reversion_rows),
        ("corporate_action_raw", raw_rows),
        ("corporate_action_adjusted", adjusted_rows),
    ]:
        assert_ohlc(rows, tests, dataset_name)

    no_edge_returns = close_returns(no_edge_rows)
    trend_returns = close_returns(trend_rows)
    mean_reversion_returns = close_returns(mean_reversion_rows)
    no_edge_ac = autocorrelation(no_edge_returns)
    trend_ac = autocorrelation(trend_returns)
    mean_reversion_ac = autocorrelation(mean_reversion_returns)
    no_edge_mean = sum(no_edge_returns) / len(no_edge_returns)

    add_test(
        tests,
        "no_edge_autocorrelation_near_zero",
        no_edge_ac is not None and abs(no_edge_ac) <= args.no_edge_autocorr_limit,
        f"lag1 autocorrelation={no_edge_ac}",
    )
    add_test(
        tests,
        "no_edge_mean_return_near_zero",
        abs(no_edge_mean) <= args.no_edge_mean_abs_limit,
        f"mean log return={no_edge_mean}",
    )
    add_test(
        tests,
        "known_trend_positive_autocorrelation",
        trend_ac is not None and trend_ac >= args.known_trend_min_autocorr,
        f"lag1 autocorrelation={trend_ac}",
    )
    add_test(
        tests,
        "known_mean_reversion_negative_autocorrelation",
        mean_reversion_ac is not None
        and mean_reversion_ac <= args.known_mean_reversion_max_autocorr,
        f"lag1 autocorrelation={mean_reversion_ac}",
    )

    raw_max = max_abs_return(raw_rows)
    adjusted_max = max_abs_return(adjusted_rows)
    add_test(
        tests,
        "raw_split_fixture_exposes_large_jump",
        raw_max >= args.raw_split_min_abs_return,
        f"max abs raw return={raw_max}",
    )
    add_test(
        tests,
        "adjusted_split_fixture_removes_large_jump",
        adjusted_max <= args.adjusted_split_max_abs_return,
        f"max abs adjusted return={adjusted_max}",
    )

    bad_timing_rows = 0
    for row in timing_rows:
        decision = date.fromisoformat(row["decision_date"])
        expected = date.fromisoformat(row["expected_fill_date"])
        if expected != next_business_day(decision):
            bad_timing_rows += 1
    add_test(
        tests,
        "order_timing_fixture_next_business_day",
        bad_timing_rows == 0,
        f"{bad_timing_rows} rows with wrong expected fill date",
    )


def run_strategy_result_tests(args: argparse.Namespace, tests: list[dict[str, Any]]) -> bool:
    results = read_json(args.strategy_results)
    supplied = bool(results)
    if not supplied:
        add_test(
            tests,
            "strategy_results_supplied",
            not args.require_strategy_results,
            "no strategy result controls supplied",
            severity="blocker" if args.require_strategy_results else "warning",
        )
        return False

    add_test(tests, "strategy_results_supplied", True, str(args.strategy_results))

    no_edge = results.get("no_edge")
    if isinstance(no_edge, dict):
        sharpe = metric(no_edge, "sharpe", "annualized_sharpe")
        passed = sharpe is not None and abs(sharpe) <= args.no_edge_strategy_abs_sharpe
        add_test(
            tests,
            "strategy_no_edge_false_discovery",
            passed,
            f"no_edge sharpe={sharpe}",
        )
    else:
        add_test(
            tests,
            "strategy_no_edge_false_discovery",
            False,
            "missing strategy_results.no_edge",
        )

    shuffled = results.get("shuffled_labels") or results.get("shuffled_returns")
    if isinstance(shuffled, dict):
        sharpe = metric(shuffled, "sharpe", "annualized_sharpe")
        passed = sharpe is not None and abs(sharpe) <= args.placebo_abs_sharpe
        add_test(tests, "strategy_shuffled_placebo", passed, f"placebo sharpe={sharpe}")
    else:
        add_test(tests, "strategy_shuffled_placebo", False, "missing shuffled placebo result")

    lookahead = results.get("lookahead_trap")
    if isinstance(lookahead, dict):
        used_future_data = bool_metric(lookahead, "used_future_data")
        trap_passed = bool_metric(lookahead, "passed")
        sharpe = metric(lookahead, "sharpe", "annualized_sharpe")
        passed = (
            used_future_data is False
            or trap_passed is True
            or (sharpe is not None and abs(sharpe) <= args.placebo_abs_sharpe)
        )
        add_test(
            tests,
            "strategy_lookahead_trap",
            passed,
            f"used_future_data={used_future_data}, passed={trap_passed}, sharpe={sharpe}",
        )
    else:
        add_test(tests, "strategy_lookahead_trap", False, "missing lookahead trap result")

    delayed = results.get("delayed_signal")
    original = results.get("original")
    if isinstance(delayed, dict) and isinstance(original, dict):
        delayed_sharpe = metric(delayed, "sharpe", "annualized_sharpe")
        original_sharpe = metric(original, "sharpe", "annualized_sharpe")
        passed = (
            delayed_sharpe is not None
            and original_sharpe is not None
            and delayed_sharpe <= original_sharpe * args.delayed_signal_max_ratio
        )
        add_test(
            tests,
            "strategy_delayed_signal_degrades",
            passed,
            f"delayed sharpe={delayed_sharpe}, original sharpe={original_sharpe}",
            severity="warning",
        )

    known_edge = results.get("known_edge")
    if isinstance(known_edge, dict):
        known_passed = bool_metric(known_edge, "passed")
        sharpe = metric(known_edge, "sharpe", "annualized_sharpe")
        passed = known_passed is True or (
            sharpe is not None and sharpe >= args.known_edge_min_sharpe
        )
        add_test(tests, "known_edge_recovery", passed, f"known_edge={known_edge}")

    return True


def status_from(tests: list[dict[str, Any]]) -> str:
    if any(test["status"] == "fail" for test in tests):
        return "fail"
    if any(test["status"] == "warn" for test in tests):
        return "warn"
    return "pass"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--synthetic-dir", type=Path, required=True)
    parser.add_argument("--strategy-results", type=Path)
    parser.add_argument("--require-strategy-results", action="store_true")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--no-edge-autocorr-limit", type=float, default=0.08)
    parser.add_argument("--no-edge-mean-abs-limit", type=float, default=0.001)
    parser.add_argument("--known-trend-min-autocorr", type=float, default=0.25)
    parser.add_argument("--known-mean-reversion-max-autocorr", type=float, default=-0.20)
    parser.add_argument("--raw-split-min-abs-return", type=float, default=0.35)
    parser.add_argument("--adjusted-split-max-abs-return", type=float, default=0.05)
    parser.add_argument("--no-edge-strategy-abs-sharpe", type=float, default=0.50)
    parser.add_argument("--placebo-abs-sharpe", type=float, default=0.50)
    parser.add_argument("--delayed-signal-max-ratio", type=float, default=0.75)
    parser.add_argument("--known-edge-min-sharpe", type=float, default=0.50)
    args = parser.parse_args()

    tests: list[dict[str, Any]] = []
    run_dataset_tests(args, tests)
    strategy_results_supplied = run_strategy_result_tests(args, tests)
    result = {
        "status": status_from(tests),
        "synthetic_dir": str(args.synthetic_dir),
        "strategy_results": str(args.strategy_results) if args.strategy_results else None,
        "strategy_results_supplied": strategy_results_supplied,
        "tests": tests,
        "thresholds": {
            "no_edge_autocorr_limit": args.no_edge_autocorr_limit,
            "no_edge_strategy_abs_sharpe": args.no_edge_strategy_abs_sharpe,
            "placebo_abs_sharpe": args.placebo_abs_sharpe,
        },
    }
    write_json(args.out, result)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"Simulation integrity status: {result['status']}")
        for test in tests:
            print(f"- {test['status']}: {test['name']} ({test['detail']})")

    if result["status"] == "fail":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
