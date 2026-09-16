"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const { createOfflineDiscordTransport } = require("../offline-discord-transport.js");

const execute = promisify(execFile);
const FAMILIAR_ID = "9000";
const OFFICIAL_GUILD_ID = "20fates";

function discordMessage(content, options = {}) {
  const replies = [];
  return {
    replies,
    message: {
      author: { id: options.authorId || "1000", bot: options.bot === true },
      channelId: options.channelId || "thread-1",
      guildId: options.guildId === undefined ? OFFICIAL_GUILD_ID : options.guildId,
      webhookId: options.webhookId ?? null,
      content,
      mentions: { users: { has: (id) => options.mentioned === true && id === FAMILIAR_ID } },
      async reply(payload) {
        replies.push(payload);
        return payload;
      }
    }
  };
}

function routing(options) {
  const { createBotMessageHandler } = require("../bot.js");
  return createBotMessageHandler({
    commandPrefix: "!scribe",
    scribeHandler: async () => { throw new Error("Unexpected scribe route."); },
    ...options
  });
}

test("an inert bot import routes one addressed Discord-shaped message through the reviewed transport", async () => {
  const botPath = path.join(__dirname, "..", "bot.js");
  const transportPath = path.join(__dirname, "..", "offline-discord-transport.js");
  const script = `
    "use strict";
    const assert = require("node:assert/strict");
    const Module = require("node:module");
    const forbidden = new Set(["dotenv", "discord.js", "@discordjs/voice", "prism-media", "./deepseek-responder.js", "./player-help.js", "./vtt-character-bridge.js", "./vtt-character-data.js"]);
    const load = Module._load;
    Module._load = function (request) {
      if (forbidden.has(request)) throw new Error("Live dependency loaded during import: " + request);
      return load.apply(this, arguments);
    };
    globalThis.fetch = () => { throw new Error("Network access attempted."); };
    const beforeSignals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const { createBotMessageHandler } = require(${JSON.stringify(botPath)});
    const { createOfflineDiscordTransport } = require(${JSON.stringify(transportPath)});
    assert.equal(typeof createBotMessageHandler, "function");
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], beforeSignals);
    let transportCalls = 0;
    let playerHelpCalls = 0;
    const replies = [];
    const transport = createOfflineDiscordTransport({
      familiarUserId: "9000",
      officialGuildId: "20fates",
      playerHelp: { async handle() { playerHelpCalls += 1; return { answer: "Ready.", supportingLines: [] }; } }
    });
    const handler = createBotMessageHandler({
      commandPrefix: "!scribe",
      scribeHandler: async () => { throw new Error("Scribe path was called."); },
      playerHelpTransport: async (message) => { transportCalls += 1; return transport(message); }
    });
    const message = {
      author: { id: "1000", bot: false }, channelId: "thread-1", guildId: "20fates", webhookId: null,
      content: "<@9000> who are you?", mentions: { users: { has: (id) => id === "9000" } },
      async reply(payload) { replies.push(payload); return payload; }
    };
    handler(message).then(() => {
      assert.equal(transportCalls, 1);
      assert.equal(playerHelpCalls, 1);
      assert.equal(replies.length, 1);
      assert.equal(replies[0].content, "Ready.");
      process.stdout.write("safe route\\n");
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  `;

  const { stdout } = await execute(process.execPath, ["-e", script], { windowsHide: true });
  assert.equal(stdout.trim(), "safe route");
});

