# Stage Gate Policy

## Core Idea

Use lighter rules when the goal is discovery and harder rules when the goal is promotion. The workflow should preserve recall early and precision late.

## Stages

### Exploration

Goal: cheaply decide whether an idea deserves a full strategy card.

Required:

- lightweight `candidate_intake.json`
- explicit exploratory budget
- fastest falsification test
- label all results as exploratory and non-promotable

Allowed:

- quick screens
- small feature probes
- rough baselines
- exploratory indicator or ML feature searches inside the declared budget

Not allowed:

- paper-trading recommendation
- parameter expansion without noting the budget change
- treating exploratory output as validated evidence

### Discovery

Goal: turn a promising idea into a structured candidate.

Required:

- full `strategy_card.json`
- base-rate prior score
- search budget
- validation plan

### Optimization

Goal: test predeclared variants without silently expanding the search.

Required:

- full strategy card
- manifest
- trial ledger entries for every variant
- realistic cost assumptions

### Validation

Goal: decide whether the candidate deserves a promotion review.

Required:

- out-of-sample evidence
- negative controls
- cost sensitivity
- multiple-testing documentation
- warnings for missing simulation-integrity evidence

Simulation integrity should be a warning here unless the user is asking for paper-trading promotion.

### Promotion

Goal: decide whether to incubate in paper trading.

Required:

- passing simulation-integrity report with strategy-result controls
- validation audit
- portfolio-contribution review when the strategy will share capital with other strategies
- hard risk limits and paper-trading plan

### Paper

Goal: monitor an incubated paper strategy.

Required:

- fill reconciliation
- slippage and missed-fill report
- degradation review
- kill-switch monitoring

## Rule Calibration

- Full harness gates block promotion, not curiosity.
- Portfolio contribution gates block allocation, not standalone research.
- Simple baselines are mandatory, but simplicity is not itself a promotion gate.
- ML is acceptable when it beats simple baselines after leakage checks, costs, and multiple-testing adjustment.
