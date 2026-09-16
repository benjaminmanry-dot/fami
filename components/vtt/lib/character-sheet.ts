export const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityKey = (typeof abilityKeys)[number];
export type SheetTheme = "parchment" | "high-contrast" | "blue-gold";
export type SheetModuleId = "identity" | "vitals" | "abilities" | "skills" | "attacks" | "features" | "resources" | "inventory" | "spells" | "currency" | "notes";

export const skillDefinitions = [
  { id: "athletics", label: "Athletics", ability: "str" },
  { id: "acrobatics", label: "Acrobatics", ability: "dex" },
  { id: "sleight-of-hand", label: "Sleight of Hand", ability: "dex" },
  { id: "stealth", label: "Stealth", ability: "dex" },
  { id: "arcana", label: "Arcana", ability: "int" },
  { id: "history", label: "History", ability: "int" },
  { id: "investigation", label: "Investigation", ability: "int" },
  { id: "nature", label: "Nature", ability: "int" },
  { id: "religion", label: "Religion", ability: "int" },
  { id: "animal-handling", label: "Animal Handling", ability: "wis" },
  { id: "insight", label: "Insight", ability: "wis" },
  { id: "medicine", label: "Medicine", ability: "wis" },
  { id: "perception", label: "Perception", ability: "wis" },
  { id: "survival", label: "Survival", ability: "wis" },
  { id: "deception", label: "Deception", ability: "cha" },
  { id: "intimidation", label: "Intimidation", ability: "cha" },
  { id: "performance", label: "Performance", ability: "cha" },
  { id: "persuasion", label: "Persuasion", ability: "cha" },
] as const satisfies ReadonlyArray<{ id: string; label: string; ability: AbilityKey }>;
export type SkillId = (typeof skillDefinitions)[number]["id"];

export type SheetAbility = {
  label: string;
  score: number;
  save: number;
  proficient: boolean;
};

export type SheetAttack = {
  id: string;
  name: string;
  attackBonus: number;
  damage: string;
  damageType: string;
  notes: string;
};

export type SheetResource = {
  id: string;
  name: string;
  current: number;
  max: number;
  reset: string;
};

export type SheetSpell = {
  id: string;
  level: number;
  name: string;
  prepared?: boolean;
  castingTime: string;
  range: string;
  concentration: boolean;
  ritual: boolean;
  material: string;
  notes: string;
};

export type SheetInventoryItem = {
  id: string;
  name: string;
  quantity: number;
  weight: number;
  category: string;
  equipped: boolean;
  notes: string;
};

export type RichTextRun = {
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
};

export type SheetModuleLayout = {
  id: SheetModuleId;
  span: number;
  height: number;
};

export type SheetInkStroke = {
  id: string;
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
};

export type CharacterCreatorMetadata = {
  schemaVersion: 1;
  sourceArchiveSha256: string;
  appliedReviewFingerprint: string;
  buildState?: Record<string, unknown>;
  managedAttackIds: string[];
  managedResourceIds: string[];
  managedInventoryIds: string[];
  managedSpellIds: string[];
  managedGoldPieces: number;
  appliedAt: string;
};

export type SheetCastingProfile = {
  className: string;
  ability: AbilityKey;
  modifier: number;
  saveDc: number;
  attackBonus: number;
};

