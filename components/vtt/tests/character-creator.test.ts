import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { characterCatalogue } from "../lib/character-catalogue.ts";
import {
  applyCharacterCreatorDraft,
  availableFeatsForSlot,
  availableSpells,
  availableSpellsForDraft,
  buildCharacterCreatorReview,
  calculateFixedHitPoints,
  castingDetailsForDraft,
  createCharacterCreatorDraft,
  expertiseCountForDraft,
  languageChoiceCountForDraft,
  manualChoiceRequirementsForDraft,
  featSlotsForDraft,
  multiclassSpellSlots,
  optionRequirementsForDraft,
  pointBuyCost,
  rebaseCharacterCreatorDraft,
  reconcileCharacterCreatorDraft,
  restoreCharacterCreatorDraft,
  skillChoiceRequirementsForDraft,
  spellChoiceRequirementsForDraft,
  speciesMagicForDraft,
  toolChoiceRequirementsForDraft,
  validateCharacterCreatorDraft,
  type CharacterCreatorDraft,
} from "../lib/character-creator.ts";
import { createCharacterSheet, importCharacterSheet } from "../lib/character-sheet.ts";

const classByName = (name: string) => characterCatalogue.classes.find((entry) => entry.name === name)!;
const speciesByName = (name: string) => characterCatalogue.species.find((entry) => entry.name === name)!;
const backgroundByName = (name: string) => characterCatalogue.backgrounds.find((entry) => entry.name === name)!;

test("the derived catalogue is bounded, source-identified, and rebuildable", async () => {
  assert.equal(characterCatalogue.source.archiveSha256, "C2A9D6C21C02FA278E59D6809FF54B2210F3C5EC939493DEC192480FDB3835C9");
  assert.equal(characterCatalogue.coverage.classes, 13);
  assert.equal(characterCatalogue.coverage.species, 10);
  assert.equal(characterCatalogue.coverage.backgrounds, 16);
  assert.ok(characterCatalogue.coverage.subclasses >= 50);
  assert.ok(characterCatalogue.coverage.spells >= 500);
  const packageIds = [...characterCatalogue.classes, ...characterCatalogue.backgrounds].flatMap(({ equipment }) => equipment.map(({ id }) => id));
  assert.equal(new Set(packageIds).size, packageIds.length);
  const raw = await readFile(new URL("../data/character-catalogue.json", import.meta.url), "utf8");
  assert.doesNotMatch(raw, /You hurl a mote of fire|"entries"\s*:/i);
});

test("a new draft contains no discretionary selections", () => {
  const draft = createCharacterCreatorDraft(createCharacterSheet("token-a", "Adventurer", "sheet-a"));
  assert.equal(draft.classLevels[0].classId, "");
  assert.equal(draft.classLevels[0].levels, 0);
  assert.equal(draft.speciesId, "");
  assert.equal(draft.backgroundId, "");
  assert.equal(draft.abilityMethod, "");
  assert.deepEqual(Object.values(draft.baseScores), [null, null, null, null, null, null]);
  assert.deepEqual(draft.languages, []);
  assert.ok(validateCharacterCreatorDraft(draft).some(({ code }) => code === "class"));
});

test("2024 point buy accepts 15,15,15,8,8,8 and rejects a 28-point array", () => {
  assert.equal(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }), 27);
  assert.equal(pointBuyCost({ str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 }), 28);
});

test("source-derived prepared counts and single-class slots stay distinct", () => {
  const paladin = classByName("Paladin");
  assert.equal(paladin.spellcasting?.prepared[4], 6);
  assert.deepEqual(paladin.spellcasting?.slotTable[4].slice(0, 2), [4, 2]);
  assert.ok(paladin.spellcasting?.alwaysSpells.some(({ name, level }) => name === "Divine Smite" && level <= 5));
  assert.ok(!availableSpells(paladin, 5, false).some(({ name }) => ["Divine Smite", "Find Steed"].includes(name)));
});

test("every fixed spell grant resolves to a real catalogue spell without filter text leaking into names", () => {
  const spellIds = new Set(characterCatalogue.spells.map(({ id }) => id));
  const grants = [
    ...characterCatalogue.species.flatMap(({ innateMagic }) => innateMagic.flatMap(({ grants }) => grants)),
    ...characterCatalogue.classes.flatMap((entry) => [
      ...(entry.spellcasting?.alwaysSpells ?? []),
      ...entry.subclasses.flatMap((subclass) => subclass.alwaysSpells),
    ]),
  ];
  assert.ok(grants.length > 100);
  assert.deepEqual(grants.filter(({ spellId }) => !spellIds.has(spellId)), []);
  assert.deepEqual(grants.filter(({ name }) => /^level=/i.test(name)), []);
});

test("Magical Secrets expands the level-10 Bard list without exceeding Bard spell-level access", () => {
  const bard = classByName("Bard");
  const draft = calculationDraft([["Bard", 10]]);
  const spells = availableSpellsForDraft(draft, bard.id, false);
  assert.ok(spells.some(({ name }) => name === "Fireball"));
  assert.equal(Math.max(...spells.map(({ level }) => level)), 5);
});

test("Eldritch Knight uses its subclass casting progression and Wizard list", () => {
  const fighter = classByName("Fighter");
  const draft = calculationDraft([["Fighter", 3]]);
  draft.subclasses[fighter.id] = fighter.subclasses.find(({ name }) => name === "Eldritch Knight")!.id;
  const casting = castingDetailsForDraft(draft, fighter.id);
  assert.deepEqual(casting && { profileName: casting.profileName, ability: casting.ability, progression: casting.progression, cantrips: casting.cantrips, prepared: casting.prepared }, {
    profileName: "Eldritch Knight",
    ability: "int",
    progression: "1/3",
    cantrips: 2,
    prepared: 3,
  });
  assert.ok(availableSpellsForDraft(draft, fighter.id, true).some(({ name }) => name === "Fire Bolt"));
  assert.deepEqual(multiclassSpellSlots(draft).slice(0, 2), [2, 0]);
});

