import * as fs from 'node:fs';
import {dirname, join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const estatePath = '/mnt/c/Ambitions/hq/estate-map.md';
const recoveryPath = '/mnt/c/Ambitions/fami-runtime/.private/control-recovery';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function readControls(text) {
  const parts = text.split('## CONTROL BLOCK');
  if (parts.length !== 2) throw new Error('Missing or ambiguous control block');
  const block = parts[1].split(/\r?\n## /)[0];
  const authority = [...block.matchAll(/^- \*\*Authority: ([A-Z ]+)\*\*/gm)];
  const clock = [...block.matchAll(/^- \*\*Clock: ([A-Z]+)\*\*/gm)];
  if (authority.length !== 1 || clock.length !== 1 ||
      !['ACTIVE', 'DRAFT', 'STOOD DOWN'].includes(authority[0][1]) ||
      !['ON', 'OFF'].includes(clock[0][1])) throw new Error('Invalid or ambiguous controls');
  return {authority: authority[0][1], clock: clock[0][1]};
}

export function authenticatedCommand(ctx, command, scope) {
  // Use host-authenticated control-plane metadata, never quoted names or model output.
  return ctx.isAuthorizedSender === true && ctx.agentId === 'main' &&
    Array.isArray(ctx.gatewayClientScopes) &&
    (ctx.gatewayClientScopes.includes('operator.admin') || ctx.gatewayClientScopes.includes(scope)) &&
    ctx.commandBody?.trim().toLowerCase() === `/${command}` && !ctx.args?.trim();
}

export function statusCommand(ctx, read = fs.readFileSync) {
  if (!authenticatedCommand(ctx, 'fami-status', 'operator.read'))
    return {text: 'Fami status requires the authenticated PC control session.'};
  try {
    const state = readControls(read(estatePath, 'utf8'));
    return {text: `Fami controls: ${state.authority}; clock ${state.clock}. Supervised setup only; unattended work is not enabled.`};
  } catch {
    return {text: 'Fami controls could not be verified. No execution is permitted; return to Codex HQ.'};
  }
}

export function writeStandDown(path = estatePath, recovery = recoveryPath, io = fs) {
  // Only the fixed live path is reachable through the registered command. Arguments
  // exist for isolated tests, not plugin configuration or model-provided paths.
  if (io.realpathSync(path) !== path) throw new Error('Control path must not redirect');
  const original = io.readFileSync(path);
  const text = original.toString('utf8');
  const state = readControls(text);
  if (state.authority === 'STOOD DOWN') return {alreadyStopped: true};
  const start = text.indexOf('## CONTROL BLOCK');
  const endOffset = text.slice(start).search(/\r?\n## /);
  const end = endOffset < 0 ? text.length : start + endOffset;
  const updated = text.slice(0, start) + text.slice(start, end).replace(
    /^- \*\*Authority: (ACTIVE|DRAFT)\*\*/m, '- **Authority: STOOD DOWN**') + text.slice(end);
  if (updated === text) throw new Error('No exact authority update available');
  io.mkdirSync(recovery, {recursive: true, mode: 0o700});
  const backup = join(recovery, `${hash(original)}.md`);
  try { io.writeFileSync(backup, original, {flag: 'wx', mode: 0o600}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!io.readFileSync(backup).equals(original)) throw new Error('Recovery mismatch');
  const temporary = join(dirname(path), `.fami-stop-${randomUUID()}.tmp`);
  let fd;
  try {
    fd = io.openSync(temporary, 'wx', 0o600);
    io.writeFileSync(fd, updated, 'utf8');
    io.fsyncSync(fd);
    io.closeSync(fd); fd = undefined;
    if (io.realpathSync(path) !== path || !io.readFileSync(path).equals(original))
      throw new Error('Controls changed concurrently; no overwrite performed');
    io.renameSync(temporary, path);
    if (readControls(io.readFileSync(path, 'utf8')).authority !== 'STOOD DOWN')
      throw new Error('Stand-down write did not verify');
    return {alreadyStopped: false};
  } finally {
    if (fd !== undefined) io.closeSync(fd);
    if (io.existsSync(temporary)) io.unlinkSync(temporary);
  }
}

export function standDownCommand(ctx, write = writeStandDown) {
  if (!authenticatedCommand(ctx, 'fami-stand-down', 'operator.admin'))
    return {text: 'Stand-down requires the authenticated PC administrator session. Nothing changed.'};
  try {
    const result = write();
    return {text: `${result.alreadyStopped ? 'Fami was already stood down.' : 'Fami is now STOOD DOWN.'} New guarded work is blocked; active Hermes execution receives the stop signal. This is not confirmation that every running process has exited. Codex HQ remains the recovery surface.`};
  } catch {
    return {text: 'Stand-down could not be confirmed. Use Codex HQ immediately; do not assume work stopped.'};
  }
}
