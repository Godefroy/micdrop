import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * The files of a Phonon model folder, as Gradium ships it.
 *
 * The weights come as `model.q8.gguf` or `model.safetensors`, looked up in
 * that order so a folder holding both takes the lighter file. `config.json`
 * describes the architecture and is optional, the module falling back to the
 * original Pocket TTS shapes without it. Voices are safetensors files in
 * `voices/`, named after the speaker.
 */

export interface ModelFiles {
  weights: string
  tokenizer: string
  config?: string
}

const WEIGHTS = ['model.q8.gguf', 'model.safetensors']
const TOKENIZER = 'tokenizer.json'
const CONFIG = 'config.json'
const VOICES_DIR = 'voices'
const VOICE_EXTENSION = '.safetensors'

/** The four voices of the English preview model. */
export const PHONON_VOICES = ['Freya', 'Harper', 'Sterling', 'Toby'] as const

export type PhononVoiceName = (typeof PHONON_VOICES)[number]

export function resolveModelFiles(modelDir: string): ModelFiles {
  const weights = WEIGHTS.map((name) => join(modelDir, name)).find(existsSync)
  const tokenizer = join(modelDir, TOKENIZER)
  const config = join(modelDir, CONFIG)

  const missing = [
    ...(weights ? [] : [WEIGHTS.join(' or ')]),
    ...(existsSync(tokenizer) ? [] : [TOKENIZER]),
  ]
  if (!weights || missing.length) {
    throw new Error(
      `Phonon model files missing in "${modelDir}": ${missing.join(', ')}`
    )
  }

  return {
    weights,
    tokenizer,
    config: existsSync(config) ? config : undefined,
  }
}

/** Voices found in the `voices` folder of the model, by name. */
export function listVoices(modelDir: string): string[] {
  const dir = join(modelDir, VOICES_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith(VOICE_EXTENSION))
    .map((file) => file.slice(0, -VOICE_EXTENSION.length))
    .sort()
}

/**
 * A voice name from the model folder ("Freya"), or the path to a voice file
 * of its own.
 */
export function resolveVoicePath(modelDir: string, voice: string): string {
  if (voice.endsWith(VOICE_EXTENSION)) {
    if (!existsSync(voice)) {
      throw new Error(`Phonon voice not found: "${voice}"`)
    }
    return voice
  }

  const path = join(modelDir, VOICES_DIR, voice + VOICE_EXTENSION)
  if (!existsSync(path)) {
    const available = listVoices(modelDir)
    throw new Error(
      `Phonon voice "${voice}" not found in "${modelDir}"` +
        (available.length ? `, available: ${available.join(', ')}` : '')
    )
  }
  return path
}
