// Responsive screenshots: iPhone (with an emulated standalone safe area), iPad portrait/landscape, desktop.
// Usage: node scripts/shots-responsive.mjs <baseUrl> <outDir> [prefix]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? '../shots';
const prefix = process.argv[4] ?? 'v4';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const devices = [
  { name: 'iphone', w: 393, h: 852, mobile: true, scale: 3, safe: { top: 59, bottom: 34 } },
  { name: 'ipad-portrait', w: 820, h: 1180, mobile: true, scale: 2, safe: { top: 24, bottom: 20 } },
  { name: 'ipad-landscape', w: 1180, h: 820, mobile: true, scale: 2, safe: { top: 24, bottom: 20 } },
  { name: 'desktop', w: 1440, h: 900, mobile: false, scale: 1 },
];
let problems = 0;
for (const d of devices) {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.scale, isMobile: d.mobile, hasTouch: d.mobile });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  // Chrome reports env(safe-area-inset-*) as 0, so emulate iOS standalone insets through our CSS variables.
  const safe = async () => { if (d.safe) await page.addStyleTag({ content: `:root{--sat:${d.safe.top}px;--sab:${d.safe.bottom}px}` }); };
  const settle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(700));
  const shot = async (n) => { await settle(); const f = `${out}/${prefix}-${d.name}-${n}.png`; await page.screenshot({ path: f }); console.log(f); };
  const check = async (label) => {
    const r = await page.evaluate((sat) => {
      const h1 = document.querySelector('h1').getBoundingClientRect();
      const nav = document.querySelector('.nav').getBoundingClientRect();
      return { h1Top: Math.round(h1.top), navBottom: Math.round(nav.bottom), navH: Math.round(nav.height), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    const bad = (d.safe && r.h1Top < d.safe.top) || r.sw > r.cw;
    if (bad) problems++;
    console.log(`${d.name} ${label}: title top ${r.h1Top}px${d.safe ? ` (status bar ${d.safe.top}px)` : ''}, nav h ${r.navH}, overflow ${r.sw > r.cw} ${bad ? 'PROBLEM' : 'ok'}`);
  };
  await page.goto(`${base}#/draft`);
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await safe();
  await page.waitForFunction(() => document.body.innerText.includes('Based on'), null, { timeout: 20000 });
  await check('opening');
  await shot('opening');
  // mid-draft: map, 6 bans, 4 picks (enemy turn next is pick 5? 1-2-2-1 with us first: picks 1..4 -> next is us; do 3 -> next us)
  await page.locator('.maplist button', { hasText: 'Hard Rock Mine' }).first().click();
  for (const b of ['Mr. P', 'Rico', 'Chester', 'Amber', 'Bo', 'Surge']) {
    await page.locator('input[placeholder="Search a brawler to ban"]').fill(b);
    await page.locator('input[placeholder="Search a brawler to ban"]').press('Enter');
  }
  for (let i = 0; i < 4; i++) await page.locator('.sugg li button').nth(i === 1 ? 2 : 0).click();
  await page.evaluate(() => scrollTo(0, 0)); await safe();
  await check('mid-draft');
  await shot('draft');
  if (d.name === 'iphone') { await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await shot('draft-bottom'); }
  await page.goto(`${base}#/maps/out-in-the-open-knockout`); await page.reload(); await safe();
  await page.waitForSelector('.top10 li');
  await check('maps');
  await shot('maps');
  if (errs.length) { console.log('page errors', errs); problems++; }
  await ctx.close();
}
console.log(problems ? `${problems} PROBLEM(S)` : 'ALL OK');
await browser.close();
