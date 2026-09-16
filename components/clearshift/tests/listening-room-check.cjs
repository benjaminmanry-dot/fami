const {chromium}=require(process.env.CLEARSHIFT_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const out=path.resolve(__dirname,'../evidence-radio-rebuild');fs.mkdirSync(out,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4181/listening-room.html');
  await page.waitForFunction(()=>Number.isFinite(document.getElementById('record').duration));
  const duration=await page.locator('#record').evaluate(x=>x.duration);assert(Math.abs(duration-256*60/122)<.001);
  const url='http://127.0.0.1:4181/assets/music/00-cut-it-loose/full-mix.wav';
  const partial=await fetch(url,{headers:{Range:'bytes=0-31'}});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,32);
  const bad=await fetch(url,{headers:{Range:'bytes=999999999-'}});assert.equal(bad.status,416);
  await page.screenshot({path:path.join(out,'listening-room.png'),fullPage:true});
  await page.locator('#record').evaluate(x=>{x.currentTime=100;});
  await page.locator('#try-flow').click();await page.waitForFunction(()=>document.getElementById('try-flow').hidden,{},{timeout:25000});
  assert.equal(await page.locator('#layers button').count(),8);
  for(let i=1;i<=8;i++){await page.getByRole('button',{name:new RegExp('^'+i+' layers:')}).click();assert.match(await page.locator('#layer-copy').textContent(),new RegExp('^'+i+' / 8'));}
  await page.locator('#stop-flow').click();await page.waitForFunction(()=>!document.getElementById('record').paused);
  assert((await page.locator('#record').evaluate(x=>x.currentTime))>=100);
  await page.locator('#record').evaluate(x=>x.pause());
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'listening-room-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const result={passed:true,masterDuration:duration,checked:['master decode','valid/invalid audio byte ranges','seek to second half','eight live flow selections','return to complete song at same position','narrow layout'],errors};
  fs.writeFileSync(path.join(out,'listening-room-checks.json'),JSON.stringify(result,null,2));console.log(result);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