export type CharacterSheet = {
  version: 2;
  id: string;
  tokenId: string;
  name: string;
  subtitle: string;
  theme: SheetTheme;
  textScale: number;
  layoutLocked: boolean;
  identity: {
    background: string;
    className: string;
    species: string;
    subclass: string;
    level: number;
    xp: number;
    alignment: string;
  };
  vitals: {
    armorClass: number;
    shieldBonus: number;
    hpCurrent: number;
    hpMax: number;
    tempHp: number;
    initiative: number;
    speed: number;
    proficiency: number;
    size: string;
    heroicInspiration: boolean;
    hitDie: string;
    hitDiceSpent: number;
    hitDiceMax: number;
    deathSaveSuccesses: number;
    deathSaveFailures: number;
  };
  passive: { label: string; bonus: number };
  abilities: Record<AbilityKey, SheetAbility>;
  skills: Record<SkillId, { bonus: number; proficient: boolean }>;
  attacks: SheetAttack[];
  resources: SheetResource[];
  inventory: SheetInventoryItem[];
  magicItemAttunement: [string, string, string];
  details: {
    classFeatures: string;
    speciesTraits: string;
    feats: string;
    armorTraining: { light: boolean; medium: boolean; heavy: boolean; shields: boolean };
    weapons: string;
    tools: string;
  };
  story: {
    appearance: string;
    backstory: string;
    personality: string;
    languages: string;
  };
  spellcasting: {
    ability: string;
    modifier: number;
    saveDc: number;
    attackBonus: number;
    slots: Array<{ level: number; total: number; expended: number }>;
    spells: SheetSpell[];
    profiles?: SheetCastingProfile[];
  };
  coins: { cp: number; sp: number; ep: number; gp: number; pp: number };
  notes: RichTextRun[];
  modules: SheetModuleLayout[];
  strokes: SheetInkStroke[];
  creator?: CharacterCreatorMetadata;
};

const previousModuleDefaults: SheetModuleLayout[] = [
  { id: "identity", span: 12, height: 220 },
  { id: "vitals", span: 12, height: 280 },
  { id: "abilities", span: 12, height: 250 },
  { id: "skills", span: 12, height: 390 },
  { id: "attacks", span: 7, height: 340 },
  { id: "features", span: 5, height: 340 },
  { id: "resources", span: 5, height: 300 },
  { id: "currency", span: 7, height: 300 },
  { id: "inventory", span: 12, height: 380 },
  { id: "spells", span: 12, height: 560 },
  { id: "notes", span: 12, height: 420 },
];

const moduleDefaults: SheetModuleLayout[] = [
  { id: "identity", span: 12, height: 200 },
  { id: "vitals", span: 12, height: 280 },
  { id: "abilities", span: 6, height: 700 },
  { id: "skills", span: 6, height: 700 },
  { id: "attacks", span: 8, height: 400 },
  { id: "features", span: 4, height: 400 },
  { id: "resources", span: 4, height: 360 },
  { id: "inventory", span: 8, height: 360 },
  { id: "spells", span: 8, height: 720 },
  { id: "notes", span: 4, height: 720 },
  { id: "currency", span: 12, height: 260 },
];

const legacyModuleDefaults: SheetModuleLayout[] = [
  { id: "vitals", span: 12, height: 190 },
  { id: "abilities", span: 12, height: 250 },
  { id: "attacks", span: 6, height: 300 },
  { id: "resources", span: 6, height: 300 },
  { id: "inventory", span: 12, height: 330 },
  { id: "currency", span: 6, height: 250 },
  { id: "notes", span: 6, height: 250 },
];

const migratedLegacyModuleDefaults = [
  ...legacyModuleDefaults,
  ...previousModuleDefaults.filter((module) =>
    !legacyModuleDefaults.some((legacyModule) => legacyModule.id === module.id),
  ),
];

const migratedCurrentLegacyModuleDefaults = [
  ...legacyModuleDefaults,
  ...moduleDefaults.filter((module) =>
    !legacyModuleDefaults.some((legacyModule) => legacyModule.id === module.id),
  ),
];

const abilityLabels: Record<AbilityKey, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

