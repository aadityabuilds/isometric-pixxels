import { chromium } from 'playwright-core';
const [,, url, out, w, h, waitMs, action] = process.argv;
const b = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs=[]; p.on('console', m => { if (m.type()==='error'||m.type()==='warning') logs.push(m.type()+': '+m.text()); }); p.on('pageerror', e => logs.push('pageerror: '+e.message));
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(+waitMs);
if (action) { await eval(action); await p.waitForTimeout(2500); }
await p.screenshot({ path: out });
console.log(logs.slice(0,10).join('\n'));
await b.close();
