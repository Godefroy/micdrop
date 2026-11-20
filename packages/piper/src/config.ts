import { readFile } from 'fs/promises'

/**
 * The part of a Piper voice configuration we read.
 *
 * Every voice ships as a pair of files, `<voice>.onnx` and `<voice>.onnx.json`.
 * The JSON one carries the sample rate the model generates at, which varies
 * between voices (16000 for the low quality ones, 22050 for the others), and
 * the number of speakers a multi-speaker voice holds.
 */
export interface PiperVoiceConfig {
  sampleRate: number
  speakerCount: number
  language?: string
}

export const DEFAULT_SAMPLE_RATE = 22050

export async function readVoiceConfig(
  configPath: string
): Promise<PiperVoiceConfig> {
  const raw = JSON.parse(await readFile(configPath, 'utf-8'))
  return {
    sampleRate: raw?.audio?.sample_rate ?? DEFAULT_SAMPLE_RATE,
    speakerCount: raw?.num_speakers ?? 1,
    language: raw?.language?.code,
  }
}

/** Piper expects its configuration next to the model, with a .json suffix. */
export function defaultConfigPath(modelPath: string): string {
  return `${modelPath}.json`
}
