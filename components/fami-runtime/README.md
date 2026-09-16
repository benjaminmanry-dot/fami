# Fami runtime source

The portable starting point is `scripts/household_loop.py`, `scripts/household_effects.py`, the synthetic fixtures, and `tests/household/test_loop.py`. They implement the local ledger and bounded application of supported effects.

`config/controller-guard/` is an OpenClaw integration: controls, instruction-copy checks, ACP dispatch, result acceptance, and subscription-route validation. Its hooks and tests describe a particular integration; they are not a general OS sandbox. The files retain installation assumptions such as `/home/fami/` and `/mnt/c/Ambitions/`.

Additional source includes the gaming preflight, result snapshots, SQLite backup helper, selected recovery tests and the Hermes launch/proof path. The latter require the original type of Windows/WSL setup and are included for inspection, not as an automatic installer. No host configuration, authentication store or saved conversation accompanies them.

The policy example contains empty grants, unqualified routes and replacement paths. Supply your own control file, protected paths, resource coverage and permissions before enabling any route. An inert control-file example is in [examples/estate-map.md](examples/estate-map.md).

See the root [verification record](../../VERIFYING.md) for checks actually run on this public snapshot. Tests that manipulate real host state are not part of that offline check set.
