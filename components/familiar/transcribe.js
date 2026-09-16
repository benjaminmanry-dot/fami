const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch (err) {
  if (err.code !== "MODULE_NOT_FOUND") throw err;
}

const workspaceRoot = __dirname;
const helperPath = path.resolve(__dirname, "scripts", "transcribe_audio_local.py");

function printHelp() {
  console.log(`Discord Session Scribe local transcript merger

Usage:
  npm run transcribe -- 003
  node transcribe.js 003 --engine faster-whisper --model small

Options:
  --engine <auto|faster-whisper|whisper>  Local transcription engine. Default: auto
  --model <name>                         Local Whisper model. Default: small
  --language <code>                      Language code, or empty for autodetect. Default: en
  --python <command>                     Python command. Default: python
  --session-root <path>                  Folder containing numbered session folders
  --out <path>                           Output raw_transcript.md path
  --merge-only                           Merge existing chunk transcript files without transcribing
  --force                                Re-transcribe chunks even if transcript fragments exist
  --help                                 Show this help

The script never calls OpenAI APIs. It invokes scripts/transcribe_audio_local.py, which uses
locally installed faster-whisper or whisper packages when available.`);
}

function parseArgs(argv) {
  const options = {
    engine: process.env.WHISPER_ENGINE || "auto",
    model: process.env.WHISPER_MODEL || "small",
    language: process.env.WHISPER_LANGUAGE ?? "en",
    python: process.env.PYTHON_BIN || "python",
    sessionRoot: process.env.SESSION_ROOT || "campaigns/thrones-of-the-djinni-lords/sessions",
    out: null,
    mergeOnly: false,
    force: false,
    help: false,
    positional: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      options.positional.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[i + 1];

    if (rawName === "help") {
      options.help = true;
    } else if (rawName === "merge-only") {
      options.mergeOnly = true;
    } else if (rawName === "force") {
      options.force = true;
    } else if (["engine", "model", "language", "python", "session-root", "out"].includes(rawName)) {
      if (inlineValue === undefined) i += 1;
      if (rawName === "session-root") options.sessionRoot = value;
      else options[rawName] = value;
    } else {
      throw new Error(`Unknown option: --${rawName}`);
    }
  }

  return options;
}

function resolveFromWorkspace(value) {
  if (!value) return workspaceRoot;
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function cleanSessionId(sessionId) {
  const raw = String(sessionId || "000").trim();
  return /^\d+$/.test(raw) ? raw.padStart(3, "0") : raw;
}

function toDisplayPath(target) {
  return path.relative(workspaceRoot, target).replace(/\\/g, "/");
}

function parseTimestamp(value) {
  const match = String(value).trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function formatTimestamp(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function readJson(jsonPath) {
  return JSON.parse(fs.readFileSync(jsonPath, "utf8").replace(/^\uFEFF/, ""));
}

function loadManifest(audioDir, sessionId) {
  const manifestPath = path.join(audioDir, "capture_manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = readJson(manifestPath);
    manifest.manifestPath = manifest.manifestPath || toDisplayPath(manifestPath);
    return manifest;
  }

  const files = fs.existsSync(audioDir)
    ? fs.readdirSync(audioDir).filter((name) => /\.(ogg|wav)$/i.test(name)).sort()
    : [];

  return {
    schemaVersion: 1,
    sessionId,
    status: "manifest-missing",
    startedAt: null,
    stoppedAt: null,
    audioDir: toDisplayPath(audioDir),
    manifestPath: toDisplayPath(manifestPath),
    speakers: {},
    chunks: files.map((filename, index) => ({
      id: path.basename(filename, ".ogg"),
      userId: filename.replace(/\.ogg$/i, "").split("-").pop(),
      filename,
      relativePath: toDisplayPath(path.join(audioDir, filename)),
      startedAt: null,
      startOffsetMs: index * 1000,
      endedAt: null,
      endOffsetMs: null,
      status: "finished"
    }))
  };
}

function resolveChunkPath(audioDir, chunk) {
  const rawPath = chunk.absolutePath || chunk.path || chunk.relativePath || chunk.filename;
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return rawPath;

  const fromWorkspace = path.resolve(workspaceRoot, rawPath);
  if (fs.existsSync(fromWorkspace)) return fromWorkspace;

  return path.resolve(audioDir, rawPath);
}

function safeStem(filename) {
  return path
    .basename(filename, path.extname(filename))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 160);
}

function speakerForChunk(manifest, chunk) {
  const userId = chunk.userId || "unknown";
  const speaker = manifest.speakers?.[userId] || {};
  return {
    userId,
    label: chunk.displayName || speaker.displayName || speaker.username || `Discord user ${userId}`,
    username: chunk.username || speaker.username || null
  };
}

function transcribeChunk(options, audioPath, transcriptPath) {
  const args = [
    helperPath,
    audioPath,
    "--out",
    transcriptPath,
    "--engine",
    options.engine,
    "--model",
    options.model,
    "--language",
    options.language ?? ""
  ];

  return spawnSync(options.python, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true
  });
}

function parseTranscriptMarkdown(markdown, chunkStartSeconds) {
  const segments = [];
  let inTranscript = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^##\s+Transcript/i.test(line)) {
      inTranscript = true;
      continue;
    }
    if (!inTranscript || !line) continue;

    const match = line.match(/^\[(\d+:\d{2}:\d{2})\s+-\s+(\d+:\d{2}:\d{2})\]\s*(.+)$/);
    if (!match) continue;

    segments.push({
      startSeconds: chunkStartSeconds + parseTimestamp(match[1]),
      endSeconds: chunkStartSeconds + parseTimestamp(match[2]),
      text: match[3].trim()
    });
  }

  return segments;
}