test("Arcane Trickster's fixed Mage Hand is automatic and does not consume a chosen cantrip", async () => {
  const sheet = createCharacterSheet("token-trickster", "Adventurer", "sheet-trickster");
  const draft = validArcaneTricksterDraft(sheet);
  const rogue = classByName("Rogue");
  assert.equal(castingDetailsForDraft(draft, rogue.id)?.cantrips, 2);
  assert.ok(!availableSpellsForDraft(draft, rogue.id, true).some(({ name }) => name === "Mage Hand"));
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  assert.ok(applied.spellcasting.spells.some(({ name, prepared }) => name === "Mage Hand" && prepared !== false));
  assert.ok(applied.spellcasting.profiles?.some(({ className, ability }) => className === "Arcane Trickster" && ability === "int"));
});

test("revised multiclass spell slots round half-casters up without widening each class spell level", () => {
  const rangerSorcerer = calculationDraft([
    ["Ranger", 4],
    ["Sorcerer", 3],
  ]);
  assert.deepEqual(multiclassSpellSlots(rangerSorcerer).slice(0, 3), [4, 3, 2]);
  assert.equal(classByName("Ranger").spellcasting?.prepared[3], 5);
  assert.equal(classByName("Sorcerer").spellcasting?.prepared[2], 6);
  assert.equal(classByName("Sorcerer").spellcasting?.cantrips[2], 4);
  assert.equal(Math.max(...availableSpells(classByName("Ranger"), 4, false).map(({ level }) => level)), 1);
  assert.equal(Math.max(...availableSpells(classByName("Sorcerer"), 3, false).map(({ level }) => level)), 2);

  const paladinWizard = calculationDraft([["Paladin", 3], ["Wizard", 2]]);
  assert.deepEqual(multiclassSpellSlots(paladinWizard).slice(0, 2), [4, 3]);
});

test("pact magic remains separate from ordinary multiclass slots", () => {
  const draft = calculationDraft([["Bard", 3], ["Warlock", 2]]);
  assert.deepEqual(multiclassSpellSlots(draft).slice(0, 2), [4, 2]);
  assert.equal(classByName("Bard").spellcasting?.prepared[2], 6);
  assert.equal(classByName("Warlock").spellcasting?.prepared[1], 3);
  assert.deepEqual(classByName("Warlock").spellcasting?.pactSlots[1], { count: 2, level: 1 });
});

test("starting class owns the maximum first Hit Die and later classes use fixed gains", () => {
  const draft = calculationDraft([["Paladin", 3], ["Wizard", 2]]);
  draft.baseScores = { str: 13, dex: 10, con: 12, int: 13, wis: 10, cha: 13 };
  assert.equal(calculateFixedHitPoints(draft), 35);
  draft.classLevels.reverse();
  assert.equal(calculateFixedHitPoints(draft), 33);
});

test("every selected multiclass must meet its source primary-ability prerequisite", () => {
  const draft = calculationDraft([["Paladin", 3], ["Wizard", 2]]);
  draft.baseScores = { str: 13, dex: 10, con: 12, int: 13, wis: 10, cha: 12 };
  assert.ok(validateCharacterCreatorDraft(draft).some(({ code }) => code === `multiclass-${classByName("Paladin").id}`));
  draft.baseScores.cha = 13;
  assert.ok(!validateCharacterCreatorDraft(draft).some(({ code }) => code === `multiclass-${classByName("Paladin").id}`));
});

test("feat choices surface only options whose structured prerequisites are met", () => {
  const draft = validFighterDraft(createCharacterSheet("token-feat", "Adventurer", "sheet-feat"));
  draft.classLevels[0].levels = 4;
  const slot = featSlotsForDraft(draft)[0];
  const names = availableFeatsForSlot(draft, slot).map(({ name }) => name);
  assert.ok(names.includes("Grappler"));
  assert.ok(!names.includes("Actor"));
});

test("changing classes removes unreachable class options without resetting unrelated player choices", () => {
  const fighterDraft = validFighterDraft(createCharacterSheet("token-change", "Adventurer", "sheet-change"));
  assert.ok(Object.keys(fighterDraft.optionSelections).length > 0);
  fighterDraft.classLevels = [{ rowId: fighterDraft.classLevels[0].rowId, classId: classByName("Bard").id, levels: 1 }];
  const changed = reconcileCharacterCreatorDraft(fighterDraft);
  assert.deepEqual(changed.optionSelections, {});
  assert.equal(changed.speciesId, fighterDraft.speciesId);
  assert.equal(changed.backgroundId, fighterDraft.backgroundId);
  assert.deepEqual(changed.baseScores, fighterDraft.baseScores);
  assert.deepEqual(changed.languages, fighterDraft.languages);
  assert.ok(changed.changeNotices.some((message) => /Defense|mastery/i.test(message)));
});

