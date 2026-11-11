/**
 * Draft Compass scoring, driven by our own Ranked battle-log sample.
 *
 * For a candidate brawler on a map we estimate how much picking it moves our win chance:
 *   strength  = its map win rate, shrunk toward 50% (Bayesian, prior of WR_K even games)
 *   counters  = how it actually did against the enemy picks, beyond what the two win rates predict
 *   synergy   = how it actually did next to our picks, beyond what the two win rates predict
 * plus how often top players pick it (popularity is a strong signal of what is meta).
 * The hand-made mode-fit model only nudges brawlers with almost no games.
 */
import type { Brawler, GameMap, MapStats } from '../data/types';
import { matchup, modeFit, modeKey } from './heuristics';

export const WR_K = 100;    // win-rate prior strength (games): a brawler needs a few hundred games before its win rate counts fully
export const PAIR_K = 25;   // pair prior strength (games)

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface BrawlerRow { games: number; wins: number; wr: number; adj: number; use: number }

/** Raw games/wins for a brawler on a map (handles old files that only have winRate). */
export function row(st: MapStats | null | undefined, id: number): BrawlerRow | null {
  const r = st?.brawlers[String(id)];
  if (!r) return null;
  const games = r.games ?? Math.round((r.useRate / 100) * (st!.sample || 0));
  const wins = r.wins ?? Math.round((r.winRate / 100) * games);
  const adj = (wins + WR_K / 2) / (games + WR_K);
  return { games, wins, wr: games ? wins / games : 0.5, adj, use: r.useRate };
}

/** [games, wins for a] for a pair, read from either side. Format 2 stores raw wins for the lower id. */
export function pair(table: MapStats['matchups'], a: number, b: number, opposite: boolean): [number, number] | null {
  if (!table) return null;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const r = table[String(lo)]?.[String(hi)];
  if (!r) return null;
  const [n, w] = r;
  return a < b || !opposite ? [n, w] : [n, n - w];
}

/** a's chance to beat b in a direct trade on this map (0..1), from pair data shrunk toward the win-rate expectation. */
export function laneEdge(st: MapStats | null | undefined, map: GameMap, a: Brawler, b: Brawler): { p: number; games: number } {
  const ra = row(st, a.id), rb = row(st, b.id);
  // expectation from overall map strength, plus a small nudge from our role model
  const expect = clamp(0.5 + ((ra?.adj ?? 0.5) - (rb?.adj ?? 0.5)) + 0.03 * matchup(a, b, modeKey(map.mode)), 0.05, 0.95);
  const pr = st ? pair(st.matchups, a.id, b.id, true) : null;
  if (!pr) return { p: expect, games: 0 };
  return { p: (pr[1] + PAIR_K * expect) / (pr[0] + PAIR_K), games: pr[0] };
}

export interface Suggestion { brawler: Brawler; score: number; games: number; winRate: number | null; pickRate: number; delta: number }

export interface SuggestInput {
  brawlers: Brawler[];
  map: GameMap;
  stats: MapStats | null;
  bans: number[];
  mine: number[];
  theirs: number[];
}

/** Ranked list of brawlers for our next pick. Banned and picked brawlers are left out. */
export function suggest(inp: SuggestInput): Suggestion[] {
  const { stats: st, map } = inp;
  const byId = new Map(inp.brawlers.map((b) => [b.id, b]));
  const taken = new Set([...inp.bans, ...inp.mine, ...inp.theirs]);
  const mine = inp.mine.map((id) => byId.get(id)).filter(Boolean) as Brawler[];
  const theirs = inp.theirs.map((id) => byId.get(id)).filter(Boolean) as Brawler[];
  const mk = modeKey(map.mode);
  const nBrawlers = Math.max(1, Object.keys(st?.brawlers ?? {}).length);
  const avgUse = 600 / Math.max(nBrawlers, 60); // six picks per game spread over the field

  const out: Suggestion[] = [];
  for (const b of inp.brawlers) {
    if (taken.has(b.id)) continue;
    const r = row(st, b.id);
    const games = r?.games ?? 0;
    // 1. map strength (win-probability points)
    let delta = (r?.adj ?? 0.5) - 0.5;
    // 2. counters vs enemy picks: actual pair result minus what the two win rates predict
    for (const e of theirs) {
      const ex = laneEdge(st, map, b, e);
      const base = clamp(0.5 + ((r?.adj ?? 0.5) - (row(st, e.id)?.adj ?? 0.5)), 0.05, 0.95);
      delta += ((ex.p - base) / theirs.length) * 0.9;
    }
    // 3. synergy with our picks
    for (const a of mine) {
      const pr = st ? pair(st.synergy, b.id, a.id, false) : null;
      if (!pr) continue;
      const ra = row(st, a.id);
      const expect = ((r?.adj ?? 0.5) + (ra?.adj ?? 0.5)) / 2;
      const p = (pr[1] + PAIR_K * expect) / (pr[0] + PAIR_K);
      delta += ((p - expect) / mine.length) * 0.7;
    }
    // 4. popularity among high-rank players
    const use = r?.use ?? 0;
    const pop = use > 0 ? clamp(Math.log(use / avgUse), -3, 2.5) : -3;
    // 5. tie-break model, only meaningful when the brawler has almost no games here
    const thin = clamp(1 - games / 30, 0, 1);
    const fit = modeFit(b, mk).value * thin;
    const score = clamp(Math.round(48 + 380 * delta + 13 * pop + 6 * fit), 1, 99);
    out.push({ brawler: b, score, games, winRate: r && games ? r.wr * 100 : null, pickRate: use, delta });
  }
  return out.sort((a, b) => b.score - a.score || b.games - a.games || a.brawler.name.localeCompare(b.brawler.name));
}

// ---- Lanes -------------------------------------------------------------------------
export type Lane = 'left' | 'mid' | 'right';
export const LANES: Lane[] = ['left', 'mid', 'right'];
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/** How well a brawler suits the middle lane (controllers, supports, long range); sides suit the rest. */
function midPull(b: Brawler, mode: string): number {
  const mk = modeKey(mode);
  const base: Record<string, number> = { Controller: 0.6, Support: 0.5, Artillery: 0.4, Marksman: 0.3, 'Damage Dealer': 0.2, Tank: 0, Assassin: -0.3, Unknown: 0.2 };
  let v = base[b.cls] ?? 0.2;
  if (mk === 'ball' && b.cls === 'Tank') v += 0.5;
  if ((mk === 'ko' || mk === 'bounty') && b.cls === 'Marksman') v += 0.3;
  return v;
}

/**
 * Place a team (0-3 brawlers) into left/mid/right by role. With `vs` (the enemy's lanes),
 * also try to win the lane matchups. Returns three slots; empty slots are null.
 */
export function autoLanes(team: Brawler[], map: GameMap, st: MapStats | null, vs?: (Brawler | null)[]): (Brawler | null)[] {
  let best: (Brawler | null)[] = [null, null, null], bestV = -Infinity;
  for (const p of PERMS) {
    const slots = p.map((i) => team[i] ?? null);
    let v = 0;
    slots.forEach((b, li) => {
      if (!b) return;
      v += LANES[li] === 'mid' ? midPull(b, map.mode) : -0.5 * midPull(b, map.mode);
      const e = vs?.[li];
      if (e) v += 2 * (laneEdge(st, map, b, e).p - 0.5);
    });
    if (v > bestV + 1e-9) { bestV = v; best = slots; }
  }
  return best;
}
