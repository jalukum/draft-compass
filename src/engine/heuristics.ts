import type { Brawler, BrawlerClass } from '../data/types';
import { traitsOf, type Tag } from './traits';

export type ModeKey = 'gem' | 'ball' | 'ko' | 'heist' | 'zone' | 'bounty' | 'other';

export function modeKey(mode: string): ModeKey {
  const m = mode.toLowerCase();
  if (m.includes('gem grab')) return 'gem';
  if (m.includes('brawl ball') || m.includes('hockey')) return 'ball';
  if (m.includes('knockout')) return 'ko';
  if (m.includes('heist')) return 'heist';
  if (m.includes('hot zone')) return 'zone';
  if (m.includes('bounty')) return 'bounty';
  return 'other';
}

export const MODE_LABEL: Record<ModeKey, string> = {
  gem: 'Gem Grab', ball: 'Brawl Ball', ko: 'Knockout', heist: 'Heist', zone: 'Hot Zone', bounty: 'Bounty', other: 'this mode',
};

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

// ---- Mode fit -------------------------------------------------------------
// Our read on each class per mode, from -1 (fights the mode) to +1 (made for it).
const CLASS_MODE: Record<BrawlerClass, Record<ModeKey, number>> = {
  Tank:            { gem: 0.1, ball: 0.6, ko: -0.5, heist: 0.3, zone: 0.4, bounty: -0.6, other: 0 },
  Assassin:        { gem: 0.0, ball: 0.4, ko: -0.2, heist: 0.4, zone: -0.1, bounty: 0.0, other: 0 },
  'Damage Dealer': { gem: 0.3, ball: 0.3, ko: 0.1, heist: 0.6, zone: 0.2, bounty: 0.1, other: 0 },
  Marksman:        { gem: 0.1, ball: -0.4, ko: 0.7, heist: -0.1, zone: -0.2, bounty: 0.7, other: 0 },
  Artillery:       { gem: 0.2, ball: -0.3, ko: 0.3, heist: 0.1, zone: 0.5, bounty: 0.2, other: 0 },
  Controller:      { gem: 0.6, ball: 0.1, ko: 0.3, heist: 0.0, zone: 0.6, bounty: 0.3, other: 0 },
  Support:         { gem: 0.4, ball: 0.1, ko: 0.2, heist: -0.3, zone: 0.3, bounty: 0.1, other: 0 },
  Unknown:         { gem: 0, ball: 0, ko: 0, heist: 0, zone: 0, bounty: 0, other: 0 },
};

const TAG_MODE: Partial<Record<Tag, Partial<Record<ModeKey, number>>>> = {
  wallBreak: { ball: 0.3, heist: 0.25, gem: 0.05 },
  overWall: { ko: 0.15, zone: 0.15, gem: 0.05 },
  heal: { gem: 0.1, zone: 0.1, ball: 0.05 },
  burst: { heist: 0.15, ko: 0.15, bounty: 0.1 },
  splash: { zone: 0.25, gem: 0.1 },
  control: { zone: 0.15, ball: 0.1, gem: 0.05 },
  mobility: { ball: 0.15, gem: 0.05, heist: 0.05 },
  antiTank: { ball: 0.1, zone: 0.1, heist: 0.05 },
};

/** Preferred range per mode (1–3) and how open the mode's maps tend to be (0–1). */
const MODE_RANGE: Record<ModeKey, { ideal: number; openness: number }> = {
  gem: { ideal: 2, openness: 0.6 }, ball: { ideal: 1.5, openness: 0.4 }, ko: { ideal: 2.8, openness: 0.9 },
  heist: { ideal: 1.8, openness: 0.5 }, zone: { ideal: 2, openness: 0.5 }, bounty: { ideal: 2.8, openness: 0.9 },
  other: { ideal: 2, openness: 0.5 },
};

export interface FitPart { label: string; value: number }

export function modeFit(b: Brawler, mk: ModeKey): { value: number; parts: FitPart[] } {
  const t = traitsOf(b);
  const parts: FitPart[] = [];
  const cls = CLASS_MODE[b.cls][mk] * 0.7;
  parts.push({ label: `${b.cls} in ${MODE_LABEL[mk]}`, value: cls });
  for (const tag of t.tags) {
    const v = TAG_MODE[tag]?.[mk];
    if (v) parts.push({ label: tag, value: v });
  }
  const r = -0.15 * Math.abs(t.range - MODE_RANGE[mk].ideal);
  if (r < -0.01) parts.push({ label: 'range', value: r });
  return { value: clamp(parts.reduce((s, p) => s + p.value, 0)), parts };
}