test("stored drafts are sanitized and cannot retarget another private sheet", () => {
  const sheet = createCharacterSheet("token-owner", "Owner", "sheet-owner");
  const fighter = classByName("Fighter");
  const restored = restoreCharacterCreatorDraft({
    schemaVersion: 1,
    targetSheetId: "sheet-someone-else",
    targetFingerprint: 42,
    name: "X".repeat(500),
    classLevels: [{ rowId: 7, classId: fighter.id, levels: 999 }, { classId: { hostile: true }, levels: 4 }],
    abilityMethod: "invented",
    baseScores: { str: Number.POSITIVE_INFINITY, dex: 14, con: "18" },
    skillChoices: { [fighter.id]: ["athletics", "not-a-skill", { private: true }] },
    languages: "Common",
    manualChoices: { safe: "kept", oversized: "Y".repeat(10_000) },
  }, sheet);

  assert.equal(restored.targetSheetId, sheet.id);
  assert.notEqual(restored.targetFingerprint, "42");
  assert.equal(restored.name.length, 160);
  assert.deepEqual(restored.classLevels, [{ rowId: "class-1", classId: fighter.id, levels: 20 }]);
  assert.equal(restored.abilityMethod, "");
  assert.equal(restored.baseScores.str, null);
  assert.equal(restored.baseScores.dex, 14);
  assert.equal(restored.baseScores.con, null);
  assert.deepEqual(restored.skillChoices[fighter.id], ["athletics"]);
  assert.deepEqual(restored.languages, []);
});

test("review confirmation is exact, generic and stale confirmations cannot apply", async () => {
  const sheet = createCharacterSheet("token-fighter", "Adventurer", "sheet-fighter");
  const draft = validFighterDraft(sheet);
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  await assert.rejects(() => applyCharacterCreatorDraft(sheet, draft, "confirmed"), /exact current review/i);
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  assert.equal(applied.name, "Ilyra Vale");
  const changed = { ...draft, name: "Changed after review" };
  await assert.rejects(() => applyCharacterCreatorDraft(sheet, changed, review.fingerprint), /exact current review/i);
  assert.ok((await buildCharacterCreatorReview(draft, { ...sheet, subtitle: "Changed elsewhere" })).issues.some(({ code }) => code === "stale-target"));
});

test("a martial application has no spell slots and stores the passive skill bonus, not the passive total", async () => {
  const sheet = createCharacterSheet("token-martial", "Adventurer", "sheet-martial");
  const draft = validFighterDraft(sheet);
  const review = await buildCharacterCreatorReview(draft, sheet);
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);

  assert.deepEqual(applied.spellcasting.slots.map(({ total }) => total), Array(9).fill(0));
  assert.equal(applied.skills.perception.bonus, 2);
  assert.equal(applied.passive.bonus, applied.skills.perception.bonus);
  assert.equal(applied.attacks.find(({ name }) => name === "Javelin")?.attackBonus, 5);
  assert.match(applied.details.tools, /Chosen Gaming set 1/);
  assert.ok(applied.inventory.some(({ category, equipped }) => category === "Armor" && equipped));
});

test("heavy armor ignores a negative Dexterity modifier and Defense applies to worn armor", async () => {
  const sheet = createCharacterSheet("token-heavy", "Adventurer", "sheet-heavy");
  const draft = validFighterDraft(sheet);
  draft.baseScores = { str: 15, dex: 8, con: 13, int: 12, wis: 14, cha: 10 };
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  assert.equal(review.computation.armorClass, 17);
});

test("Defense does not apply when no armor is worn", async () => {
  const sheet = createCharacterSheet("token-defense-unarmored", "Adventurer", "sheet-defense-unarmored");
  const draft = validFighterDraft(sheet);
  draft.armorClassMode = "unarmored";
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  assert.equal(review.computation.armorClass, 12);
});

test("species lineage magic requires its player-owned casting ability and reaches the native sheet", async () => {
  const sheet = createCharacterSheet("token-tiefling", "Adventurer", "sheet-tiefling");
  const draft = validFighterDraft(sheet);
  draft.speciesId = speciesByName("Tiefling").id;
  draft.lineage = "Infernal";
  assert.ok(validateCharacterCreatorDraft(draft).some(({ code }) => code === "species-casting-ability"));
  draft.speciesCastingAbility = "cha";
  draft.classLevels[0].levels = 5;
  assert.deepEqual(speciesMagicForDraft(draft)?.grants.map(({ name, level }) => ({ name, level })), [
    { name: "Fire Bolt", level: 1 },
    { name: "Thaumaturgy", level: 1 },
    { name: "Hellish Rebuke", level: 3 },
    { name: "Darkness", level: 5 },
  ]);
  draft.classLevels[0].levels = 1;
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  assert.ok(applied.spellcasting.spells.some(({ name }) => name === "Fire Bolt"));
  assert.ok(applied.spellcasting.spells.some(({ name }) => name === "Thaumaturgy"));
  assert.ok(applied.spellcasting.profiles?.some(({ className, ability }) => className === "Tiefling Innate Magic" && ability === "cha"));
});

test("High Elf cantrip is a structured player choice rather than a manual substitute", () => {
  const draft = validFighterDraft(createCharacterSheet("token-manual", "Adventurer", "sheet-manual"));
  const highElf = speciesByName("Elf");
  draft.speciesId = highElf.id;
  draft.lineage = "High Elf";
  draft.speciesCastingAbility = "int";
  draft.speciesSkill = "insight";
  assert.deepEqual(speciesMagicForDraft(draft)?.choicePrompts, ["Choose one Wizard cantrip"]);
  const requirement = spellChoiceRequirementsForDraft(draft).find(({ sourceLabel }) => sourceLabel.includes("High Elf"))!;
  assert.equal(requirement.count, 1);
  assert.ok(requirement.spells.some(({ name }) => name === "Message"));
  assert.ok(validateCharacterCreatorDraft(draft).some(({ code }) => code.startsWith(requirement.key)));
  draft.spellChoiceSelections[requirement.key] = [requirement.spells.find(({ name }) => name === "Message")!.id];
  assert.ok(!validateCharacterCreatorDraft(draft).some(({ code }) => code.startsWith(requirement.key)));
  assert.ok(!validateCharacterCreatorDraft(draft).some(({ code }) => code === "manual-rulings-choice"));
});

