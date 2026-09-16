import { createHash } from "node:crypto";
import {
  applyCharacterBuild,
  builderBackgrounds,
  builderSpecies,
  featureChoicesForBuild,
  type CharacterBuild,
  validateCharacterBuild,
} from "./character-builder.ts";
import {
  abilityKeys,
  type AbilityKey,
  type CharacterSheet,
  createCharacterSheet,
  importCharacterSheet,
  skillDefinitions,
} from "./character-sheet.ts";

const disposableSheetId = "sheet-familiar-draft";
const disposableTokenId = "token-familiar-draft";
const roundTripSheetId = "sheet-round-trip-check";
const roundTripTokenId = "token-round-trip-check";
export const playerCharacterContract = "player-character" as const;
export const playerCharacterVersion = "player-character/1" as const;
export const playerCharacterOwner = "20fates-vtt" as const;
export const playerCharacterVisibility = "player-owned" as const;
export const characterBuilderRevision = "revised-2024-level-one/1" as const;
export const nativeCharacterFormatVersion = 2 as const;
export const playerCharacterInvalidation = "any-choice-or-vtt-revision-change" as const;
const unfinished = ["attacks", "spells", "subclasses", "later levels"] as const;
const buildFields = new Set<keyof CharacterBuild>([
  "name", "className", "species", "heritage", "background", "size", "baseScores",
  "boostMode", "boostTwo", "boostOne", "classSkills", "languages", "featureChoices",
]);
const envelopeFields = new Set(["contract", "version", "owner", "source", "freshness", "visibility", "payload"]);
const sourceFields = new Set(["project", "builderRevision", "nativeFormatVersion"]);
const freshnessFields = new Set(["builderRevision", "nativeFormatVersion", "validation", "reviewFingerprint", "confirmedAt", "invalidation"]);
const requestPayloadFields = new Set(["selections", "suggestions"]);

export type PlayerCharacterRequestEnvelope = {
  contract: typeof playerCharacterContract;
  version: typeof playerCharacterVersion;
  owner: typeof playerCharacterOwner;
  source: ContractSource;
  freshness: ContractFreshness & {
    validation: "pending";
  };
  visibility: typeof playerCharacterVisibility;
  payload: {
    selections: Partial<CharacterBuild> & Record<string, unknown>;
    suggestions: Partial<CharacterBuild> & Record<string, unknown>;
  };
};

export type CharacterReviewSummary = {
  rules: "Revised 2024";
  level: 1;
  name: string;
  className: string;
  species: string;
  background: string;
  size: string;
  baseScores: Record<AbilityKey, number>;
  backgroundBoosts: string;
  finalScores: Record<AbilityKey, number>;
  classSkills: string[];
  languages: string[];
  featureChoices: Array<{ title: string; selections: string[] }>;
  startingEquipment: string[];
  unfinished: Array<(typeof unfinished)[number]>;
};

type ContractSource = {
  project: typeof playerCharacterOwner;
  builderRevision: typeof characterBuilderRevision;
  nativeFormatVersion: typeof nativeCharacterFormatVersion;
};

type ContractFreshness = {
  builderRevision: typeof characterBuilderRevision;
  nativeFormatVersion: typeof nativeCharacterFormatVersion;
  reviewFingerprint: string | null;
  confirmedAt: string | null;
  invalidation: typeof playerCharacterInvalidation;
};

type ValidationEvidence = {
  selections: "supported" | "incomplete";
  builder: "passed" | "failed" | "not-run";
  nativeRoundTrip: "passed" | "failed" | "not-run";
  ownershipRebinding: "passed" | "failed" | "not-run";
};

