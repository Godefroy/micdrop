import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['./src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    // dist/index.mjs finds the worker and the module next to itself
    shims: true,
  },
  // The worker runs on its own thread, so it is a file of its own, loaded by
  // path. It imports the wasm-bindgen glue, which is an ES module.
  {
    entry: ['./src/worker.ts'],
    format: ['esm'],
    splitting: false,
    sourcemap: true,
  },
])
