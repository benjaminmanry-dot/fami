# Validation Policy

## Core idea
Backtesting is a falsification tool, not a profit proof. A candidate is presumed invalid until it survives leakage checks, out-of-sample tests, robustness tests, cost sensitivity, and paper-trading incubation.

## Required artifacts
Each promotion candidate must produce:
- strategy card
- base-rate prior score and discovery budget
- data audit report
- run manifest with data snapshot and code commit
- trial ledger listing all tested variants
- backtest report
- validation report
- simulation-integrity report
- negative-control and placebo-test report
- friction and capacity report
- portfolio-contribution report when comparing or combining candidates
- paper-trading report, if incubated

Exploratory candidates may start with `candidate_intake.json` and a small falsification screen. They are not eligible for promotion until the full artifact set exists.

## Rejection triggers
Reject or redesign when any of these occur:
- no plausible edge-family rationale exists before testing
- look-ahead, survivorship, selection, or data-snooping bias is found
- performance disappears under realistic costs
- most profit comes from one trade, one asset, or one short regime
- parameters must be tuned narrowly to work
- negative controls or placebos perform similarly to the real strategy
- simulation-integrity tests are missing or fail before promotion to paper trading
- OOS performance sharply degrades without a plausible explanation
- drawdown, turnover, leverage, liquidity, or borrow requirements violate policy
- strategy cannot be executed with the available data cadence and order model
- the candidate duplicates an existing portfolio exposure without improving marginal risk-adjusted return

## Promotion gates
Suggested default gates for a paper-trading candidate:
- written edge rationale and acceptable base-rate prior
- positive net expectancy after fees, spread, slippage, financing, and borrow costs
- at least one untouched out-of-sample period
- regime analysis with no catastrophic hidden exposure
- cost sensitivity at 2x expected costs remains acceptable
- neighboring parameters remain directionally profitable
- drawdown and tail risk stay within policy
- enough trades or enough time-in-market to reduce single-event luck
- multiple-testing correction documented
- negative controls fail as expected
- simulation-integrity tests pass with strategy-result controls
- marginal portfolio contribution is acceptable when the candidate is intended for a strategy portfolio

## Trial ledger fields
Track these for every run:
- timestamp
- strategy_id
- hypothesis_id
- edge_family
- base_rate_prior_score
- discovery_budget
- git_commit
- data_version
- universe_version
- parameter_set
- trial_family
- train_period
- validation_period
- test_period
- number_of_trials_so_far
- in_sample_metrics
- out_of_sample_metrics
- negative_control_results
- simulation_integrity_summary
- friction_capacity_summary
- portfolio_contribution_summary
- rejection_reason or promotion_status
