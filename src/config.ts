/**
 * Central app identity. Rename the app here and everything (title, manifest,
 * About text, storage namespace) follows.
 */
export const APP = {
  name: 'Draft Compass',
  shortName: 'Compass',
  tagline: 'Ranked pick & ban helper',
  /** localStorage key prefix. Changing it resets saved settings. */
  storagePrefix: 'dc',
  themeColor: '#0f1115',
  backgroundColor: '#0f1115',
  version: '0.3.0',
} as const;

export const DATA = {
  catalogBase: 'https://api.brawlapi.com/v1',
  /** Live catalog is refetched in the background after this long. */
  catalogMaxAgeMs: 12 * 60 * 60 * 1000,
  /** Our usual Ranked mode pool. Supercell rotates it; adjust here. */
  rankedModes: ['Gem Grab', 'Brawl Ball', 'Knockout', 'Heist', 'Hot Zone', 'Bounty'],
} as const;
