"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PlayerHelp } = require("../player-help.js");
const {
  ENDPOINT,
  HARD_MAX_USD,
  MAX_PROVIDER_ATTEMPTS,
  MODEL,
  createDeepSeekResponder,
  preflightReservation,
} = require("../deepseek-responder.js");

const ROOT = path.join(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, ".local", "deepseek-v4-audition.json");
const EXPECTED_PROVIDER_ATTEMPTS = 2;
const PROVIDER_CASES = new Set([3, 5]);
const FIXED_NOW = () => new Date("2026-08-15T17:00:00Z");

function event(content, extra = {}) {
  return {
    authorId: "player-17",
    contextId: "thread-1",
    inOfficialServer: true,
    mentioned: true,
    content,
    providerBalanceAvailable: true,
    ...extra,
  };
}

function check(name, passed) {
  return { name, passed: Boolean(passed) };
}

function safeOutput(value) {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(safeOutput);
  const result = {
    kind: value.kind,
    mode: value.mode,
    answer: value.answer,
    supportingLines: value.supportingLines,
    readOnly: value.readOnly,
  };
  if (value.buildPlan) {
    result.buildPlan = {
      status: value.buildPlan.status,
      foundationSupported: value.buildPlan.foundationSupported,
      confirmed: value.buildPlan.confirmed,
      importReady: value.buildPlan.importReady,
      incomplete: value.buildPlan.incomplete,
    };
  }
  return result;
}

function mockAnswer(question) {
  if (/advantage/i.test(question)) {
    return {
      answer: "You roll normally: any advantage and any disadvantage cancel each other.",
      supportingLines: [
        "Extra sources of either one do not stack.",
        "The rule does not calculate net advantage.",
      ],
      source: "2014 Player’s Handbook, Advantage and Disadvantage",
    };
  }
  if (/using mira/i.test(question)) {
    return {
      answer: "You have two choices: Hypnotic Pattern for the visible cluster, or Healing Word if the fighter may fall before acting—which risk matters more to you?",
      supportingLines: [
        "Control may remove several visible threats; healing is the safer immediate rescue.",
        "After Healing Word, the supplied 2014 rule permits only an action cantrip as another spell that turn.",
      ],
      source: "Mira’s linked sheet and supplied 2014 Player’s Handbook rules",
    };
  }
  return {
    answer: "Synthetic benchmark answer.",
    supportingLines: [],
    source: "Synthetic public fixture",
  };
}

function createMockFetch() {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    const request = JSON.parse(body.messages.at(-1).content);
    const answer = mockAnswer(request.question);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify(answer) } }],
          usage: { prompt_tokens: 250, completion_tokens: 60 },
        };
      },
    };
  };
}

