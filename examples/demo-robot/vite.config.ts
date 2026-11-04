import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // @micdrop/react keeps its own React 18 for development
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 8094,
    strictPort: true,
  },
  build: {
    outDir: 'dist/client',
  },
})
