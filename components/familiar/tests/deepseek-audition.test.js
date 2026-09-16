"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ENDPOINT,
  MAX_MESSAGE_BYTES,
  MAX_OUTPUT_TOKENS,
  MODEL,
  createDeepSeekResponder,
  preflightReservation,
  usageCostUsd,
} = require("../deepseek-responder.js");
const {
  EXPECTED_PROVIDER_ATTEMPTS,
  createMockFetch,
  parseArgs,
  runBenchmark,
} = require("../scripts/run-deepseek-audition.js");

function responseFor(answer = {
  answer: "Synthetic answer.",
  supportingLines: [],
  source: "Synthetic public fixture",
}, usage = { prompt_tokens: 100, completion_tokens: 20 }) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [{ message: { content: JSON.stringify(answer) } }],
        usage,
      };
    },
  };
}

test("preflight reserves the fixed worst case and live mode requires the explicit trio", () => {
  const plan = preflightReservation({ maxAttempts: 13, maxUsd: 0.05 });
  assert.equal(plan.perAttemptUsd, 0.00364336);
  assert.equal(plan.worstCaseUsd, 0.04736368);
  assert.equal(usageCostUsd(25_000, 512), plan.perAttemptUsd);
  assert.throws(
    () => preflightReservation({ maxAttempts: 14, maxUsd: 0.05 }),
    /maxAttempts/,
  );
  assert.throws(
    () => preflightReservation({ maxAttempts: 13, maxUsd: 0.04 }),
    /exceeds the configured budget/,
  );
  assert.throws(
    () => preflightReservation({ maxAttempts: 1, maxUsd: 0.051 }),
    /no more than \$0\.05/,
  );
  assert.throws(() => parseArgs(["--live"]), /requires exactly/);
  assert.deepEqual(
    parseArgs(["--live", "--max-usd", "0.05", "--max-attempts", "13"]),
    { mode: "live", maxUsd: 0.05, maxAttempts: 13 },
  );
  assert.deepEqual(parseArgs(["--dry-run"]), {
    mode: "mock",
    maxUsd: 0.05,
    maxAttempts: 13,
  });
});

test("adapter sends only the fixed envelope and records sanitized reported usage", async () => {
  const secret = "synthetic-secret-that-must-not-leak";
  let captured;
  const responder = createDeepSeekResponder({
    apiKey: secret,
    balanceAvailable: true,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return responseFor();
    },
  });
  const result = await responder({
    question: "What is the synthetic rule?",
    mode: "play-assistant",
    livePlay: false,
    answerMode: "quick-fact",
    evidence: { publicRules: [], selectedCharacter: null, suppliedOrRevealedFacts: [] },
  });
  const body = JSON.parse(captured.options.body);
  assert.equal(captured.url, ENDPOINT);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(body.model, MODEL);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, MAX_OUTPUT_TOKENS);
  assert.match(body.messages[0].content, /do not answer from model memory/i);
  assert.match(body.messages[0].content, /Every factual claim must be entailed/i);
  assert.match(body.messages[0].content, /Example JSON: \{"answer":/);
  assert.equal(
    body.messages.reduce(
      (sum, message) => sum + Buffer.byteLength(message.content, "utf8"),
      0,
    ) <= MAX_MESSAGE_BYTES,
    true,
  );
  assert.deepEqual(result, {
    answer: "Synthetic answer.",
    supportingLines: [],
    source: "Synthetic public fixture",
  });
  const stats = responder.getStats();
  assert.equal(stats.attempts, 1);
  assert.equal(stats.promptTokens, 100);
  assert.equal(stats.completionTokens, 20);
  assert.equal(stats.computedCostUsd, 0.0000196);
  assert.doesNotMatch(JSON.stringify({ result, stats }), new RegExp(secret));
  assert.equal("headers" in stats, false);
});

test("byte and attempt ceilings stop before another provider call", async () => {
  let calls = 0;
  const responder = createDeepSeekResponder({
    apiKey: "synthetic-key",
    balanceAvailable: true,
    maxAttempts: 1,
    fetchImpl: async () => {
      calls += 1;
      return responseFor();
    },
  });
  await assert.rejects(
    responder({ question: "x".repeat(MAX_MESSAGE_BYTES) }),
    /byte limit/,
  );
  assert.equal(responder.getStats().attempts, 0);
  assert.equal(calls, 0);
  await responder({ question: "short" });
  await assert.rejects(responder({ question: "one too many" }), /attempt limit/);
  assert.equal(responder.getStats().attempts, 1);
  assert.equal(calls, 1);
});

