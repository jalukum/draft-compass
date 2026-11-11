// Refresh the bundled offline catalog (public/catalog-snapshot.json) from BrawlAPI.
import { writeFileSync } from 'node:fs';
const base = 'https://api.brawlapi.com/v1';
const get = async (p) => (await (await fetch(`${base}/${p}`, { headers: { 'user-agent': 'draft-compass-snapshot' } })).json()).list;
const [b, m, g] = await Promise.all([get('brawlers'), get('maps'), get('gamemodes')]);
const out = {
  fetchedAt: new Date().toISOString(),
  brawlers: b.map((x) => ({ id: x.id, name: x.name, released: x.released, imageUrl2: x.imageUrl2, class: { name: x.class?.name }, rarity: { name: x.rarity?.name, color: x.rarity?.color } })),
  maps: m.map((x) => ({ id: x.id, name: x.name, disabled: x.disabled, imageUrl: x.imageUrl, gameMode: { name: x.gameMode?.name, color: x.gameMode?.color, imageUrl: x.gameMode?.imageUrl } })),
  modes: g.map((x) => ({ name: x.name, color: x.color, imageUrl: x.imageUrl, disabled: x.disabled })),
};
writeFileSync(new URL('../public/catalog-snapshot.json', import.meta.url), JSON.stringify(out));
console.log(`snapshot: ${out.brawlers.length} brawlers, ${out.maps.length} maps, ${out.modes.length} modes`);
