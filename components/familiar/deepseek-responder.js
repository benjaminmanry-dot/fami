"use strict";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const MAX_OUTPUT_TOKENS = 512;
const MAX_MESSAGE_BYTES = 16_000;
const MAX_PROVIDER_ATTEMPTS = 13;
const RESERVED_INPUT_TOKENS = 25_000;
const INPUT_USD_PER_MILLION = 0.14;
const OUTPUT_USD_PER_MILLION = 0.28;
const HARD_MAX_USD = 0.05;

const SYSTEM_PROMPT = [
  "You are Familiar, a concise D&D 5e player-help assistant for 20Fates.",
  "Use only the supplied evidence; do not answer from model memory.",
  "Every factual claim must be entailed by that evidence, and any named source must come from it.",
  "If the evidence is insufficient, say so and ask at most one material clarification.",
  "For live strategy, give options and tradeoffs while leaving the decision to the player.",
  "Never invent private campaign facts.",
  "Return one JSON object with: answer (string), supportingLines (array of at most four strings), and source (string).",
  "Example JSON: {\"answer\":\"I need one visible fact.\",\"supportingLines\":[],\"source\":\"Supplied evidence\"}.",
  "Do not use Markdown fences or add text outside the JSON object.",
].join(" ");

class DeepSeekResponderError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "DeepSeekResponderError";
    this.code = code;
  }
}

function usageCostUsd(promptTokens, completionTokens) {
  if (!Number.isInteger(promptTokens) || promptTokens < 0) {
    throw new TypeError("promptTokens must be a non-negative integer.");
  }
  if (!Number.isInteger(completionTokens) || completionTokens < 0) {
    throw new TypeError("completionTokens must be a non-negative integer.");
  }
  return Number((
    (promptTokens * INPUT_USD_PER_MILLION +
      completionTokens * OUTPUT_USD_PER_MILLION) /
    1_000_000
  ).toFixed(12));
}

function preflightReservation({ maxAttempts, maxUsd }) {
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > MAX_PROVIDER_ATTEMPTS
  ) {
    throw new DeepSeekResponderError(
      `maxAttempts must be an integer from 1 to ${MAX_PROVIDER_ATTEMPTS}.`,
      "preflight-attempt-limit",
    );
  }
  if (
    typeof maxUsd !== "number" ||
    !Number.isFinite(maxUsd) ||
    maxUsd <= 0 ||
    maxUsd > HARD_MAX_USD
  ) {
    throw new DeepSeekResponderError(
      `maxUsd must be greater than zero and no more than $${HARD_MAX_USD.toFixed(2)}.`,
      "preflight-budget-limit",
    );
  }

  const perAttemptUsd = usageCostUsd(
    RESERVED_INPUT_TOKENS,
    MAX_OUTPUT_TOKENS,
  );
  const worstCaseUsd = Number((perAttemptUsd * maxAttempts).toFixed(12));
  if (worstCaseUsd > maxUsd) {
    throw new DeepSeekResponderError(
      "The worst-case reservation exceeds the configured budget.",
      "preflight-budget-exceeded",
    );
  }

  return Object.freeze({
    maxAttempts,
    maxUsd,
    reservedInputTokensPerAttempt: RESERVED_INPUT_TOKENS,
    reservedOutputTokensPerAttempt: MAX_OUTPUT_TOKENS,
    perAttemptUsd,
    worstCaseUsd,
  });
}

function messageContentBytes(messages) {
  return messages.reduce(
    (total, message) => total + Buffer.byteLength(message.content, "utf8"),
    0,
  );
}

function createMessages(request) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(request) },
  ];
}

function readUsage(payload) {
  const promptTokens = payload?.usage?.prompt_tokens;
  const completionTokens = payload?.usage?.completion_tokens;
  if (
    !Number.isInteger(promptTokens) ||
    promptTokens < 0 ||
    !Number.isInteger(completionTokens) ||
    completionTokens < 0
  ) {
    throw new DeepSeekResponderError(
      "DeepSeek returned malformed token usage.",
      "malformed-usage",
    );
  }
  return {
    promptTokens,
    completionTokens,
    computedCostUsd: usageCostUsd(promptTokens, completionTokens),
  };
}

function readAnswer(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new DeepSeekResponderError(
      "DeepSeek returned malformed output.",
      "malformed-output",
    );
  }

  let answer;
  try {
    answer = JSON.parse(content);
  } catch {
    throw new DeepSeekResponderError(
      "DeepSeek returned malformed output.",
      "malformed-output",
    );
  }

  if (
    !answer ||
    typeof answer !== "object" ||
    Array.isArray(answer) ||
    typeof answer.answer !== "string" ||
    answer.answer.trim().length === 0 ||
    answer.answer.length > 2_000 ||
    !Array.isArray(answer.supportingLines) ||
    answer.supportingLines.length > 4 ||
    answer.supportingLines.some(
      (line) => typeof line !== "string" || line.length > 500,
    ) ||
    typeof answer.source !== "string" ||
    answer.source.length > 300
  ) {
    throw new DeepSeekResponderError(
      "DeepSeek returned malformed output.",
      "malformed-output",
    );
  }

  return {
    answer: answer.answer.trim(),
    supportingLines: answer.supportingLines.map((line) => line.trim()),
    source: answer.source.trim(),
  };
}

