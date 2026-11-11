import type { Brawler, BrawlerClass, GameMap } from '../src/data/types';
import { slugify } from '../src/data/catalog';

let nextId = 1;
export const mk = (name: string, cls: BrawlerClass): Brawler => ({
  id: nextId++, name, slug: slugify(name), cls, rarity: 'Epic', rarityColor: '#fff', img: '',
});

export const ROSTER = {
  bull: mk('Bull', 'Tank'), rosa: mk('Rosa', 'Tank'), frank: mk('Frank', 'Tank'),
  mortis: mk('Mortis', 'Assassin'), edgar: mk('Edgar', 'Assassin'), crow: mk('Crow', 'Assassin'),
  shelly: mk('Shelly', 'Damage Dealer'), colt: mk('Colt', 'Damage Dealer'), spike: mk('Spike', 'Damage Dealer'),
  piper: mk('Piper', 'Marksman'), belle: mk('Belle', 'Marksman'), brock: mk('Brock', 'Marksman'),
  barley: mk('Barley', 'Artillery'), tick: mk('Tick', 'Artillery'),
  gene: mk('Gene', 'Controller'), sandy: mk('Sandy', 'Controller'), emz: mk('Emz', 'Controller'),
  poco: mk('Poco', 'Support'), byron: mk('Byron', 'Support'), max: mk('Max', 'Support'),
  mystery: mk('Brand New Brawler', 'Tank'),
};
export const ALL = Object.values(ROSTER);

const map = (name: string, mode: string): GameMap => ({
  id: 1, name, slug: slugify(name), mode, modeColor: '#fff', modeIcon: '', img: '', active: true, ranked: true,
});
export const KO = map('Out in the Open', 'Knockout');
export const BALL = map('Backyard Bowl', 'Brawl Ball');
export const ZONE = map('Ring of Fire', 'Hot Zone');
