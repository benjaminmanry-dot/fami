import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASR_MODEL = 'onnx-community/whisper-tiny.en';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelCache = path.join(appRoot, 'data', 'models');
const readyMarker = path.join(modelCache, 'ready.json');

let recognizerPromise = null;
let transcriptionTail = Promise.resolve();

async function configureTransformers({ allowDownload = false } = {}) {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = modelCache;
  env.allowRemoteModels = allowDownload;
  env.allowLocalModels = true;
  return pipeline;
}

export async function asrStatus() {
  try {
    const marker = JSON.parse(await fs.readFile(readyMarker, 'utf8'));
    return { ready: marker.model === ASR_MODEL, model: ASR_MODEL, preparedAt: marker.preparedAt ?? null };
  } catch {
    return { ready: false, model: ASR_MODEL, preparedAt: null };
  }
}

export async function prepareAsr() {
  await fs.mkdir(modelCache, { recursive: true });
  const pipeline = await configureTransformers({ allowDownload: true });
  const recognizer = await pipeline('automatic-speech-recognition', ASR_MODEL, {
    device: 'cpu',
    dtype: 'q8'
  });
  await recognizer(new Float32Array(16_000));
  await fs.writeFile(readyMarker, `${JSON.stringify({
    model: ASR_MODEL,
    preparedAt: new Date().toISOString(),
    runtime: 'Transformers.js local ONNX'
  }, null, 2)}\n`, 'utf8');
  return recognizer;
}

export async function getRecognizer() {
  if (!recognizerPromise) {
    recognizerPromise = (async () => {
      const status = await asrStatus();
      if (!status.ready) {
        throw new Error('Local speech model is not prepared. Run npm run prepare:asr once while online.');
      }
      const pipeline = await configureTransformers({ allowDownload: false });
      return pipeline('automatic-speech-recognition', ASR_MODEL, {
        device: 'cpu',
        dtype: 'q8'
      });
    })().catch((error) => {
      recognizerPromise = null;
      throw error;
    });
  }
  return recognizerPromise;
}

async function runTranscription(samples) {
  if (!(samples instanceof Float32Array)) throw new TypeError('Expected Float32Array audio');
  if (samples.length < 1_600) return '';
  if (samples.length > 16_000 * 60) throw new Error('Audio chunk is longer than 60 seconds');
  const recognizer = await getRecognizer();
  const result = await recognizer(samples, {
    chunk_length_s: 15,
    stride_length_s: 2
  });
  return String(result?.text ?? '').trim();
}

export function transcribeFloat32(samples) {
  const work = transcriptionTail.catch(() => {}).then(() => runTranscription(samples));
  transcriptionTail = work.catch(() => {});
  return work;
}
