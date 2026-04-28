import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// API target:
//   npm run dev              → local Docker backend (localhost:3010)
//   npm run dev:prod         → production VPS (shares real database)
//   npm run dev:backend      → local Node directly (localhost:3001, no Docker)
const PROD_API  = 'https://dam.particle-creative.cloud'
const LOCAL_API = process.env.VITE_API_TARGET === 'node'
  ? 'http://localhost:3011'
  : 'http://localhost:3010'
const apiTarget = process.env.VITE_API_TARGET === 'production' ? PROD_API : LOCAL_API

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
      },
      '/auth': {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
