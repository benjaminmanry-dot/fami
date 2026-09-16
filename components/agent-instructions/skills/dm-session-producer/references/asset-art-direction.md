# Campaign Asset Art Direction

Use this for campaign and VTT asset prompt lists. Story Engine owns production art direction for its bounded adventure packets.

## Workflow

1. List each asset's table purpose, priority, target filename, and approved style constraints.
2. Generate an asset only when Ben requests it; use the available image-generation workflow, not a new API script.
3. Keep maps, tokens, and handouts as independent source files.
4. Store them in the campaign's established asset location and reference stable filenames from the VTT checklist or manifest.
5. Inspect generated work at full resolution before marking it usable.

## Prompt Content

For maps, name the tactical purpose, viewpoint, major zones, chokepoints, hazards, lighting, grid preference, and target filename.

For tokens, name the creature/NPC, table role, silhouette, pose, readable identity cues, background treatment, and target filename.

For handouts, name the object, player-facing use, material, damage, symbols, blank text areas, and target filename. Do not request fake readable text; add real text outside the generated image.

## Discipline

- Required means the session is materially harder to run without it.
- Avoid mood-only prompts that do not solve a table problem.
- Preserve the campaign's approved visual style.
- Reject malformed geometry, anatomy, perspective, or contaminated visual language rather than using it as a later reference.
- Use lowercase, stable filenames such as `map-<session>-<location>.png`, `token-<name>.png`, and `handout-<object>.png`.
