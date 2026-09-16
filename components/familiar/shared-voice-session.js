"use strict";

const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

function safeMessage(error) {
  return String(error?.message || error || "voice connection failed")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
}

class PcmReceiveFanout {
  constructor({ receiver, prism, EndBehaviorType, silenceMs = 1500, maxConsumerBufferBytes = 3840 * 64 }) {
    this.receiver = receiver;
    this.prism = prism;
    this.EndBehaviorType = EndBehaviorType;
    this.silenceMs = silenceMs;
    this.maxConsumerBufferBytes = maxConsumerBufferBytes;
    this.sources = new Map();
    this.destroyed = false;
  }

  subscribe(userId, consumerId) {
    if (this.destroyed) throw new Error("The shared voice receiver is unavailable.");
    if (!userId || !consumerId) throw new TypeError("A user and consumer are required.");

    let source = this.sources.get(userId);
    if (!source) source = this.#startSource(userId);
    if (source.consumers.has(consumerId)) {
      throw new Error("This voice consumer already has an active segment.");
    }

    const output = new PassThrough({ highWaterMark: 3840 * 8 });
    source.consumers.set(consumerId, output);
    const detach = () => {
      if (source.consumers.get(consumerId) !== output) return;
      source.consumers.delete(consumerId);
      if (!source.finished && source.consumers.size === 0) this.#finishSource(source);
    };
    output.once("close", detach);
    return output;
  }

  #startSource(userId) {
    const opusStream = this.receiver.subscribe(userId, {
      end: {
        behavior: this.EndBehaviorType.AfterSilence,
        duration: this.silenceMs
      }
    });
    const decoder = new this.prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48000
    });
    const source = { userId, opusStream, decoder, consumers: new Map(), finished: false };
    this.sources.set(userId, source);

    decoder.on("data", (chunk) => {
      for (const [consumerId, output] of [...source.consumers.entries()]) {
        if (output.destroyed) continue;
        const buffered = output.readableLength + output.writableLength;
        if (buffered + chunk.length > this.maxConsumerBufferBytes) {
          source.consumers.delete(consumerId);
          output.destroy(new Error("This voice consumer fell behind and was stopped before memory could grow."));
          continue;
        }
        output.write(Buffer.from(chunk));
      }
      if (!source.finished && source.consumers.size === 0) this.#finishSource(source);
    });
    const finish = (error = null) => this.#finishSource(source, error);
    decoder.once("end", () => finish());
    decoder.once("close", () => finish());
    decoder.once("error", finish);
    opusStream.once("error", finish);
    opusStream.pipe(decoder);
    return source;
  }

  #finishSource(source, error = null) {
    if (!source || source.finished) return;
    source.finished = true;
    if (this.sources.get(source.userId) === source) this.sources.delete(source.userId);
    for (const output of source.consumers.values()) {
      if (output.destroyed) continue;
      if (error) output.destroy(new Error(safeMessage(error)));
      else output.end();
    }
    source.consumers.clear();
    if (!source.opusStream.destroyed) source.opusStream.destroy();
    if (!source.decoder.destroyed) source.decoder.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const source of [...this.sources.values()]) this.#finishSource(source);
    this.sources.clear();
  }
}

class SharedVoiceSession extends EventEmitter {
  constructor({ voice, prism, target, silenceMs = 1500, join = null, readyTimeoutMs = 30_000 }) {
    super();
    if (!voice || !prism || !target) throw new TypeError("Voice, decoder, and target configuration are required.");
    this.voice = voice;
    this.prism = prism;
    this.target = target;
    this.silenceMs = silenceMs;
    this.readyTimeoutMs = readyTimeoutMs;
    this.join = join ?? ((guild, channel) => voice.joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    }));
    this.owners = new Set();
    this.connection = null;
    this.fanout = null;
    this.joining = null;
    this.recovering = null;
    this.lastError = null;
    this.generation = 0;
  }

  async acquire(owner, guild, channel) {
    if (!owner) throw new TypeError("A voice-session owner is required.");
    if (guild?.id !== this.target.guildId || channel?.id !== this.target.voiceChannelId) {
      throw new Error("Familiar voice use is restricted to the configured Sigil room.");
    }
    this.owners.add(owner);
    if (this.connection && this.connection.state?.status !== this.voice.VoiceConnectionStatus.Destroyed) {
      return this.connection;
    }
    if (this.joining) return this.joining;

    const generation = ++this.generation;
    this.joining = (async () => {
      let connection = null;
      try {
        connection = this.join(guild, channel);
        await this.voice.entersState(connection, this.voice.VoiceConnectionStatus.Ready, this.readyTimeoutMs);
        if (generation !== this.generation || this.owners.size === 0) {
          if (connection.state?.status !== this.voice.VoiceConnectionStatus.Destroyed) connection.destroy?.();
          throw new Error("The shared Discord voice connection was cancelled.");
        }
        this.connection = connection;
        this.fanout = new PcmReceiveFanout({
          receiver: connection.receiver,
          prism: this.prism,
          EndBehaviorType: this.voice.EndBehaviorType,
          silenceMs: this.silenceMs
        });
        this.lastError = null;
        connection.on?.("stateChange", (_oldState, newState) => {
          if (connection !== this.connection) return;
          if (newState.status === this.voice.VoiceConnectionStatus.Disconnected) {
            this.#recover(connection);
          }
        });
        this.emit("ready", { owners: new Set(this.owners), connection });
        return connection;
      } catch (error) {
        this.lastError = safeMessage(error);
        if (connection?.state?.status !== this.voice.VoiceConnectionStatus.Destroyed) connection?.destroy?.();
        if (this.connection === connection) this.connection = null;
        this.owners.clear();
        throw new Error(this.lastError);
      } finally {
        this.joining = null;
      }
    })();
    return this.joining;
  }

  async #recover(connection) {
    if (this.recovering || connection !== this.connection) return;
    this.recovering = (async () => {
      try {
        await Promise.any([
          this.voice.entersState(connection, this.voice.VoiceConnectionStatus.Signalling, 5_000),
          this.voice.entersState(connection, this.voice.VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch {
        if (connection !== this.connection) return;
        const owners = new Set(this.owners);
        this.#destroyConnection();
        this.lastError = "The shared Discord voice connection was lost.";
        this.emit("lost", { owners, error: this.lastError });
      } finally {
        this.recovering = null;
      }
    })();
    await this.recovering;
  }

  subscribePcm(userId, consumerId) {
    if (!this.connection || !this.fanout) throw new Error("Familiar is not connected to voice.");
    return this.fanout.subscribe(userId, consumerId);
  }

  release(owner) {
    this.owners.delete(owner);
    if (this.owners.size === 0) {
      this.generation += 1;
      this.#destroyConnection();
    }
  }

  #destroyConnection() {
    this.fanout?.destroy();
    this.fanout = null;
    const connection = this.connection;
    this.connection = null;
    if (connection?.state?.status !== this.voice.VoiceConnectionStatus.Destroyed) connection?.destroy?.();
  }

  destroy() {
    this.owners.clear();
    this.generation += 1;
    this.#destroyConnection();
  }

  status() {
    return {
      owners: [...this.owners].sort(),
      connected: Boolean(this.connection),
      connectionState: this.connection?.state?.status ?? "disconnected",
      lastError: this.lastError
    };
  }
}

module.exports = { PcmReceiveFanout, SharedVoiceSession };
