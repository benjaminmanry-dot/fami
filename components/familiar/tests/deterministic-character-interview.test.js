"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PlayerHelp } = require("../player-help.js");
const { createVttCharacterBridge } = require("../vtt-character-bridge.js");
const { createVttCharacterData } = require("../vtt-character-data.js");

const VTT_ROOT = process.env.FAMILIAR_VTT_ROOT || path.join(path.parse(__dirname).root, "Ambitions", "20fates-vtt");

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familiar-character-interview-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, "state.json");
  const help = new PlayerHelp({
    statePath,
    responder: async () => { throw new Error("The provider boundary must remain unused."); },
    now: () => new Date("2026-08-16T17:00:00Z"),
    characterBuilderData: createVttCharacterData({ vttRoot: VTT_ROOT }),
    characterHandoff: createVttCharacterBridge({ vttRoot: VTT_ROOT }),
    ...options
  });
  return { help, statePath };
}

function event(content, builderAction, extra = {}) {
  return {
    authorId: "synthetic-player-1",
    contextId: "synthetic-thread-1",
    inOfficialServer: true,
    mentioned: true,
    content,
    mode: "character-builder",
    builderAction,
    providerBalanceAvailable: false,
    ...extra
  };
}

function ordinaryEvent(content, extra = {}) {
  return {
    authorId: "synthetic-player-1",
    contextId: "synthetic-thread-1",
    inOfficialServer: true,
    mentioned: true,
    content,
    providerBalanceAvailable: false,
    ...extra
  };
}

async function answer(help, value, extra = {}) {
  return help.handle(event(value, { type: "answer" }, extra));
}

const SUPPORTED_ANSWERS = [
  ["campaign", null, "Many-Arrows; hopeful frontier play"],
  ["level", null, "1"],
  ["fantasy", null, "A shield-bearing protector who keeps friends standing"],
  ["complexity", null, "Medium complexity"],
  ["nonNegotiables", null, "No spellcasting"],
  ["name", null, "Aria Vale"],
  ["className", null, "Fighter"],
  ["species", null, "Human"],
  ["size", null, "Medium"],
  ["background", null, "Soldier"],
  ["baseScores", "str", "15"],
  ["baseScores", "dex", "13"],
  ["baseScores", "con", "14"],
  ["baseScores", "int", "8"],
  ["baseScores", "wis", "12"],
  ["baseScores", "cha", "10"],
  ["boostMode", null, "+2 and +1"],
  ["boostTwo", null, "Strength"],
  ["boostOne", null, "Constitution"],
  ["classSkills", null, "Perception"],
  ["classSkills", null, "Survival"],
  ["languages", null, "Elvish"],
  ["languages", null, "Orc"],
  ["featureChoices", "fighter-fighting-style", "Protection"],
  ["featureChoices", "fighter-weapon-mastery", "Javelin"],
  ["featureChoices", "fighter-weapon-mastery", "Longsword"],
  ["featureChoices", "fighter-weapon-mastery", "Warhammer"],
  ["featureChoices", "human-skillful", "Insight"],
  ["featureChoices", "human-origin-feat", "Tough"]
];

async function completeSupportedInterview(help, extra = {}) {
  let reply = await help.handle(ordinaryEvent("help me build a character", extra));
  for (const [field, key, value] of SUPPORTED_ANSWERS) {
    assert.equal(reply.interview.currentQuestion.field, field);
    if (key) assert.equal(reply.interview.currentQuestion.key, key);
    if (key === "fighter-fighting-style") {
      assert.ok(reply.interview.advice.some(({ label }) => label === "Protection"));
      assert.equal(reply.interview.selections.featureChoices?.[key]?.length || 0, 0);
    }
    assert.equal((reply.answer.match(/\?/g) || []).length, 1);
    reply = await help.handle(ordinaryEvent(value, extra));
  }
  return reply;
}

test("ordinary addressed text answers the active member-and-context interview question", async (t) => {
  const { help, statePath } = await fixture(t);
  const start = await help.handle(ordinaryEvent("Help me build a character"));
  assert.equal(start.interview.currentQuestion.field, "campaign");

  const next = await help.handle(ordinaryEvent("Many-Arrows"));
  assert.equal(next.mode, "character-builder");
  assert.equal(next.interview.currentQuestion.field, "level");
  assert.equal(next.interview.needs.campaign, "Many-Arrows");

  const stored = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(stored.members["synthetic-player-1"].builders["synthetic-thread-1"].needs.campaign, "Many-Arrows");
});