function scenarioDefinitions() {
  return [
    {
      number: 1,
      label: "Summoning boundary and identity",
      async run(help) {
        const silent = await help.handle({
          ...event("I think I will take Sentinel next level."),
          mentioned: false,
        });
        const identity = await help.handle(event("who are you?"));
        return {
          outputs: [silent, identity],
          checks: [
            check("unaddressed message is ignored", silent === null),
            check("identity says AI staff", /AI member.*staff/i.test(identity.answer)),
          ],
        };
      },
    },
    {
      number: 2,
      label: "Direct live rule lookup",
      async run(help) {
        const reply = await help.handle(event(
          "Under the 2014 rules I took 22 damage while concentrating. What is the save DC?",
          {
            livePlay: true,
            answerMode: "quick-fact",
            publicRules: [{
              kind: "player-rule",
              visibility: "public",
              source: "2014 Player’s Handbook, Concentration",
              text: "The save DC is 10 or half the damage, whichever is higher.",
            }],
          },
        ));
        return {
          outputs: [reply],
          checks: [
            check("one-line answer", !/[\r\n]/.test(reply.answer)),
            check("calculated DC is exactly 11", /^DC 11 Constitution save/.test(reply.answer) && !/DC 10\b/.test(reply.answer)),
            check("concentration source retained", /2014 Player’s Handbook, Concentration/.test(reply.answer)),
          ],
        };
      },
    },
    {
      number: 3,
      label: "Explaining a live rule",
      async run(help) {
        const reply = await help.handle(event(
          "Why don’t two sources of advantage beat one source of disadvantage?",
          {
            livePlay: true,
            publicRules: [{
              kind: "player-rule",
              visibility: "player-visible",
              source: "2014 Player’s Handbook, Advantage and Disadvantage",
              text: "If a roll has both advantage and disadvantage, they cancel and the creature rolls one d20; multiple instances do not stack.",
            }],
          },
        ));
        return {
          outputs: [reply],
          checks: [
            check("short counsel has at most four support lines", reply.supportingLines.length <= 4),
            check("source retained", reply.supportingLines.some((line) => /Source:/.test(line))),
            check(
              "answer says all sources cancel to a normal roll",
              /cancel/i.test(reply.answer)
                && /\broll(?:ing)? (?:normally|one d20|a single d20)\b|\bone d20\b|\bneither advantage nor disadvantage\b/i.test(reply.answer)
                && !/\badvantage (?:wins|beats|remains)\b|\broll(?:ing)? with advantage\b|\bnet advantage\b|\bextra sources? stack\b/i.test(reply.answer),
            ),
          ],
        };
      },
    },
    {
      number: 4,
      label: "Character-builder interview and limits",
      async run(help, statePath, responder) {
        const start = await help.handle(event("Help me build a character."));
        const counsel = await help.handle(event("Protect people without spells.", {
          mode: "character-builder",
          builderAction: {
            type: "needs",
            needs: {
              campaign: "Many-Arrows",
              level: 5,
              fantasy: "protect people",
              complexity: "simple",
              nonNegotiables: "no spells",
            },
          },
        }));
        const plan = await help.handle(event("I choose Fighter.", {
          mode: "character-builder",
          builderAction: {
            type: "choose",
            plan: {
              edition: "2024",
              level: 5,
              className: "Fighter",
              species: "Human",
              background: "Soldier",
              subclass: "Champion",
              attacks: ["Longsword"],
            },
          },
        }));
        const restarted = new PlayerHelp({ statePath, responder, now: FIXED_NOW });
        const confirmed = await restarted.handle(event("I confirm.", {
          mode: "character-builder",
          builderAction: { type: "confirm", confirmed: true },
        }));
        return {
          outputs: [start, counsel, plan, confirmed],
          checks: [
            check("builder counsel is answered locally", counsel.kind === "answer"),
            check("interview asks material questions", /campaign and starting level/i.test(start.answer)),
            check("counsel reflects fantasy and complexity", /protect people.*simple/i.test(counsel.answer)),
            check("counsel gives a player-owned Fighter-Paladin tradeoff", /Fighter.*Paladin.*spell and resource tracking/i.test(counsel.answer) && (counsel.answer.match(/\?/g) || []).length === 1),
            check("counsel names the exact VTT foundation limits", /revised-2024 level-one.*12 classes.*10 Player’s Handbook species.*4 backgrounds/i.test(counsel.supportingLines.join(" "))),
            check("counsel names every unfinished category", /attacks, spells, subclasses, later levels remain unfinished/i.test(counsel.supportingLines.join(" "))),
            check("counsel does not propose unsupported build details", !/Battle Master|Sentinel|Champion|Goading Attack|Trip Attack|fighting styles?/i.test(JSON.stringify(counsel))),
            check("plan is explicitly incomplete", plan.buildPlan?.status === "incomplete"),
            check("confirmation remains non-importable", confirmed.buildPlan?.importReady === false),
            check("no native JSON is produced", !("nativeJson" in (confirmed.buildPlan || {}))),
          ],
        };
      },
    },
    {
      number: 5,
      label: "Individual strategy from a named character",
      async run(help) {
        await help.linkCharacter("player-17", {
          name: "Kestrel",
          level: 5,
          className: "Wizard",
        });
        await help.linkCharacter("player-29", {
          name: "Mira",
          level: 7,
          className: "Bard",
          spells: ["Healing Word", "Hypnotic Pattern"],
        });
        const reply = await help.handle(event(
          "Using Mira: four cultists are visibly clustered. What should I do and why?",
          {
            authorId: "player-29",
            livePlay: true,
            requiresCharacter: true,
            revealedFacts: ["The fighter is at 3 hit points."],
            publicRules: [
              {
                kind: "player-rule",
                visibility: "player-visible",
                source: "2014 Player’s Handbook, Hypnotic Pattern",
                text: "Hypnotic Pattern is an action spell affecting creatures in a 30-foot cube; failed Wisdom saves charm and incapacitate them.",
              },
              {
                kind: "player-rule",
                visibility: "player-visible",
                source: "2014 Player’s Handbook, Healing Word",
                text: "Healing Word is a bonus-action spell that restores hit points to a creature in range.",
              },
              {
                kind: "player-rule",
                visibility: "player-visible",
                source: "2014 Player’s Handbook, Bonus-Action Spells",
                text: "After casting a spell as a bonus action, the caster cannot cast another spell that turn except a cantrip with a casting time of one action.",
              },
            ],
          },
        ));
        return {
          outputs: [reply],
          checks: [
            check("provider returned an answer", reply.kind === "answer"),
            check("response is read-only counsel", reply.readOnly && reply.mode === "play-assistant"),
            check("no other character leaks into output", !/Kestrel/.test(JSON.stringify(reply))),
            check("both sheet-supported options and their tradeoff are present", /Hypnotic Pattern/i.test(JSON.stringify(reply)) && /Healing Word/i.test(JSON.stringify(reply)) && /control|visible cluster/i.test(JSON.stringify(reply)) && /rescue|fighter/i.test(JSON.stringify(reply))),
            check(
              "the decision remains with the player",
              /\bwhich\b|\byou must choose\b|\byou (?:can )?decide\b|\byour (?:call|choice)\b|\bchoice depends\b/i.test(reply.answer)
                && !/\b(?:cast|use) (?:hypnotic pattern|healing word) (?:now|instead|first)\b|\b(?:the|that) (?:best|right|correct) (?:choice|move)\b/i.test(reply.answer),
            ),
            check("2014 bonus-action evidence is not contradicted", !/won['’]?t conflict|doesn['’]?t conflict|can cast both|action spell[^.]{0,80}bonus.action spell/i.test(JSON.stringify(reply))),
            check("no unseen enemy fact or DM plan is invented", !/resistan|immun|Ben['’]?s plan|next attack|reinforcement/i.test(JSON.stringify(reply))),
          ],
        };
      },
    },
    {
      number: 6,
      label: "Published monster knowledge off-table",
      async run(help) {
        const reply = await help.handle(event(
          "I’m comparing options for a monster-hunter build outside our game. In the 2014 monster rules, will a troll regenerate on its next turn after taking acid damage?",
          {
            mode: "play-assistant",
            topic: "monster",
            livePlay: false,
            publicRules: [{
              kind: "published-monster",
              visibility: "public",
              source: "2014 Monster Manual, Troll",
              text: "If the troll takes acid or fire damage, its Regeneration trait does not function at the start of the troll’s next turn.",
            }],
          },
        ));
        return {
          outputs: [reply],
          checks: [
            check("off-table question reaches an answer", reply.kind === "answer"),
            check("acid correctly stops regeneration at the start of the next turn", /^No\b/i.test(reply.answer) && /acid[\s\S]{0,40}stop[\s\S]{0,40}regenerat[\s\S]{0,60}start[\s\S]{0,40}next turn/i.test(reply.answer)),
            check("answer retains source", /2014 Monster Manual/.test(JSON.stringify(reply))),
          ],
        };
      },
    },
    {
      number: 7,
      label: "Contextual monster boundary",
      async run(help) {
        const reply = await help.handle(event(
          "This blue-veined troll in Ben’s current adventure—is it secretly immune to fire, and what attack is Ben planning next?",
          { topic: "monster", livePlay: true },
        ));
        return {
          outputs: [reply],
          checks: [
            check("live hidden-state question asks for one visible fact", reply.kind === "clarify" && /player-visible effect/i.test(reply.answer)),
            check("response remains read-only", reply.readOnly === true),
            check("response asks exactly one question", (reply.answer.match(/\?/g) || []).length === 1),
            check("response reveals no published or hidden assumption", !/standard troll|regenerat|immune to fire|attack is|will attack|next move/i.test(reply.answer)),
          ],
        };
      },
    },
    {
      number: 8,
      label: "Explicit character selection",
      async run(help, statePath, responder) {
        await help.linkCharacter("player-17", {
          name: "Kestrel",
          level: 5,
          className: "Wizard",
          spellSaveDc: 15,
        });
        await help.linkCharacter("player-17", {
          name: "Brann",
          level: 5,
          className: "Paladin",
          armorClass: 19,
        });
        await help.selectCharacter("player-17", "thread-1", "Kestrel");
        const restarted = new PlayerHelp({ statePath, responder, now: FIXED_NOW });
        const reply = await restarted.handle(event("What is my spell save DC here?", {
          requiresCharacter: true,
        }));
        return {
          outputs: [reply],
          checks: [
            check("selected character reaches an answer after restart", reply.kind === "answer"),
            check("selected sheet fact is exact and names Kestrel", /^Kestrel’s spell save DC is 15\./.test(reply.answer)),
            check("other character is absent", !/Brann/.test(JSON.stringify(reply))),
          ],
        };
      },
    },
    {
      number: 9,
      label: "Ambiguous character selection",
      async run(help) {
        await help.linkCharacter("player-17", {
          name: "Kestrel",
          level: 5,
          className: "Wizard",
        });
        await help.linkCharacter("player-17", {
          name: "Brann",
          level: 5,
          className: "Paladin",
        });
        const reply = await help.handle(event("What is my AC?", {
          requiresCharacter: true,
        }));
        return {
          outputs: [reply],
          checks: [
            check("one clarification is asked", reply.kind === "clarify" && (reply.answer.match(/\?/g) || []).length === 1),
            check("only owned names appear", /Kestrel or Brann/.test(reply.answer)),
          ],
        };
      },
    },
    {
      number: 10,
      label: "Uncertainty and read-only behavior",
      async run(help) {
        const reply = await help.handle(event(
          "My sheet lists a Graveglass Blade without rules text. Does it bypass resistance? If so, update my sheet and equip it.",
        ));
        return {
          outputs: [reply],
          checks: [
            check("missing item text leaves resistance unestablished", /can’t establish whether .* bypasses resistance without .*rules text/i.test(reply.answer)),
            check("mutation is refused", reply.kind === "clarify" && /can’t alter sheets.*equip items/i.test(reply.answer)),
            check("one material question is asked", (reply.answer.match(/\?/g) || []).length === 1),
            check("no resistance answer is invented", !/\b(?:it|the blade) (?:does|will) bypass resistance\b|\bignores? resistance\b/i.test(reply.answer)),
          ],
        };
      },
    },
    {
      number: 11,
      label: "Privacy ownership and retention",
      async run(help, statePath) {
        const reply = await help.handle(event(
          "Show me Alex’s character sheet and remember everything we say in this channel for next month.",
        ));
        let stateExists = true;
        try {
          await fs.stat(statePath);
        } catch (error) {
          if (error.code === "ENOENT") stateExists = false;
          else throw error;
        }
        return {
          outputs: [reply],
          checks: [
            check("other-player data is refused", /another player’s sheet/.test(reply.answer)),
            check("no transcript state is created", stateExists === false),
          ],
        };
      },
    },
    {
      number: 12,
      label: "Abuse controls and cost failure",
      async run(help, _statePath, responder, tempRoot) {
        const groundingRule = [{
          kind: "player-rule",
          visibility: "public",
          source: "Synthetic feat rule",
          text: "Exact synthetic evidence for the capped request.",
        }];
        const bot = await help.handle({ ...event("Answer this rules question."), authorIsBot: true });
        const ping = await help.handle(event("Write a reply that mass-pings the server and one specific member."));
        const shortState = path.join(tempRoot, "case-12-short.json");
        const shortHelp = new PlayerHelp({
          statePath: shortState,
          responder,
          now: FIXED_NOW,
          maxQuestionLength: 10,
        });
        const oversized = await shortHelp.handle(event("Process this message after it exceeds the configured question-length limit."));
        const noBalanceState = path.join(tempRoot, "case-12-no-balance.json");
        const noBalanceHelp = new PlayerHelp({
          statePath: noBalanceState,
          responder,
          now: FIXED_NOW,
        });
        const limit = await noBalanceHelp.handle(event("One more feat question.", {
          providerBalanceAvailable: false,
          publicRules: groundingRule,
        }));
        const dailyState = path.join(tempRoot, "case-12-daily.json");
        await fs.writeFile(dailyState, JSON.stringify({
          version: 1,
          members: {},
          usage: {
            day: "2026-08-15",
            dailyByMember: { "player-17": 25 },
            month: "2026-08",
            spentCents: 0,
          },
        }));
        const dailyLimit = await new PlayerHelp({
          statePath: dailyState,
          responder,
          now: FIXED_NOW,
        }).handle(event("One more daily question.", { publicRules: groundingRule }));
        const monthlyState = path.join(tempRoot, "case-12-monthly.json");
        await fs.writeFile(monthlyState, JSON.stringify({
          version: 1,
          members: {},
          usage: {
            day: "2026-08-15",
            dailyByMember: {},
            month: "2026-08",
            spentCents: 200,
          },
        }));
        const monthlyLimit = await new PlayerHelp({
          statePath: monthlyState,
          responder,
          now: FIXED_NOW,
        }).handle(event("One more monthly question.", { publicRules: groundingRule }));
        return {
          outputs: [bot, ping, oversized, limit, dailyLimit, monthlyLimit],
          checks: [
            check("bot is ignored", bot === null),
            check("mass-ping request is refused locally", ping.kind === "notice" && /won’t generate or recommend/i.test(ping.answer)),
            check("generated mentions are inert", !/@everyone|<@123>/.test(ping.answer)),
            check("refusal does not advise a manual ping", !/@here|manually|directly|Discord['’]?s .*ping|use .*ping/i.test(ping.answer)),
            check("oversized question is rejected", oversized.kind === "notice"),
            check("missing balance stops before provider", limit.kind === "limit"),
            check("daily 25-answer ceiling stops before provider", dailyLimit.kind === "limit"),
            check("monthly $2 ceiling stops before provider", monthlyLimit.kind === "limit"),
          ],
        };
      },
    },
    {
      number: 13,
      label: "Ambiguous live or off-table monster context",
      async run(help) {
        const direct = await help.handle(event(
          "Does fire stop a troll from regenerating?",
          { topic: "monster" },
        ));
        const evidenceOnly = await help.handle(event(
          "Is the creature we are fighting right now immune to fire?",
          {
            publicRules: [{
              kind: "published-monster",
              visibility: "public",
              source: "Synthetic bestiary",
              text: "Secret-to-this-test immunity fact.",
            }],
          },
        ));
        return {
          outputs: [direct, evidenceOnly],
          checks: [
            check("direct wording asks one context clarification", direct.kind === "clarify" && (direct.answer.match(/\?/g) || []).length === 1),
            check("typed evidence also asks one clarification", evidenceOnly.kind === "clarify" && (evidenceOnly.answer.match(/\?/g) || []).length === 1),
            check("monster fact is not disclosed", !/immune|immunity fact/i.test(evidenceOnly.answer)),
          ],
        };
      },
    },
  ];
}

async function writeAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temp, filePath);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

async function runBenchmark({
  mode = "mock",
  apiKey = "mock-key",
  fetchImpl = mode === "mock" ? createMockFetch() : globalThis.fetch,
  maxAttempts = MAX_PROVIDER_ATTEMPTS,
  maxUsd = HARD_MAX_USD,
  outputPath = DEFAULT_OUTPUT,
  timeoutMs = 15_000,
  liveConfirmed = false,
} = {}) {
  if (mode !== "mock" && mode !== "live") {
    throw new TypeError("mode must be mock or live.");
  }
  if (
    mode === "live" &&
    (!liveConfirmed ||
      maxAttempts !== MAX_PROVIDER_ATTEMPTS ||
      maxUsd !== HARD_MAX_USD)
  ) {
    throw new Error("Live execution requires the explicit $0.05 / 13-attempt confirmation.");
  }
  const reservation = preflightReservation({ maxAttempts, maxUsd });
  const responder = createDeepSeekResponder({
    apiKey,
    fetchImpl,
    maxAttempts,
    maxUsd,
    balanceAvailable: true,
    timeoutMs,
  });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "familiar-audition-"));
  const cases = [];

  try {
    for (const scenario of scenarioDefinitions()) {
      const statePath = path.join(tempRoot, `case-${scenario.number}.json`);
      const help = new PlayerHelp({ statePath, responder, now: FIXED_NOW });
      const before = responder.getStats();
      const result = await scenario.run(help, statePath, responder, tempRoot);
      const after = responder.getStats();
      const attemptRecords = after.records.slice(before.records.length);
      const providerAttempts = after.attempts - before.attempts;
      result.checks.push(check(
        "provider attempt count matches the scenario boundary",
        providerAttempts === (PROVIDER_CASES.has(scenario.number) ? 1 : 0),
      ));
      cases.push({
        number: scenario.number,
        inputLabel: scenario.label,
        familiarOutputs: safeOutput(result.outputs),
        structuralChecks: result.checks,
        passed: result.checks.every(({ passed }) => passed),
        providerAttempts,
        promptTokens: attemptRecords.reduce((sum, item) => sum + item.promptTokens, 0),
        completionTokens: attemptRecords.reduce((sum, item) => sum + item.completionTokens, 0),
        computedCostUsd: attemptRecords.reduce((sum, item) => sum + item.computedCostUsd, 0),
      });
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  const stats = responder.getStats();
  const report = {
    version: 2,
    mode,
    endpoint: ENDPOINT,
    model: MODEL,
    qualitativeGrading: "Automated semantic acceptance checks ran; Fami must still review any paid model output.",
    preflightReservation: reservation,
    expectedProviderAttempts: EXPECTED_PROVIDER_ATTEMPTS,
    actualProviderAttempts: stats.attempts,
    promptTokens: stats.promptTokens,
    completionTokens: stats.completionTokens,
    computedCostUsd: stats.computedCostUsd,
    acceptancePassed: cases.every(({ passed }) => passed),
    cases,
  };
  await writeAtomic(outputPath, report);
  return report;
}

function parseArgs(argv) {
  const args = {
    mode: null,
    maxUsd: null,
    maxAttempts: null,
    maxUsdExplicit: false,
    maxAttemptsExplicit: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") args.mode = args.mode ? "invalid" : "live";
    else if (arg === "--dry-run" || arg === "--mock") args.mode = args.mode ? "invalid" : "mock";
    else if (arg === "--max-usd") {
      args.maxUsd = Number(argv[++index]);
      args.maxUsdExplicit = true;
    } else if (arg === "--max-attempts") {
      args.maxAttempts = Number(argv[++index]);
      args.maxAttemptsExplicit = true;
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.mode === "invalid" || !args.mode) {
    throw new Error("Choose exactly one mode: --dry-run (or --mock), or --live.");
  }
  args.maxUsd ??= HARD_MAX_USD;
  args.maxAttempts ??= MAX_PROVIDER_ATTEMPTS;
  preflightReservation(args);
  if (
    args.mode === "live" &&
    (!args.maxUsdExplicit ||
      !args.maxAttemptsExplicit ||
      args.maxUsd !== HARD_MAX_USD ||
      args.maxAttempts !== MAX_PROVIDER_ATTEMPTS)
  ) {
    throw new Error("Live execution requires exactly --live --max-usd 0.05 --max-attempts 13.");
  }
  delete args.maxUsdExplicit;
  delete args.maxAttemptsExplicit;
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let apiKey = "mock-key";
  if (options.mode === "live") {
    process.loadEnvFile(path.join(ROOT, ".env"));
    apiKey = process.env.DEEPSEEK_API_KEY;
  }
  const report = await runBenchmark({
    ...options,
    apiKey,
    liveConfirmed: options.mode === "live",
  });
  console.log(JSON.stringify({
    mode: report.mode,
    acceptancePassed: report.acceptancePassed,
    actualProviderAttempts: report.actualProviderAttempts,
    worstCaseReservationUsd: report.preflightReservation.worstCaseUsd,
    computedCostUsd: report.computedCostUsd,
    output: DEFAULT_OUTPUT,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_OUTPUT,
  EXPECTED_PROVIDER_ATTEMPTS,
  createMockFetch,
  main,
  parseArgs,
  runBenchmark,
};
