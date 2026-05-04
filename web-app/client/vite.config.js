import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: "Dragon's Hollow",
        short_name: "Dragon's Hollow",
        description: "The Dragon's Hollow - D&D Companion App",
        theme_color: '#0c0a07',
        background_color: '#0c0a07',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        importScripts: ['/sw-push.js'],
        globPatterns: ['**/*.{js,css,html,ico,woff2}'],
        globIgnores: ['**/textures/**', '**/assets/dice-box/**'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.discordapp\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'discord-avatars',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
              }
            }
          }
        ]
      }
    })
  ],
  optimizeDeps: {
    include: ['@3d-dice/dice-box'],
  },
  server: {
    port: 5173,
    allowedHosts: ['okhan-architect.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:3420',
        changeOrigin: true
      },
      '/images': {
        target: 'http://localhost:3420',
        changeOrigin: true
      },
      '/sounds': {
        target: 'http://localhost:3420',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3420',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3420',
        ws: true
      }
    }
  }
});
