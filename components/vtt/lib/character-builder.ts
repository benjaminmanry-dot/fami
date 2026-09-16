import {
  abilityKeys,
  type AbilityKey,
  type CharacterSheet,
  skillDefinitions,
  type SkillId,
} from "./character-sheet.ts";

type Gear = { name: string; quantity?: number; category?: string };
export type BuilderChoiceOption = {
  value: string;
  label: string;
  description?: string;
};

export type BuilderFeatureChoice = {
  id: string;
  title: string;
  description: string;
  min: number;
  max: number;
  options: BuilderChoiceOption[];
};

export type BuilderClass = {
  name: string;
  hitDie: number;
  saves: AbilityKey[];
  skillCount: number;
  skills: SkillId[] | "any";
  armor: Array<keyof CharacterSheet["details"]["armorTraining"]>;
  weapons: string;
  features: string[];
  choices?: BuilderFeatureChoice[];
  recommended: Record<AbilityKey, number>;
  spellAbility?: AbilityKey;
  firstLevelSlots?: number;
  resources?: Array<{ name: string; max: number; reset: string }>;
  gear: Gear[];
  gp: number;
};

export type BuilderSpecies = {
  name: string;
  sizes: string[];
  speed: number;
  traits: string[];
  heritages?: string[];
  heritageLabel?: string;
  choices?: BuilderFeatureChoice[];
};

export type BuilderBackground = {
  name: string;
  abilities: AbilityKey[];
  skills: SkillId[];
  feat: string;
  tool: string;
  gear: Gear[];
  gp: number;
};

export type CharacterBuild = {
  name: string;
  className: string;
  species: string;
  heritage: string;
  background: string;
  size: string;
  baseScores: Record<AbilityKey, number>;
  boostMode: "2+1" | "1+1+1";
  boostTwo: AbilityKey;
  boostOne: AbilityKey;
  classSkills: SkillId[];
  languages: [string, string];
  featureChoices: Record<string, string[]>;
};

export const standardArray = [15, 14, 13, 12, 10, 8] as const;
export const standardLanguages = [
  "Common Sign Language", "Draconic", "Dwarvish", "Elvish", "Giant",
  "Gnomish", "Goblin", "Halfling", "Orc",
] as const;
export const builderBackgroundBoostMethods = [
  { value: "2+1", label: "+2 and +1", dependentFields: ["boostTwo", "boostOne"] },
  { value: "1+1+1", label: "+1 to all three", dependentFields: [] },
] as const satisfies readonly {
  readonly value: CharacterBuild["boostMode"];
  readonly label: string;
  readonly dependentFields: readonly ("boostTwo" | "boostOne")[];
}[];
export type BuilderBackgroundBoostMethod = (typeof builderBackgroundBoostMethods)[number];

const allSkillIds = skillDefinitions.map(({ id }) => id) as SkillId[];

const weaponMasteryOptions = masteryOptions(
  ["Battleaxe", "Topple"], ["Blowgun", "Vex"], ["Club", "Slow"], ["Dagger", "Nick"],
  ["Dart", "Vex"], ["Flail", "Sap"], ["Glaive", "Graze"], ["Greataxe", "Cleave"],
  ["Greatclub", "Push"], ["Greatsword", "Graze"], ["Halberd", "Cleave"], ["Hand Crossbow", "Vex"],
  ["Handaxe", "Vex"], ["Heavy Crossbow", "Push"], ["Javelin", "Slow"], ["Lance", "Topple"],
  ["Light Crossbow", "Slow"], ["Light Hammer", "Nick"], ["Longbow", "Slow"], ["Longsword", "Sap"],
  ["Mace", "Sap"], ["Maul", "Topple"], ["Morningstar", "Sap"], ["Musket", "Slow"],
  ["Pike", "Push"], ["Pistol", "Vex"], ["Quarterstaff", "Topple"], ["Rapier", "Vex"],
  ["Scimitar", "Nick"], ["Shortbow", "Vex"], ["Shortsword", "Vex"], ["Sickle", "Nick"],
  ["Sling", "Slow"], ["Spear", "Sap"], ["Trident", "Topple"], ["War Pick", "Sap"],
  ["Warhammer", "Push"], ["Whip", "Slow"],
);

const rogueWeaponNames = new Set([
  "Club", "Dagger", "Dart", "Greatclub", "Hand Crossbow", "Handaxe", "Javelin",
  "Light Crossbow", "Light Hammer", "Mace", "Quarterstaff", "Rapier", "Scimitar",
  "Shortbow", "Shortsword", "Sickle", "Sling", "Spear", "Whip",
]);
const rogueWeaponMasteryOptions = weaponMasteryOptions.filter(({ value }) => rogueWeaponNames.has(value));

