import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const sourceRoot = path.resolve(args.get("--source") ?? ".local/creator-source/data");
const outputPath = path.resolve(args.get("--out") ?? "data/character-catalogue.json");
const archiveSha256 = args.get("--archive-sha256") ?? "C2A9D6C21C02FA278E59D6809FF54B2210F3C5EC939493DEC192480FDB3835C9";

const supportedClassSources = new Set(["XPHB", "EFA"]);
const coreClassNames = new Set([
  "Artificer", "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk",
  "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard",
]);
const abilityIds = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const standardLanguages = [
  "Common Sign Language", "Draconic", "Dwarvish", "Elvish", "Giant",
  "Gnomish", "Goblin", "Halfling", "Orc",
];

const classFiles = (await readdir(path.join(sourceRoot, "class")))
  .filter((name) => /^class-[a-z-]+\.json$/.test(name))
  .sort();
const classDocuments = await Promise.all(classFiles.map(async (name) => ({
  name,
  value: JSON.parse(await readFile(path.join(sourceRoot, "class", name), "utf8")),
})));
const featureRecords = classDocuments.flatMap(({ value }) => [
  ...(value.classFeature ?? []),
  ...(value.subclassFeature ?? []),
]);

const classRecords = classDocuments
  .flatMap(({ value }) => value.class ?? [])
  .filter((entry) => supportedClassSources.has(entry.source) && entry.edition === "one" && coreClassNames.has(entry.name))
  .sort(byNameSource);

const subclassRecords = classDocuments
  .flatMap(({ value }) => value.subclass ?? [])
  .filter((entry) => entry.edition === "one" && supportedClassSources.has(entry.classSource) && coreClassNames.has(entry.className))
  .sort(byClassNameSource);

const featsDocument = JSON.parse(await readFile(path.join(sourceRoot, "feats.json"), "utf8"));
const optionalFeaturesDocument = JSON.parse(await readFile(path.join(sourceRoot, "optionalfeatures.json"), "utf8"));
const backgroundsDocument = JSON.parse(await readFile(path.join(sourceRoot, "backgrounds.json"), "utf8"));
const racesDocument = JSON.parse(await readFile(path.join(sourceRoot, "races.json"), "utf8"));
const itemDocument = JSON.parse(await readFile(path.join(sourceRoot, "items.json"), "utf8"));
const baseItemDocument = JSON.parse(await readFile(path.join(sourceRoot, "items-base.json"), "utf8"));
const spellSources = JSON.parse(await readFile(path.join(sourceRoot, "spells", "sources.json"), "utf8"));

const feats = (featsDocument.feat ?? [])
  .filter((entry) => entry.source === "XPHB" || entry.source === "EFA" || entry.edition === "one")
  .map((entry) => ({
    id: optionId("feat", entry.name, entry.source),
    name: entry.name,
    source: entry.source,
    category: entry.category ?? "G",
    prerequisites: normalizePrerequisites(entry.prerequisite),
    ability: normalizeAbilityRule(entry.ability),
    repeatable: entry.repeatable === true,
    summary: entryNames(entry.entries).join(" · "),
  }))
  .sort(byNameSource);

const optionalFeatures = (optionalFeaturesDocument.optionalfeature ?? [])
  .filter((entry) => entry.source === "XPHB" || entry.source === "EFA" || entry.edition === "one")
  .map((entry) => ({
    id: optionId("option", entry.name, entry.source),
    name: entry.name,
    source: entry.source,
    featureTypes: [...(entry.featureType ?? [])].sort(),
    prerequisites: normalizePrerequisites(entry.prerequisite),
    ability: normalizeAbilityRule(entry.ability),
    repeatable: entry.repeatable === true,
    summary: entryNames(entry.entries).join(" · "),
  }))
  .sort(byNameSource);

const backgrounds = (backgroundsDocument.background ?? [])
  .filter((entry) => entry.source === "XPHB")
  .map((entry) => {
    const id = optionId("background", entry.name, entry.source);
    return {
      id,
      name: entry.name,
      source: entry.source,
      abilities: weightedAbilities(entry.ability),
      skills: proficiencyKeys(entry.skillProficiencies),
      tools: normalizeToolProficiencies(entry.toolProficiencies).fixed,
      toolChoices: normalizeToolProficiencies(entry.toolProficiencies).choices,
      originFeatId: slug(firstKey(entry.feats).replace(/\|.*$/, "")),
      equipment: equipmentChoices(entry.startingEquipment?.[0], id),
    };
  })
  .sort(byNameSource);

