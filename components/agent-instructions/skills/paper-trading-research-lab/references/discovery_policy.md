# Discovery Policy

## Core Idea

Profitable paper-trading candidates are more likely to come from durable edge families than from unconstrained indicator search. Use this policy to source, rank, and pre-register hypotheses before running backtests.

## Edge Families

Start with one or more of these families:

- trend or momentum: persistence after underreaction, delayed information diffusion, or hedging pressure
- value or relative value: expected convergence between cheap and expensive assets
- carry or term structure: compensation for bearing financing, roll, credit, volatility, or inventory risk
- quality, profitability, or investment: persistent firm-level characteristics
- liquidity provision or short-horizon mean reversion: compensation for supplying liquidity or absorbing temporary pressure
- volatility or option risk premium: compensation for variance, skew, convexity, or insurance demand
- flow, hedging pressure, or positioning: structural demand from non-alpha participants
- seasonality, calendar, or event effects: recurring institutional or behavioral timing
- market microstructure: order-book, spread, queue, or auction effects
- cross-asset linkage: lead-lag, relative momentum, or macro transmission

Do not treat an edge family as proof. Treat it as a prior that still requires falsification.

## Candidate Intake Template

For each candidate, record:

- `edge_family`
- hypothesis in plain language
- economic, behavioral, structural, or risk-premium rationale
- why this edge might persist
- why this edge might decay
- market/universe fit
- data required and known data risks
- execution path and friction risks
- expected capacity
- expected holding period and turnover
- benchmark and simple baseline
- closest published or known analogue
- reason this candidate is worth one of the limited research slots

## Base-Rate Prior Score

Score each item from 0 to 3, then total the score before testing.

- rationale strength: clear mechanism, not just pattern matching
- evidence quality: published evidence, independent replication, or strong domain reason
- market fit: asset class and horizon match the proposed mechanism
- data feasibility: required data is available, cleanable, and timestamp-safe
- execution feasibility: likely edge can survive spread, fees, slippage, borrow, and market impact
- robustness expectation: mechanism should work across related markets, regimes, or parameter neighborhoods
- decay and crowding risk: edge is not obviously arbitraged away or capacity-constrained
- portfolio distinctness: candidate is not just a disguised copy of existing exposure
- simplicity: few moving parts and explainable failure modes

Suggested interpretation:

- 0-8: reject before backtesting unless the user has a special reason
- 9-15: research only as a low-priority exploratory candidate
- 16-21: eligible for a small validation budget
- 22-27: strong candidate for a disciplined research pass

## Search Budget Rules

- Rank candidates before backtesting.
- Allocate trials to hypotheses first, then parameters.
- Prefer wide hypothesis diversity before fine parameter sweeps.
- Cap parameter variants and record every variant tested.
- Expand a search only by creating a new run with a new reason.
- Stop testing a family when repeated failures share the same economics, data, cost, or robustness cause.

## Discovery Output

When asked to find promising candidates, return:

- ranked candidate queue
- base-rate prior scores
- research budget for each candidate
- fastest falsification test for each candidate
- expected data and execution blockers
- recommendation: reject now, research lightly, or promote to strategy card