const fightingStyleOptions = namedOptions(
  ["Archery", "Specialize in ranged-weapon accuracy."],
  ["Blind Fighting", "Fight effectively against creatures you cannot see nearby."],
  ["Defense", "Improve your protection while wearing armor."],
  ["Dueling", "Specialize in a single one-handed melee weapon."],
  ["Great Weapon Fighting", "Make heavy two-handed attacks more dependable."],
  ["Interception", "Reduce damage dealt to a nearby ally."],
  ["Protection", "Use a shield to protect a nearby ally."],
  ["Thrown Weapon Fighting", "Specialize in weapons with the Thrown property."],
  ["Two-Weapon Fighting", "Improve attacks made with a second Light weapon."],
  ["Unarmed Fighting", "Improve unarmed strikes and close-quarters grappling."],
);

const originFeatOptions = namedOptions(
  ["Alert", "React quickly when combat begins."],
  ["Crafter", "Gain practical crafting training and discounts."],
  ["Healer", "Improve healing with kits and magic."],
  ["Lucky", "Turn a few crucial rolls in your favor."],
  ["Magic Initiate (Cleric)", "Learn a small selection of Cleric magic."],
  ["Magic Initiate (Druid)", "Learn a small selection of Druid magic."],
  ["Magic Initiate (Wizard)", "Learn a small selection of Wizard magic."],
  ["Musician", "Inspire allies after a rest."],
  ["Savage Attacker", "Make weapon damage more reliable."],
  ["Skilled", "Gain three skill or tool proficiencies."],
  ["Tavern Brawler", "Improve unarmed strikes and improvised fighting."],
  ["Tough", "Gain additional Hit Points as you level."],
);

const warlockInvocationOptions = namedOptions(
  ["Armor of Shadows", "Cast Mage Armor on yourself without spending a spell slot."],
  ["Eldritch Mind", "Bolster concentration on your spells."],
  ["Pact of the Blade", "Conjure or bond with a pact weapon."],
  ["Pact of the Chain", "Learn Find Familiar and call a special familiar."],
  ["Pact of the Tome", "Gain a Book of Shadows and additional cantrips."],
);

const expertiseOptions = [
  ...skillDefinitions.map(({ id, label }) => ({ value: id, label })),
  { value: "thieves-tools", label: "Thieves' Tools" },
];

const extraSkillOptions = skillDefinitions.map(({ id, label }) => ({ value: id, label }));

const divineOrderChoice: BuilderFeatureChoice = {
  id: "cleric-divine-order",
  title: "Divine Order",
  description: "Choose how your Cleric serves at level 1.",
  min: 1,
  max: 1,
  options: namedOptions(
    ["Protector", "Gain Martial weapon and Heavy armor training."],
    ["Thaumaturge", "Gain an extra Cleric cantrip and stronger religious scholarship."],
  ),
};

const primalOrderChoice: BuilderFeatureChoice = {
  id: "druid-primal-order",
  title: "Primal Order",
  description: "Choose how your Druid channels primal magic at level 1.",
  min: 1,
  max: 1,
  options: namedOptions(
    ["Magician", "Gain an extra Druid cantrip and stronger natural scholarship."],
    ["Warden", "Gain Martial weapon and Medium armor training."],
  ),
};

