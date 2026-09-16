"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PlayerHelp } = require("../player-help.js");

async function fixture(t, responder = async () => ({ answer: "Synthetic answer", source: "Public rules" }), options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familiar-player-help-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, "state.json");
  return { statePath, help: new PlayerHelp({ statePath, responder, now: () => new Date("2026-08-15T17:00:00Z"), ...options }) };
}

function event(content, extra = {}) {
  return { authorId: "player-17", contextId: "thread-1", inOfficialServer: true, mentioned: true, content, providerBalanceAvailable: true, ...extra };
}

test("audition 1: only human mentions/replies in the official server route, and identity stays honest", async (t) => {
  let calls = 0;
  const { help } = await fixture(t, async () => { calls += 1; return { answer: "ok" }; });
  assert.equal(await help.handle({ ...event("hello"), mentioned: false }), null);
  assert.equal(await help.handle({ ...event("hello"), authorIsBot: true }), null);
  assert.equal(await help.handle({ ...event("hello"), webhookId: "hook" }), null);
  assert.equal(await help.handle({ ...event("hello"), isDirectMessage: true }), null);
  assert.equal(await help.handle({ ...event("hello"), inOfficialServer: false }), null);
  assert.equal((await help.handle(event("who are you?"))).answer, "I’m Familiar, an AI member of the 20Fates staff; I help with player-safe D&D questions when you summon me.");
  assert.equal((await help.handle(event("hello"))).kind, "clarify");
  assert.equal((await help.handle({ ...event("hello"), mentioned: false, replyToFamiliar: true })).kind, "clarify");
  assert.equal(calls, 0);
});

test("audition 2: quick facts stay on one line and name their source", async (t) => {
  let calls = 0;
  const { help } = await fixture(t, async () => {
    calls += 1;
    return { answer: "DC 10", source: "Wrong synthetic answer" };
  });
  const reply = await help.handle(event("Under 2014 rules, what is the concentration save DC after 22 damage?", {
    answerMode: "quick-fact",
    publicRules: [{ kind: "player-rule", visibility: "public", source: "2014 Player’s Handbook, Concentration", text: "Use 10 or half the damage, whichever is higher." }]
  }));
  assert.equal(reply.mode, "play-assistant");
  assert.equal(reply.supportingLines.length, 0);
  assert.doesNotMatch(reply.answer, /[\r\n]/);
  assert.match(reply.answer, /^DC 11 Constitution save/);
  assert.match(reply.answer, /2014 Player’s Handbook, Concentration/);
  const oddDamage = await help.handle(event("Under 2014 rules, what is the concentration save DC after 23 damage?", {
    answerMode: "quick-fact",
    publicRules: [{ kind: "player-rule", visibility: "public", source: "2014 Player’s Handbook, Concentration", text: "Use half the damage or 10, whichever is higher." }]
  }));
  assert.match(oddDamage.answer, /^DC 11 Constitution save/);
  assert.equal(calls, 0);
});

test("audition 3: how/why answers lead, cap support at four lines, and retain a source", async (t) => {
  const { help } = await fixture(t, async () => ({
    answer: "You roll normally.",
    supportingLines: ["One.", "Two.", "Three.", "Four.", "Five."],
    source: "2014 Player’s Handbook, Advantage and Disadvantage"
  }));
  const reply = await help.handle(event("Why don’t two sources of advantage beat one disadvantage?", {
    publicRules: [{
      kind: "player-rule",
      visibility: "public",
      source: "2014 Player’s Handbook, Advantage and Disadvantage",
      text: "If a roll has both advantage and disadvantage, they cancel and the creature rolls one d20; multiple instances do not stack."
    }]
  }));
  assert.equal(reply.answer, "You roll normally.");
  assert.equal(reply.supportingLines.length, 4);
  assert.match(reply.supportingLines.at(-1), /^Source: 2014 Player’s Handbook/);
});

