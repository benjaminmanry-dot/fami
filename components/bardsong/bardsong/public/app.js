const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  alert: $('#alert'),
  listenerStatus: $('#listener-status'),
  discordStatus: $('#discord-status'),
  discordMiniStatus: $('#discord-mini-status'),
  discordTarget: $('#discord-target'),
  connectDiscord: $('#connect-discord'),
  disconnectDiscord: $('#disconnect-discord'),
  toggleDmListener: $('#toggle-dm-listener'),
  shutdownRuntime: $('#shutdown-runtime'),
  currentScene: $('#current-scene'),
  directorMode: $('#director-mode'),
  directorReason: $('#director-reason'),
  currentMusic: $('#current-music'),
  currentAmbience: $('#current-ambience'),
  startDj: $('#start-dj'),
  muteNow: $('#mute-now'),
  stopDj: $('#stop-dj'),
  hold: $('#hold-button'),
  resume: $('#resume-button'),
  sceneGrid: $('#scene-grid'),
  startListening: $('#start-listening'),
  stopListening: $('#stop-listening'),
  asrNotReady: $('#asr-not-ready'),
  cueForm: $('#cue-form'),
  cueInput: $('#cue-input'),
  cueHistory: $('#cue-history'),
  speechFixture: $('#speech-fixture'),
  musicVolume: $('#music-volume'),
  musicOutput: $('#music-output'),
  ambienceVolume: $('#ambience-volume'),
  ambienceOutput: $('#ambience-output'),
  transitionTime: $('#transition-time'),
  transitionOutput: $('#transition-output'),
  allowUnreviewed: $('#allow-unreviewed'),
  audioState: $('#audio-state'),
  confidenceMeter: $('#confidence-meter'),
  decisionCopy: $('#decision-copy'),
  activityLog: $('#activity-log'),
  libraryList: $('#library-list'),
  trackImport: $('#track-import'),
  restoreSettings: $('#restore-settings')
};

const app = {
  scenes: [],
  settings: null,
  director: null,
  asr: null,
  discord: null,
  started: false,
  muted: false,
  activeFilter: 'all',
  cueHistory: [],
  eventLog: [],
  preview: null
};

let sessionToken = '';

async function api(url, options = {}) {
  const method = String(options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers ?? {});
  if (!['GET', 'HEAD'].includes(method)) headers.set('X-Bardsong-Token', sessionToken);
  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error ?? data ?? `Request failed (${response.status})`);
  return data;
}

