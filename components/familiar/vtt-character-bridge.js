"use strict";

const { execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { isDeepStrictEqual, promisify } = require("node:util");

const execute = promisify(execFile);
const MAX_PLAN_BYTES = 1_000_000;
const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_CHARACTER_BYTES = 1_000_000;
const CONTRACT = "player-character";
const VERSION = "player-character/1";
const OWNER = "20fates-vtt";
const VISIBILITY = "player-owned";
const BUILDER_REVISION = "revised-2024-level-one/1";
const NATIVE_FORMAT_VERSION = 2;
const INVALIDATION = "any-choice-or-vtt-revision-change";
const RECOVERY_MESSAGE = "The offline VTT handoff is missing, incompatible, or returned malformed output; no character file was created.";

function createVttCharacterBridge({ vttRoot, now = () => new Date() } = {}) {
  if (typeof vttRoot !== "string" || !vttRoot.trim()) throw new TypeError("A VTT project path is required.");
  if (typeof now !== "function") throw new TypeError("A confirmation clock is required.");
  const root = path.resolve(vttRoot);
  const command = path.join(root, "scripts", "prepare-character-handoff.ts");

  return async function runVttCharacterHandoff(plan) {
    let temporaryDirectory;
    try {
      const rejectedConfirmation = isRecord(plan) && plan.confirmation === "";
      const envelope = requestEnvelope(plan, now);
      const input = `${JSON.stringify(envelope)}\n`;
      if (Buffer.byteLength(input) > MAX_PLAN_BYTES) throw new Error("The Familiar character plan is too large.");

      temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "20fates-familiar-vtt-"));
      const inputFile = path.join(temporaryDirectory, "plan.json");
      const outputFile = path.join(temporaryDirectory, "character.json");
      await fs.writeFile(inputFile, input, { encoding: "utf8", flag: "wx" });

      let stdout;
      let exitCode = 0;
      try {
        ({ stdout } = await execute(process.execPath, [
          "--experimental-strip-types",
          command,
          inputFile,
          outputFile,
        ], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT_BYTES,
          timeout: 30_000,
          windowsHide: true,
        }));
      } catch (error) {
        if (Number(error?.code) !== 2 || typeof error?.stdout !== "string") throw error;
        exitCode = 2;
        stdout = error.stdout;
      }

      const result = handoffEnvelope(stdout, envelope);
      if ((result.status === "complete") !== (exitCode === 0)) throw new Error("The VTT command status contradicts its result envelope.");
      if (result.status !== "complete") {
        if (await exists(outputFile)) throw new Error("The VTT wrote a character file before confirmation.");
        if (result.status === "review" && rejectedConfirmation && result.reasons.length === 0) {
          result.reasons = ["Confirmation does not match the exact review Familiar presented; use this fresh review instead."];
        }
        return result;
      }

      if ((await fs.stat(outputFile)).size > MAX_CHARACTER_BYTES) throw new Error("The VTT character output is too large.");
      const nativeJson = await fs.readFile(outputFile, "utf8");
      const character = JSON.parse(nativeJson);
      if (!isRecord(character) || character.version !== NATIVE_FORMAT_VERSION || !isDeepStrictEqual(character, result.nativeDraft)) throw new Error("The VTT did not return the declared native version-2 character draft.");
      if (hash(nativeJson) !== result.contentHash) throw new Error("The VTT character content hash does not match its file.");
      delete result.nativeDraft;
      return { ...result, nativeJson };
    } catch (error) {
      throw new Error(RECOVERY_MESSAGE, { cause: error });
    } finally {
      if (temporaryDirectory) {
        try {
          await fs.rm(temporaryDirectory, { recursive: true, force: true });
        } catch (error) {
          throw new Error(RECOVERY_MESSAGE, { cause: error });
        }
      }
    }
  };
}

function requestEnvelope(plan, now) {
  const value = isRecord(plan) ? plan : {};
  const reviewFingerprint = typeof value.confirmation === "string" && value.confirmation
    ? value.confirmation
    : null;
  let confirmedAt = null;
  if (reviewFingerprint !== null) {
    const instant = now();
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw new Error("The confirmation time is unavailable.");
    confirmedAt = instant.toISOString();
  }
  return {
    contract: CONTRACT,
    version: VERSION,
    owner: OWNER,
    source: {
      project: OWNER,
      builderRevision: BUILDER_REVISION,
      nativeFormatVersion: NATIVE_FORMAT_VERSION,
    },
    freshness: {
      builderRevision: BUILDER_REVISION,
      nativeFormatVersion: NATIVE_FORMAT_VERSION,
      validation: "pending",
      reviewFingerprint,
      confirmedAt,
      invalidation: INVALIDATION,
    },
    visibility: VISIBILITY,
    payload: {
      selections: Object.prototype.hasOwnProperty.call(value, "selections") ? value.selections : null,
      suggestions: Object.prototype.hasOwnProperty.call(value, "suggestions") ? value.suggestions : {},
    },
  };
}