function createDeepSeekResponder({
  apiKey,
  fetchImpl = globalThis.fetch,
  maxAttempts = MAX_PROVIDER_ATTEMPTS,
  maxUsd = HARD_MAX_USD,
  balanceAvailable,
  timeoutMs = 15_000,
} = {}) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new DeepSeekResponderError(
      "DEEPSEEK_API_KEY is missing.",
      "missing-api-key",
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("timeoutMs must be an integer from 1 to 60000.");
  }

  const reservation = preflightReservation({ maxAttempts, maxUsd });
  let attempts = 0;
  let queue = Promise.resolve();
  const records = [];

  function recordAttempt(record) {
    records.push(Object.freeze({
      attempt: record.attempt,
      status: record.status,
      promptTokens: record.promptTokens || 0,
      completionTokens: record.completionTokens || 0,
      computedCostUsd: record.computedCostUsd || 0,
    }));
  }

  async function perform(request) {
    const messages = createMessages(request);
    const contentBytes = messageContentBytes(messages);
    if (contentBytes > MAX_MESSAGE_BYTES) {
      throw new DeepSeekResponderError(
        `Message content exceeds the ${MAX_MESSAGE_BYTES}-byte limit.`,
        "message-byte-limit",
      );
    }
    if (attempts >= maxAttempts) {
      throw new DeepSeekResponderError(
        "DeepSeek attempt limit reached.",
        "attempt-limit",
      );
    }

    attempts += 1;
    const attempt = attempts;
    if (balanceAvailable !== true) {
      recordAttempt({ attempt, status: "missing-balance" });
      throw new DeepSeekResponderError(
        "DeepSeek balance is not confirmed.",
        "missing-balance",
      );
    }

    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal,
      });
    } catch (error) {
      const timedOut =
        error?.name === "TimeoutError" || error?.name === "AbortError";
      recordAttempt({
        attempt,
        status: timedOut ? "timeout" : "network-error",
      });
      throw new DeepSeekResponderError(
        timedOut
          ? "DeepSeek request timed out."
          : "DeepSeek request failed before a response.",
        timedOut ? "timeout" : "network-error",
      );
    }

    if (!response || response.ok !== true) {
      const status = Number.isInteger(response?.status)
        ? response.status
        : "unknown";
      recordAttempt({ attempt, status: "non-2xx" });
      throw new DeepSeekResponderError(
        `DeepSeek request failed with status ${status}.`,
        "non-2xx",
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      recordAttempt({ attempt, status: "malformed-response" });
      throw new DeepSeekResponderError(
        "DeepSeek returned malformed output.",
        "malformed-output",
      );
    }

    let usage;
    try {
      usage = readUsage(payload);
    } catch (error) {
      recordAttempt({ attempt, status: "malformed-usage" });
      throw error;
    }
    if (
      usage.promptTokens > RESERVED_INPUT_TOKENS ||
      usage.completionTokens > MAX_OUTPUT_TOKENS
    ) {
      recordAttempt({ attempt, status: "usage-limit", ...usage });
      throw new DeepSeekResponderError(
        "DeepSeek reported token usage above the reserved envelope.",
        "usage-limit",
      );
    }

    let answer;
    try {
      answer = readAnswer(payload);
    } catch (error) {
      recordAttempt({ attempt, status: "malformed-output", ...usage });
      throw error;
    }

    recordAttempt({ attempt, status: "ok", ...usage });
    return answer;
  }

  function responder(request) {
    const pending = queue.then(() => perform(request));
    queue = pending.catch(() => undefined);
    return pending;
  }

  responder.getStats = () => {
    const promptTokens = records.reduce(
      (total, record) => total + record.promptTokens,
      0,
    );
    const completionTokens = records.reduce(
      (total, record) => total + record.completionTokens,
      0,
    );
    return {
      attempts,
      reservation,
      promptTokens,
      completionTokens,
      computedCostUsd: usageCostUsd(promptTokens, completionTokens),
      records: records.map((record) => ({ ...record })),
    };
  };

  return responder;
}

module.exports = {
  ENDPOINT,
  HARD_MAX_USD,
  INPUT_USD_PER_MILLION,
  MAX_MESSAGE_BYTES,
  MAX_OUTPUT_TOKENS,
  MAX_PROVIDER_ATTEMPTS,
  MODEL,
  OUTPUT_USD_PER_MILLION,
  RESERVED_INPUT_TOKENS,
  DeepSeekResponderError,
  createDeepSeekResponder,
  preflightReservation,
  usageCostUsd,
};
