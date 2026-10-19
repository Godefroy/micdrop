import { raw } from 'esbuild-raw-plugin'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['./src/index.ts', './src/silero.ts', './src/vite.ts'],
  format: ['cjs', 'esm'],
  esbuildPlugins: [raw()],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // The Vite plugin reads `import.meta.url` in its CommonJS build too
  shims: true,
})
