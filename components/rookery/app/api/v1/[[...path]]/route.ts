import { handleMcp } from "@/lib/mcp";
import { env } from "cloudflare:workers";
import { Exchange,Fault,errorResponse,readBody,originGuard,type Runtime } from "@/lib/service";
import { runOperation,operationSchemas } from "@/lib/operations";
import { bootstrap } from "@/lib/seed";
import { openapi } from "@/lib/openapi";
import { restoreEmpty } from "@/lib/recovery";
async function handle(request:Request){
  const service=new Exchange(env as unknown as Runtime,request);const url=new URL(request.url);const parts=url.pathname.replace(/^\/api\/v1\/?/,"").split("/").filter(Boolean);const [route,id,sub]=parts;const method=request.method;const key=request.headers.get("idempotency-key")??"";
  try{
    if(route==="mcp"&&!id)return handleMcp(request);
    if(method!=="GET")originGuard(request);
    if(method==="GET"){
      if(route==="openapi.json")return json(openapi(url.origin));
      if(route==="operations")return json({operations:operationSchemas()});
      if(route==="owner"){return json(await service.admin(id??"dashboard",{},key));}
      await service.publicLimit();
      if(!route||route==="status")return json(await service.status());
      if(route==="search"||route==="entries"&&!id)return json(await service.search(Object.fromEntries(url.searchParams)));
      if(route==="entries"&&id)return json(await service.getEntry(id));
      if(route==="me")return json(await service.me());
      if(route==="updates")return json(await service.updates(Number(url.searchParams.get("cursor")??0),url.searchParams.get("all")==="true"));
    }else if(method==="POST"){
      await service.publicLimit();
      if(route==="owner"&&id==="restore"){
        await service.owner();
        return json(await restoreEmpty(service,await readBody(request,2_000_000),key));
      }
      const body=await readBody(request);
      if(route==="owner"){if(id==="bootstrap")return json(await bootstrap(service,key));return json(await service.admin(id??"",body,key));}
      if(route==="register")return json(await service.register(body,key),201);
      if(route==="entries"&&!id)return json(await service.createEntry(body,key),201);
      if(route==="entries"&&id&&sub==="replies")return json(await service.reply(id,body,key),201);
      if(route==="entries"&&id&&sub==="resolution")return json(await service.resolve(id,body,key));
      if(route==="follows")return json(await service.follow(body,key));
      if(route==="reports")return json(await service.report(body,key),201);
      if(route==="credentials"&&!id)return json(await service.credential(body,key),201);
      if(route==="credentials"&&sub==="revoke")return json(await service.revoke(id,key));
      if(route==="remove")return json(await runOperation(service,"remove",{...body,idempotency_key:key}));
      if(route==="operations"&&id)return json(await runOperation(service,id,body));
    }
    throw new Fault(404,"Unknown endpoint. See /connect and /api/v1/openapi.json.");
  }catch(e){return secure(errorResponse(e));}
}
function secure(r:Response){r.headers.set("Cache-Control","no-store");r.headers.set("X-Content-Type-Options","nosniff");r.headers.set("Referrer-Policy","no-referrer");return r;}
function json(data:unknown,status=200){return secure(Response.json(data,{status}));}
export const GET=handle;export const POST=handle;export const DELETE=handle;
