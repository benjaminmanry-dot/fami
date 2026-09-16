import * as fs from 'node:fs';
import {readFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {estatePath, readControls, statusCommand, standDownCommand} from './controls.js';
import {resultTool} from './results.js';
import {prepareImage} from './images.js';

const root = '/home/fami/.openclaw-fami/workspace';
const originals = [
  ['/mnt/c/Ambitions/ambition-agent-instructions/global/AGENTS.md', `${root}/reference/global-AGENTS.md`],
  ['/mnt/c/Ambitions/hq/AGENTS.md', `${root}/reference/hq-AGENTS.md`],
];
const safeTools = new Set(['read', 'sessions_spawn', 'fami_commit_result', 'image_generate']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function prepareDispatch(params, io=fs, assignments='/home/fami/assignments') {
  const p={...params};
  // Native optional string fields may arrive as an empty value. Only absence
  // gets a fresh assignment; never replace an explicit invalid/outside path.
  if(p.cwd==null || (typeof p.cwd==='string' && p.cwd.trim()===''))
    p.cwd=join(assignments,`pc-${randomUUID()}`);
  const cwd=resolve(p.cwd);
  if(dirname(cwd)!==assignments || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(cwd.slice(assignments.length+1)))
    throw new Error('Only one dedicated assignment directory is admitted');
  if(io.realpathSync(assignments)!==assignments) throw new Error('Assignment root redirects');
  if(p.resumeSessionId && !io.existsSync(cwd)) throw new Error('Resume requires existing assignment');
  try {io.mkdirSync(cwd,{recursive:false,mode:0o700});}
  catch(error) {if(error.code!=='EEXIST')throw error;}
  if(io.realpathSync(cwd)!==cwd || !io.statSync(cwd).isDirectory()) throw new Error('Assignment directory redirects');
  p.cwd=cwd;
  // Native hook supports complete parameter replacement. Keep this explicit key
  // to clear any prior streaming request even when hook results are merged.
  p.streamTo=undefined;
  p.expectsCompletionMessage=true;
  if(p.model==='openai/gpt-6-astra') p.model='openai-codex:gpt-6-astra';
  return p;
}

export function checkRun(ctx, read = readFileSync) {
  try {
    const state = readControls(read(estatePath, 'utf8'));
    if (state.authority !== 'ACTIVE' || state.clock !== 'ON') {
      throw new Error('HQ is not ACTIVE/ON');
    }
    for (const [source, copy] of originals) {
      if (digest(read(source)) !== digest(read(copy))) throw new Error('Governing instructions changed; refresh through Codex HQ');
    }
    if (ctx.agentId !== 'main') throw new Error('Unqualified controller identity');
    return undefined;
  } catch (error) {
    return {outcome: 'block', reason: 'fami_control_boundary', message: `Fami integration guard: ${error instanceof Error ? error.message : 'control check failed'}`};
  }
}

export function checkTool(event, ctx, read = readFileSync, prepare=prepareDispatch, imagePrepare=prepareImage) {
  try {
    const denied = checkRun(ctx, read);
    if (denied) throw new Error(denied.message);
    if (!safeTools.has(event.toolName)) throw new Error('Direct controller mutation/host execution is not qualified; delegate the bounded assignment to Hermes');
    if (event.toolName === 'sessions_spawn' && (event.params?.runtime !== 'acp' || event.params?.agentId !== 'hermes' || event.params?.mode !== 'run')) {
      throw new Error('Only bounded native Hermes ACP runs are admitted');
    }
    if(event.toolName==='sessions_spawn') return {params:prepare(event.params)};
    if(event.toolName==='image_generate') return {params:imagePrepare(event.params)};
    return undefined;
  } catch (error) {
    // Return an explicit block even if a read fails. Do not expose file contents.
    return {block: true, blockReason: `Fami integration guard: ${error instanceof Error ? error.message : 'control check failed'}`};
  }
}

export default {
  id: 'fami-controller-guard',
  name: 'Fami supervised controller guard',
  register(api) {
    api.registerTool(resultTool);
    api.on('before_tool_call', (event, ctx) => checkTool(event, ctx), {priority: 1000});
    api.on('before_agent_run', (_event, ctx) => checkRun(ctx), {priority: 1000});
    api.registerCommand({name: 'fami-status', description: 'Read the real Fami controls without a model call.',
      acceptsArgs: false, requireAuth: true, requiredScopes: ['operator.read'], handler: statusCommand});
    api.registerCommand({name: 'fami-stand-down', description: 'Persist Ben-authorized stand-down; no automatic reactivation.',
      acceptsArgs: false, requireAuth: true, requiredScopes: ['operator.admin'], handler: standDownCommand});
  },
};