export type CharacterHandoffResultEnvelope = {
  contract: typeof playerCharacterContract;
  version: typeof playerCharacterVersion;
  owner: typeof playerCharacterOwner;
  source: ContractSource;
  freshness: ContractFreshness & {
    validation: "incomplete" | "review" | "complete";
  };
  visibility: typeof playerCharacterVisibility;
  payload: {
    status: "incomplete" | "review" | "complete";
    confirmationRequired: boolean;
    reasons: string[];
    review: {
      selections: Record<string, unknown>;
      suggestions: Record<string, unknown>;
      summary: CharacterReviewSummary | null;
    };
    validation: ValidationEvidence;
    nativeDraft: CharacterSheet | null;
    contentHash: string | null;
  };
};

export function prepareFamiliarCharacterHandoff(value: unknown): CharacterHandoffResultEnvelope {
  const envelope = record(value);
  const source = record(envelope.source);
  const freshness = record(envelope.freshness);
  const payload = record(envelope.payload);
  const selections = cloneRecord(payload.selections);
  const suggestions = cloneRecord(payload.suggestions);
  const review: CharacterHandoffResultEnvelope["payload"]["review"] = { selections, suggestions, summary: null };
  const reasons = validateEnvelope(envelope, source, freshness, payload);

  for (const field of Object.keys(selections)) {
    if (!buildFields.has(field as keyof CharacterBuild)) {
      reasons.push(`Unsupported player choice field "${field}" was preserved but cannot be exported.`);
    }
  }
  for (const field of Object.keys(suggestions)) {
    if (!buildFields.has(field as keyof CharacterBuild)) {
      reasons.push(`Unsupported Familiar suggestion field "${field}" was preserved but cannot enter this handoff.`);
    }
  }
  if (reasons.length) return incomplete(review, reasons);

  const name = selectedString("name", selections, suggestions, reasons);
  const className = selectedString("className", selections, suggestions, reasons);
  const speciesName = selectedString("species", selections, suggestions, reasons);
  const backgroundName = selectedString("background", selections, suggestions, reasons);
  const speciesData = builderSpecies.find((candidate) => candidate.name === speciesName);
  const backgroundData = builderBackgrounds.find((candidate) => candidate.name === backgroundName);
  const heritage = speciesData?.heritages
    ? selectedString("heritage", selections, suggestions, reasons, true)
    : optionalEmptyString("heritage", selections, reasons);
  const size = speciesData?.sizes.length === 1
    ? optionalFixedString("size", speciesData.sizes[0], selections, reasons)
    : selectedString("size", selections, suggestions, reasons);
  const baseScores = selectedScores(selections, suggestions, reasons);
  const boostMode = selectedBoostMode(selections, suggestions, reasons);
  const boostTwo = boostMode === "1+1+1" && backgroundData
    ? backgroundData.abilities[0]
    : selectedAbility("boostTwo", selections, suggestions, reasons);
  const boostOne = boostMode === "1+1+1" && backgroundData
    ? backgroundData.abilities[1]
    : selectedAbility("boostOne", selections, suggestions, reasons);
  const classSkills = selectedStrings("classSkills", selections, suggestions, reasons);
  const languages = selectedLanguages(selections, suggestions, reasons);
  const rawFeatureChoices = selectedFeatureChoices(selections, reasons);

  if (reasons.length || name === null || className === null || speciesName === null || backgroundName === null ||
    heritage === null || size === null || baseScores === null || boostMode === null || boostTwo === null ||
    boostOne === null || classSkills === null || languages === null || rawFeatureChoices === null) {
    return incomplete(review, reasons, { selections: "incomplete", builder: "failed", nativeRoundTrip: "not-run", ownershipRebinding: "not-run" });
  }

  const build: CharacterBuild = {
    name,
    className,
    species: speciesName,
    heritage,
    background: backgroundName,
    size,
    baseScores,
    boostMode,
    boostTwo,
    boostOne,
    classSkills: classSkills as CharacterBuild["classSkills"],
    languages,
    featureChoices: rawFeatureChoices,
  };
  const activeFeatureChoices = featureChoicesForBuild(build);
  if (!hasOwn(selections, "featureChoices") && activeFeatureChoices.length > 0) {
    reasons.push(missingChoiceReason("featureChoices", suggestions));
  }
  const activeFeatureIds = new Set(activeFeatureChoices.map(({ id }) => id));
  for (const id of Object.keys(build.featureChoices)) {
    if (!activeFeatureIds.has(id)) reasons.push(`Unsupported player feature choice "${id}" was preserved but cannot be exported.`);
  }
  reasons.push(...validateCharacterBuild(build));
  if (reasons.length) return incomplete(review, reasons, { selections: "incomplete", builder: "failed", nativeRoundTrip: "not-run", ownershipRebinding: "not-run" });

  let character: CharacterSheet;
  try {
    character = applyCharacterBuild(createCharacterSheet(disposableTokenId, name, disposableSheetId), build);
  } catch (error) {
    return incomplete(review, [message(error, "The VTT builder could not apply these choices.")], { selections: "incomplete", builder: "failed", nativeRoundTrip: "not-run", ownershipRebinding: "not-run" });
  }
  review.summary = summarize(build, character);
  const reviewFingerprint = fingerprint(review);
  const confirmedFingerprint = freshness.reviewFingerprint as string | null;

  if (confirmedFingerprint !== reviewFingerprint) {
    return reviewed(
      review,
      confirmedFingerprint === null
        ? []
        : ["Confirmation does not match this exact review; present the fresh review and return its review fingerprint."],
      reviewFingerprint,
    );
  }

  const exported = JSON.parse(JSON.stringify(character)) as unknown;
  const destination = createCharacterSheet(roundTripTokenId, character.name, roundTripSheetId);
  let imported: CharacterSheet;
  try {
    imported = importCharacterSheet(exported, destination);
  } catch (error) {
    return incomplete(review, [message(error, "The native export/import round trip failed.")], { selections: "supported", builder: "passed", nativeRoundTrip: "failed", ownershipRebinding: "failed" });
  }
  const expected = { ...character, id: roundTripSheetId, tokenId: roundTripTokenId };
  if (stableJson(imported) !== stableJson(expected)) {
    return incomplete(review, ["The native export/import round trip changed the character draft."], { selections: "supported", builder: "passed", nativeRoundTrip: "failed", ownershipRebinding: "failed" });
  }

  const nativeJson = `${JSON.stringify(character, null, 2)}\n`;
  return resultEnvelope("complete", review, [], {
    selections: "supported",
    builder: "passed",
    nativeRoundTrip: "passed",
    ownershipRebinding: "passed",
  }, reviewFingerprint, freshness.confirmedAt as string, character, hash(nativeJson));
}

