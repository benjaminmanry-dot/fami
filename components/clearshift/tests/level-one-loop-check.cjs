/* Actual Chrome checks in disposable contexts. Fixtures exercise boundaries;
 * they are not a claim of earning maximum flow in a continuous playthrough. */
const {chromium}=require(process.env.CLEARSHIFT_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../js/sweep-engine.js');
const BASE=process.env.CLEARSHIFT_URL||'http://127.0.0.1:4181/';
const OUT=path.resolve(__dirname,'../evidence-level-one-loop');
const snap=p=>p.evaluate(()=>Clearshift.snapshot());
const ready=p=>p.waitForFunction(()=>Clearshift.snapshot().running&&!Clearshift.snapshot().busy,{},{timeout:25000});
async function fixture(p,s){
 await p.evaluate(raw=>sessionStorage.setItem('clearshift.qa.loop-next',raw),E.serialize(s));
 await p.reload();await p.getByRole('button',{name:'Resume level 1 ↗',exact:true}).click();
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const result={passed:false,checks:[],errors:[]};fs.mkdirSync(OUT,{recursive:true});
 const log=(name,data={})=>{result.checks.push({name,...data});console.log(name);};
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  let journey=E.createGame(112);journey.score=2300;journey.beats=43.5;journey.step=22;
  journey.flow=3;journey.flowEnergy=30;journey.bestFlow=3;journey.shift=1;
  journey.tray=[{id:'three-h',color:1},null,{id:'dot',color:2}];journey.board[1][1]=2;journey.board[1][3]=3;
  journey=E.pickup(journey,0,1,1).state;
  await context.addInitScript(raw=>{
   if(!sessionStorage.getItem('clearshift.qa.seeded')){
    localStorage.setItem('clearshift.run.v3',raw);localStorage.setItem('clearshift.preferences.v3',JSON.stringify({music:.27,effects:.22,reduced:false,best:2400,seen:true}));sessionStorage.setItem('clearshift.qa.seeded','yes');
   }
   const next=sessionStorage.getItem('clearshift.qa.loop-next');
   if(next){localStorage.setItem('clearshift.run.level1.v3',next);localStorage.removeItem('clearshift.backup.level1.v3');sessionStorage.removeItem('clearshift.qa.loop-next');}
  },E.serialize(journey));
  const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));await page.goto(BASE);
  assert.deepEqual((await snap(page)).state,journey);
  await page.getByRole('button',{name:'Loop level 1 ↻',exact:true}).click();await page.waitForURL('**/?mode=level1');
  assert.equal((await snap(page)).mode,'level1-loop');assert.equal((await snap(page)).prefs.music,.27);assert.equal((await snap(page)).prefs.best,0);
  await page.getByRole('button',{name:'Play level 1 ↗',exact:true}).click();await ready(page);
  assert.equal((await snap(page)).state.flow,1);assert.equal((await snap(page)).transport.track,'Cut It Loose');
  await page.getByRole('button',{name:'Pause game',exact:true}).click();const loopSaved=(await snap(page)).state;
  await page.getByRole('button',{name:'Back to your journey',exact:true}).click();await page.waitForURL(BASE);
  assert.deepEqual((await snap(page)).state,journey);
  await page.getByRole('button',{name:'Resume session ↗',exact:true}).click();await ready(page);
  assert.equal((await snap(page)).scene,2);assert.equal((await snap(page)).transport.scene,2);
  await page.getByRole('button',{name:'Pause game',exact:true}).click();
  const journeySaved=await page.evaluate(()=>localStorage.getItem('clearshift.run.v3'));
  await page.getByRole('button',{name:'Loop level 1 ↻',exact:true}).click();await page.waitForURL('**/?mode=level1');
  assert.deepEqual((await snap(page)).state,loopSaved);
  log('Home/pause mode switching preserves separate runs, including lifted paint and a later journey district');

  const early=E.createGame(112);early.score=775;
  for(let r=0;r<3;r++)for(let c=0;c<8;c++){early.board[r][c]=1+r;early.charge[r][c]=1;}
  await fixture(page,early);await ready(page);
  await page.waitForFunction(()=>Clearshift.snapshot().state.flow===2,{},{timeout:15000});
  let s=await snap(page);assert(s.state.score>800);assert.equal(s.scene,0);assert.equal(s.transport.scene,0);
  assert.equal(s.audio.pendingScene,null);assert.equal(s.transport.bpm,122);assert.equal(s.transport.track,'Cut It Loose');
  assert.match(await page.locator('#chapter-label').textContent(),/LEVEL 1/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('clearshift.run.v3')),journeySaved);
  log('Real sweep collection crosses the normal first district threshold and earns flow 2 while music/art stay in level 1',{score:s.state.score,flow:s.state.flow});
  await page.getByRole('button',{name:'Level 1 loop ↻',exact:true}).click();
  assert.equal(await page.locator('.flow-guide li').count(),8);assert.equal(await page.locator('.district-list').count(),0);

  const high=E.createGame(112);Object.assign(high,{score:50000,beats:255,step:128,flow:7,flowEnergy:198,strongStreak:9,bestFlow:7,lapPaint:16});
  await fixture(page,high);await ready(page);
  await page.waitForFunction(()=>Clearshift.snapshot().transport.beats>257&&Clearshift.snapshot().state.flow===8,{},{timeout:12000});
  s=await snap(page);assert.equal(s.scene,0);assert.equal(s.transport.scene,0);assert.equal(s.transport.bpm,122);assert.equal(s.audio.lastError,null);
  await page.screenshot({path:path.join(OUT,'loop-level-one.png')});
  log('A seeded strong-pass boundary reaches flow 8 across the actual 256-beat song wrap; 50,000 points do not change district',{beats:s.transport.beats,flow:s.state.flow});
  await page.getByRole('button',{name:'Pause game',exact:true}).click();const held=(await snap(page)).state;
  await page.reload();assert.deepEqual((await snap(page)).state,held);
  await page.getByRole('button',{name:'Resume level 1 ↗',exact:true}).click();await ready(page);
  assert.equal((await snap(page)).state.flow,8);assert.equal((await snap(page)).transport.scene,0);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(OUT,'loop-level-one-mobile.png'),fullPage:true});
  log('Loop position, flow and score survive pause/reload; narrow layout identifies the loop');

  const full=E.createGame(112);full.score=50000;full.board=Array.from({length:8},()=>Array(8).fill(1));full.shift=0;
  await fixture(page,full);await page.waitForFunction(()=>Clearshift.snapshot().modal==='end');
  assert.match(await page.locator('.end-stats').textContent(),/LEVEL 1 LOOP/);
  await page.getByRole('button',{name:'Play level 1 again ↻',exact:true}).click();await ready(page);
  s=await snap(page);assert.equal(s.state.score,0);assert.equal(s.state.flow,1);assert.equal(s.scene,0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('clearshift.run.v3')),journeySaved);
  log('Game-over retry stays in loop mode and does not replace journey progress');
  assert.deepEqual(result.errors,[]);result.passed=true;
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'checks.json'),JSON.stringify(result,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
