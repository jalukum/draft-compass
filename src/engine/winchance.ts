/**
 * Team win chance from our Ranked sample, on a log-odds scale:
 *   strength  = sum of each pick's map win rate (shrunk toward 50%), ours minus theirs
 *   matchups  = every our-vs-their pair (all 9 once teams are full): how the pair actually went
 *               on this map, beyond what the two win rates predict (shrunk toward that expectation)
 *   synergy   = every same-team pair, the same way, ours minus theirs
 * Weights were fitted with logistic regression on Ranked games played after the snapshot
 * (scripts/fit-winchance.ts); see NOTES.md for held-out accuracy.
 */
import type { MapStats } from '../data/types';
import { pair, row } from './meta';

// Fitted 11 Nov 2026 on 3,966 Ranked games played after the snapshot; held-out 2,644 games: 58.2% accuracy, log loss 0.674 (coin flip 0.693).
export const WIN_WEIGHTS = { strength: 0.66, matchups: 0.268, synergy: 0.054 };
export const WIN_CLAMP: [number, number] = [0.25, 0.75];
const K = 50;

const logit = (p: number) => Math.log(p / (1 - p));
const cl = (p: number) => Math.max(0.02, Math.min(0.98, p));

export interface WinFeatures { strength: number; matchups: number; synergy: number }

export function winFeatures(st: MapStats | null | undefined, ours: number[], theirs: number[]): WinFeatures {
  const adj = (id: number) => row(st, id)?.adj ?? 0.5;
  let strength = 0;
  for (const id of ours) strength += logit(adj(id));
  for (const id of theirs) strength -= logit(adj(id));
  let matchups = 0;
  for (const a of ours) for (const b of theirs) {
    if (a === b) continue;
    const r = st ? pair(st.matchups, a, b, true) : null;
    if (!r) continue;
    const expect = cl(0.5 + adj(a) - adj(b));
    matchups += logit(cl((r[1] + K * expect) / (r[0] + K))) - logit(expect);
  }
  const syn = (team: number[]) => {
    let s = 0;
    for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
      const r = st ? pair(st.synergy, team[i], team[j], false) : null;
      if (!r) continue;
      const expect = cl((adj(team[i]) + adj(team[j])) / 2);
      s += logit(cl((r[1] + K * expect) / (r[0] + K))) - logit(expect);
    }
    return s;
  };
  return { strength, matchups, synergy: syn(ours) - syn(theirs) };
}

export function rawWinChance(f: WinFeatures, w = WIN_WEIGHTS): number {
  const z = w.strength * f.strength + w.matchups * f.matchups + w.synergy * f.synergy;
  return 1 / (1 + Math.exp(-z));
}

/** Our chance to win (0..1), clamped so it never overclaims. */
export function winChance(st: MapStats | null | undefined, ours: number[], theirs: number[]): number {
  const p = rawWinChance(winFeatures(st, ours, theirs));
  return Math.max(WIN_CLAMP[0], Math.min(WIN_CLAMP[1], p));
}
