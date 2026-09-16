const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  loadAutoRecordConfig,
  loadRuntimeTargets,
  findNextSessionId,
  createConsentStore,
  maySubscribe,
  createAutoRecordController,
  verifyManifestClosure,
  formatClosureSummary
} = require("../bot").__test;

function tempWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "familiar-auto-record-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".local"), { recursive: true });
  fs.mkdirSync(path.join(root, "campaigns", "sigil", "sessions"), { recursive: true });
  return root;
}

function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validConfig(root) {
  return {
    enabled: true,
    guildId: "100000000000000001",
    voiceChannelId: "100000000000000002",
    noticeTextChannelId: "100000000000000003",
    ownerMemberId: "100000000000000004",
    sessionRoot: "campaigns/sigil/sessions",
    consentLedger: ".local/sigil-consent.json",
    seedManifest: path.join(root, ".local", "prior-manifest.json"),
    ownerLeaveGraceMs: 5_000
  };
}

test("auto-record remains disabled unless one complete private target is configured", (t) => {
  const root = tempWorkspace(t);
  assert.equal(loadAutoRecordConfig(null, root), null);

  const partialPath = path.join(root, ".local", "partial.json");
  writeJson(partialPath, { enabled: true, guildId: "100000000000000001" });
  assert.throws(
    () => loadAutoRecordConfig(partialPath, root),
    /voiceChannelId/,
    "a partial target must fail closed"
  );

  const configPath = path.join(root, ".local", "auto-record.json");
  writeJson(path.join(root, ".local", "prior-manifest.json"), {
    sessionId: "004",
    status: "stopped",
    speakers: {}
  });
  writeJson(configPath, validConfig(root));
  const config = loadAutoRecordConfig(configPath, root);

  assert.equal(config.guildId, "100000000000000001");
  assert.equal(config.voiceChannelId, "100000000000000002");
  assert.equal(config.noticeTextChannelId, "100000000000000003");
  assert.equal(config.ownerMemberId, "100000000000000004");
  assert.equal(config.sessionRoot, path.join(root, "campaigns", "sigil", "sessions"));
  assert.equal(config.consentLedger, path.join(root, ".local", "sigil-consent.json"));
});

test("tonight's shared target loads while automatic recording stays deliberately unarmed", (t) => {
  const root = tempWorkspace(t);
  const targetPath = path.join(root, ".local", "sigil-target.json");
  writeJson(path.join(root, ".local", "prior-manifest.json"), {
    sessionId: "004",
    status: "stopped",
    speakers: {}
  });
  writeJson(targetPath, validConfig(root));
  const selected = loadRuntimeTargets({
    autoRecordFilename: targetPath,
    bardsongTargetFilename: targetPath,
    manualRecordingOnly: true,
    root
  });
  assert.equal(selected.autoRecordConfig, null);
  assert.equal(selected.runtimeTargetConfig.voiceChannelId, "100000000000000002");
});

test("the next unused numeric session follows the prior 004 manifest", (t) => {
  const root = tempWorkspace(t);
  const sessions = path.join(root, "campaigns", "sigil", "sessions");
  const seedManifest = path.join(root, ".local", "prior-manifest.json");
  writeJson(seedManifest, { sessionId: "004", status: "stopped", speakers: {} });

  assert.equal(findNextSessionId(sessions, seedManifest), "005");
  fs.mkdirSync(path.join(sessions, "005"));
  fs.mkdirSync(path.join(sessions, "not-a-session"));
  assert.equal(findNextSessionId(sessions, seedManifest), "006");
});

test("owner-reported consent seeds once and self-service revocation persists", (t) => {
  const root = tempWorkspace(t);
  const ledgerPath = path.join(root, ".local", "sigil-consent.json");
  const seedManifest = path.join(root, ".local", "prior-manifest.json");
  const known = "100000000000000005";
  const second = "100000000000000006";
  const newcomer = "100000000000000007";
  writeJson(seedManifest, {
    sessionId: "004",
    status: "stopped",
    speakers: {
      [known]: { displayName: "must not persist" },
      [second]: { username: "must not persist" }
    }
  });

  const store = createConsentStore(ledgerPath, seedManifest);
  assert.equal(store.has(known), true);
  assert.equal(store.has(second), true);
  assert.equal(store.has(newcomer), false);

  store.set(known, false);
  store.set(newcomer, true);
  const reloaded = createConsentStore(ledgerPath, seedManifest);
  assert.equal(reloaded.has(known), false, "restart must not reactivate a revocation");
  assert.equal(reloaded.has(second), true);
  assert.equal(reloaded.has(newcomer), true);

  const serialized = fs.readFileSync(ledgerPath, "utf8");
  assert.doesNotMatch(serialized, /displayName|username|must not persist/);
});

