import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      // Docker mode: backend runs on 3010 (docker-compose port mapping)
      // Dev mode:    backend runs on 3001 (node server.js) → change back to 3001
      '/api': 'http://localhost:3010',
    },
  },
})
