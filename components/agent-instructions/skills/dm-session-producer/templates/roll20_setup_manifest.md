# Roll20 Setup Manifest: Session <NNN>

## Bundle Targets

- Campaign:
- Session:
- Source checklist:
- Asset prompt list:
- Shared asset folder: `assets/`
- Roll20 bundle folder: `roll20/`

## Setup Status Key

- `missing`: needed file or text does not exist yet.
- `available`: file/text exists but has not been reviewed.
- `approved`: ready to use at the table.
- `ready`: Roll20 entry can be created now.
- `skip`: optional or intentionally theater-of-the-mind.

## Folder Structure

| Folder | Purpose | Entries |
| --- | --- | --- |
| Session <NNN> - Start Here | Opening notes and run order | <entries> |
| Session <NNN> - Maps | Pages/maps for this session | <entries> |
| Session <NNN> - NPCs | NPC handouts or stat references | <entries> |
| Session <NNN> - Handouts | Player-facing clues and props | <entries> |
| Session <NNN> - GM Notes | Private clocks, rulings, and consequence notes | <entries> |

## Pages

| Page Name | Scene Keys | Map File | Grid | Scale / Dimensions | Lighting | GM Layer | Starting Tokens | Status | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <page> | <A1> | `<filename>` | on/off | <scale> | <notes> | <hidden notes> | <tokens> | <status> | <fallback> |

## Tokens

| Token Name | Visible Name | Image File | Represents | Page / Placement | Layer | Size | Bars / Auras / Markers | Stat Source | Status | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <token> | <visible> | `<filename>` | <npc/creature/hazard> | <page/location> | object/GM/map | <size> | <notes> | <source> | <status> | <fallback> |

## Handouts

| Handout Title | Image File | Player Text Source | GM Notes Source | Reveal Timing | Folder | Permissions | Status | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <handout> | `<filename>` | <source> | <source> | <when> | <folder> | <permissions> | <status> | <fallback> |

## Journal Entries

| Entry Title | Type | Source | Folder | Permissions | Status |
| --- | --- | --- | --- | --- | --- |
| <entry> | NPC/stat/GM note/player note | <file/section> | <folder> | <permissions> | <status> |

## Setup Sequence

### Minimum Viable

- [ ] <required page/map/token/handout>

### Useful Branches

- [ ] <likely route or branch setup>

### Polish

- [ ] <optional ambience, extra art, or nice-to-have>

## Missing Or Blocked Items

| Priority | Item | Blocking Issue | Workaround |
| --- | --- | --- | --- |
| required/useful/optional | <item> | <missing art/text/ruling> | <fallback> |

## Final Roll20 Readiness

- [ ] Required pages exist.
- [ ] Required maps are assigned or fallback sketches are ready.
- [ ] Required tokens are placed or labeled.
- [ ] Required handouts are created with player-facing text.
- [ ] GM-only notes are not visible to players.
- [ ] Dynamic lighting is checked or intentionally skipped.
- [ ] Opening scene is ready.
- [ ] Sideways route fallback is ready.
