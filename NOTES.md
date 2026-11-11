# Draft Compass: build notes

Built for Jaluku. Unofficial fan app, not affiliated with Supercell.
Last updated 10 Nov 2026 (America/Chicago).

## What the catalog actually gives us (BrawlAPI, checked 10 Nov 2026)

| Endpoint | What came back |
| --- | --- |
| `GET /v1/brawlers` | 109 entries (108 released). id, name, class (7 classes), rarity + colour, portrait URLs on `cdn.brawlify.com`, star powers, gadgets, descriptions. CORS `*`, `cache-control: max-age=3600`. |
| `GET /v1/maps` | 1,300 entries, 462 not `disabled`. id, name, mode (+ colour, icon), environment, map image URL. **`lastActive` and `dataUpdated` are `0` on every map.** |
| `GET /v1/maps/{id}` | Same fields plus `stats` and `teamStats`. **Both are empty arrays on all 140 active maps in the six Ranked modes** (Gem Grab, Brawl Ball, Knockout, Heist, Hot Zone, Bounty); every map was fetched one by one. |
| `GET /v1/gamemodes` | 70 modes with colours, icons and a `disabled` flag. |

So BrawlAPI publishes **no per-map win/use rates** and no live rotation. The app therefore uses BrawlAPI only for brawler names and portraits. The map pool, map art and all stats come from our own daily sample of Ranked battle logs (below).

Two tabs. **Draft:** (1) map search over the current Ranked pool, (2) ban search, (3) picks in Ranked order 1-2-2-1 (the first-pick toggle sets who starts). Every pick, from the list or the search bar, goes to whoever's turn it is. The list shows "Best picks for us" on our turn and "Likely enemy picks" (scored from their side) on theirs. (4) Lane matchups with scores. **Maps:** the current Ranked pool grouped by mode, with a search bar. Each map shows its top 10 (score, win rate, pick rate, games) and a "Draft on this map" button. A 6-step spotlight tour shows on first launch (remembered in localStorage as `dc:tutorialDone`) and can be replayed from the "?" button in the header. Each step dims the screen, outlines the real element (`data-tour` attributes) and places the card above or below it with an arrow; steps 2–5 render a temporary example draft (Hard Rock Mine, picks from our own data) without touching the saved draft. The Maps tab shows the map layout image (Brawlify CDN) above the top 10; tap for a full-screen view. The Fan Content Policy notice and credits sit behind a small "About" link at the bottom of the Maps tab. There are no presets, tours or settings.

The catalog also lists some maps several times (re-releases); the app keeps one per name+mode, preferring the active entry.

### Stats snapshot format (format 2, published daily)

The app fetches `<BASE>/data/stats-latest.json` on load (network-first, not precached).

```json
{
  "source": "our daily Ranked sample", "format": 2,
  "updatedAt": "2026-11-11", "generatedAt": "2026-11-11T03:58:00.000Z",
  "window": { "days": 9, "from": "2026-11-03", "to": "2026-11-11" },
  "sample": { "games": 86873, "maps": 26, "rankHist": { "18": 900 } },
  "pool": ["hard-rock-mine-gem-grab", "..."],
  "banData": false,
  "maps": {
    "hard-rock-mine-gem-grab": {
      "name": "Hard Rock Mine", "mode": "Gem Grab", "mapId": 15000007, "img": "...", "modeIcon": "...",
      "sample": 3286, "recent": 3275, "inPool": true,
      "brawlers": { "16000000": { "games": 600, "wins": 320, "winRate": 53.1, "useRate": 18.3, "banRate": null } },
      "matchups": { "16000000": { "16000003": [120, 57] } },
      "synergy":  { "16000000": { "16000035": [40, 22] } }
    }
  }
}
```

