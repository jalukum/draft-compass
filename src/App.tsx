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
  // Walkthrough: shows on first launch, replay from "?". While it runs, the app renders a separate
  // example draft; the user's real draft and route are never touched.
  const [tour, setTour] = useState(() => { try { return !localStorage.getItem('dc:tutorialDone'); } catch { return false; } });
  const [tourStep, setTourStep] = useState(0);
  const [tourDraft, setTourDraft] = useState<DraftState>(() => emptyDraft());
  const tourScroll = useRef(0);
  useEffect(() => {
    const on = () => { tourScroll.current = scrollY; setTourDraft(emptyDraft()); setTourStep(0); setTour(true); };
    addEventListener('dc-help', on);
    return () => removeEventListener('dc-help', on);
  }, []);
  const endTour = () => {
    try { localStorage.setItem('dc:tutorialDone', '1'); } catch { /* private mode */ }
    setTour(false); setTourStep(0);
    requestAnimationFrame(() => scrollTo({ top: tourScroll.current, behavior: 'instant' as ScrollBehavior }));
  };
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
  const draft: DraftState = tour ? tourDraft : realDraft;
  const setDraft = (tour ? setTourDraft : setRealDraft) as typeof setRealDraft;
  const route = tour ? (WALK[tourStep].route === 'maps' ? { tab: 'maps' as const, slug: tourDraft.mapSlug } : { tab: 'draft' as const, slug: null }) : realRoute;
  const tourEl = tour && <Tour step={tourStep} setStep={setTourStep} draft={tourDraft} setDraft={setTourDraft}
    ctx={{ pool, stats, brawlers: allBrawlers }} onDone={endTour} />;

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
          onDraft={(slug) => { if (tour) { dispatchEvent(new Event('dc-tour-draftmap')); return; } setMap(slug); location.hash = '#/draft'; }} />
        <About />
      </div>
    );
  }

  if (!map) {
    return (
      <div class="app">
        {tourEl}
        <Header title={APP.name} sub={sub} tab="draft" />
        <section class="block start" data-tour="mapstart">
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
        <div class="chips" data-tour="banchips">
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
      <div class="order">
        <span>First pick</span>
        <div class="seg" data-tour="first">
          {(['ally', 'opp'] as Side[]).map((s) => (
            <button type="button" class={draft.firstPick === s ? 'on' : ''} disabled={picks > 0}
              onClick={() => setDraft((d) => ({ ...d, firstPick: s, turn: s }))}>{s === 'ally' ? 'Us' : 'Them'}</button>
          ))}
        </div>
        {next ? <span class="next" data-tour="turn">Pick {picks + 1} of 6: <b class={next}>{next === 'ally' ? 'Us' : 'Them'}</b></span> : <span class="next">Draft complete</span>}
      </div>
      <div data-tour="teams">
      <Team label="Us" side="ally" ids={draft.ally} byId={byId} onRemove={(id) => setDraft((d) => removeFrom(d, 'ally', id))} />
      <Team label="Them" side="opp" ids={draft.opp} byId={byId} onRemove={(id) => setDraft((d) => removeFrom(d, 'opp', id))} />
      </div>
      {draft.ally.length > 0 && draft.opp.length > 0 && <WinBar p={winChance(st, draft.ally, draft.opp)} final={picks === 6} />}
      {wide && pickSearch && <div class="pick-search" data-tour="picksearch">{pickSearch}</div>}
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
      {!wide && pickSearch && <div class="pick-search" data-tour="picksearch">{pickSearch}</div>}
    </section>
  );
  const lanesBlock = draft.ally.length > 0 && draft.opp.length > 0 && (
    <Lanes key={`${map.slug}|${[...draft.ally].sort().join()}|${[...draft.opp].sort().join()}`}
      map={map} st={st} ally={draft.ally.map((id) => byId.get(id)!).filter(Boolean)} opp={draft.opp.map((id) => byId.get(id)!).filter(Boolean)} />
  );

  return (
    <div class="app">
      {tourEl}
      <Header title={APP.name} sub={sub} tab="draft" right={<button type="button" class="btn" onClick={reset} data-tour="reset">Reset</button>} />
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
  useEffect(() => { // walkthrough "Next" on the lanes step swaps our first two lanes
    const demo = () => setUs((arr) => { const a = [...arr]; [a[0], a[1]] = [a[1], a[0]]; return a; });
    addEventListener('dc-demo-swap', demo);
    return () => removeEventListener('dc-demo-swap', demo);
  }, []);
  const tap = (side: Side, i: number) => {
    if (!sel || sel.side !== side) { setSel({ side, i }); return; }
    if (sel.i !== i) {
      const set = side === 'ally' ? setUs : setThem;
      set((arr) => { const a = [...arr]; [a[sel.i], a[i]] = [a[i], a[sel.i]]; return a; });
      dispatchEvent(new Event('dc-lane-swap'));
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
  const go = (t: 'draft' | 'maps') => (e: Event) => {
    if (document.querySelector('.tour')) { e.preventDefault(); dispatchEvent(new CustomEvent('dc-tour-nav', { detail: t })); }
  };
  return (
    <nav class="nav">
      <a href="#/draft" class={tab === 'draft' ? 'on' : ''} onClick={go('draft')}>Draft</a>
      <a href="#/maps" class={tab === 'maps' ? 'on' : ''} data-tour="maps" onClick={go('maps')}>Maps</a>
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
        <button type="button" class="btn primary wide" data-tour="draftmap" onClick={() => onDraft(map.slug)}>Draft on this map</button>
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

// ---- Walkthrough tour -------------------------------------------------------
// A step-by-step draft on a separate example draft. Each step spotlights one control; the user can
// do the action (the step then advances by itself) or tap Next to have it done with demo values.
interface TourCtx { pool: PoolMap[]; stats: ReturnType<typeof useStats>; brawlers: Brawler[] }
interface TourStep {
  id: string; title: string; text: string; targets: string[];
  route?: 'maps';
  /** Stay on the step after the user's action so they can see the result; Next then moves on. */
  stay?: boolean;
  ensure?: (d: DraftState, c: TourCtx) => DraftState;
  done?: (entry: DraftState, d: DraftState) => boolean;
  auto?: (d: DraftState, c: TourCtx) => DraftState;
}

const DEMO_MAP = 'hard-rock-mine-gem-grab';
const demoSlug = (c: TourCtx) => (c.pool.find((m) => m.slug === DEMO_MAP) ?? c.pool[0])?.slug ?? DEMO_MAP;
const nPicks = (d: DraftState) => d.ally.length + d.opp.length;
const withMap = (d: DraftState, c: TourCtx) => (d.mapSlug ? d : { ...d, mapSlug: demoSlug(c) });
function topFor(d: DraftState, c: TourCtx, side: Side, forBan = false): number | null {
  const map = c.pool.find((m) => m.slug === d.mapSlug);
  if (!map || !c.brawlers.length) return null;
  const taken = new Set([...d.bans, ...d.ally, ...d.opp]);
  const list = suggest({ brawlers: c.brawlers, map, stats: c.stats?.maps[map.slug] ?? null, bans: d.bans,
    mine: forBan ? [] : side === 'ally' ? d.ally : d.opp, theirs: forBan ? [] : side === 'ally' ? d.opp : d.ally });
  return list.find((x) => !taken.has(x.brawler.id))?.brawler.id ?? null;
}
function pickTop(d: DraftState, c: TourCtx): DraftState {
  const s = nextPicker(d.firstPick, d.ally.length, d.opp.length);
  const id = s && topFor(d, c, s);
  return s && id !== null && id !== undefined ? applyPick(d, id, s) : d;
}
function banTop(d: DraftState, c: TourCtx): DraftState {
  const id = topFor(d, c, 'ally', true);
  return id !== null && d.bans.length < MAX_BANS ? applyBan(d, id) : d;
}
/** Auto-pick until it's the given side's turn (or the draft is full). */
function untilTurn(d: DraftState, c: TourCtx, side: Side | null): DraftState {
  for (let k = 0; k < 6 && nextPicker(d.firstPick, d.ally.length, d.opp.length) !== side; k++) {
    const n = pickTop(d, c); if (n === d) break; d = n;
  }
  return d;
}

const WALK: TourStep[] = [
  { id: 'map', title: 'Pick the map', text: 'Search or tap one of the current Ranked maps to start a draft.', targets: ['mapstart'],
    done: (_e, d) => !!d.mapSlug, auto: (d, c) => ({ ...emptyDraft(demoSlug(c)), firstPick: d.firstPick, turn: d.firstPick }) },
  { id: 'ban', title: 'Add a ban', text: 'Type a brawler into the ban search and tap it to ban it.', targets: ['bans'],
    ensure: withMap, done: (e, d) => d.bans.length > e.bans.length, auto: (d, c) => banTop(banTop(d, c), c) },
  { id: 'unban', title: 'Remove a ban', text: 'Tap a ban to remove it if you added the wrong one.', targets: ['banchips'],
    ensure: (d, c) => (d.bans.length ? d : banTop(withMap(d, c), c)), done: (e, d) => d.bans.length < e.bans.length,
    auto: (d) => removeFrom(d, 'bans', d.bans[d.bans.length - 1]) },
  { id: 'first', title: 'Set first pick', text: 'Choose whether we or they pick first; this sets the 1-2-2-1 order.', targets: ['first'],
    ensure: (d, c) => ({ ...withMap(d, c), ally: [], opp: [] }), done: (e, d) => d.firstPick !== e.firstPick,
    auto: (d) => ({ ...d, firstPick: 'ally', turn: 'ally' }) },
  { id: 'pick', title: 'Tap a suggestion', text: 'Tap a suggestion to pick it, and watch the turn switch to the other team.', targets: ['turn', 'sugg'], stay: true,
    ensure: (d, c) => (nPicks(d) >= 6 ? { ...d, ally: [], opp: [] } : withMap(d, c)), done: (e, d) => nPicks(d) > nPicks(e), auto: pickTop },
  { id: 'enemylist', title: 'Their turn', text: 'On their turn the list becomes "Likely enemy picks"; tap the brawler they took.', targets: ['sugg'],
    ensure: (d, c) => untilTurn(d, c, 'opp'), done: (e, d) => nPicks(d) > nPicks(e), auto: pickTop },
  { id: 'enemysearch', title: 'Add their pick by search', text: 'Or search for the brawler they picked and tap it to add it to their team.', targets: ['picksearch'],
    ensure: (d, c) => untilTurn(d, c, 'opp'), done: (e, d) => nPicks(d) > nPicks(e), auto: pickTop },
  { id: 'remove', title: 'Remove a pick', text: 'Tap a filled slot to remove that pick if it was a mistake.', targets: ['teams'], stay: true,
    ensure: (d, c) => (nPicks(d) ? d : pickTop(d, c)), done: (e, d) => nPicks(d) < nPicks(e),
    auto: (d) => (d.opp.length ? removeFrom(d, 'opp', d.opp[d.opp.length - 1]) : removeFrom(d, 'ally', d.ally[d.ally.length - 1])) },
  { id: 'score', title: 'Score vs win %', text: 'Win % is how the brawler does on this map, while the score also counts counters and synergy with this draft, so go by the score.', targets: ['sugg'],
    ensure: (d, c) => { d = untilTurn(d, c, 'ally'); return nPicks(d) >= 6 ? { ...d, opp: d.opp.slice(0, 2) } : d; } },
  { id: 'win', title: 'Win chance', text: 'Once both teams have picks, this bar shows our team\'s chance to win from all the matchups.', targets: ['win'],
    ensure: (d, c) => untilTurn(d, c, null) },
  { id: 'lanes', title: 'Lanes', text: 'Each lane shows our chance in that matchup; tap two of our brawlers to swap their lanes.', targets: ['lanes'], stay: true,
    ensure: (d, c) => untilTurn(d, c, null), auto: (d) => { dispatchEvent(new Event('dc-demo-swap')); return d; } },
  { id: 'reset', title: 'Reset', text: 'Reset clears the bans and picks but keeps the map, ready for the next game.', targets: ['reset'],
    done: (e, d) => nPicks(e) + e.bans.length > 0 && nPicks(d) + d.bans.length === 0,
    auto: (d) => ({ ...emptyDraft(d.mapSlug), firstPick: d.firstPick, turn: d.firstPick }) },
  { id: 'mapstab', title: 'Maps tab', text: 'Open the Maps tab for every Ranked map\'s layout and top 10 picks.', targets: ['maps'] },
  { id: 'draftmap', title: 'Draft on this map', text: 'Tap "Draft on this map" to start a draft there; that ends this walkthrough.', targets: ['draftmap'], route: 'maps',
    ensure: withMap },
];

interface Box { top: number; left: number; width: number; height: number }
interface TourLayout { holes: Box[]; card: { top: number; left: number; width: number }; arrow: { x: number; dir: 'up' | 'down' } | null }
const rr = (b: Box, r = 10) => `M${b.left + r},${b.top}h${b.width - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${b.height - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${b.width - 2 * r}a${r},${r} 0 0 1 -${r},-${r}v-${b.height - 2 * r}a${r},${r} 0 0 1 ${r},-${r}z`;

function Tour({ step, setStep, draft, setDraft, ctx, onDone }: {
  step: number; setStep: (n: number) => void; draft: DraftState; setDraft: (d: DraftState) => void; ctx: TourCtx; onDone: () => void;
}) {
  const s = WALK[step];
  const last = step === WALK.length - 1;
  const entry = useRef(draft);
  const snaps = useRef<DraftState[]>([draft]);
  const cardRef = useRef<HTMLDivElement>(null);
  const safeRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const [lay, setLay] = useState<TourLayout | null>(null);
  const [vp, setVp] = useState({ w: innerWidth, h: innerHeight });

  const goto = (n: number, d: DraftState) => {
    if (n >= WALK.length) { onDone(); return; }
    entry.current = d; snaps.current[n] = d; setDraft(d); setStep(n);
  };
  const advance = (useAuto: boolean) => {
    let d = draft;
    if (useAuto && s.auto && !s.done?.(entry.current, d) && !(s.id === 'lanes' && swapped)) d = s.auto(d, ctx);
    setSwapped(false);
    if (last) { onDone(); return; }
    const nx = WALK[step + 1];
    goto(step + 1, nx.ensure ? nx.ensure(d, ctx) : d);
  };
  const back = () => { if (step > 0) goto(step - 1, snaps.current[step - 1]); };
  const adv = useRef(advance); adv.current = advance;

  // The user did the step's action themselves: move on.
  const [swapped, setSwapped] = useState(false);
  useEffect(() => { if (!s.stay && s.done?.(entry.current, draft)) adv.current(false); }, [draft, step]);
  useEffect(() => {
    const swap = () => { if (WALK[step].id === 'lanes') setSwapped(true); };
    const nav = (e: Event) => { if (WALK[step].id === 'mapstab' && (e as CustomEvent).detail === 'maps') adv.current(false); };
    const draftHere = () => onDone();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); };
    addEventListener('dc-lane-swap', swap); addEventListener('dc-tour-nav', nav); addEventListener('dc-tour-draftmap', draftHere); addEventListener('keydown', key);
    return () => { removeEventListener('dc-lane-swap', swap); removeEventListener('dc-tour-nav', nav); removeEventListener('dc-tour-draftmap', draftHere); removeEventListener('keydown', key); };
  }, [step, onDone]);

  useLayoutEffect(() => {
    const PAD = 6, GAP = 14;
    const compute = () => {
      const safe = safeRef.current?.getBoundingClientRect();
      if (!safe) return;
      const cardH = cardRef.current?.offsetHeight || 220;
      const cardW = Math.min(400, safe.width - 24);
      const els = s.targets.flatMap((t) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${t}"]`)]);
      const measure = () => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      let rs = measure();
      const maxH = Math.max(80, safe.height - cardH - GAP - 2 * PAD - 24);
      // Keep the target in view, instantly (no smooth scroll), until the user scrolls themselves;
      // this also catches layout that settles late (e.g. the map image loading).
      if (rs.length && !userScrolled.current) {
        const top = Math.min(...rs.map((r) => r.top));
        const fixed = els.some((e) => getComputedStyle(e.closest('.nav') ?? e).position === 'fixed');
        const dy = top - PAD - (safe.top + 12);
        if (!fixed && Math.abs(dy) > 2) { scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior }); rs = measure(); }
      }
      let next: TourLayout;
      if (!rs.length) {
        next = { holes: [], card: { top: Math.round(safe.top + (safe.height - cardH) / 2), left: Math.round(safe.left + (safe.width - cardW) / 2), width: Math.round(cardW) }, arrow: null };
      } else {
        // Clip tall targets so the highlight plus the card fit on screen.
        const top0 = Math.max(Math.min(...rs.map((r) => r.top)), safe.top + PAD);
        const limit = top0 + maxH;
        const holes = rs.filter((r) => r.top < limit).map((r) => {
          const t = Math.max(r.top, safe.top + PAD - (r.top < safe.top ? 0 : PAD));
          const b = Math.min(r.bottom, limit);
          return { top: Math.round(t - PAD), left: Math.round(r.left - PAD), width: Math.round(r.width + 2 * PAD), height: Math.round(Math.max(b - t, 0) + 2 * PAD) };
        });
        const uTop = Math.min(...holes.map((h) => h.top)), uBot = Math.max(...holes.map((h) => h.top + h.height));
        const below = safe.bottom - uBot, above = uTop - safe.top;
        let top: number, dir: 'up' | 'down';
        if (below >= cardH + GAP + 8) { top = uBot + GAP; dir = 'up'; }
        else if (above >= cardH + GAP + 8) { top = uTop - GAP - cardH; dir = 'down'; }
        else if (below >= above) { top = safe.bottom - 8 - cardH; dir = 'up'; }
        else { top = safe.top + 8; dir = 'down'; }
        const near = holes.reduce((m, h) => (dir === 'up' ? (h.top + h.height > m.top + m.height ? h : m) : (h.top < m.top ? h : m)));
        const ax = near.left + near.width / 2;
        const left = Math.min(Math.max(ax - cardW / 2, safe.left + 12), safe.right - 12 - cardW);
        next = { holes, card: { top: Math.round(top), left: Math.round(left), width: Math.round(cardW) }, arrow: { x: Math.round(Math.min(Math.max(ax - left, 22), cardW - 22)), dir } };
      }
      setLay((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next));
      setVp((p) => (p.w === innerWidth && p.h === innerHeight ? p : { w: innerWidth, h: innerHeight }));
    };
    userScrolled.current = false;
    const mine = () => { userScrolled.current = true; };
    addEventListener('wheel', mine, { passive: true }); addEventListener('touchmove', mine, { passive: true });
    compute();
    const t = setInterval(compute, 200);
    const mo = new MutationObserver(() => requestAnimationFrame(compute));
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    addEventListener('scroll', compute, { passive: true });
    addEventListener('resize', compute);
    return () => { clearInterval(t); mo.disconnect(); removeEventListener('wheel', mine); removeEventListener('touchmove', mine); removeEventListener('scroll', compute); removeEventListener('resize', compute); };
  }, [step]);

  const acts = !!(s.done || s.auto || s.id === 'mapstab');
  const dim = `M0,0H${vp.w}V${vp.h}H0Z` + (lay?.holes.map((h) => rr(h)).join('') ?? '');
  return (
    <div class="tour" role="dialog" aria-modal="false" aria-label="How to use Draft Compass">
      <div class="tour-safe" ref={safeRef} />
      <svg class="tour-dim" width={vp.w} height={vp.h} viewBox={`0 0 ${vp.w} ${vp.h}`} aria-hidden="true">
        {/* even-odd: the holes are neither dimmed nor blocked, so the real control can be used */}
        <path class="tour-shade" d={dim} fill-rule="evenodd" />
        {lay?.holes.map((h) => <rect class="tour-ring" data-ring="1" x={h.left} y={h.top} width={h.width} height={h.height} rx="10" />)}
      </svg>
      <div class="tour-card" ref={cardRef} data-step={step + 1} data-id={s.id}
        style={lay ? { top: `${lay.card.top}px`, left: `${lay.card.left}px`, width: `${lay.card.width}px` } : { visibility: 'hidden' }}>
        {lay?.arrow && <span class={`tour-arrow ${lay.arrow.dir}`} style={{ left: `${lay.arrow.x}px` }} />}
        <div class="tour-top">
          <span class="muted">{step + 1} of {WALK.length}{acts ? ' · try it or tap Next' : ''}</span>
          <button type="button" class="tour-skip" onClick={onDone}>Skip</button>
        </div>
        <h2>{s.title}</h2>
        <p>{s.text}</p>
        <div class="tour-dots">{WALK.map((_, k) => <span class={k === step ? 'on' : ''} />)}</div>
        <div class="tour-btns">
          <button type="button" class="btn" disabled={step === 0} onClick={back}>Back</button>
          <button type="button" class="btn primary" onClick={() => advance(true)}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
