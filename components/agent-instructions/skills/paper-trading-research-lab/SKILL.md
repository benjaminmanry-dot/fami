---
name: paper-trading-research-lab
description: Discover, design, backtest, validate, compare, and incubate systematic paper-trading strategies under strict anti-overfitting, edge-sourcing, risk-control, and research-audit rules. Use when asked to create, source, evaluate, compare, improve, or paper-trade trading strategies, backtests, alpha hypotheses, factor ideas, signal research, portfolio construction, or bet-sizing logic.
---

# Paper-Trading Research Lab Skill

## Purpose

Help run a rigorous systematic-trading research workflow. The goal is not to claim guaranteed profits; the goal is to source plausible edge hypotheses, reject weak candidates quickly, validate surviving candidates aggressively, incubate them in paper trading, and learn from every rejection.

Default mode is **research and paper trading only**. Do not add live-trading execution unless the user explicitly asks for it in a separate production-hardening task.

## Reference Loading

Load these only when relevant:

- `references/discovery_policy.md`: Use when generating, ranking, or selecting trading hypotheses.
- `references/validation_policy.md`: Use when designing or judging validation, promotion, or rejection gates.
- `references/robust_testing_policy.md`: Use when implementing backtests, controls, multiple-testing adjustments, or leakage checks.
- `references/simulation_integrity_policy.md`: Use when testing backtest plumbing, synthetic controls, look-ahead traps, corporate actions, or order timing.
- `references/portfolio_policy.md`: Use when comparing candidates or combining strategies.
- `references/risk_policy.md`: Use when sizing, throttling, or defining kill switches.
- `references/evidence_sources.md`: Use when grounding edge families in published evidence.
- `references/harness_policy.md`: Use when creating strategy cards, manifests, trial ledgers, run audits, or reports.
- `references/stage_gate_policy.md`: Use when deciding which rules apply to exploration, discovery, optimization, validation, promotion, or paper incubation.

## Non-Negotiable Rules

1. Never describe any strategy, backtest, or model as guaranteed profitable.
2. Treat strategy discovery as a multiple-testing problem. Log the hypothesis family, trial budget, parameter variants, data versions, and rejected candidates.
3. Do not promote a strategy because it looks good in-sample. Require out-of-sample validation, realistic costs, drawdown analysis, and paper-trading incubation.
4. Start from a plausible economic, behavioral, structural, or risk-premium rationale. Exploratory feature searches are allowed only inside a declared budget and remain non-promotable until converted into an edge-backed hypothesis.
5. Require simple baselines before complex ML. Use ML when the data, labels, and validation design justify it and it beats simple baselines after leakage checks, costs, and multiple-testing adjustment.
6. Preserve a holdout set that is not touched during research. Do not re-optimize on the holdout after seeing results.
7. Assume backtests are fragile until proven otherwise. Check for look-ahead bias, survivorship bias, data snooping, calendar errors, corporate-action errors, missing data, bad fills, borrow/short constraints, and unrealistic execution assumptions.
8. Use conservative bet sizing. Kelly sizing, if used, must be fractional Kelly from conservative lower-bound estimates and must stay inside hard risk caps.
9. Never use martingale loss-chasing or position escalation whose primary purpose is to recover losses.
10. Clearly label results as simulated, hypothetical, or paper-traded.
11. Pause or reject a strategy even if profitable when it fails robustness, capacity, drawdown, correlation, data-quality, or operational-risk checks.
12. Treat paper-trading degradation as evidence, not noise to explain away.

## Standard Workflow

Follow this sequence unless the user asks for a narrower task.

First determine the stage using `references/stage_gate_policy.md`: exploration, discovery, optimization, validation, promotion, or paper.

### 1. Clarify the Research Brief

Resolve or state conservative assumptions for:

- asset class, universe, benchmark, and baseline strategies
- trading horizon, rebalance frequency, and holding-period limits
- long-only, long/short, options, futures, crypto, or multi-asset constraints
- allowed data sources, data frequency, and survivorship-bias controls
- starting paper capital and paper-trading broker/simulator
- max drawdown, max daily loss, position caps, leverage/margin limits, liquidity limits, and borrow limits
- existing strategies or exposures the candidate must diversify

### 2. Source Edge-Backed Candidates

Use `references/discovery_policy.md` when the task includes idea generation, strategy selection, or improving discovery odds.

For every candidate, identify:

- edge family
- plain-language rationale
- why the edge might persist
- why it might be decaying or crowded
- evidence source or analogue
- market/universe fit
- data and execution feasibility
- expected failure modes

Rank candidates **before** serious backtesting. Prefer a small queue of high-prior hypotheses over many unconstrained variants.

For exploration-stage work, a lightweight `candidate_intake.json` using `schemas/candidate_intake.schema.json` is enough. Exploratory screens may run quick falsification tests, but their results are non-promotable until a full strategy card is created.

### 3. Register the Strategy Card

Create or update a strategy card containing:

