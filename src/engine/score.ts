import { pairStat, type Brawler, type GameMap, type MapStats } from '../data/types';
import { matchup, MODE_LABEL, modeFit, modeKey, roleGroup, teamQuality, type ModeKey } from './heuristics';
import { RANGE_LABEL, TAG_LABEL, traitsOf, type Tag } from './traits';
import type { Weights } from './weights';

export type SignalKey = keyof Weights;
export interface Signal {
  key: SignalKey;
  label: string;
  /** -1..1, or null when this signal has nothing to say yet. */
  value: number | null;
  /** effective weight after confidence scaling */
  weight: number;
  note: string;
}

export type Confidence = 'stats' | 'model' | 'thin';

export interface Recommendation {
  brawler: Brawler;
  score: number; // 0..100
  signals: Signal[];
  notes: string[];
  confidence: Confidence;
}

export interface EngineInput {
  brawlers: Brawler[];
  map: GameMap;
  bans: number[];
  /** picks of the side we're advising */
  mine: number[];
  /** picks of the other side */
  theirs: number[];
  action: 'ban' | 'pick';
  weights: Weights;
  offMeta: boolean;
  stats?: MapStats | null;
  /** Minimum battles before stats count fully. */
  statsMinSample?: number;
  /** Minimum battles on the map before rows are labelled "Ladder data". */
  statsLabelSample?: number;
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
export const toScore = (total: number) => Math.round(100 / (1 + Math.exp(-3.5 * total)));

/**
 * Blend a model value with an observed pair win rate. The data's say grows with games
 * (half weight at PAIR_HALF games), so thin pairs lean on the model.
 */
const PAIR_HALF = 40;
function pairBlend(model: number, st: MapStats | null | undefined, table: 'matchups' | 'synergy', a: number, b: number) {
  const r = st ? pairStat(st[table], a, b, table === 'matchups') : null;
  if (!r) return { v: model, n: 0 };
  const data = clamp((r[1] - 50) / 10);
  const w = r[0] / (r[0] + PAIR_HALF);
  return { v: (1 - w) * model + w * data, n: r[0], wr: r[1] };
}

const tagWords = (tags: Tag[]) => tags.map((t) => TAG_LABEL[t].toLowerCase());

interface Ctx { mk: ModeKey; byId: Map<number, Brawler>; available: Brawler[]; avgUse: number }

function statsSignal(b: Brawler, inp: EngineInput, ctx: Ctx): Signal {
  const w = inp.weights.stats;
  const st = inp.stats;
  if (!st) return { key: 'stats', label: 'Ladder stats', value: null, weight: 0, note: 'No ladder stats for this map yet.' };
  const row = st.brawlers[String(b.id)];
  if (!row) return { key: 'stats', label: 'Ladder stats', value: null, weight: 0, note: 'No recorded games on this map.' };
  const wr = clamp((row.winRate - 50) / 6);
  let use = ctx.avgUse > 0 && row.useRate > 0 ? clamp(Math.log2(row.useRate / ctx.avgUse) / 2) : -1;
  if (inp.offMeta) use = Math.max(use, 0);
  const conf = Math.sqrt(Math.min(1, st.sample / (inp.statsMinSample ?? 1000)));
  return {
    key: 'stats', label: 'Ladder stats', value: clamp(0.65 * wr + 0.35 * use), weight: w * conf,
    note: `${row.winRate.toFixed(1)}% win, ${row.useRate.toFixed(1)}% use${conf < 1 ? ' (small sample)' : ''}.`,
  };
}

function fitSignal(b: Brawler, inp: EngineInput, ctx: Ctx): Signal {
  const f = modeFit(b, ctx.mk);
  let v = f.value;
  if (inp.offMeta && v < 0) v *= 0.4;
  const t = traitsOf(b);
  const good = f.parts.filter((p) => p.value > 0.04 && p.label !== `${b.cls} in ${MODE_LABEL[ctx.mk]}`).map((p) => TAG_LABEL[p.label as Tag]?.toLowerCase()).filter(Boolean);
  const note = v >= 0.35
    ? `Built for ${MODE_LABEL[ctx.mk]}${good.length ? ` (${good.join(', ')})` : ''}.`
    : v <= -0.2
      ? `${b.cls}s tend to struggle in ${MODE_LABEL[ctx.mk]}.`
      : `${RANGE_LABEL[t.range]}-range ${b.cls.toLowerCase()}, workable in ${MODE_LABEL[ctx.mk]}.`;
  return { key: 'modeFit', label: 'Mode fit', value: v, weight: inp.weights.modeFit, note };
}

function compSignal(b: Brawler, team: Brawler[], inp: EngineInput, ctx: Ctx): Signal {
  if (team.length === 0) return { key: 'comp', label: 'Team fit', value: null, weight: 0, note: 'No teammates picked yet.' };
  const before = teamQuality(team, ctx.mk);
  const after = teamQuality([...team, b], ctx.mk);
  let v = clamp((after.score - before.score - 0.2) / 0.4);
  // Observed same-team results on this map nudge the shape read.
  const syn = team.map((t) => pairBlend(0, inp.stats, 'synergy', b.id, t.id)).filter((x) => x.n > 0);
  if (syn.length) v = clamp(v + syn.reduce((s, x) => s + x.v, 0) / team.length);
  const groupsBefore = new Set(team.map(roleGroup));
  const g = roleGroup(b);
  const gName = { front: 'frontline', control: 'control/support', damage: 'damage' }[g];
  const newNotes = after.notes.filter((n) => !before.notes.includes(n));
  let note = !groupsBefore.has(g) ? `Adds the ${gName} your team lacks.` : `Doubles up on ${gName}.`;
  if (newNotes.length) note += ` ${newNotes[0][0].toUpperCase()}${newNotes[0].slice(1)}.`;
  return { key: 'comp', label: 'Team fit', value: v, weight: inp.weights.comp, note };
}

function counterSignal(b: Brawler, enemies: Brawler[], inp: EngineInput, ctx: Ctx): Signal {
  if (enemies.length === 0) return { key: 'counter', label: 'Matchups', value: null, weight: 0, note: 'No enemy picks to read yet.' };
  const edges = enemies.map((e) => ({ e, ...pairBlend(matchup(b, e, ctx.mk), inp.stats, 'matchups', b.id, e.id) }));
  const v = clamp(edges.reduce((s, x) => s + x.v, 0) / edges.length * 1.6);
  edges.sort((x, y) => y.v - x.v);
  const best = edges[0], worst = edges[edges.length - 1];
  const bits: string[] = [];
  const seen = (x: typeof best) => (x.n >= 20 && x.wr !== undefined ? ` (${x.wr.toFixed(0)}% in ${x.n} games)` : '');
  if (best.v > 0.15) bits.push(`Good into ${best.e.name}${seen(best)}.`);
  if (worst.v < -0.15) bits.push(`Careful: ${worst.e.name} pressures it${seen(worst)}.`);
  if (!bits.length) bits.push('Even trades against their picks.');
  return { key: 'counter', label: 'Matchups', value: v, weight: inp.weights.counter, note: bits.join(' ') };
}

function safetySignal(b: Brawler, enemies: Brawler[], inp: EngineInput, ctx: Ctx): Signal {
  const open = 3 - enemies.length;
  if (open <= 0) return { key: 'safety', label: 'Blind-pick safety', value: null, weight: 0, note: 'Enemy team is complete.' };
  const pool = ctx.available
    .filter((x) => x.id !== b.id)
    .map((x) => ({ x, f: modeFit(x, ctx.mk).value }))
    .sort((p, q) => q.f - p.f)
    .slice(0, 20)
    .map((p) => p.x);
  const answers = pool.filter((x) => matchup(x, b, ctx.mk) > 0.3);
  const frac = pool.length ? answers.length / pool.length : 0;
  const v = clamp(1 - frac * 4);
  const note = answers.length === 0
    ? 'Few strong answers left in the pool.'
    : `${answers.length} likely picks can punish it (e.g. ${answers.slice(0, 2).map((a) => a.name).join(', ')}).`;
  return { key: 'safety', label: 'Blind-pick safety', value: v, weight: inp.weights.safety * (open / 3), note };
}

function confidenceOf(b: Brawler, inp: EngineInput, s: Signal): Confidence {
  if (!traitsOf(b).curated) return 'thin';
  // "Ladder data" once the map has a usable sample and this brawler was seen often enough.
  // (The stats weight itself keeps scaling up to statsMinSample games.)
  const games = inp.stats?.brawlers[String(b.id)]?.games;
  if (inp.stats && s.value !== null && inp.stats.sample >= (inp.statsLabelSample ?? 250) && (games === undefined || games >= 30)) return 'stats';
  if (inp.stats && s.value === null) return 'thin';
  return 'model';
}

function scoreOne(b: Brawler, team: Brawler[], enemies: Brawler[], inp: EngineInput, ctx: Ctx): Recommendation {
  const st = statsSignal(b, inp, ctx);
  const signals = [st, fitSignal(b, inp, ctx), compSignal(b, team, inp, ctx), counterSignal(b, enemies, inp, ctx), safetySignal(b, enemies, inp, ctx)];
  let num = 0, den = 0;
  for (const s of signals) if (s.value !== null && s.weight > 0) { num += s.value * s.weight; den += s.weight; }
  const total = den ? num / den : 0;
  const notes = signals.filter((s) => s.value !== null && s.weight > 0).sort((a, c) => Math.abs((c.value ?? 0) * c.weight) - Math.abs((a.value ?? 0) * a.weight)).slice(0, 2).map((s) => s.note);
  return { brawler: b, score: toScore(total), signals, notes, confidence: confidenceOf(b, inp, st) };
}

/** Lead each row with what sets it apart from the field, not what every candidate shares. */
function standoutNotes(recs: Recommendation[]) {
  const mean = new Map<SignalKey, number>();
  for (const key of ['stats', 'modeFit', 'comp', 'counter', 'safety'] as SignalKey[]) {
    const vals = recs.map((r) => r.signals.find((s) => s.key === key)!).filter((s) => s.value !== null && s.weight > 0).map((s) => s.value!);
    mean.set(key, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  }
  for (const r of recs) {
    const dev = r.signals
      .filter((s) => s.value !== null && s.weight > 0)
      .map((s) => ({ s, d: (s.value! - mean.get(s.key)!) * s.weight }))
      .sort((a, b) => b.d - a.d);
    if (!dev.length) continue;
    const notes = [dev[0].s.note];
    const low = dev[dev.length - 1];
    if (dev.length > 1 && low.d < -0.15) notes.push(low.s.note);
    else if (dev.length > 1) notes.push(dev[1].s.note);
    r.notes = notes;
  }
}

function makeCtx(inp: EngineInput): Ctx {
  const byId = new Map(inp.brawlers.map((b) => [b.id, b]));
  const taken = new Set([...inp.bans, ...inp.mine, ...inp.theirs]);
  const available = inp.brawlers.filter((b) => !taken.has(b.id));
  const uses = inp.stats ? Object.values(inp.stats.brawlers).map((r) => r.useRate).filter((u) => u > 0) : [];
  const avgUse = uses.length ? uses.reduce((a, b) => a + b, 0) / uses.length : 0;
  return { mk: modeKey(inp.map.mode), byId, available, avgUse };
}

/**
 * Ranked list for the next action of the side we're advising.
 * Pick: how good each brawler is for us. Ban: how dangerous each brawler is in the other side's hands.
 */
export function recommend(inp: EngineInput): Recommendation[] {
  const ctx = makeCtx(inp);
  const pick = (ids: number[]) => ids.map((id) => ctx.byId.get(id)).filter((b): b is Brawler => !!b);
  const mine = pick(inp.mine), theirs = pick(inp.theirs);
  const [team, enemies] = inp.action === 'pick' ? [mine, theirs] : [theirs, mine];
  const recs = ctx.available.map((b) => scoreOne(b, team, enemies, inp, ctx));
  standoutNotes(recs);
  if (inp.action === 'ban') for (const r of recs) r.notes = r.notes.map((n) => `For them: ${n}`);
  return recs.sort((a, b) => b.score - a.score || a.brawler.name.localeCompare(b.brawler.name));
}

// ---- Full-draft read ------------------------------------------------------
export interface LeanFactor { label: string; ally: number; opp: number }
export interface DraftRead { allyPct: number; factors: LeanFactor[]; summary: string }

function strength(team: Brawler[], enemy: Brawler[], mk: ModeKey, stats?: MapStats | null) {
  const fit = team.reduce((s, b) => s + modeFit(b, mk).value, 0) / team.length;
  const comp = teamQuality(team, mk).score / 1.5;
  let mu = 0;
  for (const a of team) for (const e of enemy) mu += pairBlend(matchup(a, e, mk), stats, 'matchups', a.id, e.id).v;
  mu /= team.length * enemy.length;
  let st = 0;
  if (stats) {
    const rows = team.map((b) => stats.brawlers[String(b.id)]).filter(Boolean);
    if (rows.length) st = rows.reduce((s, r) => s + clamp((r.winRate - 50) / 6), 0) / rows.length;
  }
  return { fit, comp, mu, st };
}

export function readDraft(ally: Brawler[], opp: Brawler[], map: GameMap, stats?: MapStats | null): DraftRead {
  const mk = modeKey(map.mode);
  const A = strength(ally, opp, mk, stats), O = strength(opp, ally, mk, stats);
  const diff = 1.0 * (A.fit - O.fit) + 0.6 * (A.comp - O.comp) + 0.9 * (A.mu - O.mu) + (stats ? 0.6 * (A.st - O.st) : 0);
  const allyPct = Math.round(50 + 20 * Math.tanh(1.5 * diff));
  const factors: LeanFactor[] = [
    { label: 'Mode fit', ally: A.fit, opp: O.fit },
    { label: 'Team shape', ally: A.comp, opp: O.comp },
    { label: 'Matchups', ally: A.mu, opp: O.mu },
  ];
  if (stats) factors.push({ label: 'Ladder stats', ally: A.st, opp: O.st });
  const top = [...factors].sort((x, y) => Math.abs(y.ally - y.opp) - Math.abs(x.ally - x.opp))[0];
  const side = allyPct >= 50 ? 'your side' : 'their side';
  const summary = Math.abs(allyPct - 50) < 3
    ? 'Too close to call. Execution decides this one.'
    : `Leans ${side}, mostly on ${top.label.toLowerCase()}.`;
  return { allyPct, factors, summary };
}

// ---- Lane plan ------------------------------------------------------------
export type Lane = 'left' | 'mid' | 'right';
export const LANES: Lane[] = ['left', 'mid', 'right'];

function laneFit(b: Brawler, lane: Lane, mk: ModeKey): number {
  const mid: Record<string, number> = { Controller: 0.5, Support: 0.45, Artillery: 0.35, Marksman: 0.25, 'Damage Dealer': 0.2, Tank: 0.05, Assassin: -0.1, Unknown: 0.2 };
  const side: Record<string, number> = { Tank: 0.4, Assassin: 0.45, 'Damage Dealer': 0.3, Marksman: 0.3, Artillery: 0.1, Controller: 0.15, Support: 0.1, Unknown: 0.2 };
  let v = lane === 'mid' ? mid[b.cls] : side[b.cls];
  if (lane === 'mid' && (mk === 'ko' || mk === 'bounty') && traitsOf(b).range === 3) v += 0.2;
  if (lane === 'mid' && mk === 'ball' && b.cls === 'Tank') v += 0.45;
  if (lane === 'mid' && mk === 'gem' && traitsOf(b).tags.includes('heal')) v += 0.1;
  return v;
}

const PERMS: number[][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

function assign(team: Brawler[], mk: ModeKey, vs?: Brawler[]): Brawler[] {
  let best = PERMS[0], bestV = -Infinity;
  for (const p of PERMS) {
    let v = 0;
    p.forEach((ti, li) => {
      v += laneFit(team[ti], LANES[li], mk);
      if (vs) v += 0.6 * matchup(team[ti], vs[li], mk);
    });
    if (v > bestV + 1e-9) { bestV = v; best = p; }
  }
  return best.map((i) => team[i]);
}

export interface LaneSlot { lane: Lane; role: string; ally: Brawler; enemy: Brawler; edge: number; tip: string }

const MID_ROLE: Record<ModeKey, string> = {
  gem: 'Gem carrier', ball: 'Ball carrier', ko: 'Long-range anchor', heist: 'Safe pressure',
  zone: 'Zone anchor', bounty: 'Star keeper', other: 'Anchor',
};

export function lanePlan(ally: Brawler[], opp: Brawler[], map: GameMap): LaneSlot[] {
  const mk = modeKey(map.mode);
  const enemy = assign(opp, mk);
  const mine = assign(ally, mk, enemy);
  return LANES.map((lane, i) => {
    const a = mine[i], e = enemy[i];
    const edge = matchup(a, e, mk);
    const g = roleGroup(a);
    const role = lane === 'mid' ? MID_ROLE[mk] : g === 'front' ? 'Lane bully' : g === 'control' ? 'Side control' : 'Side damage';
    const tw = tagWords(traitsOf(a).tags);
    const tip = edge > 0.15 ? `Push ${e.name}; you win this lane.` : edge < -0.15 ? `Play safe vs ${e.name}; call for help.` : `Even lane vs ${e.name}${tw.length ? `; lean on your ${tw[0]}` : ''}.`;
    return { lane, role, ally: a, enemy: e, edge, tip };
  });
}
