import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCharacterSheet, importCharacterSheet } from "../lib/character-sheet.ts";

test("player-character/1 envelope reviews first and returns a hashed native-v2 result only after exact confirmation", async () => {
  const envelope = supportedEnvelope();
  const review = await prepare(envelope);

  assert.equal(review.contract, "player-character");
  assert.equal(review.version, "player-character/1");
  assert.equal(review.owner, "20fates-vtt");
  assert.deepEqual(review.source, {
    project: "20fates-vtt",
    builderRevision: "revised-2024-level-one/1",
    nativeFormatVersion: 2,
  });
  assert.equal(review.visibility, "player-owned");
  assert.equal(review.payload.status, "review");
  assert.equal(review.payload.nativeDraft, null);
  assert.equal(review.payload.contentHash, null);
  assert.equal(review.freshness.confirmedAt, null);
  assert.match(review.freshness.reviewFingerprint ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(review.payload.validation, {
    selections: "supported",
    builder: "passed",
    nativeRoundTrip: "not-run",
    ownershipRebinding: "not-run",
  });

  envelope.freshness.reviewFingerprint = review.freshness.reviewFingerprint;
  envelope.freshness.confirmedAt = "2026-08-16T17:00:00.000Z";
  const complete = await prepare(envelope);
  const nativeJson = `${JSON.stringify(complete.payload.nativeDraft, null, 2)}\n`;

  assert.equal(complete.payload.status, "complete");
  assert.ok(complete.payload.nativeDraft);
  assert.equal(complete.payload.nativeDraft.version, 2);
  assert.equal(complete.freshness.confirmedAt, "2026-08-16T17:00:00.000Z");
  assert.equal(complete.payload.contentHash, `sha256:${createHash("sha256").update(nativeJson).digest("hex")}`);
  assert.deepEqual(complete.payload.validation, {
    selections: "supported",
    builder: "passed",
    nativeRoundTrip: "passed",
    ownershipRebinding: "passed",
  });
});

test("player-character/1 envelope rejects every required trust-boundary failure without a native draft", async () => {
  const review = await prepare(supportedEnvelope());
  const confirmed = supportedEnvelope();
  confirmed.freshness.reviewFingerprint = review.freshness.reviewFingerprint;
  confirmed.freshness.confirmedAt = "2026-08-16T17:00:00.000Z";
  const cases: Array<[string, (value: ReturnType<typeof supportedEnvelope>) => void]> = [
    ["missing contract", (value) => unset(value, "contract")],
    ["missing version", (value) => unset(value, "version")],
    ["unsupported major version", (value) => { value.version = "player-character/2"; }],
    ["missing owner", (value) => unset(value, "owner")],
    ["wrong owner", (value) => { value.owner = "20fates-familiar"; }],
    ["missing source", (value) => unset(value, "source")],
    ["wrong source", (value) => { value.source.project = "20fates-familiar"; }],
    ["missing builder revision", (value) => unset(value.source, "builderRevision")],
    ["stale builder revision", (value) => { value.source.builderRevision = "revised-2024-level-one/0"; value.freshness.builderRevision = "revised-2024-level-one/0"; }],
    ["contradictory builder revision", (value) => { value.freshness.builderRevision = "revised-2024-level-one/0"; }],
    ["missing native format", (value) => unset(value.source, "nativeFormatVersion")],
    ["wrong native format", (value) => { value.source.nativeFormatVersion = 1; value.freshness.nativeFormatVersion = 1; }],
    ["contradictory native format", (value) => { value.freshness.nativeFormatVersion = 1; }],
    ["missing freshness", (value) => unset(value, "freshness")],
    ["missing freshness revision", (value) => unset(value.freshness, "builderRevision")],
    ["missing freshness native format", (value) => unset(value.freshness, "nativeFormatVersion")],
    ["missing validation request", (value) => unset(value.freshness, "validation")],
    ["missing invalidation rule", (value) => unset(value.freshness, "invalidation")],
    ["unsupported invalidation rule", (value) => { value.freshness.invalidation = "never"; }],
    ["missing fingerprint", (value) => unset(value.freshness, "reviewFingerprint")],
    ["malformed fingerprint", (value) => { value.freshness.reviewFingerprint = "confirmed"; }],
    ["missing confirmation time", (value) => { value.freshness.confirmedAt = null; }],
    ["malformed confirmation time", (value) => { value.freshness.confirmedAt = "yesterday"; }],
    ["contradictory confirmation", (value) => { value.freshness.reviewFingerprint = null; }],
    ["missing visibility", (value) => unset(value, "visibility")],
    ["wrong visibility", (value) => { value.visibility = "DM-private"; }],
    ["missing payload", (value) => unset(value, "payload")],
    ["missing selections", (value) => unset(value.payload, "selections")],
    ["missing suggestions", (value) => unset(value.payload, "suggestions")],
    ["malformed payload", (value) => { value.payload.selections = "Fighter" as unknown as Record<string, unknown>; }],
    ["unexpected envelope authority", (value) => { (value as unknown as Record<string, unknown>).roomCode = "ROOM"; }],
    ["unexpected payload authority", (value) => { (value.payload as unknown as Record<string, unknown>).campaignCanon = "secret"; }],
    ["stale fingerprint", (value) => { value.freshness.reviewFingerprint = `sha256:${"0".repeat(64)}`; }],
  ];

  for (const [label, mutate] of cases) {
    const candidate = structuredClone(confirmed);
    mutate(candidate);
    const result = await prepare(candidate);
    assert.notEqual(result.payload.status, "complete", label);
    assert.equal(result.payload.nativeDraft, null, label);
    assert.equal(result.payload.contentHash, null, label);
  }
});

test("suggested but unselected choices never export", async () => {
  const plan = supportedEnvelope();
  delete plan.payload.selections.className;
  plan.payload.suggestions.className = "Fighter";

  const result = await prepare(plan);

  assert.equal(result.payload.status, "incomplete");
  assert.equal(result.payload.nativeDraft, null);
  assert.equal(result.payload.review.selections.className, undefined);
  assert.equal(result.payload.review.suggestions.className, "Fighter");
  assert.match(result.payload.reasons.join(" "), /class.*suggested|suggested.*class/i);
});

test("explicit supported selections require the exact reviewed fingerprint and round-trip", async () => {
  const plan = supportedEnvelope();
  const review = await prepare(plan);

  assert.equal(review.payload.status, "review");
  assert.equal(review.payload.nativeDraft, null);
  assert.equal(review.payload.confirmationRequired, true);
  assert.match(review.freshness.reviewFingerprint ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(review.payload.review.summary, {
    rules: "Revised 2024",
    level: 1,
    name: "Aria Vale",
    className: "Fighter",
    species: "Human",
    background: "Soldier",
    size: "Medium",
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    backgroundBoosts: "+2 Strength, +1 Constitution",
    finalScores: { str: 17, dex: 13, con: 15, int: 8, wis: 12, cha: 10 },
    classSkills: ["Perception", "Survival"],
    languages: ["Common", "Elvish", "Orc"],
    featureChoices: [
      { title: "Fighting Style", selections: ["Protection"] },
      { title: "Weapon Mastery", selections: ["Javelin", "Longsword", "Warhammer"] },
      { title: "Skillful", selections: ["Insight"] },
      { title: "Versatile", selections: ["Tough"] },
    ],
    startingEquipment: [
      "Chain Mail", "Greatsword", "Flail", "8 Javelin", "Dungeoneer's Pack",
      "Spear", "Shortbow", "20 Arrows", "Gaming Set", "Healer's Kit", "Quiver", "Traveler's Clothes",
    ],
    unfinished: ["attacks", "spells", "subclasses", "later levels"],
  });

  const genericPlan = structuredClone(plan);
  confirm(genericPlan, "confirmed");
  const generic = await prepare(genericPlan);
  assert.equal(generic.payload.status, "incomplete");
  assert.equal(generic.payload.nativeDraft, null);
  assert.match(generic.payload.reasons.join(" "), /fingerprint.*malformed/i);

  confirm(plan, review.freshness.reviewFingerprint!);
  const complete = await prepare(plan);
  assert.equal(complete.payload.status, "complete");
  assert.equal(complete.payload.confirmationRequired, false);
  assert.ok(complete.payload.nativeDraft);
  const character = complete.payload.nativeDraft;
  assert.equal(character.version, 2);
  assert.equal(character.name, "Aria Vale");
  assert.equal(character.identity.className, "Fighter");
  assert.equal(character.attacks.length, 0);
  assert.equal(character.spellcasting.spells.length, 0);
});

test("a review fingerprint becomes stale when any meaningful selection changes", async () => {
  const plan = supportedEnvelope();
  const firstReview = await prepare(plan);
  assert.ok(firstReview.freshness.reviewFingerprint);
  confirm(plan, firstReview.freshness.reviewFingerprint);
  const choices = plan.payload.selections.featureChoices as Record<string, string[]>;
  choices["fighter-fighting-style"] = ["Defense"];

  const stale = await prepare(plan);

  assert.equal(stale.payload.status, "review");
  assert.equal(stale.payload.confirmationRequired, true);
  assert.equal(stale.payload.nativeDraft, null);
  assert.notEqual(stale.freshness.reviewFingerprint, firstReview.freshness.reviewFingerprint);
  assert.match(stale.payload.reasons.join(" "), /does not match.*review|fresh review/i);
});

test("unsupported player intent is preserved and marked incomplete without substitution", async () => {
  const plan = supportedEnvelope();
  plan.payload.selections.className = "Artificer";
  plan.payload.suggestions.className = "Fighter";

  const result = await prepare(plan);

  assert.equal(result.payload.status, "incomplete");
  assert.equal(result.payload.nativeDraft, null);
  assert.equal(result.payload.review.selections.className, "Artificer");
  assert.equal(result.payload.review.suggestions.className, "Fighter");
  assert.match(result.payload.reasons.join(" "), /valid class|supported class/i);
});

test("native validation and structural round-trip failures produce no JSON", async () => {
  const malformedPlan = supportedEnvelope();
  malformedPlan.payload.selections = "Fighter" as unknown as Record<string, unknown>;
  malformedPlan.payload.suggestions = [] as unknown as Record<string, unknown>;
  const malformed = await prepare(malformedPlan);
  assert.equal(malformed.payload.status, "incomplete");
  assert.equal(malformed.payload.nativeDraft, null);
  assert.match(malformed.payload.reasons.join(" "), /selections.*object|suggestions.*object/i);

  const invalid = supportedEnvelope();
  invalid.payload.selections.languages = ["Elvish", "Elvish"];
  const validationFailure = await prepare(invalid);
  assert.equal(validationFailure.payload.status, "incomplete");
  assert.equal(validationFailure.payload.nativeDraft, null);
  assert.match(validationFailure.payload.reasons.join(" "), /two different languages/i);

  const lossy = supportedEnvelope();
  lossy.payload.selections.name = "A".repeat(81);
  const lossyReview = await prepare(lossy);
  assert.ok(lossyReview.freshness.reviewFingerprint);
  confirm(lossy, lossyReview.freshness.reviewFingerprint);
  const roundTripFailure = await prepare(lossy);
  assert.equal(roundTripFailure.payload.status, "incomplete");
  assert.equal(roundTripFailure.payload.nativeDraft, null);
  assert.match(roundTripFailure.payload.reasons.join(" "), /round.?trip/i);
});

test("native JSON uses disposable IDs that the existing importer rebinds", async () => {
  const plan = supportedEnvelope();
  const review = await prepare(plan);
  assert.ok(review.freshness.reviewFingerprint);
  confirm(plan, review.freshness.reviewFingerprint);
  const result = await prepare(plan);
  assert.equal(result.payload.status, "complete");
  assert.ok(result.payload.nativeDraft);

  const character = result.payload.nativeDraft;
  assert.equal(character.id, "sheet-familiar-draft");
  assert.equal(character.tokenId, "token-familiar-draft");

  const destination = createCharacterSheet("token-player-owned", "Aria", "sheet-player-owned");
  const imported = importCharacterSheet(character, destination);
  assert.equal(imported.id, "sheet-player-owned");
  assert.equal(imported.tokenId, "token-player-owned");
  assert.equal(imported.name, "Aria Vale");
});

test("the handoff has no reachable network or live-state path", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Network access is forbidden in this test.");
  }) as typeof fetch;

  try {
    const plan = supportedEnvelope();
    const review = await prepare(plan);
    assert.ok(review.freshness.reviewFingerprint);
    confirm(plan, review.freshness.reviewFingerprint);
    assert.equal((await prepare(plan)).payload.status, "complete");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);

  const adapterSource = readFileSync(new URL("../lib/character-handoff.ts", import.meta.url), "utf8");
  const commandSource = readFileSync(new URL("../scripts/prepare-character-handoff.ts", import.meta.url), "utf8");
  assert.doesNotMatch(adapterSource, /from\s+["'][^"']*(?:room-state|Tabletop|GameFamiliar|worker)[^"']*["']/i);
  assert.doesNotMatch(`${adapterSource}\n${commandSource}`, /\bfetch\s*\(|\/api\/|discord/i);
});

async function prepare(plan: unknown) {
  const { prepareFamiliarCharacterHandoff } = await import("../lib/character-handoff.ts");
  return prepareFamiliarCharacterHandoff(plan);
}

function supportedPlan() {
  return {
    version: 1,
    selections: {
      name: "Aria Vale",
      className: "Fighter",
      species: "Human",
      heritage: "",
      background: "Soldier",
      size: "Medium",
      baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      boostMode: "2+1",
      boostTwo: "str",
      boostOne: "con",
      classSkills: ["perception", "survival"],
      languages: ["Elvish", "Orc"],
      featureChoices: {
        "fighter-fighting-style": ["Protection"],
        "fighter-weapon-mastery": ["Javelin", "Longsword", "Warhammer"],
        "human-skillful": ["insight"],
        "human-origin-feat": ["Tough"],
      },
    } as Record<string, unknown>,
    suggestions: {} as Record<string, unknown>,
    confirmation: undefined as string | undefined,
  };
}

function supportedEnvelope() {
  const plan = supportedPlan();
  return {
    contract: "player-character",
    version: "player-character/1",
    owner: "20fates-vtt",
    source: {
      project: "20fates-vtt",
      builderRevision: "revised-2024-level-one/1",
      nativeFormatVersion: 2,
    },
    freshness: {
      builderRevision: "revised-2024-level-one/1",
      nativeFormatVersion: 2,
      validation: "pending",
      reviewFingerprint: null as string | null,
      confirmedAt: null as string | null,
      invalidation: "any-choice-or-vtt-revision-change",
    },
    visibility: "player-owned",
    payload: {
      selections: plan.selections,
      suggestions: plan.suggestions,
    },
  };
}

function unset(value: object, key: string) {
  delete (value as Record<string, unknown>)[key];
}

function confirm(envelope: ReturnType<typeof supportedEnvelope>, reviewFingerprint: string) {
  envelope.freshness.reviewFingerprint = reviewFingerprint;
  envelope.freshness.confirmedAt = "2026-08-16T17:00:00.000Z";
}
