import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { findDrift } from "../scripts/sync-copies.mjs";

// The serializer and bridge protocol are classic browser scripts (no ESM syntax),
// so tests evaluate them in a sandbox that provides a CommonJS-style `module`.
function loadBrowserScript(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const sandbox = { module: { exports: {} }, console, setTimeout, clearTimeout };
  vm.runInNewContext(source, sandbox, { filename: relativePath });
  return sandbox.module.exports;
}

const serializer = loadBrowserScript("../public/lilith/roll-serializer.js");
const protocol = loadBrowserScript("../extension/bridge-protocol.js");

// ---------------------------------------------------------------------------
// Roll serialization
// ---------------------------------------------------------------------------

test("serializes a valid normal roll", () => {
  const result = serializer.buildCard({
    name: "Lilith",
    title: "Strength Check",
    whisper: false,
    fields: [
      ["Roll", { roll: "1d20+4" }],
      ["Mode", { text: "normal" }],
    ],
  });
  assert.equal(result.ok, true);
  assert.ok(result.command.startsWith("&{template:default} {{name=🌸 Lilith • Strength Check}}"));
  assert.match(result.command, /\{\{Roll=\[\[1d20\+4\]\]\}\}/);
  assert.match(result.command, /\{\{Mode=normal\}\}/);
});

test("serializes advantage and disadvantage d20 expressions", () => {
  assert.equal(serializer.d20Expression(4, "normal"), "1d20+4");
  assert.equal(serializer.d20Expression(4, "advantage"), "2d20kh1+4");
  assert.equal(serializer.d20Expression(-1, "disadvantage"), "2d20kl1-1");
});

test("serializes whisper rolls with the GM prefix", () => {
  const result = serializer.buildCard({
    name: "Lilith",
    title: "Sneaky",
    whisper: true,
    fields: [["Roll", { roll: "1d20" }]],
  });
  assert.equal(result.ok, true);
  assert.ok(result.command.startsWith("/w gm &{template:default}"));
});