test("deterministic interview asks one needs question at a time and preserves the player's wording", async (t) => {
  const { help, statePath } = await fixture(t);

  const start = await help.handle(event("help me build a character"));
  assert.equal(start.interview.currentQuestion.field, "campaign");
  assert.equal((start.answer.match(/\?/g) || []).length, 1);

  const campaign = "Many-Arrows normally starts at level 3; we use lingering injuries, and I need a hopeful tone.";
  let next = await help.handle(event(campaign, { type: "answer" }));
  assert.equal(next.interview.currentQuestion.field, "level");
  assert.equal(next.interview.needs.campaign, campaign);
  assert.equal(next.interview.needs.level, undefined);
  assert.equal((next.answer.match(/\?/g) || []).length, 1);

  next = await answer(help, "5");
  assert.equal(next.interview.currentQuestion.field, "level");
  assert.equal(next.interview.unresolved.intent, "5");
  assert.equal(next.interview.needs.level, undefined);
  next = await answer(help, "1");
  assert.equal(next.interview.currentQuestion.field, "fantasy");
  next = await answer(help, "no preference");
  assert.equal(next.interview.currentQuestion.field, "complexity");
  next = await answer(help, "no preference");
  assert.equal(next.interview.currentQuestion.field, "nonNegotiables");
  next = await answer(help, "none");
  assert.equal(next.interview.currentQuestion.field, "name");
  assert.equal(next.interview.needs.fantasy, "no preference");
  assert.equal(next.interview.needs.nonNegotiables, "none");

  const stored = JSON.parse(await fs.readFile(statePath, "utf8"));
  const builder = stored.members["synthetic-player-1"].builders["synthetic-thread-1"];
  assert.equal(builder.needs.campaign, campaign);
  assert.equal(JSON.stringify(stored).includes("help me build a character"), false);
});

test("offered choices require one explicit selection while comparisons, suggestions, and unsupported intent stay unresolved", async (t) => {
  const { help } = await fixture(t);
  let reply = await help.handle(ordinaryEvent("help me build a character"));
  for (const value of SUPPORTED_ANSWERS.slice(0, 6).map((entry) => entry[2])) reply = await help.handle(ordinaryEvent(value));
  assert.equal(reply.interview.currentQuestion.field, "className");

  reply = await help.handle(ordinaryEvent("Fighter or Wizard"));
  assert.equal(reply.interview.currentQuestion.field, "className");
  assert.equal(reply.interview.selections.className, undefined);
  assert.equal(reply.interview.unresolved.reason, "ambiguous");

  reply = await help.handle(ordinaryEvent("I think Fighter"));
  assert.equal(reply.interview.currentQuestion.type, "confirmation");
  assert.equal(reply.interview.pendingCandidate.value, "Fighter");
  assert.equal(reply.interview.selections.className, undefined);

  reply = await help.handle(ordinaryEvent("no"));
  assert.equal(reply.interview.currentQuestion.field, "className");
  assert.equal(reply.interview.selections.className, undefined);

  reply = await help.handle(ordinaryEvent("I think Fighter"));
  reply = await help.handle(ordinaryEvent("yes"));
  assert.equal(reply.interview.selections.className, "Fighter");
  assert.equal(reply.interview.currentQuestion.field, "species");

  reply = await help.handle(ordinaryEvent("Tabaxi"));
  assert.equal(reply.interview.currentQuestion.field, "species");
  assert.equal(reply.interview.unresolved.intent, "Tabaxi");
  assert.equal(reply.interview.selections.species, undefined);
  assert.doesNotMatch(JSON.stringify(reply.interview.selections), /Human|Tabaxi/);

  reply = await help.handle(ordinaryEvent("Which is better, Human?"));
  assert.equal(reply.interview.currentQuestion.type, "confirmation");
  assert.equal(reply.interview.selections.species, undefined);
  assert.equal(reply.interview.advice.length, 0);
  reply = await help.handle(ordinaryEvent("yes"));
  assert.equal(reply.interview.selections.species, "Human");
});

test("negated offered-option mentions select nothing while a positive explicit choice still records", async (t) => {
  const { help } = await fixture(t);
  let reply = await help.handle(ordinaryEvent("help me build a character"));
  for (const value of SUPPORTED_ANSWERS.slice(0, 6).map((entry) => entry[2])) reply = await help.handle(ordinaryEvent(value));
  assert.equal(reply.interview.currentQuestion.field, "className");

  for (const rejection of ["I don't want Fighter", "not Fighter", "anything but Fighter", "no Fighter please", "I want no Fighter"]) {
    reply = await help.handle(ordinaryEvent(rejection));
    assert.equal(reply.interview.currentQuestion.field, "className");
    assert.equal(reply.interview.selections.className, undefined);
    assert.equal(reply.interview.unresolved.reason, "rejected");
  }

  reply = await help.handle(ordinaryEvent("I want Fighter"));
  assert.equal(reply.interview.selections.className, "Fighter");
  assert.equal(reply.interview.currentQuestion.field, "species");
});

