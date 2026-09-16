import { insist, validateLedger } from './ledger.mjs';
import { digest } from './service.mjs';
const toBase64 = bytes => { let raw = ''; for (const b of bytes) raw += String.fromCharCode(b); return btoa(raw); };
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
async function key(base64) { const bytes = fromBase64(base64); insist(bytes.length === 32, 'Backup encryption requires the configured 256-bit recovery key'); return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function encryptBackup(data, secret) {
  insist(data?.format === '20fates-backup/1' && data.ledger?.body, 'Invalid backup'); validateLedger(data.ledger.body);
  const iv = crypto.getRandomValues(new Uint8Array(12)), plain = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('20fates-backup/1') }, await key(secret), plain);
  return { format: '20fates-encrypted-backup/1', algorithm: 'AES-256-GCM', createdAt: data.createdAt, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)), sourceDigest: await digest(data) };
}
export async function decryptBackup(envelope, secret) {
  insist(envelope?.format === '20fates-encrypted-backup/1', 'Unsupported backup format');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: new TextEncoder().encode('20fates-backup/1') }, await key(secret), fromBase64(envelope.ciphertext));
  const data = JSON.parse(new TextDecoder().decode(plain)); insist(await digest(data) === envelope.sourceDigest, 'Backup integrity check failed'); validateLedger(data.ledger.body); return data;
}
export function prepareRestore(data) {
  insist(data?.format === '20fates-backup/1' && Array.isArray(data.fences), 'Invalid recovery export'); validateLedger(data.ledger.body);
  const copy = structuredClone(data); copy.ledger.body.settings.collectionEnabled = false; copy.ledger.body.settings.recoveryHold = true; copy.ledger.body.settings.historyConfirmedAt = null;
  copy.ledger.body.settings.trackingConfirmedAt = null;
  for (const op of copy.ledger.body.operations) if (['queued', 'processing', 'pending'].includes(op.status)) { op.status = 'uncertain'; op.reason = 'Restored record: reconcile Stripe and outside payments before any new collection'; }
  for (const feed of Object.values(copy.ledger.body.feeds)) { feed.status = 'disconnected'; feed.lastSuccess = null; }
  return copy;
}