export function createCharacterSheet(
  tokenId: string,
  name: string,
  id = crypto.randomUUID(),
): CharacterSheet {
  return {
    version: 2,
    id,
    tokenId,
    name: cleanText(name, 80, "Adventurer"),
    subtitle: "Level 1 adventurer",
    theme: "parchment",
    textScale: 1,
    layoutLocked: true,
    identity: {
      background: "",
      className: "Adventurer",
      species: "",
      subclass: "",
      level: 1,
      xp: 0,
      alignment: "",
    },
    vitals: {
      armorClass: 10,
      shieldBonus: 0,
      hpCurrent: 10,
      hpMax: 10,
      tempHp: 0,
      initiative: 0,
      speed: 30,
      proficiency: 2,
      size: "Medium",
      heroicInspiration: false,
      hitDie: "d8",
      hitDiceSpent: 0,
      hitDiceMax: 1,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
    },
    passive: { label: "Perception", bonus: 0 },
    abilities: Object.fromEntries(abilityKeys.map((key) => [key, {
      label: abilityLabels[key],
      score: 10,
      save: 0,
      proficient: false,
    }])) as Record<AbilityKey, SheetAbility>,
    skills: Object.fromEntries(skillDefinitions.map(({ id }) => [id, {
      bonus: 0,
      proficient: false,
    }])) as Record<SkillId, { bonus: number; proficient: boolean }>,
    attacks: [],
    resources: [],
    inventory: [],
    magicItemAttunement: ["", "", ""],
    details: {
      classFeatures: "",
      speciesTraits: "",
      feats: "",
      armorTraining: { light: false, medium: false, heavy: false, shields: false },
      weapons: "",
      tools: "",
    },
    story: { appearance: "", backstory: "", personality: "", languages: "" },
    spellcasting: {
      ability: "",
      modifier: 0,
      saveDc: 0,
      attackBonus: 0,
      slots: Array.from({ length: 9 }, (_, index) => ({ level: index + 1, total: 0, expended: 0 })),
      spells: [],
    },
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: [{ text: "Use Ctrl+B, Ctrl+I, or Ctrl+U while editing these notes." }],
    modules: structuredClone(moduleDefaults),
    strokes: [],
    creator: undefined,
  };
}

export function createOfficialSheetLayout(): SheetModuleLayout[] {
  return structuredClone(moduleDefaults);
}

