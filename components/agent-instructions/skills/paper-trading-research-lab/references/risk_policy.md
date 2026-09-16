# Risk and Bet-Sizing Policy

## Risk hierarchy
1. Capital preservation constraints override all position-sizing formulas.
2. Position, portfolio, sector, asset-class, leverage, liquidity, and drawdown caps are hard limits.
3. Fractional Kelly can only reduce or modestly adjust risk inside those limits; it cannot override them.
4. Live-capital use requires a separate production review and explicit user approval.
5. A strategy with weak validation, paper-trading degradation, or poor portfolio contribution receives zero capital regardless of standalone backtest metrics.

## Suggested default limits
These are placeholders to be replaced by the user's actual risk policy:
- max risk per trade: 0.25% to 1.00% of paper equity
- max position per asset: 5% to 10% of paper equity
- max gross exposure: 100% unless margin is explicitly allowed
- max strategy drawdown before pause: 5% to 10%
- max portfolio daily loss before stop-trading: 1% to 2%
- max Kelly fraction used: 10% to 25% of estimated full Kelly
- max allocation to one edge family: define before portfolio incubation
- max allocation to highly correlated strategy variants: treat as one combined risk bucket
- no averaging down unless explicitly part of a pretested, capped strategy rule

## Kelly usage rule
Use Kelly only when there is a statistically defensible estimate of edge and payoff distribution. Compute it from conservative lower-bound assumptions, then apply:

```text
position_fraction = min(
  hard_position_cap,
  volatility_target_fraction,
  correlation_adjusted_fraction,
  fractional_kelly_multiplier * estimated_kelly_fraction
)
```

If the estimated edge is negative, unstable, or confidence is low, the Kelly allocation is zero.

## Kill switches
Pause strategy when:
- realized drawdown exceeds policy
- slippage exceeds modeled assumption by a set threshold
- signal distribution changes materially
- data feed quality degrades
- paper/live fills diverge from simulation
- realized correlation with other strategies spikes
- model outputs become concentrated in a way not seen in validation
- paper-trading degradation breaches the predeclared tolerance
- borrow, liquidity, or capacity assumptions become invalid