- `strategy_id`
- `edge_family`
- `base_rate_prior_score`
- `hypothesis`
- market inefficiency, behavioral mechanism, structural flow, or risk premium being targeted
- evidence source and replication expectation
- entry signal and exit signal
- universe filter and eligibility rules
- position sizing rule
- rebalancing rule
- expected failure modes
- decay, crowding, and capacity risks
- parameter search bounds
- discovery budget and stopping rule
- data required
- benchmark and baseline strategies
- validation methods and promotion gates
- simulation-integrity tests required before promotion

When writing a repository artifact for discovery, optimization, validation, promotion, or paper stages, structure it as `strategy_card.json` using `schemas/strategy_card.schema.json`, then run `scripts/score_candidate.py`. A full strategy card is required before optimization, not before every tiny exploratory screen.

### 4. Pre-Register the Search Budget

Before testing, declare:

- maximum variants and parameter ranges
- data versions and universes to be touched
- primary metric and secondary diagnostics
- trial family for multiple-testing adjustment
- negative controls or placebo tests
- minimum trade count or exposure duration
- rejection and pause conditions

If the search budget expands, log the expansion as a new research run.

Use `scripts/update_trial_ledger.py` to append every optimization, validation, or promotion-stage variant to `trial_ledger.jsonl`. For exploration, keep at least a lightweight note of variants tested and convert it into the ledger if the idea advances.

### 5. Audit Data Before Backtesting

Check:

- timezone and exchange calendar alignment
- split/dividend/corporate-action adjustment
- survivorship-bias-free universe where relevant
- delisted symbols if testing equities
- missing bars, duplicated rows, stale prices, impossible OHLC values
- bid/ask spread availability or slippage proxy
- borrow, financing, margin, and short-availability assumptions
- no future data in features, labels, portfolio membership, or rebalance decisions

### 6. Run Friction and Capacity Triage

Before a full research pass, estimate whether the candidate can plausibly survive:

- commissions, fees, spread, slippage, borrow, financing, and market impact
- turnover and rebalance frequency
- liquidity, average volume, depth, and order-size constraints
- capacity limits at the user's paper capital and plausible future capital
- operational requirements such as data latency, order timing, and borrow availability

Reject or redesign candidates whose expected edge is likely consumed by trading friction.

### 7. Backtest Realistically

Prefer event-driven backtests for execution-sensitive strategies and vectorized backtests only for early screening.

Include:

- commissions, fees, spread, slippage, and market-impact assumptions
- order type, fill model, latency assumptions, partial fills, and rejected orders where relevant
- cash drag, margin interest, borrow costs, financing costs, and taxes only if the user asks for tax-aware analysis
- benchmark, simple baseline, and random/placebo baseline comparisons
- turnover, exposure, capacity, and implementation shortfall estimates

When implementing or evaluating a repo backtest engine, generate synthetic fixtures with `scripts/generate_synthetic_market.py`.

### 8. Validate Aggressively

Use `references/validation_policy.md` and `references/robust_testing_policy.md`.

Prefer:

- chronological train/validation/test split
- walk-forward analysis
- purged or embargoed cross-validation for overlapping labels
- combinatorially symmetric cross-validation or similar PBO estimate when comparing many variants
- probabilistic or deflated Sharpe ratio when many variants are tested
- Hansen SPA, Reality Check, or false-discovery controls when comparing model families
- negative controls and placebo tests
- simulation-integrity tests using `scripts/run_control_tests.py`, including no-edge, shuffled-label, look-ahead, split-adjustment, order-timing, and known-edge checks
- bootstrap or Monte Carlo path resampling
- stress tests across crisis, high-volatility, low-volatility, trend, chop, rising-rate, and falling-rate regimes
- parameter stability maps
- cost and slippage sensitivity analysis
- degradation analysis from in-sample to out-of-sample to paper trading

At validation stage, missing simulation-integrity evidence is a warning unless the user is asking whether to promote into paper trading. At promotion and paper stages, passing simulation integrity is a hard gate.

### 9. Score With Hard Gates

Do not promote a strategy to paper trading unless it passes predeclared gates. Suggested default promotion gates:

- plausible edge-family prior and written rationale
- enough trades or time-in-market for inference
- positive out-of-sample expectancy after costs
- out-of-sample drawdown within policy
- no single trade, day, ticker, sector, or regime explains most of the profit
- robust under at least 2x estimated costs
- stable neighboring parameters
- acceptable tail risk, drawdown duration, turnover, and capacity
- documented multiple-testing adjustment
- paper-trading results do not materially degrade from OOS expectation

Before any paper-trading or promotion recommendation, run `scripts/audit_research_run.py --stage promotion` or manually apply the same checks when scripts cannot be run.

### 10. Evaluate Portfolio Contribution

Use `references/portfolio_policy.md` when comparing or combining strategies.

Evaluate:

