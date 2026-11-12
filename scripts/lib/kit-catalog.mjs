// Current kit catalog: official /brawlers gadgets and star powers, plus gears
// that a brawler can actually equip right now. Epic and Mythic gears are
// removed when a brawler receives Buffies; the official API can lag those
// removals, so we subtract them using data/buffie-brawlers.json.

export const SUPER_RARE_GEAR_IDS = new Set([
  62000000, // SPEED
  62000001, // HEALTH
  62000002, // DAMAGE
  62000003, // VISION
  62000004, // SHIELD
  62000017, // GADGET COOLDOWN
]);

export const SUPER_RARE_GEAR_NAMES = new Set([
  'SPEED', 'HEALTH', 'DAMAGE', 'VISION', 'SHIELD', 'GADGET COOLDOWN',
]);

export function isSuperRareGear(item) {
  if (!item) return false;
  if (item.id != null && SUPER_RARE_GEAR_IDS.has(item.id)) return true;
  return SUPER_RARE_GEAR_NAMES.has(item.name);
}

export function currentGearsFor(officialGears, hasBuffies) {
  const gears = officialGears ?? [];
  if (!hasBuffies) return gears;
  return gears.filter((g) => isSuperRareGear(g));
}

export function buildCatalog(officialBrawlers, buffieIds) {
  const buffies = new Set((buffieIds ?? []).map(Number));
  const byId = new Map();
  for (const b of officialBrawlers ?? []) {
    const hasBuffies = buffies.has(Number(b.id));
    byId.set(Number(b.id), {
      id: b.id,
      name: b.name,
      hasBuffies,
      gadgets: b.gadgets ?? [],
      starPowers: b.starPowers ?? [],
      gears: currentGearsFor(b.gears, hasBuffies),
      officialGears: b.gears ?? [],
    });
  }
  return byId;
}

function findItem(arr, item) {
  return (arr ?? []).find((x) => x.id === item.id || x.name === item.name) ?? null;
}

function mismatch(kind, brawler, item, expected) {
  const got = item ? `${item.name} (${item.id})` : '(missing)';
  const want = (expected ?? []).map((x) => `${x.name} (${x.id})`).join(', ') || '(none)';
  return { brawlerId: brawler.id, brawler: brawler.name, kind, item: got, allowed: want };
}

/** Returns a list of mismatches. Empty means builds.json is valid. */
export function validateBuilds(buildsFile, catalog) {
  const problems = [];
  const builds = buildsFile?.builds ?? {};
  for (const [id, rec] of Object.entries(builds)) {
    const brawler = catalog.get(Number(id));
    if (!brawler) {
      problems.push({
        brawlerId: Number(id),
        brawler: rec?.name ?? String(id),
        kind: 'brawler',
        item: String(id),
        allowed: 'official catalog id',
      });
      continue;
    }
    const gadget = rec.gadget;
    const foundG = findItem(brawler.gadgets, gadget);
    if (!gadget || !foundG) {
      problems.push(mismatch('gadget', brawler, gadget, brawler.gadgets));
    } else if (foundG.name !== gadget.name || foundG.id !== gadget.id) {
      problems.push({
        ...mismatch('gadget', brawler, gadget, brawler.gadgets),
        detail: `official is ${foundG.name} (${foundG.id})`,
      });
    }
    const sp = rec.starPower;
    const foundS = findItem(brawler.starPowers, sp);
    if (!sp || !foundS) {
      problems.push(mismatch('starPower', brawler, sp, brawler.starPowers));
    } else if (foundS.name !== sp.name || foundS.id !== sp.id) {
      problems.push({
        ...mismatch('starPower', brawler, sp, brawler.starPowers),
        detail: `official is ${foundS.name} (${foundS.id})`,
      });
    }
    const gears = rec.gears ?? [];
    if (gears.length !== 2) {
      problems.push({
        brawlerId: brawler.id,
        brawler: brawler.name,
        kind: 'gears',
        item: `count ${gears.length}`,
        allowed: 'exactly 2 gears',
      });
    }
    const seen = new Set();
    for (const g of gears) {
      const found = findItem(brawler.gears, g);
      if (!g || !found) {
        problems.push(mismatch('gear', brawler, g, brawler.gears));
      } else if (found.name !== g.name || found.id !== g.id) {
        problems.push({
          ...mismatch('gear', brawler, g, brawler.gears),
          detail: `current catalog is ${found.name} (${found.id})`,
        });
      }
      if (g?.id != null) {
        if (seen.has(g.id)) {
          problems.push({
            brawlerId: brawler.id,
            brawler: brawler.name,
            kind: 'gear',
            item: `${g.name} (${g.id})`,
            allowed: 'two distinct gears',
          });
        }
        seen.add(g.id);
      }
    }
  }
  return problems;
}
