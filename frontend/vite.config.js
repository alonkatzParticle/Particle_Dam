import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const PROD_API  = 'https://dam.particle-creative.cloud'
const LOCAL_API = process.env.VITE_API_TARGET === 'node'
  ? 'http://localhost:3011'
  : 'http://localhost:3010'
const apiTarget = process.env.VITE_API_TARGET === 'production' ? PROD_API : LOCAL_API
const isProd    = process.env.VITE_API_TARGET === 'production'

// Strip the Secure flag from Set-Cookie in local dev so http://localhost stores them
function fixCookies(proxyRes) {
  const raw = proxyRes.headers['set-cookie']
  if (raw) {
    proxyRes.headers['set-cookie'] = raw.map(c =>
      c.replace(/;\s*Secure/gi, '').replace(/;\s*SameSite=None/gi, '; SameSite=Lax')
    )
  }
}

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
        secure: isProd,
        configure: (proxy) => { proxy.on('proxyRes', fixCookies) },
      },
      '/auth': {
        target: apiTarget,
        changeOrigin: true,
        secure: isProd,
        configure: (proxy) => { proxy.on('proxyRes', fixCookies) },
      },
    },
  },
})
