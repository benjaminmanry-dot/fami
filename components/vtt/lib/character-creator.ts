import {
  catalogueBackground,
  catalogueFeat,
  characterCatalogue,
  type CatalogueClass,
  type CatalogueEquipmentChoice,
  type CatalogueFeat,
  type CatalogueItem,
  type CatalogueOptionalFeature,
  type CatalogueSpell,
  type CatalogueSpellChoice,
  type CatalogueSpellGrant,
  type CatalogueSpellListExpansion,
  type CatalogueSpellcasting,
} from "./character-catalogue.ts";
import {
  abilityKeys,
  type AbilityKey,
  type CharacterSheet,
  skillDefinitions,
  type SkillId,
} from "./character-sheet.ts";

type AbilityScores = Record<AbilityKey, number | null>;
type FinalAbilityScores = Record<AbilityKey, number>;

export type CreatorClassLevel = {
  rowId: string;
  classId: string;
  levels: number;
};

export type CreatorFeatChoice = {
  featId: string;
  abilityIncreases: Partial<Record<AbilityKey, number>>;
};

export type CreatorSpellChoices = {
  cantrips: string[];
  prepared: string[];
  spellbook: string[];
};

export type CharacterCreatorDraft = {
  schemaVersion: 1;
  targetSheetId: string;
  targetFingerprint: string;
  name: string;
  classLevels: CreatorClassLevel[];
  speciesId: string;
  lineage: string;
  speciesCastingAbility: AbilityKey | "";
  size: string;
  backgroundId: string;
  abilityMethod: "" | "standard" | "point-buy" | "rolled";
  baseScores: AbilityScores;
  boostMode: "" | "2+1" | "1+1+1";
  boostTwo: AbilityKey | "";
  boostOne: AbilityKey | "";
  skillChoices: Record<string, SkillId[]>;
  speciesSkill: SkillId | "";
  expertise: SkillId[];
  languages: string[];
  toolChoices: Record<string, string[]>;
  subclasses: Record<string, string>;
  feats: Record<string, CreatorFeatChoice>;
  optionSelections: Record<string, string[]>;
  spells: Record<string, CreatorSpellChoices>;
  spellChoiceSelections: Record<string, string[]>;
  manualChoices: Record<string, string>;
  equipment: { classPackageId: string; backgroundPackageId: string; customNames: Record<string, string> };
  weaponAbilities: Record<string, "str" | "dex">;
  hpMode: "" | "fixed" | "manual";
  manualHitPoints: number | null;
  resetCurrentHitPoints: boolean;
  armorClassMode: "" | "equipped" | "unarmored" | "barbarian" | "monk" | "manual";
  manualArmorClass: number | null;
  manualRulings: string;
  manualReviewAcknowledged: boolean;
  changeNotices: string[];
};

export type CreatorIssue = {
  step: "Basics" | "Abilities" | "Proficiencies" | "Features" | "Spells" | "Equipment" | "Review";
  code: string;
  message: string;
  blocking: boolean;
};

export type CreatorOptionRequirement = {
  key: string;
  classId: string;
  label: string;
  count: number;
  kind: "feat" | "optional" | "weapon-mastery" | "feature-choice";
  optionIds: string[];
  options: Array<{ id: string; name: string; source: string }>;
};

export type CreatorFeatSlot = {
  id: string;
  classId: string;
  className: string;
  level: number;
  category: "G" | "EB";
  label: string;
};

export type CreatorToolChoiceRequirement = {
  key: string;
  label: string;
  count: number;
  sourceLabel: string;
};

export type CreatorSkillChoiceRequirement = {
  key: string;
  label: string;
  count: number;
  from: SkillId[] | "any";
  sourceLabel: string;
};

export type CreatorManualChoiceRequirement = {
  key: string;
  label: string;
  sourceLabel: string;
  prompt: string;
};

export type CreatorCastingDetails = {
  classId: string;
  className: string;
  profileName: string;
  ability: AbilityKey;
  progression: CatalogueSpellcasting["progression"];
  cantrips: number;
  prepared: number;
  spellbook: number;
  maximumSpellLevel: number;
};

export type CreatorSpellChoiceRequirement = {
  key: string;
  label: string;
  sourceLabel: string;
  classId: string;
  destination: CatalogueSpellChoice["destination"];
  count: number;
  spells: CatalogueSpell[];
};

export type CharacterCreatorComputation = {
  level: number;
  classSummary: string;
  finalScores: FinalAbilityScores;
  proficiency: number;
  hitPoints: number;
  armorClass: number;
  normalSlots: number[];
  pactSlots: Array<{ className: string; count: number; level: number }>;
  preparedCounts: Array<{ classId: string; className: string; cantrips: number; prepared: number; spellbook: number; maximumSpellLevel: number }>;
  featureNames: string[];
  featNames: string[];
  optionNames: string[];
  trainingChoiceNames: string[];
  manualChoiceNames: string[];
  spellNames: string[];
  equipmentNames: string[];
  manualReviewReasons: string[];
};

export type CharacterCreatorReview = {
  status: "incomplete" | "ready" | "manual-review";
  fingerprint: string;
  targetFingerprint: string;
  issues: CreatorIssue[];
  summary: string[];
  changedFields: string[];
  computation: CharacterCreatorComputation;
};

const emptyScores = (): AbilityScores => ({ str: null, dex: null, con: null, int: null, wis: null, cha: null });
const fullSlotTable = characterCatalogue.classes.find((entry) => entry.spellcasting?.progression === "full")?.spellcasting?.slotTable ?? [];
const managedBlockPattern = /\n?\[20Fates Creator\][\s\S]*?\[\/20Fates Creator\]\n?/g;

function blankCharacterCreatorDraft(sheet: CharacterSheet): CharacterCreatorDraft {
  return {
    schemaVersion: 1,
    targetSheetId: sheet.id,
    targetFingerprint: sheetTargetFingerprint(sheet),
    name: sheet.name === "Adventurer" ? "" : sheet.name,
    classLevels: [{ rowId: "class-1", classId: "", levels: 0 }],
    speciesId: "",
    lineage: "",
    speciesCastingAbility: "",
    size: "",
    backgroundId: "",
    abilityMethod: "",
    baseScores: emptyScores(),
    boostMode: "",
    boostTwo: "",
    boostOne: "",
    skillChoices: {},
    speciesSkill: "",
    expertise: [],
    languages: [],
    toolChoices: {},
    subclasses: {},
    feats: {},
    optionSelections: {},
    spells: {},
    spellChoiceSelections: {},
    manualChoices: {},
    equipment: { classPackageId: "", backgroundPackageId: "", customNames: {} },
    weaponAbilities: {},
    hpMode: "",
    manualHitPoints: null,
    resetCurrentHitPoints: false,
    armorClassMode: "",
    manualArmorClass: null,
    manualRulings: "",
    manualReviewAcknowledged: false,
    changeNotices: [],
  };
}

export function createCharacterCreatorDraft(sheet: CharacterSheet): CharacterCreatorDraft {
  const stored = sheet.creator?.buildState;
  if (!stored) return blankCharacterCreatorDraft(sheet);
  return rebaseCharacterCreatorDraft(restoreCharacterCreatorDraft(stored, sheet), sheet);
}

export function restoreCharacterCreatorDraft(value: unknown, sheet: CharacterSheet): CharacterCreatorDraft {
  const base = blankCharacterCreatorDraft(sheet);
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const raw = value as Partial<CharacterCreatorDraft>;
  const object = (candidate: unknown): Record<string, unknown> => candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
  const text = (candidate: unknown, maximum = 4_000) => typeof candidate === "string" ? candidate.slice(0, maximum) : "";
  const numberOrNull = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
  const strings = (candidate: unknown, maximum = 300): string[] => Array.isArray(candidate) ? candidate.flatMap((entry) => typeof entry === "string" ? [entry.slice(0, 200)] : []).slice(0, maximum) : [];
  const stringRecord = (candidate: unknown): Record<string, string> => Object.fromEntries(Object.entries(object(candidate)).flatMap(([key, entry]) => {
    const value = text(entry);
    return value && key.length <= 300 ? [[key, value]] : [];
  }).slice(0, 300));
  const stringArrayRecord = (candidate: unknown): Record<string, string[]> => Object.fromEntries(Object.entries(object(candidate)).flatMap(([key, entry]) =>
    key.length <= 300 && Array.isArray(entry) ? [[key, strings(entry)]] : [],
  ).slice(0, 300));
  const rawScores = object(raw.baseScores);
  const baseScores = Object.fromEntries(abilityKeys.map((ability) => [ability, numberOrNull(rawScores[ability])])) as AbilityScores;
  const skillIds = new Set(skillDefinitions.map(({ id }) => id));
  const skillChoices = Object.fromEntries(Object.entries(stringArrayRecord(raw.skillChoices)).map(([key, values]) => [key, values.filter((id): id is SkillId => skillIds.has(id as SkillId))]));
  const rawFeats = object(raw.feats);
  const feats = Object.fromEntries(Object.entries(rawFeats).flatMap(([key, entry]) => {
    const choice = object(entry);
    const featId = text(choice.featId, 300);
    if (!featId || key.length > 300) return [];
    const increases = object(choice.abilityIncreases);
    return [[key, {
      featId,
      abilityIncreases: Object.fromEntries(abilityKeys.flatMap((ability) => typeof increases[ability] === "number" ? [[ability, Number(increases[ability])]] : [])),
    }]];
  }).slice(0, 50));
  const spells = Object.fromEntries(Object.entries(object(raw.spells)).flatMap(([key, entry]) => {
    if (key.length > 300) return [];
    const choice = object(entry);
    return [[key, { cantrips: strings(choice.cantrips), prepared: strings(choice.prepared), spellbook: strings(choice.spellbook) }]];
  }).slice(0, 20));
  const rawEquipment = object(raw.equipment);
  return reconcileCharacterCreatorDraft({
    ...base,
    targetSheetId: sheet.id,
    targetFingerprint: text(raw.targetFingerprint, 100) || base.targetFingerprint,
    name: text(raw.name, 160),
    classLevels: Array.isArray(raw.classLevels) ? raw.classLevels.flatMap((entry, index) => {
      const row = object(entry);
      return typeof row.classId === "string" ? [{ rowId: text(row.rowId, 300) || `class-${index + 1}`, classId: text(row.classId, 300), levels: Number(row.levels) } as CreatorClassLevel] : [];
    }) : base.classLevels,
    speciesId: text(raw.speciesId, 300),
    lineage: text(raw.lineage, 160),
    speciesCastingAbility: abilityKeys.includes(raw.speciesCastingAbility as AbilityKey) ? raw.speciesCastingAbility as AbilityKey : "",
    size: text(raw.size, 40),
    backgroundId: text(raw.backgroundId, 300),
    abilityMethod: ["standard", "point-buy", "rolled"].includes(String(raw.abilityMethod)) ? raw.abilityMethod as CharacterCreatorDraft["abilityMethod"] : "",
    baseScores,
    boostMode: raw.boostMode === "2+1" || raw.boostMode === "1+1+1" ? raw.boostMode : "",
    boostTwo: abilityKeys.includes(raw.boostTwo as AbilityKey) ? raw.boostTwo as AbilityKey : "",
    boostOne: abilityKeys.includes(raw.boostOne as AbilityKey) ? raw.boostOne as AbilityKey : "",
    skillChoices,
    speciesSkill: skillIds.has(raw.speciesSkill as SkillId) ? raw.speciesSkill as SkillId : "",
    expertise: strings(raw.expertise).filter((id): id is SkillId => skillIds.has(id as SkillId)),
    languages: strings(raw.languages, 20),
    toolChoices: stringArrayRecord(raw.toolChoices),
    subclasses: stringRecord(raw.subclasses),
    feats,
    optionSelections: stringArrayRecord(raw.optionSelections),
    spells,
    spellChoiceSelections: stringArrayRecord(raw.spellChoiceSelections),
    manualChoices: stringRecord(raw.manualChoices),
    equipment: {
      classPackageId: text(rawEquipment.classPackageId, 300),
      backgroundPackageId: text(rawEquipment.backgroundPackageId, 300),
      customNames: stringRecord(rawEquipment.customNames),
    },
    weaponAbilities: Object.fromEntries(Object.entries(object(raw.weaponAbilities)).flatMap(([key, entry]) => key.length <= 300 && (entry === "str" || entry === "dex") ? [[key, entry]] : []).slice(0, 300)),
    hpMode: raw.hpMode === "fixed" || raw.hpMode === "manual" ? raw.hpMode : "",
    manualHitPoints: numberOrNull(raw.manualHitPoints),
    resetCurrentHitPoints: raw.resetCurrentHitPoints === true,
    armorClassMode: ["equipped", "unarmored", "barbarian", "monk", "manual"].includes(String(raw.armorClassMode)) ? raw.armorClassMode as CharacterCreatorDraft["armorClassMode"] : "",
    manualArmorClass: numberOrNull(raw.manualArmorClass),
    manualRulings: text(raw.manualRulings, 12_000),
    manualReviewAcknowledged: raw.manualReviewAcknowledged === true,
    changeNotices: strings(raw.changeNotices, 40).map((entry) => entry.slice(0, 500)),
  });
}

