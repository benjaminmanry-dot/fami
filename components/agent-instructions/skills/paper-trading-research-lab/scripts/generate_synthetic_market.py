#!/usr/bin/env python3
"""Generate synthetic market fixtures for simulation-integrity tests."""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from datetime import date, timedelta
from pathlib import Path
from typing import Any


DATASETS = [
    "no_edge_daily.csv",
    "known_trend_daily.csv",
    "known_mean_reversion_daily.csv",
    "corporate_action_raw.csv",
    "corporate_action_adjusted.csv",
    "order_timing_fixture.csv",
]


def business_days(start: str, count: int) -> list[date]:
    current = date.fromisoformat(start)
    days: list[date] = []
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current += timedelta(days=1)
    return days


def next_business_day(day: date) -> date:
    current = day + timedelta(days=1)
    while current.weekday() >= 5:
        current += timedelta(days=1)
    return current


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def price_rows(
    days: list[date],
    symbols: list[str],
    *,
    seed: int,
    phi: float,
    drift: float,
    volatility: float,
    regime: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for symbol_index, symbol in enumerate(symbols):
        rng = random.Random(seed + symbol_index * 1009)
        previous_return = 0.0
        close = 100.0 + symbol_index * 7.5
        for day in days:
            overnight = rng.gauss(0.0, volatility * 0.15)
            open_price = max(0.01, close * math.exp(overnight))
            daily_return = drift + phi * previous_return + rng.gauss(0.0, volatility)
            close_price = max(0.01, open_price * math.exp(daily_return))
            high = max(open_price, close_price) * (1.0 + abs(rng.gauss(0.0, volatility * 0.4)))
            low = min(open_price, close_price) * (1.0 - abs(rng.gauss(0.0, volatility * 0.4)))
            low = max(0.01, low)
            volume = int(max(10000, rng.lognormvariate(12.0, 0.35)))
            rows.append(
                {
                    "date": day.isoformat(),
                    "symbol": symbol,
                    "open": f"{open_price:.6f}",
                    "high": f"{high:.6f}",
                    "low": f"{low:.6f}",
                    "close": f"{close_price:.6f}",
                    "volume": volume,
                    "split_factor": "1.0",
                    "dividend": "0.0",
                    "expected_regime": regime,
                }
            )
            close = close_price
            previous_return = daily_return
    return rows


def corporate_action_rows(days: list[date]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw_rows: list[dict[str, Any]] = []
    adjusted_rows: list[dict[str, Any]] = []
    split_index = max(5, len(days) // 2)
    base_close = 50.0
    for index, day in enumerate(days):
        adjusted_close = base_close * (1.0 + 0.002 * index)
        raw_multiplier = 2.0 if index < split_index else 1.0
        split_factor = 2.0 if index == split_index else 1.0
        raw_close = adjusted_close * raw_multiplier
        for rows, close_price, label in [
            (raw_rows, raw_close, "raw_split_fixture"),
            (adjusted_rows, adjusted_close, "adjusted_split_fixture"),
        ]:
            open_price = close_price * 0.998
            high = close_price * 1.003
            low = close_price * 0.996
            rows.append(
                {
                    "date": day.isoformat(),
                    "symbol": "SPLT",
                    "open": f"{open_price:.6f}",
                    "high": f"{high:.6f}",
                    "low": f"{low:.6f}",
                    "close": f"{close_price:.6f}",
                    "volume": 1000000,
                    "split_factor": f"{split_factor:.1f}",
                    "dividend": "0.0",
                    "expected_regime": label,
                }
            )
    return raw_rows, adjusted_rows


def order_timing_rows(days: list[date]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, day in enumerate(days[:-1]):
        signal = 1 if index % 3 == 0 else 0
        fill_day = next_business_day(day)
        rows.append(
            {
                "decision_date": day.isoformat(),
                "symbol": "TIMING",
                "signal_after_close": signal,
                "same_day_close": f"{100.0 + index:.2f}",
                "expected_fill_date": fill_day.isoformat(),
                "expected_fill_price_source": "next_open",
                "must_not_fill_on_decision_close": "true",
            }
        )
    return rows


def write_manifest(out_dir: Path, args: argparse.Namespace) -> None:
    manifest = {
        "created_by": "paper-trading-research-lab/scripts/generate_synthetic_market.py",
        "seed": args.seed,
        "start": args.start,
        "days": args.days,
        "symbols": args.symbols,
        "datasets": DATASETS,
        "expected_controls": {
            "no_edge_daily.csv": "strategy should not find durable positive expectancy",
            "known_trend_daily.csv": "trend-following baseline should detect positive autocorrelation",
            "known_mean_reversion_daily.csv": "mean-reversion baseline should detect negative autocorrelation",
            "corporate_action_raw.csv": "raw split should expose corporate-action handling risk",
            "corporate_action_adjusted.csv": "adjusted series should avoid the artificial split crash",
            "order_timing_fixture.csv": "fills should occur on the expected next bar, not the decision close",
        },
    }
    path = out_dir / "synthetic_manifest.json"
    with path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=1729)
    parser.add_argument("--start", default="2015-01-01")
    parser.add_argument("--days", type=int, default=504)
    parser.add_argument("--symbols", type=int, default=5)
    args = parser.parse_args()

    if args.days < 60:
        raise SystemExit("--days must be at least 60")
    if args.symbols < 1:
        raise SystemExit("--symbols must be at least 1")

    out_dir = args.out_dir
    symbols = [f"SYN{i + 1:02d}" for i in range(args.symbols)]
    days = business_days(args.start, args.days)
    short_days = business_days(args.start, min(60, args.days))

    fieldnames = [
        "date",
        "symbol",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "split_factor",
        "dividend",
        "expected_regime",
    ]

    write_csv(
        out_dir / "no_edge_daily.csv",
        price_rows(
            days,
            symbols,
            seed=args.seed,
            phi=0.0,
            drift=0.0,
            volatility=0.01,
            regime="no_edge",
        ),
        fieldnames,
    )
    write_csv(
        out_dir / "known_trend_daily.csv",
        price_rows(
            days,
            symbols,
            seed=args.seed + 10000,
            phi=0.65,
            drift=0.0001,
            volatility=0.009,
            regime="known_positive_autocorrelation",
        ),
        fieldnames,
    )
    write_csv(
        out_dir / "known_mean_reversion_daily.csv",
        price_rows(
            days,
            symbols,
            seed=args.seed + 20000,
            phi=-0.55,
            drift=0.0,
            volatility=0.01,
            regime="known_negative_autocorrelation",
        ),
        fieldnames,
    )

    raw_rows, adjusted_rows = corporate_action_rows(short_days)
    write_csv(out_dir / "corporate_action_raw.csv", raw_rows, fieldnames)
    write_csv(out_dir / "corporate_action_adjusted.csv", adjusted_rows, fieldnames)
    write_csv(
        out_dir / "order_timing_fixture.csv",
        order_timing_rows(short_days[:30]),
        [
            "decision_date",
            "symbol",
            "signal_after_close",
            "same_day_close",
            "expected_fill_date",
            "expected_fill_price_source",
            "must_not_fill_on_decision_close",
        ],
    )
    write_manifest(out_dir, args)
    print(f"Wrote synthetic market fixtures to {out_dir}")


if __name__ == "__main__":
    main()
