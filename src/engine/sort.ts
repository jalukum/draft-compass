import type { Brawler } from '../data/types';

export type SortBy = 'name' | 'rarity' | 'class';
export type SortDir = 'asc' | 'desc';
export interface SortPref { by: SortBy; dir: SortDir }
export const DEFAULT_SORT: SortPref = { by: 'name', dir: 'asc' };

/** Game rarity order, lowest first. "Starting" is the same tier as Common. */
const RARITY_RANK: Record<string, number> = {
  common: 0, starting: 0, 'starting brawler': 0, rare: 1, 'super rare': 2, epic: 3, mythic: 4, legendary: 5, 'ultra legendary': 6,
};
export const rarityRank = (r: string) => RARITY_RANK[r.trim().toLowerCase()] ?? 99;

export interface BrawlerGroup { key: string; label: string | null; items: Brawler[] }

const byName = (a: Brawler, b: Brawler) => a.name.localeCompare(b.name);

/** Sort one flat list by a preference. Ties always fall back to name A–Z. */
export function sortBrawlers(list: Brawler[], pref: SortPref): Brawler[] {
  const flip = pref.dir === 'desc' ? -1 : 1;
  const cmp = (a: Brawler, b: Brawler) => {
    if (pref.by === 'name') return flip * byName(a, b);
    const k = pref.by === 'rarity' ? flip * (rarityRank(a.rarity) - rarityRank(b.rarity)) : flip * a.cls.localeCompare(b.cls);
    return k || byName(a, b);
  };
  return [...list].sort(cmp);
}

const groupKey = (b: Brawler, by: SortBy) => (by === 'rarity' ? b.rarity : by === 'class' ? b.cls : '');

/**
 * Sorted list split into labelled groups (one unlabelled group for name sort).
 * `pinned` ids (favorites) go first in their own group, sorted the same way.
 */
export function groupBrawlers(list: Brawler[], pref: SortPref, pinned?: ReadonlySet<number>): BrawlerGroup[] {
  const groups: BrawlerGroup[] = [];
  const pin = pinned && pinned.size ? list.filter((b) => pinned.has(b.id)) : [];
  const rest = pin.length ? list.filter((b) => !pinned!.has(b.id)) : list;
  if (pin.length) groups.push({ key: 'pinned', label: '★ Favorites', items: sortBrawlers(pin, pref) });
  const sorted = sortBrawlers(rest, pref);
  if (pref.by === 'name') {
    if (sorted.length) groups.push({ key: 'all', label: pin.length ? 'Everyone else' : null, items: sorted });
    return groups;
  }
  for (const b of sorted) {
    const k = groupKey(b, pref.by);
    const last = groups[groups.length - 1];
    if (last && last.key === `g:${k}`) last.items.push(b);
    else groups.push({ key: `g:${k}`, label: k, items: [b] });
  }
  return groups;
}
