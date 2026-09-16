import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isScene, SCENE_IDS } from './scenes.js';

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus']);
export const TRACK_KINDS = new Set(['music', 'ambience']);
export const TRACK_STATUSES = new Set(['accepted', 'project-asset', 'unreviewed', 'rejected']);

const seedTracks = [
  {
    id: 'wandering-vale-loop',
    name: 'Wandering Vale',
    kind: 'music',
    status: 'accepted',
    scenes: ['travel', 'wonder'],
    source: { type: 'project', relativePath: 'outputs/roll20-loops/wandering-vale-loop.ogg' },
    note: 'Approved campaign loop'
  },
  {
    id: 'eq-road-of-three-pines',
    name: 'Road of Three Pines',
    kind: 'music',
    status: 'unreviewed',
    scenes: [],
    source: { type: 'project', relativePath: 'outputs/epic-quests/loops/EQ 2 - Travel (Road of Three Pines).ogg' },
    note: 'Project asset; not enabled until reviewed'
  },
  {
    id: 'eq-lich-antechamber',
    name: 'Lich Antechamber',
    kind: 'music',
    status: 'unreviewed',
    scenes: [],
    source: { type: 'project', relativePath: 'outputs/epic-quests/loops/EQ 4 - Danger (Lich Antechamber).ogg' },
    note: 'Project asset; not enabled until reviewed'
  },
  {
    id: 'eq-stewfire-rest',
    name: 'Stewfire Rest',
    kind: 'music',
    status: 'unreviewed',
    scenes: [],
    source: { type: 'project', relativePath: 'outputs/epic-quests/loops/EQ 6 - Rest (Stewfire Rest).ogg' },
    note: 'Project asset; not enabled until reviewed'
  },
  {
    id: 'drakkenheim-ashes-of-aldar',
    name: 'Ashes of Aldar',
    kind: 'music',
    status: 'unreviewed',
    scenes: [],
    source: { type: 'project', relativePath: 'outputs/drakkenheim/loops/drakkenheim-leitmotif_ashes-of-aldar_loop.ogg' },
    note: 'Project asset; not enabled until reviewed'
  },
  ...[
    ['dungeon', 'Dungeon', ['mystery', 'danger', 'combat']],
    ['fire', 'Fire', ['rest', 'social']],
    ['forest', 'Forest', ['travel', 'wonder']],
    ['rain', 'Rain', ['quiet', 'rest', 'mystery', 'sorrow']],
    ['wind', 'Wind', ['quiet', 'travel', 'danger']]
  ].map(([id, name, scenes]) => ({
    id: `ambience-${id}`,
    name: `${name} ambience`,
    kind: 'ambience',
    status: 'project-asset',
    scenes,
    source: { type: 'project', relativePath: `outputs/ambience/${id}.ogg` },
    note: 'Existing ambience bed'
  }))
];

export function createDefaultSettings() {
  return {
    version: 1,
    musicVolume: 0.58,
    ambienceVolume: 0.34,
    transitionSeconds: 3.5,
    allowUnreviewed: false,
    tracks: structuredClone(seedTracks)
  };
}

function cleanScenes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isScene))];
}

function cleanTrack(track, original = null) {
  if (!track || typeof track !== 'object') throw new Error('Invalid track');
  const source = original?.source ?? track.source;
  if (!source || !['project', 'library'].includes(source.type)) throw new Error('Invalid track source');
  if (source.type === 'library' && path.basename(source.filename ?? '') !== source.filename) {
    throw new Error('Unsafe library filename');
  }
  const kind = TRACK_KINDS.has(track.kind) ? track.kind : original?.kind ?? 'music';
  const status = TRACK_STATUSES.has(track.status) ? track.status : original?.status ?? 'unreviewed';
  return {
    id: original?.id ?? String(track.id ?? randomUUID()),
    name: String(track.name ?? original?.name ?? 'Untitled track').trim().slice(0, 120) || 'Untitled track',
    kind,
    status,
    scenes: cleanScenes(track.scenes),
    source,
    note: String(track.note ?? original?.note ?? '').trim().slice(0, 240)
  };
}

