import { describe, expect, it } from 'vitest';
import { matchup, modeFit, modeKey, teamQuality } from '../src/engine/heuristics';
import { lanePlan, readDraft, recommend, toScore, type EngineInput } from '../src/engine/score';
import { PRESETS, presetWeights } from '../src/engine/weights';
import { applyBan, applyPick, emptyDraft, pickTurn, removeFrom, resetDraft, type DraftState } from '../src/engine/draft';
import { traitsOf } from '../src/engine/traits';
import { groupBrawlers, rarityRank, sortBrawlers } from '../src/engine/sort';
import { ALL, BALL, KO, ROSTER as R, ZONE } from './fixtures';
import type { MapStats } from '../src/data/types';

const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  brawlers: ALL, map: KO, bans: [], mine: [], theirs: [], action: 'pick',
  weights: presetWeights('climber'), offMeta: false, ...over,
});
const rank = (recs: ReturnType<typeof recommend>, id: number) => recs.findIndex((r) => r.brawler.id === id);

describe('heuristics', () => {
  it('maps mode names to keys', () => {
    expect(modeKey('Gem Grab')).toBe('gem');
    expect(modeKey('Knockout')).toBe('ko');
    expect(modeKey('Brawl Hockey')).toBe('ball');
    expect(modeKey('Duels')).toBe('other');
  });
  it('rates marksmen above tanks in Knockout and the reverse in Brawl Ball', () => {
    expect(modeFit(R.piper, 'ko').value).toBeGreaterThan(modeFit(R.bull, 'ko').value);
    expect(modeFit(R.bull, 'ball').value).toBeGreaterThan(modeFit(R.piper, 'ball').value);
  });
  it('keeps mode fit within -1..1', () => {
    for (const b of ALL) for (const m of ['gem', 'ball', 'ko', 'heist', 'zone', 'bounty', 'other'] as const) {
      const v = modeFit(b, m).value;
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('matchups are antisymmetric', () => {
    for (const a of ALL) for (const b of ALL) expect(matchup(a, b, 'gem')).toBeCloseTo(-matchup(b, a, 'gem'), 9);
  });
  it('knows classic answers', () => {
    expect(matchup(R.shelly, R.bull, 'ball')).toBeGreaterThan(0);
    expect(matchup(R.mortis, R.piper, 'gem')).toBeGreaterThan(0);
    expect(matchup(R.crow, R.poco, 'gem')).toBeGreaterThan(0); // anti-heal
  });
  it('balanced trio beats a triple stack', () => {
    expect(teamQuality([R.bull, R.gene, R.piper], 'gem').score).toBeGreaterThan(teamQuality([R.bull, R.rosa, R.frank], 'gem').score);
  });
  it('falls back to class defaults for brawlers missing from the trait table', () => {
    expect(traitsOf(R.mystery).curated).toBe(false);
    expect(traitsOf(R.piper).curated).toBe(true);
  });
});

describe('recommend', () => {
  it('excludes banned and picked brawlers', () => {
    const recs = recommend(base({ bans: [R.piper.id], mine: [R.gene.id], theirs: [R.bull.id] }));
    const ids = recs.map((r) => r.brawler.id);
    expect(ids).not.toContain(R.piper.id);
    expect(ids).not.toContain(R.gene.id);
    expect(ids).not.toContain(R.bull.id);
    expect(recs).toHaveLength(ALL.length - 3);
  });
  it('scores stay in 0..100 and are sorted', () => {
    const recs = recommend(base());
    for (let i = 0; i < recs.length; i++) {
      expect(recs[i].score).toBeGreaterThanOrEqual(0);
      expect(recs[i].score).toBeLessThanOrEqual(100);
      if (i) expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
    }
  });
  it('opens Knockout with long range rather than a tank', () => {
    const recs = recommend(base());
    expect(rank(recs, R.piper.id)).toBeLessThan(rank(recs, R.bull.id));
  });
  it('pushes the missing role on the last pick', () => {
    const recs = recommend(base({ map: ZONE, mine: [R.bull.id, R.rosa.id] }));
    expect(rank(recs, R.gene.id)).toBeLessThan(rank(recs, R.frank.id));
  });
  it('the counter preset reacts to enemy picks more than the climber preset', () => {
    const enemy = [R.bull.id, R.rosa.id, R.frank.id];
    const gap = (preset: 'climber' | 'counterpunch') => {
      const recs = recommend(base({ map: BALL, theirs: enemy, weights: presetWeights(preset) }));
      const s = (id: number) => recs.find((r) => r.brawler.id === id)!.score;
      return s(R.shelly.id) - s(R.piper.id);
    };
    expect(gap('counterpunch')).toBeGreaterThan(gap('climber'));
  });
  it('ban mode rates threats from the enemy perspective', () => {
    const recs = recommend(base({ action: 'ban', mine: [R.piper.id, R.belle.id] }));
    const blank = recommend(base({ action: 'ban' }));
    // a diver gets more dangerous to us once we've locked in two marksmen
    const s = (list: typeof recs) => list.find((r) => r.brawler.id === R.mortis.id)!.score;
    expect(s(recs)).toBeGreaterThan(s(blank));
    expect(recs[0].notes.every((n) => n.startsWith('For them:'))).toBe(true);
  });
  it('off-meta softens mode-fit penalties', () => {
    const s = (off: boolean) => recommend(base({ offMeta: off })).find((r) => r.brawler.id === R.bull.id)!.score;
    expect(s(true)).toBeGreaterThan(s(false));
  });
  it('labels confidence honestly', () => {
    const recs = recommend(base());
    expect(recs.find((r) => r.brawler.id === R.mystery.id)!.confidence).toBe('thin');
    expect(recs.find((r) => r.brawler.id === R.piper.id)!.confidence).toBe('model');
  });
  it('uses ladder stats when provided and weighs them by sample', () => {
    const mkStats = (sample: number): MapStats => ({
      sample,
      brawlers: Object.fromEntries(ALL.map((b) => [String(b.id), { winRate: b.id === R.barley.id ? 62 : 49, useRate: 3 }])),
    });
    const sc = (st?: MapStats) => recommend(base({ stats: st })).find((r) => r.brawler.id === R.barley.id)!;
    const none = sc(), small = sc(mkStats(50)), big = sc(mkStats(5000));
    expect(big.score).toBeGreaterThan(small.score);
    expect(small.score).toBeGreaterThan(none.score);
    expect(big.confidence).toBe('stats');
    expect(big.signals.find((s) => s.key === 'stats')!.value).not.toBeNull();
  });
  it('every preset produces a usable list', () => {
    for (const p of PRESETS) expect(recommend(base({ weights: p.weights }))[0].score).toBeGreaterThan(50);
  });
  it('toScore is monotonic and centred', () => {
    expect(toScore(0)).toBe(50);
    expect(toScore(0.5)).toBeGreaterThan(toScore(0.1));
  });
});

describe('full draft', () => {
  it('lean stays a lean (30..70) and favours the better-shaped KO team', () => {
    const good = [R.piper, R.gene, R.tick], bad = [R.bull, R.rosa, R.frank];
    const r = readDraft(good, bad, KO);
    expect(r.allyPct).toBeGreaterThan(50);
    expect(r.allyPct).toBeLessThanOrEqual(70);
    expect(readDraft(bad, good, KO).allyPct).toBeGreaterThanOrEqual(30);
    expect(readDraft(good, good, KO).allyPct).toBe(50);
  });
  it('lane plan uses each brawler once and puts the controller mid in Hot Zone', () => {
    const plan = lanePlan([R.bull, R.sandy, R.colt], [R.edgar, R.emz, R.piper], ZONE);
    expect(plan.map((l) => l.lane)).toEqual(['left', 'mid', 'right']);
    expect(new Set(plan.map((l) => l.ally.id)).size).toBe(3);
    expect(new Set(plan.map((l) => l.enemy.id)).size).toBe(3);
    expect(plan[1].ally.id).toBe(R.sandy.id);
  });
});

describe('draft state', () => {
  it('follows the 1-2-2-1 pick order', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => pickTurn('ally', i))).toEqual(['ally', 'opp', 'opp', 'ally', 'ally', 'opp']);
  });
  it('moves to picks after six bans', () => {
    let d = emptyDraft('m');
    for (const b of ALL.slice(0, 6)) d = applyBan(d, b.id);
    expect(d.phase).toBe('pick');
    expect(applyBan(d, ALL[7].id).bans).toHaveLength(6);
  });
  it('auto-advances turns and blocks duplicates', () => {
    let d: DraftState = { ...emptyDraft('m'), phase: 'pick' };
    d = applyPick(d, R.piper.id);
    expect(d.ally).toEqual([R.piper.id]);
    expect(d.turn).toBe('opp');
    expect(applyPick(d, R.piper.id)).toBe(d);
    d = applyPick(d, R.bull.id);
    d = applyPick(d, R.rosa.id);
    expect(d.opp).toHaveLength(2);
    expect(d.turn).toBe('ally');
    d = removeFrom(d, 'opp', R.rosa.id);
    expect(d.turn).toBe('opp');
    expect(resetDraft(d).ally).toHaveLength(0);
    expect(resetDraft(d).mapSlug).toBe('m');
  });
});