test("ordinary review, back, restart, stop, member/context isolation, restart persistence, and play override remain explicit", async (t) => {
  const { help, statePath } = await fixture(t);
  let reply = await help.handle(ordinaryEvent("Help me build a character"));
  reply = await help.handle(ordinaryEvent("Campaign Alpha"));
  const status = await help.handle(ordinaryEvent("status"));
  assert.equal(status.interview.currentQuestion.field, "level");
  assert.equal(status.interview.needs.campaign, "Campaign Alpha");
  reply = await help.handle(ordinaryEvent("1"));
  assert.equal(reply.interview.currentQuestion.field, "fantasy");

  reply = await help.handle(ordinaryEvent("go back"));
  assert.equal(reply.interview.currentQuestion.field, "level");
  assert.equal(reply.interview.needs.campaign, "Campaign Alpha");
  assert.equal(reply.interview.needs.level, undefined);

  const escaped = await help.handle(ordinaryEvent("hello", { mode: "play-assistant" }));
  assert.equal(escaped.mode, "play-assistant");
  assert.equal(escaped.interview, undefined);

  const other = { authorId: "synthetic-player-2", contextId: "synthetic-thread-2" };
  await help.handle(ordinaryEvent("Help me build a character", other));
  const otherReply = await help.handle(ordinaryEvent("Campaign Beta", other));
  assert.equal(otherReply.interview.needs.campaign, "Campaign Beta");
  const firstStatus = await help.handle(ordinaryEvent("review"));
  assert.equal(firstStatus.interview.needs.campaign, "Campaign Alpha");

  const restarted = new PlayerHelp({
    statePath,
    responder: async () => { throw new Error("provider unused"); },
    now: () => new Date("2026-08-16T17:00:00Z"),
    characterBuilderData: createVttCharacterData({ vttRoot: VTT_ROOT }),
    characterHandoff: createVttCharacterBridge({ vttRoot: VTT_ROOT })
  });
  const resumed = await restarted.handle(ordinaryEvent("status"));
  assert.equal(resumed.interview.needs.campaign, "Campaign Alpha");
  assert.equal(resumed.interview.currentQuestion.field, "level");

  const reset = await restarted.handle(ordinaryEvent("restart"));
  assert.equal(reset.interview.currentQuestion.field, "campaign");
  assert.deepEqual(reset.interview.needs, {});
  const stopped = await restarted.handle(ordinaryEvent("stop"));
  assert.match(stopped.answer, /stopped/i);
  const stored = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(stored.members["synthetic-player-1"].builders["synthetic-thread-1"], undefined);
});