// Approved personal-use 2024 corpus, reduced to the fields this level-1 builder uses.
export const builderClasses: BuilderClass[] = [
  {
    name: "Barbarian", hitDie: 12, saves: ["str", "con"], skillCount: 2,
    skills: ["animal-handling", "athletics", "intimidation", "nature", "perception", "survival"],
    armor: ["light", "medium", "shields"], weapons: "Simple and martial weapons",
    features: ["Rage", "Unarmored Defense", "Weapon Mastery (choose 2 weapons)"],
    choices: [weaponMasteryChoice("barbarian-weapon-mastery", 2)],
    recommended: scores(15, 13, 14, 8, 12, 10), resources: [{ name: "Rage", max: 2, reset: "Long rest" }],
    gear: gear(["Greataxe", 1, "Weapon"], ["Handaxe", 4, "Weapon"], ["Explorer's Pack", 1, "Gear"]), gp: 15,
  },
  {
    name: "Bard", hitDie: 8, saves: ["dex", "cha"], skillCount: 3, skills: "any",
    armor: ["light"], weapons: "Simple weapons", features: ["Bardic Inspiration", "Spellcasting"],
    recommended: scores(8, 14, 13, 10, 12, 15), spellAbility: "cha", firstLevelSlots: 2,
    gear: gear(["Leather Armor", 1, "Armor"], ["Dagger", 2, "Weapon"], ["Musical Instrument", 1, "Tool"], ["Entertainer's Pack", 1, "Gear"]), gp: 19,
  },
  {
    name: "Cleric", hitDie: 8, saves: ["wis", "cha"], skillCount: 2,
    skills: ["history", "insight", "medicine", "persuasion", "religion"],
    armor: ["light", "medium", "shields"], weapons: "Simple weapons",
    features: ["Divine Order (choose Protector or Thaumaturge)", "Spellcasting"],
    choices: [divineOrderChoice],
    recommended: scores(13, 12, 14, 8, 15, 10), spellAbility: "wis", firstLevelSlots: 2,
    gear: gear(["Chain Shirt", 1, "Armor"], ["Shield", 1, "Armor"], ["Mace", 1, "Weapon"], ["Holy Symbol", 1, "Gear"], ["Priest's Pack", 1, "Gear"]), gp: 70,
  },
  {
    name: "Druid", hitDie: 8, saves: ["int", "wis"], skillCount: 2,
    skills: ["arcana", "animal-handling", "insight", "medicine", "nature", "perception", "religion", "survival"],
    armor: ["light", "shields"], weapons: "Simple weapons",
    features: ["Druidic", "Primal Order (choose Magician or Warden)", "Spellcasting"],
    choices: [primalOrderChoice],
    recommended: scores(8, 13, 14, 12, 15, 10), spellAbility: "wis", firstLevelSlots: 2,
    gear: gear(["Leather Armor", 1, "Armor"], ["Shield", 1, "Armor"], ["Sickle", 1, "Weapon"], ["Druidic Focus", 1, "Gear"], ["Explorer's Pack", 1, "Gear"], ["Herbalism Kit", 1, "Tool"]), gp: 9,
  },
  {
    name: "Fighter", hitDie: 10, saves: ["str", "con"], skillCount: 2,
    skills: ["acrobatics", "animal-handling", "athletics", "history", "insight", "intimidation", "persuasion", "perception", "survival"],
    armor: ["light", "medium", "heavy", "shields"], weapons: "Simple and martial weapons",
    features: ["Fighting Style (choose one)", "Second Wind", "Weapon Mastery (choose 3 weapons)"],
    choices: [
      {
        id: "fighter-fighting-style",
        title: "Fighting Style",
        description: "Choose the martial specialty your Fighter learned at level 1.",
        min: 1,
        max: 1,
        options: fightingStyleOptions,
      },
      weaponMasteryChoice("fighter-weapon-mastery", 3),
    ],
    recommended: scores(15, 13, 14, 8, 12, 10), resources: [{ name: "Second Wind", max: 2, reset: "Short or long rest" }],
    gear: gear(["Chain Mail", 1, "Armor"], ["Greatsword", 1, "Weapon"], ["Flail", 1, "Weapon"], ["Javelin", 8, "Weapon"], ["Dungeoneer's Pack", 1, "Gear"]), gp: 4,
  },
  {
    name: "Monk", hitDie: 8, saves: ["str", "dex"], skillCount: 2,
    skills: ["acrobatics", "athletics", "history", "insight", "religion", "stealth"],
    armor: [], weapons: "Simple weapons and light martial weapons", features: ["Martial Arts"],
    recommended: scores(12, 15, 13, 10, 14, 8),
    gear: gear(["Spear", 1, "Weapon"], ["Dagger", 5, "Weapon"], ["Explorer's Pack", 1, "Gear"]), gp: 11,
  },
  {
    name: "Paladin", hitDie: 10, saves: ["wis", "cha"], skillCount: 2,
    skills: ["athletics", "insight", "intimidation", "medicine", "persuasion", "religion"],
    armor: ["light", "medium", "heavy", "shields"], weapons: "Simple and martial weapons",
    features: ["Lay on Hands", "Spellcasting", "Weapon Mastery (choose 2 weapons)"],
    choices: [weaponMasteryChoice("paladin-weapon-mastery", 2)],
    recommended: scores(15, 10, 13, 8, 12, 14), spellAbility: "cha", firstLevelSlots: 2,
    resources: [{ name: "Lay on Hands", max: 5, reset: "Long rest" }],
    gear: gear(["Chain Mail", 1, "Armor"], ["Shield", 1, "Armor"], ["Longsword", 1, "Weapon"], ["Javelin", 6, "Weapon"], ["Holy Symbol", 1, "Gear"], ["Priest's Pack", 1, "Gear"]), gp: 9,
  },
  {
    name: "Ranger", hitDie: 10, saves: ["str", "dex"], skillCount: 3,
    skills: ["animal-handling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"],
    armor: ["light", "medium", "shields"], weapons: "Simple and martial weapons",
    features: ["Favored Enemy", "Spellcasting", "Weapon Mastery (choose 2 weapons)"],
    choices: [weaponMasteryChoice("ranger-weapon-mastery", 2)],
    recommended: scores(12, 15, 13, 10, 14, 8), spellAbility: "wis", firstLevelSlots: 2,
    gear: gear(["Studded Leather Armor", 1, "Armor"], ["Scimitar", 1, "Weapon"], ["Shortsword", 1, "Weapon"], ["Longbow", 1, "Weapon"], ["Arrows", 20, "Ammunition"], ["Quiver", 1, "Gear"], ["Explorer's Pack", 1, "Gear"]), gp: 7,
  },
  {
    name: "Rogue", hitDie: 8, saves: ["dex", "int"], skillCount: 4,
    skills: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "persuasion", "sleight-of-hand", "stealth"],
    armor: ["light"], weapons: "Simple weapons and finesse or light martial weapons",
    features: ["Expertise (choose 2 proficiencies)", "Sneak Attack", "Thieves' Cant", "Weapon Mastery (choose 2 weapons)"],
    choices: [
      {
        id: "rogue-expertise",
        title: "Expertise",
        description: "Choose two skill proficiencies, or one skill and Thieves' Tools.",
        min: 2,
        max: 2,
        options: expertiseOptions,
      },
      weaponMasteryChoice("rogue-weapon-mastery", 2, rogueWeaponMasteryOptions),
    ],
    recommended: scores(8, 15, 14, 10, 13, 12),
    gear: gear(["Leather Armor", 1, "Armor"], ["Dagger", 2, "Weapon"], ["Shortsword", 1, "Weapon"], ["Shortbow", 1, "Weapon"], ["Arrows", 20, "Ammunition"], ["Quiver", 1, "Gear"], ["Thieves' Tools", 1, "Tool"], ["Burglar's Pack", 1, "Gear"]), gp: 8,
  },
  {
    name: "Sorcerer", hitDie: 6, saves: ["con", "cha"], skillCount: 2,
    skills: ["arcana", "deception", "insight", "intimidation", "persuasion", "religion"],
    armor: [], weapons: "Simple weapons", features: ["Innate Sorcery", "Spellcasting"],
    recommended: scores(8, 13, 14, 10, 12, 15), spellAbility: "cha", firstLevelSlots: 2,
    resources: [{ name: "Innate Sorcery", max: 2, reset: "Long rest" }],
    gear: gear(["Spear", 1, "Weapon"], ["Dagger", 2, "Weapon"], ["Crystal", 1, "Arcane Focus"], ["Dungeoneer's Pack", 1, "Gear"]), gp: 28,
  },
  {
    name: "Warlock", hitDie: 8, saves: ["wis", "cha"], skillCount: 2,
    skills: ["arcana", "deception", "history", "intimidation", "investigation", "nature", "religion"],
    armor: ["light"], weapons: "Simple weapons", features: ["Eldritch Invocations (choose one)", "Pact Magic"],
    choices: [{
      id: "warlock-invocation",
      title: "Eldritch Invocation",
      description: "Choose an invocation available to a level-one Warlock.",
      min: 1,
      max: 1,
      options: warlockInvocationOptions,
    }],
    recommended: scores(8, 13, 14, 10, 12, 15), spellAbility: "cha", firstLevelSlots: 1,
    gear: gear(["Leather Armor", 1, "Armor"], ["Sickle", 1, "Weapon"], ["Dagger", 2, "Weapon"], ["Orb", 1, "Arcane Focus"], ["Book", 1, "Gear"], ["Scholar's Pack", 1, "Gear"]), gp: 15,
  },
  {
    name: "Wizard", hitDie: 6, saves: ["int", "wis"], skillCount: 2,
    skills: ["arcana", "history", "insight", "investigation", "medicine", "nature", "religion"],
    armor: [], weapons: "Simple weapons", features: ["Arcane Recovery", "Ritual Adept", "Spellcasting"],
    recommended: scores(8, 13, 14, 15, 12, 10), spellAbility: "int", firstLevelSlots: 2,
    gear: gear(["Dagger", 2, "Weapon"], ["Quarterstaff", 1, "Weapon"], ["Robe", 1, "Clothing"], ["Scholar's Pack", 1, "Gear"]), gp: 5,
  },
];

