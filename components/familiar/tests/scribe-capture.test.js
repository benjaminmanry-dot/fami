"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { __test } = require("../bot.js");

function capture() {
  return {
    outDir: "C:\\recordings\\session",
    manifest: { chunks: [] },
    subscriptions: new Map()
  };
}

test("manifest writes use a fresh temporary path and clean it after failure", () => {
  const written = [];
  const removed = [];
  const io = {
    writeFileSync(file) { written.push(file); },
    renameSync() {
      const error = new Error("busy");
      error.code = "EPERM";
      throw error;
    },
    existsSync() { return true; },
    unlinkSync(file) { removed.push(file); }
  };
  const current = capture();

  assert.throws(() => __test.saveManifest(current, io), { code: "EPERM" });
  assert.throws(() => __test.saveManifest(current, io), { code: "EPERM" });
  assert.equal(written.length, 2);
  assert.notEqual(written[0], written[1]);
  assert.deepEqual(removed, written);
});

test("a failed starting-manifest write cannot create or strand a speaker subscription", () => {
  const current = capture();
  const chunk = { id: "chunk-1", userId: "speaker-1" };
  let buildCalled = false;

  assert.throws(
    () => __test.beginSubscription(
      current,
      chunk,
      () => {
        buildCalled = true;
        return { done: Promise.resolve() };
      },
      () => { throw new Error("manifest unavailable"); }
    ),
    /manifest unavailable/
  );

  assert.equal(buildCalled, false);
  assert.deepEqual(current.manifest.chunks, []);
  assert.equal(current.subscriptions.has("speaker-1"), false);

  const retryChunk = { id: "chunk-2", userId: "speaker-1" };
  const retry = { done: Promise.resolve() };
  assert.equal(
    __test.beginSubscription(current, retryChunk, () => retry, () => {}),
    retry
  );
  assert.equal(current.subscriptions.get("speaker-1"), retry);
  assert.deepEqual(current.manifest.chunks, [retryChunk]);
});

test("rapid manifest updates leave one valid final manifest and no temporary files", (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "familiar-manifest-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const current = {
    outDir,
    manifest: { chunks: [], sequence: -1 },
    subscriptions: new Map()
  };

  for (let sequence = 0; sequence < 100; sequence += 1) {
    current.manifest.sequence = sequence;
    __test.saveManifest(current);
  }

  const files = fs.readdirSync(outDir);
  assert.deepEqual(files, ["capture_manifest.json"]);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(outDir, files[0]), "utf8")).sequence,
    99
  );
});

test("draining subscriptions waits for every audio pipeline before returning", async () => {
  let resolveFirst;
  let resolveSecond;
  const destroyed = [];
  const current = capture();
  current.subscriptions.set("one", {
    done: new Promise((resolve) => { resolveFirst = resolve; }),
    opusStream: { destroy() { destroyed.push("one"); } },
    timeout: null
  });
  current.subscriptions.set("two", {
    done: new Promise((resolve) => { resolveSecond = resolve; }),
    opusStream: { destroy() { destroyed.push("two"); } },
    timeout: null
  });

  let drained = false;
  const pending = __test.drainSubscriptions(current).then(() => { drained = true; });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(destroyed, ["one", "two"]);
  assert.equal(drained, false);
  resolveFirst();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  resolveSecond();
  await pending;
  assert.equal(drained, true);
});
