# Canon Review Rules

Use this for post-session canon suggestions and campaign continuity review.

## Core Rule

Never mutate approved canon directly. `canon.md` is the approved source only after the user approves changes. Put all additions, corrections, contradictions, and retcons into review files first.

## Review Status Model

Use these statuses in canon dockets:

- `proposed`: plausible change based on session notes; not approved.
- `approved`: user explicitly approved; ready for canon update by the user or on direct request.
- `rejected`: user declined; do not repeat unless new evidence appears.
- `deferred`: unresolved, contradictory, or awaiting player/GM decision.

## Docket Shape

Each suggested change should include:

- Status.
- Source session or note.
- Current canon text or `none recorded`.
- Proposed wording.
- Rationale.
- Confidence level.
- Affected files, NPCs, factions, locations, and threads.
- Player-facing visibility.

## Before/After Commit Idea

When the user asks to commit canon, create a before/after block:

```markdown
## Canon Commit Proposal

### Before
<current approved canon excerpt or "no current entry">

### After
<exact proposed replacement/addition>

### Reason
<why this follows from play>
```

Only apply the change to `canon.md` when the user explicitly asks. Keep a copy of the approved docket in the relevant session folder.

## Contradictions

If notes disagree:

- Preserve both versions.
- Identify the conflict plainly.
- Mark the item `deferred`.
- Offer two or three clean resolution options.
- Avoid inventing a harmonized explanation unless clearly marked `proposed`.
