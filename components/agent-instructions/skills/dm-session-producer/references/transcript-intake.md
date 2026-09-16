# Transcript Intake

Use this when Ben supplies session audio, an exported capture, a raw transcript, or a rough table recap.

## Source Order

1. Preserve the original recording/export and its provenance.
2. If audio requires local transcription, use `scripts/transcribe_audio_local.py` or an already-installed local tool. Do not add API transcription or new dependencies merely for this workflow.
3. Save or locate `raw_transcript.md` in the campaign's established session folder.
4. Produce `transcript_digest.md` before recaps or canon proposals.
5. Use the digest plus Ben's corrections as the stable closeout source. Neither raw transcript nor digest is automatically canon.

If Discord captured the session, follow `discord-transcription.md`. Familiar owns the capture runtime; this skill begins with the exported campaign artifacts. If no capture exists, a rough Ben recap is sufficient, with unknowns left unknown.

## Suggested Layout

```text
sessions/<NNN>/
  audio/
    session-<NNN>-raw.<format>
  raw_transcript.md
  transcript_digest.md
```

Follow an existing campaign convention instead when one exists.

## Digest Content

Record:

- source path, provenance, and confidence;
- speaker map when known;
- timeline and stopping point;
- player choices and stated intentions;
- NPCs, factions, locations, items, spells, debts, and promises;
- crisis/combat outcomes and material resource changes;
- rules questions and unresolved rulings;
- secrets revealed or nearly revealed;
- exact short quotes worth preserving;
- possible canon changes, labeled proposed or needing confirmation;
- prep pressure created by play.

## Uncertainty And Privacy

- Preserve exact proper nouns when known.
- Use `uncertain`, `inaudible`, `crosstalk`, or `unclear` instead of guessing.
- Do not infer a speaker's identity from voice or context.
- Do not silently correct a player or DM statement into canon.
- Separate table jokes and out-of-character plans from in-world facts.
- Keep GM-only truths out of the player recap.
- For a long transcript, digest coherent chunks and then reconcile them without inventing continuity.

## Recap Conversion

After the digest, create only the needed closeout artifacts:

- `player_recap.md`
- `gm_recap.md`
- `canon_change_suggestions.md`
- `prep_pressure_notes.md`

The player recap is spoiler-safe. The GM recap may preserve private consequences and open questions. Canon changes remain proposals until Ben approves them.