function jsonOptions(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function showAlert(message, kind = 'error') {
  ui.alert.textContent = message;
  ui.alert.className = `alert ${kind === 'good' ? 'good' : ''}`;
  clearTimeout(showAlert.timer);
  showAlert.timer = setTimeout(() => ui.alert.classList.add('hidden'), 7_000);
}

function recordEvent(message, type = 'info') {
  const event = { at: new Date(), message, type };
  app.eventLog.push(event);
  if (app.eventLog.length > 60) app.eventLog.shift();
  renderActivity();
}

function renderActivity() {
  const recent = app.eventLog.slice(-12).reverse();
  ui.activityLog.replaceChildren(...recent.map((event) => {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = event.at.toISOString();
    time.textContent = event.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const text = document.createElement('span');
    text.textContent = event.message;
    li.dataset.type = event.type;
    li.append(time, text);
    return li;
  }));
}

class CrossfadeLayer {
  constructor(context, kind, onEvent) {
    this.context = context;
    this.kind = kind;
    this.onEvent = onEvent;
    this.master = context.createGain();
    this.master.gain.value = 1;
    this.master.connect(context.destination);
    this.decks = [0, 1].map(() => {
      const audio = new Audio();
      audio.loop = true;
      audio.preload = 'auto';
      const source = context.createMediaElementSource(audio);
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.master);
      return { audio, gain, track: null };
    });
    this.activeIndex = 0;
    this.pendingToken = 0;
  }

  setVolume(value, muted = false) {
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(muted ? 0 : value, now, 0.025);
  }

  async switchTo(track, seconds) {
    const token = ++this.pendingToken;
    const active = this.decks[this.activeIndex];
    if (active.track?.id === track?.id) return { changed: false, track: active.track };
    if (!track) {
      await this.fadeOut(seconds);
      return { changed: true, track: null };
    }

    const nextIndex = this.activeIndex === 0 ? 1 : 0;
    const next = this.decks[nextIndex];
    next.audio.pause();
    next.audio.removeAttribute('src');
    next.audio.load();
    next.track = track;
    next.audio.src = `/api/tracks/${encodeURIComponent(track.id)}/audio`;

    try {
      await waitForAudio(next.audio, 12_000);
      if (token !== this.pendingToken) return { changed: false, cancelled: true };
      await next.audio.play();
    } catch (error) {
      if (token !== this.pendingToken) return { changed: false, cancelled: true };
      next.audio.pause();
      next.audio.removeAttribute('src');
      next.track = null;
      this.onEvent({ type: 'audio-error', layer: this.kind, track, message: error.message });
      throw new Error(`${track.name} could not be decoded or played`);
    }

    const duration = Math.max(0.05, Number(seconds) || 0.05);
    const now = this.context.currentTime;
    next.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setValueAtTime(0, now);
    next.gain.gain.linearRampToValueAtTime(1, now + duration);
    active.gain.gain.cancelScheduledValues(now);
    active.gain.gain.setValueAtTime(active.gain.gain.value, now);
    active.gain.gain.linearRampToValueAtTime(0, now + duration);

    const previous = active.track;
    this.activeIndex = nextIndex;
    this.onEvent({ type: 'crossfade-start', layer: this.kind, from: previous, to: track, seconds: duration });
    setTimeout(() => {
      if (token !== this.pendingToken || this.activeIndex !== nextIndex) return;
      active.audio.pause();
      active.audio.removeAttribute('src');
      active.audio.load();
      active.track = null;
      this.onEvent({ type: 'crossfade-complete', layer: this.kind, from: previous, to: track });
    }, duration * 1000 + 80);
    return { changed: true, track };
  }

  async fadeOut(seconds) {
    const token = ++this.pendingToken;
    const active = this.decks[this.activeIndex];
    if (!active.track) return;
    const previous = active.track;
    const duration = Math.max(0.05, Number(seconds) || 0.05);
    const now = this.context.currentTime;
    active.gain.gain.cancelScheduledValues(now);
    active.gain.gain.setValueAtTime(active.gain.gain.value, now);
    active.gain.gain.linearRampToValueAtTime(0, now + duration);
    this.onEvent({ type: 'crossfade-start', layer: this.kind, from: previous, to: null, seconds: duration });
    setTimeout(() => {
      if (token !== this.pendingToken) return;
      active.audio.pause();
      active.audio.removeAttribute('src');
      active.audio.load();
      active.track = null;
      this.onEvent({ type: 'crossfade-complete', layer: this.kind, from: previous, to: null });
    }, duration * 1000 + 80);
  }

  stop() {
    ++this.pendingToken;
    for (const deck of this.decks) {
      deck.audio.pause();
      deck.audio.removeAttribute('src');
      deck.audio.load();
      deck.track = null;
      deck.gain.gain.cancelScheduledValues(this.context.currentTime);
      deck.gain.gain.value = 0;
    }
  }

  currentTrack() {
    return this.decks[this.activeIndex].track;
  }
}

function waitForAudio(audio, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      audio.removeEventListener('canplay', ready);
      audio.removeEventListener('error', failed);
      callback(value);
    };
    const ready = () => finish(resolve);
    const failed = () => finish(reject, new Error(audio.error?.message || 'browser audio decoder rejected the file'));
    const timer = setTimeout(() => finish(reject, new Error('audio decode timed out')), timeoutMs);
    audio.addEventListener('canplay', ready, { once: true });
    audio.addEventListener('error', failed, { once: true });
    audio.load();
  });
}

class AudioEngine {
  constructor() {
    this.context = null;
    this.music = null;
    this.ambience = null;
  }