export function importCharacterSheet(value: unknown, base: CharacterSheet): CharacterSheet {
  const raw = record(value);
  if ((raw.version === 1 && raw.vitals && raw.abilities) ||
    (raw.version === 2 && raw.tokenId && raw.identity)) {
    return normalizeCharacterSheet({ ...raw, id: base.id, tokenId: base.tokenId }, base);
  }

  const meta = record(raw.meta);
  const vitals = record(raw.vitals);
  const deathSaves = record(raw.deathSaves);
  const rawAbilities = record(raw.abilities);
  const skills = array(raw.skills);
  const perception = skills.map(record).find((skill) =>
    String(skill.id ?? skill.name ?? "").toLowerCase().includes("perception"),
  );
  const level = integer(meta.level, 1, 30, 1);
  const className = cleanText(meta.className, 80, "Adventurer");
  const race = cleanText(meta.race, 80, "");
  const subtitle = [
    `Level ${level} ${className}`,
    race,
    cleanText(meta.alignment, 40, ""),
  ].filter(Boolean).join(" · ");
  const journal = record(raw.journal);
  const featureRows = array(raw.features).map(record);
  const raceCategory = race.toLowerCase();
  const featRows = featureRows.filter((feature) => String(feature.category ?? "").toLowerCase().includes("feat"));
  const speciesRows = featureRows.filter((feature) => {
    const category = String(feature.category ?? "").toLowerCase();
    return category.includes("species") || Boolean(raceCategory && category.includes(raceCategory));
  });
  const classRows = featureRows.filter((feature) => !featRows.includes(feature) && !speciesRows.includes(feature));

  return normalizeCharacterSheet({
    ...base,
    name: cleanText(meta.name, 80, base.name),
    subtitle: subtitle || base.subtitle,
    identity: {
      background: meta.background,
      className: meta.className,
      species: meta.race,
      subclass: meta.subclass,
      level: meta.level,
      xp: meta.xp,
      alignment: meta.alignment,
    },
    vitals: {
      armorClass: vitals.armorClass,
      shieldBonus: vitals.shieldBonus,
      hpCurrent: vitals.hpCurrent,
      hpMax: vitals.hpMax,
      tempHp: vitals.tempHp,
      initiative: vitals.initiative,
      speed: vitals.speed,
      proficiency: vitals.proficiency,
      size: meta.size,
      heroicInspiration: vitals.heroicInspiration,
      hitDie: vitals.hitDie,
      hitDiceSpent: number(vitals.hitDiceMax, 0, 99, 1) - number(vitals.hitDiceCurrent, 0, 99, 1),
      hitDiceMax: vitals.hitDiceMax,
      deathSaveSuccesses: deathSaves.successes,
      deathSaveFailures: deathSaves.failures,
    },
    passive: {
      label: "Perception",
      bonus: perception?.bonus ?? (number(vitals.passivePerception, -20, 50, 10) - 10),
    },
    abilities: Object.fromEntries(abilityKeys.map((key) => {
      const ability = record(rawAbilities[key]);
      return [key, {
        label: cleanText(ability.label, 30, abilityLabels[key]),
        score: ability.score,
        save: ability.save,
        proficient: ability.proficient,
      }];
    })),
    skills: Object.fromEntries(skillDefinitions.map((definition) => {
      const skill = skills.map(record).find((candidate) =>
        String(candidate.id ?? candidate.name ?? "").toLowerCase().replace(/\s+/g, "-") === definition.id,
      );
      return [definition.id, { bonus: skill?.bonus, proficient: skill?.proficient }];
    })),
    attacks: array(raw.attacks).slice(0, 60).map((value, index) => {
      const attack = record(value);
      return {
        id: entityId(attack.id, "attack", index),
        name: attack.name,
        attackBonus: attack.attackBonus,
        damage: attack.damage,
        damageType: attack.damageType,
        notes: attack.notes,
      };
    }),
    resources: array(raw.resources).slice(0, 60).map((value, index) => {
      const resource = record(value);
      return {
        id: entityId(resource.id, "resource", index),
        name: resource.name,
        current: resource.current,
        max: resource.max,
        reset: resource.reset === "none" ? "Manual" : `${cleanText(resource.reset, 20, "Long")} rest`,
      };
    }),
    inventory: array(raw.inventory).slice(0, 250).map((value, index) => {
      const item = record(value);
      return {
        id: entityId(item.id, "item", index),
        name: item.name,
        quantity: item.quantity,
        weight: item.weight,
        category: item.category,
        equipped: item.equipped,
        notes: item.notes,
      };
    }),
    magicItemAttunement: array(raw.inventory).map(record)
      .filter((item) => item.attuned === true)
      .map((item) => item.name)
      .slice(0, 3),
    details: {
      ...base.details,
      classFeatures: featureRowsText(classRows),
      speciesTraits: featureRowsText(speciesRows),
      feats: featureRowsText(featRows),
    },
    story: {
      appearance: journal.appearance,
      backstory: journal.notes,
      personality: journal.personality,
      languages: meta.languages,
    },
    coins: raw.coins,
  }, base);
}