- correlation to existing strategies and benchmarks
- drawdown overlap and crisis-regime behavior
- marginal Sharpe or risk-adjusted contribution
- capital efficiency and capacity
- turnover collision and execution scheduling conflicts
- whether the strategy diversifies or duplicates an existing exposure

Portfolio contribution is required before shared-capital incubation or allocation. It should not block standalone exploration or initial validation.

### 11. Size and Control Risk

Use `references/risk_policy.md`.

Apply this hierarchy:

1. Hard risk caps first: max position, max leverage, max gross/net exposure, max sector exposure, max daily loss, max strategy drawdown.
2. Volatility targeting, equal risk contribution, or risk parity as the default sizing baseline.
3. Fractional Kelly only as an optional overlay, using conservative lower-bound estimates of edge and variance.
4. Portfolio-level correlation adjustment so similar strategies do not become one large bet.
5. Drawdown throttle that reduces risk after degradation and requires evidence before re-scaling.

### 12. Paper-Trade Incubation

Before any live-capital recommendation, require:

- paper trading with identical signal timing and order simulation as intended live operation
- daily reconciliation of expected versus actual fills
- slippage, missed-fill, and rejected-order report
- alerting for data feed outages and unusual orders
- post-trade attribution
- predeclared minimum incubation period or minimum number of trades
- go/no-go review based on degradation, risk, and operational reliability

### 13. Maintain the Learning Loop

After each run, update the trial ledger and summarize:

- why the candidate passed, failed, or needs more research
- which edge families, markets, data sources, or horizons are producing repeated failures
- whether rejection was due to economics, data, execution, robustness, risk, or operations
- what to stop testing, what to test next, and what would change the conclusion

## Reporting Format

Every report should include:

- short verdict: reject, research more, paper-trade, pause, or promote to review
- assumptions, data version, code version, and trial count
- strategy card and base-rate prior
- backtest period, validation period, OOS period, and paper-trading period if any
- headline metrics: CAGR/return, Sharpe, Sortino, Calmar, max drawdown, drawdown duration, hit rate, payoff ratio, expectancy, turnover, exposure, beta, tail loss, and capacity estimate
- friction/capacity triage
- cost/slippage sensitivity
- negative controls and placebo results
- simulation-integrity result
- regime breakdown
- parameter stability
- multiple-testing adjustment
- portfolio contribution
- failure modes and next actions

Use `templates/report.md` as the default report skeleton unless the user's repo already has a stronger report format.

## Coding Conventions

When writing code for this workflow:

- Use Python unless the repo has a different standard.
- Keep strategy logic, data loading, backtest engine, metrics, validation, risk, portfolio construction, and reporting in separate modules.
- Make every run reproducible with a config file, random seed, data snapshot/version, trial ledger entry, and git commit hash.
- Store results in structured outputs such as Parquet, CSV, JSON, or SQLite.
- Add tests for look-ahead protection, slippage application, cost accounting, split handling, order-fill timing, negative controls, and trial-ledger integrity.
- Never hard-code broker credentials or API keys. Use environment variables or secret managers.
- Prefer dry-run and paper-trading modes by default.

## Research Harness

Use the bundled harness to make the workflow enforceable:

- `schemas/strategy_card.schema.json`: contract for complete strategy cards.
- `schemas/candidate_intake.schema.json`: lighter contract for exploratory candidates.
- `schemas/trial_ledger_entry.schema.json`: contract for append-only trial entries.
- `scripts/score_candidate.py`: validates a card and computes the base-rate prior score.
- `scripts/scaffold_research_run.py`: creates a reproducible run manifest.
- `scripts/update_trial_ledger.py`: records every tested variant in JSONL.
- `scripts/generate_synthetic_market.py`: creates no-edge, known-edge, corporate-action, and order-timing fixtures.
- `scripts/run_control_tests.py`: writes `simulation_integrity.json` from fixture diagnostics and strategy-result controls.
- `scripts/audit_research_run.py`: checks for missing controls, artifacts, and promotion evidence.
- `templates/report.md`: standard report skeleton.

## Suggested Repo Structure

```text
trading-research/
  AGENTS.md
  configs/
  data/
    synthetic/
  notebooks/
  reports/
  schemas/
  src/
    data/
    strategies/
    backtest/
    validation/
    risk/
    portfolio/
    paper/
    reporting/
  tests/
  templates/
  runs/
```

## Useful Prompts

- `$paper-trading-research-lab Generate and rank 12 paper-trading hypotheses for liquid ETFs using the discovery policy. Do not backtest yet.`
- `$paper-trading-research-lab Create a strategy card, discovery budget, and validation plan for a daily equity mean-reversion strategy.`
- `$paper-trading-research-lab Review this backtest for look-ahead bias, unrealistic costs, weak edge rationale, and overfitting risk.`
- `$paper-trading-research-lab Implement the strategy in this repo, add controls, and generate a backtest report using the validation and robustness policies.`
- `$paper-trading-research-lab Compare these candidates and recommend which should be rejected, incubated, or researched further based on portfolio contribution.`