test("speaker subscription is impossible for bots, unknown members, and people without active consent", () => {
  const capture = {
    autoRecord: true,
    isUserConsented: (id) => id === "100000000000000005"
  };

  assert.equal(maySubscribe(capture, "100000000000000005", { user: { bot: false } }), true);
  assert.equal(maySubscribe(capture, "100000000000000007", { user: { bot: false } }), false);
  assert.equal(maySubscribe(capture, "100000000000000005", { user: { bot: true } }), false);
  assert.equal(maySubscribe(capture, "100000000000000005", null), false);
  assert.equal(maySubscribe({ autoRecord: false }, "100000000000000007", null), true);

  const source = fs.readFileSync(path.join(__dirname, "..", "bot.js"), "utf8");
  const capturePath = source.slice(
    source.indexOf("function startSpeakerChunk"),
    source.indexOf("async function startCapture")
  );
  assert.ok(capturePath.indexOf("maySubscribe") < capturePath.indexOf("receiver.subscribe"));
});

test("an armed pilot cannot fall through to the unrestricted manual start path", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "bot.js"), "utf8");
  assert.match(
    source,
    /if \(autoRecordConfig\) \{[\s\S]{0,700}autoRecordController\.reconcile\(\)[\s\S]{0,700}else \{\s*await startCapture/
  );
});

function member(id, bot = false) {
  return { id, user: { bot } };
}

function fakeController(overrides = {}) {
  const owner = "100000000000000004";
  const guest = "100000000000000005";
  const unknown = "100000000000000007";
  const state = {
    active: null,
    members: [member(owner), member(guest)],
    starts: [],
    stops: [],
    notices: [],
    timers: [],
    consent: new Map([[owner, true], [guest, true]])
  };
  const controller = createAutoRecordController({
    config: {
      guildId: "100000000000000001",
      voiceChannelId: "100000000000000002",
      noticeTextChannelId: "100000000000000003",
      ownerMemberId: owner,
      ownerLeaveGraceMs: 5_000
    },
    getRoomSnapshot: async () => ({ members: state.members }),
    getActiveCapture: () => state.active,
    isConsented: (id) => state.consent.get(id) === true,
    findNextSession: () => "005",
    startCapture: async (sessionId) => {
      state.starts.push(sessionId);
      state.active = { sessionId, autoRecord: true };
    },
    stopCapture: async (reason) => {
      state.stops.push(reason);
      state.active = null;
      if (reason === "consent") {
        state.notices.push("Recording stopped because a participant does not have active consent.");
      }
    },
    sendNotice: async (text) => state.notices.push(text),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      state.timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    ...overrides
  });
  return { controller, state, owner, guest, unknown };
}

function voiceState(memberValue, channelId) {
  return {
    guild: { id: "100000000000000001" },
    channelId,
    member: memberValue,
    id: memberValue.id
  };
}

test("owner entry starts 005 only after every present human is consented", async () => {
  const allowed = fakeController();
  await allowed.controller.handleVoiceStateUpdate(
    voiceState(member(allowed.owner), null),
    voiceState(member(allowed.owner), "100000000000000002")
  );
  assert.deepEqual(allowed.state.starts, ["005"]);
  assert.match(allowed.state.notices[0], /recording/i);

  const blocked = fakeController();
  blocked.state.members.push(member(blocked.unknown));
  await blocked.controller.handleVoiceStateUpdate(
    voiceState(member(blocked.owner), null),
    voiceState(member(blocked.owner), "100000000000000002")
  );
  assert.deepEqual(blocked.state.starts, []);
  assert.equal(blocked.state.notices.length, 1);
  assert.match(blocked.state.notices[0], /blocked/i);
  assert.doesNotMatch(blocked.state.notices[0], new RegExp(blocked.unknown));
});

test("an unconsented arrival stops the whole auto capture without exposing an ID", async () => {
  const { controller, state, unknown } = fakeController();
  state.active = { sessionId: "005", autoRecord: true };
  state.members.push(member(unknown));

  await controller.handleVoiceStateUpdate(
    voiceState(member(unknown), null),
    voiceState(member(unknown), "100000000000000002")
  );

  assert.deepEqual(state.stops, ["consent"]);
  assert.match(state.notices.at(-1), /consent/i);
  assert.doesNotMatch(state.notices.at(-1), new RegExp(unknown));
});

