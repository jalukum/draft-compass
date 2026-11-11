import { APP } from '../config';
import type { Catalog, StatsSnapshot } from '../data/types';
import { PRESETS, type PresetId, type Weights } from '../engine/weights';
import { defaultSettings, validateStats, type CatalogState, type Settings } from '../store';
import { fmtDate, Logo, Portrait, Switch } from './bits';

const W_LABEL: Record<keyof Weights, string> = {
  stats: 'Ladder stats', modeFit: 'Mode fit', comp: 'Team fit', counter: 'Matchups', safety: 'Blind-pick safety',
};

export function MeScreen({ catalog, cat, settings, setSettings, stats, statsOrigin, setStats, onTour }: {
  catalog: Catalog; cat: CatalogState; settings: Settings; setSettings: (u: (p: Settings) => Settings) => void;
  stats: StatsSnapshot | null; statsOrigin: 'published' | 'imported' | null; setStats: (s: StatsSnapshot | null) => void; onTour: () => void;
}) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const favs = settings.favorites.map((id) => catalog.brawlers.find((b) => b.id === id)).filter(Boolean);
  const importStats = async (file: File) => {
    try { setStats(validateStats(JSON.parse(await file.text()))); alert('Stats snapshot loaded.'); }
    catch (e) { alert(`That file didn't work: ${(e as Error).message}`); }
  };
  return (
    <div class="page me">
      <h1 class="page-title">Me</h1>

      <section class="card">
        <h3>How suggestions think</h3>
        <div class="preset-grid" role="radiogroup" aria-label="Recommendation preset">
          {[...PRESETS, { id: 'custom' as PresetId, label: 'Custom mix', blurb: 'Set your own weights with the sliders.', weights: settings.custom }].map((p) => (
            <button type="button" role="radio" aria-checked={settings.preset === p.id} class={`preset ${settings.preset === p.id ? 'on' : ''}`} onClick={() => set('preset', p.id)}>
              <b>{p.label}</b><small>{p.blurb}</small>
            </button>
          ))}
        </div>
        {settings.preset === 'custom' && (
          <div class="sliders">
            {(Object.keys(W_LABEL) as (keyof Weights)[]).map((k) => (
              <label class="slider">
                <span>{W_LABEL[k]} <b>{settings.custom[k].toFixed(1)}</b></span>
                <input type="range" min="0" max="2" step="0.1" value={settings.custom[k]}
                  onInput={(e) => set('custom', { ...settings.custom, [k]: Number((e.target as HTMLInputElement).value) })} />
              </label>
            ))}
            <button type="button" class="btn ghost" onClick={() => set('custom', { ...defaultSettings.custom })}>Reset sliders</button>
          </div>
        )}
        <Switch checked={settings.offMeta} onChange={(v) => set('offMeta', v)} label="Allow off-meta picks" hint="Softens the penalty for brawlers who don't usually suit the mode (and for low use rate, once stats exist)." />
        <Switch checked={settings.rarityTint} onChange={(v) => set('rarityTint', v)} label="Tint portraits by rarity" />
      </section>

      <section class="card">
        <h3>Favorites</h3>
        <p class="hint">Favorites sit at the top of the draft roster. Add them from the Brawlers tab or a suggestion's breakdown.</p>
        <div class="chips">
          {favs.length ? favs.map((b) => (
            <button type="button" class="chip fav-chip" onClick={() => set('favorites', settings.favorites.filter((x) => x !== b!.id))} aria-label={`Remove ${b!.name} from favorites`}>
              <Portrait b={b!} size={26} tint={settings.rarityTint} /> {b!.name} ✕
            </button>
          )) : <span class="hint">None yet.</span>}
        </div>
      </section>

      <section class="card">
        <h3>Data</h3>
        <dl class="facts">
          <dt>Catalog updated</dt><dd>{fmtDate(catalog.fetchedAt)} · {catalog.source === 'live' ? 'live from BrawlAPI' : catalog.source === 'saved' ? 'saved copy' : 'built-in copy'}</dd>
          <dt>Catalog size</dt><dd>{catalog.brawlers.length} brawlers · {catalog.maps.filter((m) => m.active).length} active maps</dd>
          <dt>Ladder stats</dt><dd>{stats ? `${statsOrigin === 'imported' ? 'Imported file' : 'Daily snapshot'} · updated ${fmtDate(stats.generatedAt ?? stats.updatedAt)} · ${Object.keys(stats.maps).length} maps` : 'Not loaded yet (the daily snapshot loads when you are online).'}</dd>
          {stats?.window && <><dt>Sample</dt><dd>{(stats.sample?.games ?? 0).toLocaleString()} Ranked games played {fmtDate(stats.window.from)} to {fmtDate(stats.window.to)}</dd></>}
          {stats && <><dt>Bans</dt><dd>{stats.banData ? 'Included' : 'Not available: battle logs only record picks, so ban advice comes from the model.'}</dd></>}
        </dl>
        {cat.error && <p class="warn">{cat.error}</p>}
        <div class="btn-row">
          <button type="button" class="btn primary" disabled={cat.refreshing} onClick={() => cat.refresh()}>{cat.refreshing ? 'Refreshing…' : 'Refresh catalog'}</button>
          <label class="btn">
            Import stats JSON
            <input type="file" accept="application/json,.json" class="visually-hidden" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importStats(f); }} />
          </label>
          {statsOrigin === 'imported' && <button type="button" class="btn ghost" onClick={() => setStats(null)}>Use daily snapshot</button>}
        </div>
      </section>

      <section class="card">
        <h3>Help</h3>
        <div class="btn-row">
          <button type="button" class="btn" onClick={onTour}>Replay the tour</button>
          <button type="button" class="btn danger" onClick={() => { if (confirm('Clear settings, favorites and the current draft?')) { localStorage.clear(); location.reload(); } }}>Reset everything</button>
        </div>
      </section>

      <section class="card about">
        <div class="about-head"><Logo size={48} /><div><h3>{APP.name}</h3><span class="hint">v{APP.version} · private build</span></div></div>
        <p><b>Unofficial fan app, not affiliated with Supercell.</b> This material is unofficial and is not endorsed by Supercell. For more information see Supercell's Fan Content Policy: <a href="https://supercell.com/en/fan-content-policy/" target="_blank" rel="noopener">supercell.com/en/fan-content-policy</a>.</p>
        <p>Brawl Stars names, portraits, map and mode art belong to Supercell. Catalog data from <a href="https://brawlapi.com" target="_blank" rel="noopener">BrawlAPI</a>; images served by the <a href="https://brawlify.com" target="_blank" rel="noopener">Brawlify</a> CDN.</p>
        <p>Suggestions, traits and matchup rules are {APP.name}'s own read, written for this app. They're opinions, not guarantees.</p>
      </section>
    </div>
  );
}
