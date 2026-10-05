import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { PhononQuant } from './protocol'

/**
 * The files of a Phonon model folder, laid out as the Hugging Face repos of
 * Gradium are.
 *
 * The weights come as `model.q8.gguf` or `model.safetensors`, the file of the
 * precision asked for being preferred. `config.json` and `tokenizer.json` are
 * required. Voices are safetensors files in `voices/` or `embeddings/`, named
 * after the speaker, and `default-voice.safetensors` is the model's own voice,
 * known as "default".
 */

export interface ModelFiles {
  weights: string
  tokenizer: string
  config: string
  /** Voices of the model folder, by name. */
  voices: Record<string, string>
  /** Voice spoken when none is asked for. */
  defaultVoice?: string
}

/** Weights by precision, in the order the Phonon runtime tries them. */
export const WEIGHTS: Record<PhononQuant, string[]> = {
  q8: ['model.q8.gguf', 'model.safetensors'],
  f32: ['model.safetensors', 'model.q8.gguf'],
}
export const TOKENIZER = 'tokenizer.json'
export const CONFIG = 'config.json'
// A name in both folders keeps the one in voices/
export const VOICE_DIRS = ['voices', 'embeddings']
export const DEFAULT_VOICE_FILE = 'default-voice.safetensors'
export const VOICE_EXTENSION = '.safetensors'

export function resolveModelFiles(
  modelDir: string,
  quant: PhononQuant
): ModelFiles {
  const weights = WEIGHTS[quant]
    .map((name) => join(modelDir, name))
    .find((path) => existsSync(path))
  const tokenizer = join(modelDir, TOKENIZER)
  const config = join(modelDir, CONFIG)

  const missing = [
    ...(weights ? [] : [WEIGHTS[quant].join(' or ')]),
    ...(existsSync(tokenizer) ? [] : [TOKENIZER]),
    ...(existsSync(config) ? [] : [CONFIG]),
  ]
  if (!weights || missing.length) {
    throw new Error(
      `Phonon model files missing in "${modelDir}": ${missing.join(', ')}`
    )
  }

  const voices = listVoiceFiles(modelDir)
  const names = Object.keys(voices).sort()
  return {
    weights,
    tokenizer,
    config,
    voices,
    // As the runtime does: "default" if there is one, else the first by name
    defaultVoice: voices.default ? 'default' : names[0],
  }
}

/** Voices found in the model folder, by name. */
function listVoiceFiles(modelDir: string): Record<string, string> {
  const voices: Record<string, string> = {}
  for (const dir of VOICE_DIRS) {
    const path = join(modelDir, dir)
    if (!existsSync(path)) continue
    for (const file of readdirSync(path)) {
      if (!file.endsWith(VOICE_EXTENSION)) continue
      const name = file.slice(0, -VOICE_EXTENSION.length)
      voices[name] ??= join(path, file)
    }
  }
  const defaultVoice = join(modelDir, DEFAULT_VOICE_FILE)
  if (!voices.default && existsSync(defaultVoice)) {
    voices.default = defaultVoice
  }
  return voices
}