export function normalizeCharacterSheet(value: unknown, fallback: CharacterSheet): CharacterSheet {
  const raw = record(value);
  const identity = record(raw.identity);
  const vitals = record(raw.vitals);
  const passive = record(raw.passive);
  const rawAbilities = record(raw.abilities);
  const rawSkills = record(raw.skills);
  const details = record(raw.details);
  const armorTraining = record(details.armorTraining);
  const story = record(raw.story);
  const spellcasting = record(raw.spellcasting);
  const rawCoins = record(raw.coins);
  const legacySheet = raw.version === 1;
  const modules = hasBuiltInLayout(raw.modules)
    ? structuredClone(moduleDefaults)
    : normalizedModules(raw.modules, fallback.modules, legacySheet);
  const attunement = array(raw.magicItemAttunement).slice(0, 3)
    .map((item) => cleanText(item, 120, ""));
  while (attunement.length < 3) attunement.push("");

  return {
    version: 2,
    id: cleanText(raw.id, 80, fallback.id),
    tokenId: cleanText(raw.tokenId, 80, fallback.tokenId),
    name: cleanText(raw.name, 80, fallback.name),
    subtitle: cleanText(raw.subtitle, 160, fallback.subtitle),
    theme: raw.theme === "high-contrast" || raw.theme === "blue-gold" || raw.theme === "parchment"
      ? raw.theme
      : fallback.theme,
    textScale: number(raw.textScale, 0.85, 1.4, fallback.textScale),
    layoutLocked: raw.layoutLocked !== false,
    identity: {
      background: cleanOptionalText(identity.background, 80, fallback.identity.background),
      className: cleanOptionalText(identity.className, 80, fallback.identity.className),
      species: cleanOptionalText(identity.species, 80, fallback.identity.species),
      subclass: cleanOptionalText(identity.subclass, 80, fallback.identity.subclass),
      level: integer(identity.level, 1, 30, fallback.identity.level),
      xp: integer(identity.xp, 0, 999_999_999, fallback.identity.xp),
      alignment: cleanOptionalText(identity.alignment, 60, fallback.identity.alignment),
    },
    vitals: {
      armorClass: integer(vitals.armorClass, 0, 99, fallback.vitals.armorClass),
      shieldBonus: integer(vitals.shieldBonus, 0, 20, fallback.vitals.shieldBonus),
      hpCurrent: integer(vitals.hpCurrent, -9999, 99999, fallback.vitals.hpCurrent),
      hpMax: integer(vitals.hpMax, 0, 99999, fallback.vitals.hpMax),
      tempHp: integer(vitals.tempHp, 0, 99999, fallback.vitals.tempHp),
      initiative: integer(vitals.initiative, -99, 99, fallback.vitals.initiative),
      speed: integer(vitals.speed, 0, 999, fallback.vitals.speed),
      proficiency: integer(vitals.proficiency, -20, 20, fallback.vitals.proficiency),
      size: cleanText(vitals.size, 30, fallback.vitals.size),
      heroicInspiration: vitals.heroicInspiration === true,
      hitDie: cleanText(vitals.hitDie, 120, fallback.vitals.hitDie),
      hitDiceSpent: integer(vitals.hitDiceSpent, 0, 99, fallback.vitals.hitDiceSpent),
      hitDiceMax: integer(vitals.hitDiceMax, 0, 99, fallback.vitals.hitDiceMax),
      deathSaveSuccesses: integer(vitals.deathSaveSuccesses, 0, 3, fallback.vitals.deathSaveSuccesses),
      deathSaveFailures: integer(vitals.deathSaveFailures, 0, 3, fallback.vitals.deathSaveFailures),
    },
    passive: {
      label: cleanText(passive.label, 40, fallback.passive.label),
      bonus: integer(passive.bonus, -20, 50, fallback.passive.bonus),
    },
    abilities: Object.fromEntries(abilityKeys.map((key) => {
      const ability = record(rawAbilities[key]);
      const defaultAbility = fallback.abilities[key];
      return [key, {
        label: cleanText(ability.label, 30, defaultAbility.label),
        score: integer(ability.score, 1, 30, defaultAbility.score),
        save: integer(ability.save, -20, 50, defaultAbility.save),
        proficient: ability.proficient === true,
      }];
    })) as Record<AbilityKey, SheetAbility>,
    skills: Object.fromEntries(skillDefinitions.map(({ id }) => {
      const skill = record(rawSkills[id]);
      const defaultSkill = fallback.skills[id];
      return [id, {
        bonus: integer(skill.bonus, -20, 50, defaultSkill.bonus),
        proficient: skill.proficient === true,
      }];
    })) as Record<SkillId, { bonus: number; proficient: boolean }>,
    attacks: uniqueEntities(array(raw.attacks).slice(0, 60).map((value, index) => {
      const attack = record(value);
      return {
        id: entityId(attack.id, "attack", index),
        name: cleanText(attack.name, 120, "Unnamed attack"),
        attackBonus: integer(attack.attackBonus, -50, 100, 0),
        damage: cleanText(attack.damage, 80, "1"),
        damageType: cleanText(attack.damageType, 40, "Damage"),
        notes: cleanText(attack.notes, 800, ""),
      };
    })),
    resources: uniqueEntities(array(raw.resources).slice(0, 60).map((value, index) => {
      const resource = record(value);
      return {
        id: entityId(resource.id, "resource", index),
        name: cleanText(resource.name, 80, "Resource"),
        current: integer(resource.current, 0, 9999, 0),
        max: integer(resource.max, 0, 9999, 1),
        reset: cleanText(resource.reset, 40, "Manual"),
      };
    })),
    inventory: uniqueEntities(array(raw.inventory).slice(0, 250).map((value, index) => {
      const item = record(value);
      return {
        id: entityId(item.id, "item", index),
        name: cleanText(item.name, 160, "Unnamed item"),
        quantity: integer(item.quantity, 0, 99999, 1),
        weight: number(item.weight, 0, 99999, 0),
        category: cleanText(item.category, 40, "Gear"),
        equipped: item.equipped === true,
        notes: cleanText(item.notes, 1200, ""),
      };
    })),
    magicItemAttunement: attunement as [string, string, string],
    details: {
      classFeatures: cleanTextPreservingWhitespace(details.classFeatures, 12_000),
      speciesTraits: cleanTextPreservingWhitespace(details.speciesTraits, 8_000),
      feats: cleanTextPreservingWhitespace(details.feats, 8_000),
      armorTraining: {
        light: armorTraining.light === true,
        medium: armorTraining.medium === true,
        heavy: armorTraining.heavy === true,
        shields: armorTraining.shields === true,
      },
      weapons: cleanTextPreservingWhitespace(details.weapons, 4_000),
      tools: cleanTextPreservingWhitespace(details.tools, 4_000),
    },
    story: {
      appearance: cleanTextPreservingWhitespace(story.appearance, 8_000),
      backstory: cleanTextPreservingWhitespace(story.backstory, 12_000),
      personality: cleanTextPreservingWhitespace(story.personality, 8_000),
      languages: cleanTextPreservingWhitespace(story.languages, 4_000),
    },
    spellcasting: {
      ability: cleanOptionalText(spellcasting.ability, 30, fallback.spellcasting.ability),
      modifier: integer(spellcasting.modifier, -20, 50, fallback.spellcasting.modifier),
      saveDc: integer(spellcasting.saveDc, 0, 99, fallback.spellcasting.saveDc),
      attackBonus: integer(spellcasting.attackBonus, -20, 50, fallback.spellcasting.attackBonus),
      slots: Array.from({ length: 9 }, (_, index) => {
        const level = index + 1;
        const slot = array(spellcasting.slots).map(record).find((candidate) => candidate.level === level);
        const defaultSlot = fallback.spellcasting.slots[index];
        return {
          level,
          total: integer(slot?.total, 0, 99, defaultSlot.total),
          expended: integer(slot?.expended, 0, 99, defaultSlot.expended),
        };
      }),
      spells: uniqueEntities(array(spellcasting.spells).slice(0, 250).map((value, index) => {
        const spell = record(value);
        return {
          id: entityId(spell.id, "spell", index),
          level: integer(spell.level, 0, 9, 0),
          name: cleanText(spell.name, 120, "Unnamed spell"),
          ...(typeof spell.prepared === "boolean" ? { prepared: spell.prepared } : {}),
          castingTime: cleanText(spell.castingTime, 60, "1 action"),
          range: cleanText(spell.range, 60, "Self"),
          concentration: spell.concentration === true,
          ritual: spell.ritual === true,
          material: cleanText(spell.material, 400, ""),
          notes: cleanText(spell.notes, 1_200, ""),
        };
      })),
      ...(Array.isArray(spellcasting.profiles) ? {
        profiles: spellcasting.profiles.slice(0, 20).flatMap((value) => {
          const profile = record(value);
          const ability = abilityKeys.includes(profile.ability as AbilityKey) ? profile.ability as AbilityKey : null;
          if (!ability) return [];
          return [{
            className: cleanText(profile.className, 80, "Spellcasting"),
            ability,
            modifier: integer(profile.modifier, -20, 50, 0),
            saveDc: integer(profile.saveDc, 0, 99, 8),
            attackBonus: integer(profile.attackBonus, -20, 50, 0),
          }];
        }),
      } : {}),
    },
    coins: {
      cp: integer(rawCoins.cp, 0, 1_000_000_000, 0),
      sp: integer(rawCoins.sp, 0, 1_000_000_000, 0),
      ep: integer(rawCoins.ep, 0, 1_000_000_000, 0),
      gp: integer(rawCoins.gp, 0, 1_000_000_000, 0),
      pp: integer(rawCoins.pp, 0, 1_000_000_000, 0),
    },
    notes: normalizedNotes(raw.notes, fallback.notes),
    modules,
    strokes: normalizedStrokes(raw.strokes),
    creator: normalizedCreator(raw.creator),
  };
}

