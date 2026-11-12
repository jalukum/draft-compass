// Validate public/data/builds.json against the current official kit catalog.
//
// Gadgets and star powers come from official /brawlers. Gears are official gears
// minus Epic/Mythic on brawlers who have Buffies (the API can still list those
// after they were removed in-game).
//
// Usage:
//   node scripts/validate-builds.mjs              # snapshot in data/
//   node scripts/validate-builds.mjs --live       # fetch /brawlers (needs BRAWL_STARS_API_KEY)
//   node scripts/validate-builds.mjs --live --check-profiles
//   node scripts/validate-builds.mjs --live --update-snapshot
//
// Exit 1 if any builds.json item is not in the current catalog, or if
// --check-profiles finds a Buffie brawler that is missing from our list.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, validateBuilds } from './lib/kit-catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROXY = 'https://bsproxy.royaleapi.dev/v1';
const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const updateSnapshot = args.has('--update-snapshot');
const checkProfiles = args.has('--check-profiles');

function loadJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function key() {
  return process.env.BRAWL_STARS_API_KEY?.trim();
}

async function api(path) {
  const k = key();
  if (!k) throw new Error('BRAWL_STARS_API_KEY is not set.');
  const res = await fetch(`${PROXY}${path}`, {
    headers: { Authorization: `Bearer ${k}`, Accept: 'application/json', 'User-Agent': 'draft-compass-validate' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed: ${res.status} ${body.slice(0, 180)}`);
  }
  return res.json();
}

function slimOfficial(payload) {
  const items = payload.items ?? payload;
  return {
    fetchedAt: new Date().toISOString(),
    source: `${PROXY}/brawlers`,
    count: items.length,
    brawlers: items.map((b) => ({
      id: b.id,
      name: b.name,
      gadgets: (b.gadgets ?? []).map((x) => ({ id: x.id, name: x.name })),
      starPowers: (b.starPowers ?? []).map((x) => ({ id: x.id, name: x.name })),
      gears: (b.gears ?? []).map((x) => ({ id: x.id, name: x.name })),
    })),
  };
}

async function loadOfficial() {
  if (!live) {
    const snap = loadJson('data/official-kits.json');
    return { official: snap, source: `snapshot ${snap.fetchedAt}` };
  }
  if (!key()) {
    console.error('validate-builds --live needs BRAWL_STARS_API_KEY.');
    process.exit(1);
  }
  const raw = await api('/brawlers');
  const official = slimOfficial(raw);
  if (updateSnapshot) {
    writeFileSync(join(ROOT, 'data/official-kits.json'), JSON.stringify(official, null, 2) + '\n');
    console.log(`updated data/official-kits.json (${official.count} brawlers)`);
  }
  return { official, source: `live ${official.fetchedAt}` };
}

async function checkNewBuffies(buffieIds) {
  const known = new Set(buffieIds.map(Number));
  const ranking = await api('/rankings/global/players?limit=20');
  const tags = (ranking.items ?? []).map((p) => p.tag);
  const found = new Map(); // id -> {name, count}
  let profiles = 0;
  for (const tag of tags) {
    if (profiles >= 12) break;
    const enc = encodeURIComponent(tag.startsWith('#') ? tag : `#${tag}`);
    try {
      const p = await api(`/players/${enc}`);
      if (!p?.brawlers) continue;
      profiles += 1;
      for (const b of p.brawlers) {
        const bf = b.buffies ?? {};
        if (bf.gadget || bf.starPower || bf.hyperCharge) {
          const rec = found.get(b.id) ?? { name: b.name, count: 0 };
          rec.count += 1;
          found.set(b.id, rec);
        }
      }
    } catch {
      // some players hide their profile
    }
  }
  const unexpected = [...found.entries()].filter(([id]) => !known.has(Number(id)));
  return { profiles, foundCount: found.size, unexpected };
}

const { official, source } = await loadOfficial();
const buffieFile = loadJson('data/buffie-brawlers.json');
const buffieIds = (buffieFile.brawlers ?? []).map((b) => b.id);
const catalog = buildCatalog(official.brawlers, buffieIds);
const builds = loadJson('public/data/builds.json');
const problems = validateBuilds(builds, catalog);

console.log(`catalog: ${source}; ${official.count} official brawlers, ${buffieIds.length} with Buffies`);
console.log(`builds.json: ${Object.keys(builds.builds ?? {}).length} entries, updatedAt ${builds.updatedAt}`);

if (problems.length) {
  console.error(`\n${problems.length} invalid kit item(s):`);
  for (const p of problems) {
    console.error(`  ${p.brawler}: ${p.kind} ${p.item} is not in the current catalog. Allowed: ${p.allowed}${p.detail ? ` (${p.detail})` : ''}`);
  }
  process.exit(1);
}

console.log('builds.json matches the current official catalog (gadgets, star powers, and currently equipable gears).');

if (checkProfiles) {
  if (!live) {
    console.error('--check-profiles requires --live');
    process.exit(1);
  }
  const r = await checkNewBuffies(buffieIds);
  console.log(`profile check: ${r.profiles} profiles, ${r.foundCount} brawlers with a Buffie unlocked`);
  if (r.unexpected.length) {
    console.error('New Buffie brawler(s) not in data/buffie-brawlers.json (update the list and drop their Epic/Mythic gears):');
    for (const [id, rec] of r.unexpected) {
      console.error(`  ${rec.name} (${id}) seen on ${rec.count} profile(s)`);
    }
    process.exit(1);
  }
}