test("unsupported or free-form species choices require and preserve the player's exact recorded intent", async () => {
  const sheet = createCharacterSheet("token-manual-human", "Adventurer", "sheet-manual-human");
  const draft = validFighterDraft(sheet);
  draft.speciesId = speciesByName("Human").id;
  draft.speciesSkill = "insight";
  draft.manualReviewAcknowledged = true;
  assert.ok(validateCharacterCreatorDraft(draft).some(({ code }) => code === "manual-rulings-choice"));
  const requirement = manualChoiceRequirementsForDraft(draft).find(({ sourceLabel }) => sourceLabel.includes("Human"))!;
  draft.manualChoices[requirement.key] = "Player chose Skilled for Versatile; Skillful is Insight.";
  assert.ok(!validateCharacterCreatorDraft(draft).some(({ code }) => code === "manual-rulings-choice"));
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "manual-review");
  assert.ok(review.summary.some((line) => line.includes("Player chose Skilled")));
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  assert.match(applied.details.classFeatures, /Player chose Skilled for Versatile/);
});

test("later proficiency grants keep their own player-owned counts and do not collapse into starting choices", () => {
  const barbarian = calculationDraft([["Barbarian", 3]]);
  assert.deepEqual(skillChoiceRequirementsForDraft(barbarian).map(({ label, count }) => ({ label, count })), [
    { label: "Starting skills", count: 2 },
    { label: "Primal Knowledge skill", count: 1 },
  ]);

  const bard = classByName("Bard");
  const lore = calculationDraft([["Bard", 3]]);
  lore.subclasses[bard.id] = bard.subclasses.find(({ name }) => name === "College of Lore")!.id;
  assert.deepEqual(skillChoiceRequirementsForDraft(lore).map(({ label, count }) => ({ label, count })), [
    { label: "Starting skills", count: 3 },
    { label: "Bonus Proficiencies", count: 3 },
  ]);

  const ranger = calculationDraft([["Ranger", 9]]);
  assert.equal(expertiseCountForDraft(ranger), 3);
  assert.equal(languageChoiceCountForDraft(ranger), 4);
  const rogue = calculationDraft([["Rogue", 1]]);
  assert.equal(expertiseCountForDraft(rogue), 2);
  assert.equal(languageChoiceCountForDraft(rogue), 3);
  const wizard = calculationDraft([["Wizard", 2]]);
  assert.equal(expertiseCountForDraft(wizard), 1);
});

test("high-level and subclass choices remain incomplete until every exact manual answer is recorded", () => {
  const wizard = calculationDraft([["Wizard", 20]]);
  const wizardRequirements = manualChoiceRequirementsForDraft(wizard);
  assert.deepEqual(wizardRequirements.filter(({ sourceLabel }) => sourceLabel.startsWith("Wizard")).map(({ label }) => label), ["Spell Mastery", "Signature Spells"]);
  assert.ok(validateCharacterCreatorDraft(wizard).some(({ code }) => code === "manual-rulings-choice"));

  const ranger = classByName("Ranger");
  const hunter = calculationDraft([["Ranger", 3]]);
  hunter.subclasses[ranger.id] = ranger.subclasses.find(({ name }) => name === "Hunter")!.id;
  assert.ok(manualChoiceRequirementsForDraft(hunter).some(({ label }) => label === "Hunter's Prey"));

  hunter.classLevels[0].levels = 7;
  assert.ok(manualChoiceRequirementsForDraft(hunter).some(({ label }) => label === "Defensive Tactics"));

  const blast = calculationDraft([["Warlock", 2]]);
  const invocation = optionRequirementsForDraft(blast).find(({ kind }) => kind === "optional")!;
  blast.optionSelections[invocation.key] = [invocation.options.find(({ name }) => name === "Repelling Blast")!.id];
  assert.ok(manualChoiceRequirementsForDraft(blast).some(({ label }) => label === "Repelling Blast choice"));
});

test("supplemental subclass compatibility never presents itself as fully automated", () => {
  const bard = classByName("Bard");
  const draft = calculationDraft([["Bard", 3]]);
  draft.subclasses[bard.id] = bard.subclasses.find(({ name }) => name === "College of Spirits")!.id;
  const requirement = manualChoiceRequirementsForDraft(draft).find(({ label }) => label === "supplement compatibility and build choices");
  assert.ok(requirement);
  assert.match(requirement.sourceLabel, /College of Spirits/);
  assert.ok(validateCharacterCreatorDraft(draft).some(({ code }) => code === "manual-rulings-choice"));
});

test("Mystic Arcanum choices expose exact spell levels without consuming ordinary Warlock choices", () => {
  const draft = calculationDraft([["Warlock", 17]]);
  const warlock = classByName("Warlock");
  const requirements = spellChoiceRequirementsForDraft(draft);
  assert.deepEqual(requirements.map(({ count, spells }) => ({ count, levels: [...new Set(spells.map(({ level }) => level))] })), [
    { count: 1, levels: [6] },
    { count: 1, levels: [7] },
    { count: 1, levels: [8] },
    { count: 1, levels: [9] },
  ]);
  assert.equal(castingDetailsForDraft(draft, warlock.id)?.prepared, 10);
});