function buildRawTranscript({ manifest, sessionId, audioDir, manifestPath, outPath, options, segments, errors, skipped }) {
  const speakerEntries = Object.entries(manifest.speakers || {}).sort(([left], [right]) => left.localeCompare(right));
  const speakerLines = speakerEntries.length
    ? speakerEntries.map(([userId, speaker]) => {
        const label = speaker.displayName || speaker.username || `Discord user ${userId}`;
        const username = speaker.username ? ` (${speaker.username})` : "";
        return `- ${label}${username}: Discord user \`${userId}\``;
      })
    : ["- Speaker names unavailable; Discord user IDs are used in transcript lines."];

  const lines = [
    `# Raw Transcript: Discord Session ${sessionId}`,
    "",
    "- Source: Discord voice channel capture",
    `- Audio folder: \`${toDisplayPath(audioDir)}\``,
    `- Capture manifest: \`${toDisplayPath(manifestPath)}\``,
    `- Transcription helper: \`${toDisplayPath(helperPath)}\``,
    `- Local transcription engine: \`${options.engine}\``,
    `- Local transcription model: \`${options.model}\``,
    `- Review status: unreviewed`,
    "- Consent: verify all players consented before recording/transcribing.",
    "",
    "## Speaker Map",
    "",
    ...speakerLines,
    ""
  ];

  if (errors.length || skipped.length) {
    lines.push("## Transcription Notes", "");
    for (const item of skipped) lines.push(`- Skipped ${item.filename}: ${item.reason}`);
    for (const item of errors) lines.push(`- Failed ${item.filename}: ${item.reason}`);
    lines.push("");
  }

  lines.push("## Transcript", "");

  if (!segments.length) {
    lines.push("_No transcript segments were produced. Install a local transcription engine or add chunk transcript files, then rerun the merger._");
  } else {
    for (const segment of segments) {
      lines.push(`[${formatTimestamp(segment.startSeconds)}] ${segment.speaker}: ${segment.text}`.trim());
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${lines.join("\n").trim()}\n`, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }

  if (!fs.existsSync(helperPath)) {
    throw new Error(`Local transcription helper not found: ${helperPath}`);
  }

  const sessionId = cleanSessionId(options.positional[0] || process.env.SESSION_ID || "000");
  const sessionRoot = resolveFromWorkspace(options.sessionRoot);
  const sessionDir = path.join(sessionRoot, sessionId);
  const audioDir = path.join(sessionDir, "audio", "discord");
  const manifestPath = path.join(audioDir, "capture_manifest.json");
  const manifest = loadManifest(audioDir, sessionId);
  const transcriptDir = path.join(audioDir, "chunk_transcripts");
  const outPath = options.out ? resolveFromWorkspace(options.out) : path.join(sessionDir, "raw_transcript.md");
  const segments = [];
  const errors = [];
  const skipped = [];
  const chunks = (manifest.chunks || []).slice().sort((left, right) => {
    return Number(left.startOffsetMs || 0) - Number(right.startOffsetMs || 0);
  });

  if (!chunks.length) {
    throw new Error(`No Discord audio chunks found in ${audioDir}`);
  }

  fs.mkdirSync(transcriptDir, { recursive: true });

  for (const chunk of chunks) {
    const audioPath = resolveChunkPath(audioDir, chunk);
    const filename = chunk.filename || (audioPath ? path.basename(audioPath) : chunk.id || "unknown");
    const status = chunk.status || "unknown";

    if (!audioPath || !fs.existsSync(audioPath)) {
      errors.push({ filename, reason: "audio file is missing" });
      continue;
    }

    const size = fs.statSync(audioPath).size;
    if (status === "empty" || size === 0) {
      skipped.push({ filename, reason: "empty audio chunk" });
      continue;
    }

    const transcriptPath = path.join(transcriptDir, `${safeStem(filename)}.md`);
    if (!options.mergeOnly && (options.force || !fs.existsSync(transcriptPath))) {
      const result = transcribeChunk(options, audioPath, transcriptPath);
      if (result.status !== 0) {
        const reason = (result.stderr || result.stdout || `exit code ${result.status}`).trim();
        errors.push({ filename, reason });
        continue;
      }
    }

    if (!fs.existsSync(transcriptPath)) {
      errors.push({ filename, reason: "chunk transcript file is missing" });
      continue;
    }

    const speaker = speakerForChunk(manifest, chunk);
    const chunkStartSeconds = Number(chunk.startOffsetMs || 0) / 1000;
    const chunkSegments = parseTranscriptMarkdown(fs.readFileSync(transcriptPath, "utf8"), chunkStartSeconds);

    if (!chunkSegments.length) {
      skipped.push({ filename, reason: "no speech segments found after transcription" });
      continue;
    }

    for (const segment of chunkSegments) {
      segments.push({
        ...segment,
        speaker: speaker.label,
        userId: speaker.userId,
        sourceFile: filename
      });
    }
  }

  segments.sort((left, right) => {
    if (left.startSeconds !== right.startSeconds) return left.startSeconds - right.startSeconds;
    return left.speaker.localeCompare(right.speaker);
  });

  buildRawTranscript({
    manifest,
    sessionId,
    audioDir,
    manifestPath,
    outPath,
    options,
    segments,
    errors,
    skipped
  });

  console.log(`Wrote ${outPath}`);
  console.log(`Merged ${segments.length} transcript segment(s) from ${chunks.length} audio chunk(s).`);
  if (errors.length) {
    console.error(`${errors.length} chunk(s) failed. See Transcription Notes in ${outPath}.`);
  }

  return segments.length === 0 && errors.length ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