function handoffEnvelope(stdout, request) {
  const value = JSON.parse(stdout);
  if (!exactRecord(value, ["contract", "version", "owner", "source", "freshness", "visibility", "payload"])) throw new Error("The VTT returned a malformed player-character envelope.");
  if (value.contract !== CONTRACT || value.version !== VERSION || value.owner !== OWNER || value.visibility !== VISIBILITY) throw new Error("The VTT returned incompatible player-character contract metadata.");
  if (!exactRecord(value.source, ["project", "builderRevision", "nativeFormatVersion"])
    || value.source.project !== OWNER
    || value.source.builderRevision !== BUILDER_REVISION
    || value.source.nativeFormatVersion !== NATIVE_FORMAT_VERSION) throw new Error("The VTT returned incompatible source metadata.");
  if (!exactRecord(value.freshness, ["builderRevision", "nativeFormatVersion", "validation", "reviewFingerprint", "confirmedAt", "invalidation"])
    || value.freshness.builderRevision !== BUILDER_REVISION
    || value.freshness.nativeFormatVersion !== NATIVE_FORMAT_VERSION
    || value.freshness.invalidation !== INVALIDATION) throw new Error("The VTT returned incompatible freshness metadata.");
  const payload = value.payload;
  if (!exactRecord(payload, ["status", "confirmationRequired", "reasons", "review", "validation", "nativeDraft", "contentHash"])
    || !["incomplete", "review", "complete"].includes(payload.status)
    || value.freshness.validation !== payload.status
    || typeof payload.confirmationRequired !== "boolean"
    || payload.confirmationRequired !== (payload.status === "review")
    || !Array.isArray(payload.reasons)
    || payload.reasons.length > 100
    || payload.reasons.some((reason) => typeof reason !== "string" || reason.length > 1_000)) throw new Error("The VTT returned a malformed handoff payload.");
  if (!exactRecord(payload.review, ["selections", "suggestions", "summary"])
    || !isRecord(payload.review.selections)
    || !isRecord(payload.review.suggestions)
    || !isDeepStrictEqual(payload.review.selections, request.payload.selections)
    || !isDeepStrictEqual(payload.review.suggestions, request.payload.suggestions)
    || (payload.review.summary !== null && !isRecord(payload.review.summary))
    || (["review", "complete"].includes(payload.status) && !isRecord(payload.review.summary))) throw new Error("The VTT returned a malformed character review.");
  if (!exactRecord(payload.validation, ["selections", "builder", "nativeRoundTrip", "ownershipRebinding"])
    || !["supported", "incomplete"].includes(payload.validation.selections)
    || !["passed", "failed", "not-run"].includes(payload.validation.builder)
    || !["passed", "failed", "not-run"].includes(payload.validation.nativeRoundTrip)
    || !["passed", "failed", "not-run"].includes(payload.validation.ownershipRebinding)) throw new Error("The VTT returned malformed validation evidence.");
  const reviewFingerprint = value.freshness.reviewFingerprint;
  if (payload.status === "incomplete") {
    if (reviewFingerprint !== null || value.freshness.confirmedAt !== null || payload.nativeDraft !== null || payload.contentHash !== null) throw new Error("The VTT returned character material for an incomplete handoff.");
  } else if (!/^sha256:[0-9a-f]{64}$/.test(String(reviewFingerprint))) {
    throw new Error("The VTT returned an invalid review fingerprint.");
  }
  if (payload.status === "review") {
    if (value.freshness.confirmedAt !== null || payload.nativeDraft !== null || payload.contentHash !== null
      || payload.validation.selections !== "supported" || payload.validation.builder !== "passed"
      || payload.validation.nativeRoundTrip !== "not-run" || payload.validation.ownershipRebinding !== "not-run") throw new Error("The VTT returned an inconsistent review envelope.");
  }
  if (payload.status === "complete") {
    if (!isExactIsoTime(value.freshness.confirmedAt)
      || value.freshness.reviewFingerprint !== request.freshness.reviewFingerprint
      || value.freshness.confirmedAt !== request.freshness.confirmedAt
      || !isRecord(payload.nativeDraft)
      || payload.nativeDraft.version !== NATIVE_FORMAT_VERSION
      || !/^sha256:[0-9a-f]{64}$/.test(String(payload.contentHash))
      || Object.values(payload.validation).some((entry) => entry !== "supported" && entry !== "passed")) throw new Error("The VTT returned an inconsistent complete envelope.");
  }
  const result = {
    contract: value.contract,
    version: value.version,
    owner: value.owner,
    source: value.source,
    freshness: value.freshness,
    visibility: value.visibility,
    status: payload.status,
    confirmationRequired: payload.confirmationRequired,
    reasons: payload.reasons,
    review: payload.review,
    validation: payload.validation,
  };
  if (payload.status === "review" || payload.status === "complete") result.reviewFingerprint = reviewFingerprint;
  if (payload.status === "complete") {
    result.nativeDraft = payload.nativeDraft;
    result.contentHash = payload.contentHash;
  }
  return result;
}

function exactRecord(value, fields) {
  return isRecord(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function isExactIsoTime(value) {
  if (typeof value !== "string") return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function exists(file) {
  try {
    await fs.stat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

module.exports = { createVttCharacterBridge };
