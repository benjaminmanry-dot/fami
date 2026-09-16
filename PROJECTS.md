# Source catalogue

This is a multi-project review snapshot, not a single application workspace. Folder names below are links within this public repository. Original private repository names provide context; they do not grant access to those repositories.

| Original project | Public representation | Status / omitted material |
|---|---|---|
| fami-runtime | [Runtime source and tests](components/fami-runtime) | Ledger, guards, recovery helpers; installed account state omitted. |
| ambition-agent-instructions | [Methods and custom skills](components/agent-instructions) | Public adaptation of governance; selected original skill source. Private approvals and personal corpora omitted. |
| hq | [Architecture](ARCHITECTURE.md) and public operating examples | The private operational binder, personal records, task history and correspondence are not exported. |
| rookery | [Exchange application](components/rookery) | Public application source; database and credentials omitted. Existing Sites origin retained separately. |
| 20fates-familiar | [Discord bot](components/familiar) | Source and synthetic tests; credentials, server records and recordings omitted. |
| 20fates-vtt | [VTT and character creator](components/vtt) | Newer character-creator worktree, including usability work. Licensed catalogue and media omitted; not a complete runnable distribution. |
| campaign-soundpack | [Bardsong DJ](components/bardsong) | Code only; audio, private cue material and live session state omitted. |
| 20fates-website | [Website and owner tooling](components/website) | Latest owner-panel branch. Deployment reports, live account records and image assets omitted. |
| 20fates-billing | [Billing tools](components/billing) | Code only; no customer export, receipts or live financial configuration. |
| lilith-console | [Character-sheet application and extension](components/lilith-console) | Source; private state and supplied media omitted. |
| clearshift | [Musical puzzle game](components/clearshift) | Game code and tests. Audio/art distribution is separate; this collection cannot represent listening quality. |
| heirloom | [Godot prototype](components/heirloom) | Includes work in progress, preserved as such. Large assets and unfinished acceptance work are not promoted to a finished product. |
| everquest | [Authored helper](components/everquest-tools) | Narrow helper source; third-party game files and research archives are not redistributed. |
| story-engine | [Adventure-writing method](components/story-engine) | Skill, templates, scripts and method references; finished/private adventures and source books omitted. |
| 20fates-map-engine | [Map production method](components/map-engine) | Editable-scene tooling and asset-based craft instructions. No map assets or claim that rejected map work passed. |
| ambitions | This catalogue | Workspace index represented here; original private operational index retained privately. |
| avylan | Private campaign archive | No player records, unreleased campaign material or restricted corpus published. |
| king-in-the-cairns | Private campaign archive | Current work checkpointed privately; no campaign archive published. |
| mortal-coil | Private campaign archive | Existing GitHub backup retained; no campaign archive published. |
| one-shots | Private creative archive | Existing GitHub backup retained; reusable method source is represented above. |
| betweenwilds | Private creative archive | Existing GitHub backup retained; no creative archive published. |
| broadsheet | Private early project | No standalone implementation selected for this release. |

## Configuration and build limits

- **VTT:** `lib/character-catalogue.ts` expects a rules catalogue under `data/`. It is deliberately not redistributed. Supply appropriately licensed data before expecting a complete build.
- **Clearshift / Bardsong / Heirloom:** sound, artwork and model assets are omitted. Source inspection and selected logic tests work independently; a complete audiovisual build requires the corresponding assets.
- **Rookery:** `.openai/hosting.json` is a placeholder for a new operator's configuration, not the household deployment identity. Upstream vendored CSS retains its license. The source is not automatically deployed by cloning it.
- **Familiar:** bot startup needs the operator's Discord configuration and approved provider setup. Certain character tests depend on the omitted VTT data. Offline tests use synthetic inputs.
- **Runtime integration:** some paths describe the original Windows/WSL layout. The OpenClaw/Hermes integration requires its host and appropriate permissions; the example policy does not enable it.

Package manifests and scripts are retained for source review. Commands that deploy, authenticate, contact a service, record audio, or make paid requests require a separately configured environment and deliberate operator action.
