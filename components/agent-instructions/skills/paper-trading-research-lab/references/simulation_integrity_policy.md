# Simulation Integrity Policy

## Core Idea

Before trusting a backtest, verify that the research pipeline behaves correctly on data where the answer is known. Synthetic controls do not prove profitability; they catch leakage, bad fills, broken corporate-action handling, false discoveries, and unrealistic execution assumptions before they contaminate strategy selection.

## Required Integrity Checks

Run these before promoting a candidate to paper trading. During ordinary validation, missing or partial integrity evidence should produce a warning and a next action, not automatic rejection.

- no-edge synthetic data: the strategy should not find durable positive expectancy
- shuffled-label or shuffled-return placebo: performance should disappear
- look-ahead trap: future information should not improve results
- known-edge synthetic data: a simple baseline should recover the planted effect
- cost and slippage stress: candidate should survive realistic and 2x costs
- corporate-action fixture: adjusted data should remove artificial split crashes
- order-timing fixture: fills should occur on the next valid bar, not the decision close

## Bundled Scripts

- `scripts/generate_synthetic_market.py`: creates no-edge, known-trend, known-mean-reversion, split, and order-timing fixtures.
- `scripts/run_control_tests.py`: checks fixture integrity and optional strategy-result controls, then writes `simulation_integrity.json`.

## Strategy Result Contract

When a repo can run its strategy or backtest engine on the synthetic fixtures, write a JSON file with any of these sections:

```json
{
  "original": {"sharpe": 1.0},
  "no_edge": {"sharpe": 0.1, "expectancy": 0.0},
  "shuffled_labels": {"sharpe": -0.1},
  "lookahead_trap": {"used_future_data": false},
  "delayed_signal": {"sharpe": 0.2},
  "known_edge": {"passed": true}
}
```

For promotion-stage audits, missing strategy-result controls should block promotion. Dataset-only integrity checks are useful for early setup and ordinary validation, but they are not enough to trust a candidate for paper trading.

## Failure Interpretation

- False discovery on no-edge data: reject or debug before any further optimization.
- Placebo performs like the real signal: reject or redesign.
- Look-ahead trap fires: treat the backtest engine as invalid until fixed.
- Corporate-action fixture fails: do not use equity results until adjustment logic is repaired.
- Order-timing fixture fails: do not trust entry/exit or fill assumptions.
- Known-edge baseline fails: debug the backtest plumbing before judging strategy quality.