test("subclass spellbook additions are structured and remain distinct from prepared spells", async () => {
  const sheet = createCharacterSheet("token-abjurer", "Adventurer", "sheet-abjurer");
  const draft = validWizardDraft(sheet);
  const wizard = classByName("Wizard");
  draft.classLevels[0].levels = 3;
  draft.subclasses[wizard.id] = wizard.subclasses.find(({ name }) => name === "Abjurer")!.id;
  draft.expertise = ["arcana"];
  const available = availableSpellsForDraft(draft, wizard.id, false);
  draft.spells[wizard.id] = {
    cantrips: availableSpellsForDraft(draft, wizard.id, true).slice(0, 3).map(({ id }) => id),
    spellbook: available.slice(0, 10).map(({ id }) => id),
    prepared: available.slice(0, 6).map(({ id }) => id),
  };
  const requirement = spellChoiceRequirementsForDraft(draft).find(({ destination }) => destination === "spellbook")!;
  assert.equal(requirement.count, 2);
  assert.deepEqual([...new Set(requirement.spells.map(({ school }) => school))], ["A"]);
  const additions = requirement.spells.filter(({ id }) => !draft.spells[wizard.id].spellbook.includes(id)).slice(0, 2);
  assert.equal(additions.length, 2);
  draft.spellChoiceSelections[requirement.key] = additions.map(({ id }) => id);
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  assert.ok(additions.every(({ name }) => applied.spellcasting.spells.some((spell) => spell.name === name && spell.prepared === false)));
});

test("class and subclass advancement choices expose their source-owned exact counts", () => {
  const clericDraft = calculationDraft([["Cleric", 1]]);
  const divineOrder = optionRequirementsForDraft(clericDraft).find(({ label }) => label === "Divine Order")!;
  assert.equal(divineOrder.count, 1);
  assert.deepEqual(divineOrder.options.map(({ name }) => name), ["Protector", "Thaumaturge"]);

  const fighter = classByName("Fighter");
  const battleMaster = calculationDraft([["Fighter", 3]]);
  battleMaster.subclasses[fighter.id] = fighter.subclasses.find(({ name }) => name === "Battle Master")!.id;
  assert.equal(optionRequirementsForDraft(battleMaster).find(({ label }) => label === "Battle Master: Maneuvers")?.count, 3);

  const champion = calculationDraft([["Fighter", 7]]);
  champion.subclasses[fighter.id] = fighter.subclasses.find(({ name }) => name === "Champion")!.id;
  assert.equal(optionRequirementsForDraft(champion).find(({ label }) => label === "Champion: Fighting Style")?.count, 1);

  const warlock = calculationDraft([["Warlock", 2]]);
  const invocationRequirements = optionRequirementsForDraft(warlock).filter(({ label }) => /Eldritch Invocation/i.test(label));
  assert.deepEqual(invocationRequirements.map(({ count }) => count), [3]);

  const sorcerer = calculationDraft([["Sorcerer", 2]]);
  const metamagicRequirements = optionRequirementsForDraft(sorcerer).filter(({ label }) => /Metamagic/i.test(label));
  assert.deepEqual(metamagicRequirements.map(({ count }) => count), [2]);
});

test("wizard spellbook spells remain distinct from the currently prepared subset", async () => {
  const sheet = createCharacterSheet("token-wizard", "Adventurer", "sheet-wizard");
  const draft = validWizardDraft(sheet);
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  const leveled = applied.spellcasting.spells.filter(({ level }) => level > 0);
  assert.equal(leveled.length, 6);
  assert.equal(leveled.filter(({ prepared }) => prepared !== false).length, 4);
  assert.equal(leveled.filter(({ prepared }) => prepared === false).length, 2);
});

test("an explicit level-20 martial build applies every advancement without lowering the rules ceiling", async () => {
  const sheet = createCharacterSheet("token-20", "Adventurer", "sheet-20");
  const draft = validFighterDraft(sheet);
  const fighter = classByName("Fighter");
  draft.classLevels[0].levels = 20;
  draft.subclasses[fighter.id] = fighter.subclasses.find(({ name }) => name === "Champion")!.id;
  for (const requirement of optionRequirementsForDraft(draft)) draft.optionSelections[requirement.key] = requirement.optionIds.slice(0, requirement.count);
  const asi = characterCatalogue.feats.find(({ name }) => name === "Ability Score Improvement")!;
  const boon = characterCatalogue.feats.find(({ name }) => name === "Boon of Combat Prowess")!;
  const pairs: Array<[keyof CharacterCreatorDraft["baseScores"], keyof CharacterCreatorDraft["baseScores"]]> = [
    ["str", "dex"], ["con", "int"], ["wis", "cha"], ["str", "dex"], ["con", "int"], ["wis", "cha"],
  ];
  let generalIndex = 0;
  for (const slot of featSlotsForDraft(draft)) {
    if (slot.category === "EB") draft.feats[slot.id] = { featId: boon.id, abilityIncreases: { str: 1 } };
    else {
      const [first, second] = pairs[generalIndex++];
      draft.feats[slot.id] = { featId: asi.id, abilityIncreases: { [first]: 1, [second]: 1 } };
    }
  }
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  assert.equal(applied.identity.level, 20);
  assert.equal(applied.vitals.proficiency, 6);
  assert.equal(applied.vitals.hpMax, 184);
  assert.equal(applied.abilities.str.score, 20);
  assert.equal(review.computation.optionNames.filter((name) => name.endsWith(" mastery")).length, 6);
});

