import { chooseTrack } from './library.js';
import { DiscordPcmMixer, stereo48kPcmToMono16kFloat } from './pcm-mixer.js';
import { transcribeFloat32 } from './asr.js';
import { reconnectDelay, shouldCaptureSpeaker } from './discord-manager.js';

const OWNER = 'bardsong';
const DEFAULT_SEGMENT_SECONDS = 20;

function safeError(error) {
  return String(error?.message ?? error ?? 'Unknown error').replace(/[\r\n]+/g, ' ').slice(0, 300);
}

function maskId(value) {
  return value ? `••••${String(value).slice(-4)}` : null;
}

export async function consumePcmSegments({
  stream,
  segmentBytes,
  transcribe,
  onText,
  isActive = () => true,
  maxPendingBytes = segmentBytes * 3
}) {
  let chunks = [];
  let total = 0;
  let processing = Promise.resolve();
  let queuedBytes = 0;
  let processingError = null;
  let settled = false;
  const queuedSegments = new Set();

  const fail = (error) => {
    if (processingError) return;
    processingError = error instanceof Error ? error : new Error(safeError(error));
    if (!stream.destroyed) stream.destroy(processingError);
  };

  const flush = () => {
    if (!total) return;
    const segment = { chunks, total };
    chunks = [];
    total = 0;
    if (processingError || !isActive()) {
      for (const chunk of segment.chunks) chunk.fill(0);
      return;
    }
    if (queuedBytes + segment.total > maxPendingBytes) {
      for (const chunk of segment.chunks) chunk.fill(0);
      fail(new Error('Local speech processing fell behind and this DJ listening branch was stopped.'));
      return;
    }
    queuedBytes += segment.total;
    queuedSegments.add(segment);
    const work = processing.then(async () => {
      if (!isActive() || processingError) return;
      const pcm = Buffer.concat(segment.chunks, segment.total);
      for (const chunk of segment.chunks) chunk.fill(0);
      const samples = stereo48kPcmToMono16kFloat(pcm);
      pcm.fill(0);
      try {
        const text = await transcribe(samples);
        if (text && isActive() && !processingError) await onText(text);
      } finally {
        samples.fill(0);
      }
    }).finally(() => {
      for (const chunk of segment.chunks) chunk.fill(0);
      queuedSegments.delete(segment);
      queuedBytes -= segment.total;
    });
    processing = work.catch((error) => {
      fail(error);
    });
  };

  const zeroQueued = () => {
    for (const segment of queuedSegments) {
      for (const chunk of segment.chunks) chunk.fill(0);
    }
  };

  const streamDone = new Promise((resolve, reject) => {
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    stream.on('data', (chunk) => {
      if (!isActive() || processingError) return;
      chunks.push(Buffer.from(chunk));
      total += chunk.length;
      if (total >= segmentBytes) flush();
    });
    stream.once('end', () => finish());
    stream.once('close', () => finish());
    stream.once('error', (error) => finish(error));
  });

  let streamError = null;
  try {
    try {
      await streamDone;
    } catch (error) {
      streamError = error;
    }
    if (isActive() && !processingError) flush();
    else {
      for (const chunk of chunks) chunk.fill(0);
      chunks = [];
      total = 0;
      zeroQueued();
    }
    await processing;
    if (processingError) throw processingError;
    if (streamError) throw streamError;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    chunks = [];
    zeroQueued();
  }
}

