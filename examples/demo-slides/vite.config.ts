import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8092,
    strictPort: true,
  },
  build: {
    outDir: 'dist/client',
  },
})