  async start() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'playback' });
      this.music = new CrossfadeLayer(this.context, 'music', (event) => this.onLayerEvent(event));
      this.ambience = new CrossfadeLayer(this.context, 'ambience', (event) => this.onLayerEvent(event));
    }
    await this.context.resume();
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.context) return;
    this.music.setVolume(app.settings.musicVolume, app.muted);
    this.ambience.setVolume(app.settings.ambienceVolume, app.muted);
  }

  async cueScene(scene) {
    if (!this.context || !app.started) return;
    const music = chooseTrack(scene, 'music');
    const ambience = chooseTrack(scene, 'ambience');
    ui.audioState.textContent = 'Changing cue…';
    const outcomes = await Promise.allSettled([
      this.music.switchTo(music, app.settings.transitionSeconds),
      this.ambience.switchTo(ambience, app.settings.transitionSeconds)
    ]);
    const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
    if (failures.length) {
      showAlert(failures.map((failure) => failure.reason.message).join(' · '));
      ui.audioState.textContent = 'Cue needs attention';
    } else {
      ui.audioState.textContent = app.muted ? 'Muted' : 'Audio live';
    }
    renderNowPlaying();
  }

  mute(value) {
    app.muted = value;
    this.applyVolumes();
    ui.audioState.textContent = value ? 'Muted' : 'Audio live';
    recordEvent(value ? 'All sound muted immediately' : 'Sound restored');
    renderControls();
  }

  stop() {
    this.music?.stop();
    this.ambience?.stop();
    ui.audioState.textContent = 'Audio idle';
    renderNowPlaying();
  }

  onLayerEvent(event) {
    event.at = new Date().toISOString();
    if (event.type === 'crossfade-start') {
      const target = event.to?.name ?? 'silence';
      recordEvent(`${capitalize(event.layer)} → ${target} (${event.seconds.toFixed(1)}s fade)`);
    } else if (event.type === 'crossfade-complete') {
      renderNowPlaying();
    } else if (event.type === 'audio-error') {
      recordEvent(`${event.track.name} failed to play; previous ${event.layer} kept`, 'error');
    }
  }
}

const audioEngine = new AudioEngine();

function chooseTrack(scene, kind) {
  const eligible = app.settings.tracks.filter((track) => {
    if (track.kind !== kind || !track.scenes.includes(scene) || track.status === 'rejected') return false;
    if (kind === 'ambience') return track.status === 'project-asset' || track.status === 'accepted' || app.settings.allowUnreviewed;
    return track.status === 'accepted' || app.settings.allowUnreviewed;
  });
  if (!eligible.length) return null;
  const sorted = [...eligible].sort((a, b) => a.id.localeCompare(b.id));
  const index = stableHash(`bardsong:${scene}:${kind}`) % sorted.length;
  return sorted[index];
}

function stableHash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

class MicrophoneListener {
  constructor() {
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.silencer = null;
    this.chunks = [];
    this.sampleCount = 0;
    this.flushTimer = null;
    this.processing = Promise.resolve();
  }

  async start() {
    if (this.stream) return;
    if (!app.asr?.ready) throw new Error('Prepare the local speech model before starting the microphone.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.silencer = this.context.createGain();
    this.silencer.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      const copy = new Float32Array(event.inputBuffer.getChannelData(0));
      this.chunks.push(copy);
      this.sampleCount += copy.length;
    };
    this.source.connect(this.processor);
    this.processor.connect(this.silencer).connect(this.context.destination);
    this.flushTimer = setInterval(() => this.flush(), 5_500);
    setListenerUi(true);
    recordEvent('Local microphone listening started');
  }

  flush() {
    if (!this.sampleCount || !this.context) return;
    const chunks = this.chunks;
    const length = this.sampleCount;
    const sampleRate = this.context.sampleRate;
    this.chunks = [];
    this.sampleCount = 0;
    const joined = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
      chunk.fill(0);
    }
    if (rootMeanSquare(joined) < 0.006) {
      joined.fill(0);
      return;
    }
    const samples = resample(joined, sampleRate, 16_000);
    joined.fill(0);
    this.processing = this.processing
      .then(() => transcribeSamples(samples, 'microphone'))
      .catch((error) => showAlert(error.message));
  }

  async stop() {
    if (!this.stream) return;
    clearInterval(this.flushTimer);
    this.flush();
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    await this.context?.close().catch(() => {});
    this.stream = null;
    this.context = null;
    this.processor = null;
    this.source = null;
    this.silencer = null;
    this.chunks = [];
    this.sampleCount = 0;
    setListenerUi(false);
    recordEvent('Microphone listening stopped');
  }
}

const microphone = new MicrophoneListener();

function rootMeanSquare(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function resample(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input.slice();
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let total = 0;
    for (let cursor = start; cursor < end && cursor < input.length; cursor += 1) total += input[cursor];
    output[i] = total / Math.max(1, end - start);
  }
  return output;
}

