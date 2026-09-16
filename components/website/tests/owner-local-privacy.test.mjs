import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createServer } from 'vite';

test('real local HTTP server denies private recovery files while serving the owner shell',async()=>{
  const root=resolve('.'),parent=resolve('.owner-private');
  await mkdir(parent,{recursive:true});const folder=await mkdtemp(resolve(parent,'http-proof-'));
  await writeFile(resolve(folder,'proof.txt'),'synthetic private proof; not a real secret');
  const server=await createServer({root,logLevel:'silent',server:{host:'127.0.0.1',port:0,strictPort:false}});
  try{
    await server.listen();const address=server.httpServer.address(),base=`http://127.0.0.1:${address.port}`;
    const denied=await fetch(`${base}/.owner-private/${basename(folder)}/proof.txt`);
    assert.equal(denied.status,403);assert.equal((await denied.text()).includes('synthetic private proof'),false);
    assert.equal((await fetch(base+'/owner/')).status,200);
  }finally{await server.close();}
});
