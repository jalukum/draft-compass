/** Signal weights. All numbers are Draft Compass originals; tune freely. */
export interface Weights {
  /** Ladder stats for this map (win and use rate), when a stats snapshot has them. */
  stats: number;
  /** How well the brawler's class, range and kit suit the mode. */
  modeFit: number;
  /** How much the pick rounds out the team (roles, range mix, synergies). */
  comp: number;
  /** Head-to-head edge against the enemy picks already locked in. */
  counter: number;
  /** Blind-pick safety: how few strong, still-available brawlers punish it. */
  safety: number;
}

export type PresetId = 'climber' | 'counterpunch' | 'glue' | 'custom';

export interface Preset { id: PresetId; label: string; blurb: string; weights: Weights }

export const PRESETS: Preset[] = [
  {
    id: 'climber',
    label: 'Steady Climber',
    blurb: 'Leans on map fit and solid, safe picks. Good for Bronze to Diamond.',
    weights: { stats: 1.3, modeFit: 1.5, comp: 0.9, counter: 0.6, safety: 0.6 },
  },
  {
    id: 'counterpunch',
    label: 'Counter-Puncher',
    blurb: 'Hunts matchups and respects what the enemy can still answer. For Mythic and up.',
    weights: { stats: 0.8, modeFit: 0.8, comp: 0.8, counter: 1.7, safety: 1.0 },
  },
  {
    id: 'glue',
    label: 'Team Glue',
    blurb: 'Fills the gap your team is missing first. Best when you play with randoms.',
    weights: { stats: 0.8, modeFit: 1.0, comp: 1.8, counter: 0.8, safety: 0.5 },
  },
];

export const presetWeights = (id: PresetId, custom?: Weights): Weights =>
  id === 'custom' && custom ? custom : (PRESETS.find((p) => p.id === id) ?? PRESETS[0]).weights;