test("non-2xx, malformed output, timeout, missing balance, and fetch errors fail once without leaking secrets", async (t) => {
  const secret = "never-print-this-synthetic-secret";
  const cases = [
    {
      name: "non-2xx",
      fetchImpl: async () => ({ ok: false, status: 429 }),
      balanceAvailable: true,
      code: "non-2xx",
      fetchCalls: 1,
    },
    {
      name: "malformed output",
      fetchImpl: async () => responseFor({
        answer: "ok",
        supportingLines: "not-an-array",
        source: "fixture",
      }),
      balanceAvailable: true,
      code: "malformed-output",
      fetchCalls: 1,
    },
    {
      name: "malformed usage",
      fetchImpl: async () => responseFor(undefined, {
        prompt_tokens: "100",
        completion_tokens: 20,
      }),
      balanceAvailable: true,
      code: "malformed-usage",
      fetchCalls: 1,
    },
    {
      name: "reported token limit",
      fetchImpl: async () => responseFor(undefined, {
        prompt_tokens: 25_001,
        completion_tokens: 20,
      }),
      balanceAvailable: true,
      code: "usage-limit",
      fetchCalls: 1,
    },
    {
      name: "timeout",
      fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
      balanceAvailable: true,
      code: "timeout",
      fetchCalls: 1,
      timeoutMs: 5,
    },
    {
      name: "missing balance",
      fetchImpl: async () => responseFor(),
      balanceAvailable: undefined,
      code: "missing-balance",
      fetchCalls: 0,
    },
    {
      name: "fetch error",
      fetchImpl: async () => {
        throw new Error(secret);
      },
      balanceAvailable: true,
      code: "network-error",
      fetchCalls: 1,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      let calls = 0;
      const responder = createDeepSeekResponder({
        apiKey: secret,
        balanceAvailable: item.balanceAvailable,
        timeoutMs: item.timeoutMs || 100,
        fetchImpl: async (...args) => {
          calls += 1;
          return item.fetchImpl(...args);
        },
      });
      let failure;
      try {
        await responder({ question: "synthetic failure case" });
      } catch (error) {
        failure = error;
      }
      assert.equal(failure.code, item.code);
      assert.doesNotMatch(`${failure.message}\n${JSON.stringify(responder.getStats())}`, new RegExp(secret));
      assert.equal(calls, item.fetchCalls);
      assert.equal(responder.getStats().attempts, 1);
      assert.equal(responder.getStats().records.length, 1);
    });
  }
});

test("overlapping adapter calls are serialized and never retried", async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const responder = createDeepSeekResponder({
    apiKey: "synthetic-key",
    balanceAvailable: true,
    fetchImpl: async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return responseFor();
    },
  });
  await Promise.all([
    responder({ question: "first" }),
    responder({ question: "second" }),
  ]);
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
  assert.equal(responder.getStats().attempts, 2);
});

test("programmatic live runner also refuses without explicit confirmation", async () => {
  let calls = 0;
  await assert.rejects(
    runBenchmark({
      mode: "live",
      apiKey: "synthetic-key",
      fetchImpl: async () => {
        calls += 1;
        return responseFor();
      },
    }),
    /explicit \$0\.05 \/ 13-attempt confirmation/,
  );
  assert.equal(calls, 0);
});

test("mock runner drives all 13 auditions and writes only the sanitized report", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familiar-deepseek-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const outputPath = path.join(dir, "report.json");
  const report = await runBenchmark({ mode: "mock", outputPath });
  assert.equal(report.cases.length, 13);
  assert.equal(report.acceptancePassed, true);
  assert.equal(report.expectedProviderAttempts, EXPECTED_PROVIDER_ATTEMPTS);
  assert.equal(report.actualProviderAttempts, EXPECTED_PROVIDER_ATTEMPTS);
  assert.deepEqual(
    report.cases.filter(({ providerAttempts }) => providerAttempts === 0).map(({ number }) => number),
    [1, 2, 4, 6, 7, 8, 9, 10, 11, 12, 13],
  );
  assert.equal(report.cases.every(({ passed }) => passed), true);
  assert.equal(
    report.cases.find(({ number }) => number === 12).structuralChecks.length,
    9,
  );
  assert.match(report.cases.find(({ number }) => number === 2).familiarOutputs[0].answer, /^DC 11 Constitution save/);
  assert.match(report.cases.find(({ number }) => number === 8).familiarOutputs[0].answer, /^Kestrel’s spell save DC is 15\./);
  assert.match(report.cases.find(({ number }) => number === 6).familiarOutputs[0].answer, /^No—acid damage stops .*start of its next turn/i);
  assert.match(report.cases.find(({ number }) => number === 10).familiarOutputs[0].answer, /can’t establish whether .* bypasses resistance without .*rules text/i);
  assert.equal(report.cases.find(({ number }) => number === 7).familiarOutputs[0].kind, "clarify");
  assert.equal(report.cases.find(({ number }) => number === 12).familiarOutputs[1].kind, "notice");
  const text = await fs.readFile(outputPath, "utf8");
  assert.deepEqual(JSON.parse(text), report);
  assert.doesNotMatch(
    text,
    /"(?:question|messages|headers|apiKey|authorization|rawResponse|transcript)"\s*:/i,
  );
  assert.doesNotMatch(text, /mock-key/);
});

