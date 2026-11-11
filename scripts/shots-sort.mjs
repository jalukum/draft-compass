// Screenshots for the sort controls (393x852). Usage: node scripts/shots-sort.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? '../shots';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const over = async (l) => { const r = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); console.log(`${l}: ${r[0]}/${r[1]}${r[0] > r[1] ? ' OVERFLOW' : ' ok'}`); };
const settle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(600));

await page.goto(`${base}#/brawlers`);
await page.evaluate(() => localStorage.setItem('dc:settings', JSON.stringify({ tourDone: true })));
await page.reload(); await page.waitForSelector('.b-card');
for (const n of ['Piper', 'Gene']) await page.locator(`.btn.fav[aria-label="Favorite ${n}"]`).click();
await page.getByRole('radio', { name: 'Class' }).click();
await page.locator('.sort-ctl').scrollIntoViewIfNeeded();
await page.evaluate(() => { const el = document.querySelector('.sort-ctl'); scrollBy(0, el.getBoundingClientRect().top - 12); });
await settle(); await over('brawlers/class');
await page.screenshot({ path: `${out}/iphone-10-brawlers-class.png` });

await page.goto(`${base}#/draft?map=hard-rock-mine-gem-grab`);
await page.waitForSelector('.roster .sort-ctl');
await page.locator('.roster .sort-ctl').getByRole('radio', { name: 'Rarity' }).click();
await page.evaluate(() => { const el = document.querySelector('.roster .sort-ctl'); scrollBy(0, el.getBoundingClientRect().top - 12); });
await settle(); await over('roster/rarity');
await page.screenshot({ path: `${out}/iphone-09-roster-rarity.png` });
// flip direction + persistence check
await page.locator('.roster .sort-dir').click();
await page.reload(); await page.waitForSelector('.roster .sort-ctl');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dc:settings')).sorts);
const firstHead = await page.locator('.roster .group-head span').nth(1).textContent();
console.log('saved sorts', JSON.stringify(saved), '| first rarity group after flip+reload:', firstHead);
console.log('page errors:', errs.length ? errs : 'none');
await browser.close();