const lineageNames = {
  Dragonborn: [
    "Black (Acid)", "Blue (Lightning)", "Brass (Fire)", "Bronze (Lightning)", "Copper (Acid)",
    "Gold (Fire)", "Green (Poison)", "Red (Fire)", "Silver (Cold)", "White (Cold)",
  ],
  Elf: ["Drow", "High Elf", "Wood Elf"],
  Gnome: ["Forest Gnome", "Rock Gnome"],
  Goliath: ["Cloud Giant", "Fire Giant", "Frost Giant", "Hill Giant", "Stone Giant", "Storm Giant"],
  Tiefling: ["Abyssal", "Chthonic", "Infernal"],
};

const species = (racesDocument.race ?? [])
  .filter((entry) => entry.source === "XPHB")
  .map((entry) => {
    const id = optionId("species", entry.name, entry.source);
    return {
      id,
      name: entry.name,
      source: entry.source,
      sizes: (entry.size ?? []).map((size) => size === "S" ? "Small" : size === "M" ? "Medium" : size),
      speed: typeof entry.speed === "number" ? entry.speed : Number(entry.speed?.walk ?? 30),
      traits: (entry.entries ?? []).flatMap((value) => typeof value === "object" && value?.name ? [stripTags(value.name)] : []),
      lineages: lineageNames[entry.name] ?? [],
      skillChoice: normalizeSkillChoice(entry.skillProficiencies),
      innateMagic: normalizeInnateMagic(entry.additionalSpells, id),
    };
  })
  .sort(byNameSource);

const allItems = [...(itemDocument.item ?? []), ...(baseItemDocument.baseitem ?? [])];
const itemByKey = new Map();
for (const item of allItems) {
  const key = `${item.name.toLowerCase()}|${String(item.source ?? "").toLowerCase()}`;
  itemByKey.set(key, item);
}

const referencedItemKeys = new Set();
for (const entry of [...classRecords.map((value) => value.startingEquipment?.defaultData?.[0]), ...backgroundsDocument.background.filter((value) => value.source === "XPHB").map((value) => value.startingEquipment?.[0])]) {
  for (const choice of Object.values(entry ?? {})) {
    for (const item of choice ?? []) if (item.item) referencedItemKeys.add(item.item.toLowerCase());
  }
}
const selectedItems = [...new Set([
  ...allItems.filter((item) => item.source === "XPHB").map((item) => `${item.name.toLowerCase()}|xphb`),
  ...referencedItemKeys,
])].map((key) => itemByKey.get(key)).filter(Boolean);

const items = selectedItems.map((entry) => ({
  id: optionId("item", entry.name, entry.source),
  name: entry.name,
  source: entry.source,
  category: itemCategory(entry),
  weight: Number(entry.weight ?? 0),
  valueCp: Number(entry.value ?? 0),
  armorClass: typeof entry.ac === "number" ? entry.ac : null,
  armorDexCap: entry.dexterityMax == null
    ? itemType(entry) === "MA" ? 2 : itemType(entry) === "HA" ? 0 : null
    : Number(entry.dexterityMax),
  damage: entry.dmg1 ?? "",
  damageType: entry.dmgType ?? "",
  range: entry.range ?? "",
  properties: (entry.property ?? []).map((value) => String(value).split("|")[0]),
  weaponCategory: entry.weaponCategory ?? "",
  weaponType: itemType(entry),
}))
  .sort(byNameSource);

const spellFiles = (await readdir(path.join(sourceRoot, "spells")))
  .filter((name) => /^spells-.*\.json$/.test(name) && name !== "sources.json")
  .sort();
const allSpellRecords = (await Promise.all(spellFiles.map(async (name) => {
  const document = JSON.parse(await readFile(path.join(sourceRoot, "spells", name), "utf8"));
  return document.spell ?? [];
}))).flat();

