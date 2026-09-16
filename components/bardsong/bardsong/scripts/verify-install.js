import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asrStatus } from '../lib/asr.js';
import { LibraryStore } from '../lib/library.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..');
const store = new LibraryStore({ appRoot, repoRoot });
await store.load();

const checks = [];
for (const track of store.getSettings().tracks) {
  try {
    const stat = await fs.stat(store.resolveTrackPath(track));
    checks.push({ track: track.name, status: stat.size > 0 ? 'found' : 'empty' });
  } catch {
    checks.push({ track: track.name, status: 'missing' });
  }
}

console.log(JSON.stringify({
  node: process.version,
  asr: await asrStatus(),
  tracks: checks
}, null, 2));
