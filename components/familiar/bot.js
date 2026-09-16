const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream");
const { pathToFileURL } = require("node:url");
const { SharedVoiceSession } = require("./shared-voice-session.js");

const workspaceRoot = __dirname;
let prism;
let EndBehaviorType;
let VoiceConnectionStatus;
let entersState;
let getVoiceConnection;
let joinVoiceChannel;
let DiscordChannelType;
let client = null;
let guildId = null;
let voiceChannelId = null;
let textChannelId = null;
let commandPrefix = "!scribe";
let silenceMs = 1500;
let maxChunkSeconds = 300;
let sessionRoot = workspaceRoot;
let active = null;
let manifestWriteSequence = 0;
let localWriteSequence = 0;
let autoRecordConfig = null;
let runtimeTargetConfig = null;
let consentStore = null;
let autoRecordController = null;
let sharedVoiceSession = null;
let bardsongServer = null;
let bardsongDiscord = null;
let shuttingDown = null;
let runtimeLock = null;

const AUTO_RECORD_NOTICE = "🔴 RECORDING NOTICE: Familiar is joining this voice room and will record participant audio for this Sigil session. Anyone may use `!scribe revoke` in the approved text room at any time; recording will stop.";
const AUTO_RECORD_BLOCKED = "Automatic recording is blocked because at least one present participant does not have active consent. Use `!scribe consent` in the approved text room to opt in.";
const AUTO_RECORD_FAILURE = "Automatic recording failed closed. No successful recording is being claimed; check the local capture evidence before trying again.";

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveFromWorkspace(value) {
  if (!value) return workspaceRoot;
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function cleanSessionId(sessionId) {
  const raw = String(sessionId || "000").trim();
  return /^\d+$/.test(raw) ? raw.padStart(3, "0") : raw;
}

function sessionDir(sessionId, root = sessionRoot) {
  return path.join(root, cleanSessionId(sessionId), "audio", "discord");
}

function relativeToWorkspace(target) {
  return path.relative(workspaceRoot, target).replace(/\\/g, "/");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireRuntimeLock(root = workspaceRoot, {
  io = fs,
  pid = process.pid,
  isAlive = isProcessAlive
} = {}) {
  const localDir = path.join(root, ".local");
  const filename = path.join(localDir, "familiar-runtime.lock");
  io.mkdirSync(localDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd;
    try {
      fd = io.openSync(filename, "wx");
      io.writeFileSync(fd, `${JSON.stringify({ pid, startedAt: nowIso() })}\n`, "utf8");
      return { fd, filename, pid, io, released: false };
    } catch (error) {
      if (fd !== undefined) {
        try { io.closeSync(fd); } catch { }
        try { io.unlinkSync(filename); } catch { }
        throw error;
      }
      if (error?.code !== "EEXIST") throw error;
      let ownerPid = null;
      try {
        ownerPid = Number(JSON.parse(io.readFileSync(filename, "utf8")).pid);
      } catch {
        ownerPid = null;
      }
      if (isAlive(ownerPid)) {
        throw new Error("Familiar is already running; use the existing process instead of starting a second Discord client.");
      }
      try {
        io.unlinkSync(filename);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
    }
  }
  throw new Error("Familiar could not reserve its one-process runtime lock.");
}

function releaseRuntimeLock(lock) {
  if (!lock || lock.released) return;
  lock.released = true;
  try { lock.io.closeSync(lock.fd); } catch { }
  try {
    const ownerPid = Number(JSON.parse(lock.io.readFileSync(lock.filename, "utf8")).pid);
    if (ownerPid === lock.pid) lock.io.unlinkSync(lock.filename);
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Familiar could not remove its local runtime lock.");
  }
}

function nowIso() {
  return new Date().toISOString();
}

function nowStamp() {
  return nowIso().replace(/[:.]/g, "-");
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readJson(filename, io = fs) {
  return JSON.parse(io.readFileSync(filename, "utf8"));
}

function saveJsonAtomic(filename, value, io = fs) {
  io.mkdirSync(path.dirname(filename), { recursive: true });
  const tempPath = `${filename}.${process.pid}.${localWriteSequence++}.tmp`;
  try {
    io.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    io.renameSync(tempPath, filename);
  } finally {
    try {
      if (io.existsSync(tempPath)) io.unlinkSync(tempPath);
    } catch {
      // A unique ignored temp file cannot replace the durable ledger.
    }
  }
}

function resolvePrivatePath(value, root) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

function requireString(config, key) {
  if (typeof config[key] !== "string" || !config[key].trim()) {
    throw new Error(`Automatic recording requires ${key}.`);
  }
  return config[key].trim();
}

function requireSnowflake(config, key) {
  const value = requireString(config, key);
  if (!/^\d{16,22}$/.test(value)) throw new Error(`Automatic recording requires a valid ${key}.`);
  return value;
}

function readSeedManifest(filename, io = fs) {
  if (!filename || !io.existsSync(filename)) throw new Error("The prior consented session manifest is unavailable.");
  const manifest = readJson(filename, io);
  if (manifest.status !== "stopped"
      || !/^\d+$/.test(String(manifest.sessionId || ""))
      || !manifest.speakers
      || typeof manifest.speakers !== "object"
      || Array.isArray(manifest.speakers)) {
    throw new Error("The prior consented session manifest is invalid.");
  }
  return manifest;
}

function loadAutoRecordConfig(configFilename, root = workspaceRoot, io = fs) {
  if (!configFilename) return null;
  const filename = resolvePrivatePath(configFilename, root);
  if (!isInside(path.join(root, ".local"), filename)) {
    throw new Error("Automatic recording configuration must stay under .local.");
  }

  const parsed = readJson(filename, io);
  if (parsed.enabled !== true) return null;

  const config = {
    enabled: true,
    guildId: requireSnowflake(parsed, "guildId"),
    voiceChannelId: requireSnowflake(parsed, "voiceChannelId"),
    noticeTextChannelId: requireSnowflake(parsed, "noticeTextChannelId"),
    ownerMemberId: requireSnowflake(parsed, "ownerMemberId"),
    sessionRoot: resolvePrivatePath(requireString(parsed, "sessionRoot"), root),
    consentLedger: resolvePrivatePath(requireString(parsed, "consentLedger"), root),
    seedManifest: resolvePrivatePath(requireString(parsed, "seedManifest"), root),
    ownerLeaveGraceMs: Number(parsed.ownerLeaveGraceMs)
  };

  if (!isInside(path.join(root, "campaigns"), config.sessionRoot)) {
    throw new Error("Automatic recording sessionRoot must stay under campaigns.");
  }
  if (!isInside(path.join(root, ".local"), config.consentLedger)) {
    throw new Error("Automatic recording consentLedger must stay under .local.");
  }
  if (!Number.isInteger(config.ownerLeaveGraceMs)
      || config.ownerLeaveGraceMs < 1_000
      || config.ownerLeaveGraceMs > 60_000) {
    throw new Error("Automatic recording requires ownerLeaveGraceMs from 1000 through 60000.");
  }
  readSeedManifest(config.seedManifest, io);
  return config;
}

function loadRuntimeTargets({
  autoRecordFilename,
  bardsongTargetFilename,
  manualRecordingOnly = false,
  root = workspaceRoot,
  io = fs
} = {}) {
  return {
    autoRecordConfig: manualRecordingOnly
      ? null
      : loadAutoRecordConfig(autoRecordFilename, root, io),
    runtimeTargetConfig: loadAutoRecordConfig(bardsongTargetFilename, root, io)
  };
}

function findNextSessionId(root, seedManifestPath = null, io = fs) {
  let highest = 0;
  if (io.existsSync(root)) {
    for (const entry of io.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+$/.test(entry.name)) highest = Math.max(highest, Number(entry.name));
    }
  }
  if (seedManifestPath) {
    const seed = readSeedManifest(seedManifestPath, io);
    if (/^\d+$/.test(String(seed.sessionId || ""))) highest = Math.max(highest, Number(seed.sessionId));
  }
  return String(highest + 1).padStart(3, "0");
}

function createConsentStore(ledgerPath, seedManifestPath = null, io = fs) {
  let state;
  let healthy = true;

  if (io.existsSync(ledgerPath)) {
    state = readJson(ledgerPath, io);
    if (state.schemaVersion !== 1 || !state.consents || typeof state.consents !== "object" || Array.isArray(state.consents)) {
      throw new Error("The local consent ledger is invalid.");
    }
  } else {
    state = { schemaVersion: 1, updatedAt: nowIso(), consents: {} };
    if (seedManifestPath) {
      const manifest = readSeedManifest(seedManifestPath, io);
      for (const memberId of Object.keys(manifest.speakers || {})) {
        if (!/^\d{16,22}$/.test(memberId)) continue;
        state.consents[memberId] = {
          active: true,
          source: "owner-reported-persistent-consent",
          updatedAt: nowIso()
        };
      }
    }
    saveJsonAtomic(ledgerPath, state, io);
  }

  return {
    has(memberId) {
      return healthy && state.consents[memberId]?.active === true;
    },
    set(memberId, allowed) {
      if (!/^\d{16,22}$/.test(String(memberId || ""))) throw new Error("A valid Discord member is required.");
      const next = JSON.parse(JSON.stringify(state));
      next.updatedAt = nowIso();
      next.consents[memberId] = {
        active: allowed === true,
        source: allowed === true ? "self-service-consent" : "self-service-revocation",
        updatedAt: next.updatedAt
      };
      if (allowed !== true) state = next;
      try {
        saveJsonAtomic(ledgerPath, next, io);
        state = next;
      } catch (err) {
        healthy = false;
        throw err;
      }
    },
    isHealthy() {
      return healthy;
    }
  };
}

function maySubscribe(capture, userId, member) {
  if (!capture.requireConsent && !capture.autoRecord) return true;
  return Boolean(member && member.user?.bot !== true && capture.isUserConsented?.(userId));
}

function verifyManifestClosure(outDir, io = fs, expectedSessionId = null) {
  const issues = [];
  let manifest = null;
  try {
    manifest = readJson(path.join(outDir, "capture_manifest.json"), io);
  } catch {
    issues.push("capture manifest is missing or unreadable");
  }

  const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  if (manifest && manifest.status !== "stopped") issues.push(`manifest status is ${manifest.status || "missing"}`);
  if (manifest && !Array.isArray(manifest.chunks)) issues.push("manifest chunk list is missing");
  if (manifest && (!manifest.speakers || typeof manifest.speakers !== "object" || Array.isArray(manifest.speakers))) {
    issues.push("manifest speaker map is missing");
  }
  if (manifest && expectedSessionId !== null && cleanSessionId(manifest.sessionId) !== cleanSessionId(expectedSessionId)) {
    issues.push("manifest session ID does not match the stopped capture");
  }
  const unfinished = chunks.filter((chunk) => !["finished", "empty", "error"].includes(chunk.status));
  if (unfinished.length) issues.push(`${unfinished.length} unfinished chunk(s) remain`);

  let missingWavs = 0;
  for (const chunk of chunks) {
    if (typeof chunk.filename !== "string" || path.basename(chunk.filename) !== chunk.filename || !chunk.filename.endsWith(".wav")) {
      missingWavs += 1;
      continue;
    }
    const wavPath = path.join(outDir, chunk.filename);
    try {
      if (!io.statSync(wavPath).isFile()) missingWavs += 1;
    } catch {
      missingWavs += 1;
    }
  }
  if (missingWavs) issues.push(`${missingWavs} referenced missing WAV file(s)`);

  let tempDebris = 0;
  try {
    tempDebris = io.readdirSync(outDir)
      .filter((name) => name.startsWith("capture_manifest.json") && name.endsWith(".tmp"))
      .length;
  } catch {
    if (manifest) issues.push("capture directory could not be inspected");
  }
  if (tempDebris) issues.push(`${tempDebris} temporary manifest file(s) remain`);

  const chunkErrors = chunks.filter((chunk) => chunk.status === "error" || Boolean(chunk.error)).length;
  return {
    passed: issues.length === 0 && chunkErrors === 0,
    issues,
    chunkErrors,
    chunks: chunks.length,
    speakers: manifest?.speakers && typeof manifest.speakers === "object"
      ? Object.keys(manifest.speakers).length
      : 0
  };
}

function formatClosureSummary(sessionId, reason, closure) {
  const reasonText = {
    consent: "consent was absent or revoked",
    "owner-left": "the owner left through the grace period",
    "empty-room": "the room became empty",
    failure: "a capture failure occurred",
    shutdown: "the local process was stopped"
  }[reason] || "a stop was requested";
  const issueText = closure.issues.length ? ` Issues: ${closure.issues.join("; ")}.` : "";
  return `Session ${cleanSessionId(sessionId)} stopped because ${reasonText}. Closure ${closure.passed ? "PASS" : "FAIL"}. Speakers: ${closure.speakers}. Chunks: ${closure.chunks}. Chunk errors: ${closure.chunkErrors}.${issueText}`;
}

function saveManifest(capture, io = fs) {
  capture.manifest.updatedAt = nowIso();
  const manifestPath = path.join(capture.outDir, "capture_manifest.json");
  const tempPath = `${manifestPath}.${process.pid}.${manifestWriteSequence++}.tmp`;
  try {
    io.writeFileSync(tempPath, `${JSON.stringify(capture.manifest, null, 2)}\n`, "utf8");
    io.renameSync(tempPath, manifestPath);
  } finally {
    try {
      if (io.existsSync(tempPath)) io.unlinkSync(tempPath);
    } catch {
      // A stale uniquely named temp file cannot corrupt the live manifest.
    }
  }
}

function saveManifestBestEffort(capture, context) {
  try {
    saveManifest(capture);
  } catch {
    console.error(`Could not update the capture manifest after ${context}.`);
  }
}

function wavHeader(dataBytes, sampleRate = 48000, channels = 2, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function createWavWriteStream(outPath) {
  const fileStream = fs.createWriteStream(outPath);
  fileStream.write(wavHeader(0));
  return fileStream;
}

function finalizeWav(outPath) {
  const size = fs.statSync(outPath).size;
  const dataBytes = Math.max(0, size - 44);
  const handle = fs.openSync(outPath, "r+");
  try {
    fs.writeSync(handle, wavHeader(dataBytes), 0, 44, 0);
  } finally {
    fs.closeSync(handle);
  }
  return size;
}

function upsertSpeaker(capture, userId, member) {
  const current = capture.manifest.speakers[userId] || {
    userId,
    displayName: null,
    username: null,
    firstSeenAt: nowIso()
  };

  if (member) {
    current.displayName = member.displayName || current.displayName;
    current.username = member.user?.tag || member.user?.username || current.username;
  }

  capture.manifest.speakers[userId] = current;
  return current;
}

function refreshSpeaker(capture, userId, chunk) {
  const cached = capture.guild.members.cache.get(userId);
  const cachedSpeaker = upsertSpeaker(capture, userId, cached);
  chunk.displayName = cachedSpeaker.displayName;
  chunk.username = cachedSpeaker.username;

  capture.guild.members
    .fetch(userId)
    .then((member) => {
      const speaker = upsertSpeaker(capture, userId, member);
      chunk.displayName = speaker.displayName;
      chunk.username = speaker.username;
      saveManifestBestEffort(capture, "refreshing a speaker");
    })
    .catch(() => {
      saveManifestBestEffort(capture, "refreshing a speaker");
    });
}

function removeChunk(capture, chunk) {
  const index = capture.manifest.chunks.indexOf(chunk);
  if (index >= 0) capture.manifest.chunks.splice(index, 1);
}

function beginSubscription(capture, chunk, buildSubscription, persist = saveManifest) {
  capture.manifest.chunks.push(chunk);
  try {
    persist(capture);
  } catch (err) {
    removeChunk(capture, chunk);
    throw err;
  }

  try {
    const subscription = buildSubscription();
    capture.subscriptions.set(chunk.userId, subscription);
    return subscription;
  } catch (err) {
    removeChunk(capture, chunk);
    saveManifestBestEffort(capture, "rolling back a speaker");
    throw err;
  }
}

async function drainSubscriptions(capture) {
  const subscriptions = [...capture.subscriptions.values()];
  for (const subscription of subscriptions) {
    subscription.stopping = true;
    if (subscription.timeout) clearTimeout(subscription.timeout);
    try {
      (subscription.sourceStream || subscription.opusStream).destroy();
      subscription.decoder?.destroy();
    } catch {
      console.error("Could not stop an audio stream cleanly.");
    }
  }
  await Promise.allSettled(subscriptions.map((subscription) => subscription.done));
}

function createAutoRecordController({
  config,
  getRoomSnapshot,
  getActiveCapture,
  isConsented,
  findNextSession,
  startCapture: startAutomaticCapture,
  stopCapture: stopAutomaticCapture,
  sendNotice,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let queue = Promise.resolve();
  let ownerLeaveTimer = null;

  function clearOwnerLeaveTimer() {
    if (!ownerLeaveTimer) return;
    clearTimer(ownerLeaveTimer);
    ownerLeaveTimer = null;
  }

  async function failClosed() {
    clearOwnerLeaveTimer();
    try {
      if (getActiveCapture()?.autoRecord) await stopAutomaticCapture("failure");
    } catch {
      // The generic failure notice below remains the only public claim.
    }
    try {
      await sendNotice(AUTO_RECORD_FAILURE);
    } catch {
      // If Discord itself is unavailable, the local manifest remains the evidence.
    }
  }

  function enqueue(work) {
    const run = queue.then(work, work).catch(async () => {
      await failClosed();
    });
    queue = run.catch(() => {});
    return run;
  }

  function humanMembers(snapshot) {
    return [...(snapshot?.members || [])].filter((current) => current?.user?.bot !== true);
  }

  async function stopFor(reason) {
    clearOwnerLeaveTimer();
    if (!getActiveCapture()?.autoRecord) return;
    await stopAutomaticCapture(reason);
  }

  function armOwnerLeaveTimer() {
    if (ownerLeaveTimer) return;
    let handle = null;
    handle = setTimer(() => enqueue(async () => {
      if (ownerLeaveTimer !== handle) return;
      ownerLeaveTimer = null;
      const snapshot = await getRoomSnapshot();
      const humans = humanMembers(snapshot);
      if (!getActiveCapture()?.autoRecord) return;
      if (humans.length === 0) {
        await stopFor("empty-room");
      } else if (!humans.some((current) => current.id === config.ownerMemberId)) {
        await stopFor("owner-left");
      }
    }), config.ownerLeaveGraceMs);
    ownerLeaveTimer = handle;
  }

  async function reconcileActive(snapshot) {
    if (!getActiveCapture()?.autoRecord) {
      clearOwnerLeaveTimer();
      return;
    }
    const humans = humanMembers(snapshot);
    if (humans.some((current) => !isConsented(current.id))) {
      await stopFor("consent");
      return;
    }
    if (humans.length === 0) {
      await stopFor("empty-room");
      return;
    }
    if (humans.some((current) => current.id === config.ownerMemberId)) {
      clearOwnerLeaveTimer();
    } else {
      armOwnerLeaveTimer();
    }
  }

  async function attemptStart(snapshot) {
    if (getActiveCapture()) return;
    const humans = humanMembers(snapshot);
    if (!humans.some((current) => current.id === config.ownerMemberId)) return;
    if (humans.some((current) => !isConsented(current.id))) {
      await sendNotice(AUTO_RECORD_BLOCKED);
      return;
    }

    const sessionId = findNextSession();
    await sendNotice(AUTO_RECORD_NOTICE);
    await startAutomaticCapture(sessionId);
    await sendNotice(`Automatic recording started for Sigil Session ${cleanSessionId(sessionId)}.`);
    await reconcileActive(await getRoomSnapshot());
  }

  function isTargetChange(oldState, newState) {
    const guild = newState?.guild || oldState?.guild;
    if (guild?.id !== config.guildId) return false;
    return oldState?.channelId === config.voiceChannelId || newState?.channelId === config.voiceChannelId;
  }

  return {
    handleVoiceStateUpdate(oldState, newState) {
      if (!isTargetChange(oldState, newState)) return queue;
      const joined = oldState?.channelId !== config.voiceChannelId
        && newState?.channelId === config.voiceChannelId;
      const changedMember = newState?.member || oldState?.member;
      const changedId = changedMember?.id || newState?.id || oldState?.id;

      return enqueue(async () => {
        if (joined
            && changedMember?.user?.bot !== true
            && getActiveCapture()?.autoRecord
            && !isConsented(changedId)) {
          await stopFor("consent");
          return;
        }

        const snapshot = await getRoomSnapshot();
        if (!getActiveCapture() && joined && changedId === config.ownerMemberId) {
          await attemptStart(snapshot);
        } else {
          await reconcileActive(snapshot);
        }
      });
    },
    reconcile() {
      return enqueue(async () => {
        const snapshot = await getRoomSnapshot();
        if (getActiveCapture()) await reconcileActive(snapshot);
        else await attemptStart(snapshot);
      });
    },
    handleConsentChange(memberId, allowed) {
      return enqueue(async () => {
        const snapshot = await getRoomSnapshot();
        const isPresent = humanMembers(snapshot).some((current) => current.id === memberId);
        const capture = getActiveCapture();
        const hasCurrentSubscription = capture?.subscriptions?.has?.(memberId) === true;
        if (!allowed && (isPresent || hasCurrentSubscription) && capture?.autoRecord) {
          await stopFor("consent");
        } else if (allowed && !getActiveCapture()) {
          await attemptStart(snapshot);
        }
      });
    },
    handleUnconsentedSpeaker() {
      return enqueue(() => stopFor("consent"));
    },
    cancel() {
      clearOwnerLeaveTimer();
    },
    whenIdle() {
      return queue;
    }
  };
}

async function resolveVoiceChannel(message) {
  const guild = message?.guild || (await client.guilds.fetch(guildId));
  let channel = null;

  if (message?.member?.voice?.channel) {
    channel = message.member.voice.channel;
  } else if (message?.author?.id && guild.members) {
    try {
      const member = await guild.members.fetch(message.author.id);
      channel = member?.voice?.channel || null;
    } catch {
      channel = null;
    }
  }

  if (!channel && voiceChannelId) {
    channel = await guild.channels.fetch(voiceChannelId);
  }

  if (!channel) {
    throw new Error("Join the target voice channel first, then run the start command again.");
  }

  return { guild, channel };
}

async function joinVoiceForMessage(message) {
  const { guild, channel } = await resolveVoiceChannel(message);
  const connection = await joinVoice(guild, channel);
  return { guild, channel, connection };
}

async function joinVoice(guild, channel) {
  if (!channel || !channel.joinable) {
    throw new Error("The selected voice channel is not joinable by this bot.");
  }

  if (sharedVoiceSession) return sharedVoiceSession.acquire("scribe", guild, channel);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  return connection;
}

function startSpeakerChunk(capture, userId, reason = "speaking") {
  if (!active || active !== capture || capture.stopping || capture.subscriptions.has(userId)) return;
  const member = capture.guild.members.cache.get(userId) || null;
  if (!maySubscribe(capture, userId, member)) {
    if (capture.autoRecord && member?.user?.bot !== true) capture.onConsentViolation?.();
    return;
  }

  const startedAt = new Date();
  const speaker = upsertSpeaker(capture, userId, member);
  const chunkId = `${nowStamp()}-${userId}`;
  const filename = `${chunkId}.wav`;
  const outPath = path.join(capture.outDir, filename);
  const chunk = {
    id: chunkId,
    userId,
    displayName: speaker.displayName,
    username: speaker.username,
    filename,
    relativePath: relativeToWorkspace(outPath),
    startedAt: startedAt.toISOString(),
    startOffsetMs: startedAt.getTime() - capture.startedAtDate.getTime(),
    endedAt: null,
    endOffsetMs: null,
    bytes: null,
    status: "recording",
    reason
  };

  const subscription = beginSubscription(capture, chunk, () => {
    const sharedPcm = Boolean(capture.pcmReceiver);
    const sourceStream = sharedPcm
      ? capture.pcmReceiver.subscribePcm(userId, `scribe:${capture.sessionId}:${chunkId}`)
      : capture.receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: silenceMs
          }
        });
    const decoder = sharedPcm
      ? null
      : new prism.opus.Decoder({
          frameSize: 960,
          channels: 2,
          rate: 48000
        });
    const fileStream = createWavWriteStream(outPath);
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    return {
      sourceStream,
      decoder,
      fileStream,
      outPath,
      chunk,
      rollover: false,
      stopping: false,
      timeout: null,
      done,
      resolveDone
    };
  });

  refreshSpeaker(capture, userId, chunk);

  if (maxChunkSeconds > 0) {
    subscription.timeout = setTimeout(() => {
      const current = capture.subscriptions.get(userId);
      if (!current || current.chunk.id !== chunk.id) return;
      current.rollover = true;
      current.sourceStream.destroy();
      current.decoder?.destroy();
    }, maxChunkSeconds * 1000);
  }

  const streams = subscription.decoder
    ? [subscription.sourceStream, subscription.decoder, subscription.fileStream]
    : [subscription.sourceStream, subscription.fileStream];
  pipeline(...streams, (err) => {
    try {
      if (subscription.timeout) clearTimeout(subscription.timeout);
      if (capture.subscriptions.get(userId) === subscription) capture.subscriptions.delete(userId);
      const endedAt = new Date();
      chunk.endedAt = endedAt.toISOString();
      chunk.endOffsetMs = endedAt.getTime() - capture.startedAtDate.getTime();

      try {
        chunk.bytes = finalizeWav(outPath);
      } catch {
        chunk.bytes = 0;
      }

      if (err && !subscription.rollover && !subscription.stopping) {
        chunk.status = "error";
        chunk.error = err.message;
        console.error("Audio stream error for a speaker.");
      } else {
        chunk.status = chunk.bytes > 0 ? "finished" : "empty";
      }

      saveManifestBestEffort(capture, "closing a speaker");

      if (subscription.rollover && active === capture && !capture.stopping) {
        setImmediate(() => startSpeakerChunk(capture, userId, "rollover"));
      }
    } finally {
      subscription.resolveDone();
    }
  });
}

async function startCapture(sessionId, reply, message, options = {}) {
  if (active) {
    await reply(`A scribe session is already active. Use \`${commandPrefix} stop\` first.`);
    return null;
  }

  const cleanId = cleanSessionId(sessionId);
  const captureRoot = options.sessionRoot || sessionRoot;
  const outDir = sessionDir(cleanId, captureRoot);
  const directTarget = options.guild && options.channel;
  const { guild, channel, connection } = directTarget
    ? { guild: options.guild, channel: options.channel, connection: await joinVoice(options.guild, options.channel) }
    : await joinVoiceForMessage(message);
  try {
    ensureDir(outDir);
  } catch (err) {
    if (sharedVoiceSession) sharedVoiceSession.release("scribe");
    else connection.destroy();
    throw err;
  }
  const receiver = connection.receiver;
  const startedAtDate = new Date();
  const subscriptions = new Map();

  const capture = {
    sessionId: cleanId,
    outDir,
    guild,
    channel,
    connection,
    receiver,
    pcmReceiver: sharedVoiceSession,
    subscriptions,
    startedAtDate,
    autoRecord: options.autoRecord === true,
    requireConsent: options.requireConsent === true || options.autoRecord === true,
    isUserConsented: options.isUserConsented || null,
    onConsentViolation: options.onConsentViolation || null,
    manifest: {
      schemaVersion: 1,
      sessionId: cleanId,
      campaignSessionDir: relativeToWorkspace(path.join(captureRoot, cleanId)),
      audioDir: relativeToWorkspace(outDir),
      manifestPath: relativeToWorkspace(path.join(outDir, "capture_manifest.json")),
      captureMode: options.autoRecord === true
        ? "automatic-persistent-consent"
        : options.requireConsent === true
          ? "manual-persistent-consent"
          : "manual",
      status: "recording",
      startedAt: startedAtDate.toISOString(),
      stoppedAt: null,
      durationMs: null,
      guildId: guild.id,
      guildName: guild.name || null,
      voiceChannelId: channel.id,
      voiceChannelName: channel.name || null,
      textChannelId: options.textChannelId || textChannelId || null,
      commandPrefix,
      silenceMs,
      maxChunkSeconds,
      speakers: {},
      chunks: []
    }
  };

  try {
    saveManifest(capture);
  } catch (err) {
    if (sharedVoiceSession) sharedVoiceSession.release("scribe");
    else connection.destroy();
    throw err;
  }
  active = capture;

  receiver.speaking.on("start", (userId) => {
    if (active !== capture) return;
    try {
      startSpeakerChunk(capture, userId);
    } catch {
      console.error("Could not start an audio chunk.");
      if (capture.autoRecord) capture.onConsentViolation?.();
    }
  });

  await reply(
    options.autoRecord === true
      ? `Automatic scribe capture is active for Sigil Session ${capture.sessionId}.`
      : `Session scribe started for ${capture.sessionId} in ${channel.name}. Writing Discord voice chunks and manifest to ${outDir}`
  );
  return capture;
}

async function stopCapture(reply, { reason = "manual" } = {}) {
  if (!active) {
    await reply("No scribe session is active.");
    return null;
  }

  const ended = active;
  const operationalIssues = [];
  ended.stopping = true;
  ended.manifest.status = "stopping";
  try {
    saveManifest(ended);
  } catch {
    operationalIssues.push("stopping manifest write failed");
  }

  try {
    await drainSubscriptions(ended);
  } catch {
    operationalIssues.push("audio pipeline drain failed");
  }

  try {
    if (sharedVoiceSession) sharedVoiceSession.release("scribe");
    else ended.connection.destroy();
  } catch {
    operationalIssues.push("voice connection release failed");
  }
  ended.manifest.status = "stopped";
  ended.manifest.stoppedAt = nowIso();
  ended.manifest.durationMs = new Date(ended.manifest.stoppedAt).getTime() - ended.startedAtDate.getTime();
  try {
    saveManifest(ended);
  } catch {
    operationalIssues.push("final manifest write failed");
  }
  active = null;

  const closure = verifyManifestClosure(ended.outDir, fs, ended.sessionId);
  if (operationalIssues.length) {
    closure.passed = false;
    closure.issues.push(...operationalIssues);
  }
  if (ended.autoRecord || (ended.requireConsent && reason !== "manual")) {
    await reply(formatClosureSummary(ended.sessionId, reason, closure));
  } else {
    await reply(`Session scribe stopped for ${ended.sessionId}. Closure ${closure.passed ? "PASS" : "FAIL"}. Run \`npm run transcribe -- ${ended.sessionId}\` to write raw_transcript.md.`);
  }
  return { capture: ended, closure };
}

function summarizeStatus() {
  if (!active) return "No scribe session is active.";
  const chunkCount = active.manifest.chunks.length;
  const speakerCount = Object.keys(active.manifest.speakers).length;
  const summary = [
    `Active session ${active.sessionId}.`,
    `Speakers seen: ${speakerCount}.`,
    `Chunks: ${chunkCount}.`
  ];
  if (!active.autoRecord) summary.push(`Output: ${active.outDir}`);
  return summary.join(" ");
}

async function runTranscribe(sessionId, reply) {
  const cleanId = cleanSessionId(sessionId);
  await reply(`Starting local transcript merge for session ${cleanId}. This may take a while.`);

  const child = spawn(process.execPath, [path.join(__dirname, "transcribe.js"), cleanId], {
    cwd: __dirname,
    env: process.env,
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });
  child.on("close", async (code) => {
    const output = stdout.trim().split(/\r?\n/).slice(-3).join("\n");
    const error = stderr.trim().split(/\r?\n/).slice(-3).join("\n");
    if (code === 0) {
      await reply(`Transcript merge finished for session ${cleanId}.\n${output}`.trim());
    } else {
      await reply(`Transcript merge failed for session ${cleanId} with exit code ${code}.\n${error || output}`.trim());
    }
  });
}

function recordingTarget() {
  return autoRecordConfig || runtimeTargetConfig;
}

async function sendTargetNotice(text) {
  const target = recordingTarget();
  if (!target) return;
  const channel = await client.channels.fetch(target.noticeTextChannelId);
  if (!channel?.isSendable?.()) throw new Error("The configured recording notice room is unavailable.");
  await channel.send(text);
}

async function stopForConsent() {
  if (!active?.requireConsent || active.stopping) return;
  try {
    await stopCapture(sendTargetNotice, { reason: "consent" });
  } catch {
    console.error("The consent-triggered stop failed closed.");
  }
}

async function startTargetedManualCapture(sessionId, reply, message) {
  const target = runtimeTargetConfig;
  if (!target || !consentStore) throw new Error("The Sigil recording target or consent ledger is unavailable.");
  if (message.author.id !== target.ownerMemberId) {
    await reply("Only the configured DM can start or stop the targeted session scribe.");
    return null;
  }
  const guild = await client.guilds.fetch(target.guildId);
  const channel = await guild.channels.fetch(target.voiceChannelId);
  if (!channel?.isVoiceBased?.()) throw new Error("The configured Sigil voice room is unavailable.");
  const humans = [...channel.members.values()].filter((member) => member?.user?.bot !== true);
  if (!humans.some((member) => member.id === target.ownerMemberId)) {
    await reply("Join the configured Sigil voice room before starting the scribe.");
    return null;
  }
  if (humans.some((member) => !consentStore.has(member.id))) {
    await reply(AUTO_RECORD_BLOCKED);
    return null;
  }

  await reply(AUTO_RECORD_NOTICE);
  return startCapture(sessionId, reply, message, {
    guild,
    channel,
    sessionRoot: target.sessionRoot,
    textChannelId: target.noticeTextChannelId,
    requireConsent: true,
    isUserConsented: (memberId) => consentStore.has(memberId),
    onConsentViolation: stopForConsent
  });
}

async function handleScribeMessage(message) {
  if (message.author.bot) return;
  if (!message.content.startsWith(commandPrefix)) return;

  const parts = message.content.trim().split(/\s+/);
  const command = parts[1];
  const sessionId = parts[2]
    || (runtimeTargetConfig
      ? findNextSessionId(runtimeTargetConfig.sessionRoot, runtimeTargetConfig.seedManifest)
      : "000");
  const reply = (text) => message.reply(text);

  if (command === "consent" || command === "revoke") {
    const target = recordingTarget();
    if (!target
        || !consentStore
        || message.guildId !== target.guildId
        || message.channelId !== target.noticeTextChannelId) {
      await reply("Persistent recording consent is unavailable in this channel.");
      return;
    }

    const allowed = command === "consent";
    try {
      consentStore.set(message.author.id, allowed);
      if (autoRecordController) await autoRecordController.handleConsentChange(message.author.id, allowed);
      else if (!allowed && active?.requireConsent) await stopForConsent();
      await reply(allowed
        ? "Your persistent recording consent is active. You may revoke it here at any time with `!scribe revoke`."
        : "Your recording consent is revoked. Any active capture involving you has been stopped.");
    } catch {
      if (!allowed && autoRecordController) await autoRecordController.handleConsentChange(message.author.id, false);
      else if (!allowed && active?.requireConsent) await stopForConsent();
      await reply("The consent update failed closed. Recording will not proceed until the local ledger is repaired.");
    }
    return;
  }

  if (textChannelId && message.channelId !== textChannelId) return;

  try {
    if (command === "start") {
      if (autoRecordConfig) {
        if (!autoRecordController) {
          await reply("Automatic recording is configured but not armed; the start request failed closed.");
        } else {
          await autoRecordController.reconcile();
          await reply(active
            ? summarizeStatus()
            : "No capture started; the approved room and consent gates remain in force.");
        }
      } else if (runtimeTargetConfig) {
        await startTargetedManualCapture(sessionId, reply, message);
      } else {
        await startCapture(sessionId, reply, message);
      }
    } else if (command === "stop") {
      if (runtimeTargetConfig && message.author.id !== runtimeTargetConfig.ownerMemberId) {
        await reply("Only the configured DM can start or stop the targeted session scribe.");
        return;
      }
      await stopCapture(reply);
    } else if (command === "status") {
      await reply(summarizeStatus());
    } else if (command === "transcribe") {
      await runTranscribe(sessionId, reply);
    } else {
      await reply(
        `Use \`${commandPrefix} start 003\`, \`${commandPrefix} stop\`, \`${commandPrefix} status\`, \`${commandPrefix} transcribe 003\`, \`${commandPrefix} consent\`, or \`${commandPrefix} revoke\`.`
      );
    }
  } catch {
    console.error("A scribe command failed closed.");
    await reply("Scribe error: capture failed closed. Check the local console before trying again.");
  }
}

async function initializeAutoRecording() {
  if (!autoRecordConfig || !consentStore) return;
  let noticeChannel = null;
  try {
    const guild = await client.guilds.fetch(autoRecordConfig.guildId);
    noticeChannel = await guild.channels.fetch(autoRecordConfig.noticeTextChannelId);
    const voiceChannel = await guild.channels.fetch(autoRecordConfig.voiceChannelId);
    if (noticeChannel?.type !== DiscordChannelType.GuildText || !noticeChannel.isSendable?.()) {
      throw new Error("notice channel is not a guild text channel");
    }
    if (voiceChannel?.type !== DiscordChannelType.GuildVoice || !voiceChannel.isVoiceBased?.()) {
      throw new Error("target channel is not a guild voice channel");
    }

    const sendNotice = (text) => noticeChannel.send(text);
    const getRoomSnapshot = async () => {
      const current = await guild.channels.fetch(autoRecordConfig.voiceChannelId);
      if (current?.type !== DiscordChannelType.GuildVoice || !current.isVoiceBased?.()) {
        throw new Error("target voice channel is unavailable");
      }
      return { members: current.members.values() };
    };

    autoRecordController = createAutoRecordController({
      config: autoRecordConfig,
      getRoomSnapshot,
      getActiveCapture: () => active,
      isConsented: (memberId) => consentStore.has(memberId),
      findNextSession: () => findNextSessionId(autoRecordConfig.sessionRoot, autoRecordConfig.seedManifest),
      startCapture: (sessionId) => startCapture(sessionId, async () => {}, null, {
        guild,
        channel: voiceChannel,
        sessionRoot: autoRecordConfig.sessionRoot,
        textChannelId: autoRecordConfig.noticeTextChannelId,
        autoRecord: true,
        isUserConsented: (memberId) => consentStore.has(memberId),
        onConsentViolation: () => autoRecordController?.handleUnconsentedSpeaker()
      }),
      stopCapture: (reason) => stopCapture(sendNotice, { reason }),
      sendNotice
    });

    console.log("Automatic Sigil recording is armed for its one configured target.");
    await autoRecordController.reconcile();
  } catch {
    autoRecordController = null;
    console.error("Automatic recording initialization failed closed.");
    if (noticeChannel?.isSendable?.()) {
      try {
        await noticeChannel.send(AUTO_RECORD_FAILURE);
      } catch {
        // Local console and manifest evidence remain available.
      }
    }
  }
}

async function initializeBardsong() {
  if (process.env.BARDSONG_ENABLED !== "1") return;
  if (!runtimeTargetConfig || !sharedVoiceSession) {
    throw new Error("Bardsong requires one valid ignored Sigil target configuration.");
  }
  const bardsongRoot = path.resolve(
    process.env.BARDSONG_APP_ROOT
      || path.join(workspaceRoot, "..", "campaign-soundpack", "bardsong")
  );
  const serverModulePath = path.join(bardsongRoot, "server.js");
  const managerModulePath = path.join(bardsongRoot, "lib", "familiar-discord-manager.js");
  if (!fs.existsSync(serverModulePath) || !fs.existsSync(managerModulePath)) {
    throw new Error("The Bardsong project is unavailable beside Familiar.");
  }
  const targetGuild = await client.guilds.fetch(runtimeTargetConfig.guildId);
  const targetChannel = await targetGuild.channels.fetch(runtimeTargetConfig.voiceChannelId);
  if (!targetChannel?.isVoiceBased?.()) {
    throw new Error("The saved Bardsong target is not an available voice channel.");
  }
  const [{ createBardsongServer }, { FamiliarDiscordManager }] = await Promise.all([
    import(pathToFileURL(serverModulePath).href),
    import(pathToFileURL(managerModulePath).href)
  ]);
  const voiceApi = require("@discordjs/voice");
  const port = positiveInt(process.env.BARDSONG_PORT, 4317);
  if (port > 65_535) throw new Error("The Bardsong port is invalid.");
  bardsongServer = await createBardsongServer({
    appRoot: bardsongRoot,
    repoRoot: path.resolve(bardsongRoot, ".."),
    discordFactory: ({ appRoot, store, director }) => {
      bardsongDiscord = new FamiliarDiscordManager({
        appRoot,
        store,
        director,
        client,
        voice: {
          EndBehaviorType,
          VoiceConnectionStatus,
          NoSubscriberBehavior: voiceApi.NoSubscriberBehavior,
          StreamType: voiceApi.StreamType,
          createAudioPlayer: voiceApi.createAudioPlayer,
          createAudioResource: voiceApi.createAudioResource
        },
        voiceSession: sharedVoiceSession,
        target: {
          guildId: runtimeTargetConfig.guildId,
          voiceChannelId: runtimeTargetConfig.voiceChannelId,
          dmUserId: runtimeTargetConfig.ownerMemberId
        },
        getScribeStatus: () => ({
          active: Boolean(active),
          sessionId: active?.sessionId ?? null
        })
      });
      return bardsongDiscord;
    },
    onShutdown: shutdown
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    bardsongServer.once("error", onError);
    bardsongServer.listen(port, "127.0.0.1", () => {
      bardsongServer.off("error", onError);
      resolve();
    });
  });
  console.log(`Bardsong control room is ready at http://127.0.0.1:${port}`);
}

function handleTargetVoiceState(oldState, newState) {
  if (!active?.requireConsent || active.stopping || !runtimeTargetConfig || !consentStore) return;
  const targetEntry = newState?.guild?.id === runtimeTargetConfig.guildId
    && newState.channelId === runtimeTargetConfig.voiceChannelId
    && oldState?.channelId !== runtimeTargetConfig.voiceChannelId;
  if (!targetEntry || newState.member?.user?.bot === true) return;
  if (!consentStore.has(newState.id || newState.member?.id)) stopForConsent();
}

function createBotMessageHandler({
  commandPrefix: routedPrefix,
  scribeHandler,
  playerHelpTransport = null,
  reportPlayerHelpFailure = (message) => console.error(message)
} = {}) {
  if (typeof routedPrefix !== "string" || !routedPrefix) throw new TypeError("A command prefix is required.");
  if (typeof scribeHandler !== "function") throw new TypeError("A scribe handler is required.");
  if (playerHelpTransport !== null && typeof playerHelpTransport !== "function") throw new TypeError("The player-help transport must be a function.");
  if (typeof reportPlayerHelpFailure !== "function") throw new TypeError("The player-help failure reporter must be a function.");

  return async function handleDiscordMessage(message) {
    if (String(message?.content || "").startsWith(routedPrefix)) return scribeHandler(message);
    if (!playerHelpTransport) return null;
    try {
      return await playerHelpTransport(message);
    } catch {
      reportPlayerHelpFailure("Familiar player help failed; no reply was sent.");
      return null;
    }
  };
}

async function shutdown() {
  if (!shuttingDown) {
    shuttingDown = (async () => {
      autoRecordController?.cancel();
      if (active) {
        try {
          await stopCapture((text) => {
            console.log(text);
            return Promise.resolve();
          }, { reason: "shutdown" });
        } catch {
          console.error("The local shutdown path failed closed.");
        }
      }
      try {
        await bardsongDiscord?.disconnect();
      } catch {
        console.error("Bardsong audio did not close cleanly.");
      }
      if (bardsongServer?.listening) {
        await new Promise((resolve) => bardsongServer.close(resolve));
      }
      sharedVoiceSession?.destroy();
      const connection = getVoiceConnection?.(guildId);
      if (connection) connection.destroy();
      client?.destroy();
      releaseRuntimeLock(runtimeLock);
    })();
  }
  await shuttingDown;
  process.exit(0);
}

function startBot() {
  try {
    runtimeLock = acquireRuntimeLock();
    process.once("exit", () => releaseRuntimeLock(runtimeLock));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  require("dotenv").config({ path: path.join(__dirname, ".env") });

  const token = process.env.DISCORD_BOT_TOKEN;
  guildId = process.env.GUILD_ID;
  voiceChannelId = process.env.VOICE_CHANNEL_ID;
  textChannelId = process.env.TEXT_CHANNEL_ID;
  commandPrefix = process.env.COMMAND_PREFIX || "!scribe";
  silenceMs = positiveInt(process.env.SILENCE_MS, 1500);
  maxChunkSeconds = positiveInt(process.env.MAX_CHUNK_SECONDS, 300);
  sessionRoot = resolveFromWorkspace(
    process.env.SESSION_ROOT || "campaigns/thrones-of-the-djinni-lords/sessions"
  );
  try {
    ({ autoRecordConfig, runtimeTargetConfig } = loadRuntimeTargets({
      autoRecordFilename: process.env.AUTO_RECORD_CONFIG,
      bardsongTargetFilename: process.env.BARDSONG_TARGET_CONFIG,
      manualRecordingOnly: process.env.BARDSONG_MANUAL_RECORDING_ONLY === "1",
      root: workspaceRoot
    }));
    if (autoRecordConfig && autoRecordConfig.guildId !== guildId) {
      throw new Error("Automatic recording guild does not match the bot guild.");
    }
    if (runtimeTargetConfig && runtimeTargetConfig.guildId !== guildId) {
      throw new Error("Bardsong target guild does not match the bot guild.");
    }
    const consentTarget = autoRecordConfig || runtimeTargetConfig;
    consentStore = consentTarget
      ? createConsentStore(consentTarget.consentLedger, consentTarget.seedManifest)
      : null;
  } catch {
    autoRecordConfig = null;
    runtimeTargetConfig = null;
    consentStore = null;
    console.error("The local recording/Bardsong target or consent ledger is invalid.");
  }
  if (runtimeTargetConfig) {
    textChannelId = runtimeTargetConfig.noticeTextChannelId;
    voiceChannelId = runtimeTargetConfig.voiceChannelId;
  } else if (!textChannelId && autoRecordConfig) {
    textChannelId = autoRecordConfig.noticeTextChannelId;
  }

  if (!token || !guildId || (process.env.BARDSONG_ENABLED === "1" && !runtimeTargetConfig)) {
    console.error("Missing DISCORD_BOT_TOKEN or GUILD_ID in .env.");
    process.exit(1);
  }

  const { Client, GatewayIntentBits, Partials, ChannelType } = require("discord.js");
  DiscordChannelType = ChannelType;
  prism = require("prism-media");
  ({
    EndBehaviorType,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection,
    joinVoiceChannel
  } = require("@discordjs/voice"));

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel]
  });

  const sharedTarget = runtimeTargetConfig || autoRecordConfig;
  if (sharedTarget) {
    sharedVoiceSession = new SharedVoiceSession({
      voice: require("@discordjs/voice"),
      prism,
      target: sharedTarget,
      silenceMs
    });
    sharedVoiceSession.on("lost", () => {
      if (active && !active.stopping) {
        stopCapture(
          active.requireConsent ? sendTargetNotice : (text) => Promise.resolve(console.log(text)),
          { reason: "failure" }
        ).catch(() => console.error("The scribe failed closed after losing voice."));
      }
    });
  }

  client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(
      `Commands: ${commandPrefix} start 003, ${commandPrefix} stop, ${commandPrefix} status, ${commandPrefix} transcribe 003, ${commandPrefix} consent, ${commandPrefix} revoke`
    );
    await initializeAutoRecording();
    try {
      await initializeBardsong();
    } catch {
      console.error("Bardsong initialization failed closed.");
      if (process.env.BARDSONG_ENABLED === "1") await shutdown();
    }
  });

  client.on("messageCreate", createBotMessageHandler({
    commandPrefix,
    scribeHandler: handleScribeMessage,
    // Live player help remains inactive until a separately approved runtime composition supplies this transport.
    playerHelpTransport: null
  }));
  client.on("voiceStateUpdate", (oldState, newState) => {
    if (autoRecordController) autoRecordController.handleVoiceStateUpdate(oldState, newState);
    handleTargetVoiceState(oldState, newState);
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  client.login(token);
}

if (require.main === module) startBot();

module.exports = {
  createBotMessageHandler,
  __test: {
    saveManifest,
    beginSubscription,
    drainSubscriptions,
    loadAutoRecordConfig,
    loadRuntimeTargets,
    findNextSessionId,
    createConsentStore,
    maySubscribe,
    createAutoRecordController,
    verifyManifestClosure,
    acquireRuntimeLock,
    releaseRuntimeLock,
    formatClosureSummary
  }
};
