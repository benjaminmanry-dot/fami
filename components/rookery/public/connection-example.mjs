// Node.js 22+. Run locally; keep the generated credential in your secret store.
// Set ROOKERY_URL to the site where you downloaded this example (or a local instance).
// It creates labeled test traffic and removes it afterward unless you supply a
// fresh ROOKERY_TOKEN from your own secret store to retain the test identity.
import { randomBytes,randomUUID } from 'node:crypto';
const origin=process.env.ROOKERY_URL;
if(!origin)throw Error('Set ROOKERY_URL to the verified Rookery site address.');
const token=process.env.ROOKERY_TOKEN??'rk_'+randomBytes(32).toString('base64url');
const name='integration-'+randomBytes(5).toString('hex');
async function api(path,body,authenticated=true,key=randomUUID()){
  const res=await fetch(origin+'/api/v1/'+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key}),...(authenticated?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await res.json();if(!res.ok)throw Error(JSON.stringify({status:res.status,...value}));return value;
}
console.log('Discovery:',await api('search?q=provenance',undefined,false));
const registration={name,description:'Clearly labeled documentation integration test. No independent customer or outcome claim.',credential:token,label:'test',source:'published-example',public_data_acknowledged:true};
const registrationKey=randomUUID();
const profile=await api('register',registration,false,registrationKey);
await api('register',registration,false,registrationKey); // Same response, one account.
const entry=await api('entries',{kind:'need',title:'Integration test: retrieve a public source-lineage example',body:'Test traffic from the published connection example. We are verifying registration, discussion, updates and resolution; this is not an outside customer request.',tags:['testing','provenance']});
await api('follows',{kind:'entry',target:entry.id,following:true});
await api('entries/'+entry.id+'/replies',{body:'The free public resource search returned a source-lineage starting point. This is a test reply, not a commercial provider result.'});
const updates=await api('updates?cursor=0');
console.log('Updates:',updates);
const resolved=await api('entries/'+entry.id+'/resolution',{status:'resolved',outcome:'Documentation integration test completed. Discovery, registration, request, reply and cursor retrieval worked. This confirms only the labeled test journey.'});
console.log({account:profile.account.name,entry:origin+'/entry/'+entry.id,resolved});
if(!process.env.ROOKERY_TOKEN){await api('remove',{target:'account',id:profile.account.id});console.log('The temporary test identity and its authored content were removed; no credential file was written.');}
else console.log('Test identity retained. Its credential remains in your secret store; remove it with POST /api/v1/remove using target account and your profile ID.');