async function transcribeSamples(samples, source) {
  recordEvent(`Transcribing ${source} audio locally…`);
  let result;
  try {
    result = await api('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)
    });
  } finally {
    samples.fill(0);
  }
  if (result.text) await submitCue(result.text, source);
  else recordEvent('No speech detected in local audio');
  return result.text;
}

async function submitCue(text, source = 'manual') {
  const clean = String(text ?? '').trim();
  if (!clean) return null;
  app.cueHistory.push({ text: clean, source, at: new Date() });
  if (app.cueHistory.length > 8) app.cueHistory.shift();
  renderCueHistory();
  const result = await api('/api/infer', jsonOptions('POST', { text: clean }));
  app.director = result.state;
  renderDirector(result.classification);
  if (result.changed && app.started) await audioEngine.cueScene(result.state.currentScene);
  if (result.changed) recordEvent(`Scene changed to ${sceneLabel(result.state.currentScene)} from ${source} cue`);
  else if (result.classification.suppressed) recordEvent(`Ignored false combat cue: ${result.classification.reason}`);
  return result;
}

function renderCueHistory() {
  if (!app.cueHistory.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Nothing heard yet.';
    ui.cueHistory.replaceChildren(empty);
    return;
  }
  ui.cueHistory.replaceChildren(...app.cueHistory.slice().reverse().map((cue) => {
    const li = document.createElement('li');
    li.textContent = cue.text;
    li.title = `${cue.source} · ${cue.at.toLocaleTimeString()}`;
    return li;
  }));
}

function renderScenes() {
  const template = $('#scene-button-template');
  ui.sceneGrid.replaceChildren(...app.scenes.map((scene) => {
    const fragment = template.content.cloneNode(true);
    const button = fragment.querySelector('button');
    button.dataset.scene = scene.id;
    fragment.querySelector('.scene-name').textContent = scene.label;
    fragment.querySelector('.scene-note').textContent = scene.note;
    button.addEventListener('click', () => manualScene(scene.id));
    return fragment;
  }));
}

function renderDirector(classification = app.director?.lastClassification) {
  const director = app.director;
  if (!director) return;
  ui.currentScene.textContent = sceneLabel(director.currentScene);
  ui.directorReason.textContent = director.lastReason || 'Waiting for a clear scene cue.';
  ui.directorMode.className = 'mode-badge';
  if (!director.active) {
    ui.directorMode.textContent = 'Stopped';
    ui.directorMode.classList.add('stopped');
  } else if (director.held) {
    ui.directorMode.textContent = 'Manual hold';
    ui.directorMode.classList.add('held');
  } else if (director.candidateScene) {
    ui.directorMode.textContent = `Checking ${sceneLabel(director.candidateScene)}`;
  } else {
    ui.directorMode.textContent = (microphone.stream || app.discord?.listeningToDm) ? 'Auto listening' : 'Auto ready';
  }
  $$('.scene-button').forEach((button) => button.classList.toggle('active', button.dataset.scene === director.currentScene));
  const confidence = Math.round((classification?.confidence ?? 0) * 100);
  ui.confidenceMeter.style.width = `${confidence}%`;
  if (!classification) ui.decisionCopy.textContent = 'No scene language yet.';
  else if (classification.suppressed) ui.decisionCopy.textContent = `Held steady: ${classification.reason}.`;
  else if (!classification.scene) ui.decisionCopy.textContent = classification.reason === 'silence' ? 'Silence holds the current scene.' : 'No clear scene change.';
  else ui.decisionCopy.textContent = `${confidence}% ${sceneLabel(classification.scene)} — ${classification.reason}.`;
  renderControls();
}

function renderControls() {
  const outputActive = app.started || app.discord?.state === 'connected';
  ui.startDj.disabled = app.started;
  ui.stopDj.disabled = !outputActive;
  ui.muteNow.disabled = !outputActive;
  ui.muteNow.textContent = app.muted ? 'Restore sound' : 'Mute now';
  ui.hold.disabled = Boolean(app.director?.held);
  ui.resume.disabled = !app.director?.held || !app.director?.active;
}