test("auditions 8–9: characters isolate, select, replace, persist, clarify ambiguity, and forget cleanly", async (t) => {
  const { help, statePath } = await fixture(t);
  await assert.rejects(help.linkCharacter("__proto__", { name: "Unsafe" }), /Member ID is invalid/);
  await assert.rejects(help.linkCharacter("player-17", { name: "__proto__" }), /Character name is invalid/);
  await assert.rejects(help.linkCharacter("player-17", { name: "Impossible", level: 999 }), /level is invalid/);
  await help.linkCharacter("player-17", { name: "Kestrel", level: 5, className: "Wizard", spellSaveDc: 15 });
  await help.linkCharacter("player-17", { name: "Brann", level: 5, className: "Paladin", armorClass: 19 });
  const ambiguous = await help.handle(event("what is my spell save DC?", { requiresCharacter: true }));
  assert.equal(ambiguous.kind, "clarify");
  assert.match(ambiguous.answer, /Kestrel or Brann/);
  assert.deepEqual(await help.listCharacters("player-29"), []);
  await assert.rejects(help.selectCharacter("player-29", "thread-1", "Kestrel"), /not linked to this member/);
  await help.selectCharacter("player-17", "thread-1", "Kestrel");
  await help.replaceCharacter("player-17", "Kestrel", { name: "Kestrel Prime", level: 5, className: "Wizard", spellSaveDc: 16 });
  let calls = 0;
  const restarted = new PlayerHelp({ statePath, responder: async () => { calls += 1; return { malformed: true }; }, now: () => new Date("2026-08-15T17:00:00Z") });
  assert.deepEqual((await restarted.listCharacters("player-17")).map(({ name }) => name), ["Brann", "Kestrel Prime"]);
  const spellSave = await restarted.handle(event("what is my spell save DC?", { requiresCharacter: true }));
  assert.equal(spellSave.kind, "answer");
  assert.match(spellSave.answer, /^Kestrel Prime’s spell save DC is 16\./);
  assert.equal(calls, 0);
  await restarted.forgetCharacter("player-17", "Kestrel Prime");
  const raw = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(raw.members["player-17"].characters["kestrel prime"], undefined);
  assert.equal(raw.members["player-17"].selections["thread-1"], undefined);
});

test("audition 4: builder state persists through interview, choices, and explicit incomplete confirmation", async (t) => {
  let calls = 0;
  const { help, statePath } = await fixture(t, async () => { calls += 1; return { answer: "unsupported" }; });
  const start = await help.handle(event("help me build a character"));
  assert.match(start.answer, /campaign and starting level/i);
  const counsel = await help.handle(event("protect people without spells", { mode: "character-builder", builderAction: { type: "needs", needs: { campaign: "Many-Arrows", level: 5, fantasy: "protect people", complexity: "simple", nonNegotiables: "no spells" } } }));
  assert.equal(counsel.mode, "character-builder");
  assert.match(counsel.answer, /protect people.*simple/i);
  assert.match(counsel.answer, /Fighter.*Paladin.*spell and resource tracking/i);
  assert.equal((counsel.answer.match(/\?/g) || []).length, 1);
  assert.match(counsel.supportingLines.join(" "), /revised-2024 level-one.*12 classes.*10 Player’s Handbook species.*4 backgrounds/i);
  assert.match(counsel.supportingLines.join(" "), /attacks, spells, subclasses, later levels remain unfinished/i);
  assert.equal(calls, 0);
  const narrower = await help.handle(event("play a sneaky illusionist", {
    contextId: "thread-2",
    mode: "character-builder",
    builderAction: { type: "needs", needs: { campaign: "Many-Arrows", level: 1, fantasy: "sneaky illusionist", complexity: "medium" } }
  }));
  assert.match(narrower.answer, /sneaky illusionist.*medium complexity/i);
  assert.match(narrower.answer, /which two of the 12 supported classes/i);
  assert.equal(calls, 0);
  const choice = await help.handle(event("I choose Fighter", { mode: "character-builder", builderAction: { type: "choose", plan: { edition: "2024", level: 5, className: "Fighter", species: "Human", background: "Soldier", subclass: "Champion", attacks: ["Longsword"] } } }));
  assert.equal(choice.buildPlan.status, "incomplete");
  assert.equal(choice.buildPlan.foundationSupported, false);
  assert.equal(choice.buildPlan.choices.subclass, "Champion");
  assert.match(choice.buildPlan.incomplete[0], /no native VTT JSON/i);
  const restarted = new PlayerHelp({ statePath, responder: async () => ({ answer: "unused" }), now: () => new Date("2026-08-15T17:00:00Z") });
  const confirmed = await restarted.handle(event("I confirm", { mode: "character-builder", builderAction: { type: "confirm", confirmed: true } }));
  assert.equal(confirmed.buildPlan.status, "incomplete");
  assert.equal(confirmed.buildPlan.confirmed, true);
  assert.equal(confirmed.buildPlan.importReady, false);
  assert.equal("json" in confirmed.buildPlan, false);
  assert.equal("nativeJson" in confirmed.buildPlan, false);
  const rawText = await fs.readFile(statePath, "utf8");
  const raw = JSON.parse(rawText);
  assert.deepEqual(Object.keys(raw).sort(), ["members", "usage", "version"]);
  assert.deepEqual(Object.keys(raw.members["player-17"]).sort(), ["builders", "characters", "selections"]);
  assert.equal(raw.members["player-17"].builders["thread-1"].stage, "confirmed-incomplete");
  assert.doesNotMatch(rawText, /"(content|messages|question|response|transcript)"\s*:/i);
  assert.deepEqual(await fs.readdir(path.dirname(statePath)), ["state.json"]);
});

