"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { cleanVttCharacterData } = require("./vtt-character-data.js");

const DEFAULT_STATE_PATH = path.join(__dirname, ".local", "player-help.json");
const VTT_FOUNDATION = Object.freeze({
  edition: "2024",
  level: 1,
  classes: Object.freeze(["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"]),
  species: Object.freeze(["Aasimar", "Dragonborn", "Dwarf", "Elf", "Gnome", "Goliath", "Halfling", "Human", "Orc", "Tiefling"]),
  backgrounds: Object.freeze(["Acolyte", "Criminal", "Sage", "Soldier"]),
  unfinished: Object.freeze(["attacks", "spells", "subclasses", "later levels"])
});

const CHARACTER_FIELDS = new Set([
  "name", "level", "className", "species", "background", "armorClass",
  "spellSaveDc", "proficiencyBonus", "spells", "edition"
]);
const CHARACTER_NUMBER_BOUNDS = { level: [1, 20], armorClass: [0, 99], spellSaveDc: [0, 99], proficiencyBonus: [0, 20] };
const VTT_HANDOFF_UNAVAILABLE = "The offline VTT handoff is unavailable or incompatible. Check the VTT project and try again; no character file was created.";
const VTT_DATA_UNAVAILABLE = "The offline VTT builder data is unavailable or incompatible. Check the VTT project and try again; no character file was created.";
const INTERVIEW_NEEDS = Object.freeze([
  ["campaign", "We’ll cover campaign and starting level one at a time. First, what campaign or table constraints should I know? Say “none” if there are none."],
  ["level", "What starting level should this revised-2024 character use? Familiar currently supports level 1 only."],
  ["fantasy", "What fantasy or role do you want this character to fulfill?"],
  ["complexity", "What amount or kind of rules complexity sounds fun to you? Say “no preference” if either is fine."],
  ["nonNegotiables", "What material non-negotiables should this character respect? Say “none” if there are none."]
]);

function safeId(value, label) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(text) || ["__proto__", "prototype", "constructor"].includes(text.toLowerCase())) throw new TypeError(`${label} is invalid.`);
  return text;
}

function shortText(value, label, max = 500) {
  const text = String(value || "").trim();
  if (!text || text.length > max) throw new TypeError(`${label} is invalid.`);
  return text;
}

function positiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${label} is invalid.`);
  return value;
}

function characterKey(name) {
  const key = shortText(name, "Character name", 80).toLocaleLowerCase("en-US");
  if (["__proto__", "prototype", "constructor"].includes(key)) throw new TypeError("Character name is invalid.");
  return key;
}

function cleanCharacter(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Character summary is required.");
  const out = { name: shortText(input.name, "Character name", 80) };
  for (const key of Object.keys(input)) {
    if (!CHARACTER_FIELDS.has(key)) continue;
    if (["level", "armorClass", "spellSaveDc", "proficiencyBonus"].includes(key)) {
      if (input[key] !== undefined) {
        const number = Number(input[key]);
        const [min, max] = CHARACTER_NUMBER_BOUNDS[key];
        if (!Number.isInteger(number) || number < min || number > max) throw new TypeError(`${key} is invalid.`);
        out[key] = number;
      }
    } else if (key === "spells") {
      if (!Array.isArray(input.spells) || input.spells.length > 100) throw new TypeError("spells is invalid.");
      out.spells = input.spells.map((spell) => shortText(spell, "Spell", 100));
    } else if (key !== "name" && input[key] !== undefined) {
      out[key] = shortText(input[key], key, 100);
    }
  }
  return out;
}

function periodKeys(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}` };
}

function emptyMember() {
  return { characters: {}, selections: {}, builders: {} };
}

function emptyState(date) {
  const { day, month } = periodKeys(date);
  return { version: 1, members: {}, usage: { day, dailyByMember: {}, month, spentCents: 0 } };
}

function normalizeState(raw, date) {
  if (!raw || raw.version !== 1 || typeof raw.members !== "object" || !raw.usage) {
    throw new Error("Player-help state is invalid; refusing to overwrite it.");
  }
  const state = emptyState(date);
  for (const [memberId, member] of Object.entries(raw.members)) {
    safeId(memberId, "Member ID");
    if (!member || typeof member !== "object") continue;
    const characters = {};
    for (const value of Object.values(member.characters || {})) {
      const summary = cleanCharacter(value);
      characters[characterKey(summary.name)] = summary;
    }
    const selections = {};
    for (const [contextId, key] of Object.entries(member.selections || {})) {
      safeId(contextId, "Context ID");
      if (characters[key]) selections[contextId] = key;
    }
    const builders = {};
    for (const [contextId, builder] of Object.entries(member.builders || {})) {
      safeId(contextId, "Context ID");
      builders[contextId] = cleanBuilder(builder);
    }
    state.members[memberId] = { characters, selections, builders };
  }
  const periods = periodKeys(date);
  if (raw.usage.day === periods.day && raw.usage.dailyByMember && typeof raw.usage.dailyByMember === "object") {
    for (const [memberId, count] of Object.entries(raw.usage.dailyByMember)) {
      safeId(memberId, "Member ID");
      if (Number.isInteger(count) && count >= 0) state.usage.dailyByMember[memberId] = count;
    }
  }
  if (raw.usage.month === periods.month && Number.isInteger(raw.usage.spentCents) && raw.usage.spentCents >= 0) {
    state.usage.spentCents = raw.usage.spentCents;
  }
  return state;
}

function neutralizeMentions(value) {
  return String(value || "").replace(/@/g, "@\u200b");
}

function output(kind, mode, answer, supportingLines = [], extra = {}) {
  return {
    kind,
    mode,
    ...extra,
    answer: neutralizeMentions(answer).replace(/[\r\n]+/g, " ").trim(),
    supportingLines: supportingLines.slice(0, 4).map((line) => neutralizeMentions(line).replace(/[\r\n]+/g, " ").trim()),
    readOnly: true,
    delivery: { allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } }
  };
}

function cleanStringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new TypeError(`${label} is invalid.`);
  return value.map((item) => shortText(item, label, 500));
}

function publicRules(value, livePlay) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new TypeError("Public rules are invalid.");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") throw new TypeError("Public rule is invalid.");
    if (!["player-rule", "published-monster", "vtt-help"].includes(item.kind)) return [];
    if (item.visibility && !["public", "player-visible"].includes(item.visibility)) return [];
    if (livePlay && item.kind === "published-monster") return [];
    return [{
      kind: item.kind,
      source: shortText(item.source, "Rule source", 200),
      text: shortText(item.text, "Rule text", 1000)
    }];
  });
}

function inferMode(content) {
  const builder = /\b(build|create|rebuild|level up|leveling)\b.*\b(character|sheet|hero)?\b/i.test(content);
  return builder ? "character-builder" : "play-assistant";
}

