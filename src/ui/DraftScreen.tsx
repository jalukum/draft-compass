import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Brawler, Catalog, GameMap, StatsSnapshot } from '../data/types';
import {
  applyBan, applyPick, isFull, MAX_BANS, other, removeFrom, resetDraft, TEAM, type DraftState, type Side,
} from '../engine/draft';
import { lanePlan, readDraft, recommend, type Recommendation } from '../engine/score';
import { presetWeights, PRESETS } from '../engine/weights';
import { RANGE_LABEL, traitsOf } from '../engine/traits';
import type { Settings } from '../store';
import { fmtDate, Portrait, Segmented, Sheet } from './bits';
import { MapPicker } from './MapPicker';

interface Props {
  catalog: Catalog;
  draft: DraftState;
  setDraft: (u: DraftState | ((p: DraftState) => DraftState)) => void;
  settings: Settings;
  setSettings: (u: Settings | ((p: Settings) => Settings)) => void;
  stats: StatsSnapshot | null;
  openBreakdownFor?: number | null;
}

const sideName = (s: Side, me: Side) => (s === me ? 'You' : 'Them');

export function DraftScreen({ catalog, draft, setDraft, settings, setSettings, stats }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [openRec, setOpenRec] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const byId = useMemo(() => new Map(catalog.brawlers.map((b) => [b.id, b])), [catalog]);
  const map = catalog.maps.find((m) => m.slug === draft.mapSlug) ?? null;
  const me: Side = draft.flipped ? 'opp' : 'ally';
  const advised: Side = draft.phase === 'pick' ? draft.turn : me;
  const full = isFull(draft);
  const mapStats = map && stats ? stats.maps[map.slug] ?? null : null;

  const recs = useMemo<Recommendation[]>(() => {
    if (!map || full) return [];
    return recommend({
      brawlers: catalog.brawlers, map, bans: draft.bans, mine: draft[advised], theirs: draft[other(advised)],
      action: draft.phase, weights: presetWeights(settings.preset, settings.custom), offMeta: settings.offMeta, stats: mapStats,
    });
  }, [catalog, map, draft, advised, full, settings.preset, settings.custom, settings.offMeta, mapStats]);

  const act = (b: Brawler, how: 'ban' | 'pick' = draft.phase) => {
    setDraft((d) => (how === 'ban' ? applyBan(d, b.id) : applyPick(d, b.id)));
    setOpenRec(null);
  };
  const pickMap = (m: GameMap) => { setDraft((d) => ({ ...d, mapSlug: m.slug })); setPickerOpen(false); };

  const toList = (ids: number[]) => ids.map((id) => byId.get(id)).filter((b): b is Brawler => !!b);
  const mine = toList(draft[me]), theirs = toList(draft[other(me)]);

  const banStatus = draft.bans.length >= MAX_BANS && draft.phase === 'ban';
  const preset = PRESETS.find((p) => p.id === settings.preset)?.label ?? 'Custom';

  return (
    <div class="draft">
      <section class="col col-board">
        <div class="map-bar">
          <button type="button" class={`map-chip ${map ? '' : 'empty'}`} data-tour="map" onClick={() => setPickerOpen(true)} style={map ? ({ '--mode': map.modeColor } as any) : undefined}>
            {map ? (
              <>
                <span class="map-chip-img">{map.img && <img src={map.img} alt="" />}</span>
                <span class="map-chip-text"><b>{map.name}</b><small>{map.mode}{map.active ? '' : ' · vaulted'}</small></span>
              </>
            ) : (
              <span class="map-chip-text"><b>Choose a map</b><small>Suggestions start once you do</small></span>
            )}
            <span class="chev" aria-hidden="true">▾</span>
          </button>
          {map && <button type="button" class="btn ghost info-btn" aria-label="About this map's data" onClick={() => setInfoOpen(true)}>Data</button>}
        </div>

        <div class="board card">
          <div class="row-head"><span class="label">Bans</span><span class="hint">{draft.bans.length}/{MAX_BANS} · tap one to undo</span></div>
          <div class="ban-row">
            {Array.from({ length: MAX_BANS }, (_, i) => {
              const b = byId.get(draft.bans[i]);
              return b ? (
                <button type="button" class="slot ban filled" aria-label={`Remove ban ${b.name}`} onClick={() => setDraft((d) => removeFrom(d, 'bans', b.id))}>
                  <Portrait b={b} size={44} tint={settings.rarityTint} dim />
                  <span class="x" aria-hidden="true">✕</span>
                </button>
              ) : <span class="slot ban" aria-hidden="true" />;
            })}
          </div>
          {(['ally', 'opp'] as Side[]).map((s) => (
            <div class={`team team-${s === me ? 'me' : 'them'} ${draft.phase === 'pick' && draft.turn === s && !full ? 'active' : ''}`}>
              <div class="row-head">
                <span class="label">{sideName(s, me)}</span>
                {draft.phase === 'pick' && draft.turn === s && !full && <span class="turn-flag">picking</span>}
                {draft.firstPick === s && <span class="hint">first pick</span>}
              </div>
              <div class="pick-row">
                {Array.from({ length: TEAM }, (_, i) => {
                  const b = byId.get(draft[s][i]);
                  return b ? (
                    <button type="button" class="slot pick filled" aria-label={`Remove ${b.name}`} onClick={() => setDraft((d) => removeFrom(d, s, b.id))}>
                      <Portrait b={b} size={58} tint={settings.rarityTint} />
                      <span class="slot-name">{b.name}</span>
                    </button>
                  ) : <span class="slot pick" aria-hidden="true"><span class="slot-num">{i + 1}</span></span>;
                })}
              </div>
            </div>
          ))}
          <div class="controls">
            <Segmented
              label="Phase" tour="phase" value={draft.phase}
              options={[{ value: 'ban', label: 'Ban', tone: 'tone-ban' }, { value: 'pick', label: 'Pick', tone: 'tone-pick' }]}
              onChange={(v) => setDraft((d) => ({ ...d, phase: v }))}
            />
            <button type="button" class="btn" onClick={() => setDraft((d) => (d.ally.length + d.opp.length === 0 ? { ...d, firstPick: other(d.firstPick), turn: other(d.firstPick) } : { ...d, turn: other(d.turn) }))}>
              ⇄ {draft.phase === 'pick' ? `Turn: ${sideName(draft.turn, me)}` : `1st pick: ${sideName(draft.firstPick, me)}`}
            </button>
            <button type="button" class={`btn ${draft.flipped ? 'on' : ''}`} aria-pressed={draft.flipped} onClick={() => setDraft((d) => ({ ...d, flipped: !d.flipped }))}>
              👁 Other side
            </button>
            <button type="button" class="btn danger" data-tour="reset" onClick={() => { setDraft(resetDraft); setOpenRec(null); }}>
              ↺ Reset
            </button>
          </div>
          {banStatus && <p class="hint">Bans are full. Switch to Pick.</p>}
        </div>

      </section>

      <section class="col col-recs" data-tour="recs">
        {!map ? (
          <div class="card empty-state">
            <h3>Where are we brawling?</h3>
            <p>Pick the map first. Suggestions use its mode to judge range, walls and roles.</p>
            <button type="button" class="btn primary big" onClick={() => setPickerOpen(true)}>Choose a map</button>
          </div>
        ) : full ? (
          <FullRead mine={mine} theirs={theirs} map={map} stats={mapStats} tint={settings.rarityTint} />
        ) : (
          <div class="card recs">
            <div class="recs-head">
              <h3>{draft.phase === 'ban' ? 'Ban these' : advised === me ? 'Pick next' : 'They likely want'}</h3>
              <span class="hint">{preset}{settings.offMeta ? ' · off-meta on' : ''}</span>
            </div>
            {advised !== me && draft.phase === 'pick' && <p class="hint">It's their pick. This list reads the board from their side; tap one to log what they took.</p>}
            {draft.phase === 'ban' && <p class="hint">Ranked by how much each one would hurt {draft.flipped ? 'them' : 'you'} in the other team's hands.</p>}
            <ol class="rec-list">
              {recs.slice(0, showAll ? 24 : 8).map((r, i) => (
                <RecRow r={r} rank={i + 1} open={openRec === r.brawler.id} tint={settings.rarityTint}
                  tour={i === 0 ? 'breakdown' : undefined}
                  fav={settings.favorites.includes(r.brawler.id)}
                  onToggle={() => setOpenRec((o) => (o === r.brawler.id ? null : r.brawler.id))}
                  onAct={(how) => act(r.brawler, how)}
                  onFav={() => setSettings((s) => ({ ...s, favorites: s.favorites.includes(r.brawler.id) ? s.favorites.filter((x) => x !== r.brawler.id) : [...s.favorites, r.brawler.id] }))}
                />
              ))}
            </ol>
            <button type="button" class="btn ghost wide" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show top 8' : 'Show more'}</button>
            <p class="fine">
              {mapStats ? `Ladder stats: ${stats!.source}, ${fmtDate(stats!.updatedAt)}, ${mapStats.sample.toLocaleString()} games.` : 'No ladder stats for this map yet, so scores come from our role model (mode fit, team shape, matchups). Treat them as low confidence.'}
            </p>
          </div>
        )}
      </section>

      <section class="col col-roster">
        <Roster catalog={catalog} draft={draft} settings={settings} onAct={act} setDraft={setDraft} me={me} disabled={!map} />
      </section>

      {pickerOpen && <MapPicker maps={catalog.maps} selected={draft.mapSlug} onPick={pickMap} onClose={() => setPickerOpen(false)} />}
      {infoOpen && map && (
        <Sheet title="About this map's data" onClose={() => setInfoOpen(false)}>
          <dl class="facts">
            <dt>Map</dt><dd>{map.name}</dd>
            <dt>Mode</dt><dd>{map.mode}{map.ranked ? ' (in our Ranked pool list)' : ''}</dd>
            <dt>Catalog status</dt><dd>{map.active ? 'Listed as active' : 'Disabled / vaulted'}</dd>
            <dt>Ladder stats</dt><dd>{mapStats ? `${mapStats.sample.toLocaleString()} games · ${stats!.source} · ${fmtDate(stats!.updatedAt)}` : 'None yet. BrawlAPI returns empty stats for this map, and our own battle-log pipeline is phase 2.'}</dd>
            <dt>Catalog updated</dt><dd>{fmtDate(catalog.fetchedAt)} ({catalog.source})</dd>
          </dl>
        </Sheet>
      )}
    </div>
  );
}

function SignalBar({ v }: { v: number }) {
  const pct = Math.round(Math.abs(v) * 50);
  return (
    <span class="sigbar" aria-hidden="true">
      <span class={`sigfill ${v >= 0 ? 'pos' : 'neg'}`} style={{ width: `${pct}%`, [v >= 0 ? 'left' : 'right']: '50%' }} />
    </span>
  );
}

function RecRow({ r, rank, open, onToggle, onAct, onFav, fav, tint, tour }: {
  r: Recommendation; rank: number; open: boolean; onToggle: () => void; onAct: (how: 'ban' | 'pick') => void; onFav: () => void; fav: boolean; tint: boolean; tour?: string;
}) {
  const t = traitsOf(r.brawler);
  const conf = { stats: ['Ladder data', 'c-hi'], model: ['Role model', 'c-mid'], thin: ['Thin data', 'c-lo'] }[r.confidence];
  return (
    <li class={`rec ${open ? 'open' : ''}`}>
      <button type="button" class="rec-main" aria-expanded={open} onClick={onToggle} data-tour={tour}>
        <span class="rec-rank">{rank}</span>
        <Portrait b={r.brawler} size={46} tint={tint} />
        <span class="rec-text">
          <b>{r.brawler.name}{fav ? ' ★' : ''}</b>
          <small>{r.notes.length ? r.notes.join(' ') : r.brawler.cls}</small>
        </span>
        <span class="score" style={{ '--s': r.score } as any}>{r.score}</span>
      </button>
      {open && (
        <div class="breakdown">
          <div class="bd-tags">
            <span class={`conf ${conf[1]}`}>{conf[0]}</span>
            <span class="tag">{r.brawler.cls}</span>
            <span class="tag">{RANGE_LABEL[t.range]} range</span>
          </div>
          <ul class="signals">
            {r.signals.map((s) => (
              <li class={s.value === null || s.weight === 0 ? 'muted' : ''}>
                <span class="sig-name">{s.label}<small>{s.value === null || s.weight === 0 ? 'not used' : `weight ${s.weight.toFixed(1)}`}</small></span>
                {s.value !== null && s.weight > 0 ? <SignalBar v={s.value} /> : <span class="sigbar empty" />}
                <span class="sig-note">{s.note}</span>
              </li>
            ))}
          </ul>
          <div class="bd-actions">
            <button type="button" class="btn ban-btn" onClick={() => onAct('ban')}>Ban</button>
            <button type="button" class="btn primary" onClick={() => onAct('pick')}>Pick</button>
            <button type="button" class="btn ghost" aria-pressed={fav} onClick={onFav}>{fav ? '★ Fav' : '☆ Fav'}</button>
          </div>
        </div>
      )}
    </li>
  );
}

function Roster({ catalog, draft, settings, onAct, setDraft, me, disabled }: {
  catalog: Catalog; draft: DraftState; settings: Settings; onAct: (b: Brawler, how?: 'ban' | 'pick') => void;
  setDraft: Props['setDraft']; me: Side; disabled: boolean;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const favs = new Set(settings.favorites);
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return catalog.brawlers
      .filter((b) => !qq || b.name.toLowerCase().startsWith(qq) || b.name.toLowerCase().includes(qq))
      .sort((a, b) => {
        if (qq) {
          const sa = a.name.toLowerCase().startsWith(qq) ? 0 : 1, sb = b.name.toLowerCase().startsWith(qq) ? 0 : 1;
          if (sa !== sb) return sa - sb;
        }
        return Number(favs.has(b.id)) - Number(favs.has(a.id)) || a.name.localeCompare(b.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, q, settings.favorites]);
  const taken = (id: number) => draft.bans.includes(id) ? 'ban' : draft.ally.includes(id) || draft.opp.includes(id) ? 'pick' : null;
  const firstFree = list.find((b) => !taken(b.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (e.key === '/' && el?.tagName !== 'INPUT') { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pickSide = draft.phase === 'pick' ? draft.turn : null;
  return (
    <div class="card roster">
      <div class="roster-head">
        <h3>Roster</h3>
        <span class="hint">Tap = {draft.phase === 'ban' ? 'ban' : `pick for ${pickSide === me ? 'you' : 'them'}`}</span>
      </div>
      <div class="roster-tools">
        <input
          ref={inputRef} class="search" type="search" placeholder="Type a name…" value={q} enterKeyHint="go"
          aria-label="Search brawlers. Enter picks the first match, Shift+Enter bans it."
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && firstFree && !disabled) {
              e.preventDefault();
              onAct(firstFree, e.shiftKey ? 'ban' : 'pick');
              setQ('');
            } else if (e.key === 'Escape') setQ('');
          }}
        />
        <Segmented
          label="Tap action" tour="tap-mode" value={draft.phase}
          options={[{ value: 'ban', label: 'Ban', tone: 'tone-ban' }, { value: 'pick', label: 'Pick', tone: 'tone-pick' }]}
          onChange={(v) => setDraft((d) => ({ ...d, phase: v }))}
        />
      </div>
      <p class="hint desktop-only">Keyboard: <kbd>/</kbd> search · <kbd>Enter</kbd> pick first match · <kbd>Shift</kbd>+<kbd>Enter</kbd> ban it</p>
      {disabled && <p class="hint">Choose a map to start logging bans and picks.</p>}
      <div class="roster-grid">
        {list.map((b, i) => {
          const tk = taken(b.id);
          return (
            <button
              type="button" class={`roster-cell ${tk ? `taken ${tk}` : ''} ${b === firstFree && q ? 'first' : ''}`}
              disabled={!!tk || disabled} aria-label={`${draft.phase === 'ban' ? 'Ban' : 'Pick'} ${b.name}`}
              data-tour={i === 0 ? 'roster' : undefined}
              onClick={() => onAct(b)}
            >
              <Portrait b={b} size={52} tint={settings.rarityTint} dim={!!tk} />
              <span class="cell-name">{favs.has(b.id) ? '★ ' : ''}{b.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FullRead({ mine, theirs, map, stats, tint }: { mine: Brawler[]; theirs: Brawler[]; map: GameMap; stats: StatsSnapshot['maps'][string] | null; tint: boolean }) {
  const read = readDraft(mine, theirs, map, stats);
  const plan = lanePlan(mine, theirs, map);
  return (
    <div class="card full-read" data-tour="lean">
      <h3>Draft read</h3>
      <div class="lean">
        <div class="lean-bar" role="img" aria-label={`Lean: you ${read.allyPct} percent, them ${100 - read.allyPct} percent`}>
          <span class="lean-me" style={{ width: `${read.allyPct}%` }}>You {read.allyPct}%</span>
          <span class="lean-them">{100 - read.allyPct}% Them</span>
        </div>
        <p class="lean-summary">{read.summary}</p>
        <p class="fine">Tap any pick on the board to swap it. This is a lean, not a guarantee. It weighs mode fit, team shape and matchups{stats ? ' plus ladder stats' : ''}; outplays, power levels and gadgets aren't in it.</p>
      </div>
      <h4>Lane plan</h4>
      <ul class="lanes">
        {plan.map((l) => (
          <li class={`lane ${l.edge > 0.15 ? 'up' : l.edge < -0.15 ? 'down' : 'even'}`}>
            <span class="lane-name">{l.lane}</span>
            <span class="lane-who">
              <Portrait b={l.ally} size={40} tint={tint} />
              <span><b>{l.ally.name}</b><small>{l.role}</small></span>
            </span>
            <span class="lane-vs">vs</span>
            <span class="lane-who them">
              <Portrait b={l.enemy} size={40} tint={tint} />
              <span><b>{l.enemy.name}</b></span>
            </span>
            <span class="lane-tip">{l.tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
