import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8096,
    strictPort: true,
  },
  build: {
    outDir: 'dist/client',
  },
})
