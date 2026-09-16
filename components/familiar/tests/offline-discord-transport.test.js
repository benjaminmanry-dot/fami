"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createOfflineDiscordTransport } = require("../offline-discord-transport.js");
const { PlayerHelp } = require("../player-help.js");
const { createVttCharacterBridge } = require("../vtt-character-bridge.js");
const { createVttCharacterData } = require("../vtt-character-data.js");

const FAMILIAR_ID = "9000";
const OFFICIAL_GUILD_ID = "20fates";
const VTT_ROOT = process.env.FAMILIAR_VTT_ROOT || path.join(path.parse(__dirname).root, "Ambitions", "20fates-vtt");
const ALLOWED_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };
const SUPPORTED_ANSWERS = [
  "Many-Arrows; hopeful frontier play", "1", "A shield-bearing protector who keeps friends standing",
  "Medium complexity", "No spellcasting", "Aria Vale", "Fighter", "Human", "Medium", "Soldier",
  "15", "13", "14", "8", "12", "10", "+2 and +1", "Strength", "Constitution",
  "Perception", "Survival", "Elvish", "Orc", "Protection", "Javelin", "Longsword", "Warhammer",
  "Insight", "Tough"
];

function discordMessage(content, options = {}) {
  const replies = [];
  const message = {
    author: { id: options.authorId || "1000", bot: options.bot === true },
    channelId: options.channelId || "thread-1",
    guildId: options.guildId === undefined ? OFFICIAL_GUILD_ID : options.guildId,
    webhookId: options.webhookId ?? null,
    content,
    mentions: { users: { has: (id) => options.mentioned === true && id === FAMILIAR_ID } },
    replyToFamiliar: options.callerReplyFlag === true,
    async reply(payload) {
      replies.push(payload);
      return payload;
    }
  };
  if (options.referenceAuthorId !== undefined || options.fetchError) {
    message.reference = { messageId: "referenced-message" };
    message.fetchReference = async () => {
      if (options.fetchError) throw new Error("synthetic missing reference");
      return { author: { id: options.referenceAuthorId } };
    };
  }
  return { message, replies };
}

async function realFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "familiar-discord-transport-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "player-help.json");
  const events = [];
  let providerCalls = 0;
  const help = new PlayerHelp({
    statePath,
    responder: async () => { providerCalls += 1; throw new Error("Provider boundary must remain unused."); },
    now: () => new Date("2026-08-16T17:00:00Z"),
    characterBuilderData: createVttCharacterData({ vttRoot: VTT_ROOT }),
    characterHandoff: createVttCharacterBridge({ vttRoot: VTT_ROOT })
  });
  const transport = createOfflineDiscordTransport({
    familiarUserId: FAMILIAR_ID,
    officialGuildId: OFFICIAL_GUILD_ID,
    playerHelp: {
      handle(event) {
        events.push(structuredClone(event));
        return help.handle(event);
      }
    }
  });
  return { transport, statePath, events, providerCalls: () => providerCalls };
}

async function deliver(transport, content, options = {}) {
  const current = discordMessage(content, {
    referenceAuthorId: FAMILIAR_ID,
    ...options
  });
  await transport(current.message);
  assert.equal(current.replies.length, 1);
  assert.deepEqual(current.replies[0].allowedMentions, ALLOWED_MENTIONS);
  return current.replies[0];
}

test("a synthetic Familiar mention maps the player and context into one safe reply", async () => {
  let received;
  const replies = [];
  const transport = createOfflineDiscordTransport({
    familiarUserId: FAMILIAR_ID,
    officialGuildId: OFFICIAL_GUILD_ID,
    playerHelp: {
      async handle(event) {
        received = event;
        return { answer: "Ready.", supportingLines: ["One supporting line."] };
      }
    }
  });
  const current = discordMessage("<@9000> Keep <@3000> exactly as written.", { mentioned: true });
  current.message.reply = async (payload) => { replies.push(payload); return payload; };

  await transport(current.message);

  assert.deepEqual(received, {
    authorId: "1000",
    contextId: "thread-1",
    inOfficialServer: true,
    mentioned: true,
    replyToFamiliar: false,
    authorIsBot: false,
    webhookId: null,
    isDirectMessage: false,
    providerBalanceAvailable: false,
    content: " Keep <@3000> exactly as written."
  });
  assert.deepEqual(replies, [{
    content: "Ready.\nOne supporting line.",
    allowedMentions: ALLOWED_MENTIONS
  }]);
});

