import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: "Dragon's Hollow",
        short_name: "Dragon's Hollow",
        description: "The Dragon's Hollow - D&D Companion App",
        theme_color: '#1a1a2e',
        background_color: '#0f0f1a',
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
        globPatterns: ['**/*.{js,css,html,ico,woff2}'],
        globIgnores: ['**/textures/**'],
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
      }
    }
  }
});
