"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PlayerHelp } = require("../player-help.js");
const { createVttCharacterBridge } = require("../vtt-character-bridge.js");

const VTT_ROOT = process.env.FAMILIAR_VTT_ROOT || path.join(path.parse(__dirname).root, "Ambitions", "20fates-vtt");

async function fixture(t, vttRoot = VTT_ROOT, characterHandoff = createVttCharacterBridge({ vttRoot })) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "familiar-vtt-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "state.json");
  return {
    statePath,
    help: createHelp(statePath, vttRoot, characterHandoff),
  };
}

function createHelp(statePath, vttRoot = VTT_ROOT, characterHandoff = createVttCharacterBridge({ vttRoot })) {
  return new PlayerHelp({
    statePath,
    responder: async () => { throw new Error("The provider boundary must remain unused."); },
    characterHandoff,
    now: () => new Date("2026-08-16T17:00:00Z"),
  });
}

function event(content, builderAction) {
  return {
    authorId: "synthetic-player-17",
    contextId: "synthetic-builder-thread",
    inOfficialServer: true,
    mentioned: true,
    mode: "character-builder",
    content,
    builderAction,
  };
}

async function choose(help, plan) {
  return help.handle(event("These are my choices.", { type: "choose", plan }));
}

test("Familiar submits one player-character/1 envelope and accepts only its hashed native-v2 result envelope", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-envelope-vtt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const captureFile = path.join(root, "captured.jsonl");
  await fs.mkdir(path.join(root, "scripts"));
  await fs.writeFile(path.join(root, "scripts", "prepare-character-handoff.ts"), `
import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
const [inputFile, outputFile] = process.argv.slice(2);
const request = JSON.parse(await readFile(inputFile, "utf8"));
await appendFile(${JSON.stringify(captureFile)}, JSON.stringify(request) + "\\n");
const reviewFingerprint = "sha256:${"a".repeat(64)}";
const complete = Boolean(request.freshness?.reviewFingerprint);
const nativeDraft = complete ? { version: 2, name: "Aria Vale" } : null;
const nativeJson = nativeDraft ? JSON.stringify(nativeDraft, null, 2) + "\\n" : "";
if (nativeDraft) await writeFile(outputFile, nativeJson, { flag: "wx" });
const result = {
  contract: "player-character",
  version: "player-character/1",
  owner: "20fates-vtt",
  source: { project: "20fates-vtt", builderRevision: "revised-2024-level-one/1", nativeFormatVersion: 2 },
  freshness: {
    builderRevision: "revised-2024-level-one/1", nativeFormatVersion: 2,
    validation: complete ? "complete" : "review",
    reviewFingerprint, confirmedAt: complete ? request.freshness.confirmedAt : null,
    invalidation: "any-choice-or-vtt-revision-change"
  },
  visibility: "player-owned",
  payload: {
    status: complete ? "complete" : "review", confirmationRequired: !complete, reasons: [],
    review: { selections: request.payload?.selections ?? {}, suggestions: request.payload?.suggestions ?? {}, summary: { name: "Aria Vale" } },
    validation: {
      selections: "supported", builder: "passed",
      nativeRoundTrip: complete ? "passed" : "not-run",
      ownershipRebinding: complete ? "passed" : "not-run"
    },
    nativeDraft,
    contentHash: nativeDraft ? "sha256:" + createHash("sha256").update(nativeJson).digest("hex") : null
  }
};
process.stdout.write(JSON.stringify(result));
if (!complete) process.exitCode = 2;
`, { encoding: "utf8", flag: "wx" });

  const bridge = createVttCharacterBridge({ vttRoot: root, now: () => new Date("2026-08-16T17:00:00.000Z") });
  const plan = supportedPlan();
  plan.suggestions.className = "Paladin";
  const review = await bridge(plan);
  assert.equal(review.status, "review");
  const complete = await bridge({ ...plan, confirmation: review.reviewFingerprint });
  assert.equal(complete.status, "complete");
  assert.equal(JSON.parse(complete.nativeJson).version, 2);

  const [reviewRequest, confirmationRequest] = (await fs.readFile(captureFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(Object.keys(reviewRequest).sort(), ["contract", "freshness", "owner", "payload", "source", "version", "visibility"]);
  assert.equal(reviewRequest.contract, "player-character");
  assert.equal(reviewRequest.version, "player-character/1");
  assert.equal(reviewRequest.owner, "20fates-vtt");
  assert.equal(reviewRequest.visibility, "player-owned");
  assert.equal(reviewRequest.source.builderRevision, "revised-2024-level-one/1");
  assert.equal(reviewRequest.source.nativeFormatVersion, 2);
  assert.equal(reviewRequest.freshness.reviewFingerprint, null);
  assert.equal(reviewRequest.freshness.confirmedAt, null);
  assert.equal(reviewRequest.payload.selections.className, "Fighter");
  assert.equal(reviewRequest.payload.suggestions.className, "Paladin");
  assert.equal(confirmationRequest.freshness.reviewFingerprint, review.reviewFingerprint);
  assert.equal(confirmationRequest.freshness.confirmedAt, "2026-08-16T17:00:00.000Z");
  assert.doesNotMatch(JSON.stringify([reviewRequest, confirmationRequest]), /roomCode|sessionCredential|dmKey|discordMessage|prospectRecord|otherPlayer|campaignCanon|providerCall|liveWrite/i);
});

test("Familiar rejects malformed or contradictory VTT result envelopes without native JSON", async (t) => {
  const mutations = [
    ["missing contract", (value) => { delete value.contract; }],
    ["unsupported major version", (value) => { value.version = "player-character/2"; }],
    ["wrong owner", (value) => { value.owner = "20fates-familiar"; }],
    ["stale builder revision", (value) => { value.source.builderRevision = "stale"; }],
    ["wrong native format", (value) => { value.freshness.nativeFormatVersion = 3; }],
    ["missing freshness", (value) => { delete value.freshness; }],
    ["wrong visibility", (value) => { value.visibility = "public"; }],
    ["missing payload", (value) => { delete value.payload; }],
    ["malformed fingerprint", (value) => { value.freshness.reviewFingerprint = "not-a-hash"; }],
    ["unexpected authority", (value) => { value.payload.roomCode = "forbidden"; }],
    ["contradictory selections", (value) => { value.payload.review.selections.className = "Wizard"; }],
  ];

  for (const [label, mutate] of mutations) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-result-envelope-vtt-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "scripts"));
    const result = reviewResultEnvelope(supportedPlan());
    mutate(result);
    await fs.writeFile(
      path.join(root, "scripts", "prepare-character-handoff.ts"),
      `process.stdout.write(${JSON.stringify(JSON.stringify(result))}); process.exitCode = 2;\n`,
      { encoding: "utf8", flag: "wx" },
    );

    await assert.rejects(
      createVttCharacterBridge({ vttRoot: root })(supportedPlan()),
      (error) => error.message === "The offline VTT handoff is missing, incompatible, or returned malformed output; no character file was created.",
      label,
    );
  }
});