// ---- Matchups -------------------------------------------------------------
// One-way pressure a class puts on another. The matchup is pressure(a,b) - pressure(b,a).
const PRESSURE: Partial<Record<BrawlerClass, Partial<Record<BrawlerClass, number>>>> = {
  Tank: { Marksman: 0.5, Artillery: 0.55, Support: 0.3, 'Damage Dealer': 0.1 },
  Assassin: { Marksman: 0.6, Artillery: 0.65, Support: 0.45, Controller: 0.1 },
  'Damage Dealer': { Tank: 0.35, Assassin: 0.3, Support: 0.1 },
  Marksman: { 'Damage Dealer': 0.25, Controller: 0.3, Artillery: 0.2, Support: 0.15 },
  Artillery: { Tank: 0.2, 'Damage Dealer': 0.15, Controller: 0.15 },
  Controller: { Tank: 0.45, Assassin: 0.5, 'Damage Dealer': 0.15 },
  Support: { 'Damage Dealer': 0.15, Tank: 0.05 },
};

function pressure(a: Brawler, b: Brawler, mk: ModeKey): number {
  const ta = traitsOf(a), tb = traitsOf(b);
  let p = PRESSURE[a.cls]?.[b.cls] ?? 0;
  const has = (t: Tag) => ta.tags.includes(t);
  if (has('antiTank') && b.cls === 'Tank') p += 0.35;
  if (has('control') && (b.cls === 'Assassin' || b.cls === 'Tank')) p += 0.15;
  if (has('antiHeal') && tb.tags.includes('heal')) p += 0.25;
  if (has('burst') && (b.cls === 'Marksman' || b.cls === 'Artillery' || b.cls === 'Support')) p += 0.1;
  if (has('wallBreak') && b.cls === 'Artillery') p += 0.2;
  if (has('mobility') && (b.cls === 'Artillery' || b.cls === 'Marksman')) p += 0.1;
  // Longer range pays off on open maps.
  if (ta.range > tb.range) p += 0.12 * (ta.range - tb.range) * MODE_RANGE[mk].openness;
  return p;
}

/** Edge of a over b, -1..1. Antisymmetric by construction: matchup(a,b) = -matchup(b,a). */
export function matchup(a: Brawler, b: Brawler, mk: ModeKey): number {
  return clamp(pressure(a, b, mk) - pressure(b, a, mk));
}

// ---- Team composition -----------------------------------------------------
export type RoleGroup = 'front' | 'control' | 'damage';
export function roleGroup(b: Brawler): RoleGroup {
  if (b.cls === 'Tank' || b.cls === 'Assassin') return 'front';
  if (b.cls === 'Controller' || b.cls === 'Support') return 'control';
  return 'damage';
}

export interface CompRead { score: number; notes: string[] }

/** Team quality from roles, range mix and a few synergies. Roughly 0 (empty) to ~1.5 (very balanced trio). */
export function teamQuality(team: Brawler[], mk: ModeKey): CompRead {
  const notes: string[] = [];
  if (team.length === 0) return { score: 0, notes };
  let s = 0;
  const groups = new Set(team.map(roleGroup));
  s += 0.4 * groups.size;
  const clsCount = new Map<string, number>();
  for (const b of team) clsCount.set(b.cls, (clsCount.get(b.cls) ?? 0) + 1);
  for (const [cls, n] of clsCount) if (n > 1) { s -= 0.3 * (n - 1); notes.push(`stacked ${cls}`); }
  const traits = team.map(traitsOf);
  const maxRange = Math.max(...traits.map((t) => t.range));
  if (team.length >= 2) {
    if (maxRange === 1) { s -= 0.3; notes.push('no range'); }
    else if (maxRange === 3) s += 0.15;
  }
  const tags = traits.flatMap((t) => t.tags);
  const any = (t: Tag) => tags.includes(t);
  if (any('heal') && team.some((b) => b.cls === 'Tank')) { s += 0.12; notes.push('heals back a tank'); }
  if (any('control') && team.some((b) => b.cls === 'Assassin')) { s += 0.1; notes.push('control sets up a dive'); }
  if (tags.filter((t) => t === 'overWall').length > 1) { s -= 0.1; notes.push('two lobbers'); }
  if ((mk === 'ball' || mk === 'heist') && team.length === 3 && !any('wallBreak')) { s -= 0.15; notes.push('no wall breaker'); }
  if (mk === 'zone' && team.length === 3 && !any('splash') && !any('control')) { s -= 0.15; notes.push('little zone denial'); }
  return { score: s, notes };
}
