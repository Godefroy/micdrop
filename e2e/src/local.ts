import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The server of the advanced demo, where the local models are installed: the
 * tests find them where the demo does, with the same variables
 */
const DEMO_SERVER = fileURLToPath(
  new URL('../../examples/advanced/server/', import.meta.url)
)

/** A local model downloads on its first test, which takes a while */
export const LOCAL_TIMEOUT = 180_000

/** Where the Piper voices were downloaded */
export const PIPER_VOICES_DIR =
  process.env.PIPER_VOICES_DIR || join(DEMO_SERVER, 'voices')

/** Where the Pocket TTS archive was extracted */
export const POCKET_MODEL_DIR =
  process.env.POCKET_MODEL_DIR ||
  join(DEMO_SERVER, 'models/sherpa-onnx-pocket-tts-int8-2026-01-26')

/** Where the mlx-audio server holding Qwen3-TTS answers */
export const QWEN_URL = process.env.QWEN_URL || 'http://localhost:8000'

/** The first file of a folder with this extension, if any */
export function firstFile(dir: string, extension: string): string | undefined {
  if (!existsSync(dir)) return undefined
  const file = readdirSync(dir).find((name) => name.endsWith(extension))
  return file && join(dir, file)
}

/** Whether a program can be run, found on the PATH or given as a path */
export function hasBinary(binary: string): boolean {
  return spawnSync('sh', ['-c', `command -v "${binary}"`]).status === 0
}

/** Whether a local server answers */
export async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) })
    return response.ok
  } catch {
    return false
  }
}