export function reconcileCharacterCreatorDraft(input: CharacterCreatorDraft): CharacterCreatorDraft {
  const draft = structuredClone(input);
  const notices = new Set(draft.changeNotices);
  const recordChange = (message: string) => notices.add(message);
  draft.classLevels = draft.classLevels.slice(0, 13).map((row, index) => ({
    rowId: row.rowId || `class-${index + 1}`,
    classId: classById(row.classId)?.id ?? "",
    levels: integer(row.levels, 0, 20),
  }));
  if (draft.classLevels.length === 0) draft.classLevels = [{ rowId: "class-1", classId: "", levels: 0 }];
  const selectedClassIds = new Set(draft.classLevels.map(({ classId }) => classById(classId)?.id).filter(Boolean));
  for (const key of Object.keys(draft.subclasses)) if (!selectedClassIds.has(key)) {
    recordChange(`Removed ${choiceName(draft.subclasses[key])} because its class is no longer in the progression.`);
    delete draft.subclasses[key];
  }
  for (const key of Object.keys(draft.spells)) if (!selectedClassIds.has(key)) {
    recordChange(`Removed ${spellChoiceNames(draft.spells[key]).join(", ") || "spell choices"} because their class is no longer in the progression.`);
    delete draft.spells[key];
  }
  for (const row of draft.classLevels) {
    const data = classById(row.classId);
    const selected = data?.subclasses.find(({ id }) => id === draft.subclasses[row.classId]);
    if ((!selected || selected.level > row.levels) && draft.subclasses[row.classId]) {
      recordChange(`Removed ${choiceName(draft.subclasses[row.classId])} because it is not available at the revised ${data?.name ?? "class"} level.`);
      delete draft.subclasses[row.classId];
    }
  }
  const validSkillChoiceKeys = new Set(skillChoiceRequirementsForDraft(draft).map(({ key }) => key));
  for (const key of Object.keys(draft.skillChoices)) if (!validSkillChoiceKeys.has(key)) {
    recordChange(`Removed skill choices ${draft.skillChoices[key].map(skillName).join(", ")} because their granting feature is no longer available.`);
    delete draft.skillChoices[key];
  }
  const validToolChoiceKeys = new Set(toolChoiceRequirementsForDraft(draft).map(({ key }) => key));
  for (const key of Object.keys(draft.toolChoices)) if (!validToolChoiceKeys.has(key)) {
    recordChange(`Removed tool choices ${draft.toolChoices[key].join(", ")} because their granting feature is no longer available.`);
    delete draft.toolChoices[key];
  }
  const validOptionKeys = new Set(optionRequirementsForDraft(draft).map(({ key }) => key));
  for (const key of Object.keys(draft.optionSelections)) if (!validOptionKeys.has(key)) {
    recordChange(`Removed ${draft.optionSelections[key].map(choiceName).join(", ") || "feature choices"} because their granting feature is no longer available.`);
    delete draft.optionSelections[key];
  }
  const validFeatSlotIds = new Set(featSlotsForDraft(draft).map(({ id }) => id));
  for (const key of Object.keys(draft.feats)) if (!validFeatSlotIds.has(key)) {
    recordChange(`Removed ${choiceName(draft.feats[key].featId)} because its feat slot is no longer available.`);
    delete draft.feats[key];
  }
  const validManualChoiceKeys = new Set(manualChoiceRequirementsForDraft(draft).map(({ key }) => key));
  for (const key of Object.keys(draft.manualChoices)) if (!validManualChoiceKeys.has(key)) {
    recordChange(`Removed a recorded manual answer because its source choice is no longer available: ${draft.manualChoices[key].slice(0, 120)}`);
    delete draft.manualChoices[key];
  }
  const species = characterCatalogue.species.find(({ id }) => id === draft.speciesId);
  if (!species) {
    draft.speciesId = "";
    draft.lineage = "";
    draft.speciesCastingAbility = "";
    draft.size = "";
    draft.speciesSkill = "";
  } else {
    if (!species.lineages.includes(draft.lineage)) draft.lineage = "";
    if (species.sizes.length === 1) draft.size = species.sizes[0];
    else if (!species.sizes.includes(draft.size)) draft.size = "";
    if (species.skillChoice.count === 0) draft.speciesSkill = "";
    const magic = speciesMagicForDraft(draft);
    if (!magic?.abilityChoices.includes(draft.speciesCastingAbility as AbilityKey)) draft.speciesCastingAbility = "";
  }

  const background = catalogueBackground(draft.backgroundId);
  if (!background) {
    draft.backgroundId = "";
    draft.boostMode = "";
    draft.boostTwo = "";
    draft.boostOne = "";
    draft.equipment.backgroundPackageId = "";
  } else {
    if (!background.abilities.includes(draft.boostTwo as AbilityKey)) draft.boostTwo = "";
    if (!background.abilities.includes(draft.boostOne as AbilityKey)) draft.boostOne = "";
    if (!background.equipment.some(({ id }) => id === draft.equipment.backgroundPackageId)) draft.equipment.backgroundPackageId = "";
  }

  const firstClass = classById(draft.classLevels[0]?.classId);
  if (!firstClass?.equipment.some(({ id }) => id === draft.equipment.classPackageId)) draft.equipment.classPackageId = "";
  const spellRequirements = spellChoiceRequirementsForDraft(draft);
  const validSpellChoiceKeys = new Set(spellRequirements.map(({ key }) => key));
  for (const key of Object.keys(draft.spellChoiceSelections)) if (!validSpellChoiceKeys.has(key)) {
    recordChange(`Removed ${draft.spellChoiceSelections[key].map(choiceName).join(", ") || "bonus spell choices"} because their granting feature is no longer available.`);
    delete draft.spellChoiceSelections[key];
  }
  for (const requirement of spellRequirements) {
    const available = new Set(requirement.spells.map(({ id }) => id));
    const previous = draft.spellChoiceSelections[requirement.key] ?? [];
    const retained = previous.filter((id) => available.has(id)).slice(0, requirement.count);
    const removed = previous.filter((id) => !retained.includes(id));
    if (removed.length) recordChange(`Removed ${removed.map(choiceName).join(", ")} because the spell choice is no longer eligible.`);
    draft.spellChoiceSelections[requirement.key] = retained;
  }
  for (const row of draft.classLevels) {
    const casting = castingDetailsForDraft(draft, row.classId);
    const choices = draft.spells[row.classId];
    if (!casting || !choices) {
      if (!casting) delete draft.spells[row.classId];
      continue;
    }
    const cantrips = new Set(availableSpellsForDraft(draft, row.classId, true).map(({ id }) => id));
    const leveled = new Set(availableSpellsForDraft(draft, row.classId, false).map(({ id }) => id));
    const previous = spellChoiceNames(choices);
    choices.cantrips = choices.cantrips.filter((id) => cantrips.has(id)).slice(0, casting.cantrips);
    choices.spellbook = choices.spellbook.filter((id) => leveled.has(id)).slice(0, casting.spellbook);
    const preparedPool = casting.spellbook ? spellbookIdsForClass(draft, row.classId, choices.spellbook) : leveled;
    choices.prepared = choices.prepared.filter((id) => preparedPool.has(id)).slice(0, casting.prepared);
    const retained = new Set(spellChoiceNames(choices));
    const removed = previous.filter((name) => !retained.has(name));
    if (removed.length) recordChange(`Removed ${removed.join(", ")} because those spells are no longer eligible at the revised class, subclass, or level.`);
  }
  draft.manualReviewAcknowledged = false;
  draft.changeNotices = [...notices].filter(Boolean).slice(-40);
  return draft;
}

export function pointBuyCost(scores: Partial<Record<AbilityKey, number>>): number {
  const costs = characterCatalogue.rules.pointBuy.costs as unknown as Record<string, number>;
  let total = 0;
  for (const ability of abilityKeys) {
    const score = scores[ability];
    if (typeof score !== "number" || costs[String(score)] == null) return Number.POSITIVE_INFINITY;
    total += costs[String(score)];
  }
  return total;
}

export function featSlotsForDraft(draft: CharacterCreatorDraft): CreatorFeatSlot[] {
  return draft.classLevels.flatMap((row) => {
    const classData = classById(row.classId);
    if (!classData) return [];
    return classData.features.flatMap<CreatorFeatSlot>((feature) => {
      if (feature.level > row.levels) return [];
      if (feature.name === "Ability Score Improvement") return [{
        id: `${row.classId}:feat:${feature.level}`,
        classId: row.classId,
        className: classData.name,
        level: feature.level,
        category: "G" as const,
        label: `${classData.name} ${feature.level}: General feat or Ability Score Improvement`,
      }];
      if (feature.name === "Epic Boon") return [{
        id: `${row.classId}:feat:${feature.level}`,
        classId: row.classId,
        className: classData.name,
        level: feature.level,
        category: "EB" as const,
        label: `${classData.name} ${feature.level}: Epic Boon`,
      }];
      return [];
    });
  });
}

export function availableFeatsForSlot(draft: CharacterCreatorDraft, slot: CreatorFeatSlot): CatalogueFeat[] {
  const selectedId = draft.feats[slot.id]?.featId;
  return characterCatalogue.feats.filter((feat) => feat.category === slot.category && (feat.id === selectedId || prerequisiteEligible(feat, draft)));
}

export function optionRequirementsForDraft(draft: CharacterCreatorDraft): CreatorOptionRequirement[] {
  const weapons = characterCatalogue.items.filter((item) => item.category === "Weapon").map(({ id, name, source }) => ({ id, name, source }));
  return draft.classLevels.flatMap((row) => {
    const classData = classById(row.classId);
    if (!classData || row.levels < 1) return [];
    const requirements: CreatorOptionRequirement[] = [];
    for (const progression of classData.featProgressions) {
      if (progression.name === "Epic Boon") continue;
      const count = Number(progression.counts[row.levels - 1] ?? 0);
      if (!count) continue;
      const options = characterCatalogue.feats.filter((feat) => progression.categories.includes(feat.category) && prerequisiteEligible(feat, draft)).map(({ id, name, source }) => ({ id, name, source }));
      requirements.push({
        key: `${row.classId}:feat-progression:${progression.name}`,
        classId: row.classId,
        label: progression.name,
        count,
        kind: "feat",
        optionIds: options.map(({ id }) => id),
        options,
      });
    }
    for (const progression of classData.optionalProgressions) {
      const count = Number(progression.counts[row.levels - 1] ?? 0);
      if (!count) continue;
      const options = characterCatalogue.optionalFeatures.filter((option) => progression.featureTypes.some((type) => option.featureTypes.includes(type)) && prerequisiteEligible(option, draft)).map(({ id, name, source }) => ({ id, name, source }));
      requirements.push({
        key: `${row.classId}:optional:${progression.name}`,
        classId: row.classId,
        label: progression.name,
        count,
        kind: "optional",
        optionIds: options.map(({ id }) => id),
        options,
      });
    }
    const subclass = classData.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    for (const progression of subclass?.featProgressions ?? []) {
      const count = Number(progression.counts[row.levels - 1] ?? 0);
      if (!count) continue;
      const options = characterCatalogue.feats.filter((feat) => progression.categories.includes(feat.category) && prerequisiteEligible(feat, draft)).map(({ id, name, source }) => ({ id, name, source }));
      requirements.push({
        key: `${row.classId}:subclass:${subclass!.id}:feat-progression:${progression.name}`,
        classId: row.classId,
        label: `${subclass!.name}: ${progression.name}`,
        count,
        kind: "feat",
        optionIds: options.map(({ id }) => id),
        options,
      });
    }
    for (const progression of subclass?.optionalProgressions ?? []) {
      const count = Number(progression.counts[row.levels - 1] ?? 0);
      if (!count) continue;
      const options = characterCatalogue.optionalFeatures.filter((option) => progression.featureTypes.some((type) => option.featureTypes.includes(type)) && prerequisiteEligible(option, draft)).map(({ id, name, source }) => ({ id, name, source }));
      requirements.push({
        key: `${row.classId}:subclass:${subclass!.id}:optional:${progression.name}`,
        classId: row.classId,
        label: `${subclass!.name}: ${progression.name}`,
        count,
        kind: "optional",
        optionIds: options.map(({ id }) => id),
        options,
      });
    }
    for (const feature of [...classData.features, ...(subclass?.features ?? [])].filter(({ level }) => level <= row.levels)) {
      feature.choiceGroups.forEach((group, index) => {
        // Some source records repeat an option list inside the feature prose and
        // in the class progression (notably Invocations and Metamagic). The
        // progression owns the cumulative count; asking for the prose copy too
        // would make the player choose the same feature twice.
        const progressionOwnsGroup = requirements.some((requirement) =>
          requirement.kind !== "feature-choice"
          && requirement.options.length > 0
          && requirement.options.every((option) => group.options.some((candidate) => candidate.name === option.name)),
        );
        if (progressionOwnsGroup) return;
        requirements.push({
          key: `${row.classId}:feature:${feature.id}:${index}`,
          classId: row.classId,
          label: feature.name,
          count: group.count,
          kind: "feature-choice",
          optionIds: group.options.map(({ id }) => id),
          options: group.options,
        });
      });
    }
    const mastery = classData.tableProgressions.find((progression) => progression.label === "Weapon Mastery");
    const masteryCount = Number(mastery?.values[row.levels - 1] ?? 0);
    if (masteryCount > 0) requirements.push({
      key: `${row.classId}:weapon-mastery`,
      classId: row.classId,
      label: "Weapon Masteries",
      count: masteryCount,
      kind: "weapon-mastery",
      optionIds: weapons.map(({ id }) => id),
      options: weapons,
    });
    return requirements;
  });
}