function naturalBuilderAction(content, current) {
  const active = current?.stage === "interview";
  const review = current?.stage === "vtt-review" && current.plan;
  if (!active && !review) return null;
  if (/^\s*(?:restart(?: character builder)?|start over)\s*[.!]?\s*$/i.test(content)) return { type: "restart" };
  if (/^\s*(?:(?:stop|cancel)(?: character builder)?)\s*[.!]?\s*$/i.test(content)) return { type: "stop" };
  if (/^\s*(?:back|go back)\s*[.!]?\s*$/i.test(content)) return { type: "back" };
  if (/^\s*(?:review|status|review status|show (?:me )?(?:the )?(?:review|status)|help me build a character|resume (?:the )?character builder)\s*[.!]?\s*$/i.test(content)) return { type: "review" };
  const change = /^\s*change\s+(?:my\s+|the\s+)?(background boost method|boost method|starting level|non[- ]negotiables|class skill|language|campaign|level|fantasy|role|complexity|name|class|species|heritage|size|background)\s+to\s+(.{1,500}?)\s*[.!]?\s*$/i.exec(content);
  if (change) {
    const fields = {
      "background boost method": "boostMode", "boost method": "boostMode", "starting level": "level",
      "non-negotiables": "nonNegotiables", "non negotiables": "nonNegotiables", "class skill": "classSkills",
      language: "languages", campaign: "campaign", level: "level", fantasy: "fantasy", role: "fantasy",
      complexity: "complexity", name: "name", class: "className", species: "species", heritage: "heritage",
      size: "size", background: "background"
    };
    return { type: "change", field: fields[change[1].toLocaleLowerCase("en-US")], value: change[2].trim() };
  }
  if (review) {
    if (/^\s*i confirm\s*[.!]?\s*$/i.test(content)) return { type: "confirm", confirmed: true, reviewFingerprint: current.reviewFingerprint };
    return { type: "confirm", confirmed: false };
  }
  return { type: "answer" };
}

function startsCharacterBuilder(content) {
  return /^\s*(?:start (?:the )?character builder|help me build a character)\s*[.!]?\s*$/i.test(content);
}

function isMonsterQuestion(event, content) {
  return event.topic === "monster" || /\b(monster|troll|dragon|regenerat|vulnerab|resistan|stat block)\b/i.test(content);
}

function needsCharacter(event, content) {
  return event.requiresCharacter === true || /\b(my|using)\b.*\b(ac|armor class|spell save|sheet|spell|feat|attack|character)\b/i.test(content);
}

function localRuleAnswer(event, rules) {
  const trollTimingQuestion = /\btroll\b/i.test(event.content)
    && /\bregenerat(?:e|ion)\b/i.test(event.content)
    && /\bacid\b/i.test(event.content)
    && /\bnext turn\b/i.test(event.content);
  if (trollTimingQuestion) {
    const candidates = rules.filter(({ kind, source, text }) => (
      kind === "published-monster"
      && /2014/i.test(source)
      && /\bacid\b/i.test(text)
      && /\bregenerat(?:e|ion)\b/i.test(text)
    ));
    const rule = candidates.find(({ text }) => (
      /\bstart\b[\s\S]{0,60}\bnext turn\b/i.test(text)
      && /\b(?:does not|doesn['’]?t|cannot|can['’]?t)\s+(?:function|work|regenerate)\b|\b(?:stops?|prevents?)\b/i.test(text)
    ));
    if (rule) {
      return output("answer", "play-assistant", `No—acid damage stops the troll’s Regeneration from functioning at the start of its next turn. (${rule.source})`);
    }
    return output("clarify", "play-assistant", "I can’t establish the next-turn timing from the supplied evidence. What exact 2014 Troll Regeneration text should I use?");
  }
  if (!/\bconcentrat(?:e|ing|ion)\b/i.test(event.content)) return null;
  const damage = Number(event.content.match(/\b(\d+)\s+(?:points?\s+of\s+)?damage\b/i)?.[1]);
  const rule = rules.find(({ source, text }) => /2014/i.test(source) && /\b(?:10|ten)\b/i.test(text) && /\bhalf\b[\s\S]*\bdamage\b/i.test(text));
  if (!Number.isInteger(damage) || damage < 1 || !rule) return null;
  const half = Math.floor(damage / 2);
  const dc = Math.max(10, half);
  return output("answer", "play-assistant", `DC ${dc} Constitution save—half the damage is ${half}, so the higher DC is ${dc}. (${rule.source})`);
}

function localCharacterFact(character, content) {
  const facts = [
    [/\bspell save dc\b/i, "spellSaveDc", "spell save DC"],
    [/\b(?:armor class|ac)\b/i, "armorClass", "Armor Class"],
    [/\bproficiency bonus\b/i, "proficiencyBonus", "proficiency bonus"],
  ];
  const fact = facts.find(([pattern, field]) => pattern.test(content) && character?.[field] !== undefined);
  if (!fact) return null;
  const [, field, label] = fact;
  return output("answer", "play-assistant", `${character.name}’s ${label} is ${character[field]}. (${character.name}’s linked sheet.)`);
}

function explicitCharacter(event, content) {
  if (event.characterName) return String(event.characterName);
  const match = content.match(/\busing\s+([^,:?]+)[,:]/i);
  return match ? match[1].trim() : null;
}