function renderNowPlaying() {
  const discordConnected = app.discord?.state === 'connected';
  const localMusic = audioEngine.music?.currentTrack()?.name ?? null;
  const localAmbience = audioEngine.ambience?.currentTrack()?.name ?? null;
  const music = (discordConnected ? app.discord.currentMusic : null) ?? localMusic;
  const ambience = (discordConnected ? app.discord.currentAmbience : null) ?? localAmbience;
  ui.currentMusic.textContent = music ?? 'None';
  ui.currentAmbience.textContent = ambience ?? 'None';

  if (app.muted || (discordConnected && app.discord.muted)) {
    ui.audioState.textContent = 'Muted';
  } else if (music || ambience) {
    ui.audioState.textContent = discordConnected && app.started
      ? 'Local + Discord live'
      : discordConnected
        ? 'Discord audio live'
        : 'Audio live';
  } else {
    ui.audioState.textContent = 'Audio idle';
  }
}

function renderDiscord() {
  const discord = app.discord;
  if (!discord) return;
  const connected = discord.state === 'connected';
  const busy = ['connecting', 'reconnecting', 'disconnecting'].includes(discord.state);
  ui.discordStatus.className = `status-pill ${connected ? 'live' : discord.state === 'error' ? 'error' : 'off'}`;
  ui.discordStatus.innerHTML = `<span class="status-dot"></span>Discord ${discord.state}`;
  ui.discordMiniStatus.textContent = discord.state;
  if (discord.runtimeMode === 'shared-familiar') {
    const occupancy = Number.isInteger(discord.humanOccupancy)
      ? `${discord.humanOccupancy} human${discord.humanOccupancy === 1 ? '' : 's'} present`
      : 'occupancy loading';
    const scribe = discord.scribeActive
      ? `scribe recording ${discord.scribeSessionId ?? ''}`.trim()
      : 'scribe idle';
    ui.discordTarget.textContent = `Shared Familiar connection · ${discord.targetName} · ${occupancy} · ${scribe}`;
  } else if (discord.idsReady) {
    ui.discordTarget.textContent = `Server ${discord.guildId} · Voice ${discord.voiceChannelId} · DM ${discord.dmUserId}`;
  } else {
    ui.discordTarget.textContent = 'Start Bardsong through Familiar to load the saved table target.';
  }
  if (discord.lastError) ui.discordTarget.textContent += ` · ${discord.lastError}`;
  ui.connectDiscord.disabled = connected || busy || !discord.configured;
  ui.disconnectDiscord.disabled = (!connected && !busy);
  ui.toggleDmListener.disabled = !connected || !app.asr?.ready;
  ui.toggleDmListener.textContent = discord.listeningToDm ? 'Stop' : 'Start';
  ui.toggleDmListener.classList.toggle('secondary', discord.listeningToDm);
  ui.shutdownRuntime.disabled = discord.runtimeMode !== 'shared-familiar';
  renderNowPlaying();
  renderControls();
}

