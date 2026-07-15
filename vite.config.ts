import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: served under https://<user>.github.io/timing-chart/
// Use '/' for local dev/preview convenience via the BASE_PATH env override.
const base = process.env.BASE_PATH ?? '/timing-chart/'
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:51124'
const apiProxyHost = process.env.VITE_API_PROXY_HOST

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        ...(apiProxyHost ? { headers: { host: apiProxyHost } } : {}),
      },
    },
  },
  optimizeDeps: {
    // wavedrom ships CommonJS + skins as plain JS modules
    include: ['wavedrom', 'wavedrom/skins/default.js'],
  },
})
