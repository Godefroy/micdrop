import { micdrop } from '@micdrop/web/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  appType: 'mpa',
  root: 'client',
  plugins: [react(), micdrop()],
  server: {
    // host: '0.0.0.0',
    port: 8080,
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
})