const supportedClassNameSet = new Set(classRecords.map((entry) => entry.name));
const spellCandidates = allSpellRecords.flatMap((entry) => {
  const sourceRecord = spellSources[entry.source]?.[entry.name];
  if (!sourceRecord) return [];
  const classes = [...(sourceRecord.class ?? []), ...(sourceRecord.classVariant ?? [])]
    .filter((candidate) => supportedClassSources.has(candidate.source) && supportedClassNameSet.has(candidate.name))
    .map((candidate) => candidate.name);
  if (classes.length === 0) return [];
  return [{
    id: optionId("spell", entry.name, entry.source),
    name: entry.name,
    source: entry.source,
    compatibility: entry.source === "XPHB" || entry.source === "EFA" ? "revised" : "revised-list-legacy-source",
    level: Number(entry.level ?? 0),
    school: entry.school ?? "",
    castingTime: spellTime(entry.time),
    range: spellRange(entry.range),
    concentration: (entry.duration ?? []).some((duration) => duration.concentration === true),
    ritual: entry.meta?.ritual === true,
    material: typeof entry.components?.m === "string" ? stripTags(entry.components.m) : entry.components?.m?.text ? stripTags(entry.components.m.text) : "",
    classes: [...new Set(classes)].sort(),
  }];
}).sort(bySpell);
const spells = [...new Map(spellCandidates.map((spell) => [spell.name.toLowerCase(), spell])).values()]
  .map((spell) => spellCandidates.find((candidate) => candidate.name.toLowerCase() === spell.name.toLowerCase() && candidate.source === "XPHB") ?? spell)
  .sort(bySpell);

const subclassesByClass = new Map();
for (const entry of subclassRecords) {
  const classId = optionId("class", entry.className, entry.classSource);
  const subclassId = optionId("subclass", `${entry.className}-${entry.shortName ?? entry.name}`, entry.source);
  const current = subclassesByClass.get(classId) ?? [];
  const subclassSlotGroup = (entry.subclassTableGroups ?? []).find((group) => Array.isArray(group.rowsSpellProgression));
  current.push({
    id: subclassId,
    name: entry.name,
    shortName: entry.shortName ?? entry.name,
    source: entry.source,
    compatibility: supportedClassSources.has(entry.source) ? "revised" : "revised-class-supplement",
    level: subclassUnlockLevel(entry),
    features: normalizeFeatureRefs(entry.subclassFeatures),
    alwaysSpells: normalizeAdditionalSpells(entry.additionalSpells),
    spellListExpansions: normalizeSpellListExpansions(entry.additionalSpells),
    spellChoices: normalizeAdditionalSpellChoices(entry.additionalSpells, subclassId, entry.className),
    spellcasting: entry.spellcastingAbility ? {
      ability: entry.spellcastingAbility,
      progression: entry.casterProgression,
      cantrips: padProgression(entry.cantripProgression),
      prepared: padProgression(entry.preparedSpellsProgression),
      spellbookAdditions: padProgression(entry.spellsKnownProgressionFixed),
      slotTable: padSlotTable(subclassSlotGroup?.rowsSpellProgression),
      pactSlots: [],
      alwaysSpells: normalizeAdditionalSpells(entry.additionalSpells),
      spellListExpansions: normalizeSpellListExpansions(entry.additionalSpells),
      spellChoices: [],
    } : null,
    optionalProgressions: normalizeOptionalProgressions(entry.optionalfeatureProgression),
    featProgressions: normalizeFeatProgressions(entry.featProgression),
    tableProgressions: normalizeTableProgressions(entry.subclassTableGroups),
  });
  subclassesByClass.set(classId, current);
}

const classes = classRecords.map((entry) => {
  const id = optionId("class", entry.name, entry.source);
  const slotGroup = (entry.classTableGroups ?? []).find((group) => Array.isArray(group.rowsSpellProgression));
  const pactGroup = entry.casterProgression === "pact"
    ? (entry.classTableGroups ?? []).find((group) => (group.colLabels ?? []).includes("Spell Slots"))
    : null;
  return {
    id,
    name: entry.name,
    source: entry.source,
    hitDie: Number(entry.hd?.faces ?? 8),
    primaryAbility: normalizePrimaryAbility(entry.primaryAbility),
    saves: (entry.proficiency ?? []).filter((value) => abilityIds.has(value)),
    skills: normalizeSkillChoice(entry.startingProficiencies?.skills),
    training: normalizeTraining(entry.startingProficiencies),
    multiclassTraining: normalizeTraining(entry.multiclassing?.proficienciesGained),
    features: normalizeFeatureRefs(entry.classFeatures),
    subclasses: (subclassesByClass.get(id) ?? []).sort(byNameSource),
    equipment: equipmentChoices(entry.startingEquipment?.defaultData?.[0], id),
    spellcasting: entry.spellcastingAbility ? {
      ability: entry.spellcastingAbility,
      progression: entry.casterProgression,
      cantrips: padProgression(entry.cantripProgression),
      prepared: padProgression(entry.preparedSpellsProgression),
      spellbookAdditions: padProgression(entry.spellsKnownProgressionFixed),
      slotTable: padSlotTable(slotGroup?.rowsSpellProgression),
      pactSlots: pactGroup ? pactGroup.rows.map((row) => ({ count: Number(row[3] ?? 0), level: Number(row[4] ?? 0) })) : [],
      alwaysSpells: normalizeAdditionalSpells(entry.additionalSpells),
      spellListExpansions: normalizeSpellListExpansions(entry.additionalSpells),
      spellChoices: [
        ...normalizeAdditionalSpellChoices(entry.additionalSpells, id, entry.name),
        ...normalizeFeatureSpellChoices(entry.classFeatures, id, entry.name),
      ],
    } : null,
    optionalProgressions: normalizeOptionalProgressions(entry.optionalfeatureProgression),
    featProgressions: normalizeFeatProgressions(entry.featProgression),
    tableProgressions: normalizeTableProgressions(entry.classTableGroups),
  };
}).sort(byNameSource);

