import rawCatalogue from "../data/character-catalogue.json" with { type: "json" };
import type { AbilityKey, SkillId } from "./character-sheet.ts";

export type CatalogueEquipmentItem = {
  id: string;
  name: string;
  quantity: number;
  source: string;
  prompt: string;
};

export type CatalogueEquipmentChoice = {
  id: string;
  label: string;
  gp: number;
  items: CatalogueEquipmentItem[];
};

export type CatalogueTraining = {
  armor: string[];
  weapons: string[];
  tools: string[];
  toolChoices: CatalogueToolChoice[];
  skills: { count: number; from: SkillId[] | "any" };
};

export type CatalogueToolChoice = {
  id: string;
  label: string;
  count: number;
};

export type CatalogueFeature = {
  id: string;
  name: string;
  level: number;
  source: string;
  choice: "subclass" | null;
  choiceGroups: Array<{
    count: number;
    options: Array<{ id: string; name: string; source: string }>;
  }>;
};

export type CataloguePrerequisite = {
  level: number;
  className: string;
  abilities: Array<{ ability: AbilityKey; score: number }>;
  spellcasting: boolean;
  pact: string;
  spell: string[];
  feature: string[];
};

export type CatalogueSpellGrant = {
  level: number;
  mode: string;
  spellId: string;
  name: string;
  source: string;
};

export type CatalogueSpellListExpansion = {
  minimumClassLevel: number;
  minimumSpellLevel: number;
  classes: string[];
  spellLevels: number[];
};

export type CatalogueSpellChoice = {
  id: string;
  label: string;
  unlockLevel: number;
  count: number;
  mode: "known" | "prepared" | "innate";
  destination: "prepared" | "spellbook";
  countsTowardPrepared: boolean;
  classes: string[];
  spellLevels: number[];
  schools: string[];
};

export type CatalogueSpellcasting = {
  ability: AbilityKey;
  progression: "full" | "artificer" | "pact" | "1/3";
  cantrips: number[];
  prepared: number[];
  spellbookAdditions: number[];
  slotTable: number[][];
  pactSlots: Array<{ count: number; level: number }>;
  alwaysSpells: CatalogueSpellGrant[];
  spellListExpansions: CatalogueSpellListExpansion[];
  spellChoices: CatalogueSpellChoice[];
};

export type CatalogueSubclass = {
  id: string;
  name: string;
  shortName: string;
  source: string;
  compatibility: string;
  level: number;
  features: CatalogueFeature[];
  alwaysSpells: CatalogueSpellGrant[];
  spellListExpansions: CatalogueSpellListExpansion[];
  spellChoices: CatalogueSpellChoice[];
  spellcasting: CatalogueSpellcasting | null;
  optionalProgressions: Array<{ name: string; featureTypes: string[]; counts: number[] }>;
  featProgressions: Array<{ name: string; categories: string[]; counts: number[] }>;
  tableProgressions: Array<{ label: string; values: Array<number | string> }>;
};

export type CatalogueClass = {
  id: string;
  name: string;
  source: string;
  hitDie: number;
  primaryAbility: AbilityKey[][];
  saves: AbilityKey[];
  skills: { count: number; from: SkillId[] | "any" };
  training: CatalogueTraining;
  multiclassTraining: CatalogueTraining;
  features: CatalogueFeature[];
  subclasses: CatalogueSubclass[];
  equipment: CatalogueEquipmentChoice[];
  spellcasting: CatalogueSpellcasting | null;
  optionalProgressions: Array<{ name: string; featureTypes: string[]; counts: number[] }>;
  featProgressions: Array<{ name: string; categories: string[]; counts: number[] }>;
  tableProgressions: Array<{ label: string; values: Array<number | string> }>;
};

export type CatalogueSpecies = {
  id: string;
  name: string;
  source: string;
  sizes: string[];
  speed: number;
  traits: string[];
  lineages: string[];
  skillChoice: { count: number; from: SkillId[] | "any" };
  innateMagic: Array<{ name: string; abilityChoices: AbilityKey[]; grants: CatalogueSpellGrant[]; choicePrompts: string[]; spellChoices: CatalogueSpellChoice[] }>;
};

export type CatalogueBackground = {
  id: string;
  name: string;
  source: string;
  abilities: AbilityKey[];
  skills: SkillId[];
  tools: string[];
  toolChoices: CatalogueToolChoice[];
  originFeatId: string;
  equipment: CatalogueEquipmentChoice[];
};

export type CatalogueFeat = {
  id: string;
  name: string;
  source: string;
  category: string;
  prerequisites: CataloguePrerequisite[];
  ability: Array<{
    fixed: Partial<Record<AbilityKey, number>>;
    choose: null | { from: AbilityKey[]; count: number; amount: number };
    max: number;
  }>;
  repeatable: boolean;
  summary: string;
};

export type CatalogueOptionalFeature = {
  id: string;
  name: string;
  source: string;
  featureTypes: string[];
  prerequisites: CataloguePrerequisite[];
  ability: CatalogueFeat["ability"];
  repeatable: boolean;
  summary: string;
};

export type CatalogueSpell = {
  id: string;
  name: string;
  source: string;
  compatibility: "revised" | "revised-list-legacy-source";
  level: number;
  school: string;
  castingTime: string;
  range: string;
  concentration: boolean;
  ritual: boolean;
  material: string;
  classes: string[];
};

export type CatalogueItem = {
  id: string;
  name: string;
  source: string;
  category: string;
  weight: number;
  valueCp: number;
  armorClass: number | null;
  armorDexCap: number | null;
  damage: string;
  damageType: string;
  range: string;
  properties: string[];
  weaponCategory: string;
  weaponType: string;
};

export type CharacterCatalogue = {
  schemaVersion: 1;
  source: { archive: string; archiveSha256: string; edition: string; policy: string };
  coverage: {
    classes: number;
    subclasses: number;
    species: number;
    backgrounds: number;
    feats: number;
    optionalFeatures: number;
    spells: number;
    items: number;
    unsupported: string[];
  };
  rules: {
    levels: { minimum: number; maximum: number };
    standardArray: number[];
    pointBuy: { points: number; minimum: number; maximum: number; costs: Record<string, number> };
    languages: string[];
    backgroundBoostMethods: Array<{ id: "2+1" | "1+1+1"; label: string; amounts: number[] }>;
  };
  classes: CatalogueClass[];
  species: CatalogueSpecies[];
  backgrounds: CatalogueBackground[];
  feats: CatalogueFeat[];
  optionalFeatures: CatalogueOptionalFeature[];
  spells: CatalogueSpell[];
  items: CatalogueItem[];
};

export const characterCatalogue = rawCatalogue as unknown as CharacterCatalogue;

export function catalogueClass(id: string) {
  return characterCatalogue.classes.find((entry) => entry.id === id);
}

export function catalogueSpecies(id: string) {
  return characterCatalogue.species.find((entry) => entry.id === id);
}

export function catalogueBackground(id: string) {
  return characterCatalogue.backgrounds.find((entry) => entry.id === id);
}

export function catalogueFeat(id: string) {
  return characterCatalogue.feats.find((entry) => entry.id === id);
}
