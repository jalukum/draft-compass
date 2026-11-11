import type { Brawler, BrawlerClass } from '../data/types';

/**
 * Draft Compass editorial traits. Hand-written judgments, not derived from any
 * other site. Range: 1 short, 2 mid, 3 long.
 * Tags:
 *  wallBreak  – can reliably break cover
 *  overWall   – attacks over walls (lobs)
 *  heal       – heals or sustains allies
 *  control    – stuns, slows, pulls, knockbacks, zoning
 *  burst      – big damage in one go
 *  splash     – area damage
 *  mobility   – dashes, jumps, fast movement
 *  antiTank   – good at shredding high-health targets
 *  antiHeal   – reduces enemy healing
 */
export type Tag = 'wallBreak' | 'overWall' | 'heal' | 'control' | 'burst' | 'splash' | 'mobility' | 'antiTank' | 'antiHeal';

export interface Traits {
  range: 1 | 2 | 3;
  tags: Tag[];
  /** true when the brawler is in the hand-written table (otherwise class defaults). */
  curated: boolean;
}

const CLASS_DEFAULTS: Record<BrawlerClass, Omit<Traits, 'curated'>> = {
  Tank: { range: 1, tags: [] },
  Assassin: { range: 1, tags: ['mobility', 'burst'] },
  'Damage Dealer': { range: 2, tags: [] },
  Marksman: { range: 3, tags: [] },
  Artillery: { range: 2, tags: ['overWall', 'splash'] },
  Controller: { range: 2, tags: ['control'] },
  Support: { range: 2, tags: ['heal'] },
  Unknown: { range: 2, tags: [] },
};

type Entry = [1 | 2 | 3, ...Tag[]];
const T: Record<string, Entry> = {
  // Tanks
  'bull': [1, 'antiTank', 'wallBreak', 'burst'],
  'el-primo': [1, 'wallBreak', 'mobility'],
  'darryl': [1, 'mobility', 'burst'],
  'frank': [1, 'wallBreak', 'control', 'splash'],
  'rosa': [1],
  'bibi': [1, 'control'],
  'jacky': [1, 'wallBreak', 'splash'],
  'ash': [1, 'splash'],
  'meg': [2, 'wallBreak'],
  'buster': [1, 'control'],
  'hank': [1, 'burst', 'splash'],
  'draco': [1, 'splash'],
  // Assassins
  'mortis': [1, 'mobility'],
  'crow': [2, 'antiHeal', 'mobility'],
  'leon': [2, 'burst', 'mobility'],
  'edgar': [1, 'mobility'],
  'stu': [2, 'mobility'],
  'buzz': [1, 'control', 'mobility'],
  'fang': [1, 'mobility', 'burst'],
  'sam': [1, 'mobility'],
  'cordelius': [1, 'burst'],
  'mico': [1, 'mobility', 'overWall'],
  'melodie': [1, 'mobility'],
  'lily': [1, 'mobility', 'burst'],
  'kenji': [1, 'mobility', 'burst'],
  'shade': [1, 'mobility'],
  // Damage dealers
  'shelly': [1, 'antiTank', 'burst', 'wallBreak'],
  'colt': [3, 'wallBreak'],
  'rico': [3],
  'spike': [2, 'splash', 'control'],
  'nita': [2],
  'tara': [2, 'splash', 'control'],
  '8-bit': [3],
  'carl': [2],
  'surge': [2, 'mobility'],
  'colette': [2, 'antiTank'],
  'lola': [3],
  'eve': [3],
  'chester': [2, 'burst'],
  'r-t': [3],
  'pearl': [2, 'splash'],
  'clancy': [2],
  'moe': [2, 'overWall'],
  // Marksmen
  'brock': [3, 'wallBreak', 'splash'],
  'piper': [3, 'burst'],
  'bea': [3, 'burst', 'control'],
  'belle': [3],
  'nani': [3, 'burst'],
  'janet': [3, 'mobility'],
  'bonnie': [3, 'mobility'],
  'mandy': [3],
  'maisie': [3, 'control'],
  'angelo': [3, 'overWall'],
  // Artillery
  'dynamike': [2, 'overWall', 'splash', 'wallBreak'],
  'barley': [2, 'overWall', 'splash'],
  'tick': [3, 'overWall', 'splash'],
  'sprout': [2, 'overWall', 'control'],
  'grom': [3, 'overWall', 'splash'],
  'larry-and-lawrie': [2, 'overWall'],
  // Controllers
  'jessie': [2, 'splash'],
  'bo': [3, 'control'],
  'penny': [2, 'splash', 'overWall'],
  'gene': [3, 'control'],
  'sandy': [2, 'control'],
  'emz': [2, 'control', 'splash'],
  'mr-p': [2, 'overWall'],
  'gale': [2, 'control'],
  'amber': [2, 'splash', 'control'],
  'lou': [3, 'control'],
  'squeak': [2, 'splash', 'overWall'],
  'griff': [2, 'burst'],
  'otis': [2, 'control'],
  'willow': [2, 'control', 'overWall'],
  'chuck': [2, 'mobility'],
  'charlie': [2, 'control'],
  // Supports
  'poco': [2, 'heal', 'splash'],
  'pam': [2, 'heal'],
  'max': [2, 'mobility'],
  'byron': [3, 'heal', 'antiHeal'],
  'ruffs': [3],
  'gus': [2, 'heal'],
  'gray': [2, 'mobility'],
  'doug': [1, 'heal'],
  'kit': [1, 'mobility', 'control'],
  'berry': [2, 'heal'],
};

const cache = new Map<number, Traits>();
export function traitsOf(b: Brawler): Traits {
  const hit = cache.get(b.id);
  if (hit) return hit;
  const e = T[b.slug];
  const base = CLASS_DEFAULTS[b.cls];
  const t: Traits = e
    ? { range: e[0], tags: e.slice(1) as Tag[], curated: true }
    : { range: base.range, tags: [...base.tags], curated: false };
  cache.set(b.id, t);
  return t;
}

export const RANGE_LABEL = { 1: 'Short', 2: 'Mid', 3: 'Long' } as const;
export const TAG_LABEL: Record<Tag, string> = {
  wallBreak: 'Wall breaker', overWall: 'Over walls', heal: 'Heals', control: 'Control', burst: 'Burst',
  splash: 'Splash', mobility: 'Mobile', antiTank: 'Tank shredder', antiHeal: 'Anti-heal',
};