export function skillChoiceRequirementsForDraft(draft: CharacterCreatorDraft): CreatorSkillChoiceRequirement[] {
  return draft.classLevels.flatMap((row, index) => {
    const data = classById(row.classId);
    if (!data || row.levels < 1) return [];
    const base = index === 0 ? data.skills : data.multiclassTraining.skills;
    const requirements: CreatorSkillChoiceRequirement[] = base.count ? [{
      key: row.classId,
      label: index === 0 ? "Starting skills" : "Multiclass skill grant",
      count: base.count,
      from: base.from,
      sourceLabel: `${data.name} ${index === 0 ? "starting training" : "multiclass training"}`,
    }] : [];
    const subclass = data.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    const classSkills = data.skills.from;
    if (data.name === "Barbarian" && row.levels >= 3) requirements.push({
      key: `${data.id}:feature:primal-knowledge`,
      label: "Primal Knowledge skill",
      count: 1,
      from: classSkills,
      sourceLabel: "Barbarian 3 · Primal Knowledge",
    });
    if (data.name === "Bard" && subclass?.shortName === "Lore" && row.levels >= 3) requirements.push({
      key: `${data.id}:subclass:${subclass.id}:bonus-proficiencies`,
      label: "Bonus Proficiencies",
      count: 3,
      from: "any",
      sourceLabel: "College of Lore 3",
    });
    if (data.name === "Fighter" && subclass?.shortName === "Battle Master" && row.levels >= 3) requirements.push({
      key: `${data.id}:subclass:${subclass.id}:student-of-war-skill`,
      label: "Student of War skill",
      count: 1,
      from: classSkills,
      sourceLabel: "Battle Master 3 · Student of War",
    });
    return requirements;
  });
}

export function toolChoiceRequirementsForDraft(draft: CharacterCreatorDraft): CreatorToolChoiceRequirement[] {
  const requirements: CreatorToolChoiceRequirement[] = [];
  const background = catalogueBackground(draft.backgroundId);
  for (const choice of background?.toolChoices ?? []) requirements.push({
    key: `background:${background!.id}:${choice.id}`,
    label: choice.label,
    count: choice.count,
    sourceLabel: `${background!.name} background`,
  });
  draft.classLevels.forEach((row, index) => {
    const data = classById(row.classId);
    const training = index === 0 ? data?.training : data?.multiclassTraining;
    for (const choice of training?.toolChoices ?? []) requirements.push({
      key: `class:${data!.id}:${index === 0 ? "starting" : "multiclass"}:${choice.id}`,
      label: choice.label,
      count: choice.count,
      sourceLabel: `${data!.name} ${index === 0 ? "starting training" : "multiclass training"}`,
    });
    const subclass = data?.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    if (data?.name === "Fighter" && subclass?.shortName === "Battle Master" && row.levels >= 3) requirements.push({
      key: `${data.id}:subclass:${subclass.id}:student-of-war-tool`,
      label: "Artisan's tools",
      count: 1,
      sourceLabel: "Battle Master 3 · Student of War",
    });
  });
  return requirements;
}

export function languageChoiceCountForDraft(draft: CharacterCreatorDraft): number {
  return 2 + draft.classLevels.reduce((count, row) => {
    const name = classById(row.classId)?.name;
    if (name === "Ranger" && row.levels >= 2) return count + 2;
    if (name === "Rogue" && row.levels >= 1) return count + 1;
    return count;
  }, 0);
}

export function expertiseCountForDraft(draft: CharacterCreatorDraft): number {
  return draft.classLevels.reduce((count, row) => {
    const name = classById(row.classId)?.name;
    if (name === "Rogue") return count + (row.levels >= 6 ? 4 : row.levels >= 1 ? 2 : 0);
    if (name === "Bard") return count + (row.levels >= 9 ? 4 : row.levels >= 2 ? 2 : 0);
    if (name === "Ranger") return count + (row.levels >= 9 ? 3 : row.levels >= 2 ? 1 : 0);
    if (name === "Wizard") return count + (row.levels >= 2 ? 1 : 0);
    return count;
  }, 0);
}

export function manualChoiceRequirementsForDraft(draft: CharacterCreatorDraft): CreatorManualChoiceRequirement[] {
  const requirements: CreatorManualChoiceRequirement[] = [];
  const add = (key: string, label: string, sourceLabel: string, prompt: string) => requirements.push({ key, label, sourceLabel, prompt });
  const background = catalogueBackground(draft.backgroundId);
  const originPrompts: Record<string, string> = {
    "magic-initiate-cleric": "Record the two Cleric cantrips, level 1 Cleric spell, and Intelligence, Wisdom, or Charisma casting ability the player chose.",
    "magic-initiate-druid": "Record the two Druid cantrips, level 1 Druid spell, and Intelligence, Wisdom, or Charisma casting ability the player chose.",
    "magic-initiate-wizard": "Record the two Wizard cantrips, level 1 Wizard spell, and Intelligence, Wisdom, or Charisma casting ability the player chose.",
    skilled: "Record the player's three chosen skill or tool proficiencies.",
    crafter: "Record the player's three chosen Artisan's Tool proficiencies.",
    musician: "Record the player's three chosen Musical Instrument proficiencies.",
  };
  if (background && originPrompts[background.originFeatId]) add(
    `background:${background.id}:origin-feat`,
    `${titleCase(background.originFeatId)} choices`,
    `${background.name} · Origin feat`,
    originPrompts[background.originFeatId],
  );

  const species = speciesForDraft(draft);
  if (species?.name === "Human") add("species:human:versatile", "Versatile Origin feat", "Human · Versatile", "Record the Origin feat the player chose. The Skillful proficiency is selected separately above.");
  const speciesMagic = speciesMagicForDraft(draft);
  if ((speciesMagic?.spellChoices.length ?? 0) === 0) for (const [index, prompt] of (speciesMagic?.choicePrompts ?? []).entries()) add(
    `species:${species?.id ?? "unknown"}:${slug(draft.lineage || speciesMagic?.name || "magic")}:${index}`,
    prompt,
    `${species?.name ?? "Species"}${draft.lineage ? ` · ${draft.lineage}` : ""}`,
    `Record the player's exact answer: ${prompt}.`,
  );
  if (species?.name === "Gnome" && draft.lineage) add(
    `species:${species.id}:${slug(draft.lineage)}:lineage`,
    `${draft.lineage} choice`,
    `${species.name} · ${draft.lineage}`,
    draft.lineage === "Forest Gnome"
      ? "Record the player-approved lineage magic details that the structured species record does not expose."
      : "Record the clockwork device or other player-owned lineage choice.",
  );

  for (const row of draft.classLevels) {
    const data = classById(row.classId);
    if (!data) continue;
    const subclass = data.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    if (data.name === "Artificer" && row.levels >= 2) {
      const plans = Number(data.tableProgressions.find(({ label }) => label === "Plans Known")?.values[row.levels - 1] ?? 0);
      add(`${data.id}:replicate-magic-item`, "Replicate Magic Item plans", `Artificer ${row.levels}`, `Record all ${plans} magic-item plans the player chose; the full magic-item rules remain outside this compact character catalogue.`);
    }
    if (data.name === "Artificer" && row.levels >= 11) add(`${data.id}:spell-storing-item`, "Spell-Storing Item", `Artificer ${row.levels}`, "Record the player's current eligible item and level 1 or 2 Artificer spell.");
    if (data.name === "Druid" && row.levels >= 2) {
      const count = row.levels >= 8 ? 8 : row.levels >= 4 ? 6 : 4;
      add(`${data.id}:wild-shape-forms`, "Known Wild Shape forms", `Druid ${row.levels} · Wild Shape`, `Record all ${count} Beast forms the player chose and note that creature statistics remain outside this character catalogue.`);
    }
    if (data.name === "Wizard" && row.levels >= 18) add(`${data.id}:spell-mastery`, "Spell Mastery", `Wizard ${row.levels}`, "Record the player's eligible level 1 and level 2 action-casting spellbook choices.");
    if (data.name === "Wizard" && row.levels >= 20) add(`${data.id}:signature-spells`, "Signature Spells", "Wizard 20", "Record the player's two chosen level 3 spellbook spells.");
    if (data.name === "Barbarian" && subclass?.shortName === "Wild Heart" && row.levels >= 6) add(`${subclass.id}:aspect-of-the-wilds`, "Aspect of the Wilds", `${subclass.name} ${row.levels}`, "Record the player's current Owl, Panther, or Salmon choice.");
    if (data.name === "Druid" && subclass?.shortName === "Land" && row.levels >= 3) add(`${subclass.id}:land-type`, "Circle land type", `${subclass.name} ${row.levels}`, "Record the player's current Arid, Polar, Temperate, or Tropical land choice and its always-prepared spells.");
    if (data.name === "Ranger" && subclass?.shortName === "Beast Master" && row.levels >= 3) add(`${subclass.id}:primal-companion`, "Primal Companion", `${subclass.name} ${row.levels}`, "Record the player's Beast of the Land, Sea, or Sky stat block and chosen animal appearance.");
    if (data.name === "Ranger" && subclass?.shortName === "Hunter" && row.levels >= 3) add(`${subclass.id}:hunters-prey`, "Hunter's Prey", `${subclass.name} ${row.levels}`, "Record the player's current Colossus Slayer or Horde Breaker choice.");
    if (data.name === "Sorcerer" && subclass?.shortName === "Draconic" && row.levels >= 6) add(`${subclass.id}:elemental-affinity`, "Elemental Affinity", `${subclass.name} ${row.levels}`, "Record the player's Acid, Cold, Fire, Lightning, or Poison affinity.");
    if (data.name === "Cleric" && row.levels >= 7) add(`${data.id}:blessed-strikes`, "Blessed Strikes", `Cleric ${row.levels}`, "Record the player's Potent Spellcasting or Divine Strike choice.");
    if (subclass?.shortName === "Wild Heart" && row.levels >= 14) add(`${subclass.id}:power-of-the-wilds`, "Power of the Wilds", `${subclass.name} ${row.levels}`, "Record the player's Falcon, Lion, or Ram choice.");
    if (subclass?.shortName === "Hunter" && row.levels >= 7) add(`${subclass.id}:defensive-tactics`, "Defensive Tactics", `${subclass.name} ${row.levels}`, "Record the player's current Escape the Horde or Multiattack Defense choice.");
    if (subclass?.shortName === "Gloom Stalker" && row.levels >= 7) add(`${subclass.id}:iron-mind`, "Iron Mind", `${subclass.name} ${row.levels}`, "Record Wisdom save proficiency, or the player's Intelligence or Charisma choice if Wisdom save proficiency was already present.");
    if (subclass?.shortName === "Fiend" && row.levels >= 10) add(`${subclass.id}:fiendish-resilience`, "Fiendish Resilience", `${subclass.name} ${row.levels}`, "Record the player's current eligible damage-resistance type.");
    if (subclass?.name === "Oath of the Noble Genies" && row.levels >= 7) add(`${subclass.id}:elemental-shielding`, "Aura of Elemental Shielding", `${subclass.name} ${row.levels}`, "Record the player's current Acid, Cold, Fire, Lightning, or Thunder choice.");
    if (subclass && subclass.compatibility !== "revised") add(
      `${subclass.id}:compatibility-review`,
      "supplement compatibility and build choices",
      `${subclass.name} · ${subclass.source}`,
      "Record the player's confirmed revised-class compatibility ruling and every build-time option this supplemental subclass requires; do not infer omitted choices.",
    );
  }

  const featPrompts: Record<string, string> = {
    "Blessed Warrior": "Record the player's two Cleric cantrips.",
    "Boon of Energy Resistance": "Record the player's two current damage resistances.",
    "Boon of Siberys": "Record the player's selected eligible spell.",
    "Boon of Skill": "Record the player's Expertise skill.",
    Crafter: "Record the player's three Artisan's Tool proficiencies.",
    "Druidic Warrior": "Record the player's two Druid cantrips.",
    "Elemental Adept": "Record the player's chosen Acid, Cold, Fire, Lightning, or Thunder damage type.",
    "Fey-Touched": "Record the player's selected level 1 Divination or Enchantment spell.",
    "Keen Mind": "Record the player's Arcana, History, Investigation, Nature, or Religion skill choice.",
    "Magic Initiate": "Record the class list, two cantrips, level 1 spell, and casting ability the player chose.",
    Musician: "Record the player's three Musical Instrument proficiencies.",
    Observant: "Record the player's Insight, Investigation, or Perception choice.",
    "Ritual Caster": "Record the player's eligible level 1 ritual spells.",
    "Shadow-Touched": "Record the player's selected level 1 Illusion or Necromancy spell.",
    "Skill Expert": "Record the player's new skill proficiency and Expertise skill.",
    Skilled: "Record the player's three skill or tool proficiencies.",
    "Weapon Master": "Record the player's current mastered weapon kind.",
  };
  for (const [slotId, choice] of Object.entries(draft.feats)) {
    const feat = catalogueFeat(choice.featId);
    if (feat && featPrompts[feat.name]) add(`feat:${slotId}:${feat.id}`, `${feat.name} choices`, `${feat.name} · ${feat.source}`, featPrompts[feat.name]);
  }
  for (const requirement of optionRequirementsForDraft(draft).filter(({ kind }) => kind === "feat")) {
    for (const featId of draft.optionSelections[requirement.key] ?? []) {
      const feat = catalogueFeat(featId);
      if (feat && featPrompts[feat.name]) add(`feat-option:${requirement.key}:${feat.id}`, `${feat.name} choices`, `${feat.name} · ${feat.source}`, featPrompts[feat.name]);
    }
  }
  const optionalPrompts: Record<string, string> = {
    "Agonizing Blast": "Record the eligible damaging Warlock cantrip the player chose.",
    "Eldritch Spear": "Record the eligible ranged damaging Warlock cantrip the player chose.",
    "Lessons of the First Ones": "Record the eligible Origin feat the player chose.",
    "Pact of the Tome": "Record the three cantrips and two level 1 ritual spells written in the player's Book of Shadows.",
    "Repelling Blast": "Record the eligible Warlock attack-roll cantrip the player chose.",
  };
  for (const requirement of optionRequirementsForDraft(draft).filter(({ kind }) => kind === "optional")) {
    for (const optionId of draft.optionSelections[requirement.key] ?? []) {
      const option = characterCatalogue.optionalFeatures.find(({ id }) => id === optionId);
      if (option && optionalPrompts[option.name]) add(`option:${requirement.key}:${option.id}`, `${option.name} choice`, `${option.name} · ${option.source}`, optionalPrompts[option.name]);
    }
  }
  return [...new Map(requirements.map((requirement) => [requirement.key, requirement])).values()];
}

