import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP } from './src/config';

// GitHub Pages serves from /<repo-name>/. Set BASE_PATH=/<repo-name>/ when building for it.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    preact(),
    {
      name: 'app-identity',
      transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', APP.name).replaceAll('%APP_SHORT%', APP.shortName),
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png', 'catalog-snapshot.json'],
      manifest: {
        name: APP.name,
        short_name: APP.shortName,
        description: `${APP.tagline}. Unofficial fan app, not affiliated with Supercell.`,
        start_url: `${base}#/draft`,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        theme_color: APP.themeColor,
        background_color: APP.backgroundColor,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'api.brawlapi.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'catalog-api', expiration: { maxEntries: 20, maxAgeSeconds: 7 * 86400 } },
          },
          {
            urlPattern: ({ url }) => /(^|\.)brawlify\.com$/.test(url.hostname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'game-art',
              expiration: { maxEntries: 900, maxAgeSeconds: 30 * 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