export const builderSpecies: BuilderSpecies[] = [
  { name: "Aasimar", sizes: ["Small", "Medium"], speed: 30, traits: ["Celestial Resistance", "Darkvision", "Healing Hands", "Light Bearer", "Celestial Revelation at level 3"] },
  { name: "Dragonborn", sizes: ["Medium"], speed: 30, traits: ["Draconic Ancestry", "Breath Weapon", "Damage Resistance", "Darkvision", "Draconic Flight at level 5"], heritages: ["Black (Acid)", "Blue (Lightning)", "Brass (Fire)", "Bronze (Lightning)", "Copper (Acid)", "Gold (Fire)", "Green (Poison)", "Red (Fire)", "Silver (Cold)", "White (Cold)"], heritageLabel: "Draconic ancestry" },
  { name: "Dwarf", sizes: ["Medium"], speed: 30, traits: ["Darkvision", "Dwarven Resilience", "Dwarven Toughness", "Stonecunning"] },
  {
    name: "Elf", sizes: ["Medium"], speed: 30,
    traits: ["Darkvision", "Elven Lineage", "Fey Ancestry", "Keen Senses (choose a skill)", "Trance"],
    heritages: ["Drow", "High Elf", "Wood Elf"], heritageLabel: "Elven lineage",
    choices: [{
      id: "elf-keen-senses",
      title: "Keen Senses",
      description: "Gain proficiency in one perceptive skill you do not already have.",
      min: 1,
      max: 1,
      options: extraSkillOptions.filter(({ value }) => ["insight", "perception", "survival"].includes(value)),
    }],
  },
  { name: "Gnome", sizes: ["Small"], speed: 30, traits: ["Darkvision", "Gnomish Cunning", "Gnomish Lineage"], heritages: ["Forest Gnome", "Rock Gnome"], heritageLabel: "Gnomish lineage" },
  { name: "Goliath", sizes: ["Medium"], speed: 35, traits: ["Giant Ancestry", "Large Form at level 5", "Powerful Build"], heritages: ["Cloud Giant", "Fire Giant", "Frost Giant", "Hill Giant", "Stone Giant", "Storm Giant"], heritageLabel: "Giant ancestry" },
  { name: "Halfling", sizes: ["Small"], speed: 30, traits: ["Brave", "Halfling Nimbleness", "Luck", "Naturally Stealthy"] },
  {
    name: "Human", sizes: ["Small", "Medium"], speed: 30,
    traits: ["Resourceful", "Skillful (choose one additional skill)", "Versatile (choose another Origin feat)"],
    choices: [
      {
        id: "human-skillful",
        title: "Skillful",
        description: "Gain one skill proficiency you do not already have.",
        min: 1,
        max: 1,
        options: extraSkillOptions,
      },
      {
        id: "human-origin-feat",
        title: "Versatile",
        description: "Choose an Origin feat different from the one your background grants.",
        min: 1,
        max: 1,
        options: originFeatOptions,
      },
    ],
  },
  { name: "Orc", sizes: ["Medium"], speed: 30, traits: ["Adrenaline Rush", "Darkvision", "Relentless Endurance"] },
  { name: "Tiefling", sizes: ["Small", "Medium"], speed: 30, traits: ["Darkvision", "Fiendish Legacy", "Otherworldly Presence"], heritages: ["Abyssal", "Chthonic", "Infernal"], heritageLabel: "Fiendish legacy" },
];