function validateEnvelope(
  envelope: Record<string, unknown>,
  source: Record<string, unknown>,
  freshness: Record<string, unknown>,
  payload: Record<string, unknown>,
): string[] {
  const reasons: string[] = [];
  rejectUnknown(envelope, envelopeFields, "envelope", reasons);
  rejectUnknown(source, sourceFields, "source", reasons);
  rejectUnknown(freshness, freshnessFields, "freshness", reasons);
  rejectUnknown(payload, requestPayloadFields, "payload", reasons);
  if (envelope.contract !== playerCharacterContract) reasons.push(`Use contract ${playerCharacterContract}.`);
  if (envelope.version !== playerCharacterVersion) reasons.push(`Use contract version ${playerCharacterVersion}; unsupported major versions fail closed.`);
  if (envelope.owner !== playerCharacterOwner) reasons.push(`The player-character contract owner must be ${playerCharacterOwner}.`);
  if (envelope.visibility !== playerCharacterVisibility) reasons.push(`Player-character visibility must be ${playerCharacterVisibility}.`);
  if (!isRecord(envelope.source)) reasons.push("The VTT source record is required.");
  if (source.project !== playerCharacterOwner) reasons.push(`The source project must be ${playerCharacterOwner}.`);
  if (source.builderRevision !== characterBuilderRevision) reasons.push(`Builder revision ${characterBuilderRevision} is required; this draft is stale.`);
  if (source.nativeFormatVersion !== nativeCharacterFormatVersion) reasons.push(`Native character format version ${nativeCharacterFormatVersion} is required.`);
  if (!isRecord(envelope.freshness)) reasons.push("The handoff freshness record is required.");
  if (freshness.builderRevision !== characterBuilderRevision || freshness.builderRevision !== source.builderRevision) reasons.push("Freshness contradicts the current VTT builder revision.");
  if (freshness.nativeFormatVersion !== nativeCharacterFormatVersion || freshness.nativeFormatVersion !== source.nativeFormatVersion) reasons.push("Freshness contradicts the native character format version.");
  if (freshness.validation !== "pending") reasons.push("Familiar must submit validation as pending for VTT revalidation.");
  if (freshness.invalidation !== playerCharacterInvalidation) reasons.push("The handoff invalidation condition is missing or unsupported.");
  if (!hasOwn(freshness, "reviewFingerprint")) reasons.push("The review fingerprint field is required, using null before review.");
  if (!hasOwn(freshness, "confirmedAt")) reasons.push("The confirmation time field is required, using null before review.");
  const fingerprintValue = freshness.reviewFingerprint;
  const confirmedAt = freshness.confirmedAt;
  if (fingerprintValue !== null && !/^sha256:[0-9a-f]{64}$/.test(String(fingerprintValue))) reasons.push("The review fingerprint is malformed.");
  if (confirmedAt !== null && !isExactIsoTime(confirmedAt)) reasons.push("The confirmation time is malformed.");
  if ((fingerprintValue === null) !== (confirmedAt === null)) reasons.push("Confirmation fingerprint and time must be supplied together.");
  if (!isRecord(envelope.payload)) reasons.push("The bounded player-character payload is required.");
  if (!isRecord(payload.selections)) reasons.push("Player selections must be a JSON object.");
  if (!isRecord(payload.suggestions)) reasons.push("Familiar suggestions must be a separately labeled JSON object.");
  return reasons;
}