test("a complete explicit foundation produces VTT review first and native v2 only after the same member confirms its exact fingerprint", async (t) => {
  const { help, statePath } = await fixture(t);
  const review = await completeSupportedInterview(help);
  assert.equal(review.kind, "builder-review");
  assert.equal(review.characterHandoff.status, "review");
  assert.equal(review.characterHandoff.nativeJson, undefined);
  assert.match(review.characterHandoff.reviewFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(review.characterHandoff.review.summary.name, "Aria Vale");
  assert.equal(review.characterHandoff.review.summary.featureChoices.length, 4);

  const repeatedReview = await help.handle(ordinaryEvent("review"));
  assert.equal(repeatedReview.characterHandoff.status, "review");
  assert.equal(repeatedReview.characterHandoff.reviewFingerprint, review.characterHandoff.reviewFingerprint);
  assert.equal(repeatedReview.characterHandoff.nativeJson, undefined);

  const ambiguousAssent = await help.handle(ordinaryEvent("yes"));
  assert.equal(ambiguousAssent.characterHandoff, undefined);
  assert.equal(JSON.stringify(ambiguousAssent).includes("nativeJson"), false);
  assert.match(ambiguousAssent.answer, /say exactly.*I confirm/i);

  const otherMember = await help.handle(ordinaryEvent("I confirm", { authorId: "synthetic-player-2" }));
  assert.equal(otherMember.characterHandoff, undefined);
  assert.equal(JSON.stringify(otherMember).includes("nativeJson"), false);

  const rawBefore = await fs.readFile(statePath, "utf8");
  assert.equal(rawBefore.includes("nativeJson"), false);
  assert.equal(rawBefore.includes("help me build a character"), false);

  const restarted = new PlayerHelp({
    statePath,
    responder: async () => { throw new Error("provider unused"); },
    now: () => new Date("2026-08-16T17:00:00Z"),
    characterBuilderData: createVttCharacterData({ vttRoot: VTT_ROOT }),
    characterHandoff: createVttCharacterBridge({ vttRoot: VTT_ROOT })
  });
  const complete = await restarted.handle(ordinaryEvent("I confirm"));
  assert.equal(complete.characterHandoff.status, "complete");
  assert.equal(JSON.parse(complete.characterHandoff.nativeJson).version, 2);
  const rawAfter = await fs.readFile(statePath, "utf8");
  assert.equal(rawAfter.includes("nativeJson"), false);
});

test("upstream changes clear only VTT-dependent choices and make every earlier fingerprint stale", async (t) => {
  const { help } = await fixture(t);
  const firstReview = await completeSupportedInterview(help);
  const firstFingerprint = firstReview.characterHandoff.reviewFingerprint;

  let reply = await help.handle(ordinaryEvent("change class to Wizard"));
  assert.equal(reply.interview.currentQuestion.field, "classSkills");
  assert.equal(reply.interview.selections.className, "Wizard");
  assert.equal(reply.interview.selections.classSkills, undefined);
  assert.deepEqual(reply.interview.selections.languages, ["Elvish", "Orc"]);
  assert.deepEqual(reply.interview.selections.baseScores, { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 });
  assert.deepEqual(Object.keys(reply.interview.selections.featureChoices).sort(), ["human-origin-feat", "human-skillful"]);

  reply = await help.handle(ordinaryEvent("Arcana"));
  reply = await help.handle(ordinaryEvent("History"));
  assert.equal(reply.characterHandoff.status, "review");
  const classFingerprint = reply.characterHandoff.reviewFingerprint;
  assert.notEqual(classFingerprint, firstFingerprint);

  reply = await help.handle(ordinaryEvent("change boost method to +1 to all three"));
  assert.equal(reply.characterHandoff.status, "review");
  assert.equal(reply.interview.selections.boostMode, "1+1+1");
  assert.equal(reply.interview.selections.boostTwo, undefined);
  assert.equal(reply.interview.selections.boostOne, undefined);
  assert.notEqual(reply.characterHandoff.reviewFingerprint, classFingerprint);
  const freshFingerprint = reply.characterHandoff.reviewFingerprint;

  const stale = await help.handle(event("confirm old review", {
    type: "confirm",
    confirmed: true,
    reviewFingerprint: firstFingerprint
  }));
  assert.equal(stale.characterHandoff.status, "review");
  assert.equal(stale.characterHandoff.reviewFingerprint, freshFingerprint);
  assert.equal(stale.characterHandoff.nativeJson, undefined);

  const complete = await help.handle(ordinaryEvent("I confirm"));
  assert.equal(complete.characterHandoff.status, "complete");
  assert.equal(JSON.parse(complete.characterHandoff.nativeJson).version, 2);
});

test("missing or malformed VTT data and a failed handoff stop cleanly without substitution or JSON", async (t) => {
  for (const characterBuilderData of [
    async () => { throw new Error("synthetic missing VTT"); },
    async () => ({ version: 1 })
  ]) {
    const current = await fixture(t, { characterBuilderData });
    let reply = await current.help.handle(ordinaryEvent("Help me build a character"));
    for (const value of SUPPORTED_ANSWERS.slice(0, 5).map((entry) => entry[2])) reply = await current.help.handle(ordinaryEvent(value));
    assert.equal(reply.kind, "unavailable");
    assert.match(reply.answer, /VTT builder data is unavailable or incompatible/i);
    assert.equal(JSON.stringify(reply).includes("nativeJson"), false);
    const stored = await fs.readFile(current.statePath, "utf8");
    assert.equal(stored.includes("nativeJson"), false);
  }

  const failed = await fixture(t, { characterHandoff: async () => { throw new Error("synthetic handoff failure"); } });
  const reply = await completeSupportedInterview(failed.help);
  assert.equal(reply.kind, "unavailable");
  assert.match(reply.answer, /VTT handoff is unavailable or incompatible/i);
  assert.equal(JSON.stringify(reply).includes("nativeJson"), false);
  assert.equal((await fs.readFile(failed.statePath, "utf8")).includes("nativeJson"), false);
});
