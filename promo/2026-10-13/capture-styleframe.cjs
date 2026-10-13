const { chromium } = require('C:/Users/yyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('path');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/yyh/AppData/Local/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-win64/chrome-headless-shell.exe'});
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 await page.goto('file:///'+path.resolve(__dirname,'styleframe.html').replace(/\\/g,'/'));
 await page.evaluate(()=>document.fonts.ready);
 for(let i=0;i<3;i++){await page.evaluate(y=>window.scrollTo(0,y),i*1080);await page.screenshot({path:path.join(__dirname,`out/qa/styleframe-${i+1}.png`)});}
 await browser.close();
})();
