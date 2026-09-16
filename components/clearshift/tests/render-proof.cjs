const {chromium}=require(process.env.CLEARSHIFT_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();await page.goto((process.env.CLEARSHIFT_URL||'http://127.0.0.1:4181/')+'tests/audio-proof.html');
  await page.locator('#render').click();await page.waitForFunction(()=>window.__csProofStatus==='complete'||window.__csProofStatus==='failed',{},{timeout:60000});
  const result=await page.evaluate(()=>({stats:window.__csAudioStats,error:window.__csProofError}));assert.equal(result.error,null);
  assert.equal(result.stats.clippedSamples,0);assert.equal(result.stats.nonfiniteSamples,0);assert(result.stats.stereoDifferenceRms>.001);assert(result.stats.rmsDbFS>-35);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);
  const out=path.resolve(__dirname,'../evidence-radio-rebuild');fs.mkdirSync(out,{recursive:true});await download.saveAs(path.join(out,'cut-it-loose-flow-demonstration.wav'));
  fs.writeFileSync(path.join(out,'browser-audio-render.json'),JSON.stringify(result.stats,null,2));console.log(result.stats);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