for (const speciesEntry of species) {
  for (const magic of speciesEntry.innateMagic) magic.grants = magic.grants.map(canonicalSpellGrant);
}
for (const classEntry of classes) {
  if (classEntry.spellcasting) classEntry.spellcasting.alwaysSpells = classEntry.spellcasting.alwaysSpells.map(canonicalSpellGrant);
  for (const subclass of classEntry.subclasses) {
    subclass.alwaysSpells = subclass.alwaysSpells.map(canonicalSpellGrant);
    if (subclass.spellcasting) subclass.spellcasting.alwaysSpells = subclass.spellcasting.alwaysSpells.map(canonicalSpellGrant);
  }
}

const catalogue = {
  schemaVersion: 1,
  generatedAt: "deterministic",
  source: {
    archive: "D&D 5.5e Repo.zip",
    archiveSha256,
    edition: "Revised 2024 / 5.5e",
    policy: "Revised core records plus options explicitly attached to revised class lists. Book prose is excluded.",
  },
  coverage: {
    classes: classes.length,
    subclasses: classes.reduce((total, entry) => total + entry.subclasses.length, 0),
    species: species.length,
    backgrounds: backgrounds.length,
    feats: feats.length,
    optionalFeatures: optionalFeatures.length,
    spells: spells.length,
    items: items.length,
    unsupported: [
      "Classic-only classes, species, and backgrounds are excluded unless the source explicitly attaches an option to a revised class.",
      "Free-form feature decisions without structured corpus options are preserved as manual rulings rather than guessed.",
      "Adventure, monster, encounter, DM, lore, and raw book-text records are never included in the browser catalogue.",
    ],
  },
  rules: {
    levels: { minimum: 1, maximum: 20 },
    standardArray: [15, 14, 13, 12, 10, 8],
    pointBuy: { points: 27, minimum: 8, maximum: 15, costs: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 } },
    languages: standardLanguages,
    backgroundBoostMethods: [
      { id: "2+1", label: "+2 and +1", amounts: [2, 1] },
      { id: "1+1+1", label: "+1 to all three", amounts: [1, 1, 1] },
    ],
  },
  classes,
  species,
  backgrounds,
  feats,
  optionalFeatures,
  spells,
  items,
};