test("an oversized ordinary reply is visibly truncated to Discord's character limit", async () => {
  const transport = createOfflineDiscordTransport({
    familiarUserId: FAMILIAR_ID,
    officialGuildId: OFFICIAL_GUILD_ID,
    playerHelp: { async handle() { return { answer: "x".repeat(2_001), supportingLines: [] }; } }
  });
  const current = discordMessage(`<@${FAMILIAR_ID}> test`, { mentioned: true });

  await transport(current.message);

  assert.ok(current.replies[0].content.length <= 2_000);
  assert.match(current.replies[0].content, /\[truncated\]$/);
});

test("an oversized character review keeps the exact confirmation instruction within Discord's limit", async () => {
  const summary = {
    rules: "Revised 2024", level: 1, name: "x".repeat(2_500), className: "Fighter", species: "Human",
    background: "Soldier", size: "Medium", baseScores: { str: 15 }, backgroundBoosts: "+2 Strength",
    finalScores: { str: 17 }, classSkills: ["Perception"], languages: ["Common"], featureChoices: [],
    startingEquipment: ["Chain Mail"], unfinished: ["attacks"]
  };
  const transport = createOfflineDiscordTransport({
    familiarUserId: FAMILIAR_ID,
    officialGuildId: OFFICIAL_GUILD_ID,
    playerHelp: {
      async handle() {
        return { answer: "ignored", supportingLines: [], characterHandoff: { status: "review", review: { summary, suggestions: {} } } };
      }
    }
  });
  const current = discordMessage(`<@${FAMILIAR_ID}> test`, { mentioned: true });

  await transport(current.message);

  assert.ok(current.replies[0].content.length <= 2_000);
  assert.equal(current.replies[0].content.endsWith(
    "Say exactly “I confirm” in this channel or thread to create the native-v2 character file."
  ), true);
  assert.equal("files" in current.replies[0], false);
});

test("unaddressed, unsafe, and unverified-reference messages stay silent", async () => {
  let calls = 0;
  const received = [];
  const transport = createOfflineDiscordTransport({
    familiarUserId: FAMILIAR_ID,
    officialGuildId: OFFICIAL_GUILD_ID,
    playerHelp: { async handle(event) { calls += 1; received.push(event); return { answer: "Handled.", supportingLines: [] }; } }
  });
  const ignored = [
    discordMessage("ordinary conversation"),
    discordMessage("<@9000> raw token without an actual mention"),
    discordMessage("mention collection entry without a content token", { mentioned: true }),
    discordMessage("DM", { guildId: null, mentioned: true }),
    discordMessage("other guild", { guildId: "elsewhere", mentioned: true }),
    discordMessage("bot", { bot: true, mentioned: true }),
    discordMessage("webhook", { webhookId: "hook-1", mentioned: true }),
    discordMessage("caller boolean", { callerReplyFlag: true }),
    discordMessage("reply to a player", { referenceAuthorId: "someone-else" }),
    discordMessage("missing reference", { fetchError: true })
  ];
  for (const current of ignored) {
    assert.equal(await transport(current.message), null);
    assert.equal(current.replies.length, 0);
  }
  assert.equal(calls, 0);

  const verified = discordMessage("Keep this reply wording intact.", { referenceAuthorId: FAMILIAR_ID });
  await transport(verified.message);
  assert.equal(calls, 1);
  assert.equal(verified.replies.length, 1);
  assert.equal(received[0].content, "Keep this reply wording intact.");
  assert.equal(received[0].mentioned, false);
  assert.equal(received[0].replyToFamiliar, true);
});