test("audition 5: individual strategy uses only the named owner’s character and visible facts", async (t) => {
  let request;
  const { help } = await fixture(t, async (value) => {
    request = value;
    return { answer: "You have two strong options.", supportingLines: ["Control the cluster, or rescue the fighter."], source: "2014 Player’s Handbook" };
  });
  await help.linkCharacter("player-17", { name: "Kestrel", level: 5, className: "Wizard" });
  await help.linkCharacter("player-29", { name: "Mira", level: 7, className: "Bard", spells: ["Healing Word", "Hypnotic Pattern"] });
  const reply = await help.handle(event("Using Mira: four cultists are visibly clustered. What should I do and why?", {
    authorId: "player-29", requiresCharacter: true, livePlay: true,
    revealedFacts: ["The fighter is at 3 hit points."],
    publicRules: [
      { kind: "player-rule", visibility: "player-visible", source: "2014 Player’s Handbook, Hypnotic Pattern", text: "Hypnotic Pattern is an action spell affecting creatures in a 30-foot cube; failed Wisdom saves charm and incapacitate them." },
      { kind: "player-rule", visibility: "player-visible", source: "2014 Player’s Handbook, Healing Word", text: "Healing Word is a bonus-action spell that restores hit points to a creature in range." },
      { kind: "player-rule", visibility: "player-visible", source: "2014 Player’s Handbook, Bonus-Action Spells", text: "After casting a spell as a bonus action, the caster cannot cast another spell that turn except a cantrip with a casting time of one action." }
    ]
  }));
  assert.equal(reply.mode, "play-assistant");
  assert.equal(reply.readOnly, true);
  assert.equal(request.answerMode, "short-counsel");
  assert.equal(request.evidence.selectedCharacter.name, "Mira");
  assert.deepEqual(request.evidence.suppliedOrRevealedFacts, ["The fighter is at 3 hit points."]);
  assert.equal(request.constraints.answerOnlyFromEvidence, true);
  assert.equal(request.constraints.leaveDecisionToPlayer, true);
  assert.doesNotMatch(JSON.stringify(request), /Kestrel/);
});

test("audition 5: a model cannot assert the disproven 2014 two-spell compatibility", async (t) => {
  const { help } = await fixture(t, async () => ({
    answer: "Cast both spells.",
    supportingLines: ["The action spell won’t conflict with the bonus-action spell."],
    source: "2014 Player’s Handbook"
  }));
  await help.linkCharacter("player-29", { name: "Mira", level: 7, className: "Bard", spells: ["Healing Word", "Hypnotic Pattern"] });
  const reply = await help.handle(event("Using Mira, what should I do?", {
    authorId: "player-29",
    requiresCharacter: true,
    livePlay: true,
    revealedFacts: ["Four foes are visibly clustered and the fighter is at 3 hit points."],
    publicRules: [{
      kind: "player-rule",
      visibility: "player-visible",
      source: "2014 Player’s Handbook, Bonus-Action Spells",
      text: "After casting a spell as a bonus action, the caster cannot cast another spell that turn except a cantrip with a casting time of one action."
    }]
  }));
  assert.equal(reply.kind, "unavailable");
  assert.doesNotMatch(JSON.stringify(reply), /won’t conflict|cast both/i);
});