export function availableSpells(classData: CatalogueClass, classLevel: number, cantrips: boolean): CatalogueSpell[] {
  if (!classData.spellcasting) return [];
  return spellsForAccess(classData.name, classData.spellcasting, classLevel, cantrips, classData.spellcasting.spellListExpansions, classData.spellcasting.alwaysSpells);
}

export function availableSpellsForDraft(draft: CharacterCreatorDraft, classId: string, cantrips: boolean): CatalogueSpell[] {
  const row = draft.classLevels.find((candidate) => candidate.classId === classId);
  const classData = classById(classId);
  if (!row || !classData) return [];
  const subclass = classData.subclasses.find(({ id, level }) => id === draft.subclasses[classId] && level <= row.levels);
  const spellcasting = classData.spellcasting ?? subclass?.spellcasting;
  if (!spellcasting) return [];
  const expansions = [...(classData.spellcasting?.spellListExpansions ?? []), ...(subclass?.spellListExpansions ?? [])];
  const grants = [...(classData.spellcasting?.alwaysSpells ?? []), ...(subclass?.alwaysSpells ?? [])];
  return spellsForAccess(classData.spellcasting ? classData.name : "", spellcasting, row.levels, cantrips, expansions, grants);
}

function spellsForAccess(
  baseClassName: string,
  spellcasting: CatalogueSpellcasting,
  classLevel: number,
  cantrips: boolean,
  expansions: CatalogueSpellListExpansion[],
  grants: CatalogueSpellGrant[],
): CatalogueSpell[] {
  const maximum = maximumSpellLevel(spellcasting, classLevel);
  const automatic = new Set(grants
    .filter(({ level, mode }) => level <= classLevel && mode !== "expanded")
    .map(({ spellId }) => spellId));
  const activeExpansions = expansions.filter(({ minimumClassLevel, minimumSpellLevel }) =>
    (!minimumClassLevel || classLevel >= minimumClassLevel)
    && (!minimumSpellLevel || maximum >= minimumSpellLevel));
  return characterCatalogue.spells.filter((spell) => {
    if (automatic.has(spell.id)) return false;
    if (cantrips ? spell.level !== 0 : spell.level < 1 || spell.level > maximum) return false;
    if (baseClassName && spell.classes.includes(baseClassName)) return true;
    return activeExpansions.some(({ classes, spellLevels }) =>
      spellLevels.includes(spell.level)
      && (classes.length === 0 || classes.some((className) => spell.classes.includes(className))));
  });
}

function padSlots(values: number[] | undefined): number[] {
  return Array.from({ length: 9 }, (_, index) => Number(values?.[index] ?? 0));
}

export function castingDetailsForDraft(draft: CharacterCreatorDraft, classId: string): CreatorCastingDetails | null {
  const row = draft.classLevels.find((candidate) => candidate.classId === classId);
  const classData = classById(classId);
  if (!row || !classData) return null;
  const subclass = classData.subclasses.find(({ id, level }) => id === draft.subclasses[classId] && level <= row.levels);
  const spellcasting = classData.spellcasting ?? subclass?.spellcasting;
  if (!spellcasting) return null;
  const countedBonusSpells = unlockedSpellChoicesForClass(draft, classId)
    .filter(({ destination, countsTowardPrepared }) => destination === "prepared" && countsTowardPrepared)
    .reduce((sum, { count }) => sum + count, 0);
  return {
    classId,
    className: classData.name,
    profileName: classData.spellcasting ? classData.name : subclass?.name ?? classData.name,
    ability: spellcasting.ability,
    progression: spellcasting.progression,
    cantrips: spellcasting.cantrips[row.levels - 1] ?? 0,
    prepared: Math.max(0, (spellcasting.prepared[row.levels - 1] ?? 0) - countedBonusSpells),
    spellbook: spellcasting.spellbookAdditions.slice(0, row.levels).reduce((sum, value) => sum + value, 0),
    maximumSpellLevel: maximumSpellLevel(spellcasting, row.levels),
  };
}

export function spellChoiceRequirementsForDraft(draft: CharacterCreatorDraft): CreatorSpellChoiceRequirement[] {
  const requirements: CreatorSpellChoiceRequirement[] = [];
  for (const row of draft.classLevels) {
    const data = classById(row.classId);
    if (!data) continue;
    for (const rule of unlockedSpellChoicesForClass(draft, row.classId)) requirements.push({
      key: rule.id,
      label: rule.label,
      sourceLabel: `${data.name} ${row.levels}`,
      classId: data.id,
      destination: rule.destination,
      count: rule.count,
      spells: spellsForChoiceRule(rule),
    });
  }
  const species = speciesForDraft(draft);
  const magic = speciesMagicForDraft(draft);
  for (const rule of magic?.spellChoices.filter(({ unlockLevel }) => unlockLevel <= totalLevel(draft)) ?? []) requirements.push({
    key: rule.id,
    label: rule.label,
    sourceLabel: `${species?.name ?? "Species"}${draft.lineage ? ` · ${draft.lineage}` : ""}`,
    classId: "",
    destination: rule.destination,
    count: rule.count,
    spells: spellsForChoiceRule(rule),
  });
  return requirements;
}

function unlockedSpellChoicesForClass(draft: CharacterCreatorDraft, classId: string): CatalogueSpellChoice[] {
  const row = draft.classLevels.find((candidate) => candidate.classId === classId);
  const data = classById(classId);
  if (!row || !data) return [];
  const subclass = data.subclasses.find(({ id, level }) => id === draft.subclasses[classId] && level <= row.levels);
  return [
    ...(data.spellcasting?.spellChoices ?? []),
    ...(subclass?.spellChoices ?? []),
  ].filter(({ unlockLevel }) => unlockLevel <= row.levels);
}

function spellsForChoiceRule(rule: CatalogueSpellChoice): CatalogueSpell[] {
  return characterCatalogue.spells.filter((spell) =>
    rule.spellLevels.includes(spell.level)
    && (rule.classes.length === 0 || rule.classes.some((className) => spell.classes.includes(className)))
    && (rule.schools.length === 0 || rule.schools.includes(spell.school)));
}

function spellbookIdsForClass(draft: CharacterCreatorDraft, classId: string, baseIds = draft.spells[classId]?.spellbook ?? []): Set<string> {
  const ids = new Set(baseIds);
  for (const requirement of spellChoiceRequirementsForDraft(draft)) {
    if (requirement.classId !== classId || requirement.destination !== "spellbook") continue;
    for (const id of draft.spellChoiceSelections[requirement.key] ?? []) ids.add(id);
  }
  return ids;
}

export function multiclassSpellSlots(draft: CharacterCreatorDraft): number[] {
  const casters = draft.classLevels.flatMap((row) => {
    const classData = classById(row.classId);
    const subclass = classData?.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    const spellcasting = classData?.spellcasting ?? subclass?.spellcasting;
    return spellcasting && spellcasting.progression !== "pact" ? [{ row, spellcasting }] : [];
  });
  if (casters.length === 0) return Array(9).fill(0);
  if (casters.length === 1) return padSlots(casters[0].spellcasting.slotTable[casters[0].row.levels - 1]);
  const casterLevel = casters.reduce((total, { row, spellcasting }) => {
    const progression = spellcasting.progression;
    if (progression === "full") return total + row.levels;
    if (progression === "artificer") return total + Math.ceil(row.levels / 2);
    if (progression === "1/3") return total + Math.floor(row.levels / 3);
    return total;
  }, 0);
  if (casterLevel < 1) return Array(9).fill(0);
  return padSlots(fullSlotTable[Math.max(0, casterLevel - 1)]);
}

export function calculateFixedHitPoints(draft: CharacterCreatorDraft, finalScores = finalAbilityScores(draft)): number {
  const constitution = abilityModifier(finalScores.con);
  let total = 0;
  draft.classLevels.forEach((row, rowIndex) => {
    const classData = classById(row.classId);
    if (!classData || row.levels < 1) return;
    const fixed = Math.floor(classData.hitDie / 2) + 1;
    total += rowIndex === 0 ? classData.hitDie + fixed * Math.max(0, row.levels - 1) : fixed * row.levels;
  });
  total += constitution * totalLevel(draft);
  if (selectedFeatNames(draft).some((name) => name.startsWith("Tough ("))) total += totalLevel(draft) * 2;
  if (speciesForDraft(draft)?.name === "Dwarf") total += totalLevel(draft);
  return Math.max(1, total);
}

