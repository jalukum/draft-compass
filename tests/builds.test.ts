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

describe('builds vs current official catalog', () => {
  it('rejects any gadget, star power or gear that a brawler cannot equip now', async () => {
    const { execFileSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const out = execFileSync('node', ['scripts/validate-builds.mjs'], { cwd: root, encoding: 'utf8' });
    expect(out).toMatch(/matches the current official catalog/);
  });

  it('does not recommend removed Epic or Mythic gears on Buffie brawlers', () => {
    const official = JSON.parse(readFileSync(new URL('../data/official-kits.json', import.meta.url), 'utf8')) as {
      brawlers: { id: number; name: string; gears: { id: number; name: string }[] }[];
    };
    const buffies = JSON.parse(readFileSync(new URL('../data/buffie-brawlers.json', import.meta.url), 'utf8')) as {
      brawlers: { id: number; name: string }[];
    };
    const byId = new Map(official.brawlers.map((b) => [b.id, b]));
    const superRare = new Set(['SPEED', 'HEALTH', 'DAMAGE', 'VISION', 'SHIELD', 'GADGET COOLDOWN']);
    // Official /brawlers can lag Buffie removals — the snapshot still lists these, but builds must not use them.
    const lou = byId.get(16000041)!;
    expect(lou.gears.some((g) => g.name === 'SUPER CHARGE')).toBe(true);
    const mrP = byId.get(16000031)!;
    expect(mrP.gears.some((g) => g.name === 'PET POWER')).toBe(true);
    for (const b of buffies.brawlers) {
      const rec = raw.builds[String(b.id)];
      if (!rec) continue;
      for (const g of rec.gears) {
        expect(superRare.has(g.name), `${b.name} ${g.name}`).toBe(true);
      }
    }
  });
});
