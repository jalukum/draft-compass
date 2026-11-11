#!/usr/bin/env node
// Daily ladder sampler for Draft Compass.
//
// 1. Reads top-player lists from the official Brawl Stars API (through the RoyaleAPI
//    proxy, because the key is IP-locked), then each player's recent battle log.
// 2. Keeps Ranked games (battle.type soloRanked / teamRanked, 3v3), dedupes them across
//    players, and counts per map: games, brawler appearances and wins, opposite-team
//    pairs (matchups) and same-team pairs (synergy).
// 3. Buckets games by the day they were played (battleTime, UTC) and adds the counts to
//    data/daily/<day>.json. Each run only counts games played after the previous run's
//    cutoff, so nothing is counted twice across runs. The first run reaches back as far as
//    the battle logs go (a few days for most players).
// 4. Merges the last WINDOW_DAYS day files and publishes public/data/stats-latest.json
//    (+ a dated copy under public/data/history/).
//
// The API key comes only from the BRAWL_STARS_API_KEY environment variable. It is never
// logged or written anywhere.
//
// Env knobs: MAX_PLAYERS (default 8000), SNOWBALL (default on: also read players met in Ranked games; 0 = ranking lists only), CONCURRENCY (8), WINDOW_DAYS (28),
// COUNTRIES (comma list, default below), MIN_RANK (lowest Ranked tier counted, default 0).

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROXY = 'https://bsproxy.royaleapi.dev/v1';
const BRAWLAPI = 'https://api.brawlapi.com/v1';
const KEY = process.env.BRAWL_STARS_API_KEY?.trim();
if (!KEY) { console.error('BRAWL_STARS_API_KEY is not set.'); process.exit(1); }

const MAX_PLAYERS = +(process.env.MAX_PLAYERS ?? 8000);
const CONCURRENCY = +(process.env.CONCURRENCY ?? 8);
const WINDOW_DAYS = +(process.env.WINDOW_DAYS ?? 28);
const MIN_RANK = +(process.env.MIN_RANK ?? 0);
const COUNTRIES = (process.env.COUNTRIES ?? 'us,br,mx,de,fr,es,tr,ru,kr,jp,gb').split(',').map((s) => s.trim()).filter(Boolean);
const SNOWBALL = process.env.SNOWBALL !== '0';
const RANKED_TYPES = new Set(['soloRanked', 'teamRanked']);
const SOURCE = 'our daily Ranked sample';

// Smoothing / thresholds for the published file.
const WR_PRIOR = 20;        // brawler win rate: pull toward 50% as if 20 extra even games
const PAIR_PRIOR = 10;      // pair win rate prior
const PAIR_MIN = 5;         // publish a matchup/synergy pair only with at least this many games
const MAP_MIN = 30; 
const POOL_DAYS = 7;          // ranked pool = maps seen in Ranked games in the last 7 days...
const POOL_MIN = 40;         // ...with at least this many games
        // publish a map only with at least this many games

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0, fails = 0, notFound = 0, throttled = 0;

async function api(path, tries = 5) {
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      calls++;
      res = await fetch(`${PROXY}${path}`, {
        headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'User-Agent': 'draft-compass-sampler' },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      await sleep(1000 * 2 ** i);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404) { notFound++; return null; }
    if (res.status === 403) throw new Error('API refused the key (403). Check the key and its IP allowlist (45.79.218.79).');
    if (res.status === 429) throttled++;
    if (res.status === 429 || res.status >= 500) {
      const ra = +(res.headers.get('retry-after') ?? 0);
      await sleep(Math.max(ra * 1000, 800 * 2 ** i) + Math.random() * 400);
      continue;
    }
    return null; // 400 etc: skip this item
  }
  fails++;
  return null;
}

async function brawlapi(path) {
  const r = await fetch(`${BRAWLAPI}/${path}`, { headers: { 'User-Agent': 'draft-compass-sampler' } });
  if (!r.ok) throw new Error(`BrawlAPI ${path}: ${r.status}`);
  return (await r.json()).list;
}

