# Draft Compass

Ranked pick & ban helper PWA for Brawl Stars. Unofficial fan app, not affiliated with Supercell.

```bash
npm install
npm run dev        # local dev
npm test           # engine unit tests
npm run build      # typecheck + production build (BASE_PATH=/<repo>/ for GitHub Pages)
npm run snapshot   # refresh the bundled offline catalog from BrawlAPI
npm run icons      # redraw PNG icons
npm run shots      # Playwright screenshots (needs `vite preview` running)
npm run collect    # ladder sampler (needs BRAWL_STARS_API_KEY in the environment)
```

See NOTES.md for data findings, the scoring model, player-tag plan and hosting notes.

## Daily ladder stats

`.github/workflows/daily.yml` runs `scripts/collect-stats.mjs` every day around 10:00 UTC (and on demand),
commits the new snapshot (`public/data/stats-latest.json`, a dated copy in `public/data/history/`, raw
per-day counts in `data/daily/`), then builds and deploys GitHub Pages. Pushes to `main` just rebuild and deploy.

The key lives only in the `BRAWL_STARS_API_KEY` repository secret. Calls go through the RoyaleAPI proxy
(`bsproxy.royaleapi.dev`), whose IP is on the key's allowlist.

Data: official Brawl Stars API (battle logs, rankings) and BrawlAPI (catalog). Art: Brawlify CDN.
This material is unofficial and is not endorsed by Supercell. For more information see Supercell's
Fan Content Policy: https://supercell.com/en/fan-content-policy/
