# Roll20 Prep Contract

Use this to produce Roll20 prep checklists and companion setup manifests. Do not upload assets, drive the browser, write import automation, or assume API access in this phase.

## Maps And Pages

For each needed page, specify:

- Page name.
- Purpose at table.
- Map asset needed or `theater of the mind`.
- Suggested dimensions or scale if known.
- Grid requirement.
- Dynamic lighting notes.
- Fog/exploration notes.
- GM layer reminders.

## Tokens

For each token, specify:

- Token name.
- NPC/monster/source.
- Player-visible name.
- Status: ready, needs art, needs stat block, optional.
- Default placement.
- Auras, bars, or markers if useful.

## Handouts

For each handout, specify:

- Handout title.
- Player-facing text.
- GM-only notes.
- Image or prop need.
- When to reveal.

## Dynamic Lighting Notes

Keep lighting practical:

- Mark doors, secret doors, windows, and elevation changes.
- Note bright/dim/dark zones.
- Flag any scene where lighting complexity is not worth setup time.
- Include a fallback if lighting is skipped.

## Missing Assets

Group missing assets by priority:

- Required before session.
- Useful if time allows.
- Nice but skippable.

## Setup Tiers

Include a minimum viable setup tier so the DM can run even if prep time is short:

- Must prep: pages, maps, handouts, or tokens needed for the opening and core crisis.
- Should prep: assets that improve likely branches.
- Can skip: polish with a theater-of-the-mind fallback.

For each scene, state the fallback if the map, token, handout, or lighting is not ready.

## Readiness Checklist

End every Roll20 prep artifact with:

- Pages created.
- Maps assigned.
- Tokens placed or queued.
- Handouts drafted.
- Lighting checked or intentionally skipped.
- Music/ambience optional.
- Backup theater-of-the-mind plan.
- Final "ready to run?" status.

## Setup Manifest Companion

When useful, also produce `roll20_setup_manifest.md`. The checklist is for the DM's human review; the setup manifest is the structured output that captures exact pages, assets, token placements, handout titles, permissions, lighting, and setup order.

The setup manifest should be specific enough that the DM can set up Roll20 without rereading all prep notes and that importer tooling could consume it later.
