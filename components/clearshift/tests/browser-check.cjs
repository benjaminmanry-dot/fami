/* Optional integration checks against the running preview, in a fresh browser
 * profile. Uses installed Chrome and Playwright; never touches a player's save. */
'use strict';
const {chromium}=require(process.env.CLEARSHIFT_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../js/sweep-engine.js');
const URL=process.env.CLEARSHIFT_URL||'http://127.0.0.1:4181/';
const OUT=path.resolve(__dirname,'../evidence-radio-rebuild');
fs.mkdirSync(OUT,{recursive:true});
const snapshot=page=>page.evaluate(()=>Clearshift.snapshot());
const ready=page=>page.waitForFunction(()=>Clearshift.snapshot().running&&!Clearshift.snapshot().busy,{},{timeout:20000});
const fixturePages=new WeakSet();
async function load(page,s){
 if(page.url()==='about:blank')await page.goto(URL);
 if(!fixturePages.has(page)){await page.addInitScript(()=>{const raw=sessionStorage.getItem('clearshift.qa.next');if(raw){localStorage.setItem('clearshift.run.v3',raw);localStorage.removeItem('clearshift.backup.v3');sessionStorage.removeItem('clearshift.qa.next');}});fixturePages.add(page);}
 // Apply after pagehide has safely saved the previous run, before app startup.
 await page.evaluate(raw=>sessionStorage.setItem('clearshift.qa.next',raw),E.serialize(s));
 await page.reload();await page.getByRole('button',{name:'Resume session ↗',exact:true}).click();await ready(page);
}
function sparse(){const s=E.createGame(112);s.shift=1;s.tray=[{id:'three-h',color:1},null,{id:'dot',color:2}];s.board[1][1]=2;s.board[1][3]=3;s.board[4][5]=1;return s;}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const results={kind:'Chrome integration in isolated QA contexts',checks:[],errors:[],passed:false};
 const log=(name,data={})=>{results.checks.push({name,...data});console.log(name);};
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',e=>results.errors.push(e.message));
  await page.goto(URL);assert.equal((await snapshot(page)).started,false);
  await page.getByRole('button',{name:'Learn the rhythm',exact:true}).click();await ready(page);
  await page.keyboard.press('1');for(let i=0;i<6;i++)await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  assert.equal((await snapshot(page)).tutorial,2);await page.waitForFunction(()=>Clearshift.snapshot().tutorial===3,{},{timeout:15000});
  await page.keyboard.press('s');await page.getByRole('gridcell',{name:'Row 3, column 2: paint 2',exact:true}).click();
  const held=(await snapshot(page)).state.held;assert.equal(held.pieces.length,2);
  await page.getByRole('gridcell',{name:'Row 5, column 6: empty',exact:true}).click();
  const dropped=(await snapshot(page)).state;assert.deepEqual(dropped.board[4].slice(5,8),[2,1,3]);assert.equal(dropped.shift,0);
  await page.waitForFunction(()=>Clearshift.snapshot().tutorial===6,{},{timeout:15000});
  log('Keyboard placement and real-time sweep tutorial; sparse Shift hole leaves destination paint intact');
  await page.getByRole('button',{name:'Start your session ↗',exact:true}).click();await ready(page);
  await page.getByRole('button',{name:'Pause game',exact:true}).click();const paused=await snapshot(page);
  await page.waitForTimeout(260);const still=await snapshot(page);assert.equal(still.state.beats,paused.state.beats);assert.equal(still.transport.playing,false);
  log('Pause freezes the puzzle clock and audio transport');
  await load(page,sparse());
  await page.keyboard.press('s');await page.getByRole('button',{name:'Shape 1: Three across, use as stencil',exact:true}).click();
  await page.getByRole('gridcell',{name:'Row 2, column 2: paint 2',exact:true}).click();
  await page.getByRole('button',{name:'Pause game',exact:true}).click();const before=(await snapshot(page)).state;
  await page.reload();const restored=await snapshot(page);assert.deepEqual(restored.state.held,before.held);assert.equal(restored.state.beats,before.beats);
  await page.getByRole('button',{name:'Resume session ↗',exact:true}).click();await ready(page);
  await page.getByRole('button',{name:'Return paint',exact:true}).click();const canceled=(await snapshot(page)).state;
  assert.equal(canceled.shift,1);assert.equal(canceled.held,null);assert.deepEqual(canceled.board,sparse().board);
  log('Held sparse paint and clock survive reload; cancellation restores exactly and keeps Shift');
  await page.getByRole('button',{name:'Your route · 1/9',exact:true}).click();
  assert.equal(await page.locator('.district-list li').count(),9);assert.equal(await page.locator('.flow-guide li').count(),8);
  await page.screenshot({path:path.join(OUT,'route.png')});
  log('Route shows nine score districts and eight named flow tiers');
  // Give a single charged cell enough score to earn each next scene. The
  // initial sweep is real; screenshots remain labelled seeded fixtures.
  for(let scene=1;scene<9;scene++){
   const s=E.createGame(112);s.score=E.DISTRICTS[scene].score-25;s.board[0][0]=1;s.charge[0][0]=1;
   await load(page,s);await page.waitForFunction(i=>Clearshift.snapshot().scene===i,scene,{timeout:20000});
   const got=await snapshot(page);assert.equal(got.transport.scene,scene);assert.equal(got.state.score,E.DISTRICTS[scene].score);
   assert.equal(got.audio.lastError,null);assert(Math.abs(got.transport.beats-got.state.beats)<.2);assert.equal(got.transport.bpm,112);
   log('Earned transition to '+E.DISTRICTS[scene].name,{beat:got.transport.beats,transportScene:got.transport.scene});
  }
  const final=await snapshot(page);assert.equal(final.scene,8);
  await page.getByRole('button',{name:'Pause game',exact:true}).click();await context.close();
  // A touch-only context checks the preview/commit path, not mouse events
  // masquerading as touch. It also checks the narrow layout.
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),touch=await mobile.newPage();
  touch.on('pageerror',e=>results.errors.push(e.message));await load(touch,sparse());
  await touch.getByRole('button',{name:'Use Shift ↗',exact:true}).tap();await touch.getByRole('button',{name:'Shape 1: Three across, use as stencil',exact:true}).tap();
  await touch.getByRole('gridcell',{name:'Row 2, column 2: paint 2',exact:true}).tap();assert.equal((await snapshot(touch)).state.held,null);
  await touch.getByRole('button',{name:'Lift paint ↵',exact:true}).tap();assert.equal((await snapshot(touch)).state.held.pieces.length,2);
  await touch.getByRole('gridcell',{name:'Row 5, column 5: empty',exact:true}).tap();await touch.getByRole('button',{name:'Put paint down ↵',exact:true}).tap();
  assert.deepEqual((await snapshot(touch)).state.board[4].slice(4,7),[2,1,3]);assert(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await touch.screenshot({path:path.join(OUT,'touch-shift.png'),fullPage:true});log('Touch previews before committing sparse Shift; narrow layout has no horizontal overflow');await mobile.close();
  // Loading failures must release the start state and keep the silent game
  // playable, rather than leaving the board unresponsive.
  const failContext=await browser.newContext(),failPage=await failContext.newPage();
  await failPage.route('**/assets/music/**',route=>route.abort());await failPage.goto(URL);
  await failPage.getByRole('button',{name:'Drop in ↗',exact:true}).click();await ready(failPage);
  const failure=await snapshot(failPage);assert(failure.audio.lastError);assert.equal(failure.busy,false);
  await failPage.waitForTimeout(200);assert((await snapshot(failPage)).state.beats>failure.state.beats);
  log('Unavailable audio falls back to a moving, playable puzzle clock');
  const silent=E.createGame(122);silent.score=775;silent.board[0][7]=1;silent.charge[0][7]=1;
  await load(failPage,silent);await failPage.waitForFunction(()=>Clearshift.snapshot().scene===1,{},{timeout:15000});
  const silentBefore=(await snapshot(failPage)).state.beats;await failPage.waitForTimeout(500);
  const silentAfter=(await snapshot(failPage)).state.beats;
  assert(silentAfter-silentBefore>.7&&silentAfter-silentBefore<1.2);
  log('Silent clock also changes tempo continuously at a district boundary');await failContext.close();
  assert.deepEqual(results.errors,[]);results.passed=true;
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'browser-checks.json'),JSON.stringify(results,null,2));}
 console.log('All browser integration checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