export function validateCharacterCreatorDraft(draft: CharacterCreatorDraft): CreatorIssue[] {
  const issues: CreatorIssue[] = [];
  const add = (step: CreatorIssue["step"], code: string, message: string, blocking = true) => issues.push({ step, code, message, blocking });
  const levels = totalLevel(draft);
  const classes = draft.classLevels.map((row) => ({ row, data: classById(row.classId) }));

  if (!draft.name.trim()) add("Basics", "name", "Name the character.");
  if (classes.some(({ data }) => !data)) add("Basics", "class", "Choose every class in the progression.");
  if (classes.some(({ row }) => row.levels < 1)) add("Basics", "class-level", "Give every selected class at least one level.");
  if (new Set(draft.classLevels.map(({ classId }) => classId).filter(Boolean)).size !== draft.classLevels.filter(({ classId }) => classId).length) add("Basics", "duplicate-class", "Combine repeated levels of the same class into one row.");
  if (levels < 1 || levels > 20) add("Basics", "total-level", "Total character level must be from 1 through 20.");
  const species = speciesForDraft(draft);
  if (!species) add("Basics", "species", "Choose a species.");
  else {
    if (species.lineages.length > 0 && !species.lineages.includes(draft.lineage)) add("Basics", "lineage", `Choose a ${species.name} lineage or ancestry.`);
    if (!species.sizes.includes(draft.size)) add("Basics", "size", "Choose an available size.");
    const magic = speciesMagicForDraft(draft);
    if (magic && magic.abilityChoices.length > 1 && !magic.abilityChoices.includes(draft.speciesCastingAbility as AbilityKey)) add("Basics", "species-casting-ability", `Choose the spellcasting ability for ${species.name}'s ${magic.name}.`);
  }
  if (!catalogueBackground(draft.backgroundId)) add("Basics", "background", "Choose a background.");

  if (!draft.abilityMethod) add("Abilities", "ability-method", "Choose Standard Array, point buy, or entered/rolled scores.");
  const baseValues = abilityKeys.map((ability) => draft.baseScores[ability]);
  if (baseValues.some((value) => typeof value !== "number")) add("Abilities", "ability-scores", "Assign all six base ability scores.");
  else if (draft.abilityMethod === "standard") {
    const actual = [...baseValues as number[]].sort((a, b) => b - a);
    const expected = [...characterCatalogue.rules.standardArray].sort((a, b) => b - a);
    if (actual.some((value, index) => value !== expected[index])) add("Abilities", "standard-array", "Use every Standard Array score exactly once.");
  } else if (draft.abilityMethod === "point-buy") {
    const cost = pointBuyCost(draft.baseScores as Record<AbilityKey, number>);
    if (cost !== characterCatalogue.rules.pointBuy.points) add("Abilities", "point-buy", `Spend exactly ${characterCatalogue.rules.pointBuy.points} points; this assignment spends ${Number.isFinite(cost) ? cost : "an invalid amount"}.`);
  } else if (draft.abilityMethod === "rolled" && (baseValues as number[]).some((value) => value < 3 || value > 18)) {
    add("Abilities", "rolled-range", "Entered or rolled base scores must be from 3 through 18.");
  }
  const background = catalogueBackground(draft.backgroundId);
  if (background) {
    if (!draft.boostMode) add("Abilities", "boost-mode", "Choose how the background improves abilities.");
    if (draft.boostMode === "2+1") {
      if (!background.abilities.includes(draft.boostTwo as AbilityKey) || !background.abilities.includes(draft.boostOne as AbilityKey) || draft.boostTwo === draft.boostOne) {
        add("Abilities", "boosts", "Choose two different background abilities for +2 and +1.");
      }
    }
  }

  const finalScores = finalAbilityScores(draft);
  const epicIncreases = new Set<AbilityKey>();
  for (const [slotId, choice] of Object.entries(draft.feats)) {
    if (featSlotsForDraft(draft).find(({ id }) => id === slotId)?.category !== "EB") continue;
    for (const [ability, amount] of Object.entries(choice.abilityIncreases)) if (Number(amount) > 0) epicIncreases.add(ability as AbilityKey);
  }
  for (const ability of abilityKeys) {
    const maximum = epicIncreases.has(ability) ? 30 : 20;
    if (finalScores[ability] > maximum) add("Abilities", `ability-cap-${ability}`, `${ability.toUpperCase()} exceeds its ${maximum} maximum.`);
  }
  if (classes.length > 1 && baseValues.every((value) => typeof value === "number")) {
    for (const { data } of classes) if (data && !data.primaryAbility.some((group) => group.every((ability) => finalScores[ability] >= 13))) {
      add("Abilities", `multiclass-${data.id}`, `${data.name} multiclassing requires ${data.primaryAbility.map((group) => group.map((ability) => ability.toUpperCase()).join(" and ")).join(" or ")} 13.`);
    }
  }

  const fixedSkills = new Set(background?.skills ?? []);
  for (const requirement of skillChoiceRequirementsForDraft(draft)) {
    const selected = draft.skillChoices[requirement.key] ?? [];
    const available = requirement.from === "any" ? skillDefinitions.map(({ id }) => id) : requirement.from;
    if (selected.length !== requirement.count || new Set(selected).size !== selected.length || selected.some((skill) => !available.includes(skill) || fixedSkills.has(skill))) {
      add("Proficiencies", `skills-${requirement.key}`, `Choose ${requirement.count} eligible ${requirement.label}${requirement.count === 1 ? "" : " choices"} for ${requirement.sourceLabel}, without duplicating another grant.`);
    }
    selected.forEach((skill) => fixedSkills.add(skill));
  }
  if (species?.skillChoice.count) {
    const available = species.skillChoice.from === "any" ? skillDefinitions.map(({ id }) => id) : species.skillChoice.from;
    if (!draft.speciesSkill || !available.includes(draft.speciesSkill) || fixedSkills.has(draft.speciesSkill)) add("Proficiencies", "species-skill", `Choose the ${species.name} skill proficiency.`);
    else fixedSkills.add(draft.speciesSkill);
  }
  const expertiseNeeded = expertiseCountForDraft(draft);
  if (draft.expertise.length !== expertiseNeeded || new Set(draft.expertise).size !== draft.expertise.length || draft.expertise.some((skill) => !fixedSkills.has(skill))) {
    if (expertiseNeeded > 0) add("Proficiencies", "expertise", `Choose ${expertiseNeeded} proficient skill${expertiseNeeded === 1 ? "" : "s"} for Expertise.`);
  }
  const wizardScholar = classes.find(({ row, data }) => data?.name === "Wizard" && row.levels >= 2);
  const scholarSkills: SkillId[] = ["arcana", "history", "investigation", "medicine", "nature", "religion"];
  if (wizardScholar && !draft.expertise.some((skill) => scholarSkills.includes(skill))) add("Proficiencies", "wizard-scholar", "Choose at least one proficient Arcana, History, Investigation, Medicine, Nature, or Religion skill for Wizard Scholar.");
  const languageCount = languageChoiceCountForDraft(draft);
  if (draft.languages.length !== languageCount || new Set(draft.languages).size !== languageCount || draft.languages.some((language) => !characterCatalogue.rules.languages.includes(language))) add("Proficiencies", "languages", `Choose ${languageCount} different additional languages.`);
  for (const requirement of toolChoiceRequirementsForDraft(draft)) {
    const selected = draft.toolChoices[requirement.key] ?? [];
    if (selected.length !== requirement.count || selected.some((value) => !value.trim()) || new Set(selected.map((value) => value.trim().toLowerCase())).size !== selected.length) {
      add("Proficiencies", `tool-choice-${requirement.key}`, `Name ${requirement.count} different ${requirement.label}${requirement.count === 1 ? "" : " choices"} for ${requirement.sourceLabel}.`);
    }
  }

  classes.forEach(({ row, data }) => {
    if (!data) return;
    const unlocked = data.subclasses.filter((subclass) => subclass.level <= row.levels);
    if (unlocked.length > 0 && !unlocked.some(({ id }) => id === draft.subclasses[row.classId])) add("Features", `subclass-${row.classId}`, `Choose a ${data.name} subclass.`);
  });
  for (const slot of featSlotsForDraft(draft)) {
    const selected = draft.feats[slot.id];
    const feat = catalogueFeat(selected?.featId ?? "");
    if (!feat || feat.category !== slot.category) add("Features", `feat-${slot.id}`, `Choose ${slot.label}.`);
    else {
      if (!prerequisiteEligible(feat, draft)) add("Features", `feat-prerequisite-${slot.id}`, `${feat.name}'s prerequisites are not met.`);
      if (!abilitySelectionMatches(feat, selected.abilityIncreases)) add("Features", `feat-ability-${slot.id}`, `Complete ${feat.name}'s ability increase.`);
    }
  }
  const featCounts = new Map<string, number>();
  for (const choice of Object.values(draft.feats)) if (choice.featId) featCounts.set(choice.featId, (featCounts.get(choice.featId) ?? 0) + 1);
  for (const [featId, count] of featCounts) {
    const feat = catalogueFeat(featId);
    if (count > 1 && feat && !feat.repeatable) add("Features", `duplicate-feat-${featId}`, `${feat.name} cannot be selected more than once.`);
  }
  for (const requirement of optionRequirementsForDraft(draft)) {
    const selected = draft.optionSelections[requirement.key] ?? [];
    if (selected.length !== requirement.count || new Set(selected).size !== selected.length || selected.some((id) => !requirement.optionIds.includes(id))) {
      add("Features", `option-${requirement.key}`, `Choose ${requirement.count} valid ${requirement.label}${requirement.count === 1 ? "" : " options"}.`);
    }
  }

  const proficientSkills = fixedSkills;
  for (const skill of draft.expertise) if (!proficientSkills.has(skill)) add("Proficiencies", "expertise-eligible", `${skillName(skill)} must be proficient before it can gain Expertise.`);

  for (const { row, data } of classes) {
    if (!data) continue;
    const casting = castingDetailsForDraft(draft, row.classId);
    if (!casting) continue;
    const choices = draft.spells[row.classId] ?? emptySpellChoices();
    const cantripCount = casting.cantrips;
    const preparedCount = casting.prepared;
    const spellbookCount = casting.spellbook;
    validateSpellList(add, row.classId, "cantrips", choices.cantrips, cantripCount, availableSpellsForDraft(draft, row.classId, true));
    validateSpellList(add, row.classId, "prepared spells", choices.prepared, preparedCount, availableSpellsForDraft(draft, row.classId, false));
    if (spellbookCount > 0) {
      validateSpellList(add, row.classId, "spellbook spells", choices.spellbook, spellbookCount, availableSpellsForDraft(draft, row.classId, false));
      const spellbookIds = spellbookIdsForClass(draft, row.classId, choices.spellbook);
      if (choices.prepared.some((id) => !spellbookIds.has(id))) add("Spells", `spellbook-prepared-${row.classId}`, "Every prepared Wizard spell must be in the spellbook, including subclass additions.");
    }
  }
  const spellChoiceRequirements = spellChoiceRequirementsForDraft(draft);
  for (const requirement of spellChoiceRequirements) validateSpellList(
    add,
    requirement.key,
    requirement.label,
    draft.spellChoiceSelections[requirement.key] ?? [],
    requirement.count,
    requirement.spells,
  );
  for (const { row: { classId } } of classes) {
    if (!classId) continue;
    for (const destination of ["prepared", "spellbook"] as const) {
      const main = draft.spells[classId] ?? emptySpellChoices();
      const baseIds = destination === "spellbook" ? main.spellbook : [...main.cantrips, ...main.prepared];
      const bonusIds = spellChoiceRequirements
        .filter((requirement) => requirement.classId === classId && requirement.destination === destination)
        .flatMap(({ key }) => draft.spellChoiceSelections[key] ?? []);
      const all = [...baseIds, ...bonusIds];
      if (new Set(all).size !== all.length) add("Spells", `duplicate-${destination}-${classId}`, `Choose each ${destination === "spellbook" ? "spellbook" : "known or prepared"} spell only once for this class.`);
    }
  }

  const firstClass = classes[0]?.data;
  if (firstClass && !firstClass.equipment.some(({ id }) => id === draft.equipment.classPackageId)) add("Equipment", "class-package", `Choose a ${firstClass.name} starting package.`);
  if (background && !background.equipment.some(({ id }) => id === draft.equipment.backgroundPackageId)) add("Equipment", "background-package", `Choose a ${background.name} starting package.`);
  for (const choice of selectedEquipmentChoices(draft)) {
    for (const item of choice.items.filter(({ prompt }) => prompt)) if (!draft.equipment.customNames[equipmentItemChoiceKey(choice.id, item.id)]?.trim()) add("Equipment", `equipment-${choice.id}-${item.id}`, `Name the choice for ${item.name}.`);
  }
  for (const item of selectedEquipmentItems(draft).filter(({ properties }) => properties.includes("F"))) {
    if (!draft.weaponAbilities[item.id]) add("Equipment", `weapon-ability-${item.id}`, `Choose Strength or Dexterity for ${item.name}.`);
  }
  if (!draft.hpMode || (draft.hpMode === "manual" && (!draft.manualHitPoints || draft.manualHitPoints < 1))) add("Equipment", "hit-points", "Choose fixed Hit Points or enter an approved total.");
  if (!draft.armorClassMode || (draft.armorClassMode === "manual" && (!draft.manualArmorClass || draft.manualArmorClass < 1))) add("Equipment", "armor-class", "Choose one Armor Class formula or enter an approved value.");
  if (draft.armorClassMode === "barbarian" && !classes.some(({ data }) => data?.name === "Barbarian")) add("Equipment", "barbarian-ac", "Barbarian Unarmored Defense requires Barbarian levels.");
  if (draft.armorClassMode === "monk" && !classes.some(({ data }) => data?.name === "Monk")) add("Equipment", "monk-ac", "Monk Unarmored Defense requires Monk levels.");

  const manualReasons = manualReviewReasons(draft);
  const manualRequirements = manualChoiceRequirementsForDraft(draft);
  for (const requirement of manualRequirements) if (!draft.manualChoices[requirement.key]?.trim()) add("Features", `manual-choice-${requirement.key}`, `Record the player's exact ${requirement.label} answer for ${requirement.sourceLabel}.`);
  if (manualRequirements.some((requirement) => !draft.manualChoices[requirement.key]?.trim())) add("Features", "manual-rulings-choice", "Complete every listed player-owned manual choice before applying.");
  if (manualReasons.length > 0 && !draft.manualReviewAcknowledged) add("Review", "manual-review", "Review and acknowledge the listed manual rulings before applying.");
  draft.changeNotices.forEach((message, index) => add("Review", `dependency-change-${index}`, message, false));
  return issues;
}

