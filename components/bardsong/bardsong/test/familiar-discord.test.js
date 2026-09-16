import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { FamiliarDiscordManager, consumePcmSegments } from '../lib/familiar-discord-manager.js';

function pcmFrame(sample, frames = 960) {
  const buffer = Buffer.alloc(frames * 2 * 2);
  for (let offset = 0; offset < buffer.length; offset += 2) buffer.writeInt16LE(sample, offset);
  return buffer;
}

test('continuous DM speech is split into bounded inference segments without waiting for silence', async () => {
  const stream = new PassThrough();
  const seen = [];
  let transcriptions = 0;
  const running = consumePcmSegments({
    stream,
    segmentBytes: pcmFrame(1).length * 2,
    transcribe: async (samples) => {
      transcriptions += 1;
      assert.ok(samples.length > 0);
      return `segment ${transcriptions}`;
    },
    onText: async (text) => seen.push(text)
  });

  stream.write(pcmFrame(100));
  stream.write(pcmFrame(200));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transcriptions, 1, 'the first full segment is processed while the speaker remains active');
  stream.end(pcmFrame(300));
  await running;
  assert.equal(transcriptions, 2);
  assert.deepEqual(seen, ['segment 1', 'segment 2']);
});

test('stopping while local ASR is active discards its eventual cue', async () => {
  const stream = new PassThrough();
  let active = true;
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const seen = [];
  const running = consumePcmSegments({
    stream,
    segmentBytes: pcmFrame(1).length,
    isActive: () => active,
    transcribe: async () => {
      await blocker;
      return 'roll initiative';
    },
    onText: async (text) => seen.push(text)
  });

  stream.write(pcmFrame(100));
  await new Promise((resolve) => setImmediate(resolve));
  active = false;
  stream.end();
  release();
  await running;
  assert.deepEqual(seen, []);
});

test('an ASR failure is handled immediately and rejects only the DJ branch', async () => {
  const stream = new PassThrough();
  const running = consumePcmSegments({
    stream,
    segmentBytes: pcmFrame(1).length,
    transcribe: async () => { throw new Error('synthetic ASR failure'); },
    onText: async () => { throw new Error('unexpected cue'); }
  });
  stream.write(pcmFrame(100));
  await assert.rejects(running, /synthetic ASR failure/);
  assert.equal(stream.destroyed, true);
});

test('queued local speech is bounded when transcription falls behind', async () => {
  const stream = new PassThrough();
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const running = consumePcmSegments({
    stream,
    segmentBytes: pcmFrame(1).length,
    maxPendingBytes: pcmFrame(1).length * 2,
    transcribe: async () => { await blocker; return 'slow'; },
    onText: async () => {}
  });
  stream.write(pcmFrame(1));
  stream.write(pcmFrame(2));
  stream.write(pcmFrame(3));
  const rejected = assert.rejects(running, /fell behind/);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await rejected;
});

test('disconnect during target lookup cannot later acquire or start voice', async () => {
  let releaseGuild;
  const guildGate = new Promise((resolve) => { releaseGuild = resolve; });
  let acquires = 0;
  const voiceSession = new EventEmitter();
  voiceSession.acquire = async () => { acquires += 1; return {}; };
  voiceSession.release = () => {};
  voiceSession.status = () => ({ connectionState: 'disconnected' });
  const manager = new FamiliarDiscordManager({
    appRoot: '.',
    store: { getSettings: () => ({ musicVolume: 0.5, ambienceVolume: 0.5 }) },
    director: { active: true, currentScene: 'travel' },
    client: {
      guilds: { fetch: async () => guildGate },
      channels: { cache: new Map() }
    },
    voice: {},
    voiceSession,
    target: { guildId: 'guild', voiceChannelId: 'room', dmUserId: 'dm' }
  });
  const pending = manager.connect();
  await manager.disconnect();
  releaseGuild({ id: 'guild', channels: { fetch: async () => ({ id: 'room', guildId: 'guild', isVoiceBased: () => true }) } });
  await assert.rejects(pending, /cancelled/);
  assert.equal(acquires, 0);
  assert.equal((await manager.publicStatus()).state, 'disconnected');
});
