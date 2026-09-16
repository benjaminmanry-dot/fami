import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = SAMPLE_RATE * CHANNELS * FRAME_MS / 1_000;
export const FRAME_BYTES = FRAME_SAMPLES * 2;
export const SOURCE_READY_FRAMES = 50;
export const SOURCE_LOW_WATER_FRAMES = 150;
export const SOURCE_HIGH_WATER_FRAMES = 300;

class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(chunk) {
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  take(length) {
    if (this.length < length) return null;
    const output = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const chunk = this.chunks[0];
      const needed = length - offset;
      if (chunk.length <= needed) {
        chunk.copy(output, offset);
        offset += chunk.length;
        this.chunks.shift();
      } else {
        chunk.copy(output, offset, 0, needed);
        this.chunks[0] = chunk.subarray(needed);
        offset += needed;
      }
    }
    this.length -= length;
    return output;
  }

  clear() {
    this.chunks = [];
    this.length = 0;
  }
}

export class FfmpegPcmSource extends EventEmitter {
  constructor({ filename, track, executable = ffmpegPath }) {
    super();
    this.filename = filename;
    this.track = track;
    this.executable = executable;
    this.queue = new ByteQueue();
    this.process = null;
    this.stopped = false;
    this.stderr = '';
    this.underruns = 0;
    this.stdoutPaused = false;
  }

  start() {
    if (this.process) return;
    if (!this.executable) throw new Error('The project-local FFmpeg decoder is unavailable');
    this.process = spawn(this.executable, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-stream_loop', '-1', '-i', this.filename,
      '-vn', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1'
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.process.stdout.on('data', (chunk) => {
      this.queue.push(chunk);
      if (this.queue.length >= FRAME_BYTES * SOURCE_READY_FRAMES) this.emit('ready');
      if (!this.stdoutPaused && this.queue.length >= FRAME_BYTES * SOURCE_HIGH_WATER_FRAMES) {
        this.process?.stdout.pause();
        this.stdoutPaused = true;
      }
    });
    this.process.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-2_000);
    });
    this.process.once('error', (error) => this.emit('failure', error));
    this.process.once('exit', (code) => {
      if (!this.stopped) {
        const detail = this.stderr.trim() || `decoder exited with code ${code}`;
        this.emit('failure', new Error(detail));
      }
    });
  }

  async waitUntilReady(timeoutMs = 10_000) {
    this.start();
    if (this.queue.length >= FRAME_BYTES * SOURCE_READY_FRAMES) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(reject, new Error(`${this.track.name} did not decode in time`)), timeoutMs);
      const ready = () => finish(resolve);
      const failure = (error) => finish(reject, error);
      const finish = (callback, value) => {
        clearTimeout(timer);
        this.off('ready', ready);
        this.off('failure', failure);
        callback(value);
      };
      this.once('ready', ready);
      this.once('failure', failure);
    });
  }

  takeFrame() {
    const frame = this.queue.take(FRAME_BYTES);
    if (this.stdoutPaused && this.queue.length <= FRAME_BYTES * SOURCE_LOW_WATER_FRAMES) {
      this.stdoutPaused = false;
      this.process?.stdout.resume();
    }
    if (frame) return frame;
    this.underruns += 1;
    if (this.underruns === 1 || this.underruns % 50 === 0) {
      this.emit('underrun', { count: this.underruns });
    }
    return Buffer.alloc(FRAME_BYTES);
  }

  diagnostics() {
    return {
      bufferedFrames: Math.floor(this.queue.length / FRAME_BYTES),
      underruns: this.underruns,
      paused: this.stdoutPaused
    };
  }

  stop() {
    this.stopped = true;
    this.queue.clear();
    this.stdoutPaused = false;
    if (this.process && !this.process.killed) this.process.kill();
    this.process = null;
  }
}

class MixerLayer {
  constructor(kind, onEvent, sourceFactory) {
    this.kind = kind;
    this.onEvent = onEvent;
    this.sourceFactory = sourceFactory;
    this.current = null;
    this.next = null;
    this.fadeFrame = 0;
    this.fadeFrames = 1;
    this.transitioning = false;
    this.token = 0;
  }

  async switchTo(target, seconds) {
    const token = ++this.token;
    if (this.current?.track.id === target?.track.id && !this.transitioning) return false;
    let source = null;
    if (target) {
      source = this.sourceFactory(target);
      source.on('failure', (error) => this.onEvent({ type: 'decoder-error', layer: this.kind, track: target.track, message: error.message }));
      source.on('underrun', ({ count }) => this.onEvent({ type: 'source-underrun', layer: this.kind, track: target.track, count }));
      try {
        await source.waitUntilReady();
      } catch (error) {
        source.stop();
        this.onEvent({ type: 'decoder-error', layer: this.kind, track: target.track, message: error.message });
        throw new Error(`${target.track.name} could not be decoded for Discord`);
      }
      if (token !== this.token) {
        source.stop();
        return false;
      }
    }

    this.next?.stop();
    this.next = source;
    this.fadeFrame = 0;
    this.fadeFrames = Math.max(1, Math.round((Number(seconds) || 0.05) * 1_000 / FRAME_MS));
    this.transitioning = true;
    this.onEvent({
      type: 'mix-transition-start',
      layer: this.kind,
      from: this.current?.track ?? null,
      to: source?.track ?? null,
      seconds: this.fadeFrames * FRAME_MS / 1_000
    });
    return true;
  }

