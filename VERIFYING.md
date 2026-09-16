# Verification of this public snapshot

Checked on Windows on September 16, 2026. These checks exercised the exported copies, not only the private originals. They used local synthetic fixtures and made no paid model calls or live bot connections.

| Check | Result |
|---|---|
| Python household ledger/effects suite | **49 passed** |
| Familiar player-help, offline transport and mocked provider suite | **38 passed** |
| Clearshift sweep-engine rules | **28 passed** |
| Website owner-ledger and public-key rejection tests | **11 passed** |
| Controller `test.mjs` | **Passed**; controls, identity, instruction consistency and direct-tool rejection |
| Controller `test-images.mjs` on Windows | **Failed** at a POSIX image-path fixture; the integration assumes Linux/WSL paths. Not qualified as Windows-portable. |
| Gitleaks 8.30.1 scan | **Final staged scan: no findings.** An earlier pass identified an explicitly synthetic Stripe-shaped test literal; it was replaced with an inert rejection fixture, and its 11-case suite passed. |
| Independent source privacy review | Completed for runtime/integration and publication exclusions |

## Repeat the passing offline checks

From the repository root, with Python 3 and Node 22.13 or newer on your path:

```sh
python -B -m unittest discover -s components/fami-runtime/tests/household -p test_loop.py
node --test components/clearshift/tests/sweep-engine.test.cjs
```

Familiar's source-based tests expect its component as the working directory:

```sh
cd components/familiar
node --test tests/player-help.test.js tests/offline-discord-transport.test.js tests/deepseek-audition.test.js
```

In `components/website`:

```sh
node --test tests/owner-panel.test.mjs
```

In `components/fami-runtime/config/controller-guard`:

```sh
node --test test.mjs
```

The image, result and dispatch integration tests are distinct checks with installation/path assumptions. The failed Windows image test is retained unchanged; it was not weakened or reported as passing. No Linux rerun was completed for this publication.

## What was not established

No full fourteen-component build, live Discord recording/playback, live financial action, cloud deployment, external-agent mutation test, or audiovisual acceptance test was run for this release. Missing private configuration, licensed catalogue data and media prevent a complete distribution for some components. Historical private acceptance records are not substituted for fresh public-snapshot results.

Secret scanning and review reduce publication risk; they are not proof that arbitrary future additions are safe. The public repository starts with new history and contains no inherited private commit history. Source file identities are recorded in [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json).

## Exact restoration

A fresh clone restored all 618 manifest files with matching hashes when Git's line-ending conversion was disabled. Windows `core.autocrlf=true` can legitimately change working-copy line endings and therefore raw file hashes. For a byte-for-byte source comparison use:

```sh
git clone -c core.autocrlf=false https://github.com/benjaminmanry-dot/fami.git
```

The manifest excludes itself. Later documentation edits refresh its hashes without changing the preserved source implementation.
