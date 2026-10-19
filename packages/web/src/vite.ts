import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const SILERO_ID = '@micdrop/web/silero'
const SMART_TURN_ID = '@micdrop/smart-turn/web'
const VIRTUAL_SILERO = '\0micdrop:silero'
const VIRTUAL_SMART_TURN = '\0micdrop:smart-turn'

/**
 * Bundles the files the voice models load at runtime, so a call never depends
 * on a public CDN being reachable.
 *
 * Without it, `@micdrop/web/silero` fetches the Silero model from jsDelivr and
 * the ONNX runtime from unpkg, which an outage, a firewall or an ad blocker
 * can keep from loading. With it, the model ships with the app and the ONNX
 * runtime finds its WebAssembly next to itself, both emitted by Vite.
 * `@micdrop/smart-turn/web` gets the same runtime, its checkpoint stays where
 * `setSmartTurnOptions` points.
 *
 * @example
 * import { micdrop } from '@micdrop/web/vite'
 *
 * export default defineConfig({ plugins: [micdrop()] })
 */
export function micdrop(): Plugin {
  const sileroModel = fileURLToPath(
    new URL('../assets/silero_vad_v5.onnx', import.meta.url)
  ).replace(/\\/g, '/')

  return {
    name: 'micdrop',
    enforce: 'pre',

    config() {
      return {
        optimizeDeps: {
          // Pre-bundling moves the runtime away from its WebAssembly files,
          // which it looks up relative to its own address
          exclude: ['onnxruntime-web'],
        },
      }
    },

    // The app keeps importing `@micdrop/web/silero`, and gets a module that
    // sets the bundled options before handing over the real one. Imports from
    // dependencies and from the wrappers themselves go through untouched.
    resolveId(id, importer) {
      if (!importer || importer.startsWith('\0')) return null
      if (importer.includes('/node_modules/')) return null
      if (id === SILERO_ID) return VIRTUAL_SILERO
      if (id === SMART_TURN_ID) return VIRTUAL_SMART_TURN
      return null
    },

    load(id) {
      if (id === VIRTUAL_SILERO) {
        return [
          `import { setSileroOptions } from '${SILERO_ID}'`,
          `import model from ${JSON.stringify(`${sileroModel}?url`)}`,
          `setSileroOptions({ model, wasmPath: false })`,
          `export * from '${SILERO_ID}'`,
        ].join('\n')
      }
      if (id === VIRTUAL_SMART_TURN) {
        return [
          `import { setSmartTurnOptions } from '${SMART_TURN_ID}'`,
          `setSmartTurnOptions({ wasmPath: false })`,
          `export * from '${SMART_TURN_ID}'`,
        ].join('\n')
      }
      return null
    },
  }
}