function normalizedCreator(value: unknown): CharacterCreatorMetadata | undefined {
  const creator = record(value);
  if (creator.schemaVersion !== 1) return undefined;
  const buildState = creator.buildState && typeof creator.buildState === "object" && !Array.isArray(creator.buildState)
    ? structuredClone(record(creator.buildState))
    : undefined;
  return {
    schemaVersion: 1,
    sourceArchiveSha256: cleanText(creator.sourceArchiveSha256, 80, ""),
    appliedReviewFingerprint: cleanText(creator.appliedReviewFingerprint, 80, ""),
    ...(buildState ? { buildState } : {}),
    managedAttackIds: array(creator.managedAttackIds).map((id) => cleanText(id, 80, "")).filter(Boolean).slice(0, 100),
    managedResourceIds: array(creator.managedResourceIds).map((id) => cleanText(id, 80, "")).filter(Boolean).slice(0, 100),
    managedInventoryIds: array(creator.managedInventoryIds).map((id) => cleanText(id, 80, "")).filter(Boolean).slice(0, 300),
    managedSpellIds: array(creator.managedSpellIds).map((id) => cleanText(id, 80, "")).filter(Boolean).slice(0, 300),
    managedGoldPieces: integer(creator.managedGoldPieces, 0, 1_000_000_000, 0),
    appliedAt: cleanText(creator.appliedAt, 80, ""),
  };
}

