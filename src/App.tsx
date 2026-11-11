import { useEffect, useMemo, useState } from 'preact/hooks';
import { APP } from './config';
import { useCatalog, useDraft, useStats } from './store';
import type { Brawler, GameMap, MapStats } from './data/types';
import { applyBan, applyPick, emptyDraft, MAX_BANS, nextPicker, removeFrom, type Side } from './engine/draft';
import { autoLanes, laneEdge, LANES, suggest } from './engine/meta';
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

  if (route.tab === 'maps') {
    return (
      <div class="app">
        <header class="top"><div><h1>Ranked maps</h1>
          <p class="sub">{stats ? `Top picks from ${totalGames.toLocaleString()} Ranked games · updated ${fmtDate(stats.generatedAt ?? stats.updatedAt)}` : 'Loading ladder data…'}</p></div></header>
        <MapsTab pool={pool} stats={stats} brawlers={brawlers} slug={route.slug}
          onDraft={(slug) => { setMap(slug); location.hash = '#/draft'; }} />
        <Nav tab="maps" />
      </div>
    );
  }

  return (
    <div class="app">
      <header class="top">
        <div>
          <h1>{APP.name}</h1>
          <p class="sub">{stats ? `Based on ${totalGames.toLocaleString()} Ranked games · updated ${fmtDate(stats.generatedAt ?? stats.updatedAt)}` : 'Loading ladder data…'}</p>
        </div>
        {map && <button type="button" class="btn" onClick={reset}>Reset</button>}
      </header>

      <section class="block">
        <h2><span class="step">1</span> Map</h2>
        {map ? (
          <button type="button" class="map-chosen" onClick={() => setMap(null)} aria-label="Change map">
            {map.modeIcon && <img src={map.modeIcon} alt="" width={22} height={22} />}
            <span class="grow"><b>{map.name}</b><small>{map.mode} · {map.games.toLocaleString()} games</small></span>
            <span class="muted">Change</span>
          </button>
        ) : (
          <MapSearch maps={pool} onPick={(m) => setMap(m.slug)} />
        )}
      </section>

      {map && (
        <>
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

            {sugg.length > 0 && (
              <>
                <h3 class={next === 'opp' ? 'them' : 'us'}>{next === 'ally' ? 'Best picks for us' : 'Likely enemy picks'}</h3>
                <ol class="sugg">
                  {sugg.map((x) => (
                    <li>
                      <button type="button" onClick={() => pickNow(x.brawler.id)} aria-label={`Pick ${x.brawler.name} for ${next === 'ally' ? 'us' : 'them'}, score ${x.score}`}>
                        <Portrait b={x.brawler} size={36} />
                        <span class="grow">{x.brawler.name}</span>
                        <span class={`score ${x.score >= 70 ? 'hi' : x.score >= 50 ? 'mid' : 'lo'}`}>{x.score}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}

            {next && (
              <BrawlerSearch brawlers={brawlers} taken={taken} placeholder={next === 'ally' ? 'Search our pick' : 'Search their pick'}
                onPick={(b) => pickNow(b.id)} />
            )}
          </section>

          {draft.ally.length > 0 && draft.opp.length > 0 && (
            <Lanes key={`${map.slug}|${[...draft.ally].sort().join()}|${[...draft.opp].sort().join()}`}
              map={map} st={st} ally={draft.ally.map((id) => byId.get(id)!).filter(Boolean)} opp={draft.opp.map((id) => byId.get(id)!).filter(Boolean)} />
          )}
        </>
      )}

      <Nav tab="draft" />
      <footer class="foot">
        Unofficial fan app, not affiliated with Supercell. This material is unofficial and is not endorsed by Supercell. For more
        information see <a href="https://supercell.com/en/fan-content-policy/" target="_blank" rel="noopener">Supercell's Fan Content Policy</a>.
        Stats from our own sample of Ranked battle logs (official Brawl Stars API); catalog from <a href="https://brawlapi.com" target="_blank" rel="noopener">BrawlAPI</a>; art via Brawlify.
      </footer>
    </div>
  );
}

function MapSearch({ maps, onPick }: { maps: PoolMap[]; onPick: (m: PoolMap) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const hits = maps.filter((m) => !q || norm(m.name).includes(norm(q)) || norm(m.mode).includes(norm(q)));
  return (
    <div class="search">
      <input type="search" placeholder={`Search ${maps.length} Ranked maps`} value={q}
        onFocus={() => setOpen(true)} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) onPick(hits[0]); }} aria-label="Search maps" />
      {(open || q) && (
        <ul class="results">
          {hits.map((m) => (
            <li><button type="button" onClick={() => onPick(m)}>
              {m.modeIcon ? <img src={m.modeIcon} alt="" width={20} height={20} /> : <span class="dot" style={{ background: m.modeColor }} />}
              <span class="grow">{m.name}</span><small class="muted">{m.mode}</small>
            </button></li>
          ))}
          {!hits.length && <li class="empty">No Ranked map matches.</li>}
        </ul>
      )}
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
              <button type="button" class={`lane-b ally ${sel?.side === 'ally' && sel.i === i ? 'sel' : ''}`} onClick={() => tap('ally', i)}>
                {a ? <><Portrait b={a} size={30} /><span>{a.name}</span></> : <span class="muted">—</span>}
              </button>
              <span class={`lane-score ${pct === null ? '' : pct >= 53 ? 'hi' : pct <= 47 ? 'lo' : 'mid'}`}>{pct === null ? '' : `${pct}`}</span>
              <button type="button" class={`lane-b opp ${sel?.side === 'opp' && sel.i === i ? 'sel' : ''}`} onClick={() => tap('opp', i)}>
                {e ? <><span>{e.name}</span><Portrait b={e} size={30} /></> : <span class="muted">—</span>}
              </button>
            </div>
          );
        })}
      </div>
      <p class="hint">Number = our side's chance to win that matchup, from Ranked games on this map.</p>
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

