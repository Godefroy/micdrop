import { SharedInstances } from '@micdrop/server'
import { KokoroTTS as KokoroModel } from 'kokoro-js'

export type KokoroDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
export type KokoroDevice = 'wasm' | 'webgpu' | 'cpu'

export interface SynthesizerOptions {
  model: string
  dtype?: KokoroDtype
  device?: KokoroDevice
}

/**
 * One instance per configuration, shared by every call.
 *
 * The checkpoint is small enough to load quickly but there is no reason to
 * hold it twice, and inference is single threaded anyway: two calls loading
 * their own copy would compete for the same cores while doubling the memory.
 */
const synthesizers = new SharedInstances<KokoroModel>()

export function loadSynthesizer(
  options: SynthesizerOptions
): Promise<KokoroModel> {
  return synthesizers.load(
    [options.model, options.dtype ?? null, options.device ?? null],
    () =>
      KokoroModel.from_pretrained(options.model, {
        dtype: options.dtype,
        device: options.device,
      })
  )
}

/**
 * Synthesizes one short word to pay the first-inference cost up front, before
 * the assistant has anything to say.
 */
export async function warmupSynthesizer(
  options: SynthesizerOptions,
  voice: string
): Promise<void> {
  const synthesizer = await loadSynthesizer(options)
  await synthesizer.generate('Hello.', { voice: voice as never })
}
