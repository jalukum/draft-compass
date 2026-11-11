import { useEffect, useState } from 'preact/hooks';
import { APP } from './config';
import { useCatalog, useDraft, useSettings, useStats } from './store';
import { DraftScreen } from './ui/DraftScreen';
import { BrawlersScreen } from './ui/BrawlersScreen';
import { MapsScreen } from './ui/MapsScreen';
import { MeScreen } from './ui/MeScreen';
import { Tour } from './ui/Tour';
import { Logo } from './ui/bits';

type Tab = 'draft' | 'maps' | 'brawlers' | 'me';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'draft', label: 'Draft', icon: '⚔' },
  { id: 'maps', label: 'Maps', icon: '🗺' },
  { id: 'brawlers', label: 'Brawlers', icon: '☻' },
  { id: 'me', label: 'Me', icon: '⚙' },
];

function parseHash(): { tab: Tab; map: string | null } {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const tab = (TABS.some((t) => t.id === path) ? path : 'draft') as Tab;
  const params = new URLSearchParams(query ?? location.search.slice(1));
  return { tab, map: params.get('map') };
}

export function App() {
  const cat = useCatalog();
  const [settings, setSettings] = useSettings();
  const [draft, setDraft] = useDraft();
  const [stats, setStats, statsOrigin] = useStats();
  const [route, setRoute] = useState(parseHash);
  const [tour, setTour] = useState(false);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // Deep link: #/draft?map=<slug>
  useEffect(() => {
    if (route.map && cat.catalog?.maps.some((m) => m.slug === route.map) && draft.mapSlug !== route.map) setDraft((d) => ({ ...d, mapSlug: route.map }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.map, cat.catalog]);
  useEffect(() => {
    if (cat.catalog && !settings.tourDone && route.tab === 'draft' && !new URLSearchParams(location.search).has('notour')) setTour(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.catalog]);

  const go = (t: Tab) => { location.hash = `#/${t}`; };
  const endTour = () => { setTour(false); setSettings((s) => ({ ...s, tourDone: true })); };

  return (
    <div class={`app tab-${route.tab}`}>
      <header class="topbar">
        <a class="brand" href="#/draft"><Logo /><span class="brand-name">{APP.name}</span></a>
        <nav class="tabs" aria-label="Main">
          {TABS.map((t) => (
            <a href={`#/${t.id}`} class={`tab ${route.tab === t.id ? 'on' : ''}`} aria-current={route.tab === t.id ? 'page' : undefined}>
              <span class="tab-icon" aria-hidden="true">{t.icon}</span><span class="tab-label">{t.label}</span>
            </a>
          ))}
        </nav>
      </header>
      <main class="main">
        {!cat.catalog ? (
          <div class="loading card"><Logo size={64} /><p>{cat.error ?? 'Loading the brawler catalog…'}</p></div>
        ) : route.tab === 'draft' ? (
          <DraftScreen catalog={cat.catalog} draft={draft} setDraft={setDraft} settings={settings} setSettings={setSettings} stats={stats} />
        ) : route.tab === 'maps' ? (
          <MapsScreen catalog={cat.catalog} settings={settings} stats={stats} onDraft={(m) => { setDraft((d) => ({ ...d, mapSlug: m.slug })); go('draft'); }} />
        ) : route.tab === 'brawlers' ? (
          <BrawlersScreen catalog={cat.catalog} settings={settings} setSettings={setSettings} />
        ) : (
          <MeScreen catalog={cat.catalog} cat={cat} settings={settings} setSettings={setSettings} stats={stats} statsOrigin={statsOrigin} setStats={setStats} onTour={() => { go('draft'); setTimeout(() => setTour(true), 50); }} />
        )}
        <footer class="fan-note">Unofficial fan app, not affiliated with Supercell. Game art © Supercell, used under the Fan Content Policy.</footer>
      </main>
      {tour && route.tab === 'draft' && <Tour onDone={endTour} />}
    </div>
  );
}
