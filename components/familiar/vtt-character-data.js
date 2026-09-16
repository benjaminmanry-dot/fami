"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const execute = promisify(execFile);
const MAX_INPUT_BYTES = 20_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const RECOVERY_MESSAGE = "The offline VTT builder data is missing or incompatible. Check the VTT project and try again; no character file was created.";

const PROJECTION_SCRIPT = String.raw`
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[1];
const selections = JSON.parse(process.argv[2] ?? "{}");
const builder = await import(pathToFileURL(path.join(root, "lib", "character-builder.ts")).href);
const sheet = await import(pathToFileURL(path.join(root, "lib", "character-sheet.ts")).href);
const classData = builder.builderClasses.find(({ name }) => name === selections.className);
const background = builder.builderBackgrounds.find(({ name }) => name === selections.background);
const skillLabels = new Map(sheet.skillDefinitions.map(({ id, label }) => [id, label]));
const abilitySheet = sheet.createCharacterSheet("familiar-projection", "Familiar projection", "familiar-projection");
const option = (value, label = value) => ({ value, label });
const build = {
  name: typeof selections.name === "string" ? selections.name : "",
  className: typeof selections.className === "string" ? selections.className : "",
  species: typeof selections.species === "string" ? selections.species : "",
  heritage: typeof selections.heritage === "string" ? selections.heritage : "",
  background: typeof selections.background === "string" ? selections.background : "",
  size: typeof selections.size === "string" ? selections.size : "",
  baseScores: selections.baseScores ?? {},
  boostMode: selections.boostMode ?? "2+1",
  boostTwo: selections.boostTwo ?? "",
  boostOne: selections.boostOne ?? "",
  classSkills: Array.isArray(selections.classSkills) ? selections.classSkills : [],
  languages: Array.isArray(selections.languages) ? selections.languages : [],
  featureChoices: selections.featureChoices && typeof selections.featureChoices === "object" && !Array.isArray(selections.featureChoices) ? selections.featureChoices : {},
};

process.stdout.write(JSON.stringify({
  version: 1,
  abilities: sheet.abilityKeys.map((value) => option(value, abilitySheet.abilities[value].label)),
  standardArray: [...builder.standardArray],
  languages: builder.standardLanguages.map((value) => option(value)),
  boostMethods: builder.builderBackgroundBoostMethods.map(({ value, label, dependentFields }) => ({ value, label, dependentFields: [...dependentFields] })),
  classes: builder.builderClasses.map(({ name }) => option(name)),
  species: builder.builderSpecies.map(({ name, sizes, heritages, heritageLabel }) => ({
    ...option(name),
    sizes: sizes.map((value) => option(value)),
    heritages: (heritages ?? []).map((value) => option(value)),
    heritageLabel: heritageLabel ?? "Heritage",
  })),
  backgrounds: builder.builderBackgrounds.map(({ name, abilities }) => ({ ...option(name), abilities: [...abilities] })),
  classSkills: classData && background ? {
    count: classData.skillCount,
    options: builder.classSkillChoices(classData, background).map((value) => option(value, skillLabels.get(value) ?? value)),
  } : null,
  featureChoices: builder.featureChoicesForBuild(build).map(({ id, title, description, min, max, options }) => ({
    id, title, description, min, max,
    options: options.map(({ value, label, description }) => ({ value, label, ...(description ? { description } : {}) })),
  })),
}));
`;

function createVttCharacterData({ vttRoot } = {}) {
  if (typeof vttRoot !== "string" || !vttRoot.trim()) throw new TypeError("A VTT project path is required.");
  const root = path.resolve(vttRoot);
  return async function readVttCharacterData(selections = {}) {
    try {
      const input = JSON.stringify(selections);
      if (!input || Buffer.byteLength(input) > MAX_INPUT_BYTES) throw new Error("The Familiar selections are too large.");
      const { stdout } = await execute(process.execPath, [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        PROJECTION_SCRIPT,
        root,
        input,
      ], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: 30_000,
        windowsHide: true,
      });
      return cleanVttCharacterData(JSON.parse(stdout));
    } catch (error) {
      throw new Error(RECOVERY_MESSAGE, { cause: error });
    }
  };
}

