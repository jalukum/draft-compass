import { useMemo, useState } from 'preact/hooks';
import { DATA } from '../config';
import type { GameMap } from '../data/types';
import { Sheet, Switch } from './bits';

export function MapGrid({ maps, onPick, selected }: { maps: GameMap[]; onPick: (m: GameMap) => void; selected?: string | null }) {
  return (
    <div class="map-grid">
      {maps.map((m) => (
        <button type="button" class={`map-card ${selected === m.slug ? 'on' : ''}`} style={{ '--mode': m.modeColor } as any} onClick={() => onPick(m)}>
          <span class="map-thumb">{m.img && <img src={m.img} alt="" loading="lazy" decoding="async" />}</span>
          <span class="map-meta">
            <span class="map-name">{m.name}</span>
            <span class="map-mode">
              {m.modeIcon && <img src={m.modeIcon} alt="" width={16} height={16} loading="lazy" />}
              {m.mode}
            </span>
            <span class="badges">
              {m.active ? <span class="badge live">In catalog</span> : <span class="badge off">Vaulted</span>}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function useMapFilter(all: GameMap[]) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<string>('ranked');
  const [activeOnly, setActiveOnly] = useState(true);
  const [moreModes, setMoreModes] = useState(false);
  const modes = useMemo(() => {
    const other = [...new Set(all.filter((m) => !m.ranked && (!activeOnly || m.active)).map((m) => m.mode))].sort();
    return [...DATA.rankedModes, ...other];
  }, [all, activeOnly]);
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return all.filter((m) =>
      (!activeOnly || m.active) &&
      (mode === 'ranked' ? m.ranked : mode === 'all' ? true : m.mode === mode) &&
      (!qq || m.name.toLowerCase().includes(qq) || m.mode.toLowerCase().includes(qq)));
  }, [all, q, mode, activeOnly]);
  return { q, setQ, mode, setMode, activeOnly, setActiveOnly, modes, list, moreModes, setMoreModes };
}

export function MapFilters({ f }: { f: ReturnType<typeof useMapFilter> }) {
  return (
    <div class="filters">
      <input class="search" type="search" placeholder="Search maps or modes" value={f.q} onInput={(e) => f.setQ((e.target as HTMLInputElement).value)} aria-label="Search maps" />
      <div class="chips">
        {['ranked', ...(f.moreModes ? f.modes : f.modes.filter((m) => (DATA.rankedModes as readonly string[]).includes(m) || m === f.mode)), 'all'].map((m) => (
          <button type="button" class={`chip ${f.mode === m ? 'on' : ''}`} onClick={() => f.setMode(m)}>
            {m === 'ranked' ? '★ Ranked pool' : m === 'all' ? 'All modes' : m}
          </button>
        ))}
        <button type="button" class="chip ghost-chip" aria-expanded={f.moreModes} onClick={() => f.setMoreModes(!f.moreModes)}>
          {f.moreModes ? 'Fewer modes ▴' : 'More modes ▾'}
        </button>
      </div>
      <Switch checked={f.activeOnly} onChange={f.setActiveOnly} label="Only maps the catalog lists as active" hint="BrawlAPI marks retired maps as disabled. It doesn't publish the live rotation." />
    </div>
  );
}

export function MapPicker({ maps, selected, onPick, onClose }: { maps: GameMap[]; selected: string | null; onPick: (m: GameMap) => void; onClose: () => void }) {
  const f = useMapFilter(maps);
  return (
    <Sheet title="Pick the map" onClose={onClose}>
      <MapFilters f={f} />
      <p class="hint">{f.list.length} {f.list.length === 1 ? "map" : "maps"}</p>
      <MapGrid maps={f.list} onPick={onPick} selected={selected} />
    </Sheet>
  );
}
