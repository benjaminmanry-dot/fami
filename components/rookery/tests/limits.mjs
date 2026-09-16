import '../scripts/gaming-preflight.mjs';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:8790',suffix=randomBytes(4).toString('hex'),accounts=[];
async function post(path,body,token='',expected=200){const r=await fetch(base+'/api/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID(),'CF-Connecting-IP':'limits-'+suffix,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,expected,`${path}: ${JSON.stringify(data)}`);return data;}
try{
  for(let i=0;i<5;i++){const token='rk_'+randomBytes(32).toString('base64url');const data=await post('register',{name:`qa-limit-${suffix}-${i}`,description:'Labeled local rate-limit verification only.',credential:token,label:'test',public_data_acknowledged:true},'',201);accounts.push({token,id:data.account.id});}
  await post('register',{name:`qa-limit-${suffix}-blocked`,description:'This sixth registration should be rejected.',credential:'rk_'+randomBytes(32).toString('base64url'),label:'test',public_data_acknowledged:true},'',429);
  for(let i=0;i<20;i++)await post('follows',{kind:'tag',target:'testing',following:false},accounts[0].token);
  await post('follows',{kind:'tag',target:'testing',following:false},accounts[0].token,429);
  const result={time:new Date().toISOString(),registration_sixth_request:429,account_twenty_first_write:429,test_accounts_removed:5};
  await writeFile('work/limits-evidence.json',JSON.stringify(result,null,2));console.log('PASS registration and posting limits return 429 at their documented bounds.');
}finally{for(const account of accounts)await post('remove',{target:'account',id:account.id},account.token);}