function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>, label: string, reasons: string[]) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) reasons.push(`Unexpected player-character ${label} field "${field}" is not permitted.`);
  }
}

function isExactIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function summarize(build: CharacterBuild, character: CharacterSheet): CharacterReviewSummary {
  const choices = featureChoicesForBuild(build);
  const background = builderBackgrounds.find(({ name }) => name === build.background)!;
  const label = (ability: AbilityKey) => character.abilities[ability].label;
  return {
    rules: "Revised 2024",
    level: 1,
    name: character.name,
    className: build.className,
    species: build.heritage ? `${build.species} (${build.heritage})` : build.species,
    background: build.background,
    size: build.size,
    baseScores: { ...build.baseScores },
    backgroundBoosts: build.boostMode === "1+1+1"
      ? background.abilities.map((ability) => `+1 ${label(ability)}`).join(", ")
      : `+2 ${label(build.boostTwo)}, +1 ${label(build.boostOne)}`,
    finalScores: Object.fromEntries(abilityKeys.map((ability) => [ability, character.abilities[ability].score])) as Record<AbilityKey, number>,
    classSkills: build.classSkills.map((id) => skillDefinitions.find((skill) => skill.id === id)?.label ?? id),
    languages: ["Common", ...build.languages],
    featureChoices: choices.map((choice) => ({
      title: choice.title,
      selections: (build.featureChoices[choice.id] ?? []).map((value) =>
        choice.options.find((option) => option.value === value)?.label ?? value,
      ),
    })),
    startingEquipment: character.inventory.map((item) => `${item.quantity > 1 ? `${item.quantity} ` : ""}${item.name}`),
    unfinished: [...unfinished],
  };
}

