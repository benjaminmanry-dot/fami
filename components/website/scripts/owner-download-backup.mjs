// Runs after explicit off-site backup activation. No decryption key here.
import { writeFile } from 'node:fs/promises';
const endpoint = process.env.OWNER_BACKUP_ENDPOINT, token = process.env.OWNER_BACKUP_TOKEN;
try {
  if (!endpoint || !/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/owner-api\/backup$/.test(endpoint) || !token) throw new Error('Missing backup configuration');
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { 'x-owner-backup-secret': token }, signal: AbortSignal.timeout(55000) });
  if (!response.ok) throw new Error('Backup not available');
  const data = await response.json();
  if (data.format !== '20fates-encrypted-backup/1' || data.algorithm !== 'AES-256-GCM' || !data.ciphertext || !data.sourceDigest) throw new Error('Unexpected backup');
  await writeFile('owner-ledger.encrypted.json', JSON.stringify(data), { flag: 'wx', mode: 0o600 });
  process.stdout.write('Encrypted owner backup received. No roster, payment details or key were logged.\n');
} catch { process.stderr.write('Encrypted owner backup failed; the previous recovery copies must be retained.\n'); process.exitCode = 1; }
