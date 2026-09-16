import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createCharacterSheet,
  importCharacterSheet,
  skillDefinitions,
  splitGoldPieces,
} from "../lib/character-sheet.ts";
import {
  assistantCanUseDmSources,
  assistantMode,
  assistantNeedsExplanation,
  assistantSearchQuery,
  assistantSourceUrl,
  buildAssistantMessages,
  compactCharacterSheet,
  directCombatRoundGuide,
  directCharacterSheetFact,
  directPlayerKnowledgeBoundary,
  extractAssistantAnswer,
  isDirectCharacterSheetLookup,
  preferredAssistantRule,
  preferredAssistantRules,
  playerSafeAssistantSources,
  playerStrategyAnswerIsSafe,
  playerStrategyContext,
  rankAssistantSources,
  sanitizeAssistantHistory,
} from "../lib/assistant.ts";
import {
  applyCharacterBuild,
  builderBackgroundBoostMethods,
  createCharacterBuild,
  featureChoicesForBuild,
  validateCharacterBuild,
} from "../lib/character-builder.ts";
import { detectSquareGrid } from "../lib/grid-detection.ts";
import {
  buildViewerLighting,
  inferArtworkLightDraft,
  inferArtworkWallDraft,
  pointInPolygon,
  visibilityPolygon,
} from "../lib/lighting.ts";
import { parseUvtt } from "../lib/uvtt.ts";
import { buildMeasurementGeometry } from "../lib/measurement.ts";
import { reanchorSegment } from "../lib/map-geometry.ts";
import { shouldBeginCameraPan } from "../lib/tabletop-gestures.ts";
import { roomStateForActor } from "../lib/room-view.ts";
import {
  applyRoomOperation,
  createInitialRoomState,
  isUndoableRoomOperation,
  measureDistanceFeet,
  parseRoomState,
  parseDiceFormula,
  RoomStateError,
  validatedBackupState,
} from "../lib/room-state.ts";

const roomId = "ABC234";
const alice = { roomId, clientId: "player-alice", isDm: false };
const bob = { roomId, clientId: "player-bobby", isDm: false };
const dm = { roomId, clientId: "dungeon-master", isDm: true };

test("camera pan uses the whole play surface without capturing interface overlays", () => {
  assert.equal(shouldBeginCameraPan({ button: 0, panToolActive: true, region: "map" }), true);
  assert.equal(shouldBeginCameraPan({ button: 0, panToolActive: true, region: "table-margin" }), true);
  assert.equal(shouldBeginCameraPan({ button: 1, panToolActive: false, region: "table-margin" }), true);
  assert.equal(shouldBeginCameraPan({ button: 2, panToolActive: false, region: "table-margin" }), true);
  assert.equal(shouldBeginCameraPan({ button: 0, panToolActive: false, region: "map" }), false);

  for (const button of [0, 1, 2]) {
    assert.equal(
      shouldBeginCameraPan({ button, panToolActive: true, region: "interface" }),
      false,
      `overlay button ${button} must remain interactive while Pan is selected`,
    );
  }
});

test("assistant retrieval queries are safe FTS prefixes", () => {
  assert.equal(
    assistantSearchQuery("How does Sneak Attack (2024) work?"),
    '"sneak"* OR "attack"* OR "2024"* OR "work"*',
  );
  assert.equal(assistantSearchQuery("What is it?"), '"rules"*');
});

test("assistant receives sheet facts without layout or freehand ink", () => {
  const sheet = createCharacterSheet("token-alice", "Alice", "sheet-alice-01");
  sheet.identity.className = "Rogue";
  sheet.strokes.push({ id: "ink", color: "#000", width: 3, points: [{ x: 1, y: 2 }] });
  const compact = compactCharacterSheet(sheet) as Record<string, unknown>;
  assert.equal((compact.identity as { className: string }).className, "Rogue");
  assert.equal("strokes" in compact, false);
  assert.equal("modules" in compact, false);
});