function MapsTab({ pool, stats, brawlers, slug, onDraft }: {
  pool: PoolMap[]; stats: ReturnType<typeof useStats>; brawlers: Brawler[]; slug: string | null; onDraft: (slug: string) => void;
}) {
  const [q, setQ] = useState('');
  const map = slug ? pool.find((m) => m.slug === slug) : null;
  if (map && stats) {
    const top = suggest({ brawlers, map, stats: stats.maps[map.slug] ?? null, bans: [], mine: [], theirs: [] }).slice(0, 10);
    return (
      <section class="block">
        <a class="back" href="#/maps">‹ All maps</a>
        <div class="map-head">
          {map.modeIcon && <img src={map.modeIcon} alt="" width={26} height={26} />}
          <div class="grow"><b>{map.name}</b><small>{map.mode} · {map.games.toLocaleString()} games</small></div>
        </div>
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
  }
  const hits = pool.filter((m) => !q || norm(m.name).includes(norm(q)) || norm(m.mode).includes(norm(q)));
  const modes = [...new Set(hits.map((m) => m.mode))];
  return (
    <>
      <div class="search maps-search">
        <input type="search" placeholder={`Search ${pool.length} Ranked maps`} value={q} aria-label="Search Ranked maps" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </div>
      {modes.map((mode) => (
        <section class="block">
          <h2>{mode}</h2>
          <ul class="results flat">
            {hits.filter((m) => m.mode === mode).map((m) => (
              <li><a href={`#/maps/${encodeURIComponent(m.slug)}`}>
                {m.modeIcon ? <img src={m.modeIcon} alt="" width={20} height={20} /> : <span class="dot" style={{ background: m.modeColor }} />}
                <span class="grow">{m.name}</span><small class="muted">{m.games.toLocaleString()} games ›</small>
              </a></li>
            ))}
          </ul>
        </section>
      ))}
      {!hits.length && <p class="hint">No Ranked map matches.</p>}
    </>
  );
}
