---
name: dm-session-producer
description: Manage ongoing D&D campaign operations. Use for campaign workspaces and continuity, transcript intake or local transcription, post-session digests and recaps, canon review and owner-approved promotion, direction slates and quick weekly prep, asset prompts, and Roll20 setup or importer logistics. Do not use for standalone one-shots, five-room dungeons, bounded campaign episodes, module PDFs, or requests for Story Engine-quality outlines, manuscripts, or running notes; use story-engine.
---

# DM Session Producer

Maintain the playable truth and weekly operating rhythm of an ongoing campaign. Keep approved facts, proposals, player-safe material, and GM-only material distinct. Produce the smallest artifact that solves the current table need.

## First Moves

1. Identify the campaign root and read its local instructions, `README.md`, `notes/STATE.md`, and the changed or decision-relevant agent notes under the global orientation rule.
2. Read the campaign's approved sources before drafting. Common files are `campaign.md`, `canon.md`, `party.md`, `npcs.md`, `factions.md`, `locations.md`, `threads.md`, and the latest session record.
3. Treat transcripts, prep, and generated suggestions as evidence or proposals, not approved canon.
4. Apply the workflow or sequence needed for the authorized outcome. If it includes a Story Engine product, prepare the entry package from approved sources and continue under Story Engine when that product is already authorized; do not use this skill to duplicate its adventure pipeline. The same accountable owner may carry both stages. If Ben asked only for light prep or a direction slate, stop at that scope.
5. Use the templates and references named by that workflow. Adapt them to the campaign instead of filling every field mechanically.

The global rulebook governs authority, source loading, review suspension, and stopping; this skill preserves campaign/domain responsibilities.

## Ownership Boundary

This skill owns:

- campaign workspace lifecycle and current state;
- transcript intake, generic local transcription, digests, recaps, and canon dockets;
- canon promotion only after Ben approves the proposed change;
- ordinary direction slates and quick weekly prep that stop short of a polished episode;
- campaign asset prompt lists and requested Roll20 setup or importer logistics.

The canonical `story-engine` skill owns:

- standalone one-shots and adventure concept slates;
- five-room or compact dungeons and keyed sites;
- polished bounded campaign episodes;
- module-grade outlines, manuscripts, running notes, QA, rendering, and PDFs;
- any explicit request for **Story Engine-quality** outline, manuscript, or running notes.

A selected direction does not enter Story Engine automatically. Hand it over only when Ben requests a polished bounded episode, keyed site, module, or Story Engine-quality outline/manuscript/running notes.

## Campaign Workspace

Use `references/campaign-management.md` when creating, inspecting, archiving, or recovering an ongoing campaign. Use `references/new-campaign-session-one.md` before the first session. User-provided campaign facts are approved starter canon unless marked uncertain, optional, or exploratory; generated connective tissue remains proposed.

Default session paths, when the campaign has no stronger convention:

- `sessions/<NNN>/raw_transcript.md`
- `sessions/<NNN>/transcript_digest.md`
- `sessions/<NNN>/player_recap.md`
- `sessions/<NNN>/gm_recap.md`
- `sessions/<NNN>/canon_change_suggestions.md`
- `sessions/<NNN>/prep_pressure_notes.md`
- `prep/<NNN>/adventure_direction_options.md`
- `prep/<NNN>/session_plan.md`
- `prep/<NNN>/dm_running_notes.md`
- `prep/<NNN>/asset_prompt_list.md`
- `prep/<NNN>/roll20_checklist.md`

Do not impose these paths on a project with an established layout.

## Post-Session Closeout

Use `references/transcript-intake.md`, `references/canon-review-rules.md`, and these templates:

- `transcript_digest.md`
- `player_recap.md`
- `gm_recap.md`
- `canon_change_suggestions.md`
- `prep_pressure_notes.md`

If audio needs local transcription, use `scripts/transcribe_audio_local.py`. If Discord captured the session, use `references/discord-transcription.md`: Familiar owns capture and this skill consumes only the exported recording/transcript and capture metadata placed in the campaign workspace.

Preserve exact names when known. Mark uncertainty as `uncertain`, `inaudible`, `crosstalk`, or `unclear`; never guess. Separate table jokes from in-world facts. Keep spoilers and GM-only facts out of the player recap. Do not rewrite canon until Ben approves the docket item.

## Direction Slate And Light Weekly Prep

Use `templates/adventure_direction_options.md` for two to four genuinely different directions when Ben has not selected one. Use `templates/session_plan.md` and the compact `templates/dm_running_notes.md` for light weekly prep: current state, likely opening, a few flexible scene cards, NPC moves, clues, consequences, and the minimum table assets.

Read `references/session-pacing.md`, `references/ben-table-taste.md`, and any campaign style reference such as `references/thrones-style-guide.md`. Use `references/forgotten-realms-lore.md` only when Realms grounding is relevant.

Do not build a module-grade adventure under this skill. When the approved commission includes that product, make the handoff below and apply Story Engine; otherwise return the completed light-prep or direction outcome without silently expanding it.

## Story Engine Handoff

Pass an entry package grounded in owner-approved facts and the existing commission. Retrieve available facts first; a missing packaging form alone is not a new approval gate. Keep unresolved canon explicit and carry any material choice to the required Story Engine structure gate. Include:

- exact campaign root;
- entry state and approved source files;
- party, system, runtime, table, and safety constraints;
- selected direction, if any;
- unresolved or deferred facts, clearly labeled;
- intended handback location and artifact.

Do not summarize session history into new truth for Story Engine. Point to approved campaign state and identify transcripts or recaps only as provenance when their facts have already been accepted. Story Engine returns proposed episode outputs to the owning campaign. It does not update campaign canon. After play, this skill resumes with transcript closeout and a canon docket.

## New Campaign And Session One

Use `references/new-campaign-session-one.md` and `templates/campaign_intake.md`. Create starter campaign state and, unless Ben already chose a direction, a two-to-four-option direction slate. Light notes may stay here. A selected direction requiring a bounded, polished episode goes to Story Engine through the handoff above.

## Roll20 And Assets

Use `references/roll20-prep-contract.md`, `references/roll20-output-bundle.md`, and `templates/roll20_checklist.md` for manual setup. Use `references/roll20-importer-workflow.md`, `templates/roll20_import_manifest.json`, `scripts/build_roll20_importer.py`, and `scripts/roll20_mod_importer_template.js` only when Ben asks for importer automation.

Use `references/asset-art-direction.md` and `templates/asset_prompt_list.md` for campaign/VTT asset prompts. The documented importer workflow ends with a human uploading assets and pasting/running the generated Roll20 Mod script. Complete and verify its offline preparation first; a live Roll20 action remains separately reserved and is not an automatic validation step. Never store credentials, cookies, or tokens in the skill or campaign.

Story Engine may include a manual Roll20 checklist inside its own bounded module. This skill owns separate campaign logistics and importer execution; do not duplicate the adventure manuscript.

## Validation

Use the retained helpers only for their evidenced campaign-operations jobs:

- `scripts/check_campaign.py <campaign-root>`
- `scripts/new_session.py <campaign-root> <session-number>`
- `scripts/compile_packet.py <campaign-root> <session-number>` for one lightweight Markdown table document, not a Story Engine module or PDF
- `scripts/transcribe_audio_local.py --help`

Verify local links, strict UTF-8, whitespace, expected files, player/GM separation, and the campaign's own checks. A plausible recap or prep page is not verified until its source boundary and output paths have been checked.