export function splitGoldPieces(amount: number, players: number) {
  const totalCopper = Math.max(0, Math.round((Number(amount) || 0) * 100));
  const divisor = Math.min(20, Math.max(1, Math.round(Number(players) || 1)));
  const shareCopper = Math.floor(totalCopper / divisor);
  return {
    gp: Math.floor(shareCopper / 100),
    sp: Math.floor((shareCopper % 100) / 10),
    cp: shareCopper % 10,
    remainderCp: totalCopper - shareCopper * divisor,
  };
}

function normalizedModules(
  value: unknown,
  fallback: SheetModuleLayout[],
  enforceCurrentMinimumHeights = false,
): SheetModuleLayout[] {
  const validIds = new Set<SheetModuleId>(moduleDefaults.map((module) => module.id));
  const seen = new Set<SheetModuleId>();
  const incoming = array(value).flatMap((entry) => {
    const moduleData = record(entry);
    const id = typeof moduleData.id === "string" && validIds.has(moduleData.id as SheetModuleId)
      ? moduleData.id as SheetModuleId
      : null;
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const base = fallback.find((candidate) => candidate.id === id)
      ?? moduleDefaults.find((candidate) => candidate.id === id)!;
    const currentDefault = moduleDefaults.find((candidate) => candidate.id === id)!;
    const height = integer(moduleData.height, 160, 720, base.height);
    return [{
      id,
      span: integer(moduleData.span, 4, 12, base.span),
      height: enforceCurrentMinimumHeights ? Math.max(height, currentDefault.height) : height,
    }];
  });
  return [
    ...incoming,
    ...moduleDefaults.filter((module) => !seen.has(module.id)).map((module) => ({ ...module })),
  ];
}

