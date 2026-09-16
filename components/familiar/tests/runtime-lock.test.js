"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { __test } = require("../bot.js");

test("the runtime lock refuses a second live Familiar process and releases cleanly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "familiar-runtime-lock-"));
  let first = null;
  let replacement = null;
  try {
    const alive = (pid) => pid === 101;
    first = __test.acquireRuntimeLock(root, { pid: 101, isAlive: alive });
    assert.throws(
      () => __test.acquireRuntimeLock(root, { pid: 202, isAlive: alive }),
      /already running/
    );
    __test.releaseRuntimeLock(first);
    first = null;
    replacement = __test.acquireRuntimeLock(root, { pid: 202, isAlive: alive });
    assert.equal(JSON.parse(fs.readFileSync(replacement.filename, "utf8")).pid, 202);
  } finally {
    __test.releaseRuntimeLock(first);
    __test.releaseRuntimeLock(replacement);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a stale runtime lock is replaced without widening the lock target", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "familiar-stale-lock-"));
  const localDir = path.join(root, ".local");
  fs.mkdirSync(localDir);
  const filename = path.join(localDir, "familiar-runtime.lock");
  fs.writeFileSync(filename, `${JSON.stringify({ pid: 303 })}\n`, "utf8");
  let lock = null;
  try {
    lock = __test.acquireRuntimeLock(root, { pid: 404, isAlive: () => false });
    assert.equal(lock.filename, filename);
    assert.equal(JSON.parse(fs.readFileSync(filename, "utf8")).pid, 404);
  } finally {
    __test.releaseRuntimeLock(lock);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
