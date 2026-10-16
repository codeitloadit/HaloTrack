import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function commitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

const buildNumber = process.env.GITHUB_RUN_NUMBER

// https://vite.dev/config/
export default defineConfig({
  base: '/HaloTrack/',
  // Pre-bundle the lazily imported detector at dev-server start; discovering it on
  // first use made the dev server reload mid-request.
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
  define: {
    __APP_VERSION__: JSON.stringify(`${buildNumber ? `Build ${buildNumber}` : 'dev'} · ${commitHash()}`),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'HaloTrack',
        short_name: 'HaloTrack',
        description: 'Track a player and overlay a halo ring through a video clip.',
        start_url: '/HaloTrack/',
        scope: '/HaloTrack/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything the app needs is fetched once on install; after that it
        // should keep working fully offline.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,wasm,tflite}'],
        // The auto-tracking runtime and model are well over the 2 MiB default.
        maximumFileSizeToCacheInBytes: 24 * 1024 * 1024,
      },
    }),
  ],
})