describe('brawler sorting', () => {
  const b = (name: string, cls: any, rarity: string) => ({ ...R.bull, id: name.length * 1000 + name.charCodeAt(0), name, cls, rarity });
  const list = [b('Zed', 'Tank', 'Epic'), b('Amy', 'Support', 'Mythic'), b('Kip', 'Tank', 'Common'), b('Bo', 'Assassin', 'Ultra Legendary'), b('Lu', 'Marksman', 'Super Rare'), b('Ray', 'Tank', 'Rare')];
  it('orders rarity like the game, both ways', () => {
    expect(rarityRank('Starting')).toBe(rarityRank('Common'));
    expect(sortBrawlers(list, { by: 'rarity', dir: 'asc' }).map((x) => x.rarity)).toEqual(['Common', 'Rare', 'Super Rare', 'Epic', 'Mythic', 'Ultra Legendary']);
    expect(sortBrawlers(list, { by: 'rarity', dir: 'desc' })[0].name).toBe('Bo');
  });
  it('groups by class alphabetically, names A–Z inside', () => {
    const g = groupBrawlers(list, { by: 'class', dir: 'asc' });
    expect(g.map((x) => x.label)).toEqual(['Assassin', 'Marksman', 'Support', 'Tank']);
    expect(g[3].items.map((x) => x.name)).toEqual(['Kip', 'Ray', 'Zed']);
  });
  it('name sort has no headers unless favorites are pinned', () => {
    expect(groupBrawlers(list, { by: 'name', dir: 'asc' })).toHaveLength(1);
    expect(groupBrawlers(list, { by: 'name', dir: 'desc' })[0].items[0].name).toBe('Zed');
    const pinned = groupBrawlers(list, { by: 'rarity', dir: 'asc' }, new Set([list[0].id]));
    expect(pinned[0].label).toBe('★ Favorites');
    expect(pinned[0].items.map((x) => x.name)).toEqual(['Zed']);
    expect(pinned.slice(1).flatMap((x) => x.items).some((x) => x.name === 'Zed')).toBe(false);
  });
});