function requestsPrivateData(event, content) {
  if (event.requestsOtherPlayerData || event.requestsDurableMemory) return true;
  return /\b(show|give|read|access|reveal)\b[\s\S]{0,120}\b(?:another player|other player|[A-Za-z][A-Za-z0-9_-]*['’]s)\b[\s\S]{0,80}\b(sheet|character)\b/i.test(content)
    || /\b(remember|retain|store|save)\b[\s\S]{0,100}\b(everything|conversation|channel|chat|next month|later)\b/i.test(content);
}

function requestsMutation(event, content) {
  if (event.requestsMutation) return true;
  if (/\bhow (do|can|should) i\b/i.test(content)) return false;
  return /\b(update my sheet|edit my sheet|equip it|import it|roll for me|take my (turn|action)|submit my (roll|action))\b/i.test(content);
}

function requestsMassPing(event, content) {
  return event.requestsMassPing === true || /\bmass[- ]?pings?\b|@everyone|@here|\b(?:role|user|member) pings?\b|\bpings?\b[\s\S]{0,50}\b(?:server|everyone|specific member)\b/i.test(content);
}

function builderCounsel(needs) {
  const description = `${needs.fantasy} ${needs.complexity} ${needs.nonNegotiables}`;
  const protects = /\b(protect|defend|guard|shield|keep\s+(?:people|allies|friends)\s+safe)\b/i.test(description);
  const avoidsSpells = /\b(no|avoid|without|don['’]?t want)\b[\s\S]{0,30}\bspell|\bsimple|low complexity|minimal tracking\b/i.test(description);
  const answer = protects && avoidsSpells
    ? `You want to ${needs.fantasy} with ${needs.complexity} rules: Fighter keeps the play simpler, while Paladin also protects allies but adds spell and resource tracking. Which tradeoff sounds more like your character?`
    : `You want ${needs.fantasy} with ${needs.complexity} complexity. I don’t yet have verified class-tradeoff evidence for that fantasy; which two of the 12 supported classes are you considering?`;
  return output("answer", "character-builder", answer, [
    `The VTT currently supports a revised-2024 level-one foundation: ${VTT_FOUNDATION.classes.length} classes, ${VTT_FOUNDATION.species.length} Player’s Handbook species, and ${VTT_FOUNDATION.backgrounds.length} backgrounds.`,
    `${VTT_FOUNDATION.unfinished.join(", ").replace(/^./, (letter) => letter.toUpperCase())} remain unfinished.`
  ]);
}

function hasGrounding(request) {
  return request.evidence.publicRules.length > 0
    || request.evidence.selectedCharacter !== null
    || request.evidence.suppliedOrRevealedFacts.length > 0;
}

function contradictsBonusActionRule(request, answer, supportingLines) {
  const has2014Rule = request.evidence.publicRules.some(({ source, text }) => (
    /2014/i.test(source)
    && /bonus action/i.test(text)
    && /cantrip/i.test(text)
    && /another spell/i.test(text)
  ));
  if (!has2014Rule) return false;
  const text = [answer, ...supportingLines].join(" ");
  return /\b(?:won['’]?t|wouldn['’]?t|doesn['’]?t|no)\s+(?:conflict|issue|restriction)\b|\b(?:can|may)\s+(?:cast|use)\s+both\b|\bcan cast an? action spell\b[\s\S]{0,80}\bbonus.action spell\b|\b(?:action spell|hypnotic pattern)\b[\s\S]{0,80}\b(?:same turn|together)\b[\s\S]{0,80}\b(?:bonus.action spell|healing word)\b|\b(?:bonus.action spell|healing word)\b[\s\S]{0,80}\b(?:same turn|together)\b[\s\S]{0,80}\b(?:action spell|hypnotic pattern)\b/i.test(text);
}

function assessBuildPlan(input) {
  const choices = {
    edition: String(input?.edition || ""),
    level: Number(input?.level),
    className: String(input?.className || ""),
    species: String(input?.species || ""),
    background: String(input?.background || ""),
    subclass: String(input?.subclass || ""),
    attacks: cleanStringList(input?.attacks, "Attack"),
    spells: cleanStringList(input?.spells, "Spell")
  };
  const incomplete = ["This offline MVP creates no native VTT JSON or structural round-trip, so the plan is not import-ready."];
  if (!/^revised-?2024$|^2024$/i.test(choices.edition)) incomplete.push("The current VTT builder supports revised 2024 only.");
  if (choices.level !== 1) incomplete.push("The current VTT builder supports a level-one foundation only.");
  if (!VTT_FOUNDATION.classes.includes(choices.className)) incomplete.push("Choose one of the 12 supported classes.");
  if (!VTT_FOUNDATION.species.includes(choices.species)) incomplete.push("Choose one of the 10 supported species.");
  if (!VTT_FOUNDATION.backgrounds.includes(choices.background)) incomplete.push("Choose one of the 4 supported backgrounds.");
  if (choices.subclass) incomplete.push("Subclass selection is not supported.");
  if (choices.attacks.length) incomplete.push("Attack construction is not supported.");
  if (choices.spells.length) incomplete.push("Spell selection is not supported.");
  return { status: "incomplete", foundationSupported: incomplete.length === 1, choices, incomplete };
}

function isVttCharacterPlan(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (
    Object.prototype.hasOwnProperty.call(value, "version")
    || Object.prototype.hasOwnProperty.call(value, "selections")
    || Object.prototype.hasOwnProperty.call(value, "suggestions")
  ));
}

function cleanVttCharacterPlan(input) {
  if (!isVttCharacterPlan(input)) throw new TypeError("A versioned VTT character plan is required.");
  const plan = {};
  for (const field of ["version", "selections", "suggestions"]) {
    if (Object.prototype.hasOwnProperty.call(input, field)) plan[field] = input[field];
  }
  let json;
  try {
    json = JSON.stringify(plan);
  } catch {
    throw new TypeError("The VTT character plan must be bounded JSON.");
  }
  if (!json || Buffer.byteLength(`${json}\n`) > 1_000_000) throw new TypeError("The VTT character plan must be bounded JSON.");
  return JSON.parse(json);
}

function cleanVttHandoffResult(value, allowComplete) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !["incomplete", "review", "complete"].includes(value.status)) {
    throw new Error("Malformed VTT handoff result.");
  }
  if (typeof value.confirmationRequired !== "boolean" || value.confirmationRequired !== (value.status === "review") || !Array.isArray(value.reasons) || value.reasons.some((reason) => typeof reason !== "string") || !value.review || typeof value.review !== "object" || Array.isArray(value.review)) {
    throw new Error("Malformed VTT handoff result.");
  }
  if (["review", "complete"].includes(value.status) && !/^sha256:[0-9a-f]{64}$/.test(value.reviewFingerprint)) {
    throw new Error("Malformed VTT handoff result.");
  }
  if (value.status === "complete") {
    if (!allowComplete || typeof value.nativeJson !== "string" || JSON.parse(value.nativeJson)?.version !== 2) throw new Error("Malformed VTT handoff result.");
  } else if (Object.prototype.hasOwnProperty.call(value, "nativeJson")) {
    throw new Error("The VTT returned character JSON before exact confirmation.");
  }
  const result = {
    status: value.status,
    confirmationRequired: value.confirmationRequired,
    reasons: [...value.reasons],
    review: structuredClone(value.review),
  };
  if (value.reviewFingerprint) result.reviewFingerprint = value.reviewFingerprint;
  if (value.status === "complete") result.nativeJson = value.nativeJson;
  return result;
}

function vttHandoffOutput(result) {
  const buildPlan = {
    status: result.status,
    confirmed: result.status === "complete",
    importReady: result.status === "complete",
    incomplete: result.reasons,
  };
  if (result.status === "incomplete") {
    return output("builder-plan", "character-builder", "The VTT says this character is incomplete; no character JSON was created.", result.reasons, { characterHandoff: result, buildPlan });
  }
  if (result.status === "review") {
    return output("builder-review", "character-builder", `Review the VTT’s complete summary. Without changing a choice, say “I confirm” to confirm this exact fingerprint: ${result.reviewFingerprint}`, result.reasons, { characterHandoff: result, buildPlan });
  }
  return output("builder-plan", "character-builder", "The VTT matched your explicit confirmation to the exact reviewed choices and returned native version-2 JSON for your review and player-controlled import.", [], { characterHandoff: result, buildPlan });
}

function cleanNeeds(input) {
  const needs = {
    campaign: shortText(input?.campaign, "Campaign", 100),
    level: Number(input?.level),
    fantasy: shortText(input?.fantasy, "Desired fantasy", 300),
    complexity: shortText(input?.complexity, "Complexity", 100),
    nonNegotiables: String(input?.nonNegotiables || "").trim().slice(0, 300)
  };
  if (!Number.isInteger(needs.level) || needs.level < 1 || needs.level > 20) throw new TypeError("Starting level is invalid.");
  return needs;
}

function cleanInterview(raw) {
  const needs = {};
  for (const [field] of INTERVIEW_NEEDS) {
    if (!Object.prototype.hasOwnProperty.call(raw?.needs || {}, field)) continue;
    if (field === "level") {
      if (raw.needs.level !== 1) throw new TypeError("Interview level is invalid.");
      needs.level = 1;
    } else {
      needs[field] = shortText(raw.needs[field], `Interview ${field}`, 500);
    }
  }
  const plan = cleanVttCharacterPlan({ version: 1, selections: raw?.selections || {}, suggestions: raw?.suggestions || {} });
  if (!isRecord(plan.selections) || !isRecord(plan.suggestions)) throw new TypeError("Interview choices are invalid.");
  const interview = { stage: "interview", needs, selections: plan.selections, suggestions: plan.suggestions };
  for (const field of ["unresolved", "pendingCandidate", "changing", "lastAnswered"]) {
    if (raw?.[field] === undefined) continue;
    if (!isRecord(raw[field])) throw new TypeError(`Interview ${field} is invalid.`);
    const marker = { field: shortText(raw[field].field, `Interview ${field} field`, 120) };
    for (const key of ["value", "label", "intent", "reason", "key", "previous"]) {
      if (raw[field][key] !== undefined) marker[key] = shortText(raw[field][key], `Interview ${field} ${key}`, 500);
    }
    interview[field] = marker;
  }
  return interview;
}

function currentNeed(interview) {
  const entry = INTERVIEW_NEEDS.find(([field]) => !Object.prototype.hasOwnProperty.call(interview.needs, field));
  return entry ? { field: entry[0], prompt: entry[1], type: "open" } : null;
}

function nextVttQuestion(interview, data) {
  const selections = interview.selections;
  if (!selections.name) return { field: "name", prompt: "What name do you choose for this character?", type: "open" };
  const simple = (field, prompt, options) => {
    if (!options.some(({ value }) => value === selections[field])) return { field, prompt, type: "option", options };
    return null;
  };
  let question = simple("className", "Which one class do you choose?", data.classes);
  if (question) return question;
  question = simple("species", "Which one species do you choose?", data.species.map(({ value, label }) => ({ value, label })));
  if (question) return question;
  const species = data.species.find(({ value }) => value === selections.species);
  if (species.heritages.length) {
    question = simple("heritage", `Which one ${species.heritageLabel.toLocaleLowerCase("en-US")} do you choose?`, species.heritages);
    if (question) return question;
  }
  if (species.sizes.length > 1) {
    question = simple("size", "Which one size do you choose?", species.sizes);
    if (question) return question;
  }
  question = simple("background", "Which one background do you choose?", data.backgrounds.map(({ value, label }) => ({ value, label })));
  if (question) return question;
  const scores = isRecord(selections.baseScores) ? selections.baseScores : {};
  const usedScores = new Set(Object.values(scores));
  for (const ability of data.abilities) {
    if (Number.isInteger(scores[ability.value])) continue;
    return {
      field: "baseScores",
      key: ability.value,
      prompt: `Which remaining Standard Array score do you explicitly assign to ${ability.label}?`,
      type: "option",
      options: data.standardArray.filter((score) => !usedScores.has(score)).map((score) => ({ value: String(score), label: String(score) }))
    };
  }
  question = simple("boostMode", "Which one background ability-boost method do you choose?", data.boostMethods.map(({ value, label }) => ({ value, label })));
  if (question) return question;
  const method = data.boostMethods.find(({ value }) => value === selections.boostMode);
  const background = data.backgrounds.find(({ value }) => value === selections.background);
  const abilityOptions = background.abilities.map((value) => data.abilities.find((ability) => ability.value === value)).filter(Boolean);
  for (const field of method.dependentFields) {
    if (abilityOptions.some(({ value }) => value === selections[field]) && (field !== "boostOne" || selections[field] !== selections.boostTwo)) continue;
    const bonus = field === "boostTwo" ? "+2" : "+1";
    return {
      field,
      prompt: `Which one background ability receives ${bonus}?`,
      type: "option",
      options: abilityOptions.filter(({ value }) => field !== "boostOne" || value !== selections.boostTwo)
    };
  }
  const classSkills = Array.isArray(selections.classSkills) ? selections.classSkills : [];
  if (!data.classSkills) throw new TypeError("VTT class-skill data is unavailable.");
  if (classSkills.length < data.classSkills.count) {
    return {
      field: "classSkills",
      prompt: `Which one class skill do you choose for slot ${classSkills.length + 1} of ${data.classSkills.count}?`,
      type: "option",
      options: data.classSkills.options.filter(({ value }) => !classSkills.includes(value))
    };
  }
  const languages = Array.isArray(selections.languages) ? selections.languages : [];
  if (languages.length < 2) {
    return {
      field: "languages",
      prompt: `Which one additional language do you choose for slot ${languages.length + 1} of 2?`,
      type: "option",
      options: data.languages.filter(({ value }) => !languages.includes(value))
    };
  }
  const featureSelections = isRecord(selections.featureChoices) ? selections.featureChoices : {};
  for (const choice of data.featureChoices) {
    const selected = Array.isArray(featureSelections[choice.id]) ? featureSelections[choice.id] : [];
    if (selected.length >= choice.min) continue;
    return {
      field: "featureChoices",
      key: choice.id,
      prompt: `Which one ${choice.title} option do you choose for slot ${selected.length + 1} of ${choice.min}?`,
      type: "option",
      description: choice.description,
      options: choice.options.filter(({ value }) => !selected.includes(value))
    };
  }
  return null;
}

function pendingQuestion(interview, question) {
  if (!question) return null;
  const pending = interview.pendingCandidate;
  if (!pending || pending.field !== question.field || (pending.key || "") !== (question.key || "")) return question;
  const candidate = question.options?.find(({ value }) => value === pending.value);
  if (!candidate) return question;
  return {
    ...question,
    prompt: `Did you explicitly choose ${candidate.label} for this selection?`,
    type: "confirmation",
    candidate,
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
  };
}

function interviewOutput(interview, currentQuestion, prefix = "") {
  const options = currentQuestion.options || [];
  const supporting = options.length ? [`Offered options: ${options.map(({ label }) => label).join(", ")}.`] : [];
  const advice = [
    ...(currentQuestion.description ? [{ label: currentQuestion.field, text: currentQuestion.description }] : []),
    ...options.filter(({ description }) => description).map(({ label, description }) => ({ label, text: description }))
  ];
  return output("answer", "character-builder", `${prefix}${currentQuestion.prompt}`, supporting, {
    interview: {
      status: "active",
      needs: structuredClone(interview.needs),
      selections: structuredClone(interview.selections),
      suggestions: structuredClone(interview.suggestions),
      advice,
      ...(interview.unresolved ? { unresolved: structuredClone(interview.unresolved) } : {}),
      ...(interview.pendingCandidate ? { pendingCandidate: structuredClone(interview.pendingCandidate) } : {}),
      currentQuestion: structuredClone(currentQuestion)
    }
  });
}

function exactChoice(question, content) {
  const raw = shortText(content, "Interview answer", 500);
  const direct = question.options.find(({ value, label }) => raw.toLocaleLowerCase("en-US") === value.toLocaleLowerCase("en-US") || raw.toLocaleLowerCase("en-US") === label.toLocaleLowerCase("en-US"));
  if (direct) return { selected: direct };
  const text = normalizedWords(raw);
  const matches = question.options.filter(({ value, label }) => includesWords(text, normalizedWords(value)) || includesWords(text, normalizedWords(label)));
  if (matches.length && /\b(?:no|don['’]?t|do\s+not|not|never|anything\s+but|except|reject(?:ing)?)\b/i.test(raw)) return { unresolved: "rejected" };
  const exploratory = /\?|\b(?:maybe|perhaps|unsure|uncertain|compare|versus|vs|either|or|which|what|think)\b/i.test(raw);
  const explicit = /\b(?:choose|chosen|pick|select|want|my choice is)\b/i.test(raw) || /\bplease\s*[.!]?$/i.test(raw);
  const namesOnlyOne = matches.length === 1 && [matches[0].value, matches[0].label].some((value) => text === normalizedWords(value));
  if (matches.length === 1 && !exploratory && (explicit || namesOnlyOne)) return { selected: matches[0] };
  if (matches.length === 1) return { candidate: matches[0] };
  return { unresolved: matches.length > 1 ? "ambiguous" : "unsupported" };
}

function normalizedWords(value) {
  return String(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function includesWords(text, phrase) {
  return Boolean(phrase && ` ${text} `.includes(` ${phrase} `));
}

function setExplicitChoice(interview, question, value) {
  const selections = interview.selections;
  if (question.field === "baseScores") {
    selections.baseScores = isRecord(selections.baseScores) ? selections.baseScores : {};
    selections.baseScores[question.key] = Number(value);
  } else if (["classSkills", "languages"].includes(question.field)) {
    const selected = Array.isArray(selections[question.field]) ? selections[question.field] : [];
    selections[question.field] = [...selected, value];
  } else if (question.field === "featureChoices") {
    selections.featureChoices = isRecord(selections.featureChoices) ? selections.featureChoices : {};
    const selected = Array.isArray(selections.featureChoices[question.key]) ? selections.featureChoices[question.key] : [];
    selections.featureChoices[question.key] = [...selected, value];
  } else {
    selections[question.field] = value;
  }
  interview.lastAnswered = {
    field: question.field,
    ...(question.key ? { key: question.key } : {}),
    ...(["classSkills", "languages", "featureChoices"].includes(question.field) ? { value: String(value) } : {})
  };
  delete interview.unresolved;
  delete interview.pendingCandidate;
}

function clearInterviewField(interview, marker) {
  const field = marker.field;
  if (INTERVIEW_NEEDS.some(([name]) => name === field)) {
    if (!Object.prototype.hasOwnProperty.call(interview.needs, field)) return false;
    delete interview.needs[field];
  } else if (field === "baseScores" && marker.key && isRecord(interview.selections.baseScores)) {
    delete interview.selections.baseScores[marker.key];
  } else if (["classSkills", "languages"].includes(field) && Array.isArray(interview.selections[field])) {
    interview.selections[field] = marker.value
      ? interview.selections[field].filter((value) => value !== marker.value)
      : [];
  } else if (field === "featureChoices" && marker.key && isRecord(interview.selections.featureChoices)) {
    const selected = Array.isArray(interview.selections.featureChoices[marker.key]) ? interview.selections.featureChoices[marker.key] : [];
    interview.selections.featureChoices[marker.key] = marker.value ? selected.filter((value) => value !== marker.value) : [];
  } else if (Object.prototype.hasOwnProperty.call(interview.selections, field)) {
    if (field === "boostMode") marker.previous = String(interview.selections[field]);
    delete interview.selections[field];
  } else {
    return false;
  }
  interview.changing = {
    field,
    ...(marker.key ? { key: marker.key } : {}),
    ...(marker.previous ? { previous: marker.previous } : {})
  };
  delete interview.lastAnswered;
  delete interview.unresolved;
  delete interview.pendingCandidate;
  return true;
}

function clearDirectDependents(interview, field, data) {
  const selections = interview.selections;
  if (field === "className") delete selections.classSkills;
  if (field === "species") {
    delete selections.heritage;
    delete selections.size;
  }
  if (field === "background") {
    delete selections.classSkills;
    delete selections.boostTwo;
    delete selections.boostOne;
  }
  if (field === "boostMode") {
    const methods = data.boostMethods.filter(({ value }) => [selections.boostMode, interview.changing?.previous].includes(value));
    for (const dependent of new Set(methods.flatMap(({ dependentFields }) => dependentFields))) delete selections[dependent];
  }
}

function reconcileFeatureSelections(interview, data) {
  const existing = isRecord(interview.selections.featureChoices) ? interview.selections.featureChoices : {};
  const next = {};
  for (const choice of data.featureChoices) {
    const valid = new Set(choice.options.map(({ value }) => value));
    const selected = Array.isArray(existing[choice.id]) ? existing[choice.id] : [];
    next[choice.id] = [...new Set(selected)].filter((value) => valid.has(value)).slice(0, choice.max);
  }
  interview.selections.featureChoices = next;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanBuilder(raw) {
  if (raw?.stage === "interview") return cleanInterview(raw);
  if (raw?.stage === "needs") return { stage: "needs" };
  if (raw?.stage === "choosing") return { stage: "choosing", needs: cleanNeeds(raw.needs) };
  if (["awaiting-confirmation", "confirmed-incomplete"].includes(raw?.stage)) {
    return { stage: raw.stage, assessment: assessBuildPlan(raw.assessment?.choices) };
  }
  if (["vtt-review", "vtt-complete"].includes(raw?.stage)) {
    if (raw.reviewFingerprint !== undefined && !/^sha256:[0-9a-f]{64}$/.test(raw.reviewFingerprint)) {
      throw new Error("Player-help builder state is invalid; refusing to overwrite it.");
    }
    return {
      stage: raw.stage,
      plan: cleanVttCharacterPlan(raw.plan),
      ...(raw.reviewFingerprint ? { reviewFingerprint: raw.reviewFingerprint } : {}),
      ...(raw.interview ? { interview: cleanInterview(raw.interview) } : {})
    };
  }
  throw new Error("Player-help builder state is invalid; refusing to overwrite it.");
}

class PlayerHelp {
  constructor(options = {}) {
    if (typeof options.responder !== "function") throw new TypeError("An injected responder is required.");
    if (options.characterHandoff !== undefined && typeof options.characterHandoff !== "function") throw new TypeError("The character handoff must be a function.");
    if (options.characterBuilderData !== undefined && typeof options.characterBuilderData !== "function") throw new TypeError("The character builder data source must be a function.");
    this.responder = options.responder;
    this.characterHandoff = options.characterHandoff || null;
    this.characterBuilderData = options.characterBuilderData || null;
    this.statePath = options.statePath || DEFAULT_STATE_PATH;
    this.now = options.now || (() => new Date());
    this.maxQuestionLength = positiveInteger(options.maxQuestionLength, 1200, "Question limit");
    this.dailyLimit = positiveInteger(options.dailyLimit, 25, "Daily limit");
    this.monthlyLimitCents = positiveInteger(options.monthlyLimitCents, 200, "Monthly limit");
    this.costPerAnswerCents = positiveInteger(options.costPerAnswerCents, 1, "Answer cost");
    this.state = null;
    // ponytail: one serialized runtime is enough until multiple live processes are explicitly authorized.
    this.queue = Promise.resolve();
  }

  _serial(work) {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return run;
  }

  async _load() {
    if (this.state) return this.state;
    try {
      const raw = JSON.parse(await fs.readFile(this.statePath, "utf8"));
      this.state = normalizeState(raw, this.now());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = emptyState(this.now());
    }
    return this.state;
  }

  async _save() {
    const dir = path.dirname(this.statePath);
    await fs.mkdir(dir, { recursive: true });
    const temp = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await fs.rename(temp, this.statePath);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  _member(state, memberId) {
    return state.members[memberId] || (state.members[memberId] = emptyMember());
  }

  async linkCharacter(memberId, summary) {
    return this._serial(async () => {
      memberId = safeId(memberId, "Member ID");
      const state = await this._load();
      const member = this._member(state, memberId);
      const clean = cleanCharacter(summary);
      const key = characterKey(clean.name);
      if (member.characters[key]) throw new Error("That character is already linked; replace it explicitly.");
      member.characters[key] = clean;
      await this._save();
      return structuredClone(clean);
    });
  }

  async replaceCharacter(memberId, oldName, summary) {
    return this._serial(async () => {
      memberId = safeId(memberId, "Member ID");
      const state = await this._load();
      const member = this._member(state, memberId);
      const oldKey = characterKey(oldName);
      if (!member.characters[oldKey]) throw new Error("That character is not linked.");
      const clean = cleanCharacter(summary);
      const newKey = characterKey(clean.name);
      if (newKey !== oldKey && member.characters[newKey]) throw new Error("The replacement name is already linked.");
      delete member.characters[oldKey];
      member.characters[newKey] = clean;
      for (const contextId of Object.keys(member.selections)) {
        if (member.selections[contextId] === oldKey) member.selections[contextId] = newKey;
      }
      await this._save();
      return structuredClone(clean);
    });
  }

  async listCharacters(memberId) {
    return this._serial(async () => {
      memberId = safeId(memberId, "Member ID");
      const state = await this._load();
      const member = state.members[memberId];
      return member ? Object.values(member.characters).map((value) => structuredClone(value)).sort((a, b) => a.name.localeCompare(b.name)) : [];
    });
  }

  async selectCharacter(memberId, contextId, name) {
    return this._serial(async () => {
      memberId = safeId(memberId, "Member ID");
      contextId = safeId(contextId, "Context ID");
      const state = await this._load();
      const member = this._member(state, memberId);
      const key = characterKey(name);
      if (!member.characters[key]) throw new Error("That character is not linked to this member.");
      member.selections[contextId] = key;
      await this._save();
      return structuredClone(member.characters[key]);
    });
  }

  async forgetCharacter(memberId, name) {
    return this._serial(async () => {
      memberId = safeId(memberId, "Member ID");
      const state = await this._load();
      const member = state.members[memberId];
      if (!member) return false;
      const key = characterKey(name);
      if (!member.characters[key]) return false;
      delete member.characters[key];
      for (const contextId of Object.keys(member.selections)) {
        if (member.selections[contextId] === key) delete member.selections[contextId];
      }
      if (!Object.keys(member.characters).length && !Object.keys(member.builders).length) delete state.members[memberId];
      await this._save();
      return true;
    });
  }

  async handle(event) {
    if (!event || event.authorIsBot || event.webhookId || event.isDirectMessage || event.inOfficialServer !== true) return null;
    if (!event.mentioned && !event.replyToFamiliar) return null;
    const content = String(event.content || "").trim();
    if (!content) return output("notice", "play-assistant", "Please include the D&D question you want answered.");
    if (content.length > this.maxQuestionLength) {
      return output("notice", "play-assistant", "That request is too long; please shorten it to the part you want answered.");
    }
    return this._serial(() => this._handleAddressed({ ...event, content }));
  }

  async _handleAddressed(event) {
    const memberId = safeId(event.authorId, "Member ID");
    const contextId = safeId(event.contextId || "default", "Context ID");
    if (/\bwho are you\b/i.test(event.content)) {
      return output("answer", "play-assistant", "I’m Familiar, an AI member of the 20Fates staff; I help with player-safe D&D questions when you summon me.");
    }

    if (event.mode !== "play-assistant" && !event.builderAction) {
      const state = await this._load();
      const current = state.members[memberId]?.builders?.[contextId];
      const action = naturalBuilderAction(event.content, current);
      if (action) event = { ...event, mode: "character-builder", builderAction: action };
      else if (startsCharacterBuilder(event.content)) event = { ...event, mode: "character-builder" };
    }

    const inferred = event.mode || inferMode(event.content);
    if (inferred === "ambiguous") {
      return output("clarify", null, "Are you building or leveling a character, or asking for help with play?");
    }
    const mode = inferred === "character-builder" ? inferred : "play-assistant";
    if (mode === "character-builder" || event.builderAction) {
      return this._handleBuilder(memberId, contextId, event);
    }

    if (requestsPrivateData(event, event.content)) {
      return output("notice", mode, "I can’t access another player’s sheet or keep a durable transcript; I can use facts you provide now and your own linked characters.");
    }
    if (requestsMutation(event, event.content)) {
      if (/\b(?:without|missing|no)\b[\s\S]{0,40}\brules? text\b/i.test(event.content) && /\bbypass(?:es|ing)?\b[\s\S]{0,30}\bresistance\b/i.test(event.content)) {
        return output("clarify", mode, "I can’t establish whether the item bypasses resistance without its rules text, and I can’t alter sheets, equip items, import files, roll, act, or change game state. What player-visible rules text does the item have?");
      }
      return output("clarify", mode, "I can’t alter sheets, equip items, import files, roll, act, or change game state. What player-visible rules text or result should I use to explain the options?");
    }
    if (requestsMassPing(event, event.content)) {
      return output("notice", mode, "I can help with wording that addresses the group, but I won’t generate or recommend a mass, role, or user ping.");
    }

    const safePublicRules = publicRules(event.publicRules, event.livePlay === true);
    if (typeof event.livePlay !== "boolean" && (isMonsterQuestion(event, event.content) || safePublicRules.some(({ kind }) => kind === "published-monster"))) {
      return output("clarify", mode, "Are you asking generally outside play, or about a creature you’re facing in a live session?");
    }

    const ruleAnswer = localRuleAnswer(event, safePublicRules);
    if (ruleAnswer) return ruleAnswer;

    const facts = [...cleanStringList(event.suppliedFacts, "Supplied fact"), ...cleanStringList(event.revealedFacts, "Revealed fact")];
    if (event.livePlay === true && isMonsterQuestion(event, event.content) && facts.length === 0) {
      return output("clarify", mode, "I can’t see encounter notes, unrevealed creature changes, or planned actions. What player-visible effect did you observe?");
    }

    const state = await this._load();
    const resolved = this._resolveCharacter(state, memberId, contextId, explicitCharacter(event, event.content), needsCharacter(event, event.content));
    if (resolved.clarify) return output("clarify", mode, resolved.clarify);
    const characterFact = localCharacterFact(resolved.character, event.content);
    if (characterFact) return characterFact;

    const request = {
      question: event.content,
      mode,
      livePlay: event.livePlay === true,
      answerMode: event.answerMode || (/\b(why|how|what should|compare|options)\b/i.test(event.content) ? "short-counsel" : "quick-fact"),
      evidence: {
        publicRules: safePublicRules,
        selectedCharacter: resolved.character ? structuredClone(resolved.character) : null,
        suppliedOrRevealedFacts: facts
      },
      constraints: {
        answerOnlyFromEvidence: true,
        askOneClarificationIfInsufficient: true,
        leaveDecisionToPlayer: event.livePlay === true && /\bwhat should i do\b/i.test(event.content)
      }
    };
    return this._callResponder(state, memberId, event, request);
  }

  _resolveCharacter(state, memberId, contextId, explicitName, required) {
    const member = state.members[memberId];
    const characters = member ? Object.values(member.characters) : [];
    if (explicitName) {
      const character = member?.characters[characterKey(explicitName)];
      return character ? { character } : { clarify: `I can’t find ${explicitName} among your linked characters.` };
    }
    const selected = member?.selections[contextId];
    if (selected && member.characters[selected]) return { character: member.characters[selected] };
    if (!required) return { character: null };
    if (characters.length === 1) return { character: characters[0] };
    if (!characters.length) return { clarify: "Which of your linked characters should I use?" };
    return { clarify: `Which character do you mean—${characters.map(({ name }) => name).join(" or ")}?` };
  }

  async _handleBuilder(memberId, contextId, event) {
    const state = await this._load();
    const member = this._member(state, memberId);
    const action = event.builderAction;
    if (!action) {
      const current = member.builders[contextId];
      if (current?.plan && current.interview) return this._reviewInterviewPlan(member, contextId, current);
      if (current?.stage !== "interview") member.builders[contextId] = cleanInterview({ stage: "interview", needs: {} });
      await this._save();
      return this._presentInterview(member, contextId, member.builders[contextId]);
    }
    if (action.type === "restart") {
      member.builders[contextId] = cleanInterview({ stage: "interview", needs: {} });
      await this._save();
      return this._presentInterview(member, contextId, member.builders[contextId], "Character Builder restarted. ");
    }
    if (action.type === "stop") {
      delete member.builders[contextId];
      await this._save();
      return output("answer", "character-builder", "Character Builder stopped for this member and context; no character file was created.");
    }
    if (action.type === "review") {
      const current = member.builders[contextId];
      if (current?.plan && current.interview) return this._reviewInterviewPlan(member, contextId, current);
      if (current?.stage === "interview") return this._presentInterview(member, contextId, current, "Here is the current status. ");
      return output("clarify", "character-builder", "Start Character Builder before asking to review its status.");
    }
    if (["back", "change"].includes(action.type)) {
      const current = member.builders[contextId];
      const interview = current?.stage === "interview" ? current : current?.interview;
      if (!interview) return output("clarify", "character-builder", "Start Character Builder before changing an interview answer.");
      const source = action.type === "back" && !action.field ? interview.lastAnswered : action;
      const marker = source ? {
        field: String(source.field || ""),
        ...(source.key || source.choiceId ? { key: String(source.key || source.choiceId) } : {}),
        ...(source.value ? { value: String(source.value) } : {})
      } : null;
      if (!marker?.field || !clearInterviewField(interview, marker)) {
        return output("clarify", "character-builder", "Which recorded answer do you want to revisit?");
      }
      member.builders[contextId] = interview;
      await this._save();
      const changedAnswer = action.value === undefined ? event.content : String(action.value);
      if (action.type === "change" && String(changedAnswer || "").trim()) return this._answerInterview(member, contextId, interview, changedAnswer);
      return this._presentInterview(member, contextId, interview, "That answer is open again. ");
    }
    if (action.type === "answer") {
      const current = member.builders[contextId];
      if (current?.stage === "interview") return this._answerInterview(member, contextId, current, event.content);
      if (current?.plan && current.interview) return this._reviewInterviewPlan(member, contextId, current);
      return output("clarify", "character-builder", "Start or resume Character Builder before answering an interview question.");
    }
    if (action.type === "needs") {
      const needs = cleanNeeds(action.needs);
      member.builders[contextId] = { stage: "choosing", needs };
      await this._save();
      return builderCounsel(needs);
    }
    if (action.type === "choose") {
      if (isVttCharacterPlan(action.plan)) {
        const plan = cleanVttCharacterPlan(action.plan);
        member.builders[contextId] = { stage: "vtt-review", plan };
        await this._save();
        const reply = await this._runCharacterHandoff(plan, false);
        if (reply.characterHandoff?.status === "review") {
          member.builders[contextId].reviewFingerprint = reply.characterHandoff.reviewFingerprint;
          await this._save();
        }
        return reply;
      }
      const assessment = assessBuildPlan(action.plan);
      member.builders[contextId] = { stage: "awaiting-confirmation", assessment };
      await this._save();
      return output("builder-plan", "character-builder", `${assessment.choices.className || "This build"} is an incomplete plan; confirm these choices before I preserve it.`, assessment.incomplete, {
        buildPlan: { ...assessment, confirmed: false, importReady: false }
      });
    }
    if (action.type === "confirm") {
      const current = member.builders[contextId];
      if (current?.plan) {
        if (action.confirmed !== true) return output("clarify", "character-builder", "Say exactly “I confirm” to confirm the review Familiar showed, or tell me what to change.");
        const confirmation = action.reviewFingerprint === current.reviewFingerprint
          ? current.reviewFingerprint
          : "";
        const reply = await this._runCharacterHandoff({ ...current.plan, confirmation }, true);
        const savedInterview = current.interview ? { interview: current.interview } : {};
        if (reply.characterHandoff?.status === "complete") {
          member.builders[contextId] = { stage: "vtt-complete", plan: current.plan, reviewFingerprint: reply.characterHandoff.reviewFingerprint, ...savedInterview };
          await this._save();
        } else if (reply.characterHandoff?.status === "review") {
          member.builders[contextId] = { stage: "vtt-review", plan: current.plan, reviewFingerprint: reply.characterHandoff.reviewFingerprint, ...savedInterview };
          await this._save();
        }
        if (current.interview) reply.interview = this._interviewSummary(current.interview, reply.characterHandoff?.status || "blocked");
        return reply;
      }
      if (!current?.assessment) return output("clarify", "character-builder", "Choose the supported character foundation before confirming it.");
      if (action.confirmed !== true) return output("clarify", "character-builder", "Please explicitly confirm the summarized choices, or tell me what to change.");
      member.builders[contextId] = { stage: "confirmed-incomplete", assessment: current.assessment };
      await this._save();
      return output("builder-plan", "character-builder", "Your choices are confirmed, but this plan remains incomplete and is not import-ready; you must review and finish it before any player-controlled import.", current.assessment.incomplete, {
        buildPlan: { ...current.assessment, confirmed: true, importReady: false }
      });
    }
    throw new TypeError("Unsupported builder action.");
  }

  async _answerInterview(member, contextId, interview, content) {
    const located = await this._interviewQuestion(interview);
    if (located.error) return located.error;
    if (!located.question) return this._presentInterview(member, contextId, interview);
    const question = located.question;
    if (question.type === "confirmation") {
      if (/^\s*(?:yes|confirm|i confirm|that(?:'s| is) my choice)\s*[.!]?\s*$/i.test(content)) {
        setExplicitChoice(interview, question, question.candidate.value);
      } else if (/^\s*(?:no|nope|not that)\s*[.!]?\s*$/i.test(content)) {
        delete interview.pendingCandidate;
        delete interview.unresolved;
        await this._save();
        return this._presentInterview(member, contextId, interview, "No selection recorded. ");
      } else {
        interview.unresolved = { field: question.field, ...(question.key ? { key: question.key } : {}), intent: shortText(content, "Unresolved intent", 500), reason: "ambiguous confirmation" };
        await this._save();
        return interviewOutput(interview, question, "That did not explicitly confirm or reject the candidate. ");
      }
    } else if (question.type === "open") {
      const value = shortText(content, "Interview answer", 500);
      if (question.field === "level") {
        if (!/^\s*(?:level\s+)?1\s*$/i.test(value)) {
          interview.unresolved = { field: "level", intent: value, reason: "unsupported starting level" };
          await this._save();
          return interviewOutput(interview, question, "That intent is preserved as incomplete because this offline milestone supports revised-2024 level 1 only. ");
        }
        interview.needs.level = 1;
      } else if (INTERVIEW_NEEDS.some(([field]) => field === question.field)) {
        interview.needs[question.field] = value;
      } else {
        interview.selections[question.field] = value;
      }
      interview.lastAnswered = { field: question.field };
      delete interview.unresolved;
      delete interview.pendingCandidate;
    } else {
      const choice = exactChoice(question, content);
      if (choice.candidate) {
        interview.pendingCandidate = { field: question.field, ...(question.key ? { key: question.key } : {}), value: choice.candidate.value, label: choice.candidate.label };
        interview.unresolved = { field: question.field, ...(question.key ? { key: question.key } : {}), intent: shortText(content, "Unresolved intent", 500), reason: "candidate not confirmed" };
        await this._save();
        return this._presentInterview(member, contextId, interview, "No selection was recorded from that exploratory wording. ");
      }
      if (choice.unresolved) {
        interview.unresolved = { field: question.field, ...(question.key ? { key: question.key } : {}), intent: shortText(content, "Unresolved intent", 500), reason: choice.unresolved };
        delete interview.pendingCandidate;
        await this._save();
        const prefix = choice.unresolved === "unsupported"
          ? "That unsupported intent is preserved as incomplete; Familiar did not substitute an offered option. "
          : choice.unresolved === "rejected"
            ? "That rejects an offered option, so Familiar recorded no selection. "
            : "That names more than one possibility, so Familiar recorded no selection. ";
        return interviewOutput(interview, question, prefix);
      }
      setExplicitChoice(interview, question, choice.selected.value);
    }

    const changed = interview.changing && interview.changing.field === question.field && (interview.changing.key || "") === (question.key || "");
    if (changed) clearDirectDependents(interview, question.field, located.data);
    if (located.data && (changed || question.field === "classSkills")) {
      const refreshed = await this._builderData(interview.selections);
      if (refreshed.error) {
        delete interview.changing;
        await this._save();
        return refreshed.error;
      }
      reconcileFeatureSelections(interview, refreshed.data);
    }
    delete interview.changing;
    await this._save();
    return this._presentInterview(member, contextId, interview);
  }

  async _presentInterview(member, contextId, interview, prefix = "") {
    const located = await this._interviewQuestion(interview);
    if (located.error) return located.error;
    if (located.question) return interviewOutput(interview, located.question, prefix);
    const selections = structuredClone(interview.selections);
    if (!isRecord(selections.featureChoices)) selections.featureChoices = {};
    const plan = cleanVttCharacterPlan({ version: 1, selections, suggestions: interview.suggestions });
    const reply = await this._runCharacterHandoff(plan, false);
    reply.interview = this._interviewSummary(interview, reply.characterHandoff?.status || "blocked");
    if (reply.characterHandoff?.status === "review") {
      member.builders[contextId] = {
        stage: "vtt-review",
        plan,
        reviewFingerprint: reply.characterHandoff.reviewFingerprint,
        interview
      };
      await this._save();
    }
    return reply;
  }

  async _interviewQuestion(interview) {
    const need = currentNeed(interview);
    if (need) return { question: pendingQuestion(interview, need), data: null };
    const loaded = await this._builderData(interview.selections);
    if (loaded.error) return loaded;
    try {
      const question = nextVttQuestion(interview, loaded.data);
      return { question: pendingQuestion(interview, question), data: loaded.data };
    } catch {
      return { error: output("unavailable", "character-builder", VTT_DATA_UNAVAILABLE) };
    }
  }

  async _builderData(selections) {
    if (!this.characterBuilderData) return { error: output("unavailable", "character-builder", VTT_DATA_UNAVAILABLE) };
    try {
      return { data: cleanVttCharacterData(await this.characterBuilderData(structuredClone(selections))) };
    } catch {
      return { error: output("unavailable", "character-builder", VTT_DATA_UNAVAILABLE) };
    }
  }

  async _reviewInterviewPlan(member, contextId, current) {
    const reply = await this._runCharacterHandoff(current.plan, false);
    reply.interview = this._interviewSummary(current.interview, reply.characterHandoff?.status || "blocked");
    if (reply.characterHandoff?.status === "review") {
      member.builders[contextId] = {
        stage: "vtt-review",
        plan: current.plan,
        reviewFingerprint: reply.characterHandoff.reviewFingerprint,
        interview: current.interview
      };
      await this._save();
    }
    return reply;
  }

  _interviewSummary(interview, status) {
    return {
      status,
      needs: structuredClone(interview.needs),
      selections: structuredClone(interview.selections),
      suggestions: structuredClone(interview.suggestions),
      advice: [],
      ...(interview.unresolved ? { unresolved: structuredClone(interview.unresolved) } : {})
    };
  }

  async _runCharacterHandoff(plan, allowComplete) {
    if (!this.characterHandoff) return output("unavailable", "character-builder", VTT_HANDOFF_UNAVAILABLE);
    try {
      return vttHandoffOutput(cleanVttHandoffResult(await this.characterHandoff(structuredClone(plan)), allowComplete));
    } catch {
      return output("unavailable", "character-builder", VTT_HANDOFF_UNAVAILABLE);
    }
  }

  _rollUsage(state) {
    const periods = periodKeys(this.now());
    if (state.usage.day !== periods.day) {
      state.usage.day = periods.day;
      state.usage.dailyByMember = {};
    }
    if (state.usage.month !== periods.month) {
      state.usage.month = periods.month;
      state.usage.spentCents = 0;
    }
  }

  async _callResponder(state, memberId, event, request) {
    if (!hasGrounding(request)) {
      return output("clarify", request.mode, "I don’t have enough player-visible evidence to establish that. What exact rule text or visible fact should I use?");
    }
    this._rollUsage(state);
    const count = state.usage.dailyByMember[memberId] || 0;
    if (event.providerBalanceAvailable !== true || count >= this.dailyLimit || state.usage.spentCents + this.costPerAnswerCents > this.monthlyLimitCents) {
      return output("limit", request.mode, "I can’t answer more model-backed questions right now because Familiar’s usage limit has been reached; please try again after the applicable limit resets.");
    }
    state.usage.dailyByMember[memberId] = count + 1;
    state.usage.spentCents += this.costPerAnswerCents;
    await this._save();
    try {
      const raw = await this.responder(structuredClone(request));
      const answer = shortText(raw?.answer, "Responder answer", 2000);
      const supporting = Array.isArray(raw?.supportingLines) ? raw.supportingLines.map((line) => shortText(line, "Supporting line", 500)) : [];
      const source = raw?.source ? shortText(raw.source, "Source", 300) : "";
      if (contradictsBonusActionRule(request, answer, supporting)) throw new Error("Responder contradicted supplied spellcasting evidence.");
      if (request.answerMode === "quick-fact") {
        return output("answer", request.mode, source && !answer.includes(source) ? `${answer} (${source})` : answer);
      }
      const lines = source && !supporting.some((line) => line.includes(source)) ? [...supporting.slice(0, 3), `Source: ${source}`] : supporting;
      return output("answer", request.mode, answer, lines);
    } catch {
      // A failed provider attempt may still be billable, so its reservation is not refunded.
      return output("unavailable", request.mode, "I can’t answer that right now; please try again later.");
    }
  }
}

module.exports = { PlayerHelp, VTT_FOUNDATION, assessBuildPlan };
