import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chooseTrack } from './library.js';
import { DiscordPcmMixer, stereo48kPcmToMono16kFloat } from './pcm-mixer.js';
import { transcribeFloat32 } from './asr.js';

const SNOWFLAKE = /^\d{17,20}$/;

export async function readDiscordConfiguration(appRoot) {
  const filename = path.join(appRoot, 'data', 'discord.json');
  let values = {};
  try {
    values = JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const config = {
    guildId: String(values.guildId ?? '').trim(),
    voiceChannelId: String(values.voiceChannelId ?? '').trim(),
    dmUserId: String(values.dmUserId ?? '').trim()
  };
  const idsReady = Object.values(config).every((value) => SNOWFLAKE.test(value));
  const tokenReady = Boolean(process.env.BARDSONG_DISCORD_TOKEN);
  return {
    ...config,
    idsReady,
    tokenReady,
    configured: idsReady && tokenReady
  };
}

function maskId(value) {
  return value ? `••••${value.slice(-4)}` : null;
}

export class DiscordManager {
  constructor({ appRoot, store, director, onDirectorResult = null, mixerFactory = null }) {
    this.appRoot = appRoot;
    this.store = store;
    this.director = director;
    this.onDirectorResult = onDirectorResult;
    this.mixerFactory = mixerFactory ?? ((levels) => new DiscordPcmMixer(levels));
    this.state = 'disconnected';
    this.desiredConnected = false;
    this.listenEnabled = false;
    this.muted = false;
    this.client = null;
    this.connection = null;
    this.player = null;
    this.mixer = null;
    this.config = null;
    this.voice = null;
    this.lastError = null;
    this.lastHeardAt = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.joinGeneration = 0;
    this.activeReceive = null;
    this.connectPromise = null;
  }

  async publicStatus() {
    const config = this.config ?? await readDiscordConfiguration(this.appRoot);
    const mix = this.mixer?.status() ?? null;
    return {
      state: this.state,
      configured: config.configured,
      tokenReady: config.tokenReady,
      idsReady: config.idsReady,
      guildId: maskId(config.guildId),
      voiceChannelId: maskId(config.voiceChannelId),
      dmUserId: maskId(config.dmUserId),
      listeningToDm: this.listenEnabled,
      muted: this.muted,
      currentMusic: mix?.music?.name ?? null,
      currentAmbience: mix?.ambience?.name ?? null,
      audioDiagnostics: mix?.diagnostics ?? null,
      lastError: this.lastError,
      lastHeardAt: this.lastHeardAt,
      reconnectAttempt: this.reconnectAttempt
    };
  }

  async connect() {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.#connectInternal();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async #connectInternal() {
    if (this.state === 'connected') return this.publicStatus();
    this.config = await readDiscordConfiguration(this.appRoot);
    if (!this.config.configured) {
      throw new Error('Discord is not configured. Run Configure Discord.cmd, then restart Bardsong.');
    }
    this.desiredConnected = true;
    this.state = 'connecting';
    this.lastError = null;

    try {
      const discord = await import('discord.js');
      this.voice = await import('@discordjs/voice');
      this.client = new discord.Client({
        intents: [discord.GatewayIntentBits.Guilds, discord.GatewayIntentBits.GuildVoiceStates]
      });
      const readyPromise = this.client.isReady() ? Promise.resolve() : once(this.client, discord.Events.ClientReady);
      await this.client.login(process.env.BARDSONG_DISCORD_TOKEN);
      if (!this.client.isReady()) await Promise.race([readyPromise, timeoutReject(20_000, 'Discord login timed out')]);
      await this.#joinVoice();
      return this.publicStatus();
    } catch (error) {
      this.lastError = safeError(error);
      this.state = 'error';
      this.desiredConnected = false;
      await this.#teardown({ destroyClient: true });
      throw new Error(this.lastError);
    }
  }

  async #joinVoice() {
    const generation = ++this.joinGeneration;
    const guild = await this.client.guilds.fetch(this.config.guildId);
    const channel = await this.client.channels.fetch(this.config.voiceChannelId);
    if (!channel?.isVoiceBased() || channel.guildId !== guild.id) {
      throw new Error('Configured Discord channel is not a voice channel in the configured server');
    }

    const connection = this.voice.joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });
    try {
      await this.voice.entersState(connection, this.voice.VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      if (connection.state?.status !== this.voice.VoiceConnectionStatus.Destroyed) connection.destroy();
      throw error;
    }
    if (generation !== this.joinGeneration || !this.desiredConnected) {
      connection.destroy();
      return;
    }

    if (this.connection && this.connection.state?.status !== this.voice.VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.connection = connection;
    this.#attachConnectionEvents(connection, generation);
    this.#startOutput();
    this.#attachDmReceiver();
    this.state = 'connected';
    this.reconnectAttempt = 0;
    this.lastError = null;
    if (this.director.active) await this.cueScene(this.director.currentScene);
    else this.stopAudio();
  }

  #startOutput() {
    this.mixer?.destroy();
    const settings = this.store.getSettings();
    this.mixer = this.mixerFactory({
      musicVolume: settings.musicVolume,
      ambienceVolume: settings.ambienceVolume
    });
    this.mixer.setMuted(this.muted);
    this.player = this.voice.createAudioPlayer({
      behaviors: { noSubscriber: this.voice.NoSubscriberBehavior.Pause }
    });
    const resource = this.voice.createAudioResource(this.mixer, { inputType: this.voice.StreamType.Raw });
    this.player.play(resource);
    this.connection.subscribe(this.player);
    this.player.on('error', (error) => {
      this.lastError = `Discord audio player: ${safeError(error)}`;
    });
  }

  #attachConnectionEvents(connection, generation) {
    connection.on('stateChange', async (_oldState, newState) => {
      if (generation !== this.joinGeneration || !this.desiredConnected) return;
      if (newState.status === this.voice.VoiceConnectionStatus.Ready) {
        this.state = 'connected';
        this.reconnectAttempt = 0;
        return;
      }
      if (newState.status !== this.voice.VoiceConnectionStatus.Disconnected) return;
      this.state = 'reconnecting';
      const recovered = await awaitVoiceRecovery(this.voice, connection);
      if (!recovered) {
        connection.destroy();
        this.#scheduleReconnect('Discord voice disconnected');
      }
    });
  }

  #scheduleReconnect(reason) {
    if (!this.desiredConnected || this.reconnectTimer) return;
    this.state = 'reconnecting';
    this.lastError = reason;
    this.reconnectAttempt += 1;
    const delay = reconnectDelay(this.reconnectAttempt);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.desiredConnected) return;
      try {
        await this.#joinVoice();
      } catch (error) {
        this.lastError = safeError(error);
        this.#scheduleReconnect(this.lastError);
      }
    }, delay);
  }

  #attachDmReceiver() {
    const speaking = this.connection.receiver.speaking;
    speaking.on('start', (userId) => {
      if (!shouldCaptureSpeaker({ enabled: this.listenEnabled, configuredDmId: this.config.dmUserId, userId, active: Boolean(this.activeReceive) })) return;
      this.#receiveDmSpeech(userId).catch((error) => {
        this.lastError = `Local DM transcription: ${safeError(error)}`;
      });
    });
  }

  async #receiveDmSpeech(userId) {
    const prismModule = await import('prism-media');
    const prism = prismModule.default ?? prismModule;
    const opusStream = this.connection.receiver.subscribe(userId, {
      end: { behavior: this.voice.EndBehaviorType.AfterSilence, duration: 1_200 }
    });
    const decoder = new prism.opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
    const chunks = [];
    let total = 0;
    const limit = 48_000 * 2 * 2 * 60;
    this.activeReceive = { opusStream, decoder };
    try {
      opusStream.pipe(decoder);
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          callback(value);
        };
        decoder.on('data', (chunk) => {
          if (total + chunk.length > limit) {
            opusStream.destroy();
            return;
          }
          chunks.push(Buffer.from(chunk));
          total += chunk.length;
        });
        decoder.once('end', () => finish(resolve));
        decoder.once('close', () => finish(resolve));
        decoder.once('error', (error) => finish(reject, error));
        opusStream.once('error', (error) => finish(reject, error));
      });
      if (!this.listenEnabled || !total) return;
      const pcm = Buffer.concat(chunks, total);
      for (const chunk of chunks) chunk.fill(0);
      const samples = stereo48kPcmToMono16kFloat(pcm);
      pcm.fill(0);
      chunks.length = 0;
      let text;
      try {
        text = await transcribeFloat32(samples);
      } finally {
        samples.fill(0);
      }
      if (!text || !this.listenEnabled) return;
      this.lastHeardAt = new Date().toISOString();
      const result = this.director.ingest(text);
      if (result.changed) await this.cueScene(result.state.currentScene);
      await this.onDirectorResult?.(result);
    } finally {
      chunks.length = 0;
      opusStream.destroy();
      decoder.destroy();
      this.activeReceive = null;
    }
  }

  setListening(enabled) {
    if (enabled && this.state !== 'connected') throw new Error('Connect Discord before listening to the configured DM');
    this.listenEnabled = Boolean(enabled);
    if (!this.listenEnabled && this.activeReceive) {
      this.activeReceive.opusStream.destroy();
      this.activeReceive.decoder.destroy();
      this.activeReceive = null;
    }
    return this.listenEnabled;
  }

  async cueScene(scene) {
    if (!this.mixer || this.state !== 'connected') return [];
    const settings = this.store.getSettings();
    const buildTarget = (kind) => {
      const track = chooseTrack(settings, scene, kind);
      return track ? { track, filename: this.store.resolveTrackPath(track) } : null;
    };
    const outcomes = await this.mixer.setTracks({
      music: buildTarget('music'),
      ambience: buildTarget('ambience'),
      transitionSeconds: settings.transitionSeconds
    });
    const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
    if (failures.length) {
      this.lastError = failures.map((failure) => safeError(failure.reason)).join(' · ');
    }
    return outcomes;
  }

  updateLevels() {
    const settings = this.store.getSettings();
    this.mixer?.setLevels(settings);
  }

  setMuted(value) {
    this.muted = Boolean(value);
    this.mixer?.setMuted(this.muted);
    return this.muted;
  }

  stopAudio() {
    this.mixer?.stopAudio();
  }

  async disconnect() {
    this.desiredConnected = false;
    this.listenEnabled = false;
    this.state = 'disconnecting';
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    ++this.joinGeneration;
    await this.#teardown({ destroyClient: true });
    this.state = 'disconnected';
    this.reconnectAttempt = 0;
    this.lastError = null;
    return this.publicStatus();
  }

  async #teardown({ destroyClient }) {
    if (this.activeReceive) {
      this.activeReceive.opusStream.destroy();
      this.activeReceive.decoder.destroy();
      this.activeReceive = null;
    }
    this.player?.stop(true);
    this.player = null;
    this.mixer?.destroy();
    this.mixer = null;
    if (this.connection && this.connection.state?.status !== this.voice?.VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.connection = null;
    if (destroyClient) this.client?.destroy();
    if (destroyClient) this.client = null;
  }
}

function safeError(error) {
  return String(error?.message ?? error ?? 'Unknown error').replace(/[\r\n]+/g, ' ').slice(0, 300);
}

function timeoutReject(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

export function reconnectDelay(attempt) {
  return Math.min(30_000, 1_000 * (2 ** Math.min(5, Math.max(0, attempt - 1))));
}

export async function awaitVoiceRecovery(voice, connection, timeoutMs = 5_000) {
  try {
    await Promise.any([
      voice.entersState(connection, voice.VoiceConnectionStatus.Signalling, timeoutMs),
      voice.entersState(connection, voice.VoiceConnectionStatus.Connecting, timeoutMs)
    ]);
    return true;
  } catch {
    return false;
  }
}

export function shouldCaptureSpeaker({ enabled, configuredDmId, userId, active }) {
  return Boolean(enabled && !active && configuredDmId && userId === configuredDmId);
}