test("revocation stops a current subscription even if the member already left the room cache", async () => {
  const { controller, state, unknown } = fakeController();
  state.active = {
    sessionId: "005",
    autoRecord: true,
    subscriptions: new Map([[unknown, {}]])
  };

  await controller.handleConsentChange(unknown, false);

  assert.deepEqual(state.stops, ["consent"]);
});

test("a room-state failure stops an active capture and reports only a generic failure", async () => {
  const scenario = fakeController({
    getRoomSnapshot: async () => { throw new Error("private synthetic detail"); }
  });
  scenario.state.active = { sessionId: "005", autoRecord: true };

  await scenario.controller.reconcile();

  assert.deepEqual(scenario.state.stops, ["failure"]);
  assert.match(scenario.state.notices.at(-1), /failed closed/i);
  assert.doesNotMatch(scenario.state.notices.at(-1), /private synthetic detail/);
});

test("owner reconnect cancels grace; expiry and an empty room stop automatically", async () => {
  const reconnect = fakeController();
  reconnect.state.active = { sessionId: "005", autoRecord: true };
  reconnect.state.members = [member(reconnect.guest)];
  await reconnect.controller.handleVoiceStateUpdate(
    voiceState(member(reconnect.owner), "100000000000000002"),
    voiceState(member(reconnect.owner), null)
  );
  assert.equal(reconnect.state.timers.length, 1);
  assert.deepEqual(reconnect.state.stops, []);

  reconnect.state.members = [member(reconnect.owner), member(reconnect.guest)];
  await reconnect.controller.handleVoiceStateUpdate(
    voiceState(member(reconnect.owner), null),
    voiceState(member(reconnect.owner), "100000000000000002")
  );
  assert.equal(reconnect.state.timers[0].cleared, true);
  await reconnect.state.timers[0].callback();
  assert.deepEqual(reconnect.state.stops, []);

  reconnect.state.members = [member(reconnect.guest)];
  await reconnect.controller.handleVoiceStateUpdate(
    voiceState(member(reconnect.owner), "100000000000000002"),
    voiceState(member(reconnect.owner), null)
  );
  await reconnect.state.timers[1].callback();
  await reconnect.controller.whenIdle();
  assert.deepEqual(reconnect.state.stops, ["owner-left"]);

  const empty = fakeController();
  empty.state.active = { sessionId: "005", autoRecord: true };
  empty.state.members = [];
  await empty.controller.handleVoiceStateUpdate(
    voiceState(member(empty.guest), "100000000000000002"),
    voiceState(member(empty.guest), null)
  );
  assert.deepEqual(empty.state.stops, ["empty-room"]);
});

test("manifest closure passes only for stopped, drained, present WAV evidence with no temp debris", (t) => {
  const root = tempWorkspace(t);
  const outDir = path.join(root, "campaigns", "sigil", "sessions", "005", "audio", "discord");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "closed.wav"), Buffer.alloc(44));
  writeJson(path.join(outDir, "capture_manifest.json"), {
    sessionId: "005",
    status: "stopped",
    speakers: {},
    chunks: [{ filename: "closed.wav", status: "finished" }]
  });

  const pass = verifyManifestClosure(outDir);
  assert.equal(pass.passed, true);
  assert.equal(pass.chunkErrors, 0);
  assert.deepEqual(pass.issues, []);
  assert.equal(
    formatClosureSummary("005", "owner-left", pass),
    "Session 005 stopped because the owner left through the grace period. Closure PASS. Speakers: 0. Chunks: 1. Chunk errors: 0."
  );

  fs.writeFileSync(path.join(outDir, "capture_manifest.json.1.1.tmp"), "debris", "utf8");
  writeJson(path.join(outDir, "capture_manifest.json"), {
    sessionId: "005",
    status: "stopping",
    speakers: {},
    chunks: [
      { filename: "missing.wav", status: "recording" },
      { filename: "closed.wav", status: "error", error: "synthetic" }
    ]
  });
  const fail = verifyManifestClosure(outDir);
  assert.equal(fail.passed, false);
  assert.equal(fail.chunkErrors, 1);
  assert.ok(fail.issues.some((issue) => issue.includes("status")));
  assert.ok(fail.issues.some((issue) => issue.includes("unfinished")));
  assert.ok(fail.issues.some((issue) => issue.includes("missing WAV")));
  assert.ok(fail.issues.some((issue) => issue.includes("temporary")));
});