export const builderBackgrounds: BuilderBackground[] = [
  { name: "Acolyte", abilities: ["int", "wis", "cha"], skills: ["insight", "religion"], feat: "Magic Initiate (Cleric)", tool: "Calligrapher's Supplies", gear: gear(["Book of Prayers", 1, "Gear"], ["Calligrapher's Supplies", 1, "Tool"], ["Holy Symbol", 1, "Gear"], ["Parchment", 10, "Gear"], ["Robe", 1, "Clothing"]), gp: 8 },
  { name: "Criminal", abilities: ["dex", "con", "int"], skills: ["sleight-of-hand", "stealth"], feat: "Alert", tool: "Thieves' Tools", gear: gear(["Dagger", 2, "Weapon"], ["Thieves' Tools", 1, "Tool"], ["Crowbar", 1, "Gear"], ["Pouch", 2, "Gear"], ["Traveler's Clothes", 1, "Clothing"]), gp: 16 },
  { name: "Sage", abilities: ["con", "int", "wis"], skills: ["arcana", "history"], feat: "Magic Initiate (Wizard)", tool: "Calligrapher's Supplies", gear: gear(["Quarterstaff", 1, "Weapon"], ["Calligrapher's Supplies", 1, "Tool"], ["Book", 1, "Gear"], ["Parchment", 8, "Gear"], ["Robe", 1, "Clothing"]), gp: 8 },
  { name: "Soldier", abilities: ["str", "dex", "con"], skills: ["athletics", "intimidation"], feat: "Savage Attacker", tool: "Gaming Set", gear: gear(["Spear", 1, "Weapon"], ["Shortbow", 1, "Weapon"], ["Arrows", 20, "Ammunition"], ["Gaming Set", 1, "Tool"], ["Healer's Kit", 1, "Gear"], ["Quiver", 1, "Gear"], ["Traveler's Clothes", 1, "Clothing"]), gp: 14 },
];

export function createCharacterBuild(sheet: CharacterSheet): CharacterBuild {
  const classData = find(builderClasses, sheet.identity.className, "Fighter");
  const background = find(builderBackgrounds, sheet.identity.background, "Soldier");
  const species = find(builderSpecies, sheet.identity.species.split(" (")[0], "Human");
  const availableSkills = classSkillChoices(classData, background);
  const boostOrder = abilityKeys
    .filter((key) => background.abilities.includes(key))
    .sort((a, b) => classData.recommended[b] - classData.recommended[a]);
  const savedLanguages = sheet.story.languages.split(/[,;\n]/)
    .map((language) => language.trim())
    .filter((language): language is typeof standardLanguages[number] => standardLanguages.includes(language as typeof standardLanguages[number]));
  const languages = [...new Set(savedLanguages)];
  for (const language of standardLanguages) if (languages.length < 2 && !languages.includes(language)) languages.push(language);

  return reconcileFeatureChoices({
    name: sheet.name,
    className: classData.name,
    species: species.name,
    heritage: species.heritages?.[0] ?? "",
    background: background.name,
    size: species.sizes.includes(sheet.vitals.size) ? sheet.vitals.size : species.sizes[species.sizes.length - 1],
    baseScores: { ...classData.recommended },
    boostMode: "2+1",
    boostTwo: boostOrder[0],
    boostOne: boostOrder[1],
    classSkills: availableSkills.slice(0, classData.skillCount),
    languages: [languages[0], languages[1]],
    featureChoices: {},
  });
}

