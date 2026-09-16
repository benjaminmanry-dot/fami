import { z } from "zod";
import { Exchange,Fault } from "./service";

// These columns define export v1. No table, column or SQL identifier comes from
// the submitted file. A future schema change must version this contract too.
const columns:Record<string,string[]>={
  accounts:["id","name","description","label","source","suspended","removed","created_at","last_seen_at"],
  credentials:["id","account_id","hash","name","revoked","created_at"],
  entries:["id","author_id","kind","title","body","tags","inputs","limitations","pricing","evidence","source_url","status","outcome","confirmed_by","related_entry_id","hidden","removed","created_at","updated_at","version"],
  replies:["id","entry_id","author_id","body","kind","evidence","hidden","removed","created_at"],
  follows:["id","account_id","target","kind","created_at"],
  events:["seq","type","actor_id","entry_id","detail","created_at"],
  mutations:["id","fingerprint","response","created_at"],
  reports:["id","reporter_id","entry_id","reply_id","reason","status","created_at"],
  settings:["key","value"],
  host_cycles:["id","cursor","summary","created_at"],
  introductions:["id","agent","channel","source_url","state","detail","updated_at"],
};
const cell=z.union([z.string(),z.number().finite(),z.null()]);
const schema=z.object({
  confirm_empty_restore:z.literal(true),
  backup:z.object({format:z.literal("rookery-export-v1"),exported_at:z.string(),tables:z.record(z.array(z.record(cell)).max(10000))}).strict()
}).strict();

export async function restoreEmpty(service:Exchange,raw:unknown,key:string){
  await service.owner();
  const p=schema.parse(raw),tables=p.backup.tables;
  if(Object.keys(tables).sort().join()!==Object.keys(columns).sort().join())throw new Fault(400,"Backup tables do not match export v1.");
  for(const [table,expected] of Object.entries(columns)){
    const names=[...expected].sort().join();
    for(const row of tables[table])if(Object.keys(row).sort().join()!==names)throw new Fault(400,`Backup columns do not match ${table}.`);
  }
  return service.mutation("owner",key,"restore_empty",p,async()=>{
    const counts=await service.env.DB.batch(Object.keys(columns).map(t=>service.sql(`SELECT count(*) AS n FROM "${t}"`)));
    if(counts.some(c=>Number((c.results[0] as {n:number}).n)>0)||await service.setting("instance_initialized"))throw new Fault(409,"Restore requires an empty, newly provisioned database. Existing data will never be overwritten.");
    const statements=[service.sql("INSERT INTO settings(key,value) VALUES ('instance_initialized','restored')")];
    for(const [table,names] of Object.entries(columns)){
      // Bootstrapping and restore share the unique initialization marker. Its
      // insert is in this same transaction, so concurrent initialization loses
      // safely rather than mixing two databases. Restored controls stay closed.
      const rows=table==="settings"?tables[table].filter(r=>!["instance_initialized","registration_open","writes_open"].includes(String(r.key))):tables[table];
      if(!rows.length)continue;
      const select=names.map(n=>`json_extract(value,'$.${n}')`).join(",");
      statements.push(service.sql(`INSERT INTO "${table}" (${names.map(n=>`"${n}"`).join(",")}) SELECT ${select} FROM json_each(?)`,JSON.stringify(rows)));
    }
    for(const key of ["registration_open","writes_open"])statements.push(service.sql("INSERT INTO settings(key,value) VALUES (?,'false') ON CONFLICT(key) DO UPDATE SET value='false'",key));
    return {result:{restored:true,posting_paused:true,rows:Object.fromEntries(Object.entries(tables).map(([t,r])=>[t,r.length]))},statements};
  },false);
}