test("Extra Attack does not stack across classes and table progressions create only real resources", async () => {
  const sheet = createCharacterSheet("token-extra", "Adventurer", "sheet-extra");
  const draft = validFighterDraft(sheet);
  const fighter = classByName("Fighter");
  const barbarian = classByName("Barbarian");
  draft.classLevels = [
    { rowId: "class-fighter", classId: fighter.id, levels: 5 },
    { rowId: "class-barbarian", classId: barbarian.id, levels: 5 },
  ];
  draft.baseScores = { ...draft.baseScores, str: 15 };
  draft.subclasses[fighter.id] = fighter.subclasses.find(({ name }) => name === "Champion")!.id;
  draft.subclasses[barbarian.id] = barbarian.subclasses.find(({ name }) => name === "Path of the Berserker")!.id;
  draft.skillChoices[fighter.id] = ["perception", "survival"];
  draft.skillChoices[`${barbarian.id}:feature:primal-knowledge`] = ["nature"];
  for (const requirement of optionRequirementsForDraft(draft)) draft.optionSelections[requirement.key] = requirement.optionIds.slice(0, requirement.count);
  for (const slot of featSlotsForDraft(draft)) {
    const feat = availableFeatsForSlot(draft, slot).find(({ name }) => name === "Ability Score Improvement")!;
    draft.feats[slot.id] = { featId: feat.id, abilityIncreases: { int: 1, wis: 1 } };
  }
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.computation.featureNames.filter((name) => name.endsWith(": Extra Attack")).length, 1);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  assert.ok(applied.resources.some(({ name }) => name === "Rages"));
  assert.ok(applied.resources.some(({ name }) => name === "Second Wind"));
  assert.ok(!applied.resources.some(({ name }) => name === "Rage Damage"));
});

test("a mixed martial/caster multiclass gets class-level spell access and shared slots", async () => {
  const sheet = createCharacterSheet("token-mixed", "Adventurer", "sheet-mixed");
  const draft = validFighterDraft(sheet);
  const fighter = classByName("Fighter");
  const wizard = classByName("Wizard");
  draft.classLevels = [
    { rowId: "class-fighter", classId: fighter.id, levels: 3 },
    { rowId: "class-wizard", classId: wizard.id, levels: 2 },
  ];
  draft.baseScores = { ...draft.baseScores, con: 12, int: 13 };
  draft.skillChoices[fighter.id] = ["perception", "history"];
  draft.expertise = ["history"];
  draft.subclasses[fighter.id] = fighter.subclasses.find(({ name }) => name === "Champion")!.id;
  const wizardCantrips = availableSpellsForDraft(draft, wizard.id, true);
  const wizardSpells = availableSpellsForDraft(draft, wizard.id, false);
  draft.spells[wizard.id] = {
    cantrips: wizardCantrips.slice(0, 3).map(({ id }) => id),
    spellbook: wizardSpells.slice(0, 8).map(({ id }) => id),
    prepared: wizardSpells.slice(0, 5).map(({ id }) => id),
  };
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  assert.equal(applied.identity.className, "Fighter 3 / Wizard 2");
  assert.equal(applied.vitals.hitDie, "3d10 + 2d6");
  assert.deepEqual(applied.spellcasting.slots.slice(0, 2).map(({ total }) => total), [3, 0]);
  assert.equal(applied.spellcasting.ability, "INT");
  assert.equal(applied.spellcasting.spells.filter(({ level, prepared }) => level > 0 && prepared === false).length, 3);
});

test("application and reapplication preserve manual sheet work without duplicating creator grants", async () => {
  const base = createCharacterSheet("token-apply", "Adventurer", "sheet-apply");
  base.inventory.push({ id: "item-manual-keepsake", name: "Keepsake", quantity: 1, weight: 0, category: "Personal", equipped: false, notes: "manual" });
  base.spellcasting.spells.push({ id: "spell-manual-boon", level: 0, name: "Table Boon", castingTime: "1 action", range: "Self", concentration: false, ritual: false, material: "", notes: "manual" });
  base.notes = [{ text: "Do not erase this." }];
  base.strokes = [{ id: "stroke-manual", color: "#112233", width: 3, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }];
  const firstDraft = validFighterDraft(base);
  const firstReview = await buildCharacterCreatorReview(firstDraft, base);
  const first = await applyCharacterCreatorDraft(base, firstDraft, firstReview.fingerprint);
  assert.equal(first.inventory.filter(({ id }) => id.startsWith("item-creator-")).length, first.creator?.managedInventoryIds.length);
  assert.ok(first.inventory.some(({ id }) => id === "item-manual-keepsake"));
  assert.ok(first.spellcasting.spells.some(({ id }) => id === "spell-manual-boon"));
  assert.deepEqual(first.notes, base.notes);
  assert.deepEqual(first.strokes, base.strokes);

  const secondDraft = rebaseCharacterCreatorDraft(firstDraft, first);
  const secondReview = await buildCharacterCreatorReview(secondDraft, first);
  const second = await applyCharacterCreatorDraft(first, secondDraft, secondReview.fingerprint);
  assert.equal(second.inventory.filter(({ id }) => id.startsWith("item-creator-")).length, first.inventory.filter(({ id }) => id.startsWith("item-creator-")).length);
  assert.equal(second.details.classFeatures.match(/\[20Fates Creator\]/g)?.length, 1);
  assert.ok(second.inventory.some(({ id }) => id === "item-manual-keepsake"));
});

