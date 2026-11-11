import { DATA } from '../config';
import type { Brawler, BrawlerClass, Catalog, GameMap, GameMode } from './types';

const CLASSES: BrawlerClass[] = ['Tank', 'Assassin', 'Damage Dealer', 'Marksman', 'Artillery', 'Controller', 'Support'];

export const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Raw shapes, only the fields we read from api.brawlapi.com/v1. */
export interface RawBrawler {
  id: number; name: string; released?: boolean; imageUrl2?: string; imageUrl?: string;
  class?: { name?: string }; rarity?: { name?: string; color?: string };
}
export interface RawMap {
  id: number; name: string; hash?: string; disabled?: boolean; imageUrl?: string;
  gameMode?: { name?: string; color?: string; imageUrl?: string };
}
export interface RawMode { name: string; color?: string; imageUrl?: string; disabled?: boolean }

export function normalizeCatalog(
  raw: { brawlers: RawBrawler[]; maps: RawMap[]; modes: RawMode[] },
  fetchedAt: string,
  source: Catalog['source'],
): Catalog {
  const brawlers: Brawler[] = raw.brawlers
    .filter((b) => b.released !== false)
    .map((b) => {
      const c = (b.class?.name ?? '') as BrawlerClass;
      return {
        id: b.id,
        name: b.name,
        slug: slugify(b.name),
        cls: CLASSES.includes(c) ? c : 'Unknown',
        rarity: b.rarity?.name ?? 'Unknown',
        rarityColor: b.rarity?.color ?? '#999999',
        img: b.imageUrl2 ?? b.imageUrl ?? '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // The catalog lists some maps several times (re-releases). Keep one per name+mode,
  // preferring an active entry, then the lowest id.
  const byKey = new Map<string, RawMap>();
  for (const m of raw.maps) {
    const key = `${m.name}|${m.gameMode?.name}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, m); continue; }
    const better = (!m.disabled && prev.disabled) || (!!m.disabled === !!prev.disabled && m.id < prev.id);
    if (better) byKey.set(key, m);
  }
  const ranked = new Set<string>(DATA.rankedModes);
  const maps: GameMap[] = [...byKey.values()].map((m) => {
    const mode = m.gameMode?.name ?? 'Unknown';
    return {
      id: m.id,
      name: m.name,
      slug: slugify(`${m.name}-${mode}`),
      mode,
      modeColor: m.gameMode?.color ?? '#888888',
      modeIcon: m.gameMode?.imageUrl ?? '',
      img: m.imageUrl ?? '',
      active: !m.disabled,
      ranked: ranked.has(mode),
    };
  }).sort((a, b) => Number(b.ranked) - Number(a.ranked) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  const modes: GameMode[] = raw.modes
    .filter((g) => !g.disabled)
    .map((g) => ({ name: g.name, color: g.color ?? '#888', icon: g.imageUrl ?? '' }));

  return { brawlers, maps, modes, fetchedAt, source };
}

/** Strip a raw API payload down to the fields we use (used for the bundled snapshot and saved copy). */
export function trimRaw(raw: { brawlers: any[]; maps: any[]; modes: any[] }) {
  return {
    brawlers: raw.brawlers.map((b) => ({
      id: b.id, name: b.name, released: b.released, imageUrl2: b.imageUrl2,
      class: { name: b.class?.name }, rarity: { name: b.rarity?.name, color: b.rarity?.color },
    })),
    maps: raw.maps.map((m) => ({
      id: m.id, name: m.name, disabled: m.disabled, imageUrl: m.imageUrl,
      gameMode: { name: m.gameMode?.name, color: m.gameMode?.color, imageUrl: m.gameMode?.imageUrl },
    })),
    modes: raw.modes.map((g) => ({ name: g.name, color: g.color, imageUrl: g.imageUrl, disabled: g.disabled })),
  };
}

export async function fetchLiveRaw(signal?: AbortSignal) {
  const get = async (path: string) => {
    const r = await fetch(`${DATA.catalogBase}/${path}`, { signal });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    const j = await r.json();
    return (j.list ?? j) as any[];
  };
  const [brawlers, maps, modes] = await Promise.all([get('brawlers'), get('maps'), get('gamemodes')]);
  return trimRaw({ brawlers, maps, modes });
}
