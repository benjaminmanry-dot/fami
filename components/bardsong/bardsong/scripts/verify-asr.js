import { spawnSync } from 'node:child_process';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { transcribeFloat32 } from '../lib/asr.js';
import { classifyScene } from '../lib/classifier.js';

const filename = path.resolve(process.argv[2] ?? 'test/fixtures/roll-initiative.wav');
const decoded = spawnSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', filename,
  '-vn', '-f', 'f32le', '-ar', '16000', '-ac', '1', 'pipe:1'
], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });

if (decoded.status !== 0) {
  throw new Error(decoded.stderr.toString('utf8') || 'Could not decode speech fixture');
}

const bytes = decoded.stdout;
const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
const text = await transcribeFloat32(samples);
console.log(`Transcript: ${text}`);
const classification = classifyScene(text);
if (classification.scene !== 'combat' || !classification.force) {
  throw new Error('Local recognition did not preserve the decisive active-combat cue');
}
console.log(`PASS: local recognition produced an immediate ${classification.scene} cue.`);
