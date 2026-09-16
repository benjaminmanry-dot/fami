import './gaming-preflight.mjs';
import './sites-env.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Wrangler reads Worker secrets beside its config, not from --env-file.
// Keep that local configuration outside every packaged deployment directory.
const args=process.argv.slice(2), portIndex=args.indexOf('--port');
const port=portIndex<0?8790:Number(args[portIndex+1]);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Choose a valid local preview port.');
const root=process.cwd(), local=path.join(root,'.private',`preview-${port}`);
mkdirSync(local,{recursive:true});
const config=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
config.main=path.join(root,'dist/server/index.js');
config.assets={...config.assets,directory:path.join(root,'dist/client')};
writeFileSync(path.join(local,'wrangler.json'),JSON.stringify(config));
writeFileSync(path.join(local,'.dev.vars'),readFileSync('.env.local'));
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config',path.join(local,'wrangler.json'),'--local',...(args.includes('--persist-to')?[]:['--persist-to','.wrangler/state']),'--ip','127.0.0.1','--inspector-port','0',...args],{stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