function sceneLabel(id) {
  return app.scenes.find((scene) => scene.id === id)?.label ?? capitalize(id ?? 'quiet');
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

async function manualScene(scene) {
  try {
    const result = await api('/api/director', jsonOptions('POST', { action: 'override', scene }));
    app.director = result.state;
    renderDirector();
    if (app.started) await audioEngine.cueScene(scene);
    recordEvent(`${sceneLabel(scene)} selected manually; automatic changes held`);
  } catch (error) {
    showAlert(error.message);
  }
}

function renderMixer() {
  ui.musicVolume.value = Math.round(app.settings.musicVolume * 100);
  ui.musicOutput.value = `${ui.musicVolume.value}%`;
  ui.ambienceVolume.value = Math.round(app.settings.ambienceVolume * 100);
  ui.ambienceOutput.value = `${ui.ambienceVolume.value}%`;
  ui.transitionTime.value = app.settings.transitionSeconds;
  ui.transitionOutput.value = `${Number(app.settings.transitionSeconds).toFixed(1)}s`;
  ui.allowUnreviewed.checked = app.settings.allowUnreviewed;
}

let saveTimer;
function queuePreferenceSave() {
  clearTimeout(saveTimer);
  app.settings.musicVolume = Number(ui.musicVolume.value) / 100;
  app.settings.ambienceVolume = Number(ui.ambienceVolume.value) / 100;
  app.settings.transitionSeconds = Number(ui.transitionTime.value);
  app.settings.allowUnreviewed = ui.allowUnreviewed.checked;
  ui.musicOutput.value = `${ui.musicVolume.value}%`;
  ui.ambienceOutput.value = `${ui.ambienceVolume.value}%`;
  ui.transitionOutput.value = `${Number(ui.transitionTime.value).toFixed(1)}s`;
  audioEngine.applyVolumes();
  saveTimer = setTimeout(async () => {
    try {
      const result = await api('/api/settings', jsonOptions('PATCH', app.settings));
      app.settings = result.settings;
    } catch (error) {
      showAlert(`Settings were not saved: ${error.message}`);
    }
  }, 250);
}

function renderLibrary() {
  const template = $('#track-template');
  const tracks = app.settings.tracks.filter((track) => app.activeFilter === 'all' || track.kind === app.activeFilter);
  ui.libraryList.replaceChildren(...tracks.map((track) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('.track-card');
    card.dataset.trackId = track.id;
    const name = fragment.querySelector('.track-name');
    name.textContent = track.name;
    name.title = track.name;
    fragment.querySelector('.track-note').textContent = track.note || 'Local audio track';
    const kind = fragment.querySelector('.track-kind');
    kind.value = track.kind;
    const status = fragment.querySelector('.track-status');
    status.value = track.status;
    const sceneHolder = fragment.querySelector('.track-scenes');
    for (const scene of app.scenes) {
      const label = document.createElement('label');
      label.className = 'scene-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = scene.id;
      checkbox.checked = track.scenes.includes(scene.id);
      const text = document.createElement('span');
      text.textContent = scene.label;
      label.append(checkbox, text);
      sceneHolder.append(label);
      checkbox.addEventListener('change', () => updateTrackFromCard(track.id, card));
    }
    status.addEventListener('change', () => updateTrackFromCard(track.id, card));
    kind.addEventListener('change', () => updateTrackFromCard(track.id, card));
    fragment.querySelector('.preview-button').addEventListener('click', (event) => previewTrack(track, event.currentTarget, card));
    return fragment;
  }));
}

async function updateTrackFromCard(id, card) {
  const track = app.settings.tracks.find((candidate) => candidate.id === id);
  const payload = {
    name: track.name,
    kind: card.querySelector('.track-kind').value,
    status: card.querySelector('.track-status').value,
    scenes: [...card.querySelectorAll('.scene-check input:checked')].map((input) => input.value)
  };
  try {
    const result = await api(`/api/tracks/${encodeURIComponent(id)}`, jsonOptions('PATCH', payload));
    Object.assign(track, result.track);
    recordEvent(`${track.name} library assignment saved`);
    if (app.started) await audioEngine.cueScene(app.director.currentScene);
  } catch (error) {
    card.querySelector('.track-error').textContent = error.message;
    card.querySelector('.track-error').classList.remove('hidden');
  }
}

async function previewTrack(track, button, card) {
  if (app.preview) {
    app.preview.audio.pause();
    app.preview.button.classList.remove('playing');
    app.preview.button.textContent = '▶';
    if (app.preview.track.id === track.id) {
      app.preview = null;
      return;
    }
  }
  const audio = new Audio(`/api/tracks/${encodeURIComponent(track.id)}/audio`);
  audio.volume = 0.45;
  audio.addEventListener('ended', () => {
    button.classList.remove('playing');
    button.textContent = '▶';
    app.preview = null;
  });
  try {
    await audio.play();
    button.classList.add('playing');
    button.textContent = '■';
    app.preview = { track, audio, button };
    card.querySelector('.track-error').classList.add('hidden');
  } catch {
    const error = card.querySelector('.track-error');
    error.textContent = 'This file is missing, corrupt, or unsupported by Chrome.';
    error.classList.remove('hidden');
    recordEvent(`${track.name} failed its browser decode check`, 'error');
  }
}

function setListenerUi(live) {
  ui.listenerStatus.className = `status-pill ${live ? 'live' : 'off'}`;
  ui.listenerStatus.innerHTML = `<span class="status-dot"></span>${live ? 'Listening locally' : 'Microphone off'}`;
  ui.startListening.disabled = live || !app.asr?.ready;
  ui.stopListening.disabled = !live;
  renderDirector();
}