test("the complete synthetic mention-and-reply journey reviews before attaching one native-v2 file", async (t) => {
  const { transport, statePath, events, providerCalls } = await realFixture(t);

  const start = discordMessage("<@9000> Help me build a character", { mentioned: true });
  await transport(start.message);
  assert.equal(start.replies.length, 1);
  assert.match(start.replies[0].content, /campaign or table constraints/i);
  assert.deepEqual(start.replies[0].allowedMentions, ALLOWED_MENTIONS);
  assert.equal("files" in start.replies[0], false);

  let reply;
  for (const answer of SUPPORTED_ANSWERS) {
    if (answer === "Fighter") {
      const rejected = await deliver(transport, "no Fighter please");
      assert.match(rejected.content, /recorded no selection/i);
      assert.equal("files" in rejected, false);
      reply = await deliver(transport, "I want Fighter");
    } else {
      reply = await deliver(transport, answer);
    }
  }

  assert.equal("files" in reply, false);
  assert.ok(reply.content.length < 2_000);
  assert.match(reply.content, /Character review — Aria Vale/);
  assert.match(reply.content, /Revised 2024 level 1 Fighter; Human; Soldier; Medium/);
  assert.match(reply.content, /Abilities: STR 15→17/);
  assert.match(reply.content, /Skills: Perception, Survival/);
  assert.match(reply.content, /Languages: Common, Elvish, Orc/);
  assert.match(reply.content, /Fighting Style: Protection/);
  assert.match(reply.content, /Equipment: Chain Mail/);
  assert.match(reply.content, /Unfinished: attacks, spells, subclasses, later levels/);
  assert.match(reply.content, /Say exactly “I confirm” in this channel or thread/);
  assert.doesNotMatch(reply.content, /sha256:/);

  const generic = await deliver(transport, "yes");
  assert.equal("files" in generic, false);
  assert.match(generic.content, /say exactly.*I confirm/i);
  const otherMember = await deliver(transport, "I confirm", { authorId: "1001" });
  assert.equal("files" in otherMember, false);
  const otherContext = await deliver(transport, "I confirm", { channelId: "thread-2" });
  assert.equal("files" in otherContext, false);

  const before = await fs.readFile(statePath, "utf8");
  assert.equal(before.includes("nativeJson"), false);
  assert.equal(before.includes("Help me build a character"), false);

  const complete = await deliver(transport, "I confirm");
  assert.equal(complete.files.length, 1);
  assert.equal(complete.files[0].name, "20fates-character.json");
  assert.equal(Buffer.isBuffer(complete.files[0].attachment), true);
  assert.ok(complete.files[0].attachment.length <= 1_000_000);
  assert.equal(JSON.parse(complete.files[0].attachment.toString("utf8")).version, 2);
  assert.doesNotMatch(complete.content, /"version"\s*:\s*2/);

  const after = await fs.readFile(statePath, "utf8");
  assert.equal(after.includes("nativeJson"), false);
  assert.equal(providerCalls(), 0);
  assert.ok(events.every((event) => !("mode" in event) && !("builderAction" in event) && !("reviewFingerprint" in event)));
});

test("premature, absent, malformed, wrong-version, oversized, stale, and incomplete output never attaches", async () => {
  const summary = {
    rules: "Revised 2024", level: 1, name: "Synthetic", className: "Fighter", species: "Human",
    background: "Soldier", size: "Medium", baseScores: { str: 15 }, backgroundBoosts: "+2 Strength",
    finalScores: { str: 17 }, classSkills: ["Perception"], languages: ["Common"], featureChoices: [],
    startingEquipment: ["Chain Mail"], unfinished: ["attacks"]
  };
  const oversized = JSON.stringify({ version: 2, padding: "x".repeat(1_000_000) });
  const cases = [
    { label: "absent", handoff: { status: "complete" } },
    { label: "malformed", handoff: { status: "complete", nativeJson: "{" } },
    { label: "wrong version", handoff: { status: "complete", nativeJson: "{\"version\":1}" } },
    { label: "oversized", handoff: { status: "complete", nativeJson: oversized } },
    { label: "premature", handoff: { status: "review", review: { summary, suggestions: {} }, nativeJson: "{\"version\":2}" } },
    { label: "stale", handoff: { status: "review", review: { summary, suggestions: {} }, reasons: ["Fresh review required."], nativeJson: "{\"version\":2}" } },
    { label: "incomplete", handoff: { status: "incomplete", nativeJson: "{\"version\":2}" } }
  ];

  for (const currentCase of cases) {
    const transport = createOfflineDiscordTransport({
      familiarUserId: FAMILIAR_ID,
      officialGuildId: OFFICIAL_GUILD_ID,
      playerHelp: { async handle() { return { answer: currentCase.label, supportingLines: [], characterHandoff: currentCase.handoff }; } }
    });
    const current = discordMessage(`<@${FAMILIAR_ID}> test`, { mentioned: true });
    await transport(current.message);
    assert.equal(current.replies.length, 1, currentCase.label);
    assert.equal("files" in current.replies[0], false, currentCase.label);
    assert.deepEqual(current.replies[0].allowedMentions, ALLOWED_MENTIONS, currentCase.label);
  }
});
