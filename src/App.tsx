import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { APP } from './config';
import { useCatalog, useDraft, useStats } from './store';
import type { Brawler, GameMap, MapStats } from './data/types';
import { applyBan, applyPick, emptyDraft, MAX_BANS, nextPicker, removeFrom, type DraftState, type Side } from './engine/draft';
import { autoLanes, laneEdge, LANES, suggest } from './engine/meta';
import { winChance } from './engine/winchance';
import { fmtDate, Portrait } from './ui/bits';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

type PoolMap = GameMap & { games: number };

function readRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [tab, slug] = h.split('/');
  return { tab: tab === 'maps' ? 'maps' : 'draft', slug: slug ? decodeURIComponent(slug) : null } as { tab: 'draft' | 'maps'; slug: string | null };
}

export function App() {
  const [realRoute, setRoute] = useState(readRoute);
  // Spotlight tour: shows on first launch, replay from "?". While it runs, the app renders a
  // temporary demo draft; the user's real draft and route are never touched.
  const [tour, setTour] = useState(() => { try { return !localStorage.getItem('dc:tutorialDone'); } catch { return false; } });
  const [tourStep, setTourStep] = useState(0);
  const tourScroll = useRef(0);
  useEffect(() => {
    const on = () => { tourScroll.current = scrollY; setTourStep(0); setTour(true); };
    addEventListener('dc-help', on);
    return () => removeEventListener('dc-help', on);
  }, []);
  const endTour = () => {
    try { localStorage.setItem('dc:tutorialDone', '1'); } catch { /* private mode */ }
    setTour(false); setTourStep(0);
    requestAnimationFrame(() => scrollTo({ top: tourScroll.current, behavior: 'instant' as ScrollBehavior }));
  };
  const tourEl = tour && <Tour step={tourStep} setStep={setTourStep} onDone={endTour} />;
  useEffect(() => {
    const on = () => { setRoute(readRoute()); scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const cat = useCatalog();
  const stats = useStats();
  const [realDraft, setRealDraft] = useDraft();

  // Current Ranked pool = maps with Ranked games in the last 7 days of our sample.
  const pool: PoolMap[] = useMemo(() => {
    if (!stats) return [];
    const slugs = stats.pool ?? Object.keys(stats.maps);
    return slugs.map((slug) => {
      const m = stats.maps[slug];
      return {
        id: m.mapId ?? 0, name: m.name ?? slug, slug, mode: m.mode ?? '', modeColor: m.modeColor ?? '#888',
        modeIcon: m.modeIcon ?? '', img: m.img ?? '', active: true, ranked: true, games: m.sample,
      };
    }).sort((a, b) => a.mode.localeCompare(b.mode) || a.name.localeCompare(b.name));
  }, [stats]);

  const allBrawlers = cat.catalog?.brawlers ?? [];
  const demo = useMemo(() => (tour ? demoDrafts(pool, stats, allBrawlers) : null), [tour, pool, stats, allBrawlers]);
  const draft: DraftState = demo ? demo[Math.min(tourStep, demo.length - 1)] : realDraft;
  const setDraft: typeof setRealDraft = tour ? () => {} : setRealDraft;
  const route = tour ? { tab: 'draft' as const, slug: null } : realRoute;

  const map = pool.find((m) => m.slug === draft.mapSlug) ?? null;
  const st: MapStats | null = map && stats ? stats.maps[map.slug] ?? null : null;
  const brawlers = allBrawlers;
  const byId = useMemo(() => new Map(brawlers.map((b) => [b.id, b])), [brawlers]);
  const taken = new Set([...draft.bans, ...draft.ally, ...draft.opp]);
  const picks = draft.ally.length + draft.opp.length;
  // Ranked order 1-2-2-1. Every pick goes to whoever's turn it is.
  const next: Side | null = nextPicker(draft.firstPick, draft.ally.length, draft.opp.length);
  const pickNow = (id: number) => setDraft((d) => {
    const s = nextPicker(d.firstPick, d.ally.length, d.opp.length);
    return s ? applyPick(d, id, s) : d;
  });

  // On our turn: best picks for us. On theirs: what they are likely/best to pick against us.
  const sugg = useMemo(() => (map && brawlers.length && next
    ? suggest({ brawlers, map, stats: st, bans: draft.bans, mine: next === 'ally' ? draft.ally : draft.opp, theirs: next === 'ally' ? draft.opp : draft.ally }).slice(0, 10)
    : []), [map, st, brawlers, draft.bans, draft.ally, draft.opp, next]);

  const totalGames = stats?.sample?.games ?? 0;
  const setMap = (slug: string | null) => setDraft((d) => ({ ...emptyDraft(slug), firstPick: d.firstPick, turn: d.firstPick }));
  const reset = () => setDraft((d) => ({ ...emptyDraft(d.mapSlug), firstPick: d.firstPick, turn: d.firstPick }));

  const sub = stats ? `Based on ${totalGames.toLocaleString()} Ranked games · updated ${fmtDate(stats.generatedAt ?? stats.updatedAt)}` : 'Loading ladder data…';
  const wide = useMedia('(min-width: 900px)');

  if (route.tab === 'maps') {
    return (
      <div class="app">
        {tourEl}
        <Header title="Ranked maps" sub={sub} tab="maps" />
        <MapsTab pool={pool} stats={stats} brawlers={brawlers} slug={route.slug} wide={wide}
          onDraft={(slug) => { setMap(slug); location.hash = '#/draft'; }} />
        <About />
      </div>
    );
  }

  if (!map) {
    return (
      <div class="app">
        {tourEl}
        <Header title={APP.name} sub={sub} tab="draft" />
        <section class="block start">
          <h2><span class="step">1</span> Pick the map</h2>
          <MapSearch maps={pool} onPick={(m) => setMap(m.slug)} />
        </section>
      </div>
    );
  }

  const mapBlock = (
    <section class="block">
      <h2><span class="step">1</span> Map</h2>
      <button type="button" class="map-chosen" onClick={() => setMap(null)} aria-label="Change map">
        {map.modeIcon && <img src={map.modeIcon} alt="" width={22} height={22} />}
        <span class="grow"><b>{map.name}</b><small>{map.mode} · {map.games.toLocaleString()} games</small></span>
        <span class="muted">Change</span>
      </button>
    </section>
  );
  const bansBlock = (
    <section class="block" data-tour="bans">
      <h2><span class="step">2</span> Bans <span class="count">{draft.bans.length}/{MAX_BANS}</span></h2>
      {draft.bans.length > 0 && (
        <div class="chips">
          {draft.bans.map((id) => byId.get(id)).filter(Boolean).map((b) => (
            <button type="button" class="chip ban" onClick={() => setDraft((d) => removeFrom(d, 'bans', b!.id))} aria-label={`Remove ban ${b!.name}`}>
              <Portrait b={b!} size={24} /> {b!.name} <span class="x">×</span>
            </button>
          ))}
        </div>
      )}
      {draft.bans.length < MAX_BANS && (
        <BrawlerSearch brawlers={brawlers} taken={taken} placeholder="Search a brawler to ban" onPick={(b) => setDraft((d) => applyBan(d, b.id))} />
      )}
    </section>
  );
  const pickSearch = next && (
    <BrawlerSearch brawlers={brawlers} taken={taken} placeholder={next === 'ally' ? 'Search our pick' : 'Search their pick'} onPick={(b) => pickNow(b.id)} />
  );
  const picksBlock = (
    <section class="block">
      <h2><span class="step">3</span> Picks</h2>
      <div data-tour="picks">
      <div class="order">
        <span>First pick</span>
        <div class="seg">
          {(['ally', 'opp'] as Side[]).map((s) => (
            <button type="button" class={draft.firstPick === s ? 'on' : ''} disabled={picks > 0}
              onClick={() => setDraft((d) => ({ ...d, firstPick: s, turn: s }))}>{s === 'ally' ? 'Us' : 'Them'}</button>
          ))}
        </div>
        {next ? <span class="next">Pick {picks + 1} of 6: <b class={next}>{next === 'ally' ? 'Us' : 'Them'}</b></span> : <span class="next">Draft complete</span>}
      </div>
      <Team label="Us" side="ally" ids={draft.ally} byId={byId} onRemove={(id) => setDraft((d) => removeFrom(d, 'ally', id))} />
      <Team label="Them" side="opp" ids={draft.opp} byId={byId} onRemove={(id) => setDraft((d) => removeFrom(d, 'opp', id))} />
      </div>
      {draft.ally.length > 0 && draft.opp.length > 0 && <WinBar p={winChance(st, draft.ally, draft.opp)} final={picks === 6} />}
      {wide && pickSearch && <div class="pick-search">{pickSearch}</div>}
    </section>
  );
  const suggBlock = sugg.length > 0 && (
    <section class="block" data-tour="sugg">
      <h2 class={`sugg-head ${next === 'opp' ? 'them' : 'us'}`}>{next === 'ally' ? 'Best picks for us' : 'Likely enemy picks'}<span class="cols-label">Win % · Score</span></h2>
      <ol class="sugg">
        {sugg.map((x) => (
          <li>
            <button type="button" onClick={() => pickNow(x.brawler.id)} aria-label={`Pick ${x.brawler.name} for ${next === 'ally' ? 'us' : 'them'}, score ${x.score}`}>
              <Portrait b={x.brawler} size={36} />
              <span class="grow">{x.brawler.name}</span>
              <span class="wr" title="Win rate on this map">{x.winRate === null ? '–' : `${x.winRate.toFixed(1)}%`}</span>
              <span class={`score ${x.score >= 70 ? 'hi' : x.score >= 50 ? 'mid' : 'lo'}`}>{x.score}</span>
            </button>
          </li>
        ))}
      </ol>
      {!wide && pickSearch && <div class="pick-search">{pickSearch}</div>}
    </section>
  );
  const lanesBlock = draft.ally.length > 0 && draft.opp.length > 0 && (
    <Lanes key={`${map.slug}|${[...draft.ally].sort().join()}|${[...draft.opp].sort().join()}`}
      map={map} st={st} ally={draft.ally.map((id) => byId.get(id)!).filter(Boolean)} opp={draft.opp.map((id) => byId.get(id)!).filter(Boolean)} />
  );

  return (
    <div class="app">
      {tourEl}
      <Header title={APP.name} sub={sub} tab="draft" right={<button type="button" class="btn" onClick={reset}>Reset</button>} />
      {wide ? (
        <div class="cols">
          <div class="col">{mapBlock}{bansBlock}{picksBlock}</div>
          <div class="col">{suggBlock}{lanesBlock}</div>
        </div>
      ) : (
        <>{mapBlock}{bansBlock}{picksBlock}{suggBlock}{lanesBlock}</>
      )}
    </div>
  );
}

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

function Header({ title, sub, tab, right }: { title: string; sub: string; tab: 'draft' | 'maps'; right?: preact.ComponentChildren }) {
  return (
    <header class="top">
      <div class="top-text">
        <h1>{title}</h1>
        <p class="sub">{sub}</p>
      </div>
      <Nav tab={tab} />
      <div class="top-right">
        {right}
        <button type="button" class="btn help" aria-label="How to use" onClick={() => dispatchEvent(new Event('dc-help'))}>?</button>
      </div>
    </header>
  );
}

/** Tiny About link (Maps tab only) opening the Fan Content Policy notice and credits. */
function About() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="about-link" onClick={() => setOpen(true)}>About</button>
      {open && (
        <div class="sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div class="sheet" role="dialog" aria-modal="true" aria-label="About">
            <div class="sheet-top"><b>About</b><button type="button" class="btn" onClick={() => setOpen(false)}>Close</button></div>
            <p>This material is unofficial and is not endorsed by Supercell. For more information see{' '}
              <a href="https://supercell.com/en/fan-content-policy/" target="_blank" rel="noopener">Supercell's Fan Content Policy</a>.</p>
            <p>Stats come from our own daily sample of Ranked battle logs (official Brawl Stars API). Brawler catalog from{' '}
              <a href="https://brawlapi.com" target="_blank" rel="noopener">BrawlAPI</a>; art via Brawlify.</p>
          </div>
        </div>
      )}
    </>
  );
}

function MapSearch({ maps, onPick }: { maps: PoolMap[]; onPick: (m: PoolMap) => void }) {
  const [q, setQ] = useState('');
  const hits = maps.filter((m) => !q || norm(m.name).includes(norm(q)) || norm(m.mode).includes(norm(q)));
  return (
    <div class="search">
      <input type="search" placeholder={`Search ${maps.length} Ranked maps`} value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) onPick(hits[0]); }} aria-label="Search maps" data-tour="map" />
      <MapList maps={hits} onPick={onPick} />
      {!hits.length && <p class="hint">No Ranked map matches.</p>}
    </div>
  );
}

