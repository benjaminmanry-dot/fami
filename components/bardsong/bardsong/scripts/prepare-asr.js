import { ASR_MODEL, prepareAsr } from '../lib/asr.js';

console.log(`Preparing ${ASR_MODEL} for local, offline speech recognition...`);
await prepareAsr();
console.log('Local speech model is ready. Runtime transcription will not contact a cloud service.');