async function initialize() {
  try {
    const session = await api('/api/session');
    sessionToken = session.token;
    const initial = await api('/api/state');
    app.scenes = initial.scenes;
    app.settings = initial.settings;
    app.director = initial.director;
    app.asr = initial.asr;
    app.discord = initial.discord;
    renderScenes();
    renderMixer();
    renderLibrary();
    renderDirector();
    renderControls();
    renderDiscord();
    setListenerUi(false);
    ui.asrNotReady.classList.toggle('hidden', app.asr.ready);
    recordEvent('Bardsong ready on this PC');
  } catch (error) {
    $('#server-status').className = 'status-pill error';
    $('#server-status').innerHTML = '<span class="status-dot"></span>Server unavailable';
    showAlert(`Bardsong could not load: ${error.message}`);
  }
}

ui.startDj.addEventListener('click', async () => {
  try {
    await audioEngine.start();
    const result = await api('/api/director', jsonOptions('POST', { action: 'start' }));
    app.director = result.state;
    app.started = true;
    app.muted = false;
    renderDirector();
    renderControls();
    await audioEngine.cueScene(app.director.currentScene);
    recordEvent('Local monitor started');
  } catch (error) {
    showAlert(error.message);
  }
});

ui.muteNow.addEventListener('click', async () => {
  const muted = !app.muted;
  audioEngine.mute(muted);
  try {
    app.discord = await api('/api/discord/mute', jsonOptions('POST', { muted }));
    renderDiscord();
  } catch (error) {
    showAlert(`Local sound changed, but Discord mute failed: ${error.message}`);
  }
});
ui.stopDj.addEventListener('click', async () => {
  await microphone.stop();
  app.started = false;
  app.muted = false;
  app.cueHistory = [];
  renderCueHistory();
  audioEngine.stop();
  renderControls();
  try {
    const result = await api('/api/director', jsonOptions('POST', { action: 'stop' }));
    app.director = result.state;
    renderDirector();
    recordEvent('DJ stopped; local and Discord sound ended');
  } catch (error) {
    showAlert(`Local sound stopped, but Discord stop failed: ${error.message}`);
  }
});

ui.connectDiscord.addEventListener('click', async () => {
  ui.connectDiscord.disabled = true;
  ui.discordMiniStatus.textContent = 'connecting';
  try {
    app.discord = await api('/api/discord/connect', jsonOptions('POST', {}));
    renderDiscord();
    recordEvent('Discord voice connected');
  } catch (error) {
    showAlert(`Discord connection failed: ${error.message}`);
    await refreshDiscord();
  }
});

ui.disconnectDiscord.addEventListener('click', async () => {
  try {
    app.discord = await api('/api/discord/disconnect', jsonOptions('POST', {}));
    renderDiscord();
    recordEvent('DJ output stopped; Familiar and an active scribe may remain connected');
  } catch (error) {
    showAlert(`Discord disconnect failed: ${error.message}`);
  }
});

ui.shutdownRuntime.addEventListener('click', async () => {
  const warning = app.discord?.scribeActive
    ? 'This will finalize the active scribe capture, stop all audio, leave Discord, and close Familiar. Continue?'
    : 'This will stop all audio, leave Discord, and close Familiar. Continue?';
  if (!window.confirm(warning)) return;
  ui.shutdownRuntime.disabled = true;
  recordEvent('Tonight runtime shutdown requested');
  try {
    await api('/api/runtime/shutdown', jsonOptions('POST', {}));
    showAlert('Familiar and Bardsong are shutting down cleanly.', 'good');
  } catch (error) {
    ui.shutdownRuntime.disabled = false;
    showAlert(`Clean shutdown failed: ${error.message}`);
  }
});

ui.toggleDmListener.addEventListener('click', async () => {
  const enabled = !app.discord.listeningToDm;
  try {
    app.discord = await api('/api/discord/listen', jsonOptions('POST', { enabled }));
    renderDiscord();
    renderDirector();
    recordEvent(enabled ? 'Listening to the configured DM only' : 'Discord DM listening stopped');
  } catch (error) {
    showAlert(error.message);
  }
});

ui.hold.addEventListener('click', async () => {
  const result = await api('/api/director', jsonOptions('POST', { action: 'hold' }));
  app.director = result.state;
  renderDirector();
  recordEvent('Current cue held manually');
});

ui.resume.addEventListener('click', async () => {
  const result = await api('/api/director', jsonOptions('POST', { action: 'resume' }));
  app.director = result.state;
  renderDirector();
  recordEvent('Automatic scene changes resumed');
});

