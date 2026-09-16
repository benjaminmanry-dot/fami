import * as fs from 'node:fs';
import {basename, dirname, join, resolve, sep} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {estatePath, readControls} from './controls.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const grantRoot='/home/fami/runtime-support/result-grants';
const resultRoot='/home/fami/assignments';
const projectRoot='/mnt/c/Ambitions/fami-runtime';
const authorityFiles=[
  '/mnt/c/Ambitions/ambition-agent-instructions/global/AGENTS.md',
  '/mnt/c/Ambitions/hq/AGENTS.md',
  `${projectRoot}/AGENTS.md`,
];
const digestPattern=/^[0-9a-f]{64}$/;

export function commitResult(id, paths={grantRoot,resultRoot,projectRoot,estatePath,authorityFiles}, io=fs, now=Date.now()) {
  // Host-created grants are outside controller workspace and every worker mount.
  // The model supplies an ID, never a path, approved hash, scope, or new authority.
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid commission ID');
  const grantPath=join(paths.grantRoot,`${id}.json`);
  if(io.realpathSync(grantPath)!==grantPath) throw new Error('Grant path redirects');
  const bytes=io.readFileSync(grantPath), grant=JSON.parse(bytes);
  if(grant.id!==id || grant.version!==1 || !Number.isFinite(Date.parse(grant.expires)) || Date.parse(grant.expires)<=now)
    throw new Error('Missing, invalid or expired grant');
  const admittedRoot=resolve(paths.projectRoot);
  const target=resolve(grant.target), source=resolve(grant.source);
  // This installed integration admits its own notes/output files only. No HQ,
  // global rules, runtime configuration, executable source or outside projects.
  if(!['notes/codex','outputs'].some(folder=>target.startsWith(join(admittedRoot,folder)+sep)) ||
     !/\.(md|json|html|txt)$/.test(target) ||
     ['agents.md','skill.md'].includes(basename(target).toLowerCase()) ||
     !source.startsWith(resolve(paths.resultRoot)+sep) ||
     !digestPattern.test(grant.sha256) ||
     !(grant.previous_sha256===null || digestPattern.test(grant.previous_sha256)) ||
     !Number.isInteger(grant.max_bytes) || grant.max_bytes<1 || grant.max_bytes>1048576)
    throw new Error('Result outside admitted scope');
  const current=()=>{
    const state=readControls(io.readFileSync(paths.estatePath,'utf8'));
    if(state.authority!=='ACTIVE'||state.clock!=='ON') throw new Error('HQ controls prohibit result write');
    if(!io.readFileSync(grantPath).equals(bytes)) throw new Error('Grant changed');
    if(Date.parse(grant.expires)<=Date.now()) throw new Error('Grant expired');
    for(const path of paths.authorityFiles)
      if(hash(io.readFileSync(path))!==grant.rules?.[path]) throw new Error('Governing rules changed');
  };
  current();
  if(io.realpathSync(source)!==source || !io.statSync(source).isFile() || io.statSync(source).size>grant.max_bytes)
    throw new Error('Invalid result source');
  if(io.realpathSync(dirname(target))!==dirname(target)) throw new Error('Target directory redirects');
  if(io.existsSync(target) && (io.realpathSync(target)!==target || !io.statSync(target).isFile()))
    throw new Error('Target redirects or is not a file');
  const result=io.readFileSync(source);
  if(result.length>grant.max_bytes || hash(result)!==grant.sha256) throw new Error('Result identity changed');
  const previous=io.existsSync(target)?io.readFileSync(target):null;
  if(previous && hash(previous)===grant.sha256) return {status:'already_applied',id,sha256:grant.sha256};
  if((previous?hash(previous):null)!==grant.previous_sha256) throw new Error('Target changed since authorization');
  const backup=join(paths.grantRoot,`${id}.before`);
  if(previous) {
    try {io.writeFileSync(backup,previous,{flag:'wx',mode:0o600});}
    catch(error){if(error.code!=='EEXIST')throw error;}
    if(!io.readFileSync(backup).equals(previous)) throw new Error('Recovery mismatch');
  }
  const temporary=join(dirname(target),`.fami-result-${randomUUID()}.tmp`);
  let fd;
  try {
    fd=io.openSync(temporary,'wx',0o600);
    io.writeFileSync(fd,result);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
    current();
    if(io.realpathSync(dirname(target))!==dirname(target) ||
       (io.existsSync(target)?hash(io.readFileSync(target)):null)!==grant.previous_sha256)
      throw new Error('Target changed during write');
    io.renameSync(temporary,target);
    if(hash(io.readFileSync(target))!==grant.sha256) throw new Error('Installed result did not verify');
    return {status:'applied',id,sha256:grant.sha256};
  } finally {
    if(fd!==undefined)io.closeSync(fd);
    if(io.existsSync(temporary))io.unlinkSync(temporary);
  }
}

export const resultTool={
  name:'fami_commit_result',
  description:'Copy one hash-approved integration result to its exact authorized project file. Requires a current host-created grant; never creates authority.',
  parameters:{type:'object',additionalProperties:false,properties:{commission_id:{type:'string',pattern:'^[a-z0-9][a-z0-9-]{0,63}$'}},required:['commission_id']},
  async execute(_callId,params){
    const result=commitResult(params.commission_id);
    return {content:[{type:'text',text:JSON.stringify(result)}],details:result};
  },
};
