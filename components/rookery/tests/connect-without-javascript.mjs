import '../scripts/gaming-preflight.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const base=(process.env.ROOKERY_URL??'http://127.0.0.1:8790').replace(/\/$/,'');
const origin=new URL(base);
assert.ok(['127.0.0.1','localhost','the-rookery.benjamin-manry.chatgpt.site'].includes(origin.hostname));
const label=origin.hostname==='the-rookery.benjamin-manry.chatgpt.site'?'live':'local';
const output=`work/connect-ssr/${label}`;
await mkdir(output,{recursive:true});
const checks=[];
function check(name,value){assert.ok(value,name);checks.push(name);console.log('PASS '+name);}
const decode=text=>text.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const response=await fetch(base+'/connect');
check('Connection guide serves successfully',response.status===200);
const html=await response.text();
await writeFile(`${output}/connect.html`,html);
const match=/<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html);
check('Raw HTML contains a copyable MCP configuration',match);
const config=JSON.parse(decode(match[1]));
check('Raw configuration uses the complete current origin',config.mcpServers.rookery.url===base+'/api/v1/mcp');
check('Raw configuration contains only a credential placeholder',config.mcpServers.rookery.headers.Authorization==='Bearer ${ROOKERY_TOKEN}');
const status=await fetch(base+'/api/v1/status').then(r=>{assert.equal(r.status,200);return r.json();});
check('Fixture has a recorded host check',!!status.last_host_check);
const stamp=status.last_host_check.slice(0,16).replace('T',' ')+' UTC';
check('Raw HTML contains the recorded host time',html.includes(stamp));
check('Raw HTML contains the current public host note',decode(html).includes(status.host_note));
check('Raw HTML does not claim the first check is pending',!html.includes('First check pending'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
try{
  for(const js of [false,true]){
    const context=await browser.newContext({javaScriptEnabled:js,viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/connect');
    const prefix=js?'Browser with JavaScript':'Browser without JavaScript';
    check(`${prefix} has the same MCP endpoint`,JSON.parse(await page.locator('pre').innerText()).mcpServers.rookery.url===base+'/api/v1/mcp');
    check(`${prefix} has the recorded host time`,(await page.locator('.host-check strong').innerText())===stamp);
    if(js){
      await page.getByRole('textbox',{name:/Public agent name/}).fill('ssr-check-only');
      check('Registration inputs remain interactive',await page.getByRole('textbox',{name:/Public agent name/}).inputValue()==='ssr-check-only');
      await page.screenshot({path:`${output}/desktop.png`,fullPage:true});
      await page.setViewportSize({width:390,height:844});
      check('Mobile guide has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:`${output}/mobile.png`,fullPage:true});
    }
    await context.close();
  }
  check('No hydration or browser runtime errors',errors.length===0);
}finally{await browser.close();}
await writeFile(`${output}/evidence.json`,JSON.stringify({checked_at:new Date().toISOString(),base,checks,errors,writes:0},null,2));
