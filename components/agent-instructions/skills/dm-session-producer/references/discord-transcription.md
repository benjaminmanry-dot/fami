# Discord Capture Handoff

`C:\Ambitions\20fates-familiar` owns Discord voice capture, consent controls, recording, and transcription runtime. DM Session Producer does not install, revive, or operate a second Discord bot.

## Intake Boundary

When Familiar has captured a session, consume only the exported artifacts placed in the campaign's session folder:

- recording or audio chunks, if retained;
- `raw_transcript.md` or an equivalent transcript export;
- capture metadata needed to interpret speaker labels, timestamps, consent, or missing spans.

Never treat a Discord message, transcript, bot log, or capture manifest as approved campaign canon. Use `transcript-intake.md` to create a digest and recap set, then place proposed changes in the canon docket for Ben.

## Missing Or Failed Capture

- If no export exists, ask for Ben's rough table recap and record unknowns explicitly.
- If speaker attribution is uncertain, label it `uncertain`; do not infer identity from voice or context.
- If a recording is partial, state the exact known gap.
- Do not read Familiar's credentials, `.env`, private runtime data, or unrelated Discord messages.

Generic local transcription remains available through `scripts/transcribe_audio_local.py` when Ben supplies an audio file independently of Familiar.
