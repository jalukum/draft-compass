// Lane matchups with kits: iPhone and desktop (and iPad for a sanity check).
// Usage: node scripts/shots-kits.mjs <baseUrl> <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? '../shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const devices = [
  { file: 'v12-kits-iphone.png', w: 393, h: 852, mobile: true, scale: 3, safe: { top: 59, bottom: 34 } },
  { file: 'v12-kits-ipad.png', w: 820, h: 1180, mobile: true, scale: 2, safe: { top: 24, bottom: 20 } },
  { file: 'v12-kits-desktop.png', w: 1440, h: 900, mobile: false, scale: 1 },
];

async function draft(page) {
  await page.waitForFunction(() => document.body.innerText.includes('Based on') || document.body.innerText.includes('Lane matchups'), null, { timeout: 25000 });
  const mapBtn = page.locator('.maplist button').first();
  await mapBtn.waitFor({ timeout: 20000 });
  await mapBtn.click();
  for (const b of ['Mr. P', 'Rico', 'Chester', 'Amber', 'Bo', 'Surge']) {
    const box = page.locator('input[placeholder="Search a brawler to ban"]');
    await box.fill(b);
    await box.press('Enter');
  }
  // Fill all six picks from the suggestion list (1-2-2-1).
  for (let i = 0; i < 6; i++) {
    const btn = page.locator('.sugg li button').first();
    await btn.waitFor({ timeout: 10000 });
    await btn.click();
    await page.waitForTimeout(150);
  }
  await page.locator('.lanes').waitFor({ timeout: 10000 });
  // Wait until at least one kit icon or kit name is visible.
  await page.waitForFunction(() => document.querySelectorAll('.lane-kit .ki').length >= 6, null, { timeout: 15000 });
}

let problems = 0;
for (const d of devices) {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.scale, isMobile: d.mobile, hasTouch: d.mobile });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const safe = async () => { if (d.safe) await page.addStyleTag({ content: `:root{--sat:${d.safe.top}px;--sab:${d.safe.bottom}px}` }); };
  await page.goto(`${base}#/draft`);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('dc:tutorialDone', '1'); });
  await page.reload(); await safe();
  await draft(page);
  const block = page.locator('section.block', { has: page.locator('.lanes') });
  // Keep the block clear of the phone tab bar when taking the shot.
  await page.evaluate((nav) => {
    const el = document.querySelector('section.block:has(.lanes)');
    if (!el) return;
    const bar = window.matchMedia('(min-width: 768px)').matches ? 0 : nav;
    const top = el.getBoundingClientRect().top + window.scrollY - 8;
    const bottom = el.getBoundingClientRect().bottom + window.scrollY + bar + 8;
    if (bottom > window.scrollY + window.innerHeight) {
      window.scrollTo(0, Math.max(0, bottom - window.innerHeight));
    } else {
      window.scrollTo(0, Math.max(0, top));
    }
  }, d.safe ? (d.safe.bottom + 52) : 52);
  await page.waitForTimeout(400);
  const dest = join(out, d.file);
  await block.screenshot({ path: dest });
  const nKits = await page.locator('.lane-kit .ki').count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (nKits < 6 || overflow) problems++;
  console.log(`${d.file}: kits=${nKits} overflow=${overflow}${errs.length ? ' errors=' + errs.join('; ') : ''} -> ${dest}`);
  if (errs.length) problems++;
  await ctx.close();
}
console.log(problems ? `${problems} PROBLEM(S)` : 'ALL OK');
await browser.close();
process.exit(problems ? 1 : 0);