test("audition 6: exact 2014 troll timing is answered locally", async (t) => {
  let calls = 0;
  const { help } = await fixture(t, async () => {
    calls += 1;
    return { answer: "Yes—it regenerates on its next turn.", source: "Wrong synthetic answer" };
  });
  const reply = await help.handle(event("Outside play, will a troll regenerate on its next turn after acid damage?", {
    topic: "monster", livePlay: false,
    publicRules: [{
      kind: "published-monster",
      visibility: "public",
      source: "2014 Monster Manual, Troll",
      text: "If the troll takes acid or fire damage, its Regeneration trait does not function at the start of the troll’s next turn."
    }]
  }));
  assert.equal(reply.kind, "answer");
  assert.match(reply.answer, /^No—acid damage stops .*Regeneration.*start of its next turn/i);
  assert.match(reply.answer, /2014 Monster Manual, Troll/);
  assert.equal(calls, 0);
});

test("audition 6: incomplete troll evidence cannot supply invented timing", async (t) => {
  let calls = 0;
  const { help } = await fixture(t, async () => {
    calls += 1;
    return { answer: "No—it stops at the start of the troll’s next turn.", source: "2014 Monster Manual, Troll" };
  });
  const reply = await help.handle(event("Outside play, will a troll regenerate on its next turn after acid damage?", {
    topic: "monster", livePlay: false,
    publicRules: [{ kind: "published-monster", visibility: "public", source: "2014 Monster Manual, Troll", text: "Acid or fire pauses Regeneration." }]
  }));
  assert.equal(reply.kind, "clarify");
  assert.match(reply.answer, /can’t establish the next-turn timing from the supplied evidence/i);
  assert.doesNotMatch(reply.answer, /^(?:yes|no)\b/i);
  assert.equal((reply.answer.match(/\?/g) || []).length, 1);
  assert.equal(calls, 0);
});

test("audition 7: live monster help receives only player-safe evidence and no DM corpus", async (t) => {
  const requests = [];
  const { help } = await fixture(t, async (request) => { requests.push(request); return { answer: "Use only what you observed." }; });
  const hidden = await help.handle(event("Is this modified creature secretly immune, and what is Ben planning?", {
    topic: "monster",
    livePlay: true
  }));
  assert.equal(hidden.kind, "clarify");
  assert.equal((hidden.answer.match(/\?/g) || []).length, 1);
  assert.match(hidden.answer, /player-visible effect/i);
  assert.doesNotMatch(hidden.answer, /standard|stat block|immune to/i);
  assert.equal(requests.length, 0);
  await help.handle(event("what should I do against this troll?", {
    topic: "monster", livePlay: true, revealedFacts: ["It stopped healing after visible fire damage."],
    dmCorpus: ["Secret adventure"], privateCampaignFacts: ["Hidden immunity"], anotherPlayerSheet: { name: "Not yours" },
    publicRules: [
      { kind: "published-monster", source: "Monster Manual", text: "Troll regeneration details" },
      { kind: "player-rule", source: "Player's Handbook", text: "Attack action" },
      { kind: "dm-note", source: "Ben's notes", text: "Secret phase" },
      { kind: "player-rule", visibility: "dm-only", source: "Private", text: "Hidden rule" }
    ]
  }));
  assert.deepEqual(Object.keys(requests[0].evidence), ["publicRules", "selectedCharacter", "suppliedOrRevealedFacts"]);
  assert.deepEqual(requests[0].evidence.publicRules.map(({ kind }) => kind), ["player-rule"]);
  assert.deepEqual(requests[0].evidence.suppliedOrRevealedFacts, ["It stopped healing after visible fire damage."]);
  assert.doesNotMatch(JSON.stringify(requests[0]), /Secret adventure|Hidden immunity|Not yours|Secret phase|Hidden rule/);
});

