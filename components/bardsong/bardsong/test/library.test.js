import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseTrack, createDefaultSettings, LibraryStore, safeImportName } from '../lib/library.js';

test('defaults include only approved music in automatic rotation', () => {
  const settings = createDefaultSettings();
  assert.equal(chooseTrack(settings, 'travel', 'music').id, 'wandering-vale-loop');
  assert.equal(chooseTrack(settings, 'combat', 'music'), null);
  assert.ok(settings.tracks.every((track) => !track.id.includes('recipe-lock')));
  assert.ok(settings.tracks.filter((track) => track.kind === 'music' && track.id !== 'wandering-vale-loop').every((track) => track.status === 'unreviewed' && track.scenes.length === 0));
});

test('selection is stable for a scene and respects rejected status', () => {
  const settings = createDefaultSettings();
  const first = chooseTrack(settings, 'travel', 'ambience');
  const second = chooseTrack(settings, 'travel', 'ambience');
  assert.equal(first.id, second.id);
  first.status = 'rejected';
  assert.notEqual(chooseTrack(settings, 'travel', 'ambience')?.id, first.id);
});

test('import names are constrained to supported audio files and a local basename', () => {
  assert.throws(() => safeImportName('not-audio.exe'), /Unsupported audio/);
  const safe = safeImportName('../../A Strange Track.ogg');
  assert.equal(path.basename(safe), safe);
  assert.match(safe, /^A Strange Track-[a-f0-9]{10}\.ogg$/);
});

test('settings persist atomically and restore cannot inject a source path', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bardsong-library-'));
  t.after(async () => {
    if (path.resolve(root).startsWith(path.resolve(os.tmpdir()))) await fs.rm(root, { recursive: true, force: true });
  });
  const appRoot = path.join(root, 'app');
  const repoRoot = path.join(root, 'repo');
  const store = new LibraryStore({ appRoot, repoRoot });
  await store.load();
  await store.updatePreferences({ musicVolume: 0.25 });
  await store.updateTrack('wandering-vale-loop', { scenes: ['travel', 'victory'] });
  await store.updateTrack('wandering-vale-loop', { status: 'accepted' });

  const reloaded = new LibraryStore({ appRoot, repoRoot });
  await reloaded.load();
  assert.equal(reloaded.getSettings().musicVolume, 0.25);
  assert.deepEqual(reloaded.trackById('wandering-vale-loop').scenes, ['travel', 'victory']);

  await reloaded.restore({
    ...reloaded.getSettings(),
    tracks: [{
      ...reloaded.trackById('wandering-vale-loop'),
      source: { type: 'project', relativePath: '../../outside.ogg' }
    }]
  });
  assert.equal(reloaded.trackById('wandering-vale-loop').source.relativePath, 'outputs/roll20-loops/wandering-vale-loop.ogg');
  const backups = await fs.readdir(path.join(appRoot, 'data', 'backups'));
  assert.ok(backups.length >= 1);
});