const stable = stableStringify(catalogue);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${stable}\n`, "utf8");
const outputHash = createHash("sha256").update(`${stable}\n`).digest("hex").toUpperCase();
console.log(JSON.stringify({ outputPath, outputHash, coverage: catalogue.coverage }, null, 2));

function optionId(prefix, name, source) {
  return `${prefix}-${slug(name)}-${String(source).toLowerCase()}`;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function byNameSource(a, b) {
  return a.name.localeCompare(b.name) || String(a.source).localeCompare(String(b.source));
}

function byClassNameSource(a, b) {
  return a.className.localeCompare(b.className) || byNameSource(a, b);
}

function bySpell(a, b) {
  return a.level - b.level || byNameSource(a, b);
}

function stripTags(value) {
  return String(value ?? "")
    .replace(/\{@(?:[^ }]+) ([^}|]+)(?:\|[^}]*)?}/g, "$1")
    .replace(/\{@[^}]+}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFeatureRefs(entries) {
  return (entries ?? []).map((raw) => {
    const reference = typeof raw === "string" ? raw : raw.classFeature ?? raw.subclassFeature ?? "";
    const parts = String(reference).split("|");
    const level = Number(parts.find((part, index) => index >= 3 && /^\d+$/.test(part)) ?? 1);
    const record = featureRecordForReference(reference);
    return {
      id: slug(reference),
      name: stripTags(parts[0]),
      level,
      source: record?.source ?? parts[4] ?? parts[2] ?? "",
      choice: raw?.gainSubclassFeature === true ? "subclass" : null,
      choiceGroups: normalizeDirectFeatureChoices(record?.entries),
    };
  }).filter((entry) => entry.name).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

function featureRecordForReference(reference) {
  const [name, className, classSource, subclassShortName, subclassSource, rawLevel] = String(reference).split("|");
  const level = Number(subclassSource && /^\d+$/.test(rawLevel) ? rawLevel : subclassShortName);
  const expectedSource = subclassSource && !/^\d+$/.test(subclassShortName) ? subclassSource : classSource;
  return featureRecords.find((entry) => entry.name === name
    && entry.className === className
    && Number(entry.level) === level
    && (!expectedSource || entry.source === expectedSource));
}

function normalizeDirectFeatureChoices(entries) {
  const groups = [];
  visit(entries, (entry) => {
    if (entry?.type !== "options" || !Array.isArray(entry.entries)) return;
    const options = entry.entries.flatMap((option) => {
      const reference = option?.classFeature ?? option?.subclassFeature ?? option?.optionalfeature ?? option?.feat ?? "";
      if (!reference) return [];
      const parts = String(reference).split("|");
      return [{ id: `feature-choice-${slug(reference)}`, name: stripTags(parts[0]), source: parts[4] ?? parts[2] ?? "" }];
    });
    if (options.length) groups.push({ count: Number(entry.count ?? 1), options });
  });
  return groups;
}

function visit(value, callback) {
  if (Array.isArray(value)) {
    value.forEach((child) => visit(child, callback));
    return;
  }
  if (!value || typeof value !== "object") return;
  callback(value);
  Object.values(value).forEach((child) => visit(child, callback));
}

function subclassUnlockLevel(entry) {
  return Math.min(...normalizeFeatureRefs(entry.subclassFeatures).map((feature) => feature.level).filter(Boolean));
}

function normalizePrimaryAbility(entries) {
  return (entries ?? []).map((entry) => Object.keys(entry).filter((key) => abilityIds.has(key))).filter((entry) => entry.length > 0);
}

function normalizeSkill(value) {
  return String(value).toLowerCase().replace(/\s+/g, "-");
}

function normalizeSkillChoice(entries) {
  const values = entries ?? [];
  for (const entry of values) {
    if (entry?.choose?.from) return { count: Number(entry.choose.count ?? 1), from: entry.choose.from.map(normalizeSkill).sort() };
    if (entry?.any) return { count: Number(entry.any), from: "any" };
  }
  return { count: 0, from: [] };
}

function normalizeTraining(value) {
  const toolProficiencies = normalizeToolProficiencies(value?.toolProficiencies);
  return {
    armor: (value?.armor ?? []).map(stripTags),
    weapons: (value?.weapons ?? []).map(stripTags),
    tools: uniqueLabels([...(value?.tools ?? []).map(stripTags).filter((label) => !/\bchoose\b|\bone type\b/i.test(label)), ...toolProficiencies.fixed]),
    toolChoices: toolProficiencies.choices,
    skills: normalizeSkillChoice(value?.skills),
  };
}

function normalizeToolProficiencies(entries) {
  const fixed = [];
  const choices = [];
  const alternatives = (entries ?? []).flatMap((entry) => Object.entries(entry ?? {}).filter(([, value]) => typeof value === "number" && value > 0));
  const choiceOnlyAlternatives = (entries?.length ?? 0) > 1
    && alternatives.length === entries.length
    && (entries ?? []).every((entry) => Object.keys(entry ?? {}).length === 1);
  if (choiceOnlyAlternatives) {
    choices.push({
      id: `tool-choice-${alternatives.map(([key]) => slug(key)).join("-or-")}`,
      label: alternatives.map(([key]) => toolLabel(key)).join(" or "),
      count: Math.max(...alternatives.map(([, value]) => Number(value))),
    });
    return { fixed, choices };
  }
  for (const entry of entries ?? []) {
    for (const [key, value] of Object.entries(entry ?? {})) {
      if (value === true) fixed.push(toolLabel(key));
      else if (typeof value === "number" && value > 0) choices.push({ id: `tool-choice-${slug(key)}`, label: toolLabel(key), count: Number(value) });
    }
  }
  return { fixed: uniqueLabels(fixed), choices };
}

function toolLabel(value) {
  const known = {
    anyartisanstool: "Artisan's tools",
    anymusicalinstrument: "Musical instrument",
    anygamingset: "Gaming set",
  };
  return known[String(value).toLowerCase()] ?? titleCase(String(value).replace(/-/g, " "));
}

function uniqueLabels(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function proficiencyKeys(entries) {
  const result = [];
  for (const entry of entries ?? []) {
    for (const [key, value] of Object.entries(entry ?? {})) {
      if (value === true) result.push(normalizeSkill(key));
      else if (typeof value === "number") result.push(`${normalizeSkill(key)} (${value} choice)`);
    }
  }
  return [...new Set(result)].sort();
}

function firstKey(entries) {
  return Object.keys(entries?.[0] ?? {})[0] ?? "";
}

function weightedAbilities(entries) {
  const from = entries?.[0]?.choose?.weighted?.from ?? [];
  return from.filter((value) => abilityIds.has(value));
}

function equipmentChoices(record, ownerId) {
  return Object.entries(record ?? {}).map(([id, entries]) => ({
    id: `${ownerId}:package:${slug(id)}`,
    label: `Package ${id}`,
    gp: Math.floor(entries.reduce((total, entry) => total + Number(entry.value ?? 0), 0) / 100),
    items: entries.flatMap((entry) => {
      if (entry.item) {
        const [name, source = "XPHB"] = entry.item.split("|");
        return [{ id: optionId("item", name, source.toUpperCase()), name: entry.displayName ?? titleCase(name), quantity: Number(entry.quantity ?? 1), source: source.toUpperCase(), prompt: "" }];
      }
      if (entry.special) return [{ id: `special-${slug(entry.special)}`, name: stripTags(entry.special), quantity: 1, source: "XPHB", prompt: "" }];
      const prompt = equipmentPrompt(entry.equipmentType);
      return prompt ? [{ id: `prompt-${slug(prompt)}`, name: prompt, quantity: 1, source: "player", prompt }] : [];
    }),
  }));
}

function equipmentPrompt(type) {
  const prompts = {
    instrumentMusical: "Musical instrument (name your choice)",
    setGaming: "Gaming set (name your choice)",
    toolArtisan: "Artisan's tools (name your choice)",
  };
  return prompts[type] ?? (type ? `${type} (name your choice)` : "");
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/'S\b/g, "'s");
}

function normalizePrerequisites(entries) {
  return (entries ?? []).map((entry) => ({
    level: typeof entry.level === "number" ? entry.level : Number(entry.level?.level ?? 0),
    className: entry.level?.class?.name ?? "",
    abilities: (entry.ability ?? []).flatMap((ability) => Object.entries(ability).filter(([key]) => abilityIds.has(key)).map(([abilityId, score]) => ({ ability: abilityId, score: Number(score) }))),
    spellcasting: entry.spellcasting === true,
    pact: stripTags(entry.pact ?? ""),
    spell: (entry.spell ?? []).map((value) => typeof value === "string" ? value : value.entrySummary ?? value.entry ?? value.choose ?? "").filter(Boolean),
    feature: (entry.feature ?? []).map(stripTags),
  }));
}

function normalizeAbilityRule(entries) {
  return (entries ?? []).map((entry) => {
    const fixed = Object.fromEntries(Object.entries(entry).filter(([key, value]) => abilityIds.has(key) && typeof value === "number"));
    return {
      fixed,
      choose: entry.choose ? {
        from: (entry.choose.from ?? []).filter((value) => abilityIds.has(value)),
        count: Number(entry.choose.count ?? 1),
        amount: Number(entry.choose.amount ?? 1),
      } : null,
      max: Number(entry.max ?? 20),
    };
  });
}

function normalizeOptionalProgressions(entries) {
  return (entries ?? []).map((entry) => ({
    name: entry.name,
    featureTypes: [...(entry.featureType ?? [])].sort(),
    counts: Array.isArray(entry.progression)
      ? entry.progression.map(Number)
      : Array.from({ length: 20 }, (_, index) => progressionAt(entry.progression, index + 1)),
  }));
}

function normalizeFeatProgressions(entries) {
  return (entries ?? []).map((entry) => ({
    name: entry.name,
    categories: [...(entry.category ?? [])].sort(),
    counts: Array.from({ length: 20 }, (_, index) => progressionAt(entry.progression, index + 1)),
  }));
}

function normalizeTableProgressions(entries) {
  return (entries ?? []).flatMap((group) => (group.colLabels ?? []).map((label, column) => ({
    label: stripTags(label),
    values: (group.rows ?? []).map((row) => typeof row?.[column] === "number" ? row[column] : String(row?.[column] ?? "")),
  }))).filter((entry) => entry.values.length === 20);
}

function progressionAt(record, level) {
  let value = 0;
  for (const [key, next] of Object.entries(record ?? {})) if (Number(key) <= level) value = Number(next);
  return value;
}

function padProgression(values) {
  return Array.from({ length: 20 }, (_, index) => Number(values?.[index] ?? 0));
}

function padSlotTable(values) {
  return Array.from({ length: 20 }, (_, index) => Array.from({ length: 9 }, (__, spellIndex) => Number(values?.[index]?.[spellIndex] ?? 0)));
}

function normalizeAdditionalSpells(entries) {
  const result = [];
  for (const entry of entries ?? []) {
    for (const mode of ["prepared", "known", "expanded"]) {
      for (const [level, values] of Object.entries(entry?.[mode] ?? {})) {
        for (const value of nestedStrings(values)) {
          const [name, source = "XPHB"] = value.replace(/#c$/, "").split("|");
          result.push({ level: Number(level), mode, spellId: optionId("spell", name, source.toUpperCase()), name: titleCase(name), source: source.toUpperCase() });
        }
      }
    }
  }
  return result.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

function normalizeInnateMagic(entries, speciesId) {
  return (entries ?? []).map((entry, index) => ({
    name: entry.name ?? "Innate magic",
    abilityChoices: Array.isArray(entry.ability?.choose) ? entry.ability.choose : typeof entry.ability === "string" ? [entry.ability] : [],
    grants: normalizeAdditionalSpells([{ known: entry.known, prepared: entry.innate }]),
    choicePrompts: nestedSpellChoices([entry.known, entry.innate]).map((choice) => choice === "level=0|class=Wizard" ? "Choose one Wizard cantrip" : `Resolve spell choice: ${choice}`),
    spellChoices: normalizeAdditionalSpellChoices([{ name: entry.name, known: entry.known, innate: entry.innate }], `${speciesId}-${index}`, ""),
  }));
}

function canonicalSpellGrant(grant) {
  const canonical = spells.find((spell) => spell.name.toLowerCase() === grant.name.toLowerCase() && spell.source === grant.source)
    ?? spells.find((spell) => spell.name.toLowerCase() === grant.name.toLowerCase());
  return canonical ? { ...grant, spellId: canonical.id, name: canonical.name, source: canonical.source } : grant;
}

function nestedStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(nestedStrings);
  if (value && typeof value === "object") return Object.entries(value).filter(([key]) => key !== "choose" && key !== "all").flatMap(([, child]) => nestedStrings(child));
  return [];
}

function nestedSpellChoices(value) {
  if (Array.isArray(value)) return value.flatMap(nestedSpellChoices);
  if (!value || typeof value !== "object") return [];
  return [
    ...(typeof value.choose === "string" ? [value.choose] : []),
    ...Object.entries(value).filter(([key]) => key !== "choose").flatMap(([, child]) => nestedSpellChoices(child)),
  ];
}

function normalizeSpellListExpansions(entries) {
  const expansions = [];
  for (const entry of entries ?? []) {
    for (const [unlock, values] of Object.entries(entry?.expanded ?? {})) {
      for (const rule of nestedPropertyStrings(values, "all")) {
        const parts = Object.fromEntries(rule.split("|").map((part) => {
          const [key, value = ""] = part.split("=");
          return [key, value];
        }));
        const classes = String(parts.class ?? "").split(";").filter(Boolean);
        const spellLevels = String(parts.level ?? "").split(";").map(Number).filter(Number.isFinite);
        if (!classes.length || !spellLevels.length) continue;
        expansions.push({
          minimumClassLevel: /^\d+$/.test(unlock) ? Number(unlock) : 0,
          minimumSpellLevel: /^s\d+$/.test(unlock) ? Number(unlock.slice(1)) : 0,
          classes,
          spellLevels,
        });
      }
    }
  }
  return expansions;
}

function normalizeAdditionalSpellChoices(entries, ownerId, ownerClassName) {
  const choices = new Map();
  for (const entry of entries ?? []) {
    for (const mode of ["known", "prepared", "innate"]) {
      for (const [unlock, values] of Object.entries(entry?.[mode] ?? {})) {
        for (const choice of nestedSpellChoiceRecords(values)) {
          const filter = parseSpellFilter(choice.choose);
          const key = `${mode}|${unlock}|${choice.choose}`;
          const current = choices.get(key);
          if (current) {
            current.count += choice.count;
            continue;
          }
          choices.set(key, {
            id: optionId("spell-choice", `${ownerId}-${mode}-${unlock}-${choice.choose || "any"}`, "derived"),
            label: entry.name ?? `${titleCase(mode)} spell choice`,
            unlockLevel: /^\d+$/.test(unlock) ? Number(unlock) : 1,
            count: choice.count,
            mode,
            destination: ownerClassName === "Wizard" && mode === "known" ? "spellbook" : "prepared",
            countsTowardPrepared: false,
            ...filter,
          });
        }
      }
    }
  }
  return [...choices.values()];
}

function normalizeFeatureSpellChoices(entries, ownerId, ownerClassName) {
  return normalizeFeatureRefs(entries).flatMap((feature) => {
    if (feature.name !== "Mystic Arcanum") return [];
    const raw = entries.find((entry) => slug(typeof entry === "string" ? entry : entry.classFeature ?? entry.subclassFeature ?? "") === feature.id);
    const record = featureRecordForReference(raw);
    const text = nestedStrings(record?.entries).map(stripTags).join(" ");
    const spellLevel = Number(text.match(/level\s+(\d)\s+Warlock spell/i)?.[1] ?? 0);
    if (!spellLevel) return [];
    return [{
      id: optionId("spell-choice", `${ownerId}-${feature.name}-${feature.level}-${spellLevel}`, "derived"),
      label: `${feature.name} (level ${spellLevel})`,
      unlockLevel: feature.level,
      count: 1,
      mode: "prepared",
      destination: "prepared",
      countsTowardPrepared: ownerClassName === "Warlock",
      classes: [ownerClassName],
      spellLevels: [spellLevel],
      schools: [],
    }];
  });
}

function nestedSpellChoiceRecords(value) {
  if (Array.isArray(value)) return value.flatMap(nestedSpellChoiceRecords);
  if (!value || typeof value !== "object") return [];
  if (typeof value.choose === "string") return [{ choose: value.choose, count: Number(value.count ?? 1) }];
  return Object.values(value).flatMap(nestedSpellChoiceRecords);
}

function parseSpellFilter(value) {
  const parts = Object.fromEntries(String(value).split("|").map((part) => {
    const [key, entry = ""] = part.split("=");
    return [key, entry];
  }));
  const levels = String(parts.level ?? "").split(";").map(Number).filter(Number.isFinite);
  return {
    classes: String(parts.class ?? "").split(";").filter(Boolean).map(titleCase),
    spellLevels: levels.length ? levels : Array.from({ length: 10 }, (_, level) => level),
    schools: String(parts.school ?? "").split(";").filter(Boolean),
  };
}

function nestedPropertyStrings(value, property) {
  if (Array.isArray(value)) return value.flatMap((child) => nestedPropertyStrings(child, property));
  if (!value || typeof value !== "object") return [];
  return [
    ...(typeof value[property] === "string" ? [value[property]] : []),
    ...Object.entries(value).filter(([key]) => key !== property).flatMap(([, child]) => nestedPropertyStrings(child, property)),
  ];
}

function itemCategory(entry) {
  const type = itemType(entry);
  if (entry.weapon === true || ["M", "R"].includes(type)) return "Weapon";
  if (entry.armor === true || ["LA", "MA", "HA", "S"].includes(type)) return "Armor";
  if (type === "T") return "Tool";
  return "Gear";
}

function itemType(entry) {
  return String(entry.type ?? "").split("|")[0];
}

function spellTime(entries) {
  const entry = entries?.[0];
  if (!entry) return "";
  return `${entry.number ?? 1} ${String(entry.unit ?? "action").replace(/([A-Z])/g, " $1").toLowerCase()}`;
}

function spellRange(entry) {
  const distance = entry?.distance;
  if (!distance) return entry?.type ?? "";
  if (distance.type === "self" || distance.type === "touch" || distance.type === "sight") return titleCase(distance.type);
  return `${distance.amount ?? ""} ${distance.type ?? ""}`.trim();
}

function entryNames(entries) {
  return (entries ?? []).flatMap((entry) => typeof entry === "object" && entry?.name ? [stripTags(entry.name)] : []).slice(0, 8);
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value), null, 2);
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}