test("unaddressed, other-guild, bot, and webhook messages send nothing", async () => {
  let playerHelpCalls = 0;
  const transport = createOfflineDiscordTransport({
    familiarUserId: FAMILIAR_ID,
    officialGuildId: OFFICIAL_GUILD_ID,
    playerHelp: { async handle() { playerHelpCalls += 1; return { answer: "Unexpected.", supportingLines: [] }; } }
  });
  const handler = routing({ playerHelpTransport: transport });
  const ignored = [
    discordMessage("ordinary conversation"),
    discordMessage(`<@${FAMILIAR_ID}> other guild`, { mentioned: true, guildId: "elsewhere" }),
    discordMessage(`<@${FAMILIAR_ID}> bot`, { mentioned: true, bot: true }),
    discordMessage(`<@${FAMILIAR_ID}> webhook`, { mentioned: true, webhookId: "hook-1" })
  ];

  for (const current of ignored) {
    assert.equal(await handler(current.message), null);
    assert.equal(current.replies.length, 0);
  }
  assert.equal(playerHelpCalls, 0);
});

test("an existing scribe command receives only its scribe response", async () => {
  let transportCalls = 0;
  const current = discordMessage(`!scribe status <@${FAMILIAR_ID}>`, { mentioned: true });
  const { createBotMessageHandler } = require("../bot.js");
  const handler = createBotMessageHandler({
    commandPrefix: "!scribe",
    scribeHandler: async (message) => message.reply("No scribe session is active."),
    playerHelpTransport: async () => { transportCalls += 1; throw new Error("Unexpected player-help route."); }
  });

  await handler(current.message);

  assert.deepEqual(current.replies, ["No scribe session is active."]);
  assert.equal(transportCalls, 0);
});

test("all four manual scribe commands remain routed to the manual handler", async () => {
  const seen = [];
  const { createBotMessageHandler } = require("../bot.js");
  const handler = createBotMessageHandler({
    commandPrefix: "!scribe",
    scribeHandler: async (message) => seen.push(message.content),
    playerHelpTransport: async () => {
      throw new Error("player help must stay outside manual scribe routing");
    }
  });

  for (const content of [
    "!scribe start 005",
    "!scribe stop",
    "!scribe status",
    "!scribe transcribe 005"
  ]) {
    await handler({ content });
  }

  assert.deepEqual(seen, [
    "!scribe start 005",
    "!scribe stop",
    "!scribe status",
    "!scribe transcribe 005"
  ]);
});

test("a null transport result produces no invented fallback", async () => {
  let playerHelpCalls = 0;
  const transport = createOfflineDiscordTransport({
    familiarUserId: FAMILIAR_ID,
    officialGuildId: OFFICIAL_GUILD_ID,
    playerHelp: { async handle() { playerHelpCalls += 1; return null; } }
  });
  const current = discordMessage(`<@${FAMILIAR_ID}> no answer`, { mentioned: true });

  assert.equal(await routing({ playerHelpTransport: transport })(current.message), null);
  assert.equal(playerHelpCalls, 1);
  assert.equal(current.replies.length, 0);
});

test("a player-help failure stays bounded and a later scribe message still works", async () => {
  const reports = [];
  let scribeCalls = 0;
  const { createBotMessageHandler } = require("../bot.js");
  const handler = createBotMessageHandler({
    commandPrefix: "!scribe",
    scribeHandler: async (message) => {
      scribeCalls += 1;
      return message.reply("Scribe still available.");
    },
    playerHelpTransport: async () => {
      throw new Error("DISCORD_BOT_TOKEN=synthetic nativeJson campaign-secret stack-trace");
    },
    reportPlayerHelpFailure: (message) => reports.push(message)
  });
  const failed = discordMessage(`<@${FAMILIAR_ID}> fail`, { mentioned: true });

  assert.equal(await handler(failed.message), null);
  assert.equal(failed.replies.length, 0);
  assert.deepEqual(reports, ["Familiar player help failed; no reply was sent."]);
  assert.doesNotMatch(reports.join(" "), /DISCORD_BOT_TOKEN|nativeJson|campaign-secret|stack-trace/);

  const scribe = discordMessage("!scribe status");
  await handler(scribe.message);
  assert.equal(scribeCalls, 1);
  assert.deepEqual(scribe.replies, ["Scribe still available."]);
});