export class FamiliarDiscordManager {
  constructor({
    appRoot,
    store,
    director,
    client,
    voice,
    voiceSession,
    target,
    getScribeStatus = () => ({ active: false }),
    onDirectorResult = null,
    mixerFactory = null,
    transcribe = transcribeFloat32,
    segmentSeconds = DEFAULT_SEGMENT_SECONDS
  }) {
    this.appRoot = appRoot;
    this.store = store;
    this.director = director;
    this.client = client;
    this.voice = voice;
    this.voiceSession = voiceSession;
    this.target = target;
    this.getScribeStatus = getScribeStatus;
    this.onDirectorResult = onDirectorResult;
    this.mixerFactory = mixerFactory ?? ((levels) => new DiscordPcmMixer(levels));
    this.transcribe = transcribe;
    this.segmentBytes = Math.max(48_000 * 2 * 2, Math.round(48_000 * 2 * 2 * segmentSeconds));
    this.state = 'disconnected';
    this.desiredConnected = false;
    this.listenEnabled = false;
    this.muted = false;
    this.connection = null;
    this.player = null;
    this.mixer = null;
    this.lastError = null;
    this.lastHeardAt = null;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.activeReceive = null;
    this.listenGeneration = 0;
    this.connectionGeneration = 0;
    this.connectPromise = null;
    this.receiverBinding = null;
    this.voiceSession.on('lost', ({ owners }) => {
      if (!owners.has(OWNER)) return;
      this.connection = null;
      this.connectionGeneration += 1;
      this.#detachReceiver();
      this.player?.stop(true);
      this.player = null;
      this.mixer?.destroy();
      this.mixer = null;
      if (this.desiredConnected) this.#scheduleReconnect('The shared Familiar voice connection was lost.');
    });
  }

  async publicStatus() {
    const mix = this.mixer?.status() ?? null;
    const channel = this.client.channels?.cache?.get?.(this.target.voiceChannelId) ?? null;
    const humanOccupancy = channel?.members
      ? [...channel.members.values()].filter((member) => member?.user?.bot !== true).length
      : null;
    const scribe = this.getScribeStatus() ?? { active: false };
    return {
      state: this.state,
      configured: true,
      tokenReady: true,
      idsReady: true,
      runtimeMode: 'shared-familiar',
      targetName: channel?.name ?? this.target.voiceChannelName ?? 'configured Sigil room',
      guildId: maskId(this.target.guildId),
      voiceChannelId: maskId(this.target.voiceChannelId),
      dmUserId: maskId(this.target.dmUserId),
      humanOccupancy,
      scribeActive: Boolean(scribe.active),
      scribeSessionId: scribe.active ? scribe.sessionId ?? null : null,
      listeningToDm: this.listenEnabled,
      muted: this.muted,
      currentMusic: mix?.music?.name ?? null,
      currentAmbience: mix?.ambience?.name ?? null,
      audioDiagnostics: mix?.diagnostics ?? null,
      playbackState: this.player?.state?.status ?? 'idle',
      connectionState: this.connection?.state?.status ?? this.voiceSession.status().connectionState,
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

  async #connectInternal({ retry = false } = {}) {
    if (this.state === 'connected' && this.connection) return this.publicStatus();
    this.desiredConnected = true;
    this.state = this.reconnectAttempt ? 'reconnecting' : 'connecting';
    this.lastError = null;
    const generation = ++this.connectionGeneration;
    let acquired = false;
    const requireCurrent = () => {
      if (!this.desiredConnected || generation !== this.connectionGeneration) {
        throw new Error('The Bardsong voice connection was cancelled.');
      }
    };
    try {
      const guild = await this.client.guilds.fetch(this.target.guildId);
      requireCurrent();
      const channel = await guild.channels.fetch(this.target.voiceChannelId);
      requireCurrent();
      if (!channel?.isVoiceBased?.() || channel.guildId !== guild.id) {
        throw new Error('The saved Sigil target is not an available voice channel.');
      }
      this.connection = await this.voiceSession.acquire(OWNER, guild, channel);
      acquired = true;
      requireCurrent();
      this.#startOutput();
      requireCurrent();
      this.#attachReceiver();
      this.state = 'connected';
      this.reconnectAttempt = 0;
      if (this.director.active) await this.cueScene(this.director.currentScene);
      else this.stopAudio();
      return this.publicStatus();
    } catch (error) {
      this.#detachReceiver();
      this.player?.stop(true);
      this.player = null;
      this.mixer?.destroy();
      this.mixer = null;
      if (acquired) this.voiceSession.release(OWNER);
      this.connection = null;
      const message = safeError(error);
      if (generation === this.connectionGeneration && this.desiredConnected) {
        this.lastError = message;
        this.state = 'error';
        if (!retry) this.desiredConnected = false;
      }
      throw new Error(message);
    }
  }

  #startOutput() {
    this.player?.stop(true);
    this.mixer?.destroy();
    const settings = this.store.getSettings();
    this.mixer = this.mixerFactory({
      musicVolume: settings.musicVolume,
      ambienceVolume: settings.ambienceVolume
    });
    this.mixer.setMuted(this.muted);
    this.player = this.voice.createAudioPlayer({
      behaviors: { noSubscriber: this.voice.NoSubscriberBehavior.Play }
    });
    const resource = this.voice.createAudioResource(this.mixer, { inputType: this.voice.StreamType.Raw });
    this.player.play(resource);
    this.connection.subscribe(this.player);
    this.player.on('error', (error) => {
      this.lastError = `Discord audio player: ${safeError(error)}`;
    });
  }

