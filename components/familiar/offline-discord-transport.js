"use strict";

const ALLOWED_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };
const CHARACTER_FILE_NAME = "20fates-character.json";
const MAX_CHARACTER_BYTES = 1_000_000;
const MAX_MESSAGE_CHARACTERS = 2_000;
const ATTACHMENT_FAILURE = "Familiar could not safely attach this character file; no file was created.";
const CONFIRM_INSTRUCTION = "Say exactly “I confirm” in this channel or thread to create the native-v2 character file.";
const TRUNCATION_NOTICE = "… [truncated]";

function createOfflineDiscordTransport({ playerHelp, familiarUserId, officialGuildId } = {}) {
  if (!playerHelp || typeof playerHelp.handle !== "function") throw new TypeError("PlayerHelp is required.");
  if (typeof familiarUserId !== "string" || !familiarUserId) throw new TypeError("A Familiar user ID is required.");
  if (typeof officialGuildId !== "string" || !officialGuildId) throw new TypeError("An official guild ID is required.");

  return async function handleSyntheticDiscordMessage(message) {
    if (!message || message.guildId !== officialGuildId || message.author?.bot || message.webhookId) return null;
    if (typeof message.author?.id !== "string" || typeof message.channelId !== "string" || typeof message.reply !== "function") return null;

    const content = String(message.content || "");
    const mentioned = message.mentions?.users?.has?.(familiarUserId) === true
      && (content.includes(`<@${familiarUserId}>`) || content.includes(`<@!${familiarUserId}>`));
    let replyToFamiliar = false;
    if (!mentioned && message.reference?.messageId && typeof message.fetchReference === "function") {
      try {
        replyToFamiliar = (await message.fetchReference())?.author?.id === familiarUserId;
      } catch {
        return null;
      }
    }
    if (!mentioned && !replyToFamiliar) return null;

    const result = await playerHelp.handle({
      authorId: message.author.id,
      contextId: message.channelId,
      inOfficialServer: true,
      mentioned,
      replyToFamiliar,
      authorIsBot: false,
      webhookId: message.webhookId ?? null,
      isDirectMessage: false,
      providerBalanceAvailable: false,
      content: mentioned ? removeFamiliarMention(content, familiarUserId) : content
    });
    if (!result) return null;

    return message.reply(replyPayload(result));
  };
}

function removeFamiliarMention(content, familiarUserId) {
  return String(content || "").replaceAll(`<@${familiarUserId}>`, "").replaceAll(`<@!${familiarUserId}>`, "");
}

function replyPayload(result) {
  const handoff = result.characterHandoff;
  if (handoff?.status === "review") return safePayload(reviewContent(handoff.review), CONFIRM_INSTRUCTION);
  if (handoff?.status !== "complete") {
    return safePayload([result.answer, ...(Array.isArray(result.supportingLines) ? result.supportingLines : [])].filter(Boolean).join("\n"));
  }

  try {
    if (typeof handoff.nativeJson !== "string") throw new Error("Missing character JSON.");
    const attachment = Buffer.from(handoff.nativeJson, "utf8");
    if (attachment.length > MAX_CHARACTER_BYTES) throw new Error("Oversized character JSON.");
    const character = JSON.parse(handoff.nativeJson);
    if (!isRecord(character) || character.version !== 2) throw new Error("Unsafe character JSON.");
    return {
      ...safePayload("Your confirmed native-v2 character file is attached for your review and player-controlled import."),
      files: [{ attachment, name: CHARACTER_FILE_NAME }]
    };
  } catch {
    return safePayload(ATTACHMENT_FAILURE);
  }
}

function reviewContent(review) {
  const summary = review?.summary;
  if (!isRecord(summary) || !isRecord(summary.finalScores)) return ATTACHMENT_FAILURE;
  const abilityScores = Object.entries(summary.finalScores).map(([ability, score]) => {
    const base = isRecord(summary.baseScores) ? summary.baseScores[ability] : undefined;
    return `${ability.toUpperCase()} ${base === undefined ? "?" : flat(base)}→${flat(score)}`;
  }).join(", ");
  const choices = Array.isArray(summary.featureChoices)
    ? summary.featureChoices.map((choice) => `${flat(choice?.title)}: ${list(choice?.selections)}`).filter((value) => !value.startsWith(":"))
    : [];
  const suggestions = isRecord(review.suggestions)
    ? Object.entries(review.suggestions).map(([field, value]) => `${field}: ${flat(Array.isArray(value) ? value.join(", ") : value)}`)
    : [];
  return [
    `Character review — ${flat(summary.name)}`,
    `${flat(summary.rules)} level ${flat(summary.level)} ${flat(summary.className)}; ${flat(summary.species)}; ${flat(summary.background)}; ${flat(summary.size)}.`,
    `Abilities: ${abilityScores}. Background boosts: ${flat(summary.backgroundBoosts)}.`,
    `Skills: ${list(summary.classSkills)}. Languages: ${list(summary.languages)}.`,
    ...(choices.length ? [`Choices: ${choices.join("; ")}.`] : []),
    `Equipment: ${list(summary.startingEquipment)}.`,
    ...(suggestions.length ? [`Advice only: ${suggestions.join("; ")}.`] : []),
    `Unfinished: ${list(summary.unfinished)}.`,
    CONFIRM_INSTRUCTION
  ].join("\n");
}

function safePayload(content, requiredTail = "") {
  let safeContent = String(content || ATTACHMENT_FAILURE);
  if (safeContent.length > MAX_MESSAGE_CHARACTERS) {
    const suffix = `\n${TRUNCATION_NOTICE}${requiredTail ? `\n${requiredTail}` : ""}`;
    const body = requiredTail && safeContent.endsWith(requiredTail)
      ? safeContent.slice(0, -requiredTail.length).trimEnd()
      : safeContent;
    let prefix = body.slice(0, Math.max(0, MAX_MESSAGE_CHARACTERS - suffix.length));
    if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
    safeContent = prefix + suffix;
  }
  return { content: safeContent, allowedMentions: ALLOWED_MENTIONS };
}

function flat(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(flat).filter(Boolean).join(", ") : "";
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

module.exports = { createOfflineDiscordTransport };