export function classSkillChoices(classData: BuilderClass, background: BuilderBackground): SkillId[] {
  const choices = classData.skills === "any" ? allSkillIds : classData.skills;
  return choices.filter((skill) => !background.skills.includes(skill));
}

export function featureChoicesForBuild(build: CharacterBuild): BuilderFeatureChoice[] {
  const classData = builderClasses.find(({ name }) => name === build.className);
  const species = builderSpecies.find(({ name }) => name === build.species);
  const background = builderBackgrounds.find(({ name }) => name === build.background);
  if (!classData || !species || !background) return [];

  const proficientSkills = new Set<SkillId>([...background.skills, ...build.classSkills]);
  const speciesChoices = (species.choices ?? []).map((choice) => {
    if (choice.id === "human-skillful" || choice.id === "elf-keen-senses") {
      return { ...choice, options: choice.options.filter(({ value }) => !proficientSkills.has(value as SkillId)) };
    }
    if (choice.id === "human-origin-feat") {
      return { ...choice, options: choice.options.filter(({ label }) => label !== background.feat) };
    }
    return choice;
  });

  for (const choice of speciesChoices) {
    if (choice.id !== "human-skillful" && choice.id !== "elf-keen-senses") continue;
    const selected = (build.featureChoices?.[choice.id] ?? []).find((value) => choice.options.some((option) => option.value === value));
    const skill = selected ?? choice.options[0]?.value;
    if (skill) proficientSkills.add(skill as SkillId);
  }

  const classChoices = (classData.choices ?? []).map((choice) => {
    if (choice.id !== "rogue-expertise") return choice;
    return {
      ...choice,
      options: expertiseOptions.filter(({ value }) => value === "thieves-tools" || proficientSkills.has(value as SkillId)),
    };
  });

  return [...classChoices, ...speciesChoices];
}

export function reconcileFeatureChoices(build: CharacterBuild): CharacterBuild {
  const next: Record<string, string[]> = {};
  for (const choice of featureChoicesForBuild(build)) {
    const validValues = new Set(choice.options.map(({ value }) => value));
    const selected = [...new Set(build.featureChoices?.[choice.id] ?? [])]
      .filter((value) => validValues.has(value))
      .slice(0, choice.max);
    for (const option of choice.options) {
      if (selected.length >= choice.min) break;
      if (!selected.includes(option.value)) selected.push(option.value);
    }
    next[choice.id] = selected;
  }
  return { ...build, featureChoices: next };
}

export function validateCharacterBuild(build: CharacterBuild): string[] {
  const errors: string[] = [];
  const classData = builderClasses.find(({ name }) => name === build.className);
  const species = builderSpecies.find(({ name }) => name === build.species);
  const background = builderBackgrounds.find(({ name }) => name === build.background);
  if (!build.name.trim()) errors.push("Enter a character name.");
  if (!classData || !species || !background) return [...errors, "Choose a valid class, species, and background."];
  if (!species.sizes.includes(build.size)) errors.push("Choose a valid size.");
  if (species.heritages && !species.heritages.includes(build.heritage)) errors.push("Choose a lineage or legacy.");
  if (!build.languages[0] || !build.languages[1] || build.languages[0] === build.languages[1]) errors.push("Choose two different languages.");
  if (abilityKeys.map((key) => build.baseScores[key]).sort((a, b) => b - a).join(",") !== standardArray.join(",")) errors.push("Assign each Standard Array score once.");
  if (!background.abilities.includes(build.boostTwo) || !background.abilities.includes(build.boostOne) || (build.boostMode === "2+1" && build.boostTwo === build.boostOne)) errors.push("Choose valid background ability boosts.");
  const allowedSkills = classSkillChoices(classData, background);
  if (new Set(build.classSkills).size !== classData.skillCount || build.classSkills.some((skill) => !allowedSkills.includes(skill))) errors.push(`Choose ${classData.skillCount} class skills.`);
  for (const choice of featureChoicesForBuild(build)) {
    const selected = build.featureChoices?.[choice.id] ?? [];
    const allowed = new Set(choice.options.map(({ value }) => value));
    const invalid = selected.some((value) => !allowed.has(value));
    if (selected.length < choice.min || selected.length > choice.max || new Set(selected).size !== selected.length || invalid) {
      errors.push(choiceError(choice));
    }
  }
  return errors;
}