  #attachReceiver() {
    this.#detachReceiver();
    const speaking = this.connection.receiver.speaking;
    const handler = (userId) => {
      if (!shouldCaptureSpeaker({
        enabled: this.listenEnabled,
        configuredDmId: this.target.dmUserId,
        userId,
        active: Boolean(this.activeReceive)
      })) return;
      this.#receiveDmSpeech(userId).catch((error) => {
        if (this.listenEnabled) this.lastError = `Local DM transcription: ${safeError(error)}`;
      });
    };
    speaking.on('start', handler);
    this.receiverBinding = { speaking, handler };
  }

  #detachReceiver() {
    if (!this.receiverBinding) return;
    this.receiverBinding.speaking.off?.('start', this.receiverBinding.handler);
    this.receiverBinding = null;
  }

  async #receiveDmSpeech(userId) {
    const generation = this.listenGeneration;
    const stream = this.voiceSession.subscribePcm(userId, `bardsong:${generation}:${Date.now()}`);
    const receive = { stream, generation };
    this.activeReceive = receive;
    const isActive = () => this.listenEnabled
      && this.activeReceive === receive
      && this.listenGeneration === generation;
    try {
      await consumePcmSegments({
        stream,
        segmentBytes: this.segmentBytes,
        transcribe: this.transcribe,
        isActive,
        onText: async (text) => {
          if (!isActive()) return;
          this.lastHeardAt = new Date().toISOString();
          const result = this.director.ingest(text);
          if (result.changed) await this.cueScene(result.state.currentScene);
          await this.onDirectorResult?.(result);
        }
      });
    } finally {
      if (!stream.destroyed) stream.destroy();
      if (this.activeReceive === receive) this.activeReceive = null;
    }
  }

  setListening(enabled) {
    if (enabled && this.state !== 'connected') throw new Error('Connect Familiar audio before listening to the configured DM.');
    this.listenEnabled = Boolean(enabled);
    this.listenGeneration += 1;
    if (!this.listenEnabled && this.activeReceive) {
      const receive = this.activeReceive;
      this.activeReceive = null;
      receive.stream.destroy();
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
    if (failures.length) this.lastError = failures.map((failure) => safeError(failure.reason)).join(' · ');
    return outcomes;
  }

  updateLevels() {
    this.mixer?.setLevels(this.store.getSettings());
  }

  setMuted(value) {
    this.muted = Boolean(value);
    this.mixer?.setMuted(this.muted);
    return this.muted;
  }

  stopAudio() {
    this.mixer?.stopAudio();
  }

  #scheduleReconnect(reason) {
    if (!this.desiredConnected || this.reconnectTimer) return;
    this.state = 'reconnecting';
    this.lastError = reason;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.desiredConnected) return;
      try {
        await this.#connectInternal({ retry: true });
      } catch (error) {
        if (!this.desiredConnected) return;
        this.#scheduleReconnect(safeError(error));
      }
    }, reconnectDelay(this.reconnectAttempt));
  }

  async disconnect() {
    this.desiredConnected = false;
    this.connectionGeneration += 1;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.setListening(false);
    this.state = 'disconnecting';
    this.#detachReceiver();
    this.player?.stop(true);
    this.player = null;
    this.mixer?.destroy();
    this.mixer = null;
    this.connection = null;
    this.voiceSession.release(OWNER);
    this.state = 'disconnected';
    this.reconnectAttempt = 0;
    this.lastError = null;
    return this.publicStatus();
  }
}
