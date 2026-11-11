// Spotlight-tour checks + screenshots. Usage: node scripts/shots-tour.mjs <baseUrl> <outDir> [prefix]
import { chromium } from 'playwright-core';
const base = process.argv[2], out = process.argv[3], prefix = process.argv[4] ?? 'v8-tour';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let bad = 0; const check = (ok, m) => { if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'} ${m}`); if (!ok) bad++; return ok; };
const TARGETS = [['map'], ['bans'], ['picks'], ['sugg'], ['win', 'lanes'], ['maps']];
const shots = { iphone: [1, 3, 5], ipad: [4], desktop: [1, 5] };
for (const d of [
  { name: 'iphone', w: 393, h: 852, s: 3, m: true, safe: [59, 34] },
  { name: 'ipad', w: 820, h: 1180, s: 2, m: true, safe: [24, 20] },
  { name: 'desktop', w: 1440, h: 900, s: 1, m: false, safe: [0, 0] },
]) {
  const p = await (await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.s, isMobile: d.m, hasTouch: d.m })).newPage();
  await p.addInitScript((sf) => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = `:root{--sat:${sf[0]}px;--sab:${sf[1]}px}`; document.head.append(s); }), d.safe);
  await p.goto(base + '#/draft'); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForSelector('.tour-card', { timeout: 15000 });
  check(true, `${d.name}: tour shows on first launch`);
  await p.locator('.tour-skip').click();
  // set up a real draft: Dry Season + one ban, scrolled a bit, then replay the tour from "?"
  await p.locator('.maplist button', { hasText: 'Dry Season' }).click();
  await p.locator('input[aria-label="Search a brawler to ban"]').fill('Shelly');
  await p.locator('.results button').first().click();
  await p.locator('button[aria-label="How to use"]').click();
  for (let i = 0; i < 6; i++) {
    await p.waitForSelector(`.tour-card[data-step="${i + 1}"]`);
    await p.waitForTimeout(700); // let the 200ms re-measure settle after images load
    const r = await p.evaluate((targets) => {
      const R = (e) => { const x = e.getBoundingClientRect(); return { top: x.top, left: x.left, right: x.right, bottom: x.bottom, w: x.width, h: x.height }; };
      const els = targets.flatMap((t) => [...document.querySelectorAll(`[data-tour="${t}"]`)]).map(R).filter((x) => x.w > 0);
      const rings = [...document.querySelectorAll('[data-ring]')].map(R);
      const card = R(document.querySelector('.tour-card'));
      const a = document.querySelector('.tour-arrow'); const arrow = a && { ...R(a), dir: a.classList.contains('up') ? 'up' : 'down' };
      return { els, rings, card, arrow, title: document.querySelector('.tour-card h2').textContent, ih: innerHeight, iw: innerWidth };
    }, TARGETS[i]);
    const tag = `${d.name} step ${i + 1} (${r.title})`;
    check(r.els.length === TARGETS[i].length && r.rings.length === r.els.length, `${tag}: ${r.els.length} target(s), ${r.rings.length} ring(s)`);
    r.els.forEach((e, k) => {
      const g = r.rings[k]; if (!g) return;
      const ok = Math.abs(g.left - (e.left - 6)) < 2.5 && Math.abs(g.top - (e.top - 6)) < 2.5 && Math.abs(g.w - (e.w + 12)) < 2.5 && g.h <= e.h + 14.5 && g.h > 60 * 0 + 20;
      check(ok, `${tag}: ring ${k} lines up with [${TARGETS[i][k] ?? ''}] (el ${Math.round(e.left)},${Math.round(e.top)} ${Math.round(e.w)}x${Math.round(e.h)} / ring ${Math.round(g.left)},${Math.round(g.top)} ${Math.round(g.w)}x${Math.round(g.h)})`);
      check(g.top >= d.safe[0] - 7 && g.bottom <= d.h - d.safe[1] + 7, `${tag}: ring ${k} on screen inside safe area (y ${Math.round(g.top)}–${Math.round(g.bottom)})`);
    });
    check(r.card.top >= d.safe[0] && r.card.bottom <= d.h - d.safe[1] && r.card.left >= 0 && r.card.right <= d.w, `${tag}: card inside safe area (y ${Math.round(r.card.top)}–${Math.round(r.card.bottom)})`);
    const overlap = r.rings.some((g) => !(r.card.bottom <= g.top || r.card.top >= g.bottom || r.card.right <= g.left || r.card.left >= g.right));
    check(!overlap, `${tag}: card does not cover the highlight`);
    if (r.arrow) {
      const ax = (r.arrow.left + r.arrow.right) / 2;
      const pointsAtSomething = r.rings.some((g) => (r.arrow.dir === 'up' ? g.bottom <= r.card.top + 1 : g.top >= r.card.bottom - 1)) && ax >= Math.min(...r.rings.map((g) => g.left)) - 1 && ax <= Math.max(...r.rings.map((g) => g.right)) + 1;
      check(pointsAtSomething, `${tag}: arrow (${r.arrow.dir}) points at the highlight`);
    } else check(false, `${tag}: arrow present`);
    if (i === 1) check(await p.locator('.chip.ban').count() === 2, `${tag}: example draft has 2 bans on Hard Rock Mine`);
    if (shots[d.name].includes(i + 1)) await p.screenshot({ path: `${out}/${prefix}-${d.name}-step${i + 1}.png` });
    if (i === 2) { await p.locator('.tour-btns button', { hasText: 'Back' }).click(); await p.waitForSelector('.tour-card[data-step="2"]'); await p.locator('.tour-btns .primary').click(); await p.waitForSelector('.tour-card[data-step="3"]'); }
    await p.locator('.tour-btns .primary').click();
  }
  check(await p.locator('.tour-card').count() === 0, `${d.name}: Done closes the tour`);
  const real = await p.evaluate(() => ({ map: document.querySelector('.map-chosen b')?.textContent, bans: document.querySelectorAll('.chip.ban').length, ally: document.querySelectorAll('.team.ally .slot.filled').length }));
  check(real.map === 'Dry Season' && real.bans === 1 && real.ally === 0, `${d.name}: real draft restored (${JSON.stringify(real)})`);
  await p.reload(); await p.waitForTimeout(2000);
  check(await p.locator('.tour-card').count() === 0, `${d.name}: stays closed after reload`);
  // Maps tab: map layout image after selecting a map; Draft tab unchanged
  check(await p.locator('.map-img').count() === 0, `${d.name}: no map image on Draft tab`);
  await p.goto(base + '#/maps/hard-rock-mine-gem-grab'); await p.waitForSelector('.map-img img');
  await p.waitForFunction(() => document.querySelector('.map-img img').naturalWidth > 0, null, { timeout: 15000 }).catch(() => {});
  const im = await p.evaluate(() => { const i = document.querySelector('.map-img img'); const r = i.getBoundingClientRect(); return { nw: i.naturalWidth, w: r.width, h: r.height, top10: !!document.querySelector('.top10') }; });
  check(im.nw > 0 && im.w > 0 && im.w <= d.w && im.top10, `${d.name}: Maps tab shows map layout (${im.nw}px natural, ${Math.round(im.w)}x${Math.round(im.h)})`);
  await p.screenshot({ path: `${out}/${prefix}-maps-image-${d.name}.png` });
  await p.locator('.map-img').click();
  check(await p.locator('.map-big').count() === 1, `${d.name}: tap opens larger map`);
  if (d.name === 'iphone') await p.screenshot({ path: `${out}/${prefix}-maps-image-large-iphone.png` });
  await p.locator('.map-big').click();
  check(await p.locator('.map-big').count() === 0, `${d.name}: tap closes it`);
  console.log(`${d.name}: done`);
}
console.log(bad ? `${bad} FAILURE(S)` : 'ALL CHECKS PASSED');
await b.close();
