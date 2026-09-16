# Source ROI and Win/Loss Learning

## Explicit stages only

Use structured fields for:

`discovered -> permission verified -> approved -> contacted -> replied -> owner conversation started -> owner conversation qualified -> Session Zero invited -> booked -> completed -> paid seat -> retained four weeks -> closed`

Do not infer a stage from free text. “Did not book,” “planning to contact,” and a draft message are not completed events.

Track research, review, and conversation minutes so a source with revenue but extreme owner cost is visible.

## Reporting

`scripts/analyze_source_roi.py` reports every step with its numerator and denominator. It intentionally never returns “scale.” Its decision rules are conservative:

- fewer than ten contacted opportunities: `insufficient evidence`, or `promising, insufficient evidence` if a seat exists;
- at least two paid seats: `evidence supports continued testing`;
- three qualified conversations and no paid seats: `diagnose conversation-to-seat`;
- at least twenty contacts with no replies or no qualified conversations: `deprioritize`.

These are operating thresholds, not proof of causation. Compare cohorts, message routes, campaign fit, and Ben's time before changing source priority.

## Win/loss review

For every paid seat or closed opportunity, record the reason in the prospect's or Ben's own words when available. Useful categories include schedule, price, campaign fit, trust, response delay, already found a table, and no longer looking. Do not backfill a flattering reason from a guess.

Update source-specific hypotheses only after explicit evidence accumulates. One retained seat is a signal, not a scalable channel.
