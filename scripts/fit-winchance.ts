// Fit the team win-chance weights on Ranked games played AFTER the published snapshot,
// so the games being predicted were not used to build the stats (no leakage).
// Usage: BRAWL_STARS_API_KEY=... npx vite-node scripts/fit-winchance.ts
// Writes nothing to the repo except printing the fitted weights and held-out metrics.
import { readFileSync, writeFileSync } from 'node:fs';
import { rawWinChance, winFeatures, type WinFeatures } from '../src/engine/winchance';

const KEY = process.env.BRAWL_STARS_API_KEY?.trim();
if (!KEY) throw new Error('BRAWL_STARS_API_KEY is not set');
const PROXY = 'https://bsproxy.royaleapi.dev/v1';
const MAX = +(process.env.MAX_PLAYERS ?? 6000), CONC = 8;
const snap = JSON.parse(readFileSync(new URL('../public/data/stats-latest.json', import.meta.url), 'utf8'));
const after = Date.parse(snap.generatedAt);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(path: string): Promise<any> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(PROXY + path, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return r.json();
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) { await sleep(800 * 2 ** i); continue; }
      return null;
    } catch { await sleep(1000 * 2 ** i); }
  }
  return null;
}
const slugify = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const byMapId = new Map<number, string>(Object.entries<any>(snap.maps).map(([slug, m]) => [m.mapId, slug]));
const parseTime = (t: string) => Date.parse(t.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'));

const queue: string[] = []; const seen = new Set<string>();
for (const c of ['global', 'us', 'br', 'mx', 'de', 'fr', 'es', 'tr', 'ru', 'kr', 'jp', 'gb']) {
  const j = await api(`/rankings/${c}/players?limit=200`);
  for (const p of j?.items ?? []) if (!seen.has(p.tag)) { seen.add(p.tag); queue.push(p.tag); }
}
const games = new Map<string, { slug: string; a: number[]; b: number[]; aWon: number }>();
let i = 0, read = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < Math.min(queue.length, MAX)) {
    const tag = queue[i++];
    const j = await api(`/players/${encodeURIComponent(tag)}/battlelog`);
    if (!j?.items) continue;
    read++;
    for (const it of j.items) {
      const bt = it.battle;
      if (!['soloRanked', 'teamRanked'].includes(bt?.type) || bt.teams?.length !== 2 || bt.teams.some((t: any[]) => t.length !== 3)) continue;
      for (const p of bt.teams.flat()) if (!seen.has(p.tag) && seen.size < MAX) { seen.add(p.tag); queue.push(p.tag); }
      if (!(parseTime(it.battleTime) > after)) continue;
      const slug = byMapId.get(it.event?.id) ?? slugify(`${it.event?.map}`);
      if (!snap.maps[slug]) continue;
      const own = bt.teams.findIndex((t: any[]) => t.some((p: any) => p.tag === tag));
      if (own < 0 || !['victory', 'defeat'].includes(bt.result)) continue;
      const key = it.battleTime + '|' + bt.teams.flat().map((p: any) => p.tag).sort().join();
      if (games.has(key)) continue;
      const winner = bt.result === 'victory' ? own : 1 - own;
      games.set(key, { slug, a: bt.teams[0].map((p: any) => p.brawler.id), b: bt.teams[1].map((p: any) => p.brawler.id), aWon: winner === 0 ? 1 : 0 });
    }
  }
}));
console.log(`read ${read} logs; ${games.size} Ranked games played after ${snap.generatedAt}`);

// Features, with a random side flip so there is no "team 0" bias.
const rows: { f: WinFeatures; y: number }[] = [];
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const g of games.values()) {
  const st = snap.maps[g.slug];
  const flip = rnd() < 0.5;
  const [ours, theirs, y] = flip ? [g.b, g.a, 1 - g.aWon] : [g.a, g.b, g.aWon];
  rows.push({ f: winFeatures(st, ours, theirs), y });
}
const shuffled = rows.sort(() => rnd() - 0.5);
const cut = Math.floor(shuffled.length * 0.6);
const train = shuffled.slice(0, cut), test = shuffled.slice(cut);

// Logistic regression, no intercept (the problem is symmetric), L2 ridge, gradient descent.
const keys: (keyof WinFeatures)[] = ['strength', 'matchups', 'synergy'];
let w: Record<string, number> = { strength: 0, matchups: 0, synergy: 0 };
for (let it = 0; it < 4000; it++) {
  const g: Record<string, number> = { strength: 0, matchups: 0, synergy: 0 };
  for (const r of train) {
    const p = rawWinChance(r.f, w as any);
    for (const k of keys) g[k] += (p - r.y) * r.f[k];
  }
  for (const k of keys) w[k] -= 0.5 * (g[k] / train.length + 0.01 * w[k]);
}
const evalSet = (set: typeof test, ww: any) => {
  let acc = 0, ll = 0; const bins = Array.from({ length: 5 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const r of set) {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, rawWinChance(r.f, ww)));
    acc += (p >= 0.5 ? 1 : 0) === r.y ? 1 : 0;
    ll += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p));
    const pc = Math.max(0.25, Math.min(0.75, p));
    const bi = Math.min(4, Math.floor((pc - 0.25) / 0.1));
    bins[bi].n++; bins[bi].p += pc; bins[bi].y += r.y;
  }
  return { acc: acc / set.length, ll: ll / set.length, bins: bins.map((b) => b.n ? `${(100 * b.p / b.n).toFixed(0)}%→${(100 * b.y / b.n).toFixed(0)}% (n=${b.n})` : '-').join('  ') };
};
const base = { acc: test.filter((r) => r.y === 1).length / test.length };
console.log('weights', Object.fromEntries(keys.map((k) => [k, +w[k].toFixed(3)])));
console.log(`train ${train.length}, test ${test.length}`);
console.log('test (fitted):', evalSet(test, w));
console.log('test (strength only):', evalSet(test, { strength: w.strength, matchups: 0, synergy: 0 }));
console.log(`test coin flip: acc 50%, log loss ${Math.log(2).toFixed(3)}; share of wins for "ours": ${(100 * base.acc).toFixed(1)}%`);
writeFileSync('/tmp/winchance-fit.json', JSON.stringify({ weights: w, train: train.length, test: test.length, test_metrics: evalSet(test, w), logs: read, games: games.size, after: snap.generatedAt }, null, 2));
