# Mechanical Floor

Every Story Engine adventure packet must clear this floor. Each rule is binary: it passes or it fails, and a reviewer can verify it without judgment calls. Outcome adjudication craft (success, failure, cost, fail-forward) is governed by scene-and-check-standard.md; this file owns the numbers. The quality gate in ben-grade-gate.md assumes this floor is already met.

## 1. Creatures and Stat Blocks

- [ ] Every creature that can be fought has either a complete stat block in the packet or an exact citation: block name plus source book (e.g., "bandit captain, Monster Manual"). "Use an appropriate guard" fails.
- [ ] Any NPC the text contemplates restraining, chasing, grappling, intimidating into a scuffle, or fighting — including socially framed NPCs — has at least a one-line stat assignment (e.g., "Mera: commoner, MM" or "AC 12, 9 hp, +2 to hit, 1d6 club").
- [ ] The villain's signature ability has full mechanics: action type, save DC or attack bonus, range or area, effect, and its counter or limitation. A prose description of what the ability "does" without these numbers is a blocking defect — the DM discovers the gap mid-combat.

## 2. DC Bands

- [ ] At tiers 1–2: easy = DC 10, medium = DC 13–14, hard = DC 16–17.
- [ ] For each tier above tier 2, every band shifts up one step: tier 3 is easy 13–14, medium 16–17, hard 19–20; tier 4 one step further.
- [ ] Every check names a skill or tool: "DC 13 Wisdom (Insight)", not "DC 13 Wisdom check". No naked ability checks anywhere in the packet.
- [ ] No DC falls outside its band unless the packet states why in the same passage.

A DC that sits in the correct band but lacks adjudication (success, failure, cost, continuation) still fails under scene-and-check-standard.md. Both standards apply to every check.

## 3. Encounter Interaction

Recorded rulings (2026-07-02): "In 5th edition, XP as a measure of encounter difficulty is an incredibly imprecise metric." / "It's better to provide encounter adjustments as suggestions to the DM, than to try and guess the party's strength and composition ahead of time." / "Running, bargaining, and allowing themselves to be captured are all viable alternatives to death."

Encounters are designed party-agnostic: the packet targets a level band and default party size (stated on the cover) and never guesses composition, classes, or specific resources — the DM owns the matchup at the table, and the packet's job is to arm that judgment. The teaching case: five 4th-level characters versus a tyrannosaurus reads "deadly" by XP, but its two attacks cannot stack on one target, it has no control resources to interdict bonus-action ranged healing, and its Dex save loses to any restraint — in play, the only live death vector is a bite crit tripping massive damage. XP measured the mass; the interaction decides the fight.

Recorded ruling (2026-07-02): "The DM doesn't need to see the DPR math." The interaction analysis is the writer's verification, not the DM's reading — it lives in design notes and the quality review, never in the manuscript.

**Evidence priority:** observed play at Ben's table, when supplied, is the controlling calibration evidence. Record enough circumstances to interpret it — party count and level, relevant capabilities or recovery, opposition, objective, terrain, rounds, losses, and Ben's difficulty judgment — then explain what the next design changes in response. Interaction analysis is the next-best predictor; CR, XP, nominal level, and encounter-budget math are sanity screens only. When observed play contradicts the budget, diagnose the actual action economy, control, recovery, objective, and kill vector instead of defending the budget or blindly multiplying hit points.

**Design-side analysis** (recorded in the brief's design notes or the quality review; verified by the QA panel's rules checker; a few plain sentences, never a spreadsheet):

