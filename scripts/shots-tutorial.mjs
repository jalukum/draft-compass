// Tutorial checks + screenshots. Usage: node scripts/shots-tutorial.mjs <baseUrl> <outDir> [prefix]
import { chromium } from 'playwright-core';
const base = process.argv[2], out = process.argv[3], prefix = process.argv[4] ?? 'v7-tutorial';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let bad = 0; const check = (ok, m) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${m}`); if (!ok) bad++; };
for (const d of [
  { name: 'iphone', w: 393, h: 852, s: 3, m: true, safe: [59, 34] },
  { name: 'ipad', w: 820, h: 1180, s: 2, m: true, safe: [24, 20] },
  { name: 'desktop', w: 1440, h: 900, s: 1, m: false },
]) {
  const p = await (await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.s, isMobile: d.m, hasTouch: d.m })).newPage();
  if (d.safe) await p.addInitScript((sf) => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = `:root{--sat:${sf[0]}px;--sab:${sf[1]}px}`; document.head.append(s); }), d.safe);
  await p.goto(base + '#/draft'); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForSelector('.tour-card', { timeout: 15000 });
  check(true, `${d.name}: tutorial shows on first launch`);
  const card = await p.locator('.tour-card').boundingBox();
  if (d.safe) check(card.y >= d.safe[0] && card.y + card.height <= d.h - d.safe[1], `${d.name}: card inside safe area (y ${Math.round(card.y)}–${Math.round(card.y + card.height)})`);
  const titles = [];
  for (let i = 0; i < 5; i++) {
    titles.push(await p.locator('.tour-card h2').innerText());
    if (d.name === 'iphone' && (i === 0 || i === 2)) await p.screenshot({ path: `${out}/${prefix}-iphone-step${i + 1}.png` });
    if (d.name === 'desktop' && i === 0) await p.screenshot({ path: `${out}/${prefix}-desktop-step1.png` });
    if (d.name === 'ipad' && i === 3) await p.screenshot({ path: `${out}/${prefix}-ipad-step4.png` });
    if (i === 1) { await p.locator('.tour-btns button', { hasText: 'Back' }).click(); await p.locator('.tour-btns button', { hasText: 'Next' }).click(); }
    await p.locator('.tour-btns .primary').click();
  }
  console.log(`${d.name} steps: ${titles.join(' → ')}`);
  check(await p.locator('.tour-card').count() === 0, `${d.name}: Done closes it`);
  await p.reload(); await p.waitForTimeout(2500);
  check(await p.locator('.tour-card').count() === 0, `${d.name}: stays closed after reload`);
  await p.locator('button[aria-label="How to use"]').click();
  check(await p.locator('.tour-card').count() === 1, `${d.name}: ? replays it`);
  await p.locator('.tour-skip').click();
  check(await p.locator('.tour-card').count() === 0, `${d.name}: Skip closes it`);
  // Maps tab keeps the map layout image + full-screen view; Draft tab has none
  check(await p.locator('.map-img').count() === 0, `${d.name}: no map image on Draft tab`);
  await p.goto(base + '#/maps/hard-rock-mine-gem-grab');
  await p.waitForFunction(() => document.querySelector('.map-img img')?.naturalWidth > 0, null, { timeout: 15000 }).catch(() => {});
  check(await p.evaluate(() => document.querySelector('.map-img img')?.naturalWidth > 0), `${d.name}: Maps tab shows the map layout`);
  await p.locator('.map-img').click(); check(await p.locator('.map-big').count() === 1, `${d.name}: tap opens full-screen map`);
  await p.locator('.map-big').click(); check(await p.locator('.map-big').count() === 0, `${d.name}: tap closes it`);
}
console.log(bad ? `${bad} FAILURE(S)` : 'ALL CHECKS PASSED');
await b.close();
