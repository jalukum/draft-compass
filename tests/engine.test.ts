import { describe, expect, it } from 'vitest';
import { matchup, modeFit, modeKey, teamQuality } from '../src/engine/heuristics';
import { applyBan, applyPick, emptyDraft, pickTurn, removeFrom, resetDraft, type DraftState } from '../src/engine/draft';
import { traitsOf } from '../src/engine/traits';
import { autoLanes, laneEdge, pair, row, suggest } from '../src/engine/meta';
import { ALL, BALL, KO, ROSTER as R, ZONE } from './fixtures';
import type { MapStats } from '../src/data/types';

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


// A small fake map sample: Piper strong and popular, Bull weak, Brock beats Bull head to head.
const SAMPLE = (): MapStats => {
  const b: MapStats['brawlers'] = {};
  for (const x of ALL) b[String(x.id)] = { games: 40, wins: 20, winRate: 50, useRate: 4 };
  b[String(R.piper.id)] = { games: 600, wins: 340, winRate: 56, useRate: 35 };
  b[String(R.bull.id)] = { games: 300, wins: 130, winRate: 44, useRate: 15 };
  b[String(R.brock.id)] = { games: 300, wins: 150, winRate: 50, useRate: 15 };
  const [lo, hi] = R.brock.id < R.bull.id ? [R.brock.id, R.bull.id] : [R.bull.id, R.brock.id];
  const brockWins = 140; // of 200
  return { sample: 1500, brawlers: b, matchups: { [String(lo)]: { [String(hi)]: [200, lo === R.brock.id ? brockWins : 200 - brockWins] } }, synergy: {} };
};
const inp = (over: Partial<Parameters<typeof suggest>[0]> = {}) => ({ brawlers: ALL, map: KO, stats: SAMPLE(), bans: [], mine: [], theirs: [], ...over });

describe('suggestions from ladder data', () => {
  it('leaves out banned and picked brawlers', () => {
    const ids = suggest(inp({ bans: [R.piper.id], mine: [R.gene.id], theirs: [R.bull.id] })).map((s) => s.brawler.id);
    expect(ids).not.toContain(R.piper.id);
    expect(ids).not.toContain(R.gene.id);
    expect(ids).not.toContain(R.bull.id);
  });
  it('puts the strong, popular brawler first and keeps scores in 1..99', () => {
    const s = suggest(inp());
    expect(s[0].brawler.id).toBe(R.piper.id);
    for (const x of s) { expect(x.score).toBeGreaterThanOrEqual(1); expect(x.score).toBeLessThanOrEqual(99); }
    for (let i = 1; i < s.length; i++) expect(s[i - 1].score).toBeGreaterThanOrEqual(s[i].score);
  });
  it('shrinks small samples toward 50%', () => {
    const st = SAMPLE();
    st.brawlers[String(R.colt.id)] = { games: 3, wins: 3, winRate: 100, useRate: 4 };
    expect(row(st, R.colt.id)!.adj).toBeLessThan(0.56);
  });
  it('real counter data lifts the brawler that wins the matchup', () => {
    const before = suggest(inp()).find((s) => s.brawler.id === R.brock.id)!.score;
    const after = suggest(inp({ theirs: [R.bull.id] })).find((s) => s.brawler.id === R.brock.id)!.score;
    expect(after).toBeGreaterThan(before);
  });
  it('reads pairs from either side', () => {
    const st = SAMPLE();
    const a = pair(st.matchups, R.brock.id, R.bull.id, true)!, b = pair(st.matchups, R.bull.id, R.brock.id, true)!;
    expect(a[0]).toBe(200); expect(a[1] + b[1]).toBe(200); expect(a[1]).toBe(140);
    expect(laneEdge(st, KO, R.brock, R.bull).p).toBeGreaterThan(0.6);
    expect(laneEdge(st, KO, R.bull, R.brock).p).toBeLessThan(0.4);
  });
  it('works with no data at all (model only)', () => {
    const s = suggest(inp({ stats: null }));
    expect(s.length).toBe(ALL.length);
  });
});

describe('lanes', () => {
  it('puts a controller mid in Hot Zone and uses each brawler once', () => {
    const l = autoLanes([R.bull, R.gene, R.colt], ZONE, null);
    expect(l[1]!.id).toBe(R.gene.id);
    expect(new Set(l.map((b) => b!.id)).size).toBe(3);
  });
  it('handles partial teams', () => {
    const l = autoLanes([R.bull], BALL, null);
    expect(l.filter(Boolean).length).toBe(1);
  });
});
