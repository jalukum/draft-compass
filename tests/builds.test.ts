import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BuildsFile } from '../src/data/types';

const raw = JSON.parse(readFileSync(new URL('../public/data/builds.json', import.meta.url), 'utf8')) as BuildsFile;

describe('builds snapshot', () => {
  it('has sources, a date, and 108 brawlers', () => {
    expect(raw.sources?.length).toBeGreaterThanOrEqual(2);
    expect(raw.sources.map((s) => s.name).join(' ')).toMatch(/Brawl Time Ninja/i);
    expect(raw.sources.map((s) => s.name).join(' ')).toMatch(/Noff/i);
    expect(raw.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(raw.builds).length).toBe(108);
  });

  it('gives every listed brawler a gadget, star power and two gears with official-style names', () => {
    for (const [id, b] of Object.entries(raw.builds)) {
      expect(id).toMatch(/^16\d+$/);
      expect(b.gadget.id).toBeGreaterThan(0);
      expect(b.gadget.name).toMatch(/^[A-Z0-9].+/);
      expect(b.starPower.id).toBeGreaterThan(0);
      expect(b.starPower.name).toMatch(/^[A-Z0-9].+/);
      expect(b.gears).toHaveLength(2);
      expect(b.gears[0].id).not.toBe(b.gears[1].id);
      for (const g of b.gears) {
        expect(g.id).toBeGreaterThan(0);
        expect(g.name).toMatch(/^[A-Z0-9].+/);
      }
    }
  });

  it('has Shelly as Clay Pigeons, Band-Aid, Damage and Shield', () => {
    const s = raw.builds['16000000'];
    expect(s.gadget.name).toBe('CLAY PIGEONS');
    expect(s.starPower.name).toBe('BAND-AID');
    expect(s.gears.map((g) => g.name).sort()).toEqual(['DAMAGE', 'SHIELD']);
  });

  it('lists the three upcoming brawlers as missing', () => {
    const names = (raw.missing ?? []).map((m) => m.name).sort();
    expect(names).toEqual(['REY', 'RUBY', 'THUNDER FROGS']);
  });
});