export async function buildCharacterCreatorReview(draft: CharacterCreatorDraft, target: CharacterSheet): Promise<CharacterCreatorReview> {
  const issues = validateCharacterCreatorDraft(draft);
  if (sheetTargetFingerprint(target) !== draft.targetFingerprint) issues.push({
    step: "Review",
    code: "stale-target",
    message: "The live sheet changed after this draft began. Rebase the draft and review the new changes before applying.",
    blocking: true,
  });
  const computation = computeCharacter(draft);
  const blocking = issues.some(({ blocking }) => blocking);
  const status: CharacterCreatorReview["status"] = blocking ? "incomplete" : computation.manualReviewReasons.length > 0 ? "manual-review" : "ready";
  const summary = reviewSummary(draft, computation);
  const changedFields = changedFieldSummary(target, draft, computation);
  const fingerprint = await sha256(stableStringify({ draft: normalizedExportSelections(draft), summary, changedFields }));
  return { status, fingerprint, targetFingerprint: draft.targetFingerprint, issues, summary, changedFields, computation };
}

export async function applyCharacterCreatorDraft(
  target: CharacterSheet,
  draft: CharacterCreatorDraft,
  confirmationFingerprint: string,
): Promise<CharacterSheet> {
  const review = await buildCharacterCreatorReview(draft, target);
  if (review.status === "incomplete") throw new Error(review.issues.find(({ blocking }) => blocking)?.message ?? "The character is incomplete.");
  if (!confirmationFingerprint || confirmationFingerprint !== review.fingerprint) throw new Error("Confirm the exact current review before applying it.");
  const computation = review.computation;
  const firstClass = classById(draft.classLevels[0].classId)!;
  const background = catalogueBackground(draft.backgroundId)!;
  const species = speciesForDraft(draft)!;
  const proficiencies = selectedSkills(draft);
  const expertise = new Set(draft.expertise);
  const prior = target.creator;
  const priorAttacks = new Set(prior?.managedAttackIds ?? []);
  const priorResources = new Set(prior?.managedResourceIds ?? []);
  const priorInventory = new Set(prior?.managedInventoryIds ?? []);
  const priorSpells = new Set(prior?.managedSpellIds ?? []);
  const generatedInventory = generatedInventoryForDraft(draft);
  const generatedAttacks = generatedAttacksForDraft(draft, computation.finalScores, computation.proficiency);
  const generatedResources = generatedResourcesForDraft(draft);
  const generatedSpells = generatedSpellsForDraft(draft);
  const generatedGp = selectedEquipmentChoices(draft).reduce((sum, choice) => sum + choice.gp, 0);
  const manualGp = Math.max(0, target.coins.gp - (prior?.managedGoldPieces ?? 0));
  const armor = combinedTraining(draft);
  const classNames = draft.classLevels.map((row) => `${classById(row.classId)!.name} ${row.levels}`).join(" / ");
  const subclassNames = draft.classLevels.map((row) => classById(row.classId)?.subclasses.find(({ id }) => id === draft.subclasses[row.classId])?.name).filter(Boolean) as string[];
  const castingProfiles = draft.classLevels.flatMap((row) => {
    const casting = castingDetailsForDraft(draft, row.classId);
    if (!casting) return [];
    const modifier = abilityModifier(computation.finalScores[casting.ability]);
    return [{ className: casting.profileName, ability: casting.ability, modifier, saveDc: 8 + computation.proficiency + modifier, attackBonus: computation.proficiency + modifier }];
  });
  const speciesMagic = speciesMagicForDraft(draft);
  const speciesCastingAbility = speciesMagic?.abilityChoices.length === 1 ? speciesMagic.abilityChoices[0] : draft.speciesCastingAbility || null;
  if (speciesMagic && speciesCastingAbility) {
    const modifier = abilityModifier(computation.finalScores[speciesCastingAbility]);
    castingProfiles.push({ className: `${species.name} Innate Magic`, ability: speciesCastingAbility, modifier, saveDc: 8 + computation.proficiency + modifier, attackBonus: computation.proficiency + modifier });
  }
  const primaryCasting = castingProfiles[0];
  const castingAbilities = [...new Set(castingProfiles.map(({ ability }) => ability))];
  const featuresText = managedBlock([
    ...computation.featureNames.map((name) => `• ${name}`),
    ...computation.optionNames.map((name) => `• ${name}`),
    ...computation.manualChoiceNames.map((name) => `• Manual player choice — ${name}`),
    draft.manualRulings.trim() ? `Manual rulings / unresolved intent:\n${draft.manualRulings.trim()}` : "",
  ].filter(Boolean).join("\n"));
  const speciesText = managedBlock(species.traits.map((name) => `• ${name}`).join("\n"));
  const featText = managedBlock(computation.featNames.map((name) => `• ${name}`).join("\n"));
  const languageText = managedBlock([...fixedLanguageNames(draft), ...draft.languages].join(", "));
  const hpCurrent = prior && !draft.resetCurrentHitPoints
    ? Math.max(0, computation.hitPoints - Math.max(0, target.vitals.hpMax - target.vitals.hpCurrent))
    : computation.hitPoints;

  return {
    ...target,
    name: draft.name.trim(),
    subtitle: `Level ${computation.level} ${classNames} · ${species.name}`,
    identity: {
      ...target.identity,
      background: background.name,
      className: classNames,
      species: species.name + (draft.lineage ? ` (${draft.lineage})` : ""),
      subclass: subclassNames.join(" / "),
      level: computation.level,
    },
    vitals: {
      ...target.vitals,
      armorClass: computation.armorClass,
      hpMax: computation.hitPoints,
      hpCurrent,
      initiative: abilityModifier(computation.finalScores.dex),
      speed: species.speed,
      proficiency: computation.proficiency,
      size: draft.size,
      hitDie: draft.classLevels.length === 1 ? `d${firstClass.hitDie}` : draft.classLevels.map((row) => `${row.levels}d${classById(row.classId)!.hitDie}`).join(" + "),
      hitDiceMax: computation.level,
      hitDiceSpent: Math.min(target.vitals.hitDiceSpent, computation.level),
    },
    passive: { label: "Perception", bonus: abilityModifier(computation.finalScores.wis) + (proficiencies.has("perception") ? computation.proficiency * (expertise.has("perception") ? 2 : 1) : 0) },
    abilities: Object.fromEntries(abilityKeys.map((ability) => {
      const modifier = abilityModifier(computation.finalScores[ability]);
      const proficient = firstClass.saves.includes(ability);
      return [ability, { ...target.abilities[ability], score: computation.finalScores[ability], proficient, save: modifier + (proficient ? computation.proficiency : 0) }];
    })) as CharacterSheet["abilities"],
    skills: Object.fromEntries(skillDefinitions.map(({ id, ability }) => {
      const proficient = proficiencies.has(id);
      return [id, { proficient, bonus: abilityModifier(computation.finalScores[ability]) + (proficient ? computation.proficiency * (expertise.has(id) ? 2 : 1) : 0) }];
    })) as CharacterSheet["skills"],
    attacks: [...target.attacks.filter(({ id }) => !priorAttacks.has(id)), ...generatedAttacks],
    resources: mergeCurrentResources(target.resources.filter(({ id }) => !priorResources.has(id)), generatedResources, target.resources),
    inventory: [...target.inventory.filter(({ id }) => !priorInventory.has(id)), ...generatedInventory],
    details: {
      classFeatures: replaceManagedBlock(target.details.classFeatures, featuresText),
      speciesTraits: replaceManagedBlock(target.details.speciesTraits, speciesText),
      feats: replaceManagedBlock(target.details.feats, featText),
      armorTraining: armor.armor,
      weapons: replaceManagedBlock(target.details.weapons, managedBlock(armor.weapons.join(", "))),
      tools: replaceManagedBlock(target.details.tools, managedBlock(armor.tools.join(", "))),
    },
    story: { ...target.story, languages: replaceManagedBlock(target.story.languages, languageText) },
    spellcasting: {
      ...target.spellcasting,
      ability: castingAbilities.length === 1 ? castingAbilities[0].toUpperCase() : castingAbilities.length > 1 ? "Multiple (see profiles)" : "",
      modifier: primaryCasting?.modifier ?? 0,
      saveDc: primaryCasting?.saveDc ?? 0,
      attackBonus: primaryCasting?.attackBonus ?? 0,
      profiles: castingProfiles,
      slots: computation.normalSlots.map((total, index) => ({ level: index + 1, total, expended: Math.min(total, target.spellcasting.slots[index]?.expended ?? 0) })),
      spells: [...target.spellcasting.spells.filter(({ id }) => !priorSpells.has(id)), ...generatedSpells],
    },
    coins: { ...target.coins, gp: manualGp + generatedGp },
    creator: {
      schemaVersion: 1,
      sourceArchiveSha256: characterCatalogue.source.archiveSha256,
      appliedReviewFingerprint: review.fingerprint,
      buildState: structuredClone({ ...draft, changeNotices: [] }) as unknown as Record<string, unknown>,
      managedAttackIds: generatedAttacks.map(({ id }) => id),
      managedResourceIds: generatedResources.map(({ id }) => id),
      managedInventoryIds: generatedInventory.map(({ id }) => id),
      managedSpellIds: generatedSpells.map(({ id }) => id),
      managedGoldPieces: generatedGp,
      appliedAt: new Date().toISOString(),
    },
  };
}

export function rebaseCharacterCreatorDraft(draft: CharacterCreatorDraft, target: CharacterSheet): CharacterCreatorDraft {
  return { ...draft, targetSheetId: target.id, targetFingerprint: sheetTargetFingerprint(target), manualReviewAcknowledged: false };
}

