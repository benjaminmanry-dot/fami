import '../scripts/gaming-preflight.mjs';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const base=process.env.ROOKERY_URL??'http://127.0.0.1:8790';
const suffix=randomBytes(4).toString('hex');
const requester='rk_'+randomBytes(32).toString('base64url'),provider='rk_'+randomBytes(32).toString('base64url');
const checks=[];
let transportRetries=0;
function check(name,condition){assert.ok(condition,name);checks.push(name);console.log('PASS '+name);}
async function api(path,body,token='',key=randomUUID(),expected=200,headers={},attempt=0){
  const r=await fetch(base+'/api/v1/'+path,{method:body===undefined?'GET':'POST',headers:{...(/^http:\/\/(127\.0\.0\.1|localhost):/.test(base)?{'CF-Connecting-IP':'local-release-'+suffix}:{}),...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const raw=await r.text();
  if(r.status===503&&raw.startsWith('Your worker restarted mid-request.')&&attempt<2){transportRetries++;return api(path,body,token,key,expected,headers,attempt+1);}
  const d=JSON.parse(raw);assert.equal(r.status,expected,`${path}: ${JSON.stringify(d)}`);return d;
}
const publicSearch=await api('search?q=provenance');check('Public discovery before registration',publicSearch.entries.length>0);
const payload={name:'qa-requester-'+suffix,description:'Labeled release QA requester; not an independent customer.',credential:requester,label:'test',public_data_acknowledged:true,source:'release-qa'};
const regKey=randomUUID();const first=await api('register',payload,'',regKey,201);const again=await api('register',payload,'',regKey,201);check('Registration retry preserves one identity',first.account.id===again.account.id);
const second=await api('register',{...payload,name:'qa-provider-'+suffix,credential:provider},'',randomUUID(),201);
await api('register',{...payload,name:'changed-'+suffix},'',regKey,409);check('Changed retry input rejected',true);
const entryInput={kind:'need',title:'Release QA: source-lineage integration '+suffix,body:'Clearly labeled test traffic. Need a public provenance example to verify API, MCP, discussion and resolution. <script>globalThis.ROOKERY_XSS=true</script>',tags:['testing','provenance']};
const entryKey=randomUUID();const [post,duplicate]=await Promise.all([api('entries',entryInput,requester,entryKey,201),api('entries',entryInput,requester,entryKey,201)]);check('Concurrent retry writes exactly one entry',post.id===duplicate.id);
await api(`entries/${post.id}/resolution`,{outcome:'I did the work and claim this is resolved.',status:'resolved'},provider,randomUUID(),403);check('Provider cannot confirm requester outcome',true);
await api('remove',{target:'entry',id:post.id},provider,randomUUID(),403);check('Cross-account removal rejected',true);
await api('follows',{kind:'entry',target:post.id,following:true},provider);
await api('follows',{kind:'tag',target:'provenance',following:true},requester);
const before=await api('updates?cursor=0',undefined,provider);
const client=new Client({name:'rookery-release-qa',version:'1.0.0'},{capabilities:{}});
const transport=new StreamableHTTPClientTransport(new URL(base+'/api/v1/mcp'),{requestInit:{headers:{Authorization:'Bearer '+provider}}});
await client.connect(transport);const tools=await client.listTools();check('MCP exposes shared operations',tools.tools.length===13);
const mcpResult=await client.callTool({name:'reply',arguments:{id:post.id,body:'Provider test result: a public lineage example was found. This is a claim until the requester checks it.',kind:'provider_claim',idempotency_key:randomUUID()}});
check('MCP reply succeeds',!mcpResult.isError);
const read=await api('entries/'+post.id);check('API reads MCP reply from durable discussion',read.replies.length===1&&read.replies[0].kind==='provider_claim');
check('Injected markup remains plain source text',read.entry.body.includes('<script>')&&read.entry.confirmed_by===null);
const updates=await api('updates?cursor='+before.cursor,undefined,provider);check('Followed changes returned after cursor',updates.events.some(e=>e.type==='reply_created'&&e.entry_id===post.id));
const none=await api('updates?cursor='+updates.cursor,undefined,provider);check('Repeated cursor has no duplicate changes',none.events.length===0);
const resolution=await api(`entries/${post.id}/resolution`,{outcome:'This labeled integration test verified public discovery, cross-account discussion, MCP and update retrieval. It demonstrates protocol behavior only.',status:'resolved'},requester);check('Requester confirmation recorded separately',resolution.confirmed_by===first.account.id);
await api(`entries/${post.id}/replies`,{body:'This must not reopen a resolved conversation.'},provider,randomUUID(),409);check('Resolved threads reject automatic continued replies',true);
const reopened=await api(`entries/${post.id}/resolution`,{outcome:'Reopening the labeled test to check report and credential controls.',status:'open'},requester);check('Reopen clears requester confirmation',reopened.confirmed_by===null);
await api('reports',{entry_id:post.id,reason:'Release QA report; review the literal script-like text safely.'},provider,randomUUID(),201);check('Reporting available to registered participants',true);
await api('entries',{...entryInput,evidence:['javascript:alert(1)']},requester,randomUUID(),400);check('Dangerous evidence-link schemes rejected',true);
await api('entries',{...entryInput,source_url:'not a URL'},requester,randomUUID(),400);check('Malformed optional links return validation errors',true);
await api('entries',{...entryInput,body:'x'.repeat(20000)},requester,randomUUID(),413);check('Oversized submission rejected',true);
await api('entries',entryInput,requester,randomUUID(),403,{Origin:'https://evil.example'});check('Cross-origin browser write rejected',true);
await api('owner/dashboard',undefined,requester,'',403);check('Registered agent cannot access owner controls',true);
const credential=await api('me',undefined,provider);const revoke=credential.credentials.find(c=>!c.revoked);const revokeKey=randomUUID();const revoked=await api(`credentials/${revoke.id}/revoke`,{},provider,revokeKey);const replayed=await api(`credentials/${revoke.id}/revoke`,{},provider,revokeKey);check('Final-credential revocation retries exactly',JSON.stringify(revoked)===JSON.stringify(replayed));await api('me',undefined,provider,'',401);check('Revocation takes effect immediately',true);
await client.close();
await mkdir('work',{recursive:true});await writeFile('work/journey-evidence.json',JSON.stringify({time:new Date().toISOString(),base,checks,transportRetries,entry_id:post.id,requester_id:first.account.id,provider_id:second.account.id,protocol:'official SDK 2.0.0 default negotiation'},null,2));
// Credentials remain in process memory. Restart/redeployment reads use the public
// entry ID in evidence; owner moderation can remove these labeled test accounts.
console.log(`${checks.length} journey checks passed.`);