function incomplete(
  review: CharacterHandoffResultEnvelope["payload"]["review"],
  reasons: string[],
  validation: ValidationEvidence = { selections: "incomplete", builder: "not-run", nativeRoundTrip: "not-run", ownershipRebinding: "not-run" },
): CharacterHandoffResultEnvelope {
  return resultEnvelope(
    "incomplete",
    review,
    reasons.length ? [...new Set(reasons)] : ["The character plan is incomplete."],
    validation,
    null,
    null,
    null,
    null,
  );
}

function reviewed(
  review: CharacterHandoffResultEnvelope["payload"]["review"],
  reasons: string[],
  reviewFingerprint: string,
): CharacterHandoffResultEnvelope {
  return resultEnvelope("review", review, reasons, {
    selections: "supported",
    builder: "passed",
    nativeRoundTrip: "not-run",
    ownershipRebinding: "not-run",
  }, reviewFingerprint, null, null, null);
}

function resultEnvelope(
  status: CharacterHandoffResultEnvelope["payload"]["status"],
  review: CharacterHandoffResultEnvelope["payload"]["review"],
  reasons: string[],
  validation: ValidationEvidence,
  reviewFingerprint: string | null,
  confirmedAt: string | null,
  nativeDraft: CharacterSheet | null,
  contentHash: string | null,
): CharacterHandoffResultEnvelope {
  return {
    contract: playerCharacterContract,
    version: playerCharacterVersion,
    owner: playerCharacterOwner,
    source: {
      project: playerCharacterOwner,
      builderRevision: characterBuilderRevision,
      nativeFormatVersion: nativeCharacterFormatVersion,
    },
    freshness: {
      builderRevision: characterBuilderRevision,
      nativeFormatVersion: nativeCharacterFormatVersion,
      validation: status,
      reviewFingerprint,
      confirmedAt: status === "complete" ? confirmedAt : null,
      invalidation: playerCharacterInvalidation,
    },
    visibility: playerCharacterVisibility,
    payload: {
      status,
      confirmationRequired: status === "review",
      reasons,
      review,
      validation,
      nativeDraft,
      contentHash,
    },
  };
}

function selectedString(
  field: keyof CharacterBuild,
  selections: Record<string, unknown>,
  suggestions: Record<string, unknown>,
  reasons: string[],
  allowEmpty = false,
): string | null {
  if (!hasOwn(selections, field)) {
    reasons.push(missingChoiceReason(field, suggestions));
    return null;
  }
  const value = selections[field];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    reasons.push(`${fieldLabel(field)} must be an explicit text selection.`);
    return null;
  }
  return value;
}

function optionalEmptyString(field: keyof CharacterBuild, selections: Record<string, unknown>, reasons: string[]): string | null {
  if (!hasOwn(selections, field)) return "";
  if (selections[field] !== "") {
    reasons.push(`${fieldLabel(field)} is unsupported for the selected species and was preserved without substitution.`);
    return null;
  }
  return "";
}

function optionalFixedString(field: keyof CharacterBuild, fixed: string, selections: Record<string, unknown>, reasons: string[]): string | null {
  if (!hasOwn(selections, field)) return fixed;
  if (selections[field] !== fixed) {
    reasons.push(`${fieldLabel(field)} must be ${fixed} for the selected species.`);
    return null;
  }
  return fixed;
}

function selectedScores(
  selections: Record<string, unknown>,
  suggestions: Record<string, unknown>,
  reasons: string[],
): Record<AbilityKey, number> | null {
  if (!hasOwn(selections, "baseScores")) {
    reasons.push(missingChoiceReason("baseScores", suggestions));
    return null;
  }
  const scores = record(selections.baseScores);
  if (Object.keys(scores).length !== abilityKeys.length || abilityKeys.some((ability) =>
    typeof scores[ability] !== "number" || !Number.isFinite(scores[ability]),
  )) {
    reasons.push("Ability scores must explicitly assign one number to each of the six abilities.");
    return null;
  }
  return Object.fromEntries(abilityKeys.map((ability) => [ability, scores[ability]])) as Record<AbilityKey, number>;
}

