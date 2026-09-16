import assert from 'node:assert/strict';
import plugin, {checkTool, checkRun} from './index.js';
const active = '## CONTROL BLOCK\n- **Authority: ACTIVE**\n- **Clock: ON**\n## Elsewhere\n';
const reader = (text=active, stale=false) => path => {
  if (path.endsWith('estate-map.md')) return text;
  return Buffer.from(stale && path.includes('/reference/') ? 'stale' : 'same');
};
const context = {agentId:'main'};
const read = {toolName:'read',params:{path:'reference/global-AGENTS.md'}};
assert.equal(checkTool(read,context,reader()),undefined);
assert.equal(checkRun(context,reader()),undefined);
for (const text of [active.replace('ACTIVE','STOOD DOWN'),active.replace('ON','OFF'),active+'## CONTROL BLOCK\n',active.replace('## Elsewhere','- **Clock: OFF**\n## Elsewhere'),'']) {
  assert.equal(checkTool(read,context,reader(text)).block,true);
  assert.equal(checkRun(context,reader(text)).outcome,'block');
}
assert.equal(checkTool(read,context,reader(active,true)).block,true);
assert.equal(checkTool(read,{},reader()).block,true);
assert.equal(checkTool(read,context,()=>{throw new Error('fixture missing');}).block,true);
for (const toolName of ['exec','process','write','edit','apply_patch','message','cron']) {
  assert.equal(checkTool({toolName},context,reader()).block,true);
}
const spawnParams={runtime:'acp',agentId:'hermes',mode:'run'};
assert.deepEqual(checkTool({toolName:'sessions_spawn',params:spawnParams},context,reader(),p=>p),{params:spawnParams});
assert.equal(checkTool({toolName:'sessions_history',params:{}},context,reader()).block,true);
assert.equal(checkTool({toolName:'sessions_spawn',params:{runtime:'subagent',agentId:'main'}},context,reader()).block,true);
const registrations=[], commands=[];
plugin.register({on:(...args)=>registrations.push(args), registerCommand:command=>commands.push(command),registerTool:tool=>assert.equal(tool.name,'fami_commit_result')});
assert.deepEqual(registrations.map(r=>r[0]),['before_tool_call','before_agent_run']);
assert.ok(registrations.every(r=>r[2].priority===1000));
assert.deepEqual(commands.map(c=>c.name),['fami-status','fami-stand-down']);
assert.deepEqual(commands[1].requiredScopes,['operator.admin']);
console.log('PASS: active read/ACP, inactive/ambiguous/missing/stale controls, unknown identity, seven direct-tool denials, invalid spawn and typed registration; zero model calls.');
