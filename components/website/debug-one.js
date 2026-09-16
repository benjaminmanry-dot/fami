const { chromium } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext({viewport:{width:1440,height:2200}});
 const p=await ctx.newPage();
 console.log('goto');
 await p.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded'});
 console.log('shot');
 await p.screenshot({path:'tmp-one.png',fullPage:true});
 console.log('done');
 await browser.close();
})();
