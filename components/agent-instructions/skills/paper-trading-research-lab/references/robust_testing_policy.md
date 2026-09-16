# Robust Testing Policy

## Core Idea

Validation should try to falsify the candidate, not rescue it. Use cheap tests first, then expensive tests only for candidates that survive.

## Test Order

1. Data integrity and timestamp audit.
2. Friction and capacity triage.
3. Simple benchmark and naive baseline comparison.
4. In-sample sanity check with predeclared parameter bounds.
5. Out-of-sample test.
6. Walk-forward or purged/embargoed cross-validation when labels overlap.
7. Negative controls and placebo tests.
8. Simulation-integrity tests on synthetic no-edge, known-edge, corporate-action, and order-timing fixtures.
9. Parameter stability and cost sensitivity.
10. Multiple-testing adjustment.
11. Paper-trading incubation.

## Negative Controls and Placebos

Use controls that should fail if the strategy has no real edge:

- shuffled labels or shuffled returns
- randomized signal direction
- delayed signal that should remove the edge
- impossible lead signal to detect look-ahead plumbing
- random universe selection with similar liquidity
- synthetic no-edge data with similar volatility and autocorrelation
- same strategy on markets where the rationale should not apply
- permuted event dates for event-driven strategies
- stale-price and duplicated-row stress checks

If a placebo performs similarly to the real strategy, reject or redesign.

## Simulation Integrity

Use `scripts/generate_synthetic_market.py` and `scripts/run_control_tests.py` when validating a repo or backtest engine. Validation should fail if:

- the strategy finds strong performance on no-edge data
- shuffled-label or shuffled-return controls keep working
- a look-ahead trap indicates future data is available
- split-adjusted fixtures still show artificial corporate-action jumps
- order-timing fixtures fill on the decision close when the strategy should fill on the next bar
- a simple known-edge baseline cannot recover the planted effect

## Multiple-Testing Adjustments

Choose methods that match the search:

- Probabilistic Sharpe Ratio: single selected strategy with non-normal returns.
- Deflated Sharpe Ratio: selected best strategy after many trials.
- Probability of Backtest Overfitting or CSCV: many variants across comparable train/test slices.
- Hansen SPA or Reality Check: many competing models or trading rules against a benchmark.
- False-discovery controls: broad factor or signal library screening.

Always document the trial family. Do not count only the final parameter set.

## Robustness Diagnostics

Require:

- parameter neighborhood map
- degradation from train to validation to test to paper
- performance by regime, asset, sector, day, and event cluster where relevant
- concentration analysis for top trades, top days, top assets, and top regimes
- 1x, 2x, and stress-level transaction cost runs
- turnover, capacity, and implementation shortfall estimates
- bootstrap or Monte Carlo path sensitivity when sample path luck is plausible

## ML-Specific Rules

Use ML only when:

- labels are timestamp-safe and economically meaningful
- features are available at decision time
- train/validation/test design accounts for overlapping labels
- purging or embargoing is applied when needed
- model complexity is justified by sample size
- feature importance or ablation can explain the signal
- the model beats simple baselines after costs and multiple-testing adjustment

Reject ML candidates that cannot beat a simple, explainable baseline.

## Failure Signals

Reject or redesign when:

- performance vanishes after realistic or 2x costs
- parameters need narrow tuning
- results are dominated by one asset, trade, day, or regime
- negative controls pass
- simulation-integrity tests fail or are missing before promotion to paper trading
- OOS or paper performance sharply degrades without a predeclared explanation
- the strategy requires data timing, liquidity, borrow, or fills unavailable in real paper trading
