import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on('console', m => { if (m.type()==='error' && !m.text().includes('WebSocket')) console.log('console.error', m.text().slice(0,600)); });
await p.goto('http://127.0.0.1:4317/#hoover-tower', { waitUntil: 'networkidle' });
await p.waitForTimeout(6000);
const btn = await p.$('nextjs-portal');
if (btn) { const t = await p.evaluate(() => { const r = document.querySelector('nextjs-portal').shadowRoot; const b=[...r.querySelectorAll('button')].find(x=>/issue/i.test(x.textContent)); b?.click(); return 'clicked'; }); await p.waitForTimeout(1500);
  console.log(await p.evaluate(() => document.querySelector('nextjs-portal').shadowRoot.textContent.slice(0,1500))); }
await b.close();
