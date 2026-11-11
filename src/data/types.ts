export type BrawlerClass =
  | 'Tank' | 'Assassin' | 'Damage Dealer' | 'Marksman' | 'Artillery' | 'Controller' | 'Support' | 'Unknown';

export interface Brawler {
  id: number;
  name: string;
  slug: string;
  cls: BrawlerClass;
  rarity: string;
  rarityColor: string;
  img: string;
}

export interface GameMode {
  name: string;
  color: string;
  icon: string;
}

export interface GameMap {
  id: number;
  name: string;
  slug: string;
  mode: string;
  modeColor: string;
  modeIcon: string;
  img: string;
  /** Catalog says the map is not disabled. */
  active: boolean;
  /** Mode is in our usual Ranked pool. */
  ranked: boolean;
}

export interface Catalog {
  brawlers: Brawler[];
  maps: GameMap[];
  modes: GameMode[];
  fetchedAt: string; // ISO
  source: 'live' | 'saved' | 'bundled';
}

/** Per-map ladder stats. BrawlAPI has none; our daily sampler publishes them (or import a JSON). */
export interface BrawlerMapStat {
  winRate: number; useRate: number;
  /** games this brawler appeared in on the map */
  games?: number;
  /** null: battle logs don't record bans */
  banRate?: number | null;
}
/** [games, win% for the outer key] for a brawler pair. Stored once per pair, lower id first. */
export type PairStat = [number, number];
export interface MapStats {
  sample: number;
  brawlers: Record<string, BrawlerMapStat>;
  /** matchups[a][b]: a vs b on opposite teams, a < b */
  matchups?: Record<string, Record<string, PairStat>>;
  /** synergy[a][b]: a with b on the same team, a < b */
  synergy?: Record<string, Record<string, PairStat>>;
  name?: string; mode?: string; mapId?: number;
}
export interface StatsSnapshot {
  source: string;
  updatedAt: string; // ISO date
  generatedAt?: string;
  window?: { days: number; from: string; to: string };
  sample?: { games: number; maps: number; playersReadLastRun?: number };
  banData?: boolean;
  /** keyed by map slug */
  maps: Record<string, MapStats>;
}

/** Look up a pair from either side. Returns [games, win% for a] or null. */
export function pairStat(t: MapStats['matchups'] | undefined, a: number, b: number, mirror: boolean): PairStat | null {
  if (!t) return null;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const r = t[String(lo)]?.[String(hi)];
  if (!r) return null;
  return a < b || !mirror ? r : [r[0], 100 - r[1]];
}
