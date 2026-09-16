import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType
} from '@discordjs/voice';
import {
  DiscordPcmMixer,
  FRAME_BYTES,
  SOURCE_HIGH_WATER_FRAMES,
  stereo48kPcmToMono16kFloat
} from '../lib/pcm-mixer.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readPcmFrame(mixer) {
  let frame = mixer.read(FRAME_BYTES);
  if (frame) return frame;
  await once(mixer, 'readable');
  frame = mixer.read(FRAME_BYTES);
  assert.ok(frame, 'the mixer should satisfy a downstream frame request');
  return frame;
}

test('project audio decodes and crossfades through the Discord PCM mixer', { timeout: 20_000 }, async () => {
  const mixer = new DiscordPcmMixer({ musicVolume: 0.5, ambienceVolume: 0.25 });
  const musicTrack = { id: 'wandering', name: 'Wandering Vale' };
  const ambienceTrack = { id: 'forest', name: 'Forest ambience' };
  try {
    const outcomes = await mixer.setTracks({
      music: { track: musicTrack, filename: path.join(repoRoot, 'outputs', 'roll20-loops', 'wandering-vale-loop.ogg') },
      ambience: { track: ambienceTrack, filename: path.join(repoRoot, 'outputs', 'ambience', 'forest.ogg') },
      transitionSeconds: 0.08
    });
    assert.ok(outcomes.every((result) => result.status === 'fulfilled'));
    for (let index = 0; index < 8; index += 1) await readPcmFrame(mixer);
    assert.equal(mixer.status().music.name, 'Wandering Vale');
    assert.equal(mixer.status().ambience.name, 'Forest ambience');
    assert.ok(mixer.status().events.some((event) => event.type === 'mix-transition-complete'));
    mixer.setMuted(true);
    assert.equal(mixer.status().muted, true);
    mixer.stopAudio();
    assert.equal(mixer.status().music, null);
    assert.equal(mixer.status().ambience, null);
  } finally {
    mixer.destroy();
  }
});

test('a corrupt replacement is rejected without dropping the current Discord track', { timeout: 20_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bardsong-corrupt-'));
  t.after(async () => {
    if (path.resolve(root).startsWith(path.resolve(os.tmpdir()))) await fs.rm(root, { recursive: true, force: true });
  });
  const corrupt = path.join(root, 'corrupt.ogg');
  await fs.writeFile(corrupt, 'not audio');
  const mixer = new DiscordPcmMixer();
  try {
    await mixer.setTracks({
      music: { track: { id: 'wandering', name: 'Wandering Vale' }, filename: path.join(repoRoot, 'outputs', 'roll20-loops', 'wandering-vale-loop.ogg') },
      ambience: null,
      transitionSeconds: 0.05
    });
    for (let index = 0; index < 6; index += 1) await readPcmFrame(mixer);
    const outcomes = await mixer.setTracks({
      music: { track: { id: 'corrupt', name: 'Corrupt file' }, filename: corrupt },
      ambience: null,
      transitionSeconds: 0.05
    });
    assert.equal(outcomes[0].status, 'rejected');
    assert.equal(mixer.status().music.name, 'Wandering Vale');
    assert.ok(mixer.status().events.some((event) => event.type === 'decoder-error'));
  } finally {
    mixer.destroy();
  }
});

test('the real Discord player has continuous packets under its own 50 Hz clock', { timeout: 20_000 }, async () => {
  const mixer = new DiscordPcmMixer({ musicVolume: 0.58, ambienceVolume: 0.34 });
  const resource = createAudioResource(mixer, { inputType: StreamType.Raw });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  try {
    const outcomes = await mixer.setTracks({
      music: {
        track: { id: 'wandering', name: 'Wandering Vale' },
        filename: path.join(repoRoot, 'outputs', 'roll20-loops', 'wandering-vale-loop.ogg')
      },
      ambience: {
        track: { id: 'forest', name: 'Forest ambience' },
        filename: path.join(repoRoot, 'outputs', 'ambience', 'forest.ogg')
      },
      transitionSeconds: 0.08
    });
    assert.ok(outcomes.every((result) => result.status === 'fulfilled'));

    const originalRead = resource.read.bind(resource);
    let reads = 0;
    let missingPackets = 0;
    resource.read = () => {
      reads += 1;
      const packet = originalRead();
      if (!packet) missingPackets += 1;
      return packet;
    };
    let playerError = null;
    player.on('error', (error) => { playerError = error; });
    player.play(resource);
    await delay(10_500);

    const diagnostics = mixer.status().diagnostics;
    assert.ok(reads >= 480, `expected Discord's 50 Hz clock, received ${reads} reads`);
    assert.equal(missingPackets, 0, `Discord starved on ${missingPackets}/${reads} playback ticks`);
    assert.equal(playerError, null);
    assert.equal(diagnostics.music.current.underruns, 0);
    assert.equal(diagnostics.ambience.current.underruns, 0);
    assert.ok(diagnostics.music.current.bufferedFrames <= SOURCE_HIGH_WATER_FRAMES + 32);
    assert.ok(diagnostics.ambience.current.bufferedFrames <= SOURCE_HIGH_WATER_FRAMES + 32);
  } finally {
    player.stop(true);
    mixer.destroy();
  }
});

test('Discord receive PCM conversion downmixes stereo 48kHz to mono 16kHz', () => {
  const pcm = Buffer.alloc(4 * 6);
  for (let frame = 0; frame < 6; frame += 1) {
    pcm.writeInt16LE(16_384, frame * 4);
    pcm.writeInt16LE(16_384, frame * 4 + 2);
  }
  const output = stereo48kPcmToMono16kFloat(pcm);
  assert.equal(output.length, 2);
  assert.ok(Math.abs(output[0] - 0.5) < 0.01);
});