test("assistant prompts ground answers and preserve source citations", () => {
  const messages = buildAssistantMessages({
    question: "How does Sneak Attack work?",
    sheet: createCharacterSheet("token-alice", "Alice", "sheet-alice-01"),
    sources: [{ source: "Player's Handbook", section: "Rogue > Sneak Attack", content: "Relevant rule text." }],
    history: sanitizeAssistantHistory([
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Manshoon has Counterspell." },
    ]),
    isDm: false,
  });
  assert.match(messages[0].content, /Never invent a rule/);
  assert.match(messages[0].content, /immediately in one sentence/);
  assert.match(messages[0].content, /direct sheet-value lookup, give only the value from the authorized sheet/);
  assert.doesNotMatch(messages[0].content, /Passive Perception is 14/);
  assert.match(messages[0].content, /Expand only when the player asks how or why/);
  assert.match(messages[0].content, /multiple features use the same Bonus Action or Reaction/);
  assert.match(messages[0].content, /bold uppercase label: \*\*MOVEMENT\*\*, \*\*ACTIONS\*\*/);
  assert.doesNotMatch(messages[0].content, /"planId":"exact-plan-id"/);
  assert.doesNotMatch(messages.at(-1)?.content ?? "", /tactical_plan_cards/);
  assert.match(messages[0].content, /use only facts the player explicitly supplied/);
  assert.match(messages.at(-1)?.content ?? "", /Player's Handbook — Rogue &gt; Sneak Attack/);
  assert.equal(messages.some(({ content }) => content.includes("Manshoon has Counterspell")), false);
  assert.equal(extractAssistantAnswer({ result: { response: "Grounded answer" } }), "Grounded answer");
});

test("player-safe Familiar access excludes adventures, monsters, and unrelated setting lore", () => {
  const sheet = createCharacterSheet("token-lilith", "Lilith", "sheet-lilith");
  sheet.identity.className = "Berserker Barbarian";
  sheet.identity.species = "Plasmoid";
  sheet.identity.level = 6;
  sheet.details.classFeatures = "Frenzy (While raging): Extra damage.";
  sheet.details.feats = "Polearm Master (Bonus / reaction): Polearm pressure.";
  sheet.spellcasting.spells.push({
    id: "spell-tasha",
    level: 1,
    name: "Tasha's Hideous Laughter",
    castingTime: "Action",
    range: "30 feet",
    concentration: true,
    ritual: false,
    material: "",
    notes: "",
  });
  const sources = [
    { source: "Player's Handbook (2024)", section: "Rules Glossary > Concentration", content: "Player rule." },
    { source: "Player's Handbook (2024)", section: "Player's Handbook (2024) > Classes and Subclasses > Fighter > Level 1 > Weapon Mastery", content: "Wrong class rule." },
    { source: "Player's Handbook (2024)", section: "Player's Handbook (2024) > Classes and Subclasses > Barbarian > Level 1 > Rage", content: "Current class rule." },
    { source: "Player's Handbook (2024)", section: "Path of the Berserker > Level 6 > Feature", content: "***Mindless Rage.*** Current feature." },
    { source: "Player's Handbook (2024)", section: "Path of the Berserker > Level 10 > Feature", content: "***Retaliation.*** Future feature." },
    { source: "Astral Adventurer's Guide", section: "Astral Adventurer's Guide > Plasmoid", content: "Owned species rule." },
    { source: "Tasha's Cauldron of Everything", section: "Path of the Berserker", content: "Owned subclass rule." },
    { source: "Tasha's Cauldron of Everything", section: "Tasha", content: "Unrelated setting lore." },
    { source: "Waterdeep - Dragon Heist", section: "Choose Your Villain > Manshoon", content: "Adventure secret." },
    { source: "Monster Manual (2025)", section: "Mage", content: "Monster stat block." },
    { source: "Sword Coast Adventurer's Guide", section: "Neverwinter", content: "Setting lore." },
  ];

  assert.deepEqual(
    playerSafeAssistantSources(
      sources,
      sheet,
      "What should I do if we're facing spellcasters?",
    ).map(({ section }) => section),
    [
      "Rules Glossary > Concentration",
      "Player's Handbook (2024) > Classes and Subclasses > Barbarian > Level 1 > Rage",
      "Path of the Berserker > Level 6 > Feature",
      "Astral Adventurer's Guide > Plasmoid",
      "Path of the Berserker",
    ],
  );
  assert.deepEqual(
    playerSafeAssistantSources(
      sources,
      sheet,
      "What does Retaliation do at level 10?",
    ).map(({ section }) => section),
    [
      "Rules Glossary > Concentration",
      "Player's Handbook (2024) > Classes and Subclasses > Barbarian > Level 1 > Rage",
      "Path of the Berserker > Level 6 > Feature",
      "Path of the Berserker > Level 10 > Feature",
      "Astral Adventurer's Guide > Plasmoid",
      "Path of the Berserker",
    ],
  );
  const spellSources = [
    {
      source: "Player's Handbook (2024)",
      section: "Player's Handbook (2024) > Spells > Find Traps",
      content: "Spell rule.",
    },
    {
      source: "Player's Handbook (2024)",
      section: "Player's Handbook (2024) > Spells > Imprisonment",
      content: "Spell rule.",
    },
  ];
  assert.deepEqual(
    playerSafeAssistantSources(spellSources, sheet, "How should I handle a dungeon full of traps?"),
    [],
  );
  assert.deepEqual(
    playerSafeAssistantSources(
      spellSources,
      sheet,
      "What should I do if affected by an Imprisonment spell?",
    ).map(({ section }) => section.split(" > ").at(-1)),
    ["Imprisonment"],
  );
  assert.equal(assistantCanUseDmSources(false, sheet), false);
  assert.equal(assistantCanUseDmSources(true, sheet), false);
  assert.equal(assistantCanUseDmSources(true, null), true);
});

test("player strategy receives only current sheet facts", () => {
  const question = "What should I do in combat against enemies?";
  const spellcasterQuestion = "What should I do if we're facing spellcasters?";
  const sheet = createCharacterSheet("token-lilith", "Lilith", "sheet-lilith");
  sheet.vitals.speed = 40;
  sheet.inventory.push({
    id: "prism-scythe-item",
    name: "Prism Scythe +2",
    quantity: 1,
    weight: 6,
    category: "Weapon",
    equipped: true,
    notes: "",
  });
  sheet.attacks.push({
    id: "prism-scythe-attack",
    name: "Prism Scythe +2",
    attackBonus: 9,
    damage: "2d6+6",
    damageType: "Slashing",
    notes: "Heavy, Reach",
  });
  sheet.resources.push({ id: "rage", name: "Rage", current: 2, max: 3, reset: "Long rest" });
  sheet.details.classFeatures = "Rage (Bonus Action): Enter Rage. Reckless Attack (Attack): Trade safety for Advantage.";
  sheet.details.speciesTraits = "Viscous Skin (Reaction): Custom feature.";
  sheet.details.feats = "Polearm Master (Bonus / reaction): Polearm pressure. Sentinel (Reaction): Protect allies.";

  const context = playerStrategyContext(question, sheet);
  assert.ok(context);
  assert.equal(context.movementFeet, 40);
  assert.deepEqual(context.equippedAttacks, [{
    id: "prism-scythe-attack",
    name: "Prism Scythe +2",
    attackBonus: 9,
    damage: "2d6+6",
    damageType: "Slashing",
    notes: "Heavy, Reach",
  }]);
  assert.ok(context.resources.some(({ name, current, max }) =>
    name === "Rage" && current === 2 && max === 3
  ));
  assert.deepEqual(
    context.currentFeatures.map(({ name }) => name),
    ["Rage", "Reckless Attack", "Viscous Skin", "Polearm Master", "Sentinel"],
  );
  assert.doesNotMatch(JSON.stringify(context), /Retaliation|Cassalanter|Manshoon/);
  const wrongWeapon = structuredClone(sheet);
  wrongWeapon.attacks[0].notes = "";
  wrongWeapon.inventory.push({
    id: "halberd-in-pack",
    name: "Halberd",
    quantity: 1,
    weight: 6,
    category: "Weapon",
    equipped: false,
    notes: "Heavy, Reach",
  });
  assert.ok(
    playerStrategyContext(question, wrongWeapon)?.unavailableFeatures
      .some(({ name }) => name === "Polearm Master"),
  );

  const sources = [
    {
      source: "Player's Handbook (2024)",
      section: "Player's Handbook (2024) > Rules Glossary > Cover",
      content: "Cover protects a creature behind it.",
    },
    {
      source: "Player's Handbook (2024)",
      section: "Player's Handbook (2024) > Rules Glossary > Concentration > Damage",
      content: "Taking damage requires a Constitution save to maintain Concentration.",
    },
  ];
  const messages = buildAssistantMessages({
    question: spellcasterQuestion,
    sheet,
    sources,
    isDm: false,
  });
  assert.match(messages[0].content, /Start with exactly \*\*PLAN\*\*:/);
  assert.match(messages[0].content, /Never ask for or speculate about hidden enemy statistics/);
  assert.doesNotMatch(messages[0].content, /planId|tactical_plan_cards/);
  assert.match(messages.at(-1)?.content ?? "", /<response_mode>\nstrategy\n<\/response_mode>/);
  assert.match(messages.at(-1)?.content ?? "", /<authorized_character_sheet>/);
  assert.match(messages.at(-1)?.content ?? "", /Prism Scythe \+2/);
  assert.match(messages.at(-1)?.content ?? "", /"currentFeatures":\[\]/);
  assert.doesNotMatch(messages.at(-1)?.content ?? "", /Retaliation|Cassalanter|Manshoon/);
});

test("Familiar scenarios route to the intended response contract", () => {
  const scenarios = JSON.parse(readFileSync(
    new URL("../evals/familiar-scenarios.json", import.meta.url),
    "utf8",
  )) as Array<{ id: string; mode: "rules" | "strategy" | "roleplay"; question: string }>;
  assert.equal(scenarios.length, 16);
  for (const scenario of scenarios) {
    assert.equal(assistantMode(scenario.question), scenario.mode, scenario.id);
  }

  const strategy = buildAssistantMessages({
    question: "How should I handle a dungeon full of traps?",
    sheet: createCharacterSheet("token-alice", "Alice", "sheet-alice-01"),
    sources: [],
    isDm: false,
  });
  assert.match(strategy[0].content, /Start with exactly \*\*PLAN\*\*:/);
  assert.match(strategy[0].content, /\*\*SCOUT\*\*/);
  assert.doesNotMatch(strategy[0].content, /Start with exactly \*\*APPROACH\*\*:/);

  const roleplay = buildAssistantMessages({
    question: "As a warlock, how should I bargain with my patron for greater power?",
    sheet: null,
    sources: [],
    isDm: false,
  });
  assert.match(roleplay[0].content, /Start with exactly \*\*APPROACH\*\*:/);
  assert.match(roleplay[0].content, /matching feature or rules excerpt is not required/);
  assert.match(roleplay.at(-1)?.content ?? "", /<response_mode>\nroleplay\n<\/response_mode>/);
});

test("player requests cannot retrieve hidden NPC or monster mechanics", () => {
  const blocked = [
    "What is the Mage monster's Armor Class?",
    "What are the Cassalanters' weaknesses?",
    "Which spells does Manshoon have?",
    "Does this creature have resistance to fire?",
    "Tell me about this monster.",
  ];
  assert.ok(blocked.every((question) => directPlayerKnowledgeBoundary(question)));
  assert.equal(directPlayerKnowledgeBoundary("How is Armor Class calculated?"), null);
  assert.equal(
    directPlayerKnowledgeBoundary("The mage's Armor Class is 13. Can my +9 attack hit on a 4?"),
    null,
  );
});

test("strategy answers cannot leak hidden mechanics or invent emphasized options", () => {
  const question = "How should I handle spellcasters?";
  const sheet = createCharacterSheet("token-alice", "Alice", "sheet-alice-01");
  const sources = [{
    source: "Player's Handbook (2024)",
    section: "Player's Handbook (2024) > Rules Glossary > Cover",
    content: "Half Cover grants a +2 bonus to AC and Dexterity saving throws.",
  }];
  assert.equal(
    playerStrategyAnswerIsSafe(
      "**PLAN**: Advance carefully.\n**POSITION**: Use Half Cover for +2 AC.",
      question,
      sheet,
      sources,
    ),
    true,
  );
  assert.equal(
    playerStrategyAnswerIsSafe(
      "Keep an eye on the spellcaster's spell slots.",
      question,
      sheet,
      sources,
    ),
    false,
  );
  assert.equal(
    playerStrategyAnswerIsSafe(
      "Ask an ally to cast *Counterspell*.",
      question,
      sheet,
      sources,
    ),
    false,
  );
  assert.equal(
    playerStrategyAnswerIsSafe(
      "Stay 120 feet away.",
      question,
      sheet,
      sources,
    ),
    false,
  );
});

test("assistant expands only for how or why and links trusted 5e.tools references", () => {
  assert.equal(assistantNeedsExplanation("What's my passive Perception?"), false);
  assert.equal(assistantNeedsExplanation("How many Hit Points do I have?"), false);
  assert.equal(assistantNeedsExplanation("How do I calculate passive Perception?"), true);
  assert.equal(assistantNeedsExplanation("How do I handle spellcasters?"), false);
  assert.equal(assistantNeedsExplanation("Tell me why that modifier applies."), true);
  assert.equal(
    assistantSourceUrl({
      source: "Player's Handbook (2024)",
      section: "Player's Handbook (2024) > Rules Glossary > Passive Perception",
    }),
    "https://5e.tools/variantrules.html#passive%20perception_xphb",
  );
  assert.equal(
    assistantSourceUrl({
      source: "Player's Handbook",
      section: "Rogue > Sneak Attack",
    }),
    "https://5e.tools/search.html?q=Sneak%20Attack%20Player's%20Handbook&lucky",
  );
});

test("common personal sheet questions are answered locally", () => {
  const sheet = createCharacterSheet("token-alice", "Alice", "sheet-alice-01");
  sheet.vitals.armorClass = 17;
  sheet.vitals.hpCurrent = 8;
  sheet.vitals.hpMax = 20;
  sheet.vitals.tempHp = 3;
  sheet.passive.bonus = 4;
  sheet.skills.stealth.bonus = 7;
  sheet.coins.gp = 42;
  sheet.spellcasting.slots[2] = { level: 3, total: 3, expended: 1 };

  assert.deepEqual(directCharacterSheetFact("What's my passive Perception?", sheet), {
    label: "Passive Perception",
    value: "14",
    answer: "Passive Perception: 14.",
    followUp: "How is my passive Perception calculated?",
  });
  assert.equal(directCharacterSheetFact("What is my AC?", sheet)?.value, "17");
  assert.equal(directCharacterSheetFact("How many hit points do I have?", sheet)?.value, "8 / 20 (+3 temporary)");
  assert.equal(directCharacterSheetFact("What's my Stealth bonus?", sheet)?.value, "+7");
  assert.equal(directCharacterSheetFact("How much gold do I have?", sheet)?.value, "42 gp");
  assert.equal(directCharacterSheetFact("How many 3rd-level spell slots do I have?", sheet)?.value, "2 / 3");
  assert.equal(directCharacterSheetFact("How is my passive Perception calculated?", sheet), null);
  assert.equal(directCharacterSheetFact("What is passive Perception?", sheet), null);
  assert.equal(isDirectCharacterSheetLookup("What's my passive Perception?"), true);
  assert.equal(isDirectCharacterSheetLookup("What is passive Perception?"), false);
  assert.equal(isDirectCharacterSheetLookup("What can my Armor Class do?"), false);
});

test("common explanations lead with the exact 2024 rule", () => {
  assert.deepEqual(preferredAssistantRule("How is my Armor Class calculated?"), {
    source: "Player's Handbook (2024)",
    section: "Player's Handbook (2024) > Rules Glossary > Armor Class",
  });
  assert.deepEqual(preferredAssistantRule("How is my Stealth bonus calculated?"), {
    source: "Player's Handbook (2024)",
    section: "Player's Handbook (2024) > Chapter 1: Playing the Game > D20 Tests > Ability Checks > Proficiency Bonus",
  });
  assert.equal(preferredAssistantRule("Tell me about my backstory."), null);
  assert.deepEqual(
    preferredAssistantRules("How do I handle spellcasters?").map(({ section }) =>
      section.split(" > ").slice(-2).join(" > ")
    ),
    ["Rules Glossary > Cover", "Concentration > Damage"],
  );
  assert.deepEqual(
    preferredAssistantRules("How should I handle a dungeon full of traps?")
      .map(({ section }) => section.split(" > ").at(-1)),
    ["Finding Hidden Objects", "Search", "Thieves' Tools (25 GP)"],
  );
});

test("compound build questions retrieve named rules instead of empty headings", () => {
  const question = "How does my combat round work as a Plasmoid Berserker Barbarian with Sentinel and Polearm Master?";
  assert.deepEqual(
    preferredAssistantRules(question).map(({ section }) => section.split(" > ").at(-1)),
    ["Your Turn", "Bonus Actions", "Reactions"],
  );
  const ranked = rankAssistantSources(question, [
    {
      source: "Player's Handbook (2024)",
      section: "Player's Handbook (2024) > Classes and Subclasses > Path of the Berserker (Barbarian)",
      content: "### Path of the Berserker (Barbarian)",
    },
    {
      source: "Tasha's Cauldron of Everything",
      section: "Tasha's Cauldron of Everything > Fighter > Hoplite",
      content: "#### Hoplite\n\nSuggested feats include Polearm Master and Sentinel for this example build.",
    },
    {
      source: "Player's Handbook (2024)",
      section: "Player's Handbook (2024) > Sentinel",
      content: "## Sentinel\n\nGuardian and Halt provide the feat's actual rules text for this test.",
    },
    {
      source: "Player's Handbook (2024)",
      section: "Player's Handbook (2024) > Polearm Master",
      content: "## Polearm Master\n\nPole Strike and Reactive Strike provide the feat's actual rules text.",
    },
    {
      source: "Astral Adventurer's Guide",
      section: "Astral Adventurer's Guide > Plasmoid",
      content: "## Plasmoid\n\nAmorphous and Shape Self provide the species' actual rules text.",
    },
    {
      source: "Player's Handbook (2024)",
      section: "Player's Handbook (2024) > Path of the Berserker",
      content: "##### Path of the Berserker\n\nFrenzy provides the subclass's actual rules text here.",
    },
  ]);
  assert.deepEqual(
    ranked.slice(0, 4).map(({ section }) => section.split(" > ").at(-1)).sort(),
    ["Path of the Berserker", "Plasmoid", "Polearm Master", "Sentinel"],
  );
  assert.equal(ranked.some(({ section }) => section.endsWith("(Barbarian)")), false);
});

test("combat-round guides keep actions, Bonus Actions, and Reactions distinct", () => {
  const answer = directCombatRoundGuide(
    "How does my combat round work as a Plasmoid Berserker Barbarian with Sentinel and Polearm Master?",
    [
      {
        source: "Player's Handbook (2024)",
        section: "Player's Handbook (2024) > Sentinel",
        content: "## Sentinel\n\n***Guardian.*** After a creature hits another target, you can make an Opportunity Attack.\n\n***Halt.*** When you hit with an Opportunity Attack, its Speed becomes 0.",
      },
      {
        source: "Player's Handbook (2024)",
        section: "Player's Handbook (2024) > Polearm Master",
        content: "## Polearm Master\n\n***Pole Strike.*** After the Attack action, you can use a Bonus Action to attack with the other end.\n\n***Reactive Strike.*** You can take a Reaction to attack a creature that enters your reach.",
      },
      {
        source: "Player's Handbook (2024)",
        section: "Player's Handbook (2024) > Path of the Berserker",
        content: "## Path of the Berserker\n\n***Frenzy.*** While your Rage is active, Reckless Attack adds damage to your first hit.",
      },
      {
        source: "Astral Adventurer's Guide",
        section: "Astral Adventurer's Guide > Plasmoid",
        content: "## Plasmoid\n\n***Shape Self.*** As an action, you reshape your body. As a Bonus Action, you extrude a pseudopod.",
      },
    ],
  );
  assert.match(answer ?? "", /\*\*MOVEMENT\*\*: Move up to your Speed/);
  assert.match(answer ?? "", /\*\*ACTIONS\*\*: Take one action/);
  assert.match(answer ?? "", /\*\*BONUS ACTIONS\*\*: Pole Strike — after an Attack/);
  assert.match(answer ?? "", /\*\*REACTIONS\*\*: Guardian — a creature within 5 feet/);
  assert.match(answer ?? "", /Reactive Strike — a creature enters/);
  assert.match(answer ?? "", /\*\*EFFECTS\*\*: Halt — an Opportunity Attack hit/);
  assert.match(answer ?? "", /Frenzy — while raging \+ Reckless/);
  assert.doesNotMatch(answer ?? "", /Shape Self/);
  assert.doesNotMatch(answer ?? "", /Immediately after you take the Attack action/);
  assert.match(answer ?? "", /Need: level \+ equipped weapon/);
  assert.ok((answer ?? "").length < 700);
});

test("Lilith-style exports become clear modular sheets", () => {
  const base = createCharacterSheet("token-alice", "Alice", "sheet-alice-01");
  const sheet = importCharacterSheet({
    version: 2,
    meta: { name: "Lilith", level: 6, className: "Berserker Barbarian", race: "Cubeling" },
    vitals: { armorClass: 17, hpCurrent: 60, hpMax: 77, passivePerception: 13 },
    abilities: { str: { label: "Strength", score: 18, save: 8, proficient: true } },
    skills: [{ id: "perception", bonus: 3 }],
    attacks: [{ id: "prism-scythe", name: "Prism Scythe +2", attackBonus: 9, damage: "2d6+6" }],
    inventory: [{ id: "jewelers-tools", name: "Jeweler's Tools", quantity: 1, weight: 2 }],
    coins: { gp: 1077 },
  }, base);

  assert.equal(sheet.name, "Lilith");
  assert.equal(sheet.subtitle, "Level 6 Berserker Barbarian · Cubeling");
  assert.equal(sheet.vitals.hpMax, 77);
  assert.equal(sheet.identity.className, "Berserker Barbarian");
  assert.equal(sheet.identity.species, "Cubeling");
  assert.equal(sheet.abilities.str.score, 18);
  assert.equal(sheet.skills.perception.bonus, 3);
  assert.equal(sheet.passive.bonus, 3);
  assert.equal(sheet.attacks[0].id, "attack-prism-scythe");
  assert.equal(sheet.inventory[0].name, "Jeweler's Tools");
  assert.equal(sheet.coins.gp, 1077);
  assert.equal(sheet.modules.length, 11);
});

test("the default sheet covers every official 2024 character-sheet category", () => {
  const sheet = createCharacterSheet("token-alice", "Alice", "sheet-alice-01");
  assert.deepEqual(sheet.modules.map((moduleData) => moduleData.id), [
    "identity", "vitals", "abilities", "skills", "attacks", "features",
    "resources", "inventory", "spells", "notes", "currency",
  ]);
  assert.equal(sheet.modules.find((moduleData) => moduleData.id === "abilities")?.span, 6);
  assert.equal(sheet.modules.find((moduleData) => moduleData.id === "attacks")?.span, 8);
  assert.equal(sheet.modules.find((moduleData) => moduleData.id === "spells")?.span, 8);
  assert.equal(sheet.modules.find((moduleData) => moduleData.id === "notes")?.span, 4);
  assert.equal(sheet.modules.find((moduleData) => moduleData.id === "currency")?.span, 12);
  assert.equal(Object.keys(sheet.skills).length, skillDefinitions.length);
  assert.equal(sheet.spellcasting.slots.length, 9);
  assert.equal(sheet.magicItemAttunement.length, 3);
  assert.ok("background" in sheet.identity && "subclass" in sheet.identity && "xp" in sheet.identity);
  assert.ok("hitDie" in sheet.vitals && "deathSaveFailures" in sheet.vitals && "heroicInspiration" in sheet.vitals);
  assert.ok("classFeatures" in sheet.details && "armorTraining" in sheet.details);
  assert.ok("appearance" in sheet.story && "languages" in sheet.story);
});

test("the builder exports its supported background boost methods and dependencies", () => {
  assert.deepEqual(builderBackgroundBoostMethods, [
    { value: "2+1", label: "+2 and +1", dependentFields: ["boostTwo", "boostOne"] },
    { value: "1+1+1", label: "+1 to all three", dependentFields: [] },
  ]);

  const base = createCharacterSheet("token-boosts", "Boosts", "sheet-boosts");
  base.identity.className = "Fighter";
  base.identity.background = "Soldier";
  base.identity.species = "Human";
  const splitBoosts = createCharacterBuild(base);
  assert.equal(splitBoosts.boostMode, "2+1");
  assert.deepEqual(validateCharacterBuild(splitBoosts), []);
  assert.deepEqual(validateCharacterBuild({ ...splitBoosts, boostMode: "1+1+1" }), []);
});

test("the guided builder applies a playable 2024 level-one foundation", () => {
  const base = createCharacterSheet("token-alice", "Meris", "sheet-alice-01");
  base.identity.className = "Wizard";
  base.identity.background = "Acolyte";
  base.identity.species = "Elf";
  const build = createCharacterBuild(base);
  const sheet = applyCharacterBuild(base, build);

  assert.equal(sheet.identity.className, "Wizard");
  assert.equal(sheet.identity.species, "Elf (Drow)");
  assert.equal(sheet.abilities.int.score, 17);
  assert.equal(sheet.abilities.int.save, 5);
  assert.equal(sheet.vitals.hpMax, 8);
  assert.equal(sheet.skills.insight.proficient, true);
  assert.equal(sheet.skills.arcana.proficient, true);
  assert.equal(sheet.spellcasting.ability, "Intelligence");
  assert.equal(sheet.spellcasting.saveDc, 13);
  assert.equal(sheet.spellcasting.slots[0].total, 2);
  assert.equal(sheet.coins.gp, 13);
  assert.match(sheet.story.languages, /^Common, /);
  assert.ok(sheet.inventory.some((item) => item.name === "Quarterstaff"));

  build.baseScores.cha = 15;
  assert.match(validateCharacterBuild(build)[0], /Standard Array/);
});

test("the builder records 2024 class and species choices on the sheet", () => {
  const base = createCharacterSheet("token-aria", "Aria", "sheet-aria-01");
  base.identity.className = "Fighter";
  base.identity.background = "Soldier";
  base.identity.species = "Human";
  const build = createCharacterBuild(base);
  const choices = featureChoicesForBuild(build);

  assert.deepEqual(choices.map(({ id }) => id), [
    "fighter-fighting-style",
    "fighter-weapon-mastery",
    "human-skillful",
    "human-origin-feat",
  ]);
  assert.equal(build.featureChoices["fighter-weapon-mastery"].length, 3);
  assert.equal(validateCharacterBuild(build).length, 0);

  const extraSkill = build.featureChoices["human-skillful"][0];
  const sheet = applyCharacterBuild(base, build);
  assert.equal(sheet.skills[extraSkill as keyof typeof sheet.skills].proficient, true);
  assert.match(sheet.details.classFeatures, /Fighting Style: Archery/);
  assert.match(sheet.details.weapons, /Weapon Mastery: Battleaxe, Blowgun, Club/);
  assert.match(sheet.details.feats, /Alert/);

  build.featureChoices["fighter-weapon-mastery"] = [];
  assert.match(validateCharacterBuild(build).join(" "), /Weapon Mastery/);
});

test("level-one orders and Expertise apply their sheet mechanics", () => {
  const clericBase = createCharacterSheet("token-cleric", "Dawn", "sheet-cleric-01");
  clericBase.identity.className = "Cleric";
  clericBase.identity.background = "Acolyte";
  clericBase.identity.species = "Dwarf";
  const cleric = applyCharacterBuild(clericBase, createCharacterBuild(clericBase));
  assert.equal(cleric.details.armorTraining.heavy, true);
  assert.match(cleric.details.weapons, /martial weapons/);

  const rogueBase = createCharacterSheet("token-rogue", "Shade", "sheet-rogue-01");
  rogueBase.identity.className = "Rogue";
  rogueBase.identity.background = "Criminal";
  rogueBase.identity.species = "Orc";
  const rogueBuild = createCharacterBuild(rogueBase);
  const expertiseSkill = rogueBuild.featureChoices["rogue-expertise"].find((value) => value !== "thieves-tools")!;
  const rogue = applyCharacterBuild(rogueBase, rogueBuild);
  const skill = rogue.skills[expertiseSkill as keyof typeof rogue.skills];
  const ability = skillDefinitions.find(({ id }) => id === expertiseSkill)!.ability;
  assert.equal(skill.bonus, Math.floor((rogue.abilities[ability].score - 10) / 2) + 4);
  assert.match(rogue.details.classFeatures, /Expertise:/);
});

test("wall segments re-anchor intact and stay inside the map", () => {
  const moved = reanchorSegment({ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 6, y: 5 }, 8, 8);
  assert.deepEqual(moved, { start: { x: 5, y: 5 }, end: { x: 7, y: 5 } });

  const bounded = reanchorSegment(moved.start, moved.end, { x: 20, y: 5 }, 8, 8);
  assert.deepEqual(bounded, { start: { x: 6, y: 5 }, end: { x: 8, y: 5 } });
  assert.equal(Math.hypot(
    bounded.end.x - bounded.start.x,
    bounded.end.y - bounded.start.y,
  ), 2);
});

test("legacy room sheets migrate to the complete format on read", () => {
  const room = createInitialRoomState("Legacy sheets");
  room.tokens.push({ id: "token-alice", mapId: room.activeMapId, ownerId: alice.clientId, name: "Alice", imageKey: null, color: "#d6a84b", x: 1, y: 1 });
  const complete = createCharacterSheet("token-alice", "Alice", "sheet-alice-01");
  const legacy = { ...complete, version: 1 } as Record<string, unknown>;
  const legacyModules = [
    { id: "vitals", span: 12, height: 190 },
    { id: "abilities", span: 12, height: 250 },
    { id: "attacks", span: 6, height: 300 },
    { id: "resources", span: 6, height: 300 },
    { id: "inventory", span: 12, height: 330 },
    { id: "currency", span: 6, height: 250 },
    { id: "notes", span: 6, height: 250 },
  ];
  legacy.modules = legacyModules;
  for (const key of ["identity", "skills", "magicItemAttunement", "details", "story", "spellcasting"]) delete legacy[key];
  room.characterSheets = [legacy as unknown as typeof complete];
  const migrated = parseRoomState(JSON.stringify(room)).characterSheets?.[0];
  assert.equal(migrated?.version, 2);
  assert.equal(Object.keys(migrated?.skills ?? {}).length, 18);
  assert.equal(migrated?.spellcasting.slots.length, 9);
  assert.equal(migrated?.modules[0].id, "identity");
  assert.equal(migrated?.modules.find((moduleData) => moduleData.id === "vitals")?.height, 280);

  const previouslyMigrated = importCharacterSheet({
    ...complete,
    modules: [
      ...legacyModules,
      ...complete.modules.filter((moduleData) =>
        !legacyModules.some((legacyModule) => legacyModule.id === moduleData.id),
      ),
    ],
  }, complete);
  assert.equal(previouslyMigrated.modules[0].id, "identity");
});

test("legacy owner-only PCs keep traveling-party status", () => {
  const withSheet = createInitialRoomState("Legacy private sight");
  withSheet.tokens.push({
    id: "token-private-pc",
    mapId: withSheet.activeMapId,
    ownerId: alice.clientId,
    name: "Alice",
    imageKey: null,
    color: "#d6a84b",
    x: 1,
    y: 1,
    sharedSight: false,
  });
  withSheet.characterSheets = [createCharacterSheet("token-private-pc", "Alice", "sheet-private-pc")];
  assert.equal(parseRoomState(JSON.stringify(withSheet)).tokens[0].playerControlled, true);

  const withoutSheet = createInitialRoomState("Legacy private token");
  withoutSheet.tokens.push({
    id: "token-private-02",
    mapId: withoutSheet.activeMapId,
    ownerId: alice.clientId,
    name: "Alice",
    imageKey: null,
    color: "#d6a84b",
    x: 1,
    y: 1,
    sharedSight: false,
  });
  const parsed = parseRoomState(JSON.stringify(withoutSheet));
  assert.equal(parsed.tokens[0].playerControlled, false);
  const registered = applyRoomOperation(parsed, { type: "set-player-name", name: "Alice" }, alice);
  assert.equal(registered.tokens[0].playerControlled, true);
});

test("gold split converts each share without losing the remainder", () => {
  assert.deepEqual(splitGoldPieces(101, 4), { gp: 25, sp: 2, cp: 5, remainderCp: 0 });
  assert.deepEqual(splitGoldPieces(1, 3), { gp: 0, sp: 3, cp: 3, remainderCp: 1 });
});

test("character imports safely de-duplicate crafted row ids", () => {
  const base = createCharacterSheet("token-alice", "Alice", "sheet-alice-01");
  const sheet = importCharacterSheet({
    ...base,
    attacks: [
      { id: "x", name: "First", attackBonus: 0, damage: "1", damageType: "", notes: "" },
      { id: "x-4", name: "Second", attackBonus: 0, damage: "1", damageType: "", notes: "" },
      { id: "x", name: "Third", attackBonus: 0, damage: "1", damageType: "", notes: "" },
    ],
  }, base);
  assert.deepEqual(sheet.attacks.map((attack) => attack.id), ["attack-x", "attack-x-4", "attack-x-2"]);
});

test("players own their tokens while the DM can move any token", () => {
  const initial = createInitialRoomState("Thursday game");
  const withToken = applyRoomOperation(
    initial,
    {
      type: "add-token",
      token: {
        id: "token-alice",
        name: "Alice",
        imageKey: null,
        color: "#d6a84b",
        x: 2,
        y: 3,
      },
    },
    alice,
  );

  assert.equal(withToken.tokens[0].ownerId, alice.clientId);
  assert.throws(
    () =>
      applyRoomOperation(
        withToken,
        { type: "move-token", tokenId: "token-alice", x: 9, y: 9 },
        bob,
      ),
    (error: unknown) =>
      error instanceof RoomStateError && error.status === 403,
  );

  const moved = applyRoomOperation(
    withToken,
    { type: "move-token", tokenId: "token-alice", x: 9, y: 9 },
    dm,
  );
  assert.deepEqual(
    { x: moved.tokens[0].x, y: moved.tokens[0].y },
    { x: 9, y: 9 },
  );
});

test("player snapshots omit hidden tokens, sheets, fog scopes, and inactive maps", () => {
  let state = createInitialRoomState("Secret dungeon");
  state = applyRoomOperation(state, { type: "set-player-name", name: "Alice" }, alice);
  state = applyRoomOperation(state, { type: "set-player-name", name: "Bob" }, bob);
  state = applyRoomOperation(state, {
    type: "add-token",
    token: {
      id: "token-alice",
      name: "Alice",
      imageKey: null,
      color: "#d6a84b",
      x: 1,
      y: 1,
    },
  }, alice);
  const aliceSheet = createCharacterSheet("token-alice", "Alice", "sheet-alice-01");
  state = applyRoomOperation(state, { type: "set-character-sheet", sheet: aliceSheet }, alice);
  state = applyRoomOperation(state, {
    type: "add-token",
    token: {
      id: "token-bobby-01",
      name: "Bob",
      imageKey: null,
      color: "#5bb6d6",
      x: 2,
      y: 1,
    },
  }, bob);
  state = applyRoomOperation(state, {
    type: "add-token",
    token: {
      id: "token-goblin",
      name: "Goblin ambusher",
      imageKey: `${roomId}/token/0f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      color: "#cb6f65",
      x: 18,
      y: 8,
    },
  }, dm);
  state = applyRoomOperation(state, {
    type: "add-map",
    map: {
      id: "map-secret-01",
      name: "Unrevealed cellar",
      imageKey: `${roomId}/map/1f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      columns: 20,
      rows: 12,
    },
  }, dm);
  state = applyRoomOperation(state, { type: "set-active-map", mapId: "training-hall" }, dm);
  state = applyRoomOperation(state, {
    type: "set-map-lighting",
    mapId: "training-hall",
    lighting: {
      enabled: true,
      darkness: 0.92,
      barriers: [],
      lights: [],
      explored: { shared: [0], [alice.clientId]: [1], [bob.clientId]: [2] },
    },
  }, dm);
  state = applyRoomOperation(state, {
    type: "set-turn-order",
    turnOrder: {
      mapId: "training-hall",
      entries: [{ id: "turn-goblin-01", name: "Goblin ambusher", score: 14, tokenId: "token-goblin" }],
      activeId: "turn-goblin-01",
      round: 1,
    },
  }, dm);
  state = applyRoomOperation(state, { type: "roll-dice", formula: "1d20", label: "Bob" }, bob);
  state = applyRoomOperation(state, {
    type: "ping-map",
    mapId: "training-hall",
    x: 2,
    y: 1,
    label: "Bob",
    color: "#5bb6d6",
    focus: false,
  }, bob);

  const playerView = roomStateForActor(state, alice);
  assert.deepEqual(playerView.maps.map((map) => map.id), ["training-hall"]);
  assert.deepEqual(playerView.tokens.map((token) => token.id), ["token-alice", "token-bobby-01"]);
  assert.equal(playerView.tokens.find((token) => token.id === "token-bobby-01")?.ownerId, "redacted-owner");
  assert.deepEqual(playerView.characterSheets?.map((sheet) => sheet.id), ["sheet-alice-01"]);
  assert.deepEqual(Object.keys(playerView.maps[0].lighting?.explored ?? {}).sort(), [alice.clientId, "shared"].sort());
  assert.deepEqual(playerView.players?.map((player) => player.id), [alice.clientId]);
  assert.deepEqual(playerView.turnOrder?.entries[0], {
    id: "turn-goblin-01",
    name: "Hidden combatant",
    score: 14,
    tokenId: null,
  });
  assert.equal(JSON.stringify(playerView).includes("Unrevealed cellar"), false);
  assert.equal(JSON.stringify(playerView).includes("Goblin ambusher"), false);
  assert.equal(JSON.stringify(playerView).includes(bob.clientId), false);
  assert.equal(playerView.diceLog?.[0].actorId, "redacted-owner");
  assert.equal(playerView.ping?.actorId, "redacted-owner");

  const dmView = roomStateForActor(state, dm);
  assert.equal(dmView.maps.length, 2);
  assert.equal(dmView.tokens.length, 3);
});

test("the same player token and character sheet travel between scenes", () => {
  let state = createInitialRoomState("Traveling party");
  state = applyRoomOperation(state, {
    type: "add-token",
    token: { id: "token-alice", name: "Alice", imageKey: null, color: "#d6a84b", x: 3, y: 4 },
  }, alice);
  state = applyRoomOperation(state, {
    type: "set-character-sheet",
    sheet: createCharacterSheet("token-alice", "Alice", "sheet-alice-01"),
  }, alice);
  state = applyRoomOperation(state, {
    type: "add-token",
    token: { id: "token-goblin", name: "Goblin", imageKey: null, color: "#cb6f65", x: 8, y: 4 },
  }, dm);
  state = applyRoomOperation(state, {
    type: "add-map",
    map: {
      id: "map-road-001",
      name: "The road",
      imageKey: `${roomId}/map/2f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      columns: 30,
      rows: 20,
    },
  }, dm);
  state = applyRoomOperation(state, {
    type: "set-map-details",
    mapId: "map-road-001",
    name: "The road",
    folder: "Chapter 1",
    gridVisible: true,
    landing: { x: 6, y: 7 },
  }, dm);
  state = applyRoomOperation(state, { type: "set-active-map", mapId: "training-hall" }, dm);
  state = applyRoomOperation(state, { type: "set-active-map", mapId: "map-road-001" }, dm);

  const character = state.tokens.find((token) => token.id === "token-alice");
  const npc = state.tokens.find((token) => token.id === "token-goblin");
  assert.deepEqual({ mapId: character?.mapId, x: character?.x, y: character?.y }, {
    mapId: "map-road-001",
    x: 6,
    y: 7,
  });
  assert.equal(npc?.mapId, "training-hall");
  assert.equal(state.characterSheets?.[0].tokenId, "token-alice");
});

test("combat token controls support ownership, size, facing, conditions, locking, and copies", () => {
  let state = createInitialRoomState("Combat controls");
  state = applyRoomOperation(state, { type: "set-player-name", name: "Alice" }, alice);
  state = applyRoomOperation(state, {
    type: "add-token",
    token: { id: "token-ogre-01", name: "Ogre", imageKey: null, color: "#cb6f65", x: 2, y: 2 },
  }, dm);
  state = applyRoomOperation(state, {
    type: "set-token-owner",
    tokenId: "token-ogre-01",
    ownerId: alice.clientId,
  }, dm);
  state = applyRoomOperation(state, {
    type: "set-token",
    tokenId: "token-ogre-01",
    token: {
      width: 2,
      height: 3,
      rotation: 450,
      hp: 7,
      maxHp: 10,
      tempHp: 2,
      statuses: [{ id: "status-poisoned", label: "Poisoned", count: 2 }],
      auraRange: 4,
      auraColor: "#7dc890",
      showName: false,
      locked: true,
    },
  }, dm);
  assert.throws(
    () => applyRoomOperation(state, { type: "move-token", tokenId: "token-ogre-01", x: 10, y: 8 }, alice),
    /Unlock that token/,
  );
  state = applyRoomOperation(state, {
    type: "set-token",
    tokenId: "token-ogre-01",
    token: { locked: false },
  }, dm);
  state = applyRoomOperation(state, {
    type: "move-tokens",
    tokens: [{ tokenId: "token-ogre-01", x: 10, y: 8 }],
  }, alice);
  state = applyRoomOperation(state, {
    type: "duplicate-tokens",
    tokenIds: ["token-ogre-01"],
    newIds: ["token-ogre-copy"],
  }, alice);

  const original = state.tokens.find((token) => token.id === "token-ogre-01");
  const copy = state.tokens.find((token) => token.id === "token-ogre-copy");
  assert.deepEqual(
    {
      ownerId: original?.ownerId,
      playerControlled: original?.playerControlled,
      width: original?.width,
      height: original?.height,
      rotation: original?.rotation,
      hp: original?.hp,
      maxHp: original?.maxHp,
      tempHp: original?.tempHp,
      status: original?.statuses?.[0],
      auraRange: original?.auraRange,
      showName: original?.showName,
      x: original?.x,
      y: original?.y,
    },
    {
      ownerId: alice.clientId,
      playerControlled: true,
      width: 2,
      height: 3,
      rotation: 90,
      hp: 7,
      maxHp: 10,
      tempHp: 2,
      status: { id: "status-poisoned", label: "Poisoned", count: 2 },
      auraRange: 4,
      showName: false,
      x: 10,
      y: 8,
    },
  );
  assert.equal(copy?.name, "Ogre copy");
  assert.equal(copy?.locked, false);
});

test("character sheets persist with their token owner's permissions", () => {
  const initial = createInitialRoomState("Sheet room");
  const withToken = applyRoomOperation(initial, {
    type: "add-token",
    token: {
      id: "token-alice",
      name: "Alice",
      imageKey: null,
      color: "#d6a84b",
      x: 2,
      y: 3,
    },
  }, alice);
  const sheet = createCharacterSheet("token-alice", "Alice", "sheet-alice-01");
  const saved = applyRoomOperation(withToken, { type: "set-character-sheet", sheet }, alice);
  assert.equal(saved.characterSheets?.[0].name, "Alice");

  assert.throws(
    () => applyRoomOperation(saved, {
      type: "set-character-sheet",
      sheet: { ...sheet, name: "Stolen" },
    }, bob),
    (error: unknown) => error instanceof RoomStateError && error.status === 403,
  );

  const dmEdited = applyRoomOperation(saved, {
    type: "set-character-sheet",
    sheet: { ...sheet, name: "Alice the Brave" },
  }, dm);
  assert.equal(dmEdited.characterSheets?.[0].name, "Alice the Brave");
  const removed = applyRoomOperation(dmEdited, { type: "delete-token", tokenId: "token-alice" }, alice);
  assert.equal(removed.characterSheets?.length, 0);
});

test("uploaded assets remain reusable and player libraries stay private", () => {
  let state = createInitialRoomState("Asset room");
  state = applyRoomOperation(state, {
    type: "add-token",
    token: {
      id: "token-alice-asset",
      name: "Alice",
      imageKey: `${roomId}/token/1f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      color: "#d6a84b",
      x: 1,
      y: 1,
    },
  }, alice);
  state = applyRoomOperation(state, {
    type: "add-token",
    token: {
      id: "token-bobby-asset",
      name: "Bobby",
      imageKey: `${roomId}/token/2f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      color: "#5bb6d6",
      x: 2,
      y: 2,
    },
  }, bob);
  state = applyRoomOperation(state, {
    type: "add-map",
    map: {
      id: "map-saved-asset",
      name: "Saved Map",
      imageKey: `${roomId}/map/3f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      columns: 24,
      rows: 16,
    },
  }, dm);

  assert.equal(state.assets?.length, 3);
  assert.deepEqual(
    roomStateForActor(state, alice).assets?.map((asset) => asset.name),
    ["Alice"],
  );
  assert.equal(roomStateForActor(state, dm).assets?.length, 3);
  assert.throws(
    () => applyRoomOperation(state, {
      type: "add-asset",
      asset: {
        id: "asset-player-map",
        kind: "map",
        name: "Secret Map",
        imageKey: `${roomId}/map/4f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      },
    }, alice),
    /Only the DM/,
  );
});

test("a saved map image can fill the current blank scene", () => {
  const state = applyRoomOperation(createInitialRoomState("Blank scene"), {
    type: "set-map-image",
    mapId: "training-hall",
    name: "Moonlit Crossing",
    imageKey: `${roomId}/map/5f8fad5b-d9cb-469f-a165-70867728950e.webp`,
    columns: 30,
    rows: 18,
  }, dm);
  assert.deepEqual(
    {
      name: state.maps[0].name,
      imageKey: state.maps[0].imageKey,
      columns: state.maps[0].columns,
      rows: state.maps[0].rows,
      assetName: state.assets?.[0].name,
    },
    {
      name: "Moonlit Crossing",
      imageKey: `${roomId}/map/5f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      columns: 30,
      rows: 18,
      assetName: "Moonlit Crossing",
    },
  );
});

test("only the DM can add and activate maps", () => {
  const initial = createInitialRoomState("Thursday game");
  const operation = {
    type: "add-map",
    map: {
      id: "map-crypt-01",
      name: "The Crypt",
      imageKey: `${roomId}/map/0f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      columns: 24,
      rows: 16,
    },
  };

  assert.throws(
    () => applyRoomOperation(initial, operation, alice),
    (error: unknown) =>
      error instanceof RoomStateError && error.status === 403,
  );

  const next = applyRoomOperation(initial, operation, dm);
  assert.equal(next.maps.length, 2);
  assert.equal(next.activeMapId, "map-crypt-01");

  const aligned = applyRoomOperation(
    next,
    {
      type: "align-map-grid",
      mapId: "map-crypt-01",
      columns: 36,
      rows: 36,
      grid: {
        offsetX: 0.002,
        offsetY: -0.006,
        cellWidth: 1 / 36,
        cellHeight: 1 / 36,
        imageAspect: 1,
      },
    },
    dm,
  );
  assert.equal(aligned.maps[1].columns, 36);
  assert.equal(aligned.maps[1].grid?.offsetY, -0.006);
});

test("rooms enforce the native 100-map ceiling", () => {
  const full = createInitialRoomState("Full map library");
  for (let index = 1; index < 100; index += 1) {
    full.maps.push({
      id: `stored-map-${String(index).padStart(3, "0")}`,
      name: `Stored map ${index}`,
      imageKey: null,
      columns: 20,
      rows: 12,
    });
  }

  assert.throws(
    () =>
      applyRoomOperation(
        full,
        {
          type: "add-map",
          map: {
            id: "map-over-limit",
            name: "One too many",
            imageKey: `${roomId}/map/0f8fad5b-d9cb-469f-a165-70867728950e.webp`,
            columns: 20,
            rows: 12,
          },
        },
        dm,
      ),
    /maximum of 100 maps/,
  );
});

test("map management supports details, copies, ordering, archives, and deletion", () => {
  let state = createInitialRoomState("Map library");
  state = applyRoomOperation(state, {
    type: "add-map",
    map: {
      id: "map-crypt-01",
      name: "Crypt",
      imageKey: `${roomId}/map/3f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      columns: 24,
      rows: 16,
    },
  }, dm);
  state = applyRoomOperation(state, {
    type: "set-map-details",
    mapId: "map-crypt-01",
    name: "Lower Crypt",
    folder: "Chapter 2",
    gridVisible: false,
    landing: { x: 4, y: 5 },
  }, dm);
  state = applyRoomOperation(state, {
    type: "duplicate-map",
    mapId: "map-crypt-01",
    newId: "map-crypt-copy",
  }, dm);
  state = applyRoomOperation(state, { type: "reorder-map", mapId: "map-crypt-copy", index: 0 }, dm);
  state = applyRoomOperation(state, { type: "archive-map", mapId: "map-crypt-copy", archived: true }, dm);

  assert.deepEqual(state.maps.map((map) => map.id), ["map-crypt-copy", "training-hall", "map-crypt-01"]);
  assert.deepEqual(
    state.maps.find((map) => map.id === "map-crypt-01"),
    {
      id: "map-crypt-01",
      name: "Lower Crypt",
      imageKey: `${roomId}/map/3f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      columns: 24,
      rows: 16,
      grid: undefined,
      folder: "Chapter 2",
      archived: false,
      gridVisible: false,
      landing: { x: 4, y: 5 },
    },
  );
  assert.equal(state.maps[0].archived, true);
  state = applyRoomOperation(state, { type: "delete-map", mapId: "map-crypt-copy" }, dm);
  assert.equal(state.maps.some((map) => map.id === "map-crypt-copy"), false);
});

test("room backups are validated and meaningful edits are undoable", () => {
  let state = createInitialRoomState("Backup room");
  state = applyRoomOperation(state, {
    type: "add-map",
    map: {
      id: "map-backup-01",
      name: "Backup map",
      imageKey: `${roomId}/map/4f8fad5b-d9cb-469f-a165-70867728950e.webp`,
      columns: 20,
      rows: 12,
    },
  }, dm);
  assert.equal(validatedBackupState(state, roomId).activeMapId, "map-backup-01");
  assert.throws(
    () => validatedBackupState({
      ...state,
      maps: state.maps.map((map) => map.id === "map-backup-01"
        ? { ...map, imageKey: "ZZZ234/map/4f8fad5b-d9cb-469f-a165-70867728950e.webp" }
        : map),
    }, roomId),
    /Invalid uploaded image reference/,
  );
  assert.equal(isUndoableRoomOperation({ type: "move-token" }), true);
  assert.equal(isUndoableRoomOperation({ type: "set-active-map" }), true);
  assert.equal(isUndoableRoomOperation({ type: "ping-map" }), false);
  assert.equal(isUndoableRoomOperation({ type: "set-player-name" }), false);
});

test("measurement uses the 5e equal-diagonal rule", () => {
  assert.equal(measureDistanceFeet({ x: 1, y: 1 }, { x: 2, y: 2 }), 5);
  assert.equal(measureDistanceFeet({ x: 1, y: 1 }, { x: 3, y: 2 }), 10);
  assert.equal(measureDistanceFeet({ x: 2, y: 2 }, { x: 2, y: 2 }), 0);
});

test("grid templates use 5-foot equal diagonals and 2024 shape dimensions", () => {
  const base = { start: { x: 1, y: 1 }, end: { x: 4, y: 4 }, beamWidth: 2 };
  const distance = buildMeasurementGeometry({ ...base, kind: "distance" });
  const cone = buildMeasurementGeometry({ ...base, kind: "cone" });
  const square = buildMeasurementGeometry({ ...base, kind: "square" });
  const beam = buildMeasurementGeometry({ ...base, kind: "beam" });
  const emanation = buildMeasurementGeometry({ ...base, kind: "emanation" });
  const jointed = buildMeasurementGeometry({
    ...base,
    kind: "distance",
    joints: [{ x: 4, y: 1 }],
  });
  assert.equal(distance.distanceFeet, 15);
  assert.equal(jointed.distanceFeet, 30);
  assert.deepEqual(jointed.points, [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 4 },
  ]);
  assert.ok(Math.abs(Math.hypot(
    cone.points[1].x - cone.points[2].x,
    cone.points[1].y - cone.points[2].y,
  ) - 3) < 0.0001);
  assert.deepEqual(square.points[2], { x: 4, y: 4 });
  assert.ok(Math.abs(Math.hypot(
    beam.points[0].x - beam.points[3].x,
    beam.points[0].y - beam.points[3].y,
  ) - 2) < 0.0001);
  assert.deepEqual(emanation.points, [
    { x: -2, y: -2 },
    { x: 4, y: -2 },
    { x: 4, y: 4 },
    { x: -2, y: 4 },
  ]);
});

test("manual dice notation is validated and rolls are generated by room state", () => {
  assert.deepEqual(parseDiceFormula("2d6 + 3"), {
    count: 2,
    sides: 6,
    modifier: 3,
    formula: "2d6 + 3",
  });
  assert.throws(() => parseDiceFormula("100d6"), /Use 1-50 dice/);
  const rolled = applyRoomOperation(createInitialRoomState("Dice room"), {
    type: "roll-dice",
    formula: "2d6 + 3",
    label: "Alice",
  }, alice);
  const result = rolled.diceLog?.[0];
  assert.equal(result?.rolls.length, 2);
  assert.ok(result?.rolls.every((roll) => roll >= 1 && roll <= 6));
  assert.equal(result?.total, (result?.rolls.reduce((sum, roll) => sum + roll, 3)));
});

test("turn order persists and remains under DM control", () => {
  const initial = createInitialRoomState("Initiative room");
  const turnOrder = {
    mapId: "training-hall",
    entries: [{ id: "turn-entry-01", name: "Goblin group", score: 14, tokenId: null }],
    activeId: "turn-entry-01",
    round: 2,
  };
  assert.throws(
    () => applyRoomOperation(initial, { type: "set-turn-order", turnOrder }, alice),
    (error: unknown) => error instanceof RoomStateError && error.status === 403,
  );
  const updated = applyRoomOperation(initial, { type: "set-turn-order", turnOrder }, dm);
  assert.deepEqual(updated.turnOrder, turnOrder);
});

test("automatic grid detection finds square count and alignment", () => {
  const width = 720;
  const height = 480;
  const cell = 30;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const verticalDistance = Math.min(modulo(x - 3, cell), cell - modulo(x - 3, cell));
      const horizontalDistance = Math.min(modulo(y + 6, cell), cell - modulo(y + 6, cell));
      const value = verticalDistance <= 1 || horizontalDistance <= 1
        ? 24
        : 115 + ((x * 17 + y * 13) % 18);
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }

  const detected = detectSquareGrid(pixels, width, height);
  assert.equal(detected?.columns, 24);
  assert.equal(detected?.rows, 16);
  assert.ok(Math.abs((detected?.calibration.offsetX ?? 0) - 3 / width) < 0.005);
  assert.ok(Math.abs((detected?.calibration.offsetY ?? 0) + 6 / height) < 0.005);
});

test("walls and closed doors block sight while open doors do not", () => {
  const wall = {
    id: "wall-test-01",
    start: { x: 4, y: 0 },
    end: { x: 4, y: 8 },
    kind: "door" as const,
    open: false,
  };
  const blocked = visibilityPolygon({ x: 2, y: 2 }, [wall], 10, 8, 12);
  const open = visibilityPolygon({ x: 2, y: 2 }, [{ ...wall, open: true }], 10, 8, 12);
  assert.equal(pointInPolygon({ x: 6, y: 2 }, blocked), false);
  assert.equal(pointInPolygon({ x: 6, y: 2 }, open), true);
});

test("owner-only sight stays private and hidden tokens stay outside current vision", () => {
  const map = {
    id: "map-vision-01",
    name: "Vision test",
    imageKey: null,
    columns: 10,
    rows: 8,
    lighting: {
      enabled: true,
      darkness: 0.92,
      barriers: [{
        id: "wall-vision-01",
        start: { x: 4, y: 0 },
        end: { x: 4, y: 8 },
        kind: "wall" as const,
        open: false,
      }],
      lights: [],
      explored: {},
    },
  };
  const tokens = [{
    id: "token-vision-01",
    mapId: map.id,
    ownerId: alice.clientId,
    name: "Alice",
    imageKey: null,
    color: "#d6a84b",
    x: 1,
    y: 1,
    sharedSight: false,
    visionRange: 12,
  }];
  const aliceView = buildViewerLighting(map, tokens, alice.clientId);
  const bobView = buildViewerLighting(map, tokens, bob.clientId);
  assert.equal(aliceView.privatePolygons.length, 1);
  assert.equal(bobView.polygons.length, 0);
  assert.equal(
    aliceView.polygons.some((polygon) => pointInPolygon({ x: 7, y: 2 }, polygon)),
    false,
  );
});

test("a visible map light extends sight while an unseen light reveals nothing", () => {
  const map = {
    id: "map-lights-01",
    name: "Light test",
    imageKey: null,
    columns: 30,
    rows: 10,
    lighting: {
      enabled: true,
      darkness: 0.92,
      barriers: [],
      lights: [
        { id: "light-visible-01", x: 7, y: 4.5, range: 4, intensity: 0.8, color: "#ffbb66" },
        { id: "light-hidden-001", x: 20, y: 4.5, range: 4, intensity: 0.8, color: "#ffbb66" },
      ],
      explored: {},
    },
  };
  const tokens = [{
    id: "token-lights-01",
    mapId: map.id,
    ownerId: alice.clientId,
    name: "Alice",
    imageKey: null,
    color: "#d6a84b",
    x: 1,
    y: 4,
    sharedSight: true,
    visionRange: 7,
  }];
  const view = buildViewerLighting(map, tokens, alice.clientId);
  assert.equal(view.polygons.some((polygon) => pointInPolygon({ x: 10.5, y: 4.5 }, polygon)), true);
  assert.equal(view.polygons.some((polygon) => pointInPolygon({ x: 20, y: 4.5 }, polygon)), false);
});

test("lighting setup is DM-only while token sight and explored fog persist", () => {
  const initial = createInitialRoomState("Lighting room");
  const withPlayerToken = applyRoomOperation(initial, {
    type: "add-token",
    token: {
      id: "token-light-01",
      name: "Alice",
      imageKey: null,
      color: "#d6a84b",
      x: 2,
      y: 2,
    },
  }, alice);
  const withDmToken = applyRoomOperation(withPlayerToken, {
    type: "add-token",
    token: {
      id: "token-light-02",
      name: "Goblin",
      imageKey: null,
      color: "#cb6f65",
      x: 6,
      y: 2,
    },
  }, dm);
  assert.equal(withDmToken.tokens[0].sharedSight, true);
  assert.equal(withDmToken.tokens[1].sharedSight, false);

  const lighting = {
    enabled: true,
    darkness: 0.92,
    barriers: [{
      id: "wall-light-01",
      start: { x: 4, y: 0 },
      end: { x: 4, y: 8 },
      kind: "wall" as const,
      open: false,
    }],
    lights: [],
    explored: {},
  };
  assert.throws(
    () => applyRoomOperation(withDmToken, {
      type: "set-map-lighting",
      mapId: "training-hall",
      lighting,
    }, alice),
    (error: unknown) => error instanceof RoomStateError && error.status === 403,
  );

  const lit = applyRoomOperation(withDmToken, {
    type: "set-map-lighting",
    mapId: "training-hall",
    lighting,
  }, dm);
  const privateSight = applyRoomOperation(lit, {
    type: "set-token-vision",
    tokenId: "token-light-01",
    sharedSight: false,
    visionRange: 9,
  }, dm);
  const explored = applyRoomOperation(privateSight, {
    type: "reveal-map",
    mapId: "training-hall",
    scope: alice.clientId,
    cells: [0, 1, 1, 20],
  }, alice);
  assert.equal(explored.tokens[0].sharedSight, false);
  assert.equal(explored.tokens[0].visionRange, 9);
  assert.deepEqual(explored.maps[0].lighting?.explored[alice.clientId], [0, 1, 20]);
  const reconfigured = applyRoomOperation(explored, {
    type: "set-map-lighting",
    mapId: "training-hall",
    lighting,
  }, dm);
  assert.deepEqual(reconfigured.maps[0].lighting?.explored[alice.clientId], [0, 1, 20]);
  assert.throws(
    () => applyRoomOperation(explored, {
      type: "reveal-map",
      mapId: "training-hall",
      scope: alice.clientId,
      cells: [2],
    }, bob),
    (error: unknown) => error instanceof RoomStateError && error.status === 403,
  );
});

test("players cannot mark cells outside their current sight as explored", () => {
  const room = createInitialRoomState("Visibility boundary");
  room.maps[0].lighting = {
    enabled: true,
    darkness: 0.92,
    barriers: [],
    lights: [],
    explored: {},
  };
  room.tokens.push({
    id: "token-alice-vision",
    mapId: room.activeMapId,
    ownerId: alice.clientId,
    name: "Alice",
    imageKey: null,
    color: "#d6a84b",
    x: 1,
    y: 1,
    sharedSight: false,
    visionRange: 1,
  });

  assert.throws(
    () => applyRoomOperation(room, {
      type: "reveal-map",
      mapId: room.activeMapId,
      scope: alice.clientId,
      cells: [room.maps[0].columns * room.maps[0].rows - 1],
    }, alice),
    /current sight/i,
  );
});

test("plain-image wall setup follows artwork without snapping to the battle grid", () => {
  const width = 400;
  const height = 400;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const value = x < width * 0.43 ? 30 : 220;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  const draft = inferArtworkWallDraft(
    pixels,
    width,
    height,
    { columns: 4, rows: 4 },
    { offsetX: 0, offsetY: 0, cellWidth: 0.25, cellHeight: 0.25, imageAspect: 1 },
  );
  assert.equal(draft.length, 1);
  assert.ok(Math.abs(draft[0].start.x - 1.7) < 0.15);
  assert.notEqual(draft[0].start.x, Math.round(draft[0].start.x));
  assert.deepEqual(
    { startY: draft[0].start.y, endY: draft[0].end.y },
    { startY: 0, endY: 4 },
  );
});

test("plain-image lighting finds compact artwork glows without treating grid lines as lights", () => {
  const width = 192;
  const height = 128;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const gridLine = x % 24 === 0 || y % 24 === 0;
      pixels[index] = gridLine ? 175 : 35;
      pixels[index + 1] = gridLine ? 175 : 38;
      pixels[index + 2] = gridLine ? 175 : 42;
      pixels[index + 3] = 255;
    }
  }
  for (const source of [{ x: 48, y: 40 }, { x: 144, y: 88 }]) {
    for (let y = source.y - 10; y <= source.y + 10; y += 1) {
      for (let x = source.x - 10; x <= source.x + 10; x += 1) {
        const distance = Math.hypot(x - source.x, y - source.y);
        if (distance > 10) continue;
        const glow = 1 - distance / 10;
        const index = (y * width + x) * 4;
        pixels[index] = Math.max(pixels[index], 70 + 185 * glow);
        pixels[index + 1] = Math.max(pixels[index + 1], 45 + 150 * glow);
        pixels[index + 2] = Math.max(pixels[index + 2], 25 + 55 * glow);
      }
    }
  }
  const lights = inferArtworkLightDraft(
    pixels,
    width,
    height,
    { columns: 24, rows: 16 },
    { offsetX: 0, offsetY: 0, cellWidth: 1 / 24, cellHeight: 1 / 16, imageAspect: 1.5 },
  );
  assert.equal(lights.length, 2);
  assert.ok(lights.some((light) => Math.hypot(light.x - 6, light.y - 5) < 1));
  assert.ok(lights.some((light) => Math.hypot(light.x - 18, light.y - 11) < 1));
});

test("Universal VTT import carries its image, walls, door, light, and grid", () => {
  const imported = parseUvtt(JSON.stringify({
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: { x: 10, y: 8 },
      pixels_per_grid: 50,
    },
    line_of_sight: [[{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }]],
    portals: [{ bounds: [{ x: 5, y: 4 }, { x: 5, y: 5 }], closed: true }],
    lights: [{ position: { x: 3, y: 3 }, range: 6, intensity: 0.8, color: "#ffaa44" }],
    environment: { ambient_light: "#000000" },
    image: "iVBORw0KGgo=",
  }));
  assert.deepEqual({ columns: imported.columns, rows: imported.rows }, { columns: 10, rows: 8 });
  assert.equal(imported.lighting.barriers.length, 3);
  assert.equal(imported.lighting.barriers[2].kind, "door");
  assert.equal(imported.lighting.lights[0].color, "#ffaa44");
  assert.equal(imported.imageType, "image/png");

  const state = applyRoomOperation(createInitialRoomState("UVTT room"), {
    type: "add-map",
    map: {
      id: "map-uvtt-001",
      name: "Imported dungeon",
      imageKey: `${roomId}/map/0f8fad5b-d9cb-469f-a165-70867728950e.png`,
      columns: imported.columns,
      rows: imported.rows,
      grid: imported.grid,
      lighting: imported.lighting,
    },
  }, dm);
  assert.equal(state.maps[1].lighting?.barriers.length, 3);
  assert.equal(state.maps[1].lighting?.lights.length, 1);
});

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