test("neutralizes dangerous label characters", () => {
  const result = serializer.buildCard({
    name: "Lilith}} {{hp=[[666]]",
    title: "Bonk}} {{Attack=[[1d20+99]]",
    whisper: false,
    fields: [["No}}te", { text: "@{target|hp} ?{prompt}" }]],
  });
  assert.equal(result.ok, true);
  // Every {{ in the output belongs to a legitimate field; braces from inputs are gone.
  const fieldOpens = result.command.match(/\{\{/g) || [];
  assert.equal(fieldOpens.length, 2); // name field + one data field
  assert.doesNotMatch(result.command, /\{\{hp=/);
  assert.doesNotMatch(result.command, /\{\{Attack=/);
  assert.doesNotMatch(result.command, /@\{/);
  assert.doesNotMatch(result.command, /\?\{/);
});

test("strips newline and inline-roll injection from labels", () => {
  const result = serializer.buildCard({
    name: "Lilith",
    title: "Test",
    whisper: false,
    fields: [["Note", { text: "hello\n/w gm secret [[1d1000]]" }]],
  });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.command, /[\r\n]/);
  assert.doesNotMatch(result.command, /\[\[1d1000\]\]/);
});

test("accepts the dice grammar the sheet actually uses", () => {
  for (const expr of ["1d20+4", "2d20kh1+8", "2d20kl1-1", "2d6+6+2", "1d12+3", "4", "2d6"]) {
    assert.equal(serializer.validateRollExpression(expr).ok, true, expr);
  }
});

test("rejects malformed roll expressions with a clear error", () => {
  for (const expr of [
    "banana",
    "1d20+;DROP",
    "]]}} {{x=[[1d20",
    "1d20+1e9",
    "@{target|hp}",
    "1d20\n1d20",
    "",
    "d",
    "1d20+".repeat(30),
  ]) {
    const result = serializer.validateRollExpression(expr);
    assert.equal(result.ok, false, JSON.stringify(expr));
    assert.ok(result.error, "error message present");
  }
});

test("buildCard refuses a card containing an invalid expression", () => {
  const result = serializer.buildCard({
    name: "Lilith",
    title: "Broken",
    whisper: false,
    fields: [["Damage", { roll: "2d6+]]}}garbage" }]],
  });
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// Bridge request validation and origins
// ---------------------------------------------------------------------------

function validRequest() {
  return {
    type: "LILITH_ROLL",
    requestId: "lilith-1234567890-abcdef",
    command: "&{template:default} {{name=🌸 Lilith • Test}} {{Roll=[[1d20]]}}",
  };
}

test("accepts a well-formed roll request", () => {
  assert.equal(protocol.validateRollRequest(validRequest()).ok, true);
  const whispered = validRequest();
  whispered.command = `/w gm ${whispered.command}`;
  assert.equal(protocol.validateRollRequest(whispered).ok, true);
});

test("rejects malformed roll requests", () => {
  const cases = [
    null,
    {},
    { ...validRequest(), type: "OTHER" },
    { ...validRequest(), command: 42 },
    { ...validRequest(), command: "/roll 1d20" },
    { ...validRequest(), command: "/w gm /roll 1d20" },
    { ...validRequest(), command: `&{template:default} {{a=b}}\n/w gm leak` },
    { ...validRequest(), command: "&{template:default} " + "x".repeat(4000) },
    { ...validRequest(), requestId: "" },
    { ...validRequest(), requestId: 7 },
  ];
  for (const message of cases) {
    const result = protocol.validateRollRequest(message);
    assert.equal(result.ok, false, JSON.stringify(message)?.slice(0, 80));
    assert.equal(result.status, "invalid-request");
  }
});

test("allows only the exact development bridge origins", () => {
  assert.equal(protocol.isAllowedBridgeOrigin("http://127.0.0.1:4173"), true);
  assert.equal(protocol.isAllowedBridgeOrigin("http://localhost:4173"), true);
  for (const origin of [
    "http://localhost:8080",
    "https://evil.example",
    "http://localhost.evil.com:4173",
    "file://",
    "null",
    undefined,
  ]) {
    assert.equal(protocol.isAllowedBridgeOrigin(origin), false, String(origin));
  }
});

test("recognizes only Roll20 game tabs as send targets", () => {
  assert.equal(protocol.isRoll20GameUrl("https://app.roll20.net/editor/"), true);
  assert.equal(protocol.isRoll20GameUrl("https://app.roll20.net/campaigns/play/123"), true);
  for (const url of [
    "https://app.roll20.net/compendium/dnd5e",
    "https://app.roll20.net/campaigns/details/123",
    "https://marketplace.roll20.net/",
    "https://roll20.net/",
    "http://app.roll20.net/editor/",
    undefined,
  ]) {
    assert.equal(protocol.isRoll20GameUrl(url), false, String(url));
  }
});

// ---------------------------------------------------------------------------
// Roll delivery (background routing logic, dependency-injected)
// ---------------------------------------------------------------------------

function makeDeps(overrides = {}) {
  let remembered = null;
  return {
    getRememberedTabId: async () => remembered,
    setRememberedTabId: async (id) => {
      remembered = id;
    },
    getTab: async () => {
      throw new Error("no such tab");
    },
    queryGameTabs: async () => [],
    ping: async () => true,
    post: async () => ({ ok: true, status: "sent" }),
    pingTimeoutMs: 50,
    ...overrides,
  };
}

test("reports no-roll20-tab when no game tab exists", async () => {
  const result = await protocol.deliverRoll(makeDeps(), validRequest());
  assert.equal(result.ok, false);
  assert.equal(result.status, "no-roll20-tab");
});

test("falls back to a queried game tab when the remembered tab is gone", async () => {
  let rememberedAfter = null;
  const deps = makeDeps({
    getRememberedTabId: async () => 42,
    setRememberedTabId: async (id) => {
      rememberedAfter = id;
    },
    getTab: async () => {
      throw new Error("tab 42 was closed");
    },
    queryGameTabs: async () => [
      { id: 7, url: "https://app.roll20.net/editor/", title: "Game Night", lastAccessed: 5 },
    ],
  });
  const result = await protocol.deliverRoll(deps, validRequest());
  assert.equal(result.ok, true);
  assert.equal(result.status, "sent");
  assert.equal(result.target.title, "Game Night");
  assert.equal(rememberedAfter, 7);
});

test("never sends to a remembered tab that left the game", async () => {
  const posts = [];
  const deps = makeDeps({
    getRememberedTabId: async () => 42,
    getTab: async () => ({ id: 42, url: "https://app.roll20.net/compendium/dnd5e", title: "Compendium" }),
    post: async (tabId, request) => {
      posts.push(tabId);
      return { ok: true, status: "sent" };
    },
  });
  const result = await protocol.deliverRoll(deps, validRequest());
  assert.equal(result.ok, false);
  assert.equal(result.status, "no-roll20-tab");
  assert.deepEqual(posts, []);
});

test("reports target-not-ready when no content script answers the ping", async () => {
  const deps = makeDeps({
    queryGameTabs: async () => [{ id: 7, url: "https://app.roll20.net/editor/", title: "Game" }],
    ping: async () => {
      throw new Error("Could not establish connection");
    },
  });
  const result = await protocol.deliverRoll(deps, validRequest());
  assert.equal(result.ok, false);
  assert.equal(result.status, "target-not-ready");
});

test("passes through the content script's failure status", async () => {
  const deps = makeDeps({
    queryGameTabs: async () => [{ id: 7, url: "https://app.roll20.net/editor/", title: "Game" }],
    post: async () => ({ ok: false, status: "chat-input-not-found", error: "no chat" }),
  });
  const result = await protocol.deliverRoll(deps, validRequest());
  assert.equal(result.ok, false);
  assert.equal(result.status, "chat-input-not-found");
});

test("reports submission-failed when posting throws after a good ping", async () => {
  const deps = makeDeps({
    queryGameTabs: async () => [{ id: 7, url: "https://app.roll20.net/editor/", title: "Game" }],
    post: async () => {
      throw new Error("message port closed");
    },
  });
  const result = await protocol.deliverRoll(deps, validRequest());
  assert.equal(result.ok, false);
  assert.equal(result.status, "submission-failed");
});

test("rejects an invalid request before touching any tab", async () => {
  let touched = false;
  const deps = makeDeps({
    queryGameTabs: async () => {
      touched = true;
      return [];
    },
  });
  const result = await protocol.deliverRoll(deps, { type: "LILITH_ROLL", command: "/roll 1d20", requestId: "lilith-x-123456" });
  assert.equal(result.ok, false);
  assert.equal(result.status, "invalid-request");
  assert.equal(touched, false);
});

test("deduplicates repeated request ids", () => {
  const deduper = protocol.createRequestDeduper(3);
  assert.equal(deduper.seen("a"), false);
  assert.equal(deduper.seen("a"), true);
  assert.equal(deduper.seen("b"), false);
  assert.equal(deduper.seen("c"), false);
  assert.equal(deduper.seen("d"), false); // evicts "a"
  assert.equal(deduper.seen("a"), false);
  assert.equal(deduper.seen("d"), true);
});

// ---------------------------------------------------------------------------
// Canonical-copy drift detection
// ---------------------------------------------------------------------------

test("drift check is quiet for identical copies and loud for drifted ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lilith-drift-"));
  await mkdir(join(dir, "copy"), { recursive: true });
  await writeFile(join(dir, "canonical.txt"), "sparkle");
  await writeFile(join(dir, "copy", "same.txt"), "sparkle");
  await writeFile(join(dir, "copy", "changed.txt"), "tarnish");

  const clean = await findDrift([{ source: join(dir, "canonical.txt"), target: join(dir, "copy", "same.txt") }]);
  assert.deepEqual(clean, []);

  const drifted = await findDrift([
    { source: join(dir, "canonical.txt"), target: join(dir, "copy", "changed.txt") },
    { source: join(dir, "canonical.txt"), target: join(dir, "copy", "missing.txt") },
  ]);
  assert.equal(drifted.length, 2);
  assert.equal(drifted[0].reason, "different");
  assert.equal(drifted[1].reason, "missing");
});
