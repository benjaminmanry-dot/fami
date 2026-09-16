# Asset Prompt List: Session <NNN>

This is a prompt list only. Do not generate images or call image APIs unless the user separately asks.

## Map Prompts

| Priority | Target Filename | Prompt | Notes |
| --- | --- | --- | --- |
| required/useful/optional | `map-<NNN>-<location>.png` | <map prompt with zones, hazards, mood, grid preference> | <table purpose> |

## Token Prompts

| Priority | Target Filename | Prompt | Notes |
| --- | --- | --- | --- |
| required/useful/optional | `token-<name>.png` | <token prompt with silhouette, costume, pose, identity cues> | <NPC/creature use> |

## Handout Prompts

| Priority | Target Filename | Prompt | Notes |
| --- | --- | --- | --- |
| required/useful/optional | `handout-<object>.png` | <object prompt; no fake readable text; use blank spaces or symbolic marks> | <reveal timing> |

## Approval Checklist

- [ ] Each asset solves a table problem.
- [ ] No prompt requests fake readable text.
- [ ] Filenames are lowercase kebab-case.
- [ ] Required assets are clearly separated from optional polish.
- [ ] Style matches the campaign.