test("semantic checker rejects a polished but wrong strategy answer", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familiar-semantic-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const goodFetch = createMockFetch();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    const request = JSON.parse(body.messages.at(-1).content);
    if (!/using mira/i.test(request.question)) return goodFetch(url, options);
    return responseFor({
      answer: "Cast Hypnotic Pattern now.",
      supportingLines: ["It won’t conflict with Healing Word’s bonus-action casting."],
      source: "2014 Player’s Handbook",
    });
  };
  const report = await runBenchmark({
    mode: "mock",
    fetchImpl,
    outputPath: path.join(dir, "report.json"),
  });
  const strategy = report.cases.find(({ number }) => number === 5);
  assert.equal(report.acceptancePassed, false);
  assert.equal(strategy.passed, false);
  assert.equal(strategy.familiarOutputs[0].kind, "unavailable");
  assert.equal(strategy.structuralChecks.some(({ name, passed }) => name === "provider returned an answer" && !passed), true);
});

test("semantic checks accept the correct second-audition meanings for cases 3 and 5", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familiar-live-wording-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const goodFetch = createMockFetch();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    const request = JSON.parse(body.messages.at(-1).content);
    if (/advantage/i.test(request.question)) {
      return responseFor({
        answer: "Any number of advantage and disadvantage sources cancel, so you roll one d20.",
        supportingLines: [
          "Extra sources on either side do not stack.",
          "The rule does not calculate net advantage.",
        ],
        source: "2014 Player’s Handbook, Advantage and Disadvantage",
      });
    }
    if (/using mira/i.test(request.question)) {
      return responseFor({
        answer: "You must choose between Hypnotic Pattern for control and Healing Word for rescue; your choice depends on whether the visible cluster or the wounded fighter is the greater risk.",
        supportingLines: [
          "After Healing Word, the supplied 2014 rule permits only an action cantrip as another spell that turn.",
        ],
        source: "Mira’s linked sheet and supplied 2014 Player’s Handbook rules",
      });
    }
    return goodFetch(url, options);
  };
  const report = await runBenchmark({
    mode: "mock",
    fetchImpl,
    outputPath: path.join(dir, "report.json"),
  });
  assert.equal(report.cases.find(({ number }) => number === 3).passed, true);
  assert.equal(report.cases.find(({ number }) => number === 5).passed, true);
  assert.equal(report.acceptancePassed, true);
});

test("semantic checks still reject materially wrong case-3 and directive case-5 answers", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familiar-semantic-negative-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const goodFetch = createMockFetch();
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    const request = JSON.parse(body.messages.at(-1).content);
    if (/advantage/i.test(request.question)) {
      return responseFor({
        answer: "Two sources of advantage beat one source of disadvantage, so roll with advantage.",
        supportingLines: ["Extra sources stack into net advantage."],
        source: "2014 Player’s Handbook, Advantage and Disadvantage",
      });
    }
    if (/using mira/i.test(request.question)) {
      return responseFor({
        answer: "Cast Hypnotic Pattern now; that is the correct move.",
        supportingLines: [
          "Hypnotic Pattern controls the visible cluster; Healing Word could rescue the fighter.",
          "After Healing Word, the supplied 2014 rule permits only an action cantrip as another spell that turn.",
        ],
        source: "Mira’s linked sheet and supplied 2014 Player’s Handbook rules",
      });
    }
    return goodFetch(url, options);
  };
  const report = await runBenchmark({
    mode: "mock",
    fetchImpl,
    outputPath: path.join(dir, "report.json"),
  });
  const advantage = report.cases.find(({ number }) => number === 3);
  const strategy = report.cases.find(({ number }) => number === 5);
  assert.equal(advantage.passed, false);
  assert.equal(strategy.passed, false);
  assert.equal(advantage.structuralChecks.some(({ name, passed }) => name === "answer says all sources cancel to a normal roll" && !passed), true);
  assert.equal(strategy.structuralChecks.some(({ name, passed }) => name === "the decision remains with the player" && !passed), true);
});