export function applyCharacterBuild(sheet: CharacterSheet, build: CharacterBuild): CharacterSheet {
  const errors = validateCharacterBuild(build);
  if (errors.length) throw new Error(errors[0]);
  const classData = builderClasses.find(({ name }) => name === build.className)!;
  const species = builderSpecies.find(({ name }) => name === build.species)!;
  const background = builderBackgrounds.find(({ name }) => name === build.background)!;
  const scoresWithBoosts = { ...build.baseScores };
  if (build.boostMode === "1+1+1") {
    for (const key of background.abilities) scoresWithBoosts[key] += 1;
  } else {
    scoresWithBoosts[build.boostTwo] += 2;
    scoresWithBoosts[build.boostOne] += 1;
  }
  const modifiers = Object.fromEntries(abilityKeys.map((key) => [key, abilityModifier(scoresWithBoosts[key])])) as Record<AbilityKey, number>;
  const allChoices = featureChoicesForBuild(build);
  const speciesSkillChoices = ["elf-keen-senses", "human-skillful"]
    .flatMap((id) => build.featureChoices[id] ?? [])
    .filter(isSkillId);
  const proficientSkills = new Set<SkillId>([...background.skills, ...build.classSkills, ...speciesSkillChoices]);
  const expertiseSkills = new Set((build.featureChoices["rogue-expertise"] ?? []).filter(isSkillId));
  const classChoiceSummaries = featureSummaries(classData.choices ?? [], allChoices, build);
  const speciesChoiceSummaries = featureSummaries(species.choices ?? [], allChoices, build);
  const weaponMasteries = (classData.choices ?? [])
    .filter(({ id }) => id.endsWith("-weapon-mastery"))
    .flatMap((choice) => choiceLabels(choice.id, allChoices, build));
  const divineOrder = build.featureChoices["cleric-divine-order"]?.[0];
  const primalOrder = build.featureChoices["druid-primal-order"]?.[0];
  const protector = classData.name === "Cleric" && divineOrder === "Protector";
  const warden = classData.name === "Druid" && primalOrder === "Warden";
  const humanFeat = choiceLabels("human-origin-feat", allChoices, build)[0];
  const proficiency = 2;
  const inventory = [...classData.gear, ...background.gear].map((item, index) => ({
    id: `item-builder-${index}-${slug(item.name)}`,
    name: item.name,
    quantity: item.quantity ?? 1,
    weight: 0,
    category: item.category ?? "Gear",
    equipped: item.category === "Armor",
    notes: "2024 starting equipment",
  }));
  const fullSpecies = build.heritage ? `${species.name} (${build.heritage})` : species.name;
  const spellModifier = classData.spellAbility ? modifiers[classData.spellAbility] : 0;

  return {
    ...sheet,
    name: build.name.trim(),
    subtitle: `Level 1 ${classData.name} \u00b7 ${fullSpecies} \u00b7 ${background.name}`,
    identity: { ...sheet.identity, background: background.name, className: classData.name, species: fullSpecies, subclass: "", level: 1, xp: 0 },
    vitals: {
      ...sheet.vitals,
      armorClass: startingArmorClass(classData.name, modifiers),
      shieldBonus: classData.gear.some(({ name }) => name === "Shield") ? 2 : 0,
      hpCurrent: Math.max(1, classData.hitDie + modifiers.con),
      hpMax: Math.max(1, classData.hitDie + modifiers.con),
      tempHp: 0,
      initiative: modifiers.dex,
      speed: species.speed,
      proficiency,
      size: build.size,
      hitDie: `d${classData.hitDie}`,
      hitDiceSpent: 0,
      hitDiceMax: 1,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
    },
    passive: { label: "Perception", bonus: modifiers.wis + (proficientSkills.has("perception") ? proficiency : 0) + (expertiseSkills.has("perception") ? proficiency : 0) },
    abilities: Object.fromEntries(abilityKeys.map((key) => [key, {
      ...sheet.abilities[key],
      score: scoresWithBoosts[key],
      save: modifiers[key] + (classData.saves.includes(key) ? proficiency : 0),
      proficient: classData.saves.includes(key),
    }])) as CharacterSheet["abilities"],
    skills: Object.fromEntries(skillDefinitions.map(({ id, ability }) => [id, {
      bonus: modifiers[ability] + (proficientSkills.has(id) ? proficiency : 0) + (expertiseSkills.has(id) ? proficiency : 0),
      proficient: proficientSkills.has(id),
    }])) as CharacterSheet["skills"],
    attacks: [],
    resources: (classData.resources ?? []).map((resource, index) => ({ id: `resource-builder-${index}`, current: resource.max, ...resource })),
    inventory,
    magicItemAttunement: ["", "", ""],
    details: {
      classFeatures: [...withoutChoicePrompts(classData.features, classData.choices ?? []), ...classChoiceSummaries].join("\n"),
      speciesTraits: [...withoutChoicePrompts(species.traits, species.choices ?? []), ...(build.heritage ? [`${species.heritageLabel ?? "Heritage"}: ${build.heritage}`] : []), ...speciesChoiceSummaries].join("\n"),
      feats: [background.feat, humanFeat].filter(Boolean).join("\n"),
      armorTraining: {
        light: classData.armor.includes("light"),
        medium: classData.armor.includes("medium") || warden,
        heavy: classData.armor.includes("heavy") || protector,
        shields: classData.armor.includes("shields"),
      },
      weapons: [protector || warden ? "Simple and martial weapons" : classData.weapons, weaponMasteries.length ? `Weapon Mastery: ${weaponMasteries.join(", ")}` : ""].filter(Boolean).join("\n"),
      tools: toolProficiencies(classData.name, background.tool, build).join("\n"),
    },
    story: { ...sheet.story, languages: ["Common", ...build.languages].join(", ") },
    spellcasting: {
      ability: classData.spellAbility ? sheet.abilities[classData.spellAbility].label : "",
      modifier: spellModifier,
      saveDc: classData.spellAbility ? 8 + proficiency + spellModifier : 0,
      attackBonus: classData.spellAbility ? proficiency + spellModifier : 0,
      slots: sheet.spellcasting.slots.map((slot) => ({ ...slot, total: slot.level === 1 ? classData.firstLevelSlots ?? 0 : 0, expended: 0 })),
      spells: [],
    },
    coins: { cp: 0, sp: 0, ep: 0, gp: classData.gp + background.gp, pp: 0 },
  };
}

