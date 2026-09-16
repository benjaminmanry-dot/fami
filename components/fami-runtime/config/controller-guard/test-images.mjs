import assert from 'node:assert/strict';
import {prepareImage, subscriptionProvider} from './images.js';
import {checkTool} from './index.js';
const source=()=>({models:{providers:{openai:structuredClone(subscriptionProvider)}}});
const io=(cfg=source())=>({readFileSync:()=>JSON.stringify(cfg),realpathSync:p=>p,statSync:()=>({isFile:()=>true})});
const prompt={prompt:'A black raven on a yellow background.'};
let checks=0;
const rejects=(p,cfg=source(),env={},fs=io(cfg))=>{assert.throws(()=>prepareImage(p,fs,env));checks++;};
const allowed=prepareImage(prompt,io(),{});
const nativeDefaults=prepareImage({...prompt,image:'',images:[],openai:{background:'opaque',moderation:'auto',outputCompression:100,user:''},fal:{creativity:'raw'}},io(),{});
assert.equal(nativeDefaults.fal,undefined);assert.equal(nativeDefaults.openai.user,undefined);checks+=2;
assert.equal(allowed.model,'openai/gpt-image-2');assert.equal(allowed.count,1);checks+=2;
assert.deepEqual(prepareImage({action:'status'},io(),{}),{action:'status'});checks++;
const img='/home/fami/.openclaw-fami/media/tool-image-generation/test.png';
assert.equal(prepareImage({...prompt,image:img},io(),{}).image,img);checks++;
for(const prop of ['baseUrl','api','auth']) {
 const cfg=source();cfg.models.providers.openai[prop]='api-fallback';rejects(prompt,cfg);
}
for(const prop of ['apiKey','headers','request','authHeader']) {
 const cfg=source();cfg.models.providers.openai[prop]='synthetic-not-a-secret';rejects(prompt,cfg);
}
const cfg=source();cfg.models.providers.openai.models=[{id:'gpt-image-2',baseUrl:'https://api.openai.com/v1'}];rejects(prompt,cfg);
rejects(prompt,{});rejects(prompt,source(),{OPENAI_API_KEY:'synthetic-not-a-secret'});
for(const extra of [{model:'google/anything'},{background:'transparent'},{openai:{background:'transparent'}},
 {count:0},{count:5},{count:1.5},{filename:'../x.png'},{image:'https://example.com/x.png'},
 {image:'/etc/passwd'},{image:'/home/fami/.openclaw-fami/media/inbound/../x.png'},
 {image:'data:image/png;base64,AAAA'},{image:'/home/fami/.openclaw-fami/media/inbound/key.json'}]) rejects({...prompt,...extra});
rejects({...prompt,openai:{apiKey:'synthetic'}});rejects({...prompt,openai:{user:'private-identifier'}});
rejects({...prompt,image:img},source(),{},{...io(),realpathSync:()=>'/other/file'});
const active='## CONTROL BLOCK\n- **Authority: ACTIVE**\n- **Clock: ON**\n## End\n';
const reader=text=>path=>path.endsWith('estate-map.md')?text:Buffer.from('same');
const event={toolName:'image_generate',params:prompt},ctx={agentId:'main'};
assert.deepEqual(checkTool(event,ctx,reader(active),p=>p,p=>prepareImage(p,io(),{})),{params:allowed});checks++;
assert.equal(checkTool(event,ctx,reader(active.replace('ACTIVE','STOOD DOWN')),p=>p,()=>{throw Error('should not run');}).block,true);checks++;
assert.equal(checkTool(event,ctx,reader(active),p=>p,()=>{throw Error('bad route');}).block,true);checks++;
console.log(`PASS ${checks} image route, endpoint, override, reference and control assertions; no network/model/credential access.`);
