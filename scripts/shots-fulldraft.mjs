// Full-draft screenshots (iPhone + desktop) showing the win-chance bar. Usage: node scripts/shots-fulldraft.mjs <baseUrl> <outDir> [prefix]
import { chromium } from 'playwright-core';
const base = process.argv[2], out = process.argv[3], prefix = process.argv[4] ?? 'v6';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
for (const d of [{ name: 'iphone', w: 393, h: 852, s: 3, m: true }, { name: 'desktop', w: 1440, h: 900, s: 1, m: false }]) {
  const p = await (await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.s, isMobile: d.m, hasTouch: d.m })).newPage();
  if (d.m) await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ':root{--sat:59px;--sab:34px}'; document.head.append(s); }));
  await p.goto(base + '#/draft'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('dc:tutorialDone', '1'); }); await p.reload();
  await p.waitForFunction(() => document.body.innerText.includes('Based on'), null, { timeout: 20000 });
  await p.locator('.maplist button', { hasText: 'Hard Rock Mine' }).first().click();
  for (const n of ['Mr. P', 'Rico', 'Chester', 'Amber', 'Bo', 'Surge']) { await p.locator('input[placeholder="Search a brawler to ban"]').fill(n); await p.locator('input[placeholder="Search a brawler to ban"]').press('Enter'); }
  const seq = [];
  for (let i = 0; i < 6; i++) {
    await p.locator('.sugg li button').nth(i % 3).click();
    seq.push(await p.locator('.winbar').innerText().catch(() => '(no bar yet)'));
  }
  console.log(d.name, 'win chance after each pick:', seq.map((t) => t.replace(/\s+/g, ' ')).join(' | '));
  if (d.m) await p.evaluate(() => { const el = document.querySelector('.winbar'); scrollBy(0, el.getBoundingClientRect().top - 330); });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${prefix}-${d.name}-full-draft.png` });
  console.log(`${out}/${prefix}-${d.name}-full-draft.png`);
}
await b.close();
