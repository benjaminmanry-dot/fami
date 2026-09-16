"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Transform } = require("node:stream");
const test = require("node:test");
const { PcmReceiveFanout, SharedVoiceSession } = require("../shared-voice-session.js");

class IdentityDecoder extends Transform {
  _transform(chunk, _encoding, callback) { callback(null, chunk); }
}

function fanoutFixture() {
  let upstream = null;
  const receiver = {
    subscribe() {
      upstream = new PassThrough();
      return upstream;
    }
  };
  const fanout = new PcmReceiveFanout({
    receiver,
    prism: { opus: { Decoder: IdentityDecoder } },
    EndBehaviorType: { AfterSilence: "silence" },
    silenceMs: 1500
  });
  return { fanout, upstream: () => upstream };
}

test("one upstream speaker stream is copied independently to scribe and DJ", async () => {
  const fixture = fanoutFixture();
  const scribe = fixture.fanout.subscribe("dm", "scribe:005:1");
  const dj = fixture.fanout.subscribe("dm", "bardsong:1");
  const scribeChunks = [];
  const djChunks = [];
  scribe.on("data", (chunk) => scribeChunks.push(Buffer.from(chunk)));
  dj.on("data", (chunk) => djChunks.push(Buffer.from(chunk)));

  fixture.upstream().end(Buffer.from([1, 2, 3, 4]));
  await Promise.all([
    new Promise((resolve) => scribe.once("end", resolve)),
    new Promise((resolve) => dj.once("end", resolve))
  ]);
  assert.deepEqual(Buffer.concat(scribeChunks), Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(Buffer.concat(djChunks), Buffer.from([1, 2, 3, 4]));
});

test("stopping the DJ branch cannot destroy the recorder branch", async () => {
  const fixture = fanoutFixture();
  const scribe = fixture.fanout.subscribe("dm", "scribe:005:1");
  const dj = fixture.fanout.subscribe("dm", "bardsong:1");
  const heard = [];
  scribe.on("data", (chunk) => heard.push(Buffer.from(chunk)));
  dj.destroy();
  fixture.upstream().write(Buffer.from([7, 8]));
  fixture.upstream().end(Buffer.from([9, 10]));
  await new Promise((resolve) => scribe.once("end", resolve));
  assert.deepEqual(Buffer.concat(heard), Buffer.from([7, 8, 9, 10]));
  assert.equal(fixture.upstream().destroyed, true);
});

test("a stalled consumer is bounded and detached while the other branch continues", async () => {
  const fixture = fanoutFixture();
  const stalled = fixture.fanout.subscribe("dm", "stalled-dj");
  const stalledErrors = [];
  stalled.on("error", (error) => stalledErrors.push(error.message));
  const recorder = fixture.fanout.subscribe("dm", "scribe:005:1");
  let recorderBytes = 0;
  recorder.on("data", (chunk) => { recorderBytes += chunk.length; });

  for (let index = 0; index < 100; index += 1) fixture.upstream().write(Buffer.alloc(3840, index));
  fixture.upstream().end();
  await new Promise((resolve) => recorder.once("end", resolve));
  assert.equal(recorderBytes, 384000);
  assert.equal(stalled.destroyed, true);
  assert.match(stalledErrors.join(" "), /fell behind/);
  assert.ok(stalled.readableLength + stalled.writableLength <= 3840 * 64);
});

test("voice ownership keeps one connection until both scribe and DJ release", async () => {
  const connection = new EventEmitter();
  connection.state = { status: "ready" };
  connection.receiver = { subscribe() { return new PassThrough(); } };
  connection.destroyCalls = 0;
  connection.destroy = () => {
    connection.destroyCalls += 1;
    connection.state.status = "destroyed";
  };
  let joins = 0;
  const voice = {
    VoiceConnectionStatus: { Ready: "ready", Destroyed: "destroyed", Disconnected: "disconnected", Signalling: "signalling", Connecting: "connecting" },
    EndBehaviorType: { AfterSilence: "silence" },
    entersState: async () => {},
    joinVoiceChannel: () => { throw new Error("unexpected default join"); }
  };
  const session = new SharedVoiceSession({
    voice,
    prism: { opus: { Decoder: IdentityDecoder } },
    target: { guildId: "guild", voiceChannelId: "voice" },
    join: () => { joins += 1; return connection; }
  });
  const guild = { id: "guild", voiceAdapterCreator: {} };
  const channel = { id: "voice" };

  assert.equal(await session.acquire("scribe", guild, channel), connection);
  assert.equal(await session.acquire("bardsong", guild, channel), connection);
  assert.equal(joins, 1);
  session.release("scribe");
  assert.equal(connection.destroyCalls, 0);
  assert.deepEqual(session.status().owners, ["bardsong"]);
  session.release("bardsong");
  assert.equal(connection.destroyCalls, 1);
});

test("release while a join is pending cannot leave an unattended connection", async () => {
  const connection = new EventEmitter();
  connection.state = { status: "connecting" };
  connection.receiver = { subscribe() { return new PassThrough(); } };
  connection.destroyCalls = 0;
  connection.destroy = () => {
    connection.destroyCalls += 1;
    connection.state.status = "destroyed";
  };
  let ready;
  const readyGate = new Promise((resolve) => { ready = resolve; });
  const voice = {
    VoiceConnectionStatus: { Ready: "ready", Destroyed: "destroyed", Disconnected: "disconnected" },
    EndBehaviorType: { AfterSilence: "silence" },
    entersState: async () => readyGate
  };
  const session = new SharedVoiceSession({
    voice,
    prism: { opus: { Decoder: IdentityDecoder } },
    target: { guildId: "guild", voiceChannelId: "room" },
    join: () => connection
  });
  const pending = session.acquire("bardsong", { id: "guild" }, { id: "room" });
  session.release("bardsong");
  ready();
  await assert.rejects(pending, /cancelled/);
  assert.equal(connection.destroyCalls, 1);
  assert.deepEqual(session.status().owners, []);
  assert.equal(session.status().connected, false);
});

test("a failed join clears ownership so a later retry can close normally", async () => {
  let attempt = 0;
  const connections = [];
  const voice = {
    VoiceConnectionStatus: { Ready: "ready", Destroyed: "destroyed" },
    EndBehaviorType: { AfterSilence: "silence" },
    entersState: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("synthetic join failure");
    }
  };
  const session = new SharedVoiceSession({
    voice,
    prism: { opus: { Decoder: IdentityDecoder } },
    target: { guildId: "guild", voiceChannelId: "room" },
    join: () => {
      const connection = new EventEmitter();
      connection.state = { status: "connecting" };
      connection.receiver = { subscribe() { return new PassThrough(); } };
      connection.destroyCalls = 0;
      connection.destroy = () => {
        connection.destroyCalls += 1;
        connection.state.status = "destroyed";
      };
      connections.push(connection);
      return connection;
    }
  });

  await assert.rejects(() => session.acquire("bardsong", { id: "guild" }, { id: "room" }), /synthetic join failure/);
  assert.deepEqual(session.status().owners, []);
  const connected = await session.acquire("bardsong", { id: "guild" }, { id: "room" });
  connected.state.status = "ready";
  session.release("bardsong");
  assert.equal(connections.length, 2);
  assert.equal(connections[0].destroyCalls, 1);
  assert.equal(connections[1].destroyCalls, 1);
  assert.deepEqual(session.status().owners, []);
});

test("a different guild or room fails before any join", async () => {
  let joins = 0;
  const session = new SharedVoiceSession({
    voice: {
      VoiceConnectionStatus: { Ready: "ready", Destroyed: "destroyed" },
      EndBehaviorType: { AfterSilence: "silence" },
      entersState: async () => {}
    },
    prism: { opus: { Decoder: IdentityDecoder } },
    target: { guildId: "guild", voiceChannelId: "voice" },
    join: () => { joins += 1; }
  });
  await assert.rejects(() => session.acquire("bardsong", { id: "other" }, { id: "voice" }), /restricted/);
  await assert.rejects(() => session.acquire("bardsong", { id: "guild" }, { id: "other" }), /restricted/);
  assert.equal(joins, 0);
});
