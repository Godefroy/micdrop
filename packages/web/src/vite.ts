import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
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
 * Silero only runs on WebAssembly, so the runtime is the WebAssembly build,
 * half the size of the full one. Smart Turn runs on the graphics card when
 * the browser offers it, so the full build is kept when `@micdrop/smart-turn`
 * is installed. Every import of the runtime gets the same build, so an app
 * never loads two of them.
 *
 * @example
 * import { micdrop } from '@micdrop/web/vite'
 *
 * export default defineConfig({ plugins: [micdrop()] })
 */
export function micdrop(options: MicdropViteOptions = {}): Plugin {
  const sileroModel = fileURLToPath(
    new URL('../assets/silero_vad_v5.onnx', import.meta.url)
  ).replace(/\\/g, '/')

  return {
    name: 'micdrop',
    enforce: 'pre',

    config(config) {
      const webgpu =
        options.webgpu ??
        isInstalled(
          '@micdrop/smart-turn',
          path.resolve(config.root ?? process.cwd())
        )
      return {
        resolve: {
          alias: webgpu
            ? []
            : [
                {
                  find: /^onnxruntime-web$/,
                  replacement: 'onnxruntime-web/wasm',
                },
              ],
        },
        optimizeDeps: {
          // Pre-bundling moves the runtime away from its WebAssembly files,
          // which it looks up relative to its own address
          exclude: ['onnxruntime-web', 'onnxruntime-web/wasm'],
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

export interface MicdropViteOptions {
  /**
   * Keeps the build of the ONNX runtime that runs on the graphics card, twice
   * the size of the WebAssembly one. Only Smart Turn uses it, so it defaults
   * to whether `@micdrop/smart-turn` is installed.
   */
  webgpu?: boolean
}

/** Whether the app at `root` can import the package */
function isInstalled(name: string, root: string): boolean {
  try {
    createRequire(path.join(root, 'package.json')).resolve(name)
    return true
  } catch {
    return false
  }
}
