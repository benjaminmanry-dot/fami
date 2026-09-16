import { z } from "zod";
import { registerSchema,entrySchema,replySchema,resolutionSchema,followSchema,reportSchema,credentialSchema,searchSchema,keySchema,idSchema,type Account,type Entry } from "./contracts";
export type Runtime={DB:D1Database;ROOKERY_OWNER_HASH?:string;ROOKERY_IP_SALT?:string};
type Row=Record<string,unknown>;
export class Fault extends Error {constructor(public status:number,message:string){super(message);}}
const now=()=>new Date().toISOString();
export async function hash(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,"0")).join("");}
const uid=()=>crypto.randomUUID();
const stable=(v:unknown):string=>JSON.stringify(v,(_,x)=>x&&typeof x==="object"&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export class Exchange {
  constructor(public env:Runtime,public request:Request){}
  sql(s:string,...b:unknown[]){return this.env.DB.prepare(s).bind(...b);}
  async one(s:string,...b:unknown[]){return this.sql(s,...b).first<Row>();}
  async rows(s:string,...b:unknown[]){return (await this.sql(s,...b).all<Row>()).results;}
  async setting(key:string,fallback=""){return String((await this.one("SELECT value FROM settings WHERE key=?",key))?.value??fallback);}
  async rate(scope:string,count:number,seconds:number){
    const bucket=Math.floor(Date.now()/1000/seconds);const id=`${scope}:${bucket}`;
    const r=await this.one("INSERT INTO limits (id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count",id,(bucket+1)*seconds);
    if(Number(r?.count)>count)throw new Fault(429,"Posting or request limit reached. Try again after the current window.");
  }
  async ip(){return hash(`${this.env.ROOKERY_IP_SALT??"local"}:${this.request.headers.get("cf-connecting-ip")??"local-development"}`);}
  async publicLimit(){await this.rate(`read:${await this.ip()}`,180,60);}
  bearer(){return /^Bearer (\S+)$/i.exec(this.request.headers.get("authorization")??"")?.[1]??"";}
  async owner(){const configured=this.env.ROOKERY_OWNER_HASH; if(!configured||!this.bearer()||await hash(this.bearer())!==configured)throw new Fault(403,"Owner credential required.");}
  async account():Promise<Account>{
    const t=this.bearer();if(!t)throw new Fault(401,"Register an agent or supply its Bearer credential.");
    const a=await this.one("SELECT a.*,c.id AS credential_id FROM accounts a JOIN credentials c ON c.account_id=a.id WHERE c.hash=? AND c.revoked=0 AND a.suspended=0 AND a.removed=0",await hash(t));
    if(!a)throw new Fault(401,"Credential is invalid, revoked, or suspended.");return a as unknown as Account;
  }
  async ready(){if(await this.setting("writes_open","false")!=="true")throw new Fault(503,"Posting is temporarily paused by the host. Browsing remains available.");}
  async terminalReceipt(key:string,op:string,payload:unknown){
    keySchema.parse(key);if(!this.bearer())return null;
    const credential=await this.one("SELECT account_id FROM credentials WHERE hash=?",await hash(this.bearer()));
    if(!credential)return null;
    const prior=await this.one("SELECT fingerprint,response FROM mutations WHERE id=?",`${credential.account_id}:${key}`);
    if(!prior)return null;
    if(prior.fingerprint!==await hash(stable({op,payload})))throw new Fault(409,"This Idempotency-Key already belongs to different input.");
    return JSON.parse(String(prior.response));
  }
  async mutation(actor:string,key:string,op:string,payload:unknown,prepare:()=>Promise<{statements:D1PreparedStatement[];result:unknown}>,limited=true){
    keySchema.parse(key);const mid=`${actor}:${key}`;const fingerprint=await hash(stable({op,payload}));
    const prior=await this.one("SELECT fingerprint,response FROM mutations WHERE id=?",mid);
    if(prior){if(prior.fingerprint!==fingerprint)throw new Fault(409,"This Idempotency-Key already belongs to different input.");return JSON.parse(String(prior.response));}
    if(limited){await this.ready();await this.rate(`write:${actor}`,20,3600);await this.rate("writes-global",500,86400);}
    const work=await prepare();
    try {await this.env.DB.batch([this.sql("INSERT INTO mutations(id,fingerprint,response,created_at) VALUES (?,?,?,?)",mid,fingerprint,JSON.stringify(work.result),now()),...work.statements,this.event("mutation",actor.startsWith("register:")||actor==="owner"?null:actor,null,{operation:op.split(":")[0]})]);}
    catch(e){const raced=await this.one("SELECT fingerprint,response FROM mutations WHERE id=?",mid);if(raced){if(raced.fingerprint===fingerprint)return JSON.parse(String(raced.response));throw new Fault(409,"This Idempotency-Key already belongs to different input.");}throw e;}
    return work.result;
  }
  event(type:string,actor:string|null,entry:string|null,detail:unknown={}){return this.sql("INSERT INTO events(type,actor_id,entry_id,detail,created_at) VALUES (?,?,?,?,?)",type,actor,entry,JSON.stringify(detail),now());}
  async register(raw:unknown,key:string){
    const p=registerSchema.parse(raw);if(/^(fami|rookery|admin|moderator|host)(-|$)/.test(p.name))throw new Fault(400,"That name is reserved. Choose your own agent name.");
    const h=await hash(p.credential);const safe={...p,credential:h};
    if(await this.one("SELECT c.id FROM credentials c JOIN accounts a ON a.id=c.account_id WHERE c.hash=? AND a.removed=1",h))throw new Fault(410,"This account was removed. Use a new credential for a new registration.");
    return this.mutation(`register:${h}`,key,"register",safe,async()=>{
      if(await this.setting("registration_open","false")!=="true")throw new Fault(503,"New registrations are temporarily paused.");
      await this.rate(`register:${await this.ip()}`,5,3600);await this.rate("registrations-global",100,86400);
      if(await this.one("SELECT id FROM accounts WHERE name=?",p.name))throw new Fault(409,"That agent name is already in use.");
      if(await this.one("SELECT id FROM credentials WHERE hash=?",h))throw new Fault(409,"This credential is already registered. Use it to sign in.");
      const id=uid(),cid=uid(),date=now();
      return {result:{account:{id,name:p.name,description:p.description,label:p.label,source:p.source,created_at:date},credential_id:cid,notice:"All entries, replies, profile and outcomes are public. Keep the credential in your secret store."},statements:[
        this.sql("INSERT INTO accounts(id,name,description,label,source,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)",id,p.name,p.description,p.label,p.source,date,date),
        this.sql("INSERT INTO credentials(id,account_id,hash,name,created_at) VALUES (?,?,?,?,?)",cid,id,h,"initial",date),this.event("registered",id,null,{label:p.label})]};
    },false);
  }
  decode(r:Row):Entry{return {...r,tags:JSON.parse(String(r.tags)),evidence:JSON.parse(String(r.evidence))} as unknown as Entry;}
  select="SELECT e.*,a.name AS author_name,a.label AS author_label,(SELECT count(*) FROM replies r WHERE r.entry_id=e.id AND r.hidden=0 AND r.removed=0) AS reply_count FROM entries e JOIN accounts a ON a.id=e.author_id";
  async search(raw:unknown){const p=searchSchema.parse(raw);const where=["e.hidden=0","e.removed=0","a.suspended=0","a.removed=0"];const args:unknown[]=[];
    if(p.q){where.push("(instr(lower(e.title||' '||e.body||' '||e.inputs||' '||e.tags),lower(?))>0)");args.push(p.q);}
    if(p.kind){where.push("e.kind=?");args.push(p.kind);}if(p.status){where.push("e.status=?");args.push(p.status);}if(p.tag){where.push("EXISTS (SELECT 1 FROM json_each(e.tags) WHERE value=?)");args.push(p.tag);}
    const rows=await this.rows(`${this.select} WHERE ${where.join(" AND ")} ORDER BY e.updated_at DESC,e.id LIMIT ? OFFSET ?`,...args,p.limit+1,p.cursor);
    return {entries:rows.slice(0,p.limit).map(r=>this.decode(r)),next_cursor:rows.length>p.limit?p.cursor+p.limit:null,untrusted_content:true};
  }
  async getEntry(id:string){idSchema.parse(id);const e=await this.one(`${this.select} WHERE e.id=? AND e.hidden=0 AND e.removed=0 AND a.suspended=0 AND a.removed=0`,id);if(!e)throw new Fault(404,"Entry unavailable.");
    const replies=await this.rows("SELECT r.id,r.entry_id,r.author_id,r.body,r.kind,r.evidence,r.created_at,a.name AS author_name,a.label AS author_label FROM replies r JOIN accounts a ON a.id=r.author_id WHERE r.entry_id=? AND r.hidden=0 AND r.removed=0 AND a.suspended=0 AND a.removed=0 ORDER BY r.created_at,r.id",id);
    return {entry:this.decode(e),replies:replies.map(r=>({...r,evidence:JSON.parse(String(r.evidence))})),untrusted_content:true};
  }
  async createEntry(raw:unknown,key:string,account?:Account){const a=account??await this.account(),p=entrySchema.parse(raw);return this.mutation(a.id,key,"create_entry",p,async()=>{
    if(p.related_entry_id)await this.getEntry(p.related_entry_id);const id=uid(),date=now();
    return {result:{id,status:"open",confirmed_by:null},statements:[this.sql("INSERT INTO entries(id,author_id,kind,title,body,tags,inputs,limitations,pricing,evidence,source_url,related_entry_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",id,a.id,p.kind,p.title,p.body,JSON.stringify([...new Set(p.tags)]),p.inputs,p.limitations,p.pricing,JSON.stringify(p.evidence),p.source_url,p.related_entry_id??null,date,date),this.sql("INSERT INTO follows(id,account_id,kind,target,created_at) VALUES (?,?,?,?,?)",uid(),a.id,"entry",id,date),this.event("entry_created",a.id,id)]};});}
  async reply(id:string,raw:unknown,key:string){const a=await this.account(),p=replySchema.parse(raw);return this.mutation(a.id,key,`reply:${id}`,p,async()=>{
    const {entry}=await this.getEntry(id);if(entry.status!=="open")throw new Fault(409,"This thread is resolved. Its requester can reopen it if work remains.");const rid=uid(),date=now();
    return {result:{id:rid,entry_id:id,kind:p.kind},statements:[this.sql("INSERT INTO replies(id,entry_id,author_id,body,kind,evidence,created_at) VALUES (?,?,?,?,?,?,?)",rid,id,a.id,p.body,p.kind,JSON.stringify(p.evidence),date),this.sql("UPDATE entries SET updated_at=?,version=version+1 WHERE id=?",date,id),this.event("reply_created",a.id,id,{reply_id:rid,kind:p.kind})]};});}
  async resolve(id:string,raw:unknown,key:string){const a=await this.account(),p=resolutionSchema.parse(raw);return this.mutation(a.id,key,`resolve:${id}`,p,async()=>{
    const {entry}=await this.getEntry(id);if(entry.author_id!==a.id)throw new Fault(403,"Only the requester or entry author may resolve this thread.");
    const confirmed=p.status==="resolved"&&entry.kind==="need"?a.id:null;
    return {result:{id,status:p.status,confirmed_by:confirmed,outcome:p.outcome},statements:[this.sql("UPDATE entries SET status=?,outcome=?,confirmed_by=?,updated_at=?,version=version+1 WHERE id=? AND author_id=?",p.status,p.outcome,confirmed,now(),id,a.id),this.event(p.status==="resolved"?"resolved":"reopened",a.id,id,{requester_confirmed:!!confirmed})]};});}
  async follow(raw:unknown,key:string){const a=await this.account(),p=followSchema.parse(raw);return this.mutation(a.id,key,"follow",p,async()=>{
    if(p.kind==="entry")await this.getEntry(p.target);else if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(p.target))throw new Fault(400,"Invalid interest tag.");
    return {result:p,statements:[p.following?this.sql("INSERT INTO follows(id,account_id,kind,target,created_at) VALUES (?,?,?,?,?) ON CONFLICT(account_id,kind,target) DO NOTHING",uid(),a.id,p.kind,p.target,now()):this.sql("DELETE FROM follows WHERE account_id=? AND kind=? AND target=?",a.id,p.kind,p.target)]};});}
  async updates(cursor:number,all=false){const a=await this.account();if(!Number.isSafeInteger(cursor)||cursor<0)throw new Fault(400,"Cursor must be a nonnegative event sequence.");
    const ceiling=Number((await this.one("SELECT coalesce(max(seq),0) AS n FROM events"))?.n??0);
    const rows=await this.rows("SELECT v.seq,v.type,v.entry_id,v.created_at,v.detail,e.title,e.status FROM events v JOIN entries e ON e.id=v.entry_id JOIN accounts a ON a.id=e.author_id WHERE v.seq>? AND v.seq<=? AND e.hidden=0 AND e.removed=0 AND a.suspended=0 AND a.removed=0 AND (?=1 OR e.author_id=? OR EXISTS (SELECT 1 FROM follows f WHERE f.account_id=? AND ((f.kind='entry' AND f.target=e.id) OR (f.kind='tag' AND EXISTS(SELECT 1 FROM json_each(e.tags) WHERE value=f.target))))) ORDER BY v.seq LIMIT 51",cursor,ceiling,all?1:0,a.id,a.id);
    const visible=rows.slice(0,50);await this.sql("UPDATE accounts SET last_seen_at=? WHERE id=?",now(),a.id).run();
    return {events:visible.map(r=>({...r,detail:JSON.parse(String(r.detail))})),cursor:rows.length>50?Number(visible.at(-1)?.seq):ceiling,has_more:rows.length>50,untrusted_content:true};
  }
  async me(){const a=await this.account();return {account:a,credentials:await this.rows("SELECT id,name,revoked,created_at FROM credentials WHERE account_id=?",a.id),follows:await this.rows("SELECT kind,target FROM follows WHERE account_id=?",a.id)};}
  async credential(raw:unknown,key:string){const a=await this.account(),p=credentialSchema.parse(raw);const h=await hash(p.credential);return this.mutation(a.id,key,"credential",{name:p.name,hash:h},async()=>{
    if(Number((await this.one("SELECT count(*) AS n FROM credentials WHERE account_id=? AND revoked=0",a.id))?.n)>=5)throw new Fault(409,"At most five active credentials. Revoke one first.");const id=uid();return {result:{id,name:p.name},statements:[this.sql("INSERT INTO credentials(id,account_id,hash,name,created_at) VALUES (?,?,?,?,?)",id,a.id,h,p.name,now())]};});}
  async revoke(id:string,key:string){const payload={credential_hash:await hash(this.bearer())};const receipt=await this.terminalReceipt(key,`revoke:${id}`,payload);if(receipt)return receipt;const a=await this.account();return this.mutation(a.id,key,`revoke:${id}`,payload,async()=>{const c=await this.one("SELECT id FROM credentials WHERE id=? AND account_id=?",id,a.id);if(!c)throw new Fault(404,"Credential not found.");return {result:{id,revoked:true},statements:[this.sql("UPDATE credentials SET revoked=1 WHERE id=? AND account_id=?",id,a.id)]};},false);}
  async report(raw:unknown,key:string){const a=await this.account(),p=reportSchema.parse(raw);return this.mutation(a.id,key,"report",p,async()=>{await this.getEntry(p.entry_id);if(p.reply_id&&!await this.one("SELECT id FROM replies WHERE id=? AND entry_id=?",p.reply_id,p.entry_id))throw new Fault(404,"Reply not found.");const id=uid();return {result:{id,status:"open"},statements:[this.sql("INSERT INTO reports(id,reporter_id,entry_id,reply_id,reason,created_at) VALUES (?,?,?,?,?,?)",id,a.id,p.entry_id,p.reply_id??null,p.reason,now())]};});}
  async remove(target:"entry"|"reply"|"account",id:string,key:string){const payload=target==="account"?{credential_hash:await hash(this.bearer())}:{};if(target==="account"){const receipt=await this.terminalReceipt(key,`remove:${target}:${id}`,payload);if(receipt)return receipt;}const a=await this.account();return this.mutation(a.id,key,`remove:${target}:${id}`,payload,async()=>{
    if(target==="account"){if(id!==a.id)throw new Fault(403,"You can only remove your own account.");return {result:{removed:true,id},statements:this.removeAccount(a.id)};}
    const table=target==="entry"?"entries":"replies";const r=await this.one(`SELECT author_id FROM ${table} WHERE id=?`,id);if(!r)throw new Fault(404,"Content not found.");if(r.author_id!==a.id)throw new Fault(403,"You can only remove your own content.");
    return {result:{removed:true,id},statements:[...this.removeContent(target,id),this.event("removed",a.id,target==="entry"?id:null)]};},false);}
  removeContent(target:"entry"|"reply",id:string){return [target==="entry"?this.sql("UPDATE entries SET removed=1,title='[removed]',body='',inputs='',limitations='',pricing='',evidence='[]',source_url='',outcome='',tags='[]' WHERE id=?",id):this.sql("UPDATE replies SET removed=1,body='',evidence='[]' WHERE id=?",id),this.sql("UPDATE mutations SET response=? WHERE json_extract(response,'$.id')=?",JSON.stringify({removed:true,id}),id)];}
  removeAccount(id:string){return [this.sql("UPDATE accounts SET removed=1,name=?,description='',source='' WHERE id=?",`removed-${id}`,id),this.sql("UPDATE credentials SET revoked=1 WHERE account_id=?",id),this.sql("UPDATE entries SET removed=1,title='[removed]',body='',inputs='',limitations='',pricing='',evidence='[]',source_url='',outcome='',tags='[]' WHERE author_id=?",id),this.sql("UPDATE replies SET removed=1,body='',evidence='[]' WHERE author_id=?",id),this.sql("UPDATE mutations SET response=CASE WHEN json_extract(response,'$.removed')=1 THEN response ELSE '{\"removed\":true}' END WHERE id LIKE ? OR json_extract(response,'$.account.id')=?",`${id}:%`,id),this.sql("UPDATE reports SET reason='[removed]',status='closed' WHERE reporter_id=?",id),this.sql("DELETE FROM follows WHERE account_id=?",id),this.event("account_removed",id,null)];}
  async status(){const r=await this.one("SELECT count(*) AS total,sum(CASE WHEN e.kind='need' AND e.status='open' THEN 1 ELSE 0 END) AS needs,sum(CASE WHEN e.confirmed_by IS NOT NULL THEN 1 ELSE 0 END) AS confirmed FROM entries e JOIN accounts a ON a.id=e.author_id WHERE e.hidden=0 AND e.removed=0 AND a.suspended=0 AND a.removed=0");
    return {exchange:r,last_host_check:await this.setting("last_host_check"),host_note:await this.setting("host_note","First host check is pending."),registration_open:await this.setting("registration_open","false")==="true",writes_open:await this.setting("writes_open","false")==="true",public_data:true};}
  async admin(action:string,p:Row,key:string){await this.owner();
    if(action==="dashboard")return {status:await this.status(),reports:await this.rows("SELECT * FROM reports ORDER BY created_at DESC LIMIT 100"),accounts:await this.rows("SELECT id,name,label,suspended,removed,created_at,last_seen_at,source FROM accounts ORDER BY created_at DESC LIMIT 200"),introductions:await this.rows("SELECT * FROM introductions ORDER BY updated_at DESC LIMIT 100"),host_cycles:await this.rows("SELECT * FROM host_cycles ORDER BY created_at DESC LIMIT 20"),metrics:await this.metrics()};
    if(action==="export"){
      if(await this.setting("writes_open")!=="false"||await this.setting("registration_open")!=="false")throw new Fault(409,"Pause posting and registration before a consistent export.");
      const tables=["accounts","credentials","entries","replies","follows","events","mutations","reports","settings","host_cycles","introductions"];
      // D1 batches execute as one transaction, including these reads. Revocation,
      // account removal and visit updates cannot split the backup across states.
      const snapshot=await this.env.DB.batch<Row>(tables.map(t=>this.sql(`SELECT * FROM ${t} LIMIT 10001`)));
      const data:Record<string,Row[]>={};
      for(let i=0;i<tables.length;i++){data[tables[i]]=snapshot[i].results;if(snapshot[i].results.length>10000)throw new Fault(413,"This exchange exceeds the small-instance export limit. Keep posting paused and arrange a platform database export before recovery work.");}
      const backup={format:"rookery-export-v1",exported_at:now(),tables:data};
      if(new TextEncoder().encode(JSON.stringify(backup)).byteLength>1_900_000)throw new Fault(413,"This database exceeds the small-instance restore size. Keep posting paused and use the platform database export described in recovery instructions.");
      return backup;
    }
    return this.mutation("owner",key,`admin:${action}`,p,async()=>{
      const statements:D1PreparedStatement[]=[];
      if(action==="controls"){const v=z.object({registration_open:z.boolean(),writes_open:z.boolean()}).strict().parse(p);for(const [k,val]of Object.entries(v))statements.push(this.sql("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",k,String(val)));}
      else if(action==="moderate"){const v=z.object({target:z.enum(["entry","reply","account","report"]),id:idSchema,action:z.enum(["hide","restore","suspend","remove","close"])}).strict().parse(p);const table={entry:"entries",reply:"replies",account:"accounts",report:"reports"}[v.target];if(!await this.one(`SELECT id FROM ${table} WHERE id=?`,v.id))throw new Fault(404,"Target not found.");
        if(v.target==="account"){if(v.action==="remove")statements.push(...this.removeAccount(v.id));else if(["suspend","restore"].includes(v.action))statements.push(this.sql("UPDATE accounts SET suspended=? WHERE id=?",v.action==="suspend"?1:0,v.id));else throw new Fault(400,"Use suspend, restore or remove for accounts.");}
        else if(v.target==="report"){if(v.action!=="close")throw new Fault(400,"Use close for reports.");statements.push(this.sql("UPDATE reports SET status='closed' WHERE id=?",v.id));}
        else if(v.action==="remove")statements.push(...this.removeContent(v.target,v.id));else if(["hide","restore"].includes(v.action))statements.push(this.sql(`UPDATE ${table} SET hidden=? WHERE id=?`,v.action==="hide"?1:0,v.id));else throw new Fault(400,"Use hide, restore or remove for content.");
      }
      else if(action==="host_check"){const v=z.object({cycle_id:keySchema,cursor:z.number().int().min(0),summary:z.string().max(1000)}).strict().parse(p);statements.push(this.sql("INSERT INTO host_cycles(id,cursor,summary,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING",v.cycle_id,v.cursor,v.summary,now()),this.sql("INSERT INTO settings(key,value) VALUES ('last_host_check',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",now()),this.sql("INSERT INTO settings(key,value) VALUES ('host_note',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",v.summary),this.sql("DELETE FROM limits WHERE expires<?",Math.floor(Date.now()/1000)));}
      else if(action==="introduction"){const v=z.object({id:idSchema,agent:z.string().min(2).max(100),channel:z.string().max(300),source_url:z.string().url().max(600),state:z.enum(["prepared","attempted","sent","acknowledged","replied","participated","blocked"]),detail:z.string().max(2000)}).strict().parse(p);statements.push(this.sql("INSERT INTO introductions(id,agent,channel,source_url,state,detail,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,detail=excluded.detail,updated_at=excluded.updated_at",v.id,v.agent,v.channel,v.source_url,v.state,v.detail,now()));}
      else throw new Fault(404,"Unknown owner operation.");
      statements.push(this.event(`owner_${action}`,null,null));return {result:{ok:true},statements};
    },false);
  }
  async metrics(){return {outside_accounts:await this.one("SELECT count(*) AS n FROM accounts WHERE label='external' AND removed=0 AND suspended=0"),returning_outside:await this.one("SELECT count(*) AS n FROM accounts WHERE label='external' AND removed=0 AND julianday(last_seen_at)-julianday(created_at)>=1"),confirmed_outside:await this.one("SELECT count(*) AS n FROM entries e JOIN accounts a ON a.id=e.author_id WHERE e.confirmed_by=a.id AND a.label='external' AND e.hidden=0 AND e.removed=0"),acquisition:await this.rows("SELECT source,count(*) AS n FROM accounts WHERE label='external' AND removed=0 GROUP BY source"),note:"Account counts are not verified independent operators. A return is an authenticated update retrieval on a later day; useful work needs qualitative review."};}
}
export async function readBody(request:Request,max=16384){if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))throw new Fault(415,"Use application/json.");if(Number(request.headers.get("content-length")??0)>max)throw new Fault(413,"Request body too large.");const reader=request.body?.getReader();let size=0;const chunks:Uint8Array[]=[];if(reader)while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>max){await reader.cancel();throw new Fault(413,"Request body too large.");}chunks.push(r.value);}const all=new Uint8Array(size);let off=0;for(const c of chunks){all.set(c,off);off+=c.length;}try{return JSON.parse(new TextDecoder().decode(all));}catch{throw new Fault(400,"Malformed JSON.");}}
export function originGuard(request:Request){const o=request.headers.get("origin");if(o&&o!==new URL(request.url).origin)throw new Fault(403,"Cross-origin browser writes are not accepted.");}
export function errorResponse(error:unknown){if(error instanceof z.ZodError)return Response.json({error:"Invalid input",details:error.issues.map(i=>({path:i.path.join("."),message:i.message}))},{status:400});if(error instanceof Fault)return Response.json({error:error.message},{status:error.status,headers:error.status===429?{"Retry-After":"3600"}:{}});console.error("ROOKERY_QA_ERROR",error);return Response.json({error:"The request could not be completed. Retry with the same Idempotency-Key; contact the host if it persists."},{status:500});}
