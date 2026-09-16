import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import plugin from './index.js';
import {readControls, statusCommand, standDownCommand, writeStandDown} from './controls.js';

const fixture = fs.mkdtempSync(join(tmpdir(),'fami-control-proof-'));
const path = join(fixture,'estate-map.md');
const recovery = join(fixture,'recovery');
const active = 'Header\r\n## CONTROL BLOCK\r\n- **Authority: ACTIVE** (choices)\r\n- **Clock: ON**\r\n## Work\r\nKeep this unchanged.\r\n';
const ctx={isAuthorizedSender:true,agentId:'main',gatewayClientScopes:['operator.admin'],commandBody:'/fami-stand-down'};
let writes=0;
for(const override of [{isAuthorizedSender:false},{agentId:'hermes'},{gatewayClientScopes:[]},
  {gatewayClientScopes:['operator.read']},{gatewayClientScopes:undefined},{commandBody:'quoted /fami-stand-down'},
  {commandBody:'/fami-stand-down enable'},{args:'enable'}]) {
  assert.match(standDownCommand({...ctx,...override},()=>{writes++;}).text,/Nothing changed/);
}
assert.equal(writes,0);
assert.match(statusCommand({...ctx,commandBody:'/fami-status'},()=>active).text,/ACTIVE; clock ON/);
for(const invalid of ['',active+'## CONTROL BLOCK\n',active.replace('## Work','- **Clock: OFF**\n## Work')])
  assert.throws(()=>readControls(invalid));
fs.writeFileSync(path,active);
assert.equal(writeStandDown(path,recovery).alreadyStopped,false);
assert.equal(fs.readFileSync(path,'utf8'),active.replace('Authority: ACTIVE','Authority: STOOD DOWN'));
assert.equal(writeStandDown(path,recovery).alreadyStopped,true);
assert.equal(fs.readdirSync(recovery).length,1);
assert.equal(fs.readFileSync(join(recovery,fs.readdirSync(recovery)[0]),'utf8'),active);
fs.writeFileSync(path,active);
const denied={...fs,writeFileSync:(target,...args)=>{
  if(typeof target==='number') throw new Error('fixture disk failure');
  return fs.writeFileSync(target,...args);
}};
assert.throws(()=>writeStandDown(path,recovery,denied),/disk failure/);
assert.equal(fs.readFileSync(path,'utf8'),active);
assert.ok(!fs.readdirSync(fixture).some(name=>name.endsWith('.tmp')));
const raced={...fs,fsyncSync:fd=>{fs.fsyncSync(fd);fs.appendFileSync(path,'Concurrent owner edit\n');}};
assert.throws(()=>writeStandDown(path,recovery,raced),/concurrently/);
assert.equal(fs.readFileSync(path,'utf8'),active+'Concurrent owner edit\n');
const link=join(fixture,'redirect.md');
fs.symlinkSync(path,link);
assert.throws(()=>writeStandDown(link,recovery),/redirect/);

// Exercise the installed host's actual command authorization and dispatch code,
// substituting only the write destination with disposable test data. No model.
const {executeRegisteredPluginCommand}=await import('/home/fami/openclaw-runtime/lib/node_modules/openclaw/dist/plugin-command-execution-DGTNE-Zd.js');
const commands=[];
plugin.register({on:()=>{},registerCommand:c=>commands.push(c),registerTool:()=>{}});
const command={...commands.find(c=>c.name==='fami-stand-down'),pluginId:'fami-controller-guard',
  handler:context=>standDownCommand(context,()=>writeStandDown(path,recovery))};
const registry={channels:[]};
const params={...ctx,command,channel:'webchat',config:{},sessionKey:'agent:main:fami-control-proof'};
fs.writeFileSync(path,active);
assert.match((await executeRegisteredPluginCommand(registry,{...params,isAuthorizedSender:false})).text,/requires authorization/);
assert.match((await executeRegisteredPluginCommand(registry,{...params,gatewayClientScopes:['operator.read']})).text,/requires gateway scope/);
assert.equal(fs.readFileSync(path,'utf8'),active);
assert.match((await executeRegisteredPluginCommand(registry,params)).text,/now STOOD DOWN/);
assert.equal(readControls(fs.readFileSync(path,'utf8')).authority,'STOOD DOWN');
fs.writeFileSync(join(fixture,'receipt.json'),JSON.stringify({status:'PASS',model_calls:0,live_control_writes:0,
  checks:['eight-auth-denials','status','malformed-controls','exact-stop-only-change','duplicate-stop',
  'recovery','disk-failure','concurrent-edit','symlink-denied','native-unauthenticated-denied',
  'native-scope-denied','native-authorized-fixture-stop'],fixture},null,2));
console.log(JSON.stringify({status:'PASS',fixture,model_calls:0,live_control_writes:0}));