function hasBuiltInLayout(value: unknown): boolean {
  const entries = array(value).map(record);
  return [legacyModuleDefaults, migratedLegacyModuleDefaults, migratedCurrentLegacyModuleDefaults, previousModuleDefaults, moduleDefaults]
    .some((expected) => entries.length === expected.length && expected.every((moduleData, index) => {
      const candidate = entries[index];
      return candidate.id === moduleData.id && candidate.span === moduleData.span && candidate.height === moduleData.height;
    }));
}

function normalizedNotes(value: unknown, fallback: RichTextRun[]): RichTextRun[] {
  const runs = array(value).slice(0, 500).flatMap((entry) => {
    const run = record(entry);
    const text = cleanTextPreservingWhitespace(run.text, 4000);
    if (!text) return [];
    return [{
      text,
      ...(run.bold === true ? { bold: true as const } : {}),
      ...(run.italic === true ? { italic: true as const } : {}),
      ...(run.underline === true ? { underline: true as const } : {}),
    }];
  });
  return Array.isArray(value) ? runs : fallback.slice(0, 500).map((run) => ({ ...run }));
}

function normalizedStrokes(value: unknown): SheetInkStroke[] {
  return array(value).slice(0, 100).flatMap((entry, index) => {
    const stroke = record(entry);
    const points = array(stroke.points).slice(0, 500).flatMap((entry) => {
      const point = record(entry);
      return typeof point.x === "number" && Number.isFinite(point.x) &&
        typeof point.y === "number" && Number.isFinite(point.y)
        ? [{ x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) }]
        : [];
    });
    if (points.length < 2) return [];
    return [{
      id: entityId(stroke.id, "stroke", index),
      color: /^#[0-9a-fA-F]{6}$/.test(String(stroke.color)) ? String(stroke.color) : "#b3266e",
      width: number(stroke.width, 1, 12, 3),
      points,
    }];
  });
}

function uniqueEntities<T extends { id: string }>(entries: T[]): T[] {
  const ids = new Set<string>();
  return entries.map((entry) => {
    let id = entry.id;
    let suffix = 2;
    while (ids.has(id)) id = `${entry.id}-${suffix++}`;
    ids.add(id);
    return id === entry.id ? entry : { ...entry, id };
  });
}

function entityId(value: unknown, prefix: string, index: number): string {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 55);
  return slug.startsWith(`${prefix}-`) ? slug : `${prefix}-${slug || index + 1}`;
}

function featureRowsText(rows: Array<Record<string, unknown>>): string {
  return rows.map((feature) => {
    const name = cleanText(feature.name, 120, "Feature");
    const action = cleanText(feature.action, 80, "");
    const summary = cleanText(feature.summary, 1_200, "");
    return `${name}${action ? ` (${action})` : ""}${summary ? `: ${summary}` : ""}`;
  }).join("\n\n");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown, maximum: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().replace(/\s+/g, " ").slice(0, maximum);
  return clean || fallback;
}

function cleanOptionalText(value: unknown, maximum: number, fallback: string): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : fallback;
}

function cleanTextPreservingWhitespace(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/\r/g, "").slice(0, maximum) : "";
}

function integer(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback;
}

function number(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
