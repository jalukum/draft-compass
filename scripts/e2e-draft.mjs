// End-to-end check of the Ranked pick order + screenshots.
// Usage: node scripts/e2e-draft.mjs <baseUrl> <outDir> [prefix]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? '../shots';
const prefix = process.argv[4] ?? 'v3';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const settle = () => page.waitForLoadState('networkidle').catch(() => {}).then(() => page.waitForTimeout(600));
const shot = async (name) => { await settle(); await page.screenshot({ path: `${out}/${prefix}-${name}.png` }); console.log(`${out}/${prefix}-${name}.png`); };
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const counts = async () => ({ us: await page.locator('.team.ally .slot.filled').count(), them: await page.locator('.team.opp .slot.filled').count() });
const heading = () => page.locator('.block h2.us, .block h2.them').first().innerText().catch(() => '');
const top3 = async () => (await page.locator('.sugg li').allInnerTexts()).slice(0, 3).map((t) => t.replace(/\s+/g, ' ')).join(', ');

async function newDraft(first) {
  await page.goto(`${base}#/draft`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes('Based on'), null, { timeout: 20000 });
  await page.locator('input[aria-label="Search maps"]').fill('hard rock');
  await page.locator('.maplist button').first().click();
  await page.locator('.order .seg button', { hasText: first === 'ally' ? 'Us' : 'Them' }).click();
}

for (const first of ['ally', 'opp']) {
  await newDraft(first);
  const seq = [];
  for (let i = 0; i < 6; i++) {
    const h = await heading();
    const before = await counts();
    if (i % 2) await page.locator('.sugg li button').first().click();
    else { // use the search bar on even steps
      const name = (await page.locator('.sugg li').nth(3).innerText()).split('\n')[0].trim();
      await page.locator('.search input').last().fill(name);
      await page.locator('.search input').last().press('Enter');
    }
    const after = await counts();
    const who = after.us > before.us ? 'ally' : after.them > before.them ? 'opp' : '?';
    seq.push(who);
    console.log(`  pick ${i + 1}: list "${h}" -> went to ${who}; top: ${await top3()}`);
    if (first === 'ally' && i === 0) await shot('enemy-turn'); // after our first pick it's their turn
  }
  const want = first === 'ally' ? ['ally', 'opp', 'opp', 'ally', 'ally', 'opp'] : ['opp', 'ally', 'ally', 'opp', 'opp', 'ally'];
  check(JSON.stringify(seq) === JSON.stringify(want), `first pick ${first}: order ${seq.join(' ')}`);
  if (first === 'ally') {
    await page.evaluate(() => { const el = [...document.querySelectorAll('h2')].find((h) => h.textContent.includes('Lane')); el && scrollBy(0, el.getBoundingClientRect().top - 330); });
    await shot('lanes');
    // remove our 2nd pick -> it should be our turn again, and the next pick goes to us
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('.team.ally .slot.filled').nth(1).click();
    const h = await heading();
    check(/for us/i.test(h), `after removing one of ours, list says "${h}"`);
    const b = await counts();
    await page.locator('.sugg li button').first().click();
    const a = await counts();
    check(a.us === b.us + 1, 'refill went to us');
  }
}

// Maps tab
await page.goto(`${base}#/maps`);
await page.waitForSelector('.maplist a');
const groups = await page.locator('.mode-group h4').allInnerTexts();
console.log('mode groups:', groups.join(', '), '| maps:', await page.locator('.maplist a').count());
await shot('maps-list');
await page.locator('.maplist a', { hasText: 'Out In The Open' }).first().click();
await page.waitForSelector('.top10 li');
console.log('Out in the Open top 10:', (await page.locator('.top10 li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
await shot('maps-top10');
await page.locator('button', { hasText: 'Draft on this map' }).click();
await page.waitForSelector('.map-chosen');
check((await page.locator('.map-chosen').innerText()).includes('Out In The Open'), 'Draft on this map opens the draft with that map');
if (errs.length) { console.log('page errors:', errs); failures++; }
console.log(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