test("the offline interview delegates every plan, review, fingerprint, and export decision to the VTT", async (t) => {
  await fs.access(path.join(VTT_ROOT, "scripts", "prepare-character-handoff.ts"));
  const { help, statePath } = await fixture(t);

  await help.handle(event("Help me build a character."));
  await help.handle(event("A simple protector.", {
    type: "needs",
    needs: { campaign: "Synthetic Campaign", level: 1, fantasy: "protect allies", complexity: "simple", nonNegotiables: "my choices stay mine" },
  }));

  const missing = supportedPlan();
  delete missing.selections.className;
  const missingReply = await choose(help, missing);
  assert.equal(missingReply.characterHandoff.status, "incomplete");
  assert.match(missingReply.characterHandoff.reasons.join(" "), /unresolved player choice.*class/i);
  assert.equal("nativeJson" in missingReply.characterHandoff, false);

  const ambiguous = supportedPlan();
  ambiguous.selections.className = ["Fighter", "Paladin"];
  const ambiguousReply = await choose(help, ambiguous);
  assert.equal(ambiguousReply.characterHandoff.status, "incomplete");
  assert.deepEqual(ambiguousReply.characterHandoff.review.selections.className, ["Fighter", "Paladin"]);
  assert.match(ambiguousReply.characterHandoff.reasons.join(" "), /class.*explicit text selection/i);
  assert.equal("nativeJson" in ambiguousReply.characterHandoff, false);

  const suggested = supportedPlan();
  delete suggested.selections.className;
  suggested.suggestions.className = "Fighter";
  const suggestedReply = await choose(help, suggested);
  assert.equal(suggestedReply.characterHandoff.status, "incomplete");
  assert.equal(suggestedReply.characterHandoff.review.selections.className, undefined);
  assert.equal(suggestedReply.characterHandoff.review.suggestions.className, "Fighter");
  assert.match(suggestedReply.characterHandoff.reasons.join(" "), /class.*only suggested/i);
  assert.equal("nativeJson" in suggestedReply.characterHandoff, false);

  const plan = supportedPlan();
  plan.suggestions.className = "Paladin";
  plan.confirmation = "premature-confirmation-must-be-ignored";
  const review = await choose(help, plan);
  assert.equal(review.kind, "builder-review");
  assert.equal(review.characterHandoff.status, "review");
  assert.equal(review.characterHandoff.confirmationRequired, true);
  assert.match(review.characterHandoff.reviewFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(review.characterHandoff.review.summary.name, "Aria Vale");
  assert.equal(review.characterHandoff.review.summary.className, "Fighter");
  assert.equal(review.characterHandoff.review.suggestions.className, "Paladin");
  assert.deepEqual(review.characterHandoff.review.summary.unfinished, ["attacks", "spells", "subclasses", "later levels"]);
  assert.equal("nativeJson" in review.characterHandoff, false);

  const storedAfterReview = JSON.parse(await fs.readFile(statePath, "utf8"));
  const storedBuilder = storedAfterReview.members["synthetic-player-17"].builders["synthetic-builder-thread"];
  assert.equal(storedBuilder.stage, "vtt-review");
  assert.equal("confirmation" in storedBuilder.plan, false);
  assert.equal(storedBuilder.reviewFingerprint, review.characterHandoff.reviewFingerprint);
  assert.doesNotMatch(JSON.stringify(storedAfterReview), /nativeJson/);

  const otherPlayer = await help.handle({
    ...event("I confirm someone else’s review.", {
      type: "confirm",
      confirmed: true,
      reviewFingerprint: review.characterHandoff.reviewFingerprint,
    }),
    authorId: "synthetic-player-29",
  });
  assert.equal(otherPlayer.kind, "clarify");
  assert.equal("characterHandoff" in otherPlayer, false);

  const declined = await help.handle(event("I have not confirmed it.", {
    type: "confirm",
    confirmed: false,
    reviewFingerprint: review.characterHandoff.reviewFingerprint,
  }));
  assert.equal(declined.kind, "clarify");
  assert.equal("characterHandoff" in declined, false);

  const restarted = createHelp(statePath);
  const complete = await restarted.handle(event("I confirm that exact review.", {
    type: "confirm",
    confirmed: true,
    reviewFingerprint: review.characterHandoff.reviewFingerprint,
  }));
  assert.equal(complete.characterHandoff.status, "complete");
  assert.equal(complete.characterHandoff.confirmationRequired, false);
  const nativeCharacter = JSON.parse(complete.characterHandoff.nativeJson);
  assert.equal(nativeCharacter.version, 2);
  assert.equal(nativeCharacter.name, "Aria Vale");
  assert.equal(nativeCharacter.identity.className, "Fighter");
  assert.deepEqual(nativeCharacter.attacks, []);
  assert.deepEqual(nativeCharacter.spellcasting.spells, []);
  assert.doesNotMatch(await fs.readFile(statePath, "utf8"), /nativeJson/);

  const changed = supportedPlan();
  changed.selections.featureChoices["fighter-fighting-style"] = ["Defense"];
  const freshReview = await choose(restarted, changed);
  assert.equal(freshReview.characterHandoff.status, "review");
  assert.notEqual(freshReview.characterHandoff.reviewFingerprint, review.characterHandoff.reviewFingerprint);
  const stale = await restarted.handle(event("I confirm the earlier fingerprint.", {
    type: "confirm",
    confirmed: true,
    reviewFingerprint: review.characterHandoff.reviewFingerprint,
  }));
  assert.equal(stale.characterHandoff.status, "review");
  assert.equal(stale.characterHandoff.reviewFingerprint, freshReview.characterHandoff.reviewFingerprint);
  assert.match(stale.characterHandoff.reasons.join(" "), /does not match.*exact review|fresh review/i);
  assert.equal("nativeJson" in stale.characterHandoff, false);

  const unsupported = supportedPlan();
  unsupported.selections.className = "Artificer";
  unsupported.suggestions.className = "Fighter";
  const unsupportedReply = await choose(restarted, unsupported);
  assert.equal(unsupportedReply.characterHandoff.status, "incomplete");
  assert.equal(unsupportedReply.characterHandoff.review.selections.className, "Artificer");
  assert.equal(unsupportedReply.characterHandoff.review.suggestions.className, "Fighter");
  assert.match(unsupportedReply.characterHandoff.reasons.join(" "), /valid class|supported class/i);
  assert.equal("nativeJson" in unsupportedReply.characterHandoff, false);
});

test("missing and malformed VTT commands fail closed with no partial character JSON", async (t) => {
  const missingRoot = path.join(os.tmpdir(), "synthetic-missing-20fates-vtt");
  const missing = await fixture(t, missingRoot);
  const unavailable = await choose(missing.help, supportedPlan());
  assert.equal(unavailable.kind, "unavailable");
  assert.match(unavailable.answer, /VTT handoff is unavailable or incompatible/i);
  assert.equal("characterHandoff" in unavailable, false);

  const externallyComputedReview = await createVttCharacterBridge({ vttRoot: VTT_ROOT })(supportedPlan());
  const recovered = createHelp(missing.statePath);
  const cannotSkipReview = await recovered.handle(event("I confirm a fingerprint I was not shown here.", {
    type: "confirm",
    confirmed: true,
    reviewFingerprint: externallyComputedReview.reviewFingerprint,
  }));
  assert.equal(cannotSkipReview.characterHandoff.status, "review");
  assert.equal(cannotSkipReview.characterHandoff.reviewFingerprint, externallyComputedReview.reviewFingerprint);
  assert.equal("nativeJson" in cannotSkipReview.characterHandoff, false);

  const malformedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-malformed-vtt-"));
  t.after(() => fs.rm(malformedRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(malformedRoot, "scripts"));
  await fs.writeFile(
    path.join(malformedRoot, "scripts", "prepare-character-handoff.ts"),
    "process.stdout.write(JSON.stringify({ status: 'complete' }));\n",
    { encoding: "utf8", flag: "wx" },
  );
  const malformed = await fixture(t, malformedRoot);
  const malformedReply = await choose(malformed.help, supportedPlan());
  assert.equal(malformedReply.kind, "unavailable");
  assert.match(malformedReply.answer, /no character file was created/i);
  assert.equal("characterHandoff" in malformedReply, false);
});

test("an externally computed fingerprint cannot replace the review Familiar presented", async (t) => {
  const presented = `sha256:${"a".repeat(64)}`;
  const unpresented = `sha256:${"b".repeat(64)}`;
  const confirmations = [];
  let calls = 0;
  const review = { selections: supportedPlan().selections, suggestions: {}, summary: { name: "Aria Vale" } };
  const handoff = async (plan) => {
    calls += 1;
    confirmations.push(plan.confirmation ?? null);
    if (calls === 1) return { status: "review", confirmationRequired: true, reasons: [], review, reviewFingerprint: presented };
    if (plan.confirmation === unpresented) {
      return { status: "complete", confirmationRequired: false, reasons: [], review, reviewFingerprint: unpresented, nativeJson: '{"version":2}\n' };
    }
    return { status: "review", confirmationRequired: true, reasons: ["Fresh review required."], review, reviewFingerprint: unpresented };
  };
  const { help, statePath } = await fixture(t, VTT_ROOT, handoff);
  assert.equal((await choose(help, supportedPlan())).characterHandoff.reviewFingerprint, presented);

  const mismatch = await help.handle(event("I confirm a different valid fingerprint.", {
    type: "confirm",
    confirmed: true,
    reviewFingerprint: unpresented,
  }));

  assert.equal(confirmations[1], "");
  assert.equal(mismatch.characterHandoff.status, "review");
  assert.equal(mismatch.characterHandoff.reviewFingerprint, unpresented);
  assert.equal("nativeJson" in mismatch.characterHandoff, false);
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(state.members["synthetic-player-17"].builders["synthetic-builder-thread"].reviewFingerprint, unpresented);
});

test("the bridge remains structurally outside Discord, providers, rooms, and the scribe", async () => {
  const root = path.join(__dirname, "..");
  const bridgeSource = await fs.readFile(path.join(root, "vtt-character-bridge.js"), "utf8");
  const botSource = await fs.readFile(path.join(root, "bot.js"), "utf8");
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.doesNotMatch(bridgeSource, /\.env|deepseek|discord|fetch\s*\(|https?:|room-state|GameFamiliar/i);
  assert.doesNotMatch(botSource, /require\(["']\.\/(?:player-help|offline-discord-transport|deepseek-responder|vtt-character)/i);
  assert.match(botSource, /playerHelpTransport:\s*null/);
  assert.equal(packageJson.scripts.start, "node bot.js");
});

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
    },
    suggestions: {},
  };
}

function reviewResultEnvelope(plan) {
  return {
    contract: "player-character",
    version: "player-character/1",
    owner: "20fates-vtt",
    source: { project: "20fates-vtt", builderRevision: "revised-2024-level-one/1", nativeFormatVersion: 2 },
    freshness: {
      builderRevision: "revised-2024-level-one/1",
      nativeFormatVersion: 2,
      validation: "review",
      reviewFingerprint: `sha256:${"a".repeat(64)}`,
      confirmedAt: null,
      invalidation: "any-choice-or-vtt-revision-change",
    },
    visibility: "player-owned",
    payload: {
      status: "review",
      confirmationRequired: true,
      reasons: [],
      review: { selections: plan.selections, suggestions: plan.suggestions, summary: { name: "Aria Vale" } },
      validation: { selections: "supported", builder: "passed", nativeRoundTrip: "not-run", ownershipRebinding: "not-run" },
      nativeDraft: null,
      contentHash: null,
    },
  };
}
