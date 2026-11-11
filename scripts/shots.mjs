// Playwright screenshots + horizontal-overflow check. Usage: node scripts/shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? '../shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const report = [];

async function overflow(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
  const bad = r.sw > r.cw || r.bw > r.cw;
  report.push(`${label}: scrollWidth ${r.sw} / clientWidth ${r.cw}${bad ? '  <-- OVERFLOW' : ' ok'}`);
}
const settle = (page) => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(500));

async function run(name, ctxOpts, phone) {
  const FULL = phone;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.push(`${name} PAGE ERROR: ${e.message}`));
  const shot = async (id, full = FULL) => { await settle(page); await overflow(page, `${name}/${id}`); await page.screenshot({ path: `${out}/${name}-${id}.png`, fullPage: full }); };
  const tap = (sel) => page.locator(sel).first().click();
  const roster = (n) => tap(`.roster-cell[aria-label$=" ${n}"]`);

  await page.goto(`${base}#/draft`);
  await page.waitForSelector('.map-chip');
  await page.waitForSelector('.tour-card');
  await shot('01-first-visit-tour', false);
  await page.getByRole('button', { name: 'Skip' }).click();

  await tap('.map-chip');
  await page.fill('.sheet .search', 'Hard Rock');
  await shot('02-map-picker', false);
  await tap('.map-card');
  for (const n of ['Kit', 'Mortis', 'Sandy', 'Gus', 'Byron', 'Bea']) await roster(n);
  await roster('Gene');           // ally first pick
  await roster('Bull');           // opp
  await roster('Piper');          // opp
  await page.waitForSelector('.rec');
  await shot('03-draft-midway');
  await tap('.rec-main');
  if (phone) await page.locator('.rec.open').scrollIntoViewIfNeeded(); else await page.evaluate(() => scrollTo(0, 0));
  await shot('04-breakdown-open', false);
  // finish the draft
  await tap('.rec.open .btn.primary');
  await roster('Poco');
  await roster('Edgar');
  await page.waitForSelector('.full-read');
  if (phone) await page.locator('.full-read').scrollIntoViewIfNeeded(); else await page.evaluate(() => scrollTo(0, 0));
  await shot('05-full-draft-lean-lanes', false);
  if (phone) await shot('05b-full-draft-page');
  await page.goto(`${base}#/brawlers`); await page.waitForSelector('.b-card');
  await shot('06-brawlers', false);
  await page.goto(`${base}#/maps`); await page.waitForSelector('.map-card');
  await shot('07-maps', false);
  await tap('.map-card');
  await shot('07b-map-detail', false);
  await page.goto(`${base}#/me`); await page.waitForSelector('.preset');
  await shot('08-settings');
  await ctx.close();
}

await run('iphone', { reducedMotion: 'reduce', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }, true);
await run('desktop', { reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } }, false);
await browser.close();
console.log(report.join('\n'));
