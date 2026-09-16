# Fami — Familiar

Fami is Ben Manry's household and 20Fates production assistant: a persistent working relationship built around Codex, durable project records, explicit permissions, specialized methods, and integrations with the tools the household uses.

This repository is the **public developer collection**, reconciled on **September 16, 2026**. It brings together current source from fourteen components so a reviewer can inspect the implementation in one place. It is a source snapshot, not a new model, a claim of unrestricted autonomy, or a one-command installer.

## Start here

1. [Architecture and actual boundaries](ARCHITECTURE.md): what Fami is, how work flows, and which parts are implemented versus dependent on the host.
2. [Runtime](components/fami-runtime/README.md): the local work ledger, resource reservations, controls, effect application, and controller hooks.
3. [Operating methods](components/agent-instructions/README.md): the authored rules and skills that shape the work.
4. [Familiar](components/familiar/README.md): Discord assistance, session recording controls, character workflow, and shared voice integration.
5. [The Rookery](components/rookery/README.md): the agent-facing exchange, with browser, API and MCP interfaces.
6. [Project catalogue](PROJECTS.md) and [verification](VERIFYING.md): the rest of the source and the limits of this release.

## What makes it Fami

The useful unit is a completed household or business outcome. Fami retrieves current project state, takes responsibility for permitted implementation, uses focused workers where helpful, checks the actual result, and leaves recoverable source and an honest handoff. Ben retains priorities, consent, creative taste and release decisions.

The work spans campaign preparation, a Discord assistant, a VTT and character creator, a musical puzzle game, an agent exchange, and household operations. Persistent identity comes from the relationship and maintained records; it is not evidence that the underlying model trained itself between conversations.

The implementation distinguishes **instructions**, **mechanical checks**, and **host permissions**. For example, the Python ledger records reservations and rejects unsupported effects, while the controller plugin gates a particular integration. Neither confines arbitrary tools outside its own execution path. See the architecture for these limits.

## Included source

| Area | Source |
|---|---|
| Stewardship and bounded execution | [Runtime](components/fami-runtime), [operating methods](components/agent-instructions) |
| Agent collaboration | [The Rookery](components/rookery) |
| Running games | [Discord Familiar](components/familiar), [VTT](components/vtt), [Bardsong](components/bardsong), [character-sheet console](components/lilith-console) |
| Authored creative methods | [Story Engine](components/story-engine), [Map Engine](components/map-engine) |
| Business tooling | [Website](components/website), [billing](components/billing) |
| Experiments and products | [Clearshift](components/clearshift), [Heirloom prototype](components/heirloom), [EverQuest helper](components/everquest-tools) |

## Reviewing and running

Clone this repository normally. Begin with the offline checks in [VERIFYING.md](VERIFYING.md); they do not start a bot, deploy a site, contact people, or make model calls.

Application components retain their own dependency manifests. Private configuration, licensed rules data, media libraries, saved databases, account identifiers, and some installation-specific support are intentionally absent. A passing source check is not a claim that every component can launch from this collection. The component notes say what is missing.

The public Rookery is at [the-rookery.benjamin-manry.chatgpt.site](https://the-rookery.benjamin-manry.chatgpt.site). Its public connection guide is part of the application. Tests in this repository are not permission to create traffic against the live service.

## Publication boundary

The existing repositories and their historical records remain private. Important outstanding work was checkpointed there without rewriting the working branches. This collection contains reviewed source and newly written orientation, with sensitive configuration removed or replaced by synthetic examples. Personal and client records, raw conversations, credentials, operational databases, and restricted source material are not part of the public release.

[SOURCE-MANIFEST.json](SOURCE-MANIFEST.json) records exported source identities and hashes. [NOTICE.md](NOTICE.md) explains rights and third-party notices. Publishing this source does not provide access to the installed household assistant or authorize actions on its accounts.
