import { useMemo, useState } from 'preact/hooks';
import type { Catalog, GameMap, StatsSnapshot } from '../data/types';
import { recommend } from '../engine/score';
import { presetWeights } from '../engine/weights';
import type { Settings } from '../store';
import { Portrait, Sheet } from './bits';
import { MapFilters, MapGrid, useMapFilter } from './MapPicker';

export function MapsScreen({ catalog, settings, stats, onDraft }: { catalog: Catalog; settings: Settings; stats: StatsSnapshot | null; onDraft: (m: GameMap) => void }) {
  const f = useMapFilter(catalog.maps);
  const [sel, setSel] = useState<GameMap | null>(null);
  const top = useMemo(() => {
    if (!sel) return [];
    const ms = stats?.maps[sel.slug] ?? null;
    return recommend({ brawlers: catalog.brawlers, map: sel, bans: [], mine: [], theirs: [], action: 'pick', weights: presetWeights(settings.preset, settings.custom), offMeta: settings.offMeta, stats: ms }).slice(0, 10);
  }, [sel, catalog, settings, stats]);
  return (
    <div class="page">
      <h1 class="page-title">Maps</h1>
      <p class="hint">Browse the catalog. Maps in our daily Ranked sample blend ladder win and use rates into the openers; the rest use our role model.</p>
      <MapFilters f={f} />
      <MapGrid maps={f.list} onPick={setSel} />
      {sel && (
        <Sheet title={sel.name} onClose={() => setSel(null)}>
          <p class="hint">{sel.mode} · {sel.active ? 'listed as active' : 'vaulted'}</p>
          {sel.img && <img class="map-big" src={sel.img} alt={`${sel.name} layout`} />}
          <h3>Strong openers (role model)</h3>
          <p class="fine">{stats?.maps[sel.slug] ? `Includes ladder stats from ${stats.source}.` : 'No ladder stats yet: this is our mode-fit read, not a win-rate table.'}</p>
          <ol class="mini-list">
            {top.map((r) => (
              <li><Portrait b={r.brawler} size={36} tint={settings.rarityTint} /><b>{r.brawler.name}</b><span class="score sm">{r.score}</span></li>
            ))}
          </ol>
          <button type="button" class="btn primary big wide" onClick={() => onDraft(sel)}>Draft on this map</button>
        </Sheet>
      )}
    </div>
  );
}
