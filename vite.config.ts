import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// PWA (vite-plugin-pwa) and offline shell land in Milestone 2.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Deterministic, source-map-free production bundle (no source disclosure in prod).
    sourcemap: false,
    target: 'es2020',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