export function sheetTargetFingerprint(sheet: CharacterSheet): string {
  const value = stableStringify(sheet);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `sheet-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function computeCharacter(draft: CharacterCreatorDraft): CharacterCreatorComputation {
  const level = totalLevel(draft);
  const finalScores = finalAbilityScores(draft);
  const proficiency = proficiencyBonus(level);
  const classSummary = draft.classLevels.map((row) => `${classById(row.classId)?.name ?? "Unselected"} ${row.levels}`).join(" / ");
  const normalSlots = multiclassSpellSlots(draft);
  const pactSlots = computeCharacterShallowPact(draft);
  const preparedCounts = draft.classLevels.flatMap((row) => {
    const casting = castingDetailsForDraft(draft, row.classId);
    return casting ? [{
      classId: casting.classId,
      className: casting.profileName,
      cantrips: casting.cantrips,
      prepared: casting.prepared,
      spellbook: casting.spellbook,
      maximumSpellLevel: casting.maximumSpellLevel,
    }] : [];
  });
  const featureNames = selectedFeatureNames(draft);
  const featNames = selectedFeatNames(draft);
  const optionNames = selectedOptionNames(draft);
  const trainingChoiceNames = [
    ...skillChoiceRequirementsForDraft(draft).flatMap((requirement) => (draft.skillChoices[requirement.key] ?? []).map((value) => `${skillName(value)} (${requirement.sourceLabel})`)),
    ...draft.expertise.map((value) => `${skillName(value)} Expertise`),
    ...draft.languages.map((value) => `${value} (chosen language)`),
    ...toolChoiceRequirementsForDraft(draft).flatMap((requirement) => (draft.toolChoices[requirement.key] ?? []).map((value) => `${value.trim()} (${requirement.sourceLabel})`)),
  ];
  const manualChoiceNames = manualChoiceRequirementsForDraft(draft).flatMap((requirement) => {
    const value = draft.manualChoices[requirement.key]?.trim();
    return value ? [`${requirement.label}: ${value}`] : [];
  });
  const spellNames = selectedSpellRecords(draft).map(({ name }) => name).filter((name, index, values) => values.indexOf(name) === index).sort();
  const equipmentNames = generatedInventoryForDraft(draft).map(({ name, quantity }) => `${quantity > 1 ? `${quantity} × ` : ""}${name}`);
  return {
    level,
    classSummary,
    finalScores,
    proficiency,
    hitPoints: draft.hpMode === "manual" ? Math.max(1, draft.manualHitPoints ?? 1) : calculateFixedHitPoints(draft, finalScores),
    armorClass: calculatedArmorClass(draft, finalScores),
    normalSlots,
    pactSlots,
    preparedCounts,
    featureNames,
    featNames,
    optionNames,
    trainingChoiceNames,
    manualChoiceNames,
    spellNames,
    equipmentNames,
    manualReviewReasons: manualReviewReasons(draft),
  };
}

function finalAbilityScores(draft: CharacterCreatorDraft): FinalAbilityScores {
  const scores = Object.fromEntries(abilityKeys.map((ability) => [ability, Number(draft.baseScores[ability] ?? 0)])) as FinalAbilityScores;
  const background = catalogueBackground(draft.backgroundId);
  if (background && draft.boostMode === "1+1+1") background.abilities.forEach((ability) => scores[ability] += 1);
  if (draft.boostMode === "2+1") {
    if (draft.boostTwo) scores[draft.boostTwo] += 2;
    if (draft.boostOne) scores[draft.boostOne] += 1;
  }
  for (const choice of Object.values(draft.feats)) {
    for (const [ability, amount] of Object.entries(choice.abilityIncreases)) scores[ability as AbilityKey] += Number(amount ?? 0);
  }
  return scores;
}

function prerequisiteEligible(option: CatalogueFeat | CatalogueOptionalFeature, draft: CharacterCreatorDraft): boolean {
  if (option.prerequisites.length === 0) return true;
  const scores = finalAbilityScores(draft);
  return option.prerequisites.some((prerequisite) => {
    const prerequisiteLevel = prerequisite.className
      ? draft.classLevels.find((row) => classById(row.classId)?.name === prerequisite.className)?.levels ?? 0
      : totalLevel(draft);
    if (prerequisite.level && prerequisiteLevel < prerequisite.level) return false;
    if (prerequisite.abilities.some(({ ability, score }) => scores[ability] < score)) return false;
    if (prerequisite.spellcasting && !draft.classLevels.some((row) => castingDetailsForDraft(draft, row.classId))) return false;
    return true;
  });
}

function abilitySelectionMatches(feat: CatalogueFeat, selected: Partial<Record<AbilityKey, number>>): boolean {
  const compact = Object.fromEntries(Object.entries(selected).filter(([, value]) => Number(value) > 0));
  if (feat.ability.length === 0) return Object.keys(compact).length === 0;
  return feat.ability.some((rule) => {
    const expected = { ...rule.fixed } as Partial<Record<AbilityKey, number>>;
    if (rule.choose) {
      const chosen = Object.entries(compact).filter(([ability, amount]) => rule.choose!.from.includes(ability as AbilityKey) && Number(amount) === rule.choose!.amount);
      if (chosen.length !== rule.choose.count) return false;
      for (const [ability, amount] of chosen) expected[ability as AbilityKey] = Number(expected[ability as AbilityKey] ?? 0) + Number(amount);
    }
    return abilityKeys.every((ability) => Number(compact[ability] ?? 0) === Number(expected[ability] ?? 0));
  });
}

function totalLevel(draft: CharacterCreatorDraft): number {
  return draft.classLevels.reduce((sum, row) => sum + Number(row.levels || 0), 0);
}

function proficiencyBonus(level: number): number {
  return Math.max(2, Math.ceil(Math.max(1, level) / 4) + 1);
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function maximumSpellLevel(spellcasting: CatalogueSpellcasting, level: number): number {
  if (spellcasting.progression === "pact") return spellcasting.pactSlots[level - 1]?.level ?? 0;
  const slots = spellcasting.slotTable[level - 1] ?? [];
  let maximum = 0;
  slots.forEach((count, index) => { if (count > 0) maximum = index + 1; });
  return maximum;
}

function selectedSkills(draft: CharacterCreatorDraft): Set<SkillId> {
  const background = catalogueBackground(draft.backgroundId);
  return new Set([
    ...(background?.skills ?? []),
    ...Object.values(draft.skillChoices).flat(),
    ...(draft.speciesSkill ? [draft.speciesSkill] : []),
  ]);
}

function fixedLanguageNames(draft: CharacterCreatorDraft): string[] {
  const names = new Set(["Common"]);
  for (const row of draft.classLevels) {
    const className = classById(row.classId)?.name;
    if (className === "Druid" && row.levels >= 1) names.add("Druidic");
    if (className === "Rogue" && row.levels >= 1) names.add("Thieves' Cant");
  }
  return [...names];
}

function selectedFeatureNames(draft: CharacterCreatorDraft): string[] {
  const names = draft.classLevels.flatMap((row) => {
    const data = classById(row.classId);
    if (!data) return [];
    const subclass = data.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    return [
      ...data.features.filter(({ level }) => level <= row.levels).map(({ name }) => `${data.name}: ${name}`),
      ...(subclass?.features.filter(({ level }) => level <= row.levels).map(({ name }) => `${subclass.name}: ${name}`) ?? []),
    ];
  });
  return names.filter((name, index, values) => {
    if (!name.endsWith(": Extra Attack")) return true;
    return values.findIndex((candidate) => candidate.endsWith(": Extra Attack")) === index;
  });
}

function selectedFeatNames(draft: CharacterCreatorDraft): string[] {
  const background = catalogueBackground(draft.backgroundId);
  const origin = characterCatalogue.feats.find((feat) => feat.id.includes(`feat-${background?.originFeatId ?? "never"}-`));
  return [
    ...(origin ? [`${origin.name} (${origin.source}; background)`] : []),
    ...Object.values(draft.feats).flatMap((choice) => {
      const feat = catalogueFeat(choice.featId);
      return feat ? [`${feat.name} (${feat.source})`] : [];
    }),
  ];
}

function selectedOptionNames(draft: CharacterCreatorDraft): string[] {
  const requirementOptions = new Map(optionRequirementsForDraft(draft).flatMap(({ options }) => options.map((option) => [option.id, option] as const)));
  return Object.values(draft.optionSelections).flatMap((ids) => ids.map((id) => {
    const feat = catalogueFeat(id);
    const option = characterCatalogue.optionalFeatures.find((candidate) => candidate.id === id);
    const item = characterCatalogue.items.find((candidate) => candidate.id === id);
    const featureChoice = requirementOptions.get(id);
    return feat ? `${feat.name} (${feat.source})` : option ? `${option.name} (${option.source})` : item ? `${item.name} mastery` : featureChoice ? `${featureChoice.name} (${featureChoice.source})` : id;
  }));
}

function selectedSpellRecords(draft: CharacterCreatorDraft): CatalogueSpell[] {
  const ids = new Set([
    ...Object.values(draft.spells).flatMap((choices) => [...choices.cantrips, ...choices.prepared, ...choices.spellbook]),
    ...Object.values(draft.spellChoiceSelections).flat(),
  ]);
  for (const row of draft.classLevels) {
    const data = classById(row.classId);
    const subclass = data?.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    for (const grant of [...(data?.spellcasting?.alwaysSpells ?? []), ...(subclass?.alwaysSpells ?? [])]) if (grant.level <= row.levels && grant.mode !== "expanded") ids.add(grant.spellId);
  }
  for (const grant of speciesMagicForDraft(draft)?.grants ?? []) if (grant.level <= totalLevel(draft) && grant.mode !== "expanded") ids.add(grant.spellId);
  return characterCatalogue.spells.filter(({ id }) => ids.has(id));
}

function manualReviewReasons(draft: CharacterCreatorDraft): string[] {
  const reasons = [];
  for (const requirement of manualChoiceRequirementsForDraft(draft)) {
    if (draft.manualChoices[requirement.key]?.trim()) reasons.push(`${requirement.sourceLabel}: the player's ${requirement.label} answer is preserved for table review.`);
  }
  const selectedOptions = Object.values(draft.optionSelections).flat();
  for (const id of selectedOptions) {
    const option = characterCatalogue.optionalFeatures.find((candidate) => candidate.id === id);
    if (option?.prerequisites.some((prerequisite) => prerequisite.spell.length > 0 || prerequisite.pact || prerequisite.feature.length > 0)) reasons.push(`${option.name}'s nonnumeric prerequisite needs a manual check.`);
  }
  for (const choice of Object.values(draft.feats)) {
    const feat = catalogueFeat(choice.featId);
    if (feat?.prerequisites.some((prerequisite) => prerequisite.spell.length > 0 || prerequisite.pact || prerequisite.feature.length > 0)) reasons.push(`${feat.name}'s nonnumeric prerequisite needs a manual check.`);
  }
  if (draft.manualRulings.trim()) reasons.push("The player recorded custom or unsupported intent for table review.");
  return [...new Set(reasons)];
}

function calculatedArmorClass(draft: CharacterCreatorDraft, scores: FinalAbilityScores): number {
  const items = selectedEquipmentItems(draft);
  const shield = items.some((item) => item.name === "Shield") ? 2 : 0;
  if (draft.armorClassMode === "manual") return Math.max(1, draft.manualArmorClass ?? 10);
  if (draft.armorClassMode === "barbarian") return 10 + abilityModifier(scores.dex) + abilityModifier(scores.con) + shield;
  if (draft.armorClassMode === "monk") return 10 + abilityModifier(scores.dex) + abilityModifier(scores.wis);
  if (draft.armorClassMode === "unarmored") return 10 + abilityModifier(scores.dex) + shield;
  const armor = items.filter(({ armorClass, category }) => category === "Armor" && armorClass != null && armorClass > 2);
  const best = armor.reduce((maximum, item) => {
    const dexterity = item.weaponType === "HA" ? 0 : item.armorDexCap == null ? abilityModifier(scores.dex) : Math.min(item.armorDexCap, abilityModifier(scores.dex));
    return Math.max(maximum, Number(item.armorClass) + dexterity);
  }, 10 + abilityModifier(scores.dex));
  const defenseStyle = armor.length > 0 && selectedFeatRecords(draft).some(({ name, category }) => name === "Defense" && category === "FS") ? 1 : 0;
  return best + shield + defenseStyle;
}

function selectedFeatRecords(draft: CharacterCreatorDraft): CatalogueFeat[] {
  const background = catalogueBackground(draft.backgroundId);
  const ids = new Set([
    ...Object.values(draft.feats).map(({ featId }) => featId),
    ...Object.values(draft.optionSelections).flat(),
  ]);
  const origin = characterCatalogue.feats.find((feat) => feat.id.includes(`feat-${background?.originFeatId ?? "never"}-`));
  if (origin) ids.add(origin.id);
  return characterCatalogue.feats.filter(({ id }) => ids.has(id));
}

function selectedEquipmentChoices(draft: CharacterCreatorDraft): CatalogueEquipmentChoice[] {
  const first = classById(draft.classLevels[0]?.classId);
  const background = catalogueBackground(draft.backgroundId);
  return [
    first?.equipment.find(({ id }) => id === draft.equipment.classPackageId),
    background?.equipment.find(({ id }) => id === draft.equipment.backgroundPackageId),
  ].filter(Boolean) as CatalogueEquipmentChoice[];
}

function selectedEquipmentItems(draft: CharacterCreatorDraft): CatalogueItem[] {
  const ids = new Set(selectedEquipmentChoices(draft).flatMap((choice) => choice.items.map(({ id }) => id)));
  return characterCatalogue.items.filter(({ id }) => ids.has(id));
}

