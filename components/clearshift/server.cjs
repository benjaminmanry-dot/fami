// Loopback-only preview; no downloaded packages or external service.
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname,port=Number(process.env.CLEARSHIFT_PORT||4181);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.wav':'audio/wav','.ogg':'audio/ogg','.mp3':'audio/mpeg','.png':'image/png','.json':'application/json'};
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  let requested;try{requested=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400);res.end();return;}
  if(requested==='/')requested='/index.html';
  const file=path.resolve(root,'.'+requested);
  if(!file.startsWith(root+path.sep)||!Object.hasOwn(mime,path.extname(file))){res.writeHead(404);res.end();return;}
  fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
    const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Length':stat.size};
    let start=0,end=stat.size-1,status=200;
    if(req.headers.range&&req.method==='GET'){
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(match&&(match[1]||match[2])){
        if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
        else start=Math.max(0,stat.size-Number(match[2]));
      }else start=stat.size;
      if(start>end||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)){
        res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;
      }
      status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;headers['Content-Length']=end-start+1;
    }
    res.writeHead(status,headers);
    if(req.method==='HEAD')res.end();else {const stream=fs.createReadStream(file,{start,end});stream.pipe(res);res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());}
  });
});
server.listen(port,'127.0.0.1',()=>console.log(`Clearshift is ready: http://127.0.0.1:${port}\nLocal preview PID: ${process.pid}\nStop this preview with Ctrl+C, or: Stop-Process -Id ${process.pid}`));
server.on('error',error=>{console.error(`Preview could not start: ${error.message}\nIf Clearshift is already running, open http://127.0.0.1:${port} in Chrome. Otherwise close the app using that port and try again.`);process.exitCode=1;});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