- `pool` = the current Ranked map pool: maps with at least 40 Ranked games in the last 7 days of the sample. The app's map search only offers these.
- `useRate` = % of the map's games where the brawler was picked (either team). `winRate` is a display value smoothed toward 50%; the engine uses raw `games`/`wins`.
- `matchups[a][b]` / `synergy[a][b]` = `[games, wins for the lower id a]`, raw; opposite teams / same team. Pairs need ≥ 5 games.
- **Bans:** battle logs record picks only, so `banRate` is `null` and `banData` is `false`.

### Scoring (`src/engine/meta.ts`)

Score 1–99 for each brawler that is still available, for the side whose turn it is (soft-capped, so late picks don't all read 99):
- **Map strength:** win rate shrunk toward 50% as if it had 100 extra even games (Bayesian), so small samples can't top the list.
- **Popularity:** log of the pick rate vs. an even share. High-rank players pick what is meta, so this weighs heavily.
- **Counters:** for each enemy pick, the real head-to-head result on this map minus what the two win rates predict, shrunk with a 50-game prior. Summed over enemy picks, with more weight the later the pick (×0.28 per enemy on pick 1, up to ×0.81 on pick 6).
- **Synergy:** the same, for brawlers on our team.
- The hand-made role/mode-fit model (`heuristics.ts`, `traits.ts`) only nudges brawlers with under 30 games on the map.

**Lanes:** each team is placed left/mid/right by role (controllers, supports and long range mid; tanks mid in Brawl Ball). Our side is then arranged to win the most lane matchups. Each lane shows our chance to win that matchup (head-to-head data, shrunk toward the win-rate expectation). Tap two brawlers on one side to swap them.

### Team win chance (`src/engine/winchance.ts`)

Shown under the pick slots once each side has a pick, as "Win chance so far N%" while picking and "Win chance N%" when all six are in. It's a logistic model on three log-odds features:
- **strength:** Σ logit(shrunk map win rate), ours minus theirs
- **matchups:** every our-vs-their pair: logit(shrunk pair result) − logit(expectation from the two win rates)
- **synergy:** every same-team pair, the same way, ours minus theirs

Weights (strength 0.66, matchups 0.268, synergy 0.054) were fitted by `scripts/fit-winchance.ts` on Ranked games played **after** the snapshot, so none of them were in the stats. On 11 Nov 2026 that was 6,610 games, split 60/40: 3,966 to fit and 2,644 held out.
- Held-out accuracy is **58.2%** (coin flip 50%), and log loss is 0.674 vs 0.693. Strength alone gets 57.9%; matchups add a little, synergy almost nothing.
- Calibration on the held-out games, predicted → actual: 32%→42%, 41%→36%, 50%→50%, 59%→62%, 68%→74%.
- The output is clamped to 25–75%. A draft only explains part of a Ranked game; skill and execution are the rest.
- Rerun the fit now and then: `BRAWL_STARS_API_KEY=... npx vite-node scripts/fit-winchance.ts`.

### How the sampler works (`scripts/collect-stats.mjs`)

- Players: top 200 of the global list plus the top 200 of US, BR, MX, DE, FR, ES, TR, RU, KR, JP, GB (about 2,300 unique). Snowball is on by default, so players met in Ranked games are read too, capped at 8,000 battle logs per run (`MAX_PLAYERS`). `SNOWBALL=0` turns it off.
- Each player's battle log (last 25 games). Keeps `soloRanked`/`teamRanked` 3v3 games, win or loss. `type: "ranked"` is the *trophy* ladder and is ignored. In Ranked games `brawler.trophies` holds the Ranked tier number (`rankHist`).
- Dedupe key: battle time + the six player tags. Mirror picks are left out of matchups.
- Games are filed by the UTC day they were played (`data/daily/<day>.json`). A run only counts games played after the previous run's cutoff (`data/state.json`), so nothing is counted twice. The published file merges the last 28 days.
- Concurrency 8, retries with backoff on 429/5xx. A run takes about 6–7 minutes.

## Player-tag import (phase 2, not built): cleanest free route

**Facts:**
- The official API (`api.brawlstars.com/v1`) needs a key from developer.brawlstars.com. Each key is locked to the IP addresses you list, and calls must come from one of them. The key has to stay server-side.
- **A Cloudflare Worker can't be allowlisted on the free plan.** Worker `fetch()` leaves from Cloudflare's large shared egress pool, so the IP changes. A stable, account-owned egress IP needs Cloudflare's *Dedicated CDN Egress IPs*, an Enterprise feature. Cloudflare's own workers-sdk discussion #16078 asks for a static egress IP for Workers, which confirms there isn't one today.
- **RoyaleAPI runs a free proxy for exactly this case** (docs.royaleapi.com/proxy). You put `45.79.218.79` on the key's IP allowlist and call `https://bsproxy.royaleapi.dev/v1/...` with the same paths and the `Authorization: Bearer <key>` header. A third-party Java client (mlieshoff/brawljars) re-verified that IP and all GET routes on 19 Oct 2026.

**Recommended setup (free, no box dependency):**
1. Jaluku creates a developer account and a key, with allowed IP `45.79.218.79`. He does this himself; nothing has been signed up for.
2. A new, small Worker (e.g. `draft-compass-api`, separate from `pinch-relay`) stores the key as a Worker secret (`wrangler secret put BS_API_KEY`).
3. It exposes `GET /player/:tag`. The Worker normalizes the tag (strip `#`, uppercase, `%23`-encode), calls `bsproxy.royaleapi.dev/v1/players/%23TAG`, and returns only what the app needs: owned brawler ids, power, trophies, and highest rank.
4. Cache the result 10 minutes with the Workers Cache API, allow CORS from the Pages origin only, and pass 404/429/503 through as friendly states.
5. The app then gets an "owned only / min power" roster filter, and the preset can follow highest rank.

**Caveats:**
- The proxy is a community service with no SLA. It sees the key in transit, so use a dedicated key just for this. If it goes away, the fallback is any cheap VPS or free-tier VM with a static IPv4 running the same forwarder.
- Don't use the "log in to the dev portal and re-mint keys for the current IP" trick. It needs the account password in automation and isn't sanctioned.
- `GET /events/rotation` through the same Worker would also give a real "in rotation now" badge for maps.

## Hosting

- Static build in `dist/`. For GitHub Pages: `BASE_PATH=/<repo-name>/ npm run build`. Routing is hash-based (`#/draft`, `#/maps`, `#/brawlers`, `#/me`, deep link `#/draft?map=<slug>`), so Pages needs no 404 trick.
- Service worker (Workbox via vite-plugin-pwa): precaches the shell, fonts, icons and a bundled catalog snapshot (`public/catalog-snapshot.json`, refreshed with `npm run snapshot`). BrawlAPI responses are stale-while-revalidate; Brawlify art is cache-first for 30 days. The app works offline after the first visit.
- Published to GitHub Pages from `jalukum/draft-compass` by `.github/workflows/daily.yml` (daily sampler + deploy). No Worker yet.

## Renaming

Edit `src/config.ts` (`APP.name`, `shortName`, `tagline`). The title, manifest, iOS home-screen title and About text all follow. The storage prefix is separate (`storagePrefix`) so a rename doesn't wipe settings.

**Name ideas** (checked 10 Nov 2026):
- **Snake Order**: a nod to the 1-2-2-1 pick order. No Brawl Stars tool found.
- **Lane Lantern**: lights up the lane plan. No Brawl Stars tool found.
- **Ban Bandit**: playful, ban-first. No Brawl Stars tool found.
- **Lockstep**: lock in together. Only unrelated netcode libraries use it.

**Names to avoid:**
- "Draft Compass" itself: draftcompass.app (fantasy football) and a "DRAFT COMPASS" trademark filing exist. Fine for a private app; rename before anything public.
- Taken by Brawl Stars tools: BrawlPilot, BrawlPick, Brawl Planet, DraftMeta, Brawl Counter, Brawl Codex, Brawl Insights, BrawlLab.
- Taken elsewhere: Draftsmith (an MTG Arena tool).
