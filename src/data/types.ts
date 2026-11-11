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

/** Per-map ladder stats. Not provided by BrawlAPI today; filled by a future pipeline or an imported JSON. */
export interface BrawlerMapStat { winRate: number; useRate: number }
export interface MapStats { sample: number; brawlers: Record<string, BrawlerMapStat> }
export interface StatsSnapshot {
  source: string;
  updatedAt: string; // ISO date
  /** keyed by map slug */
  maps: Record<string, MapStats>;
}