function weaponMasteryChoice(id: string, count: number, options = weaponMasteryOptions): BuilderFeatureChoice {
  return {
    id,
    title: "Weapon Mastery",
    description: `Choose ${count} weapons whose mastery properties you can use at level 1.`,
    min: count,
    max: count,
    options,
  };
}

function masteryOptions(...items: Array<[string, string]>): BuilderChoiceOption[] {
  return items.map(([name, mastery]) => ({ value: name, label: name, description: `${mastery} mastery` }));
}

function namedOptions(...items: Array<[string, string]>): BuilderChoiceOption[] {
  return items.map(([name, description]) => ({ value: name, label: name, description }));
}

function choiceError(choice: BuilderFeatureChoice): string {
  if (choice.min === 1 && choice.max === 1) return `Choose one ${choice.title} option.`;
  if (choice.min === choice.max) return `Choose ${choice.min} ${choice.title} options.`;
  return `Choose ${choice.min}-${choice.max} ${choice.title} options.`;
}

function choiceLabels(id: string, activeChoices: BuilderFeatureChoice[], build: CharacterBuild): string[] {
  const choice = activeChoices.find((option) => option.id === id);
  if (!choice) return [];
  return (build.featureChoices[id] ?? []).map((value) => choice.options.find((option) => option.value === value)?.label ?? value);
}

function featureSummaries(definitions: BuilderFeatureChoice[], activeChoices: BuilderFeatureChoice[], build: CharacterBuild): string[] {
  return definitions.map(({ id, title }) => `${title}: ${choiceLabels(id, activeChoices, build).join(", ")}`);
}

function withoutChoicePrompts(features: string[], choices: BuilderFeatureChoice[]): string[] {
  return features.filter((feature) => !choices.some(({ title }) => feature.toLowerCase().startsWith(title.toLowerCase())));
}

function toolProficiencies(className: string, backgroundTool: string, build: CharacterBuild): string[] {
  if (className !== "Rogue") return [backgroundTool];
  const hasExpertise = build.featureChoices["rogue-expertise"]?.includes("thieves-tools");
  const thievesTools = hasExpertise ? "Thieves' Tools (Expertise)" : "Thieves' Tools";
  return backgroundTool === "Thieves' Tools" ? [thievesTools] : [backgroundTool, thievesTools];
}

function isSkillId(value: string): value is SkillId {
  return allSkillIds.includes(value as SkillId);
}

function scores(str: number, dex: number, con: number, int: number, wis: number, cha: number): Record<AbilityKey, number> {
  return { str, dex, con, int, wis, cha };
}

function gear(...items: Array<[string, number, string]>): Gear[] {
  return items.map(([name, quantity, category]) => ({ name, quantity, category }));
}

function find<T extends { name: string }>(options: T[], name: string, fallback: string): T {
  return options.find((option) => option.name === name) ?? options.find((option) => option.name === fallback)!;
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function startingArmorClass(className: string, modifiers: Record<AbilityKey, number>): number {
  switch (className) {
    case "Barbarian": return 10 + modifiers.dex + modifiers.con;
    case "Bard": case "Rogue": case "Warlock": return 11 + modifiers.dex;
    case "Cleric": return 15 + Math.min(2, modifiers.dex);
    case "Druid": return 13 + modifiers.dex;
    case "Fighter": return 16;
    case "Monk": return 10 + modifiers.dex + modifiers.wis;
    case "Paladin": return 18;
    case "Ranger": return 12 + modifiers.dex;
    default: return 10 + modifiers.dex;
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
