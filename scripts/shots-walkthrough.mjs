// Walkthrough checks + screenshots. Usage: node scripts/shots-walkthrough.mjs <baseUrl> <outDir> [prefix]
// iPhone and desktop do every action by hand through the spotlight holes; iPad taps Next on every step.
import { chromium } from 'playwright-core';
const base = process.argv[2], out = process.argv[3], prefix = process.argv[4] ?? 'v9-walkthrough';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let bad = 0, n = 0; const check = (ok, m) => { n++; if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'} ${m}`); if (!ok) bad++; return ok; };
const IDS = ['map', 'ban', 'unban', 'first', 'pick', 'enemylist', 'enemysearch', 'remove', 'score', 'win', 'lanes', 'reset', 'mapstab', 'draftmap'];
const TARGETS = { map: ['mapstart'], ban: ['bans'], unban: ['banchips'], first: ['first'], pick: ['turn', 'sugg'], enemylist: ['sugg'], enemysearch: ['picksearch'], remove: ['teams'], score: ['sugg'], win: ['win'], lanes: ['lanes'], reset: ['reset'], mapstab: ['maps'], draftmap: ['draftmap'] };
const SHOTS = { iphone: ['ban', 'pick', 'enemylist', 'remove', 'lanes', 'mapstab', 'draftmap'], ipad: ['score'], desktop: ['pick', 'lanes'] };
const st = (p) => p.evaluate(() => ({
  map: document.querySelector('.map-chosen b')?.textContent ?? null, bans: document.querySelectorAll('.chip.ban').length,
  us: document.querySelectorAll('.team.ally .slot.filled').length, them: document.querySelectorAll('.team.opp .slot.filled').length,
  turn: document.querySelector('.next b')?.textContent ?? null, head: document.querySelector('.sugg-head')?.firstChild?.textContent ?? null,
  lanes: [...document.querySelectorAll('.lane-b.ally span:not(.muted)')].map((e) => e.textContent).join(','), hash: location.hash,
}));
for (const d of [
  { name: 'iphone', w: 393, h: 852, s: 3, m: true, safe: [59, 34], manual: true },
  { name: 'ipad', w: 820, h: 1180, s: 2, m: true, safe: [24, 20], manual: false },
  { name: 'desktop', w: 1440, h: 900, s: 1, m: false, safe: [0, 0], manual: true },
]) {
  const p = await (await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.s, isMobile: d.m, hasTouch: d.m })).newPage();
  await p.addInitScript((sf) => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = `:root{--sat:${sf[0]}px;--sab:${sf[1]}px}`; document.head.append(s); }), d.safe);
  await p.goto(base + '#/draft'); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForSelector('.tour-card', { timeout: 15000 });
  check(true, `${d.name}: walkthrough shows on first launch`);
  await p.locator('.tour-skip').click();
  // the user's real draft: Dry Season + one ban
  await p.locator('.maplist button', { hasText: 'Dry Season' }).click();
  await p.locator('input[aria-label="Search a brawler to ban"]').fill('Shelly');
  await p.locator('.results button').first().click();
  const before = await st(p);
  await p.locator('button[aria-label="How to use"]').click();
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i], tag = `${d.name} ${i + 1}/${IDS.length} ${id}`;
    await p.waitForSelector(`.tour-card[data-id="${id}"]`, { timeout: 8000 }).catch(() => {});
    if (!check(await p.locator(`.tour-card[data-id="${id}"]`).count() === 1, `${tag}: step shown`)) break;
    await p.waitForTimeout(500);
    const layout = async (label) => {
      const r = await p.evaluate((targets) => {
        const R = (e) => { const x = e.getBoundingClientRect(); return { top: x.top, left: x.left, right: x.right, bottom: x.bottom, w: x.width, h: x.height }; };
        const els = targets.flatMap((t) => [...document.querySelectorAll(`[data-tour="${t}"]`)]).map(R).filter((x) => x.w > 0);
        const rings = [...document.querySelectorAll('[data-ring]')].map(R);
        const card = R(document.querySelector('.tour-card'));
        const a = document.querySelector('.tour-arrow'); const arrow = a && { ...R(a), dir: a.classList.contains('up') ? 'up' : 'down' };
        // the help button sits outside every hole: a tap there must hit the shade, not the button
        const hb = document.querySelector('button[aria-label="How to use"]').getBoundingClientRect();
        const hit = document.elementFromPoint(hb.left + hb.width / 2, hb.top + hb.height / 2);
        return { els, rings, card, arrow, blocked: hit?.classList?.contains('tour-shade') || hit?.closest?.('.tour-card') !== null || hb.bottom < 0 };
      }, TARGETS[id]);
      check(r.els.length === TARGETS[id].length && r.rings.length === r.els.length, `${tag}${label}: ${r.els.length} target(s), ${r.rings.length} ring(s)`);
      r.els.forEach((e, k) => {
        const g = r.rings[k]; if (!g) return;
        const clippedTop = e.top < d.safe[0];
        const ok = Math.abs(g.left - (e.left - 6)) < 1.5 && Math.abs(g.w - (e.w + 12)) < 1.5 && (clippedTop || Math.abs(g.top - (e.top - 6)) < 1.5) && g.h <= e.h + 13.5 && g.h >= 30;
        check(ok, `${tag}${label}: ring ${k} lines up (el ${Math.round(e.left)},${Math.round(e.top)} ${Math.round(e.w)}x${Math.round(e.h)} / ring ${Math.round(g.left)},${Math.round(g.top)} ${Math.round(g.w)}x${Math.round(g.h)})`);
        check(g.top >= d.safe[0] - 7 && g.bottom <= d.h - d.safe[1] + 7, `${tag}${label}: ring ${k} inside safe area (y ${Math.round(g.top)}–${Math.round(g.bottom)})`);
      });
      check(r.card.top >= d.safe[0] && r.card.bottom <= d.h - d.safe[1] && r.card.left >= 0 && r.card.right <= d.w, `${tag}${label}: card inside safe area`);
      check(!r.rings.some((g) => !(r.card.bottom <= g.top || r.card.top >= g.bottom || r.card.right <= g.left || r.card.left >= g.right)), `${tag}${label}: card does not cover the highlight`);
      const ax = r.arrow && (r.arrow.left + r.arrow.right) / 2;
      check(r.arrow && r.rings.some((g) => (r.arrow.dir === 'up' ? g.bottom <= r.card.top + 1 : g.top >= r.card.bottom - 1) && ax >= g.left && ax <= g.right), `${tag}${label}: arrow points at a highlight`);
      check(r.blocked, `${tag}${label}: controls outside the highlight are blocked`);
    };
    await layout('');
    const s0 = await st(p);
    if (id === 'enemylist') check(s0.head === 'Likely enemy picks' && s0.turn === 'Them', `${tag}: their turn shows "Likely enemy picks" (${s0.head}, ${s0.turn})`);
    if (id === 'enemysearch') check(s0.turn === 'Them', `${tag}: it is their turn`);
    if (id === 'win') check(s0.us === 3 && s0.them === 3 && await p.locator('.winbar').count() === 1, `${tag}: full example draft with win bar`);
    if (d.manual && id !== 'score' && id !== 'win') {
      if (id === 'map') { await p.locator('[data-tour="mapstart"] input').fill('hard rock'); await p.locator('.maplist button', { hasText: 'Hard Rock Mine' }).click(); }
      if (id === 'ban') { await p.locator('[data-tour="bans"] input').fill('Colt'); await p.waitForTimeout(300); if (d.name === 'iphone') { await layout(' (typing)'); await p.screenshot({ path: `${out}/${prefix}-iphone-step2-ban-typing.png` }); } await p.locator('.results button').first().click(); }
      if (id === 'unban') { await p.locator('.chip.ban').first().click(); }
      if (id === 'first') { await p.locator('[data-tour="first"] button', { hasText: 'Them' }).click(); }
      if (id === 'pick' || id === 'enemylist') { if (SHOTS[d.name].includes(id)) await p.screenshot({ path: `${out}/${prefix}-${d.name}-step${i + 1}-${id}.png` }); await p.locator('.sugg li button').first().click(); }
      if (id === 'enemysearch') { for (const nm of ['Brock', 'Piper', 'Nita', 'Jessie']) { await p.locator('[data-tour="picksearch"] input').fill(nm); await p.waitForTimeout(150); if (await p.locator('.results button').count()) { await p.locator('.results button').first().click(); break; } } }
      if (id === 'remove') { if (SHOTS[d.name].includes(id)) await p.screenshot({ path: `${out}/${prefix}-${d.name}-step${i + 1}-${id}.png` }); await p.locator('.team .slot.filled').last().click(); }
      if (id === 'lanes') { if (SHOTS[d.name].includes(id)) await p.screenshot({ path: `${out}/${prefix}-${d.name}-step${i + 1}-${id}.png` }); await p.locator('.lane-b.ally').nth(0).click(); await p.locator('.lane-b.ally').nth(1).click(); }
      if (id === 'reset') await p.locator('[data-tour="reset"]').click();
      if (id === 'mapstab') { if (SHOTS[d.name].includes(id)) await p.screenshot({ path: `${out}/${prefix}-${d.name}-step${i + 1}-${id}.png` }); await p.locator('[data-tour="maps"]').click(); }
      if (id === 'draftmap') { await p.waitForFunction(() => document.querySelector('.map-img img')?.naturalWidth > 0, null, { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(400); await layout(' (image loaded)'); if (SHOTS[d.name].includes(id)) await p.screenshot({ path: `${out}/${prefix}-${d.name}-step${i + 1}-${id}.png` }); await p.locator('[data-tour="draftmap"]').click(); }
    } else {
      if (SHOTS[d.name].includes(id)) await p.screenshot({ path: `${out}/${prefix}-${d.name}-step${i + 1}-${id}.png` });
      if (!d.manual && i === 3) { await p.locator('.tour-btns button', { hasText: 'Back' }).click(); await p.waitForSelector('.tour-card[data-id="unban"]'); check((await st(p)).bans === 2, `${d.name}: Back restores the previous step's example draft`); await p.locator('.tour-btns .primary').click(); await p.waitForSelector('.tour-card[data-id="first"]'); }
      await p.locator('.tour-btns .primary').click();
    }
    await p.waitForTimeout(250);
    if (d.manual && ['pick', 'remove', 'lanes'].includes(id)) { // these stay so the result is visible
      const sv = await st(p);
      const okStay = await p.locator(`.tour-card[data-id="${id}"]`).count() === 1;
      const res = { pick: sv.us + sv.them === s0.us + s0.them + 1 && sv.turn !== s0.turn, remove: sv.us + sv.them === s0.us + s0.them - 1, lanes: sv.lanes !== s0.lanes }[id];
      check(okStay && res, `${tag}: result stays visible (${JSON.stringify({ turn: `${s0.turn}→${sv.turn}`, picks: `${s0.us + s0.them}→${sv.us + sv.them}`, lanes: id === 'lanes' ? `${s0.lanes} → ${sv.lanes}` : undefined })})`);
      await layout(' (after action)');
      if (d.name === 'iphone' && id === 'pick') await p.screenshot({ path: `${out}/${prefix}-iphone-step${i + 1}-pick-after.png` });
      await p.locator('.tour-btns .primary').click(); await p.waitForTimeout(250);
    }
    const s1 = await st(p);
    const exp = {
      map: s1.map === 'Hard Rock Mine', ban: s1.bans === (d.manual ? 1 : 2), unban: s1.bans === (d.manual ? 0 : 1),
      first: s1.us + s1.them === 0, pick: s1.us + s1.them >= 1, enemylist: s1.us + s1.them > s0.us + s0.them,
      enemysearch: s1.them === s0.them + 1 || s1.us + s1.them > s0.us + s0.them, remove: true, score: true, win: true,
      lanes: d.manual || s1.lanes !== s0.lanes, reset: s1.bans === 0 && s1.us + s1.them === 0 && s1.map === 'Hard Rock Mine',
      mapstab: s1.hash === '#/draft', draftmap: true,
    }[id];
    const after = { remove: `${s0.us + s0.them}→${s1.us + s1.them}`, lanes: `${s0.lanes} → ${s1.lanes}`, pick: `turn ${s0.turn}→${s1.turn}` }[id] ?? '';
    check(exp, `${tag}: ${d.manual && id !== 'score' && id !== 'win' ? 'action done by hand' : 'Next did it'} ${after} ${JSON.stringify({ bans: s1.bans, us: s1.us, them: s1.them })}`);
    if (id === 'mapstab') check(await p.locator('[data-tour="draftmap"]').count() === 1, `${tag}: Maps tab opened inside the walkthrough`);
  }
  check(await p.locator('.tour-card').count() === 0, `${d.name}: walkthrough finished`);
  await p.waitForTimeout(300);
  const after = await st(p);
  check(after.map === before.map && after.bans === before.bans && after.us === 0 && after.hash === '#/draft', `${d.name}: real draft and tab restored (${after.map}, ${after.bans} ban, ${after.hash})`);
  await p.reload(); await p.waitForTimeout(1500);
  check(await p.locator('.tour-card').count() === 0, `${d.name}: stays closed after reload`);
  console.log(`${d.name}: done`);
}
console.log(bad ? `${bad} FAILURE(S) of ${n}` : `ALL ${n} CHECKS PASSED`);
await b.close();
