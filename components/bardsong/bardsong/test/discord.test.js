import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { awaitVoiceRecovery, readDiscordConfiguration, reconnectDelay, shouldCaptureSpeaker } from '../lib/discord-manager.js';
import { DiscordPcmMixer } from '../lib/pcm-mixer.js';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  createAudioPlayer,
  createAudioResource,
  entersState
} from '@discordjs/voice';

test('Discord reconnect backoff is bounded', () => {
  assert.equal(reconnectDelay(1), 1_000);
  assert.equal(reconnectDelay(2), 2_000);
  assert.equal(reconnectDelay(6), 30_000);
  assert.equal(reconnectDelay(99), 30_000);
});

test('Discord connection recovery accepts either signalling or connecting', async () => {
  const voice = {
    VoiceConnectionStatus: { Signalling: 'signalling', Connecting: 'connecting' },
    entersState: (_connection, status) => status === 'connecting' ? Promise.resolve() : Promise.reject(new Error('not signalling'))
  };
  assert.equal(await awaitVoiceRecovery(voice, {}, 5), true);
});

test('Discord connection recovery fails only after both recovery states fail', async () => {
  const voice = {
    VoiceConnectionStatus: { Signalling: 'signalling', Connecting: 'connecting' },
    entersState: () => Promise.reject(new Error('offline'))
  };
  assert.equal(await awaitVoiceRecovery(voice, {}, 5), false);
});

test('Discord receive subscribes only to the explicitly configured DM', () => {
  assert.equal(shouldCaptureSpeaker({ enabled: true, configuredDmId: '123', userId: '123', active: false }), true);
  assert.equal(shouldCaptureSpeaker({ enabled: true, configuredDmId: '123', userId: '999', active: false }), false);
  assert.equal(shouldCaptureSpeaker({ enabled: false, configuredDmId: '123', userId: '123', active: false }), false);
  assert.equal(shouldCaptureSpeaker({ enabled: true, configuredDmId: '123', userId: '123', active: true }), false);
});

test('Discord voice stack accepts the live raw mixer resource', { timeout: 5_000 }, async () => {
  const mixer = new DiscordPcmMixer();
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  const errors = [];
  player.on('error', (error) => errors.push(error));
  player.play(createAudioResource(mixer, { inputType: StreamType.Raw }));
  try {
    await entersState(player, AudioPlayerStatus.Playing, 2_000);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(errors, []);
  } finally {
    player.stop(true);
    mixer.destroy();
  }
});

test('Windows-written Discord configuration is parsed without exposing the token', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bardsong-discord-config-'));
  t.after(async () => {
    delete process.env.BARDSONG_DISCORD_TOKEN;
    if (path.resolve(root).startsWith(path.resolve(os.tmpdir()))) await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'discord.json'), `\uFEFF${JSON.stringify({
    guildId: '100000000000000008',
    voiceChannelId: '100000000000000009',
    dmUserId: '100000000000000010'
  })}`);
  process.env.BARDSONG_DISCORD_TOKEN = 'synthetic-test-token';
  const config = await readDiscordConfiguration(root);
  assert.equal(config.configured, true);
  assert.equal(Object.hasOwn(config, 'token'), false);
});
