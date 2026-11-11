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

So BrawlAPI currently publishes **no per-map win/use rates and no dates for them**. The app:

- shows maps as "In catalog" (not disabled) vs "Vaulted". BrawlAPI has no live rotation (`/events` is empty), so "active" only means "not retired".
- scores from its own role model and labels that **Role model** / **Thin data**, never as ladder stats.
- already has a `stats` signal wired through the engine and UI. Load a snapshot in **Me → Import stats JSON** (format below), or let the daily sampler publish one (below), and scores, labels and the "updated on" date switch over automatically.

The catalog also lists some maps several times (re-releases); the app keeps one per name+mode, preferring the active entry.

### Stats snapshot format (published daily, or a hand import)

The app fetches `<BASE>/data/stats-latest.json` on load (network-first, not precached). A file imported in
**Me → Import stats JSON** overrides it until you tap **Use daily snapshot**.

```json
{
  "source": "our daily Ranked sample",
  "updatedAt": "2026-11-11",
  "generatedAt": "2026-11-11T10:09:12.000Z",
  "window": { "days": 6, "from": "2026-11-06", "to": "2026-11-11" },
  "sample": { "games": 21000, "playersReadLastRun": 1990, "maps": 40, "rankHist": { "18": 900 } },
  "perDay": { "2026-11-10": 5000 },
  "banData": false,
  "maps": {
    "hard-rock-mine-gem-grab": {
      "name": "Hard Rock Mine", "mode": "Gem Grab", "mapId": 15000007,
      "sample": 4200,
      "brawlers": { "16000000": { "winRate": 52.1, "useRate": 14.3, "games": 600, "banRate": null } },
      "matchups": { "16000000": { "16000003": [120, 47.5] } },
      "synergy":  { "16000000": { "16000035": [40, 55.0] } }
    }
  }
}
```

- Only `source`, `updatedAt` and `maps[*].sample/brawlers[*].winRate/useRate` are required; everything else is optional, so old hand-made files still import.
- Map key = the app's map slug (`<map name>-<mode>`, lower-case, dashes). Brawler key = official/BrawlAPI id.
- `sample` = Ranked games on the map in the window. `useRate` = % of those games where the brawler was picked (either team). `winRate` is smoothed toward 50% (as if 20 extra even games).
- `matchups[a][b]` = `[games, a's win %]` with a and b on opposite teams; `synergy[a][b]` = `[games, win %]` on the same team. Stored once per pair with the lower id first (`pairStat()` in `src/data/types.ts` reads either way round). Pairs need ≥ 8 games and are smoothed toward 50% (prior 10).
- **Bans:** battle logs record picks only, so `banRate` is `null` and `banData` is `false`. Ban advice stays model-based.
- Under 1,000 games a map's stats weight is scaled down (√(sample/1000)) and rows are labelled by the model, not "Ladder data".

### How the sampler works (`scripts/collect-stats.mjs`)

- Players: top 200 of the global list plus the top 200 of US, BR, MX, DE, FR, ES, TR, RU, KR, JP, GB player rankings, deduped and capped at 2,000 (`MAX_PLAYERS`). `SNOWBALL=1` would also add players met in Ranked games (off by default).
- Each player's battle log (last 25 games). Games with `battle.type` `soloRanked` or `teamRanked`, two teams of three, win or loss (draws skipped). In real data, `type: "ranked"` is *trophy* ladder and is ignored. In Ranked games `brawler.trophies` holds the player's Ranked tier number; the snapshot keeps a histogram of the per-game average (`rankHist`).
- Dedupe key: battle time + the six player tags. Mirror picks are left out of matchups.
- Each game is filed under the UTC day it was played and added to `data/daily/<day>.json`. A run only counts games played after the previous run's cutoff (`data/state.json`), so days are never double counted, and the first run reaches back as far as the logs go.
- The published file merges the last 28 days (`WINDOW_DAYS`). Older day files and dated copies are pruned.
- Concurrency 6 with retries and exponential backoff on 429/5xx; 404s (players whose logs are hidden) are skipped.

## Scoring engine (src/engine)

All original. Nothing here comes from the reference site.

- `traits.ts`: hand-written range band and kit tags (wall breaker, over walls, heals, control, burst, splash, mobile, tank shredder, anti-heal) for about 85 brawlers. Brawlers not in the table, mostly the newest ones, fall back to class defaults and get a **Thin data** label.
- `heuristics.ts`: class×mode fit table, tag×mode bonuses, ideal range per mode, a class-pressure matrix for matchups (made antisymmetric, so `matchup(a,b) = −matchup(b,a)`), and team-shape scoring (role spread, range mix, stacked classes, a few synergies, missing wall-breaker/zone control).
- `score.ts`: five signals, each in −1…1 and blended by weight into a 0–100 score:
  1. **Ladder stats** (only when a snapshot has the map)
  2. **Mode fit**
  3. **Team fit**: how much the pick improves your team's shape
  4. **Matchups** against enemy picks already locked
  5. **Blind-pick safety**: how many strong, still-available brawlers punish it. This fades out as the enemy fills its team.

  Ban mode scores each brawler from the enemy's side ("how much would this hurt us"). Each row leads with the note that sets it apart from the field. After a full 3v3 you get a lean, capped to 30–70% and worded as a lean, plus a left/mid/right lane plan chosen by brute force over lane fit and lane matchups.
- `weights.ts`: three presets plus a Custom mix with sliders:
  - **Steady Climber**: map-fit heavy, for lower ranks.
  - **Counter-Puncher**: matchup and safety heavy, for Mythic and up.
  - **Team Glue**: composition heavy, for solo queue with randoms.
- **Off-meta toggle**: softens negative mode fit, and the low-use penalty once stats exist.
- `draft.ts`: board state. Six bans, then picks in 1-2-2-1 order with auto turn advance. Tap any slot to undo it.

Tests: `tests/engine.test.ts` (23 tests).

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
