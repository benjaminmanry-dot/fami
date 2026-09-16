# Research Harness Policy

## Core Idea

Use the bundled harness to make the research workflow harder to skip. A candidate should move through a strategy card, prior score, manifest, ledger entry, audit, report, and paper-trading review.

## Files

- `schemas/strategy_card.schema.json`: machine-checkable strategy card contract.
- `schemas/candidate_intake.schema.json`: lightweight exploratory candidate contract.
- `schemas/trial_ledger_entry.schema.json`: machine-checkable trial ledger entry contract.
- `scripts/score_candidate.py`: validate a strategy card and compute the base-rate prior score.
- `scripts/update_trial_ledger.py`: append JSONL entries for every tested variant.
- `scripts/audit_research_run.py`: inspect a research run for missing artifacts and incomplete controls.
- `scripts/scaffold_research_run.py`: create a reproducible manifest.
- `scripts/generate_synthetic_market.py`: create synthetic no-edge, known-edge, split, and order-timing fixtures.
- `scripts/run_control_tests.py`: write `simulation_integrity.json` from synthetic fixture and strategy-result checks.
- `templates/report.md`: standard research report skeleton.

## Recommended Sequence

1. For exploration, draft `candidate_intake.json` using `schemas/candidate_intake.schema.json`.
2. For discovery and later stages, draft `strategy_card.json` using `schemas/strategy_card.schema.json`.
3. Run `scripts/score_candidate.py strategy_card.json --write-back` before optimization.
4. Create a manifest with `scripts/scaffold_research_run.py`.
5. Append one `scripts/update_trial_ledger.py` entry for every optimization or validation variant.
6. Generate synthetic fixtures with `scripts/generate_synthetic_market.py`.
7. Run `scripts/run_control_tests.py --require-strategy-results` before promotion to paper trading.
8. Run `scripts/audit_research_run.py --stage promotion` before promoting any candidate.
9. Use `templates/report.md` for the final report.

## Enforcement Rules

- Do not optimize before the strategy card has an edge family and prior score.
- Do not expand optimization-stage parameter search without a ledger entry.
- Do not promote without simulation integrity, negative controls, cost sensitivity, multiple-testing documentation, and portfolio contribution when relevant.
- Do not treat missing artifacts as harmless. Missing evidence should lower the verdict.

## Standard Artifact Names

Prefer these names inside a run folder:

- `strategy_card.json`
- `manifest.json`
- `trial_ledger.jsonl`
- `data_audit.md`
- `friction_capacity.md`
- `backtest_report.md`
- `validation_report.md`
- `simulation_integrity.json`
- `negative_controls.md`
- `parameter_stability.md`
- `portfolio_contribution.md`
- `paper_trading_report.md`
- `research_report.md`
