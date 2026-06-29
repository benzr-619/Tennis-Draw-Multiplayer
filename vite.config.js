import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/',
  server: {
    port: 5173,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',

      // Use the existing public/manifest.json — don't generate a new one
      manifest: false,

      workbox: {
        // Precache all local build artifacts
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webp,woff,woff2}'],

        // Serve cached index.html for any navigation request (enables offline shell)
        navigateFallback: 'index.html',

        // Never intercept Supabase API or auth calls — always go to network
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/storage\//],

        runtimeCaching: [
          // Google Fonts CSS (the @import stylesheet)
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // Google Fonts webfont files (may be opaque — include status 0)
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // jsDelivr: flag-icons CSS + per-flag SVG assets it references
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'jsdelivr-assets',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // cdnjs: pdf.js loaded on-demand for commissioner PDF upload only
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdnjs-assets',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Supabase calls are intentionally NOT listed here.
          // Workbox falls through to the network for any unmatched request,
          // so all draw/pick/auth data always comes fresh from the API.
        ],
      },
    }),
  ],
})
