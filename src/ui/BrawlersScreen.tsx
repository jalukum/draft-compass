import { useMemo, useState } from 'preact/hooks';
import type { BrawlerClass, Catalog } from '../data/types';
import { MODE_LABEL, modeFit, type ModeKey } from '../engine/heuristics';
import { RANGE_LABEL, TAG_LABEL, traitsOf } from '../engine/traits';
import type { Settings } from '../store';
import { Portrait } from './bits';
import { DEFAULT_SORT, groupBrawlers } from '../engine/sort';
import { SortControl } from './SortControl';

const CLASSES: BrawlerClass[] = ['Tank', 'Assassin', 'Damage Dealer', 'Marksman', 'Artillery', 'Controller', 'Support'];
const RANKED_KEYS: ModeKey[] = ['gem', 'ball', 'ko', 'heist', 'zone', 'bounty'];

export function BrawlersScreen({ catalog, settings, setSettings }: { catalog: Catalog; settings: Settings; setSettings: (u: (p: Settings) => Settings) => void }) {
  const [q, setQ] = useState('');
  const [cls, setCls] = useState<string>('all');
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return catalog.brawlers.filter((b) => (cls === 'all' || (cls === 'fav' ? settings.favorites.includes(b.id) : b.cls === cls)) && (!qq || b.name.toLowerCase().includes(qq)));
  }, [catalog, q, cls, settings.favorites]);
  const sort = settings.sorts?.brawlers ?? DEFAULT_SORT;
  const groups = useMemo(() => groupBrawlers(list, sort), [list, sort.by, sort.dir]);
  const fav = (id: number) => setSettings((s) => ({ ...s, favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] }));
  return (
    <div class="page">
      <h1 class="page-title">Brawlers <span class="count">{catalog.brawlers.length}</span></h1>
      <div class="filters">
        <input class="search" type="search" placeholder="Search brawlers" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search brawlers" />
        <div class="chips">
          {['all', 'fav', ...CLASSES].map((c) => (
            <button type="button" class={`chip ${cls === c ? 'on' : ''}`} onClick={() => setCls(c)}>{c === 'all' ? 'All' : c === 'fav' ? '★ Favorites' : c}</button>
          ))}
        </div>
        <SortControl value={sort} onChange={(v) => setSettings((st) => ({ ...st, sorts: { ...(st.sorts ?? { roster: DEFAULT_SORT, brawlers: DEFAULT_SORT }), brawlers: v } }))} />
      </div>
      <ul class="b-list">
        {groups.map((g) => (<>
        {g.label && <li class="group-head" role="presentation"><span>{g.label}</span><small>{g.items.length}</small></li>}
        {g.items.map((b) => {
          const t = traitsOf(b);
          const best = RANKED_KEYS.map((k) => ({ k, v: modeFit(b, k).value })).sort((x, y) => y.v - x.v).slice(0, 2);
          const isFav = settings.favorites.includes(b.id);
          return (
            <li class="b-card card">
              <Portrait b={b} size={64} tint={settings.rarityTint} />
              <div class="b-info">
                <b>{b.name}</b>
                <span class="b-sub"><span class="tag">{b.cls}</span><span class="tag" style={{ borderColor: b.rarityColor }}>{b.rarity}</span><span class="tag">{RANGE_LABEL[t.range]} range</span></span>
                <span class="b-sub hint">
                  {t.tags.map((x) => TAG_LABEL[x]).join(' · ') || 'No standout traits noted'}
                  {!t.curated && ' · class defaults (new brawler)'}
                </span>
                <span class="b-sub hint">Likes: {best.map((x) => MODE_LABEL[x.k]).join(', ')}</span>
              </div>
              <button type="button" class={`btn icon fav ${isFav ? 'on' : ''}`} aria-pressed={isFav} aria-label={`${isFav ? 'Unfavorite' : 'Favorite'} ${b.name}`} onClick={() => fav(b.id)}>{isFav ? '★' : '☆'}</button>
            </li>
          );
        })}
        </>))}
      </ul>
      {list.length === 0 && <p class="hint">Nobody matches that.</p>}
    </div>
  );
}