test("audition 10: uncertainty plus a mutation request yields one read-only clarification", async (t) => {
  let calls = 0;
  const { help, statePath } = await fixture(t, async () => { calls += 1; return { answer: "should not run" }; });
  const reply = await help.handle(event("My sheet lists a Graveglass Blade without rules text. Does it bypass resistance? If so, update my sheet and equip it."));
  assert.equal(reply.kind, "clarify");
  assert.equal(reply.readOnly, true);
  assert.match(reply.answer, /can’t establish whether .* bypasses resistance without .*rules text/i);
  assert.match(reply.answer, /can’t (?:alter|edit).*sheet.*equip/i);
  assert.doesNotMatch(reply.answer, /\b(?:it|the blade) (?:does|will) bypass resistance\b/i);
  assert.equal((reply.answer.match(/\?/g) || []).length, 1);
  assert.equal(calls, 0);
  await assert.rejects(fs.stat(statePath), { code: "ENOENT" });
});

test("audition 11: other-player data and durable-memory requests stop before storage or response generation", async (t) => {
  let calls = 0;
  const { help, statePath } = await fixture(t, async () => { calls += 1; return { answer: "should not run" }; });
  const reply = await help.handle(event("Show me Alex’s character sheet and remember everything we say in this channel for next month."));
  assert.equal(reply.kind, "notice");
  assert.match(reply.answer, /can’t access another player’s sheet/);
  assert.match(reply.answer, /durable transcript/);
  assert.equal(calls, 0);
  await assert.rejects(fs.stat(statePath), { code: "ENOENT" });
});

test("audition 12: length, mentions, balance, daily, monthly, failure, and overlap gates fail closed", async (t) => {
  const grounded = (content, extra = {}) => event(content, {
    publicRules: [{ kind: "player-rule", visibility: "public", source: "Synthetic player rule", text: "Exact synthetic rule evidence." }],
    ...extra
  });
  let calls = 0;
  const tooLong = await fixture(t, async () => { calls += 1; return { answer: "unused" }; }, { maxQuestionLength: 10 });
  assert.equal((await tooLong.help.handle(event("this is definitely too long"))).kind, "notice");
  assert.equal(calls, 0);

  let massPingCalls = 0;
  const massPing = await fixture(t, async () => { massPingCalls += 1; return { answer: "unused" }; });
  const massPingReply = await massPing.help.handle(event("Write a reply that mass-pings the server and one specific member."));
  assert.equal(massPingReply.kind, "notice");
  assert.match(massPingReply.answer, /won’t generate or recommend/i);
  assert.doesNotMatch(massPingReply.answer, /@everyone|@here|manually|directly/i);
  assert.equal(massPingCalls, 0);

  const mentions = await fixture(t, async () => ({ answer: "Ping @everyone, <@123>, and @Raiders." }));
  const mentionReply = await mentions.help.handle(event("Repeat the supplied public notice safely.", {
    publicRules: [{ kind: "vtt-help", visibility: "public", source: "Synthetic notice", text: "A public test notice." }]
  }));
  assert.doesNotMatch(mentionReply.answer, /@(?:everyone|Raiders)|<@123>/);
  assert.deepEqual(mentionReply.delivery.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });

  let dailyCalls = 0;
  let dailyNow = new Date("2026-08-15T17:00:00Z");
  const daily = await fixture(t, async () => { dailyCalls += 1; return { answer: "ok" }; }, { dailyLimit: 2, now: () => dailyNow });
  assert.equal((await daily.help.handle(grounded("first"))).kind, "answer");
  assert.equal((await daily.help.handle(grounded("second"))).kind, "answer");
  assert.equal((await daily.help.handle(grounded("third"))).kind, "limit");
  assert.equal(dailyCalls, 2);
  dailyNow = new Date("2026-08-16T17:00:00Z");
  assert.equal((await daily.help.handle(grounded("new day"))).kind, "answer");
  assert.doesNotMatch(await fs.readFile(daily.statePath, "utf8"), /"(content|question|response|transcript)"\s*:/i);

  let monthlyCalls = 0;
  let monthlyNow = new Date("2026-08-15T17:00:00Z");
  const monthly = await fixture(t, async () => { monthlyCalls += 1; return { answer: "ok" }; }, { monthlyLimitCents: 2, now: () => monthlyNow });
  await monthly.help.handle(grounded("one"));
  await monthly.help.handle(grounded("two"));
  assert.equal((await monthly.help.handle(grounded("three"))).kind, "limit");
  assert.equal(monthlyCalls, 2);
  monthlyNow = new Date("2026-09-01T17:00:00Z");
  assert.equal((await monthly.help.handle(grounded("new month"))).kind, "answer");

  let balanceCalls = 0;
  const balance = await fixture(t, async () => { balanceCalls += 1; return { answer: "unused" }; });
  assert.equal((await balance.help.handle(grounded("question", { providerBalanceAvailable: false }))).kind, "limit");
  assert.equal(balanceCalls, 0);

  let failedCalls = 0;
  const failed = await fixture(t, async () => { failedCalls += 1; throw new Error("synthetic outage"); }, { dailyLimit: 1 });
  assert.equal((await failed.help.handle(grounded("first failure"))).kind, "unavailable");
  assert.equal((await failed.help.handle(grounded("second failure"))).kind, "limit");
  assert.equal(failedCalls, 1);

  let active = 0;
  let maxActive = 0;
  const overlaps = await fixture(t, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { answer: "ok" };
  });
  await Promise.all([overlaps.help.handle(grounded("overlap one")), overlaps.help.handle(grounded("overlap two"))]);
  assert.equal(maxActive, 1);

  const corrupt = await fixture(t);
  const corruptText = '{"version":1,"members":{"player-17":{"characters":{},"selections":{},"builders":{"thread-1":{"stage":"unknown"}}}},"usage":{"day":"2026-08-15","dailyByMember":{},"month":"2026-08","spentCents":0}}';
  await fs.writeFile(corrupt.statePath, corruptText, "utf8");
  await assert.rejects(corrupt.help.handle(grounded("question")), /builder state is invalid/);
  assert.equal(await fs.readFile(corrupt.statePath, "utf8"), corruptText);
});