  frame() {
    if (!this.transitioning) return this.current?.takeFrame() ?? Buffer.alloc(FRAME_BYTES);
    const oldFrame = this.current?.takeFrame() ?? Buffer.alloc(FRAME_BYTES);
    const newFrame = this.next?.takeFrame() ?? Buffer.alloc(FRAME_BYTES);
    const progress = Math.min(1, this.fadeFrame / this.fadeFrames);
    const output = mixTwo(oldFrame, newFrame, 1 - progress, progress);
    this.fadeFrame += 1;
    if (this.fadeFrame > this.fadeFrames) {
      const previous = this.current;
      this.current = this.next;
      this.next = null;
      this.transitioning = false;
      previous?.stop();
      this.onEvent({
        type: 'mix-transition-complete',
        layer: this.kind,
        from: previous?.track ?? null,
        to: this.current?.track ?? null
      });
    }
    return output;
  }

  stop() {
    ++this.token;
    this.current?.stop();
    this.next?.stop();
    this.current = null;
    this.next = null;
    this.transitioning = false;
  }

  currentTrack() {
    return (this.transitioning ? this.next : this.current)?.track ?? null;
  }

  diagnostics() {
    return {
      current: this.current?.diagnostics?.() ?? null,
      next: this.next?.diagnostics?.() ?? null
    };
  }
}

function mixTwo(left, right, leftGain, rightGain) {
  const output = Buffer.allocUnsafe(FRAME_BYTES);
  for (let offset = 0; offset < FRAME_BYTES; offset += 2) {
    const value = left.readInt16LE(offset) * leftGain + right.readInt16LE(offset) * rightGain;
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), offset);
  }
  return output;
}

function mixLayers(music, ambience, musicGain, ambienceGain, muted) {
  if (muted) return Buffer.alloc(FRAME_BYTES);
  const output = Buffer.allocUnsafe(FRAME_BYTES);
  for (let offset = 0; offset < FRAME_BYTES; offset += 2) {
    const value = music.readInt16LE(offset) * musicGain + ambience.readInt16LE(offset) * ambienceGain;
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), offset);
  }
  return output;
}

export class DiscordPcmMixer extends Readable {
  constructor(options = {}) {
    super({ highWaterMark: FRAME_BYTES * 20 });
    this.musicVolume = options.musicVolume ?? 0.58;
    this.ambienceVolume = options.ambienceVolume ?? 0.34;
    this.muted = false;
    this.eventLog = [];
    const sourceFactory = options.sourceFactory ?? ((target) => new FfmpegPcmSource(target));
    const onEvent = (event) => {
      this.eventLog.push({ ...event, at: new Date().toISOString() });
      if (this.eventLog.length > 100) this.eventLog.shift();
      this.emit('mixerEvent', event);
    };
    this.music = new MixerLayer('music', onEvent, sourceFactory);
    this.ambience = new MixerLayer('ambience', onEvent, sourceFactory);
  }

  _read(size) {
    const frames = Math.max(1, Math.ceil(Math.min(size || FRAME_BYTES, this.readableHighWaterMark) / FRAME_BYTES));
    for (let index = 0; index < frames; index += 1) {
      const frame = mixLayers(
        this.music.frame(),
        this.ambience.frame(),
        this.musicVolume,
        this.ambienceVolume,
        this.muted
      );
      if (!this.push(frame)) break;
    }
  }

  setLevels({ musicVolume, ambienceVolume }) {
    if (Number.isFinite(musicVolume)) this.musicVolume = Math.max(0, Math.min(1, musicVolume));
    if (Number.isFinite(ambienceVolume)) this.ambienceVolume = Math.max(0, Math.min(1, ambienceVolume));
  }

  setMuted(value) {
    this.muted = Boolean(value);
    this.emit('mixerEvent', { type: this.muted ? 'muted' : 'unmuted' });
  }

  async setTracks({ music, ambience, transitionSeconds }) {
    return Promise.allSettled([
      this.music.switchTo(music, transitionSeconds),
      this.ambience.switchTo(ambience, transitionSeconds)
    ]);
  }

  stopAudio() {
    this.music.stop();
    this.ambience.stop();
  }

  status() {
    return {
      muted: this.muted,
      music: this.music.currentTrack(),
      ambience: this.ambience.currentTrack(),
      diagnostics: {
        music: this.music.diagnostics(),
        ambience: this.ambience.diagnostics()
      },
      events: this.eventLog.slice(-12)
    };
  }

  _destroy(error, callback) {
    this.stopAudio();
    callback(error);
  }
}

export function stereo48kPcmToMono16kFloat(buffer) {
  const sourceFrames = Math.floor(buffer.length / 4);
  const outputFrames = Math.floor(sourceFrames / 3);
  const output = new Float32Array(outputFrames);
  for (let i = 0; i < outputFrames; i += 1) {
    let sum = 0;
    for (let step = 0; step < 3; step += 1) {
      const frame = i * 3 + step;
      const offset = frame * 4;
      sum += buffer.readInt16LE(offset) + buffer.readInt16LE(offset + 2);
    }
    output[i] = sum / (6 * 32768);
  }
  return output;
}