function cleanVttCharacterData(value) {
  if (!isRecord(value) || value.version !== 1) throw new TypeError("VTT builder data is invalid.");
  const abilities = cleanOptions(value.abilities, "abilities", 6);
  if (abilities.length !== 6) throw new TypeError("VTT builder abilities are invalid.");
  const standardArray = cleanNumberList(value.standardArray, "standard array", 6);
  if (standardArray.length !== 6 || new Set(standardArray).size !== standardArray.length) throw new TypeError("VTT builder standard array is invalid.");
  const languages = cleanOptions(value.languages, "languages", 30);
  const classes = cleanOptions(value.classes, "classes", 30);
  const boostMethods = cleanRecords(value.boostMethods, "boost methods", 10).map((method) => ({
    ...cleanOption(method, "boost method"),
    dependentFields: cleanStrings(method.dependentFields, "boost dependencies", 4).map((field) => {
      if (!["boostTwo", "boostOne"].includes(field)) throw new TypeError("VTT boost dependency is invalid.");
      return field;
    })
  }));
  const species = cleanRecords(value.species, "species", 30).map((entry) => ({
    ...cleanOption(entry, "species"),
    sizes: cleanOptions(entry.sizes, "species sizes", 10),
    heritages: cleanOptions(entry.heritages, "species heritages", 30),
    heritageLabel: cleanText(entry.heritageLabel, "heritage label", 100)
  }));
  const backgrounds = cleanRecords(value.backgrounds, "backgrounds", 30).map((entry) => ({
    ...cleanOption(entry, "background"),
    abilities: cleanStrings(entry.abilities, "background abilities", 6)
  }));
  let classSkills = null;
  if (value.classSkills !== null) {
    if (!isRecord(value.classSkills) || !Number.isInteger(value.classSkills.count) || value.classSkills.count < 0 || value.classSkills.count > 20) throw new TypeError("VTT class skills are invalid.");
    classSkills = { count: value.classSkills.count, options: cleanOptions(value.classSkills.options, "class skills", 30) };
  }
  const featureChoices = cleanRecords(value.featureChoices, "feature choices", 30).map((choice) => {
    const min = Number(choice.min);
    const max = Number(choice.max);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 20) throw new TypeError("VTT feature choice bounds are invalid.");
    return {
      id: cleanText(choice.id, "feature choice ID", 100),
      title: cleanText(choice.title, "feature choice title", 200),
      description: cleanText(choice.description, "feature choice description", 500),
      min,
      max,
      options: cleanOptions(choice.options, "feature options", 100)
    };
  });
  const abilityValues = new Set(abilities.map(({ value }) => value));
  if (![languages, classes, boostMethods, species, backgrounds].every((list) => list.length)
    || species.some(({ sizes }) => !sizes.length)
    || backgrounds.some(({ abilities: values }) => !values.length || values.some((entry) => !abilityValues.has(entry)))
    || (classSkills && classSkills.options.length < classSkills.count)
    || featureChoices.some(({ min, options }) => options.length < min)) throw new TypeError("VTT builder data is incomplete.");
  return { version: 1, abilities, standardArray, languages, boostMethods, classes, species, backgrounds, classSkills, featureChoices };
}

function cleanOptions(value, label, max) {
  const options = cleanRecords(value, label, max).map((entry) => cleanOption(entry, label));
  if (new Set(options.map(({ value }) => value)).size !== options.length) throw new TypeError(`VTT builder ${label} are invalid.`);
  return options;
}

function cleanOption(value, label) {
  const option = { value: cleanText(value.value, `${label} value`, 200), label: cleanText(value.label, `${label} label`, 200) };
  if (value.description !== undefined) option.description = cleanText(value.description, `${label} description`, 500);
  return option;
}

function cleanRecords(value, label, max) {
  if (!Array.isArray(value) || value.length > max || value.some((entry) => !isRecord(entry))) throw new TypeError(`VTT builder ${label} are invalid.`);
  return value;
}

function cleanStrings(value, label, max) {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`VTT builder ${label} are invalid.`);
  return value.map((entry) => cleanText(entry, label, 200));
}

function cleanNumberList(value, label, max) {
  if (!Array.isArray(value) || value.length > max || value.some((entry) => !Number.isInteger(entry))) throw new TypeError(`VTT builder ${label} is invalid.`);
  return [...value];
}

function cleanText(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new TypeError(`VTT builder ${label} is invalid.`);
  return value.trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

module.exports = { createVttCharacterData, cleanVttCharacterData };
