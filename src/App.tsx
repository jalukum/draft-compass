import { useEffect, useMemo, useState } from 'preact/hooks';
import { APP } from './config';
import { useBuilds, useCatalog, useDraft, useStats } from './store';
import type { Brawler, BrawlerBuild, GameMap, MapStats } from './data/types';
import { applyBan, applyPick, emptyDraft, MAX_BANS, nextPicker, removeFrom, type Side } from './engine/draft';
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
  const [route, setRoute] = useState(readRoute);
  const [tour, setTour] = useState(() => { try { return !localStorage.getItem('dc:tutorialDone'); } catch { return false; } });
  useEffect(() => {
    const on = () => setTour(true);
    addEventListener('dc-help', on);
    return () => removeEventListener('dc-help', on);
  }, []);
  const tourEl = tour && <Tutorial onDone={() => { try { localStorage.setItem('dc:tutorialDone', '1'); } catch { /* private mode */ } setTour(false); }} />;
  useEffect(() => {
    const on = () => { setRoute(readRoute()); scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const cat = useCatalog();
  const stats = useStats();
  const [draft, setDraft] = useDraft();

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

  const map = pool.find((m) => m.slug === draft.mapSlug) ?? null;
  const st: MapStats | null = map && stats ? stats.maps[map.slug] ?? null : null;
  const brawlers = cat.catalog?.brawlers ?? [];
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
    <section class="block">
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
      {draft.ally.length > 0 && draft.opp.length > 0 && <WinBar p={winChance(st, draft.ally, draft.opp)} final={picks === 6} />}
      {wide && pickSearch && <div class="pick-search">{pickSearch}</div>}
    </section>
  );
  const suggBlock = sugg.length > 0 && (
    <section class="block">
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
            <p>Builds based on: <a href="https://brawltime.ninja" target="_blank" rel="noopener">Brawl Time Ninja</a> and{' '}
              <a href="https://www.noff.gg/brawl-stars/builds" target="_blank" rel="noopener">Noff.gg</a> (November 2026).</p>
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
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) onPick(hits[0]); }} aria-label="Search maps" />
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

/** Title-case an official catalog name (CLAY PIGEONS → Clay Pigeons) for the UI. */
function prettyKit(s: string) {
  return s.toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}
const kitIcon = (kind: 'gadget' | 'starPower' | 'gear', id: number) =>
  kind === 'gadget' ? `https://cdn.brawlify.com/gadgets/regular/${id}.png`
  : kind === 'starPower' ? `https://cdn.brawlify.com/star-powers/regular/${id}.png`
  : `https://cdn.brawlify.com/gears/regular/${id}.png`;

function Kit({ build }: { build?: BrawlerBuild | null }) {
  if (!build) return null;
  const bits = [
    build.gadget && { kind: 'gadget' as const, ...build.gadget },
    build.starPower && { kind: 'starPower' as const, ...build.starPower },
    ...(build.gears ?? []).map((g) => ({ kind: 'gear' as const, ...g })),
  ].filter((x): x is { kind: 'gadget' | 'starPower' | 'gear'; id: number; name: string } => !!x);
  if (!bits.length) return null;
  const label = bits.map((b) => prettyKit(b.name)).join(', ');
  return (
    <span class="lane-kit" title={label} aria-label={label}>
      {bits.map((b) => (
        <span class="ki">
          <img src={kitIcon(b.kind, b.id)} alt="" width={14} height={14} loading="lazy" decoding="async"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          <span class="kit-name">{prettyKit(b.name)}</span>
        </span>
      ))}
    </span>
  );
}

function LaneBrawler({ b, side, selected, onClick, build }: {
  b: Brawler | null; side: Side; selected: boolean; onClick: () => void; build?: BrawlerBuild | null;
}) {
  return (
    <button type="button" class={`lane-b ${side}${selected ? ' sel' : ''}`} onClick={onClick}
      aria-label={b ? `${b.name}${build ? `, ${prettyKit(build.gadget.name)}, ${prettyKit(build.starPower.name)}, ${build.gears.map((g) => prettyKit(g.name)).join(' and ')}` : ''}` : 'Empty'}>
      {b
        ? (side === 'ally'
          ? <><Portrait b={b} size={30} /><span class="lane-meta"><span class="lane-bname">{b.name}</span><Kit build={build} /></span></>
          : <><span class="lane-meta"><span class="lane-bname">{b.name}</span><Kit build={build} /></span><Portrait b={b} size={30} /></>)
        : <span class="muted">—</span>}
    </button>
  );
}

function Lanes({ map, st, ally, opp }: { map: GameMap; st: MapStats | null; ally: Brawler[]; opp: Brawler[] }) {
  const [them, setThem] = useState(() => autoLanes(opp, map, st));
  const [us, setUs] = useState(() => autoLanes(ally, map, st, autoLanes(opp, map, st)));
  const [sel, setSel] = useState<{ side: Side; i: number } | null>(null);
  const builds = useBuilds();
  const tap = (side: Side, i: number) => {
    if (!sel || sel.side !== side) { setSel({ side, i }); return; }
    if (sel.i !== i) {
      const set = side === 'ally' ? setUs : setThem;
      set((arr) => { const a = [...arr]; [a[sel.i], a[i]] = [a[i], a[sel.i]]; return a; });
    }
    setSel(null);
  };
  return (
    <section class="block">
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
              <LaneBrawler b={a} side="ally" selected={sel?.side === 'ally' && sel.i === i || false} onClick={() => tap('ally', i)} build={a ? builds?.builds[String(a.id)] : undefined} />
              <span class={`lane-score ${pct === null ? '' : pct >= 53 ? 'hi' : pct <= 47 ? 'lo' : 'mid'}`}>{pct === null ? '' : `${pct}%`}</span>
              <LaneBrawler b={e} side="opp" selected={sel?.side === 'opp' && sel.i === i || false} onClick={() => tap('opp', i)} build={e ? builds?.builds[String(e.id)] : undefined} />
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
      <a href="#/maps" class={tab === 'maps' ? 'on' : ''}>Maps</a>
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
    <div class="winbar" aria-label={`Win chance ${pct}%`}>
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

const STEPS = [
  { title: 'Pick the map', text: 'Search or tap one of the current Ranked maps to start a draft.' },
  { title: 'Add bans', text: 'Type a brawler into the ban search bar and tap it; tap a ban again to remove it.' },
  { title: 'Picks alternate 1-2-2-1', text: 'Set who picks first; tapping a suggestion or searching a brawler always fills whoever\'s turn it is, like Ranked.' },
  { title: 'Read the suggestions', text: 'Each row shows a score and the brawler\'s win % on the map; on their turn the list switches to "Likely enemy picks".' },
  { title: 'Win chance and lanes', text: 'The bar shows your team\'s win chance, lanes show each matchup (tap two of your brawlers to swap), and the Maps tab lists the top 10 per map.' },
];

function Tutorial({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <div class="tour-bg" role="dialog" aria-modal="true" aria-label="How to use Draft Compass">
      <div class="tour-card">
        <div class="tour-top"><span class="muted">{i + 1} of {STEPS.length}</span><button type="button" class="tour-skip" onClick={onDone}>Skip</button></div>
        <h2>{s.title}</h2>
        <p>{s.text}</p>
        <div class="tour-dots">{STEPS.map((_, k) => <span class={k === i ? 'on' : ''} />)}</div>
        <div class="tour-btns">
          <button type="button" class="btn" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          <button type="button" class="btn primary" onClick={() => (last ? onDone() : setI(i + 1))}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
