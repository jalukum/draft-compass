// Mobile screenshots showing ladder data. Usage: node scripts/shots-live.mjs <baseUrl> <outDir> [prefix]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? '../shots';
const prefix = process.argv[4] ?? 'live';
const map = process.env.MAP ?? 'hideout-bounty';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const settle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(800));
const shot = async (name) => { await settle(); await page.screenshot({ path: `${out}/${prefix}-${name}.png` }); console.log(`${out}/${prefix}-${name}.png`); };

await page.goto(`${base}#/draft`);
await page.evaluate(() => localStorage.setItem('dc:settings', JSON.stringify({ tourDone: true, favorites: [], sorts: { roster: { by: 'name', dir: 'asc' }, brawlers: { by: 'class', dir: 'asc' } } })));
await page.evaluate((m) => localStorage.setItem('dc:draft', JSON.stringify({ mapSlug: m, phase: 'pick' })), map);
await page.goto(`${base}#/draft?map=${map}`); await page.reload();
await page.waitForSelector('.rec');
await page.waitForFunction(() => document.body.innerText.includes('Ladder stats:'), null, { timeout: 15000 }).catch(() => {});
await settle();
// Count confidence labels by opening each of the top rows.
const labels = [];
const n = await page.locator('.rec-main').count();
for (let i = 0; i < Math.min(n, 8); i++) {
  await page.locator('.rec-main').nth(i).click();
  labels.push(await page.locator('.rec.open .conf').first().innerText().catch(() => '?'));
}
await page.locator('.rec-main').nth(Math.min(n, 8) - 1).click(); // close the last one
console.log('top-8 confidence labels:', labels.join(', '));
console.log(await page.evaluate(() => [...document.querySelectorAll('p.fine')].map((p) => p.innerText).find((t) => t.startsWith('Ladder stats')) ?? 'no ladder line'));
await page.evaluate(() => { const el = document.querySelector('.rec'); scrollBy(0, el.getBoundingClientRect().top - 150); });
await shot('draft-ladder');
await page.locator('.rec-main').first().click();
await page.evaluate(() => { const el = document.querySelector('.rec.open'); if (el) scrollBy(0, el.getBoundingClientRect().top - 70); });
await shot('breakdown');
await page.goto(`${base}#/me`);
await page.waitForFunction(() => document.body.innerText.includes('Ranked games played'), null, { timeout: 15000 }).catch(() => {});
await page.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((x) => x.textContent === 'Data'); if (h) scrollBy(0, h.getBoundingClientRect().top - 70); });
const me = await page.evaluate(() => [...document.querySelectorAll('.facts')].map((d) => d.innerText).join('\n'));
console.log(me);
await shot('me-data');
if (errs.length) console.log('page errors:', errs);
await browser.close();
