# Familiar: Discord integration

Source for player-facing help, consent-aware session recording controls, a character workflow, and shared Discord voice-session ownership used by Bardsong. `bot.js` is the integration entry point; `player-help.js`, `shared-voice-session.js` and the character bridge provide narrower review targets.

This copy contains no bot token, real Discord server state, session recordings or transcripts. Numeric service identifiers in exported fixtures are synthetic. Local capture paths and contact examples have been generalized.

The package includes dependencies for Discord voice, Opus and transcription support. Starting the bot or transcription scripts requires deliberate local configuration and the relevant participants' consent. Provider code is included for inspection; it is not activated by the public snapshot.

Some character tests depend on the private VTT catalogue, which is not redistributed. Use the root [offline verification instructions](../../VERIFYING.md) for the bounded checks run on this export. Live audio quality, server permissions and session capture were not retested for this source-publication task.