test("audition 13: ambiguous monster context asks once before revealing any statistic", async (t) => {
  let calls = 0;
  const { help } = await fixture(t, async () => { calls += 1; return { answer: "should not run" }; });
  const modeReply = await help.handle(event("Help me with this character", { mode: "ambiguous" }));
  assert.equal(modeReply.kind, "clarify");
  assert.match(modeReply.answer, /building or leveling.*help with play/i);
  const reply = await help.handle(event("Does fire stop a troll from regenerating?", { topic: "monster" }));
  assert.equal(reply.kind, "clarify");
  assert.equal((reply.answer.match(/\?/g) || []).length, 1);
  assert.doesNotMatch(reply.answer, /fire|regenerat/i);
  const evidenceReply = await help.handle(event("Is the creature we are fighting right now immune to fire?", {
    publicRules: [{ kind: "published-monster", visibility: "public", source: "Synthetic bestiary", text: "Secret-to-this-test immunity fact." }]
  }));
  assert.equal(evidenceReply.kind, "clarify");
  assert.equal((evidenceReply.answer.match(/\?/g) || []).length, 1);
  assert.doesNotMatch(evidenceReply.answer, /immune|fire|immunity fact/i);
  assert.equal(calls, 0);
});

test("separation invariant: live startup does not compose player help into the manual scribe", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(__dirname, "..", "package.json"), "utf8"));
  const botSource = await fs.readFile(path.join(__dirname, "..", "bot.js"), "utf8");
  assert.equal(packageJson.scripts.start, "node bot.js");
  assert.doesNotMatch(botSource, /require\(["']\.\/(?:player-help|offline-discord-transport|deepseek-responder|vtt-character)/i);
  assert.match(botSource, /playerHelpTransport:\s*null/);
  assert.match(botSource, /COMMAND_PREFIX|commandPrefix/);
  assert.match(botSource, /client\.on\("messageCreate"/);
  assert.match(botSource, /client\.login\(token\)/);
  assert.match(botSource, /require\.main === module/);
});