const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const enc = (tag) => encodeURIComponent(tag.startsWith('#') ? tag : `#${tag}`);
const day = (d) => d.toISOString().slice(0, 10);
const parseTime = (t) => Date.parse(t.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'));

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// ---- map id -> app slug, using the same naming the app uses ---------------
const [rawMaps, rawModes] = await Promise.all([brawlapi('maps'), brawlapi('gamemodes')]);
const mapById = new Map(rawMaps.map((m) => [m.id, m]));
const modeName = new Map(rawModes.map((g) => [squash(g.name), g.name]));
function slugFor(ev) {
  const m = mapById.get(ev.id);
  if (m?.gameMode?.name) return { slug: slugify(`${m.name}-${m.gameMode.name}`), name: m.name, mode: m.gameMode.name };
  const mode = modeName.get(squash(ev.mode)) ?? ev.mode;
  return { slug: slugify(`${ev.map}-${mode}`), name: ev.map, mode };
}

// ---- state: only count games newer than the previous run's cutoff ----------
const statePath = join(ROOT, 'data', 'state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const now = Date.now();
const fromMs = state.lastCutoff ? Date.parse(state.lastCutoff) : now - WINDOW_DAYS * 86400e3;

// ---- players ----------------------------------------------------------------
const seeds = [];
const lists = ['global', ...COUNTRIES];
await pool(lists, 3, async (c) => {
  const j = await api(`/rankings/${c}/players?limit=200`);
  for (const p of j?.items ?? []) seeds.push(p.tag);
});
const queue = [...new Set(seeds)].slice(0, MAX_PLAYERS);
const seedCount = queue.length;
const queued = new Set(queue);
console.log(`seed players: ${queue.length} from ${lists.length} ranking lists (snowball ${SNOWBALL ? 'on' : 'off'}, cap ${MAX_PLAYERS})`);

// ---- crawl battle logs (snowballing into players met in Ranked games) -------
const games = new Map(); // key -> game
const rankOf = new Map();
let logsRead = 0, logsWithRanked = 0;

function addGame(owner, it) {
  const b = it.battle;
  if (!RANKED_TYPES.has(b?.type) || !Array.isArray(b.teams) || b.teams.length !== 2) return;
  if (b.teams.some((t) => t.length !== 3)) return;
  const t = parseTime(it.battleTime);
  if (!(t >= fromMs && t < now)) return;
  const tags = b.teams.flat().map((p) => p.tag).sort();
  const key = `${it.battleTime}|${tags.join(',')}`;
  if (SNOWBALL) for (const p of b.teams.flat()) if (!queued.has(p.tag) && queued.size < MAX_PLAYERS) { queued.add(p.tag); queue.push(p.tag); }
  if (games.has(key)) return;
  const ownerTeam = b.teams.findIndex((tm) => tm.some((p) => p.tag === owner));
  if (ownerTeam < 0) return;
  let winner = null;
  if (b.result === 'victory') winner = ownerTeam; else if (b.result === 'defeat') winner = 1 - ownerTeam; else return; // skip draws
  const ranks = b.teams.flat().map((p) => p.brawler?.trophies ?? 0);
  const minRank = Math.min(...ranks);
  if (minRank < MIN_RANK) return;
  const avgRank = Math.round(ranks.reduce((a, c) => a + c, 0) / ranks.length);
  rankOf.set(key, avgRank);
    games.set(key, { day: day(new Date(t)), ev: it.event, type: b.type, teams: b.teams.map((tm) => tm.map((p) => p.brawler.id)), winner });
}

for (let start = 0; start < queue.length;) {
  const batch = queue.slice(start, Math.min(queue.length, MAX_PLAYERS));
  start += batch.length;
  if (!batch.length) break;
  await pool(batch, CONCURRENCY, async (tag) => {
    const j = await api(`/players/${enc(tag)}/battlelog`);
    if (!j?.items) return;
    logsRead++;
    const before = games.size;
    for (const it of j.items) addGame(tag, it);
    if (games.size > before) logsWithRanked++;
  });
  console.log(`  logs read ${logsRead}, ranked games ${games.size}, queue ${queue.length}`);
  if (start >= MAX_PLAYERS) break;
}

// ---- aggregate this run's raw counts into per-day files (by battle date) ---------
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const runDate = day(new Date(now));
const dailyDir = join(ROOT, 'data', 'daily');
mkdirSync(dailyDir, { recursive: true });
const days = {};
const loadDay = (d) => {
  const f = join(dailyDir, `${d}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { date: d, games: 0, rankHist: {}, maps: {} };
};
const newPerDay = {};
for (const [key, g] of games) {
  const D = (days[g.day] ??= loadDay(g.day));
  newPerDay[g.day] = (newPerDay[g.day] ?? 0) + 1;
  D.games++;
  const rk = rankOf.get(key); D.rankHist[rk] = (D.rankHist[rk] ?? 0) + 1;
  const { slug, name, mode } = slugFor(g.ev);
  const m = (D.maps[slug] ??= { mapId: g.ev.id, name, mode, games: 0, b: {}, vs: {}, syn: {} });
  m.games++;
  g.teams.forEach((team, ti) => {
    const won = g.winner === ti ? 1 : 0;
    for (const id of team) { const r = (m.b[id] ??= [0, 0]); r[0]++; r[1] += won; }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const r = (m.syn[pairKey(team[i], team[j])] ??= [0, 0]); r[0]++; r[1] += won;
    }
    if (ti === 0) for (const a of team) for (const e of g.teams[1]) {
      if (a === e) continue; // mirror picks tell us nothing
      const k = pairKey(a, e); const r = (m.vs[k] ??= [0, 0]); r[0]++;
      r[1] += (a < e ? g.winner === 0 : g.winner === 1) ? 1 : 0; // wins for the lower id
    }
  });
}
for (const [d, D] of Object.entries(days)) writeFileSync(join(dailyDir, `${d}.json`), JSON.stringify(D));
const runs = state.runs ?? [];
runs.push({ date: runDate, from: new Date(fromMs).toISOString(), to: new Date(now).toISOString(), logsRead, logsWithRanked, newGames: games.size, newPerDay });
// ---- merge rolling window --------------------------------------------------------
const cutoffDay = day(new Date(now - (WINDOW_DAYS - 1) * 86400e3));
const files = readdirSync(dailyDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
for (const f of files) if (f.slice(0, 10) < cutoffDay) unlinkSync(join(dailyDir, f));
const keep = files.filter((f) => f.slice(0, 10) >= cutoffDay);
const merged = {}; let totGames = 0; const perDay = {}; const recentGames = {}; const totRanks = {};
const addInto = (dst, src) => { for (const [k, [n, w]] of Object.entries(src)) { const r = (dst[k] ??= [0, 0]); r[0] += n; r[1] += w; } };
for (const f of keep) {
  const d = JSON.parse(readFileSync(join(dailyDir, f), 'utf8'));
  totGames += d.games; perDay[d.date] = d.games;
  for (const [r, n] of Object.entries(d.rankHist ?? {})) totRanks[r] = (totRanks[r] ?? 0) + n;
  const recent = f.slice(0, 10) >= day(new Date(now - (POOL_DAYS - 1) * 86400e3));
  for (const [slug, m] of Object.entries(d.maps)) {
    if (recent) recentGames[slug] = (recentGames[slug] ?? 0) + m.games;
    const t = (merged[slug] ??= { mapId: m.mapId, name: m.name, mode: m.mode, games: 0, b: {}, vs: {}, syn: {} });
    t.games += m.games; addInto(t.b, m.b); addInto(t.vs, m.vs); addInto(t.syn, m.syn);
  }
}

// ---- publish ------------------------------------------------------------------------
const r1 = (x) => Math.round(x * 10) / 10;
const smooth = (w, n, k) => (100 * (w + k / 2)) / (n + k);
const out = {
  source: SOURCE,
  updatedAt: runDate,
  generatedAt: new Date(now).toISOString(),
  window: { days: keep.length, from: keep[0]?.slice(0, 10) ?? runDate, to: runDate },
  sample: { games: totGames, playersReadLastRun: logsRead, seedPlayersLastRun: seedCount, logsReadInWindow: runs.filter((r) => r.date >= cutoffDay).reduce((a, r) => a + r.logsRead, 0), maps: 0, rankHist: totRanks },
  perDay: {},
  format: 2,
  banData: false,
  pool: [],
  notes: 'brawlers: raw games/wins plus winRate smoothed toward 50%. useRate = % of games on the map where the brawler was picked (either team). matchups/synergy: [games, wins for the lower id] (raw). pool = maps with Ranked games in the last 7 days. Ban rate is null: battle logs do not record bans.',
  maps: {},
};
for (const [slug, m] of Object.entries(merged).sort((a, b) => b[1].games - a[1].games)) {
  if (m.games < MAP_MIN) continue;
  const brawlers = {};
  for (const [id, [n, w]] of Object.entries(m.b)) {
    brawlers[id] = { games: n, wins: w, winRate: r1(smooth(w, n, WR_PRIOR)), useRate: r1((100 * n) / m.games), banRate: null };
  }
  const pairs = (src) => {
    const o = {};
    for (const [k, [n, w]] of Object.entries(src)) {
      if (n < PAIR_MIN) continue;
      const [a, b] = k.split('|');
      (o[a] ??= {})[b] = [n, w];
    }
    return o;
  };
  const raw = mapById.get(m.mapId);
  out.maps[slug] = {
    name: m.name, mode: m.mode, mapId: m.mapId,
    img: raw?.imageUrl ?? '', modeIcon: raw?.gameMode?.imageUrl ?? '', modeColor: raw?.gameMode?.color ?? '',
    sample: m.games, recent: recentGames[slug] ?? 0, inPool: (recentGames[slug] ?? 0) >= POOL_MIN,
    brawlers, matchups: pairs(m.vs), synergy: pairs(m.syn),
  };
}
out.pool = Object.entries(out.maps).filter(([, m]) => m.inPool).map(([k]) => k);
out.sample.maps = Object.keys(out.maps).length;
out.perDay = perDay;

const pubDir = join(ROOT, 'public', 'data');
mkdirSync(join(pubDir, 'history'), { recursive: true });
const json = JSON.stringify(out);
writeFileSync(join(pubDir, 'stats-latest.json'), json);
writeFileSync(join(pubDir, 'history', `stats-${runDate}.json`), json);
// keep dated copies for the same window
for (const f of readdirSync(join(pubDir, 'history'))) {
  const d = f.match(/^stats-(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
  if (d && d < cutoffDay) unlinkSync(join(pubDir, 'history', f));
}
writeFileSync(statePath, JSON.stringify({ lastCutoff: new Date(now).toISOString(), lastRun: runDate, runs: runs.filter((r) => r.date >= cutoffDay) }, null, 2) + '\n');

console.log(`new games by day: ${JSON.stringify(newPerDay)}`);
console.log(`run ${runDate}: ${games.size} new ranked games from ${logsRead} logs (${logsWithRanked} with ranked games)`);
console.log(`window ${out.window.from}..${out.window.to}: ${totGames} games, ${out.sample.maps} maps published`);
console.log(`api calls ${calls}, 404s ${notFound}, 429s ${throttled}, gave up ${fails}; stats-latest ${(json.length / 1024).toFixed(0)} KB`);
for (const [slug, m] of Object.entries(out.maps)) console.log(`  ${m.inPool ? 'POOL' : '    '} ${slug}: ${m.sample} (last ${POOL_DAYS}d: ${m.recent})`);