function generatedInventoryForDraft(draft: CharacterCreatorDraft): CharacterSheet["inventory"] {
  return selectedEquipmentChoices(draft).flatMap((choice) => choice.items.map((entry) => {
    const item = characterCatalogue.items.find(({ id }) => id === entry.id);
    const custom = entry.prompt ? draft.equipment.customNames[equipmentItemChoiceKey(choice.id, entry.id)]?.trim() : "";
    return {
      id: `item-creator-${slug(`${choice.id}-${entry.id}`)}`,
      name: custom || item?.name || entry.name,
      quantity: entry.quantity,
      weight: item?.weight ?? 0,
      category: item?.category ?? (entry.prompt ? "Gear" : "Gear"),
      equipped: draft.armorClassMode === "equipped" && item?.category === "Armor",
      notes: entry.prompt ? `Player choice: ${entry.prompt}` : `${entry.source} starting equipment`,
    };
  }));
}

export function equipmentItemChoiceKey(choiceId: string, itemId: string) {
  return `${choiceId}:${itemId}`;
}

function generatedAttacksForDraft(draft: CharacterCreatorDraft, scores: FinalAbilityScores, proficiency: number): CharacterSheet["attacks"] {
  const unique = new Map<string, CatalogueItem>();
  for (const item of selectedEquipmentItems(draft)) if (item.category === "Weapon") unique.set(item.id, item);
  return [...unique.values()].map((item) => {
    const finesse = item.properties.includes("F");
    const ability = finesse ? draft.weaponAbilities[item.id] ?? "str" : item.weaponType === "R" || (item.range && !item.properties.includes("T")) ? "dex" : "str";
    return {
      id: `attack-creator-${slug(item.id)}`,
      name: item.name,
      attackBonus: abilityModifier(scores[ability]) + proficiency,
      damage: `${item.damage || "1"}${signed(abilityModifier(scores[ability]))}`,
      damageType: damageType(item.damageType),
      notes: `${ability.toUpperCase()} · ${item.range ? `Range ${item.range}` : "melee"}`,
    };
  });
}

function generatedResourcesForDraft(draft: CharacterCreatorDraft): CharacterSheet["resources"] {
  const resources = draft.classLevels.flatMap((row) => {
    const data = classById(row.classId);
    if (!data) return [];
    const subclass = data.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    const progressions = [
      ...data.tableProgressions.map((progression) => ({ ownerId: data.id, progression })),
      ...(subclass?.tableProgressions ?? []).map((progression) => ({ ownerId: subclass!.id, progression })),
    ];
    return progressions.flatMap(({ ownerId, progression }) => {
      const maximum = Number(progression.values[row.levels - 1] ?? 0);
      if (!Number.isFinite(maximum) || maximum < 1 || /cantrip|prepared|weapon mastery|spell slot|slot level|magic item|plans known|invocation/i.test(progression.label)) return [];
      return [{ id: `resource-creator-${slug(`${ownerId}-${progression.label}`)}`, name: progression.label, current: maximum, max: maximum, reset: "See feature" }];
    });
  });
  for (const slot of computeCharacterShallowPact(draft)) resources.push({ id: `resource-creator-${slug(`${slot.className}-pact-slots`)}`, name: `${slot.className} Pact Slots (level ${slot.level})`, current: slot.count, max: slot.count, reset: "Short or long rest" });
  return resources;
}

function computeCharacterShallowPact(draft: CharacterCreatorDraft) {
  return draft.classLevels.flatMap((row) => {
    const data = classById(row.classId);
    const subclass = data?.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    const spellcasting = data?.spellcasting ?? subclass?.spellcasting;
    const slot = spellcasting?.pactSlots[row.levels - 1];
    return data && slot?.count ? [{ className: data.spellcasting ? data.name : subclass?.name ?? data.name, ...slot }] : [];
  });
}

function generatedSpellsForDraft(draft: CharacterCreatorDraft): CharacterSheet["spellcasting"]["spells"] {
  const prepared = selectedSpellPreparation(draft);
  return selectedSpellRecords(draft).map((spell) => ({
    id: `spell-creator-${slug(spell.id)}`,
    level: spell.level,
    name: spell.name,
    prepared: prepared.get(spell.id) !== false,
    castingTime: spell.castingTime,
    range: spell.range,
    concentration: spell.concentration,
    ritual: spell.ritual,
    material: spell.material,
    notes: `${spell.source}${spell.compatibility === "revised-list-legacy-source" ? " · legacy source on a revised class list" : ""}`,
  }));
}

function selectedSpellPreparation(draft: CharacterCreatorDraft): Map<string, boolean> {
  const selected = new Map<string, boolean>();
  for (const choices of Object.values(draft.spells)) {
    for (const id of choices.spellbook) if (!selected.has(id)) selected.set(id, false);
    for (const id of [...choices.cantrips, ...choices.prepared]) selected.set(id, true);
  }
  for (const requirement of spellChoiceRequirementsForDraft(draft)) {
    for (const id of draft.spellChoiceSelections[requirement.key] ?? []) selected.set(id, requirement.destination !== "spellbook");
  }
  for (const row of draft.classLevels) {
    const data = classById(row.classId);
    const subclass = data?.subclasses.find(({ id, level }) => id === draft.subclasses[row.classId] && level <= row.levels);
    for (const grant of [...(data?.spellcasting?.alwaysSpells ?? []), ...(subclass?.alwaysSpells ?? [])]) if (grant.level <= row.levels && grant.mode !== "expanded") selected.set(grant.spellId, true);
  }
  for (const grant of speciesMagicForDraft(draft)?.grants ?? []) if (grant.level <= totalLevel(draft) && grant.mode !== "expanded") selected.set(grant.spellId, true);
  return selected;
}

function combinedTraining(draft: CharacterCreatorDraft) {
  const armor = new Set<string>();
  const weapons = new Set<string>();
  const tools = new Set<string>(catalogueBackground(draft.backgroundId)?.tools ?? []);
  draft.classLevels.forEach((row, index) => {
    const data = classById(row.classId);
    const training = index === 0 ? data?.training : data?.multiclassTraining;
    training?.armor.forEach((value) => armor.add(value));
    training?.weapons.forEach((value) => weapons.add(value));
    training?.tools.forEach((value) => tools.add(value));
  });
  for (const values of Object.values(draft.toolChoices)) for (const value of values) if (value.trim()) tools.add(value.trim());
  return {
    armor: {
      light: armor.has("light"),
      medium: armor.has("medium"),
      heavy: armor.has("heavy"),
      shields: armor.has("shield") || armor.has("shields"),
    },
    weapons: [...weapons],
    tools: [...tools],
  };
}

function reviewSummary(draft: CharacterCreatorDraft, computation: CharacterCreatorComputation): string[] {
  const species = speciesForDraft(draft);
  const background = catalogueBackground(draft.backgroundId);
  return [
    `${draft.name.trim() || "Unnamed character"} — Level ${computation.level} ${computation.classSummary}`,
    `${species?.name ?? "No species"}${draft.lineage ? ` (${draft.lineage})` : ""} · ${background?.name ?? "No background"}`,
    `STR ${computation.finalScores.str}, DEX ${computation.finalScores.dex}, CON ${computation.finalScores.con}, INT ${computation.finalScores.int}, WIS ${computation.finalScores.wis}, CHA ${computation.finalScores.cha}`,
    `${computation.hitPoints} HP · AC ${computation.armorClass} · proficiency +${computation.proficiency}`,
    `Features: ${computation.featureNames.join("; ") || "none"}`,
    `Feats and structured options: ${[...computation.featNames, ...computation.optionNames].join("; ") || "none"}`,
    `Training choices: ${computation.trainingChoiceNames.join("; ") || "none"}`,
    `Recorded manual choices: ${computation.manualChoiceNames.join("; ") || "none"}`,
    `Spells: ${computation.spellNames.join(", ") || "none"}`,
    `Equipment: ${computation.equipmentNames.join(", ") || "none"}`,
    computation.manualReviewReasons.length ? `Manual review: ${computation.manualReviewReasons.join(" ")}` : "Corpus validation: no manual rulings recorded.",
  ];
}

function changedFieldSummary(target: CharacterSheet, draft: CharacterCreatorDraft, computation: CharacterCreatorComputation): string[] {
  const fields = ["identity", "ability scores and saves", "skills and proficiency", "HP / AC / movement", "creator-managed features", "creator-managed equipment and attacks", "creator-managed spells and slots"];
  if (target.name !== draft.name.trim()) fields.unshift("character name");
  if (target.creator) fields.push("previous creator grants replaced in place; manual additions retained");
  if (!draft.resetCurrentHitPoints && target.creator) fields.push("current damage and expended spell slots retained within new maxima");
  if (computation.manualReviewReasons.length) fields.push("manual rulings appended for table review");
  return fields;
}

function normalizedExportSelections(draft: CharacterCreatorDraft) {
  const { targetSheetId: _targetSheetId, classLevels, ...selections } = draft;
  void _targetSheetId;
  return {
    ...selections,
    classLevels: classLevels.map(({ classId, levels }) => ({ classId, levels })),
  };
}

function validateSpellList(
  add: (step: CreatorIssue["step"], code: string, message: string, blocking?: boolean) => void,
  classId: string,
  label: string,
  selected: string[],
  count: number,
  available: CatalogueSpell[],
) {
  const ids = new Set(available.map(({ id }) => id));
  if (selected.length !== count || new Set(selected).size !== selected.length || selected.some((id) => !ids.has(id))) add("Spells", `${classId}-${slug(label)}`, `Choose exactly ${count} eligible ${label}.`);
}

function emptySpellChoices(): CreatorSpellChoices {
  return { cantrips: [], prepared: [], spellbook: [] };
}

function speciesForDraft(draft: CharacterCreatorDraft) {
  return characterCatalogue.species.find(({ id }) => id === draft.speciesId);
}

export function speciesMagicForDraft(draft: CharacterCreatorDraft) {
  const species = speciesForDraft(draft);
  if (!species) return undefined;
  if (draft.lineage) return species.innateMagic.find(({ name }) => name === draft.lineage);
  return species.lineages.length === 0 && species.innateMagic.length === 1 ? species.innateMagic[0] : undefined;
}

function classById(id: string) {
  return characterCatalogue.classes.find((entry) => entry.id === id);
}

function choiceName(id: string) {
  if (!id) return "an unselected choice";
  const direct = characterCatalogue.feats.find((entry) => entry.id === id)
    ?? characterCatalogue.optionalFeatures.find((entry) => entry.id === id)
    ?? characterCatalogue.spells.find((entry) => entry.id === id)
    ?? characterCatalogue.items.find((entry) => entry.id === id)
    ?? characterCatalogue.classes.find((entry) => entry.id === id)
    ?? characterCatalogue.species.find((entry) => entry.id === id)
    ?? characterCatalogue.backgrounds.find((entry) => entry.id === id)
    ?? characterCatalogue.classes.flatMap((entry) => entry.subclasses).find((entry) => entry.id === id);
  if (direct) return direct.name;
  for (const feature of characterCatalogue.classes.flatMap((entry) => [
    ...entry.features,
    ...entry.subclasses.flatMap((subclass) => subclass.features),
  ])) {
    const option = feature.choiceGroups.flatMap((group) => group.options).find((entry) => entry.id === id);
    if (option) return option.name;
  }
  return id;
}

function spellChoiceNames(choices: CreatorSpellChoices) {
  return [...new Set([...choices.cantrips, ...choices.prepared, ...choices.spellbook].map(choiceName))];
}

function skillName(id: SkillId) {
  return skillDefinitions.find((skill) => skill.id === id)?.label ?? id;
}

function managedBlock(value: string) {
  return `[20Fates Creator]\n${value.trim()}\n[/20Fates Creator]`;
}

function replaceManagedBlock(existing: string, next: string) {
  const manual = existing.replace(managedBlockPattern, "").trim();
  return [manual, next].filter(Boolean).join("\n\n");
}

function mergeCurrentResources(manual: CharacterSheet["resources"], generated: CharacterSheet["resources"], prior: CharacterSheet["resources"]) {
  return [...manual, ...generated.map((resource) => {
    const previous = prior.find(({ id }) => id === resource.id);
    return previous ? { ...resource, current: Math.min(resource.max, previous.current) } : resource;
  })];
}

function integer(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(Number(value) || 0)));
}

function titleCase(value: string) {
  return value.replace(/[-;]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function signed(value: number) {
  return value >= 0 ? `+${value}` : String(value);
}

function damageType(value: string) {
  return ({ B: "Bludgeoning", P: "Piercing", S: "Slashing" } as Record<string, string>)[value] || value || "Damage";
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
