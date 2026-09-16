'use strict';
const {chromium}=require(process.env.CLEARSHIFT_PLAYWRIGHT||'playwright');
const {choose}=require('./qa-planner.cjs');
const E=require('../js/sweep-engine.js');
const fs=require('node:fs'),assert=require('node:assert/strict');
const OUT=require('node:path').resolve(__dirname,'../evidence-v3')+'/';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const record={kind:'Continuous isolated Chrome run: deterministic empty starting deal, then real pointer input and real-time audio/sweep; no score or flow injection',events:[],errors:[]};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>record.errors.push(e.message));
  await page.addInitScript(raw=>localStorage.setItem('clearshift.run.v3',raw),E.serialize(E.createGame(112)));
  await page.goto('http://127.0.0.1:4180/');await page.getByRole('button',{name:'Resume session ↗',exact:true}).click();await page.waitForFunction(()=>Clearshift.snapshot().running);
  const get=()=>page.evaluate(()=>Clearshift.snapshot());let lastScene=-1,lastFlow=0;
  for(let turn=0;turn<450;turn++){
   await page.waitForTimeout(1080);let s=await get();
   assert.equal(s.audio.lastError,null);assert(Math.abs(s.state.beats-s.transport.beats)<.22);
   if(s.scene!==lastScene||s.state.bestFlow>lastFlow){
    record.events.push({seconds:s.transport.beats*60/112,score:s.state.score,moves:s.state.moves,scene:s.scene,flow:s.state.flow,bestFlow:s.state.bestFlow,voices:s.audio.activeVoices});
    console.log(record.events.at(-1));
    if(s.scene!==lastScene)await page.screenshot({path:OUT+'earned-district-'+(s.scene+1)+'.png'});
    lastScene=s.scene;lastFlow=s.state.bestFlow;
   }
   if(s.scene===8&&s.state.bestFlow===8){record.completedRoute=true;break;}
   if(!s.running){record.ended=s.status;break;}
   const move=choose(s.state);
   if(move){await page.locator('[data-slot="'+move.slot+'"]').click();await page.locator('[data-row="'+move.r+'"][data-col="'+move.c+'"]').click();}
   else if(!E.pending(s.state)){
    const rescue=E.findRescue(s.state);if(!rescue){record.noRescue=true;break;}
    await page.keyboard.press('s');await page.locator('[data-slot="'+rescue.slot+'"]').click();
    await page.locator('[data-row="'+rescue.source[0]+'"][data-col="'+rescue.source[1]+'"]').click();
    await page.locator('[data-row="'+rescue.target[0]+'"][data-col="'+rescue.target[1]+'"]').click();
   }
  }
  record.final=await get();if(record.final.running)await page.getByRole('button',{name:'Pause game',exact:true}).click();
  assert.deepEqual(record.errors,[]);console.log('Continuous run finished',record.final.state.score,record.final.state.bestFlow,record.final.scene);
 }finally{await browser.close();fs.writeFileSync(OUT+'continuous-play.json',JSON.stringify(record,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
