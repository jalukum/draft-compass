export type Side = 'ally' | 'opp';
export type Phase = 'ban' | 'pick';

export interface DraftState {
  mapSlug: string | null;
  bans: number[];
  ally: number[];
  opp: number[];
  phase: Phase;
  turn: Side;
  firstPick: Side;
  /** "See the other side": advise the opponent instead of us. */
  flipped: boolean;
}

export const MAX_BANS = 6;
export const TEAM = 3;

export const emptyDraft = (mapSlug: string | null = null): DraftState => ({
  mapSlug, bans: [], ally: [], opp: [], phase: 'ban', turn: 'ally', firstPick: 'ally', flipped: false,
});

export const other = (s: Side): Side => (s === 'ally' ? 'opp' : 'ally');

/** Ranked pick order 1-2-2-1: first picker, then two, then two, then one. */
export function pickTurn(firstPick: Side, picksSoFar: number): Side {
  const order: Side[] = [firstPick, other(firstPick), other(firstPick), firstPick, firstPick, other(firstPick)];
  return order[Math.min(picksSoFar, 5)];
}

export const isTaken = (d: DraftState, id: number) => d.bans.includes(id) || d.ally.includes(id) || d.opp.includes(id);
export const isFull = (d: DraftState) => d.ally.length === TEAM && d.opp.length === TEAM;

function afterChange(d: DraftState): DraftState {
  const picks = d.ally.length + d.opp.length;
  if (d.phase === 'ban' && d.bans.length >= MAX_BANS && picks === 0) return { ...d, phase: 'pick', turn: d.firstPick };
  if (d.phase === 'pick' && picks < TEAM * 2) {
    let turn = pickTurn(d.firstPick, picks);
    if (d[turn].length >= TEAM) turn = other(turn);
    return { ...d, turn };
  }
  return d;
}

export function applyBan(d: DraftState, id: number): DraftState {
  if (isTaken(d, id) || d.bans.length >= MAX_BANS) return d;
  return afterChange({ ...d, bans: [...d.bans, id] });
}

export function applyPick(d: DraftState, id: number, side: Side = d.turn): DraftState {
  if (isTaken(d, id)) return d;
  let s = side;
  if (d[s].length >= TEAM) s = other(s);
  if (d[s].length >= TEAM) return d;
  return afterChange({ ...d, phase: 'pick', [s]: [...d[s], id] });
}

export function removeFrom(d: DraftState, where: 'bans' | Side, id: number): DraftState {
  const next = { ...d, [where]: d[where].filter((x) => x !== id) } as DraftState;
  if (where !== 'bans') return afterChange(next);
  return next;
}

export const resetDraft = (d: DraftState): DraftState => ({ ...emptyDraft(d.mapSlug), firstPick: d.firstPick, turn: d.firstPick });

/**
 * Whose pick is next in Ranked order (1-2-2-1) given how many each team has, or null when both are full.
 * Works after removals too: the first slot in the order that the team hasn't filled is next.
 */
export function nextPicker(firstPick: Side, ally: number, opp: number): Side | null {
  const left = { ally, opp };
  const order: Side[] = [firstPick, other(firstPick), other(firstPick), firstPick, firstPick, other(firstPick)];
  for (const s of order) {
    if (left[s] > 0) { left[s]--; continue; }
    return s;
  }
  return null;
}