test("leveling preserves damage taken rather than freezing current HP", async () => {
  const base = createCharacterSheet("token-level", "Adventurer", "sheet-level");
  const levelOneDraft = validFighterDraft(base);
  const levelOneReview = await buildCharacterCreatorReview(levelOneDraft, base);
  const levelOne = await applyCharacterCreatorDraft(base, levelOneDraft, levelOneReview.fingerprint);
  const wounded = { ...levelOne, vitals: { ...levelOne.vitals, hpCurrent: levelOne.vitals.hpMax - 5 } };
  const levelTwoDraft = createCharacterCreatorDraft(wounded);
  levelTwoDraft.classLevels[0].levels = 2;
  const levelTwoReview = await buildCharacterCreatorReview(levelTwoDraft, wounded);
  assert.equal(levelTwoReview.status, "ready", levelTwoReview.issues.map(({ message }) => message).join("\n"));
  const levelTwo = await applyCharacterCreatorDraft(wounded, levelTwoDraft, levelTwoReview.fingerprint);
  assert.equal(levelTwo.vitals.hpMax, 20);
  assert.equal(levelTwo.vitals.hpCurrent, 15);
});

test("class and background equipment keep distinct stable identities when both grant the same item", async () => {
  const sheet = createCharacterSheet("token-equipment", "Adventurer", "sheet-equipment");
  const draft = validFighterDraft(sheet);
  const fighterPackage = classByName("Fighter").equipment.find(({ label }) => label === "Package B")!;
  const backgroundPackage = backgroundByName("Soldier").equipment.find(({ label }) => label === "Package A")!;
  draft.equipment.classPackageId = fighterPackage.id;
  draft.equipment.backgroundPackageId = backgroundPackage.id;
  for (const choice of [fighterPackage, backgroundPackage]) {
    for (const entry of choice.items) {
      if (entry.prompt) {
        draft.equipment.customNames[entry.id] = "Bone dice";
        draft.equipment.customNames[`${choice.id}:${entry.id}`] = "Bone dice";
      }
      const item = characterCatalogue.items.find(({ id }) => id === entry.id);
      if (item?.properties.includes("F")) draft.weaponAbilities[item.id] = "dex";
    }
  }
  const review = await buildCharacterCreatorReview(draft, sheet);
  assert.equal(review.status, "ready", review.issues.map(({ message }) => message).join("\n"));
  const applied = await applyCharacterCreatorDraft(sheet, draft, review.fingerprint);
  const arrowStacks = applied.inventory.filter(({ name }) => name === "Arrows (20)");
  assert.equal(arrowStacks.length, 2);
  assert.equal(new Set(arrowStacks.map(({ id }) => id)).size, 2);
});

test("creator metadata and multiple casting profiles survive native export/import", async () => {
  const base = createCharacterSheet("token-roundtrip", "Adventurer", "sheet-roundtrip");
  const draft = validFighterDraft(base);
  const review = await buildCharacterCreatorReview(draft, base);
  const applied = await applyCharacterCreatorDraft(base, draft, review.fingerprint);
  const imported = importCharacterSheet(JSON.parse(JSON.stringify(applied)), createCharacterSheet("new-token", "Blank", "new-sheet"));
  assert.equal(imported.tokenId, "new-token");
  assert.equal(imported.id, "new-sheet");
  assert.equal(imported.creator?.appliedReviewFingerprint, applied.creator?.appliedReviewFingerprint);
  assert.deepEqual(imported.spellcasting.profiles, applied.spellcasting.profiles);
  const resumed = createCharacterCreatorDraft(imported);
  assert.deepEqual(resumed.classLevels.map(({ classId, levels }) => ({ classId, levels })), draft.classLevels.map(({ classId, levels }) => ({ classId, levels })));
  assert.equal(resumed.speciesId, draft.speciesId);
  assert.equal(resumed.backgroundId, draft.backgroundId);
  assert.deepEqual(resumed.optionSelections, draft.optionSelections);
  assert.equal(resumed.targetFingerprint, (await buildCharacterCreatorReview(resumed, imported)).targetFingerprint);
});