function cleanSettings(value, defaults = createDefaultSettings()) {
  const incoming = value && typeof value === 'object' ? value : {};
  const defaultById = new Map(defaults.tracks.map((track) => [track.id, track]));
  const seen = new Set();
  const tracks = [];

  for (const candidate of Array.isArray(incoming.tracks) ? incoming.tracks : []) {
    const original = defaultById.get(candidate?.id) ?? null;
    try {
      const clean = cleanTrack(candidate, original);
      if (!seen.has(clean.id)) {
        tracks.push(clean);
        seen.add(clean.id);
      }
    } catch {
      // A malformed entry is ignored; the rest of a recovery file remains usable.
    }
  }

  for (const track of defaults.tracks) {
    if (!seen.has(track.id)) tracks.push(structuredClone(track));
  }

  return {
    version: 1,
    musicVolume: clampNumber(incoming.musicVolume, defaults.musicVolume, 0, 1),
    ambienceVolume: clampNumber(incoming.ambienceVolume, defaults.ambienceVolume, 0, 1),
    transitionSeconds: clampNumber(incoming.transitionSeconds, defaults.transitionSeconds, 0.25, 12),
    allowUnreviewed: incoming.allowUnreviewed === true,
    tracks
  };
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function safeImportName(filename) {
  const decoded = String(filename ?? '').trim();
  const ext = path.extname(decoded).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) throw new Error(`Unsupported audio type: ${ext || 'none'}`);
  const stem = path.basename(decoded, ext)
    .replace(/[^a-z0-9 _.-]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'track';
  const digest = createHash('sha256').update(`${decoded}:${Date.now()}:${randomUUID()}`).digest('hex').slice(0, 10);
  return `${stem}-${digest}${ext}`;
}

export class LibraryStore {
  constructor({ appRoot, repoRoot }) {
    this.appRoot = appRoot;
    this.repoRoot = repoRoot;
    this.dataDir = path.join(appRoot, 'data');
    this.libraryDir = path.join(this.dataDir, 'library');
    this.backupDir = path.join(this.dataDir, 'backups');
    this.settingsPath = path.join(this.dataDir, 'settings.json');
    this.settings = null;
  }

  async load() {
    await fs.mkdir(this.libraryDir, { recursive: true });
    await fs.mkdir(this.backupDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      this.settings = cleanSettings(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.settings = createDefaultSettings();
    }
    await this.save({ backup: false });
    return this.settings;
  }

  getSettings() {
    if (!this.settings) throw new Error('Library has not been loaded');
    return this.settings;
  }

  async save({ backup = true } = {}) {
    if (!this.settings) throw new Error('Library has not been loaded');
    await fs.mkdir(this.dataDir, { recursive: true });
    if (backup) await this.#backupCurrent();
    const temp = `${this.settingsPath}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
    await fs.rename(temp, this.settingsPath);
  }

  async updatePreferences(patch) {
    const merged = cleanSettings({ ...this.settings, ...patch, tracks: this.settings.tracks });
    this.settings = merged;
    await this.save();
    return this.settings;
  }

  async updateTrack(id, patch) {
    const index = this.settings.tracks.findIndex((track) => track.id === id);
    if (index < 0) throw new Error('Track not found');
    const original = this.settings.tracks[index];
    const merged = { ...original };
    for (const key of ['name', 'kind', 'status', 'scenes', 'note']) {
      if (patch[key] !== undefined) merged[key] = patch[key];
    }
    this.settings.tracks[index] = cleanTrack(merged, original);
    await this.save();
    return this.settings.tracks[index];
  }

  async addImportedTrack({ filename, displayName, kind = 'music' }) {
    if (path.basename(filename) !== filename) throw new Error('Unsafe library filename');
    const ext = path.extname(filename).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) throw new Error('Unsupported audio type');
    const track = cleanTrack({
      id: `import-${randomUUID()}`,
      name: displayName || path.basename(filename, ext),
      kind,
      status: 'unreviewed',
      scenes: [],
      source: { type: 'library', filename },
      note: 'Imported locally; review and assign before automatic use'
    });
    this.settings.tracks.push(track);
    await this.save();
    return track;
  }

  async restore(snapshot) {
    const currentById = new Map(this.settings.tracks.map((track) => [track.id, track]));
    const proposed = { ...snapshot, tracks: [] };
    for (const candidate of Array.isArray(snapshot?.tracks) ? snapshot.tracks : []) {
      const current = currentById.get(candidate?.id);
      if (current) proposed.tracks.push({ ...candidate, source: current.source });
    }
    for (const track of this.settings.tracks) {
      if (!proposed.tracks.some((candidate) => candidate.id === track.id)) proposed.tracks.push(track);
    }
    this.settings = cleanSettings(proposed);
    await this.save();
    return this.settings;
  }

  resolveTrackPath(track) {
    if (!track?.source) throw new Error('Track has no source');
    let resolved;
    if (track.source.type === 'project') {
      resolved = path.resolve(this.repoRoot, track.source.relativePath);
      const relative = path.relative(this.repoRoot, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe project track path');
    } else if (track.source.type === 'library') {
      resolved = path.resolve(this.libraryDir, track.source.filename);
      const relative = path.relative(this.libraryDir, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe imported track path');
    } else {
      throw new Error('Unknown track source');
    }
    return resolved;
  }

  trackById(id) {
    return this.settings.tracks.find((track) => track.id === id) ?? null;
  }

  async #backupCurrent() {
    try {
      const contents = await fs.readFile(this.settingsPath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.writeFile(path.join(this.backupDir, `settings-${timestamp}.json`), contents);
      const entries = (await fs.readdir(this.backupDir))
        .filter((name) => /^settings-.*\.json$/.test(name))
        .sort()
        .reverse();
      await Promise.all(entries.slice(12).map((name) => fs.unlink(path.join(this.backupDir, name))));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function publicSettings(settings) {
  return {
    ...settings,
    scenes: SCENE_IDS,
    tracks: settings.tracks.map((track) => ({ ...track, source: undefined }))
  };
}

export function chooseTrack(settings, scene, kind) {
  const eligible = settings.tracks.filter((track) => {
    if (track.kind !== kind || !track.scenes.includes(scene) || track.status === 'rejected') return false;
    if (kind === 'ambience') {
      return track.status === 'project-asset' || track.status === 'accepted' || settings.allowUnreviewed;
    }
    return track.status === 'accepted' || settings.allowUnreviewed;
  });
  if (!eligible.length) return null;
  const sorted = [...eligible].sort((a, b) => a.id.localeCompare(b.id));
  const index = stableHash(`bardsong:${scene}:${kind}`) % sorted.length;
  return sorted[index];
}

function stableHash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
