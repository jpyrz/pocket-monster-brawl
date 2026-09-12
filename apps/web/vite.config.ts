import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons.svg'],
      manifest: {
        id: '/',
        name: 'Pocket Monster Brawl',
        short_name: 'PM Brawl',
        description: 'A local friends league for save-sourced Pokémon battles.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#e64b43',
        theme_color: '#e64b43',
        icons: [
          { src: '/pmb-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pmb-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pmb-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'POST',
          },
        ],
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3001',
    },
  },
})