ui.cueForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = ui.cueInput.value;
  ui.cueInput.value = '';
  try { await submitCue(text); } catch (error) { showAlert(error.message); }
});

ui.startListening.addEventListener('click', async () => {
  try { await microphone.start(); } catch (error) { showAlert(error.message); }
});
ui.stopListening.addEventListener('click', () => microphone.stop());

$('#clear-cues').addEventListener('click', () => {
  app.cueHistory = [];
  renderCueHistory();
});
$('#clear-activity').addEventListener('click', () => {
  app.eventLog = [];
  renderActivity();
});

for (const input of [ui.musicVolume, ui.ambienceVolume, ui.transitionTime, ui.allowUnreviewed]) {
  input.addEventListener('input', queuePreferenceSave);
}

ui.trackImport.addEventListener('change', async () => {
  const files = [...ui.trackImport.files];
  ui.trackImport.value = '';
  for (const file of files) {
    try {
      const kind = /ambien|rain|wind|forest|fire|dungeon/i.test(file.name) ? 'ambience' : 'music';
      const result = await api(`/api/library/import?filename=${encodeURIComponent(file.name)}&kind=${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      app.settings.tracks.push(result.track);
      recordEvent(`${result.track.name} imported as unreviewed ${kind}`);
    } catch (error) {
      showAlert(`${file.name}: ${error.message}`);
    }
  }
  renderLibrary();
});

$('#export-settings').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = '/api/settings/export';
  link.download = 'bardsong-settings.json';
  link.click();
  recordEvent('Settings recovery file exported');
});

ui.restoreSettings.addEventListener('change', async () => {
  const [file] = ui.restoreSettings.files;
  ui.restoreSettings.value = '';
  if (!file) return;
  try {
    const snapshot = JSON.parse(await file.text());
    const result = await api('/api/settings/restore', jsonOptions('POST', snapshot));
    app.settings = result.settings;
    renderMixer();
    renderLibrary();
    audioEngine.applyVolumes();
    if (app.started) await audioEngine.cueScene(app.director.currentScene);
    showAlert('Settings restored. A pre-restore backup was kept locally.', 'good');
    recordEvent('Settings restored from recovery file');
  } catch (error) {
    showAlert(`Could not restore settings: ${error.message}`);
  }
});

$$('.filter').forEach((button) => button.addEventListener('click', () => {
  app.activeFilter = button.dataset.filter;
  $$('.filter').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
  renderLibrary();
}));

ui.speechFixture.addEventListener('change', async () => {
  const [file] = ui.speechFixture.files;
  ui.speechFixture.value = '';
  if (!file) return;
  try {
    if (!app.asr?.ready) throw new Error('Prepare the local speech model first.');
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const mono = decoded.getChannelData(0).slice();
    const samples = resample(mono, decoded.sampleRate, 16_000);
    mono.fill(0);
    await context.close();
    await transcribeSamples(samples, 'owned recording');
  } catch (error) {
    showAlert(`Speech test failed: ${error.message}`);
  }
});

window.__bardsongTest = {
  state: () => ({
    started: app.started,
    muted: app.muted,
    director: structuredClone(app.director),
    currentMusic: audioEngine.music?.currentTrack()?.name ?? null,
    currentAmbience: audioEngine.ambience?.currentTrack()?.name ?? null,
    events: app.eventLog.map((event) => ({ ...event, at: event.at.toISOString() }))
  }),
  cue: (text) => submitCue(text, 'test'),
  override: (scene) => manualScene(scene),
  start: () => ui.startDj.click(),
  mute: () => ui.muteNow.click()
};

let polling = false;
async function refreshDiscord() {
  if (!sessionToken || polling) return;
  polling = true;
  try {
    app.discord = await api('/api/discord/status');
    renderDiscord();
    if (app.discord.listeningToDm) {
      const snapshot = await api('/api/state');
      const changed = snapshot.director.currentScene !== app.director.currentScene;
      app.director = snapshot.director;
      renderDirector();
      if (changed && app.started) await audioEngine.cueScene(app.director.currentScene);
    }
  } catch {
    // The main server indicator owns availability errors.
  } finally {
    polling = false;
  }
}

initialize().then(() => setInterval(refreshDiscord, 2_000));