- [ ] **Observed table evidence, if supplied:** the brief states the conditions, result, Ben's difficulty judgment, and the specific calibration response. If none was supplied, record `none` rather than inventing evidence.
- [ ] **Damage per round, both ways:** the opposition's realistic DPR against typical hit-point pools at the target level, translated into rounds.
- [ ] **Action economy and tone:** the action ratio and the tone it buys — one big monster reads heroic (players own the table time), a horde reads desperate (monster turns dominate), an even split reads strategic. Choose the monster count for the scene's intended feeling. Any solo boss still needs minions, terrain, lair pressure, or an escape plan — a lone boss with no action-economy support fails regardless of its CR.
- [ ] **Control:** what each side can shut down — stuns, grapples, restraints, silence, counterspell, fear — phrased by capability, never by guessed party list.
- [ ] **Recovery:** how the encounter interacts with recovery resources, stated conditionally — bonus-action ranged healing breaks pure attrition, so say what remains when it is present.
- [ ] **Kill vector, named and conditional:** attrition, spike, or lockdown-then-focus, with its counter. If no vector survives common recovery resources, the encounter is theater — say so and design its tone deliberately. Variance rises by tier: single-hit maximums against low-hp members and save-or-lose effects are part of the vector at every tier.
- [ ] XP totals may appear here as a one-line sanity screen. They are never the difficulty claim, and no encounter passes or fails on XP math alone.

**Manuscript-side presentation** (what the DM actually reads; format per module-format-standard.md) — recorded ruling (2026-07-02), every combat answers three questions:

- [ ] **Why is it happening?** What triggers combat in this scene, and what could avoid it.
- [ ] **Who are the enemies?** Initial positions on the battlemap, and the strategies they employ.
- [ ] **What are the results?** Morale stated plainly — fight until bloodied and surrender, or fight to the death; what can be lost, found, broken, or protected; and how the mechanical outcome tangibly changes the narrative state of the game, if at all.
- [ ] **Ways out, in the fiction:** any encounter that can kill states its alternatives — where the exit is, what the enemy will bargain for, whether it takes prisoners. Defeat is a story continuation, not only a TPK.
- [ ] **Adjusting the encounter, AL-style:** a short sidebar of suggestions offered to the DM — at minimum a 3-player and a 6-player lever derived from action economy, plus one sharpen and one soften lever — never prescribed as automatic.

DPR figures, kill-vector language, XP thresholds, and action-economy ratios appearing in the manuscript are scaffold leakage (ben-grade-gate.md).

## 4. Rewards Floor

- [ ] Gold or valuables total is stated and sits in a band appropriate to party level (DMG treasure guidance is the reference).
- [ ] At least one magic item or strong consumable, sourced from the fiction: owned, guarded, hidden, or made by someone in this adventure. Loot with no owner or origin fails.
- [ ] An explicit advancement line: milestone ("characters reach level 4 after the finale") or XP totals. Silence on advancement is a defect.

## 5. Clocks and Trackers

Every clock, timer, doom track, or counter states all four of:

- **Unit** — rounds, minutes, hours, scenes, failed checks.
- **Tick trigger** — exactly what advances it.
- **Thresholds** — what changes at intermediate values, if anything.
- **Endpoint** — exactly what happens when it fills or expires.

A clock referenced anywhere in the packet but never defined with all four parts is a blocking defect. "The ritual nears completion" with no track behind it fails.

## 6. Timing Budget

- [ ] The packet states the slot length and its playable content budget = slot minus 30 minutes of table friction (arrivals, rules questions, breaks, recap). A 4-hour slot holds 3.5 hours of content.
- [ ] Content is planned to the playable budget, not the slot. If planned scenes exceed the budget, the packet marks which scenes cut first.

## 7. Load-Bearing Counterplay

- [ ] During design, identify the one tier-appropriate spell or ability most likely to bypass the adventure's central custom pressure.
- [ ] If ordinary system rules and the scene facts already answer it, add no manuscript text.
- [ ] If the interaction is custom, counterintuitive, or changes the adventure's moral or mechanical engine, state the concrete result beside the first likely interaction. Use a detached sidebar only when the same ruling must be referenced across several separated areas.
- [ ] If the central pressure genuinely breaks under the ability, say so plainly and state what changes next. "The spell inexplicably fails" is a defect unless the fiction genuinely supports the block.

## Recording Failures

Any line above that fails is a defect and must appear in the quality review. Blocking defects — a fightable creature with no block or citation, a villain signature ability without full mechanics, an undefined referenced clock, or an unresolved load-bearing custom interaction — stop the packet until fixed.