test("creator modules have no live, network, provider, or room-state path", async () => {
  const sources = await Promise.all([
    "../lib/character-creator.ts",
    "../lib/character-catalogue.ts",
    "../scripts/build-character-catalogue.mjs",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /fetch\s*\(|WebSocket|roomCode|dmKey|OPENAI_API_KEY|process\.env|discord/i);
});

function calculationDraft(classes: Array<[string, number]>): CharacterCreatorDraft {
  const draft = createCharacterCreatorDraft(createCharacterSheet("token-calc", "Calculator", "sheet-calc"));
  draft.name = "Calculator";
  draft.classLevels = classes.map(([name, levels], index) => ({ rowId: `class-${index + 1}`, classId: classByName(name).id, levels }));
  draft.abilityMethod = "rolled";
  draft.baseScores = { str: 13, dex: 13, con: 12, int: 13, wis: 13, cha: 13 };
  return draft;
}

function validFighterDraft(sheet: ReturnType<typeof createCharacterSheet>): CharacterCreatorDraft {
  const draft = createCharacterCreatorDraft(sheet);
  const fighter = classByName("Fighter");
  const orc = speciesByName("Orc");
  const soldier = backgroundByName("Soldier");
  draft.name = "Ilyra Vale";
  draft.classLevels = [{ rowId: "class-1", classId: fighter.id, levels: 1 }];
  draft.speciesId = orc.id;
  draft.size = "Medium";
  draft.backgroundId = soldier.id;
  draft.abilityMethod = "standard";
  draft.baseScores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  draft.boostMode = "2+1";
  draft.boostTwo = "str";
  draft.boostOne = "con";
  draft.skillChoices[fighter.id] = ["perception", "survival"];
  draft.languages = characterCatalogue.rules.languages.slice(0, 2);
  for (const requirement of toolChoiceRequirementsForDraft(draft)) draft.toolChoices[requirement.key] = Array.from({ length: requirement.count }, (_, index) => `Chosen ${requirement.label} ${index + 1}`);
  draft.equipment.classPackageId = fighter.equipment.find(({ label }) => label === "Package A")!.id;
  draft.equipment.backgroundPackageId = soldier.equipment.find(({ label }) => label === "Package B")!.id;
  draft.hpMode = "fixed";
  draft.armorClassMode = "equipped";
  for (const requirement of optionRequirementsForDraft(draft)) {
    if (requirement.kind === "feat") draft.optionSelections[requirement.key] = [characterCatalogue.feats.find(({ name, category }) => name === "Defense" && category === "FS")!.id];
    else draft.optionSelections[requirement.key] = requirement.optionIds.slice(0, requirement.count);
  }
  return draft;
}

function validArcaneTricksterDraft(sheet: ReturnType<typeof createCharacterSheet>): CharacterCreatorDraft {
  const draft = createCharacterCreatorDraft(sheet);
  const rogue = classByName("Rogue");
  const orc = speciesByName("Orc");
  const soldier = backgroundByName("Soldier");
  draft.name = "Sable Thread";
  draft.classLevels = [{ rowId: "class-1", classId: rogue.id, levels: 3 }];
  draft.subclasses[rogue.id] = rogue.subclasses.find(({ name }) => name === "Arcane Trickster")!.id;
  draft.speciesId = orc.id;
  draft.size = "Medium";
  draft.backgroundId = soldier.id;
  draft.abilityMethod = "standard";
  draft.baseScores = { str: 10, dex: 15, con: 13, int: 14, wis: 12, cha: 8 };
  draft.boostMode = "2+1";
  draft.boostTwo = "dex";
  draft.boostOne = "con";
  draft.skillChoices[rogue.id] = ["acrobatics", "deception", "investigation", "stealth"];
  draft.expertise = ["acrobatics", "stealth"];
  draft.languages = characterCatalogue.rules.languages.slice(0, 3);
  for (const requirement of toolChoiceRequirementsForDraft(draft)) draft.toolChoices[requirement.key] = ["Dragonchess set"];
  draft.equipment.classPackageId = rogue.equipment.find(({ label }) => label === "Package A")!.id;
  draft.equipment.backgroundPackageId = soldier.equipment.find(({ label }) => label === "Package B")!.id;
  for (const choice of [
    rogue.equipment.find(({ id }) => id === draft.equipment.classPackageId),
    soldier.equipment.find(({ id }) => id === draft.equipment.backgroundPackageId),
  ]) {
    for (const entry of choice?.items ?? []) {
      const item = characterCatalogue.items.find(({ id }) => id === entry.id);
      if (item?.properties.includes("F")) draft.weaponAbilities[item.id] = "dex";
    }
  }
  draft.hpMode = "fixed";
  draft.armorClassMode = "equipped";
  const cantrips = availableSpellsForDraft(draft, rogue.id, true);
  const spells = availableSpellsForDraft(draft, rogue.id, false);
  draft.spells[rogue.id] = {
    cantrips: cantrips.slice(0, 2).map(({ id }) => id),
    prepared: spells.slice(0, 3).map(({ id }) => id),
    spellbook: [],
  };
  return draft;
}

function validWizardDraft(sheet: ReturnType<typeof createCharacterSheet>): CharacterCreatorDraft {
  const draft = createCharacterCreatorDraft(sheet);
  const wizard = classByName("Wizard");
  const orc = speciesByName("Orc");
  const soldier = backgroundByName("Soldier");
  draft.name = "Maelin Quill";
  draft.classLevels = [{ rowId: "class-1", classId: wizard.id, levels: 1 }];
  draft.speciesId = orc.id;
  draft.size = "Medium";
  draft.backgroundId = soldier.id;
  draft.abilityMethod = "standard";
  draft.baseScores = { str: 10, dex: 13, con: 14, int: 15, wis: 12, cha: 8 };
  draft.boostMode = "2+1";
  draft.boostTwo = "dex";
  draft.boostOne = "con";
  draft.skillChoices[wizard.id] = ["arcana", "history"];
  draft.languages = characterCatalogue.rules.languages.slice(0, 2);
  for (const requirement of toolChoiceRequirementsForDraft(draft)) draft.toolChoices[requirement.key] = Array.from({ length: requirement.count }, (_, index) => `Chosen ${requirement.label} ${index + 1}`);
  draft.equipment.classPackageId = wizard.equipment.find(({ label }) => label === "Package A")!.id;
  draft.equipment.backgroundPackageId = soldier.equipment.find(({ label }) => label === "Package B")!.id;
  for (const choice of [
    wizard.equipment.find(({ id }) => id === draft.equipment.classPackageId),
    soldier.equipment.find(({ id }) => id === draft.equipment.backgroundPackageId),
  ]) {
    for (const entry of choice?.items ?? []) {
      const item = characterCatalogue.items.find(({ id }) => id === entry.id);
      if (item?.properties.includes("F")) draft.weaponAbilities[item.id] = "dex";
    }
  }
  draft.hpMode = "fixed";
  draft.armorClassMode = "unarmored";
  const availableCantrips = availableSpellsForDraft(draft, wizard.id, true);
  const availableSpells = availableSpellsForDraft(draft, wizard.id, false);
  draft.spells[wizard.id] = {
    cantrips: availableCantrips.slice(0, 3).map(({ id }) => id),
    spellbook: availableSpells.slice(0, 6).map(({ id }) => id),
    prepared: availableSpells.slice(0, 4).map(({ id }) => id),
  };
  return draft;
}