/** Current Ranked maps grouped by mode, as tappable rows. */
function MapList({ maps, onPick, href, active }: { maps: PoolMap[]; onPick?: (m: PoolMap) => void; href?: (m: PoolMap) => string; active?: string | null }) {
  const modes = [...new Set(maps.map((m) => m.mode))];
  return (
    <div class="maplist">
      {modes.map((mode) => (
        <div class="mode-group">
          <h4>{maps.find((m) => m.mode === mode)?.modeIcon && <img src={maps.find((m) => m.mode === mode)!.modeIcon} alt="" width={16} height={16} />}{mode}</h4>
          <ul>
            {maps.filter((m) => m.mode === mode).map((m) => (
              <li>{href
                ? <a href={href(m)} class={active === m.slug ? 'on' : ''}><span class="grow">{m.name}</span><small class="muted">{m.games.toLocaleString()}</small></a>
                : <button type="button" onClick={() => onPick?.(m)}><span class="grow">{m.name}</span><small class="muted">{m.games.toLocaleString()} games</small></button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BrawlerSearch({ brawlers, taken, placeholder, onPick }: { brawlers: Brawler[]; taken: Set<number>; placeholder: string; onPick: (b: Brawler) => void }) {
  const [q, setQ] = useState('');
  const hits = q ? brawlers.filter((b) => !taken.has(b.id) && norm(b.name).startsWith(norm(q))).concat(
    brawlers.filter((b) => !taken.has(b.id) && !norm(b.name).startsWith(norm(q)) && norm(b.name).includes(norm(q))),
  ).slice(0, 6) : [];
  const pick = (b: Brawler) => { onPick(b); setQ(''); };
  return (
    <div class="search">
      <input type="search" placeholder={placeholder} value={q} aria-label={placeholder}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) pick(hits[0]); }} />
      {q && (
        <ul class="results">
          {hits.map((b) => <li><button type="button" onClick={() => pick(b)}><Portrait b={b} size={28} /><span class="grow">{b.name}</span></button></li>)}
          {!hits.length && <li class="empty">No match (or already taken).</li>}
        </ul>
      )}
    </div>
  );
}

function Team({ label, side, ids, byId, onRemove }: { label: string; side: Side; ids: number[]; byId: Map<number, Brawler>; onRemove: (id: number) => void }) {
  return (
    <div class={`team ${side}`}>
      <span class="team-label">{label}</span>
      {[0, 1, 2].map((i) => {
        const b = byId.get(ids[i]);
        return b
          ? <button type="button" class="slot filled" onClick={() => onRemove(b.id)} aria-label={`Remove ${b.name}`}><Portrait b={b} size={30} /><span>{b.name}</span></button>
          : <span class="slot" />;
      })}
    </div>
  );
}

function Lanes({ map, st, ally, opp }: { map: GameMap; st: MapStats | null; ally: Brawler[]; opp: Brawler[] }) {
  const [them, setThem] = useState(() => autoLanes(opp, map, st));
  const [us, setUs] = useState(() => autoLanes(ally, map, st, autoLanes(opp, map, st)));
  const [sel, setSel] = useState<{ side: Side; i: number } | null>(null);
  const tap = (side: Side, i: number) => {
    if (!sel || sel.side !== side) { setSel({ side, i }); return; }
    if (sel.i !== i) {
      const set = side === 'ally' ? setUs : setThem;
      set((arr) => { const a = [...arr]; [a[sel.i], a[i]] = [a[i], a[sel.i]]; return a; });
    }
    setSel(null);
  };
  return (
    <section class="block" data-tour="lanes">
      <h2><span class="step">4</span> Lane matchups</h2>
      <p class="hint">Tap two brawlers on the same side to swap lanes.</p>
      <div class="lanes">
        {LANES.map((lane, i) => {
          const a = us[i], e = them[i];
          const p = a && e ? laneEdge(st, map, a, e).p : null;
          const pct = p === null ? null : Math.round(p * 100);
          return (
            <div class="lane">
              <span class="lane-name">{lane}</span>
              <button type="button" class={`lane-b ally ${sel?.side === 'ally' && sel.i === i ? 'sel' : ''}`} onClick={() => tap('ally', i)}>
                {a ? <><Portrait b={a} size={30} /><span>{a.name}</span></> : <span class="muted">—</span>}
              </button>
              <span class={`lane-score ${pct === null ? '' : pct >= 53 ? 'hi' : pct <= 47 ? 'lo' : 'mid'}`}>{pct === null ? '' : `${pct}%`}</span>
              <button type="button" class={`lane-b opp ${sel?.side === 'opp' && sel.i === i ? 'sel' : ''}`} onClick={() => tap('opp', i)}>
                {e ? <><span>{e.name}</span><Portrait b={e} size={30} /></> : <span class="muted">—</span>}
              </button>
            </div>
          );
        })}
      </div>
      <p class="hint">% = our side's chance to win that matchup, from Ranked games on this map.</p>
    </section>
  );
}

function Nav({ tab }: { tab: 'draft' | 'maps' }) {
  return (
    <nav class="nav">
      <a href="#/draft" class={tab === 'draft' ? 'on' : ''}>Draft</a>
      <a href="#/maps" class={tab === 'maps' ? 'on' : ''} data-tour="maps">Maps</a>
    </nav>
  );
}

function MapsTab({ pool, stats, brawlers, slug, wide, onDraft }: {
  pool: PoolMap[]; stats: ReturnType<typeof useStats>; brawlers: Brawler[]; slug: string | null; wide: boolean; onDraft: (slug: string) => void;
}) {
  const [q, setQ] = useState('');
  const map = (slug ? pool.find((m) => m.slug === slug) : null) ?? (wide ? pool[0] ?? null : null);
  const hits = pool.filter((m) => !q || norm(m.name).includes(norm(q)) || norm(m.mode).includes(norm(q)));
  const list = (
    <section class="block">
      <div class="search">
        <input type="search" placeholder={`Search ${pool.length} Ranked maps`} value={q} aria-label="Search Ranked maps" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </div>
      <MapList maps={hits} href={(m) => `#/maps/${encodeURIComponent(m.slug)}`} active={map?.slug} />
      {!hits.length && <p class="hint">No Ranked map matches.</p>}
    </section>
  );
  const detail = map && stats && (() => {
    const top = suggest({ brawlers, map, stats: stats.maps[map.slug] ?? null, bans: [], mine: [], theirs: [] }).slice(0, 10);
    return (
      <section class="block">
        {!wide && <a class="back" href="#/maps">‹ All maps</a>}
        <div class="map-head">
          {map.modeIcon && <img src={map.modeIcon} alt="" width={26} height={26} />}
          <div class="grow"><b>{map.name}</b><small>{map.mode} · {map.games.toLocaleString()} games</small></div>
        </div>
        {map.img && <MapImage src={map.img} name={map.name} />}
        <h3>Top 10 picks</h3>
        <ol class="sugg top10">
          {top.map((x, i) => (
            <li><div class="row">
              <span class="rank">{i + 1}</span>
              <Portrait b={x.brawler} size={36} />
              <span class="grow">{x.brawler.name}<small>{x.winRate === null ? 'no games' : `${x.winRate.toFixed(1)}% win · ${x.pickRate.toFixed(1)}% pick · ${x.games.toLocaleString()} games`}</small></span>
              <span class={`score ${x.score >= 70 ? 'hi' : x.score >= 50 ? 'mid' : 'lo'}`}>{x.score}</span>
            </div></li>
          ))}
        </ol>
        <button type="button" class="btn primary wide" onClick={() => onDraft(map.slug)}>Draft on this map</button>
      </section>
    );
  })();
  if (wide) return <div class="cols maps-cols"><div class="col">{list}</div><div class="col">{detail}</div></div>;
  return slug && detail ? detail : list;
}

function WinBar({ p, final }: { p: number; final: boolean }) {
  const pct = Math.round(p * 100);
  return (
    <div class="winbar" data-tour="win" aria-label={`Win chance ${pct}%`}>
      <div class="winbar-label"><span>{final ? 'Win chance' : 'Win chance so far'} <b class={pct >= 53 ? 'good' : pct <= 47 ? 'bad' : ''}>{pct}%</b></span><span class="muted">Them {100 - pct}%</span></div>
      <div class="winbar-track"><span class="winbar-us" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** Maps tab: the actual map layout from Brawlify's CDN, tap for a full-screen view (no zoom animation). */
function MapImage({ src, name }: { src: string; name: string }) {
  const [big, setBig] = useState(false);
  return (
    <>
      <button type="button" class="map-img" onClick={() => setBig(true)} aria-label={`View the ${name} layout larger`}>
        <img src={src} alt={`${name} layout`} />
      </button>
      {big && (
        <div class="sheet-bg map-big" role="dialog" aria-modal="true" aria-label={`${name} layout`} onClick={() => setBig(false)}>
          <img src={src} alt={`${name} layout`} />
          <span class="muted">Tap anywhere to close</span>
        </div>
      )}
    </>
  );
}

// ---- Spotlight tour ---------------------------------------------------------
const STEPS: { title: string; text: string; targets: string[] }[] = [
  { title: 'Pick the map', text: 'Search or tap one of the current Ranked maps to start a draft.', targets: ['map'] },
  { title: 'Add bans', text: 'Search a brawler here and tap it to ban it. Tap a ban to remove it.', targets: ['bans'] },
  { title: 'Picks go 1-2-2-1', text: 'Choose who picks first. Every pick fills whoever\'s turn it is, just like Ranked.', targets: ['picks'] },
  { title: 'Suggestions', text: 'Best picks for the current turn, with win % on this map and a score. Tap one to pick it. On their turn it shows likely enemy picks.', targets: ['sugg'] },
  { title: 'Win chance and lanes', text: 'The bar is your team\'s chance to win. Lanes show each matchup; tap two of your brawlers to swap lanes.', targets: ['win', 'lanes'] },
  { title: 'Maps tab', text: 'Top 10 picks and the layout for every Ranked map.', targets: ['maps'] },
];

/** Temporary example drafts for the tour (Hard Rock Mine, top picks from our own data). */
function demoDrafts(pool: PoolMap[], stats: ReturnType<typeof useStats>, brawlers: Brawler[]): DraftState[] {
  const m = pool.find((p) => p.slug === 'hard-rock-mine-gem-grab') ?? pool[0];
  const base: DraftState = { ...emptyDraft(null), firstPick: 'ally', turn: 'ally' };
  const onMap = { ...base, mapSlug: m?.slug ?? null };
  if (!m || !stats || !brawlers.length) return [base, onMap, onMap, onMap, onMap, onMap];
  const st = stats.maps[m.slug] ?? null;
  const bans = suggest({ brawlers, map: m, stats: st, bans: [], mine: [], theirs: [] }).slice(0, 2).map((x) => x.brawler.id);
  const ally: number[] = [], opp: number[] = [];
  const snap = () => ({ ...onMap, bans: [...bans], ally: [...ally], opp: [...opp], turn: nextPicker('ally', ally.length, opp.length) ?? 'ally' });
  const pickOne = () => {
    const s = nextPicker('ally', ally.length, opp.length);
    if (!s) return;
    const taken = new Set([...bans, ...ally, ...opp]);
    const mine = s === 'ally' ? ally : opp;
    const x = suggest({ brawlers, map: m, stats: st, bans, mine, theirs: s === 'ally' ? opp : ally }).find((y) => !taken.has(y.brawler.id));
    if (x) mine.push(x.brawler.id);
  };
  const banned = snap();
  for (let k = 0; k < 3; k++) pickOne();
  const mid = snap();
  for (let k = 0; k < 3; k++) pickOne();
  const full = snap();
  return [base, banned, mid, mid, full, full];
}

interface Box { top: number; left: number; width: number; height: number }
interface TourLayout { holes: Box[]; card: { top: number; left: number; width: number }; arrow: { x: number; dir: 'up' | 'down' } | null }

function Tour({ step, setStep, onDone }: { step: number; setStep: (n: number) => void; onDone: () => void }) {
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const cardRef = useRef<HTMLDivElement>(null);
  const safeRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const scrolled = useRef(-1);
  const [lay, setLay] = useState<TourLayout | null>(null);
  const [vp, setVp] = useState({ w: innerWidth, h: innerHeight });

  useLayoutEffect(() => {
    const PAD = 6, GAP = 14;
    const compute = () => {
      const safe = safeRef.current?.getBoundingClientRect();
      if (!safe) return;
      const cardH = cardRef.current?.offsetHeight || 210;
      const cardW = Math.min(400, safe.width - 24);
      const els = s.targets.flatMap((t) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${t}"]`)]);
      const measure = () => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      let rs = measure();
      const maxH = Math.max(80, safe.height - cardH - GAP - 2 * PAD - 24);
      const union = (list: DOMRect[]) => {
        const top = Math.min(...list.map((r) => r.top)), left = Math.min(...list.map((r) => r.left));
        const bottom = Math.max(...list.map((r) => Math.min(r.bottom, r.top + maxH))), right = Math.max(...list.map((r) => r.right));
        return { top, left, bottom, right };
      };
      // Scroll the target into view once per step, instantly (no smooth scroll).
      if (rs.length && scrolled.current !== step) {
        scrolled.current = step;
        const u = union(rs);
        scrollBy({ top: u.top - PAD - (safe.top + 12), behavior: 'instant' as ScrollBehavior });
        rs = measure();
      }
      let next: TourLayout;
      if (!rs.length) {
        next = { holes: [], card: { top: safe.top + (safe.height - cardH) / 2, left: safe.left + (safe.width - cardW) / 2, width: cardW }, arrow: null };
      } else {
        const holes = rs.map((r) => ({ top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: Math.min(r.height, maxH) + 2 * PAD }));
        const u = union(rs);
        const uTop = u.top - PAD, uBot = u.bottom + PAD;
        const below = safe.bottom - uBot, above = uTop - safe.top;
        let top: number, dir: 'up' | 'down';
        if (below >= cardH + GAP + 8) { top = uBot + GAP; dir = 'up'; }
        else if (above >= cardH + GAP + 8) { top = uTop - GAP - cardH; dir = 'down'; }
        else if (below >= above) { top = safe.bottom - 8 - cardH; dir = 'up'; }
        else { top = safe.top + 8; dir = 'down'; }
        // Point at the highlighted box nearest the card (matters when there are two).
        const near = holes.reduce((m, h) => (dir === 'up' ? (h.top + h.height > m.top + m.height ? h : m) : (h.top < m.top ? h : m)));
        const ax = near.left + near.width / 2;
        const left = Math.min(Math.max(ax - cardW / 2, safe.left + 12), safe.right - 12 - cardW);
        next = { holes, card: { top: Math.round(top), left: Math.round(left), width: Math.round(cardW) }, arrow: { x: Math.round(Math.min(Math.max(ax - left, 22), cardW - 22)), dir } };
      }
      setLay((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next));
      setVp((p) => (p.w === innerWidth && p.h === innerHeight ? p : { w: innerWidth, h: innerHeight }));
    };
    compute();
    const t = setInterval(compute, 200);
    addEventListener('scroll', compute, { passive: true });
    addEventListener('resize', compute);
    return () => { clearInterval(t); removeEventListener('scroll', compute); removeEventListener('resize', compute); };
  }, [step]);

  useEffect(() => { nextRef.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onDone]);

  return (
    <div class="tour" role="dialog" aria-modal="true" aria-label="How to use Draft Compass">
      <div class="tour-safe" ref={safeRef} />
      <svg class="tour-dim" width={vp.w} height={vp.h} viewBox={`0 0 ${vp.w} ${vp.h}`} aria-hidden="true">
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width={vp.w} height={vp.h} fill="#fff" />
            {lay?.holes.map((h) => <rect x={h.left} y={h.top} width={h.width} height={h.height} rx="10" fill="#000" />)}
          </mask>
        </defs>
        <rect x="0" y="0" width={vp.w} height={vp.h} fill="#000" fill-opacity="0.74" mask="url(#tour-mask)" />
        {lay?.holes.map((h) => <rect class="tour-ring" data-ring="1" x={h.left} y={h.top} width={h.width} height={h.height} rx="10" />)}
      </svg>
      <div class="tour-card" ref={cardRef} data-step={step + 1}
        style={lay ? { top: `${lay.card.top}px`, left: `${lay.card.left}px`, width: `${lay.card.width}px` } : { visibility: 'hidden' }}>
        {lay?.arrow && <span class={`tour-arrow ${lay.arrow.dir}`} style={{ left: `${lay.arrow.x}px` }} />}
        <div class="tour-top">
          <span class="muted">{step + 1} of {STEPS.length}{step >= 1 && step <= 4 ? ' · example draft' : ''}</span>
          <button type="button" class="tour-skip" onClick={onDone}>Skip</button>
        </div>
        <h2>{s.title}</h2>
        <p>{s.text}</p>
        <div class="tour-dots">{STEPS.map((_, k) => <span class={k === step ? 'on' : ''} />)}</div>
        <div class="tour-btns">
          <button type="button" class="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          <button type="button" class="btn primary" ref={nextRef} onClick={() => (last ? onDone() : setStep(step + 1))}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
