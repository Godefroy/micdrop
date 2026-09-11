import { SharedInstances } from '@micdrop/server'
import { existsSync } from 'fs'
import sherpa, { type OfflineTts, type Wave } from 'sherpa-onnx-node'
import { resolveModelFiles } from './modelFiles'

export interface SynthesizerOptions {
  modelDir: string
  numThreads?: number
  provider?: string
  debug?: boolean
}

const DEFAULT_NUM_THREADS = 2
const DEFAULT_PROVIDER = 'cpu'
// Voices already turned into an embedding, kept by the addon between calls
const VOICE_CACHE_CAPACITY = 10

/**
 * One instance per configuration, shared by every call.
 *
 * The weights weigh close to two hundred megabytes, so holding a second copy
 * for a second call would cost more memory than the language model it sits
 * next to. Inference is bound to a couple of threads anyway, and two calls
 * generating at once compete for the same cores whether they share the model
 * or not.
 */
const synthesizers = new SharedInstances<OfflineTts>()

export function loadSynthesizer(
  options: SynthesizerOptions
): Promise<OfflineTts> {
  return synthesizers.load(
    [
      options.modelDir,
      options.numThreads ?? null,
      options.provider ?? null,
      options.debug ?? null,
    ],
    // createAsync loads the graphs on a worker thread, so setting a call up
    // does not hold the event loop for the half second it takes
    () =>
      sherpa.OfflineTts.createAsync({
        model: {
          pocket: {
            ...resolveModelFiles(options.modelDir),
            voiceEmbeddingCacheCapacity: VOICE_CACHE_CAPACITY,
          },
          numThreads: options.numThreads ?? DEFAULT_NUM_THREADS,
          provider: options.provider ?? DEFAULT_PROVIDER,
          debug: options.debug ?? false,
        },
        // Sentences are already split upstream, one per synthesis
        maxNumSentences: 1,
      })
  )
}

/**
 * Reference voices read from disk, kept by path.
 *
 * The samples are handed to the addon on every sentence, which is where the
 * voice embedding gets cached, so what is saved here is only the file read.
 */
const voices = new Map<string, Wave>()

export function loadVoice(path: string): Wave {
  const existing = voices.get(path)
  if (existing) return existing

  if (!existsSync(path)) {
    throw new Error(`Pocket TTS reference voice not found: "${path}"`)
  }

  const wave = sherpa.readWave(path)
  voices.set(path, wave)
  return wave
}