function selectedBoostMode(
  selections: Record<string, unknown>,
  suggestions: Record<string, unknown>,
  reasons: string[],
): CharacterBuild["boostMode"] | null {
  if (!hasOwn(selections, "boostMode")) {
    reasons.push(missingChoiceReason("boostMode", suggestions));
    return null;
  }
  const value = selections.boostMode;
  if (value !== "2+1" && value !== "1+1+1") {
    reasons.push("Background ability boosts must explicitly use +2/+1 or +1/+1/+1.");
    return null;
  }
  return value;
}

function selectedAbility(
  field: "boostTwo" | "boostOne",
  selections: Record<string, unknown>,
  suggestions: Record<string, unknown>,
  reasons: string[],
): AbilityKey | null {
  if (!hasOwn(selections, field)) {
    reasons.push(missingChoiceReason(field, suggestions));
    return null;
  }
  const value = selections[field];
  if (!abilityKeys.includes(value as AbilityKey)) {
    reasons.push(`${fieldLabel(field)} must be an explicit ability selection.`);
    return null;
  }
  return value as AbilityKey;
}

function selectedStrings(
  field: "classSkills",
  selections: Record<string, unknown>,
  suggestions: Record<string, unknown>,
  reasons: string[],
): string[] | null {
  if (!hasOwn(selections, field)) {
    reasons.push(missingChoiceReason(field, suggestions));
    return null;
  }
  const value = selections[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    reasons.push(`${fieldLabel(field)} must be an explicit list of selections.`);
    return null;
  }
  return [...value];
}

function selectedLanguages(
  selections: Record<string, unknown>,
  suggestions: Record<string, unknown>,
  reasons: string[],
): [string, string] | null {
  if (!hasOwn(selections, "languages")) {
    reasons.push(missingChoiceReason("languages", suggestions));
    return null;
  }
  const languages = selections.languages;
  if (!Array.isArray(languages) || languages.length !== 2 || languages.some((language) => typeof language !== "string")) {
    reasons.push("Languages must contain exactly two explicit player selections.");
    return null;
  }
  return [languages[0] as string, languages[1] as string];
}

function selectedFeatureChoices(selections: Record<string, unknown>, reasons: string[]): Record<string, string[]> | null {
  if (!hasOwn(selections, "featureChoices")) return {};
  const choices = record(selections.featureChoices);
  if (Object.values(choices).some((value) => !Array.isArray(value) || value.some((entry) => typeof entry !== "string"))) {
    reasons.push("Level-one feature choices must be explicit lists of player selections.");
    return null;
  }
  return Object.fromEntries(Object.entries(choices).map(([id, values]) => [id, [...values as string[]]]));
}

function missingChoiceReason(field: keyof CharacterBuild, suggestions: Record<string, unknown>): string {
  return hasOwn(suggestions, field)
    ? `${fieldLabel(field)} is only suggested; explicit player selection is required.`
    : `Unresolved player choice: ${fieldLabel(field)}.`;
}

function fieldLabel(field: keyof CharacterBuild): string {
  return ({
    name: "Character name",
    className: "Class",
    species: "Species",
    heritage: "Lineage or legacy",
    background: "Background",
    size: "Size",
    baseScores: "Ability scores",
    boostMode: "Background boost method",
    boostTwo: "+2 background ability",
    boostOne: "+1 background ability",
    classSkills: "Class skills",
    languages: "Languages",
    featureChoices: "Level-one feature choices",
  })[field];
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return { ...record(value) };
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value: Record<string, unknown>, field: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)))
      : entry,
  );
}

function fingerprint(review: CharacterHandoffResultEnvelope["payload"]["review"]): string {
  return hash(stableJson({
    contract: playerCharacterVersion,
    builderRevision: characterBuilderRevision,
    nativeFormatVersion: nativeCharacterFormatVersion,
    review,
  }));
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
