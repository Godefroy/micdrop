import { SharedInstances } from '@micdrop/server'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { downloadHubModel, HubOptions, parseHubModel } from './hub'
import { ModelFiles, resolveModelFiles } from './modelFiles'
import type {
  PhononLanguage,
  PhononQuant,
  WorkerData,
  WorkerReply,
  WorkerRequest,
} from './protocol'

export interface SynthesizerOptions {
  /** `hf://owner/name[@revision]` or the path to a model folder. */
  model: string
  language: PhononLanguage
  quant?: PhononQuant
  rewrites?: string
  conditions?: string[]
  hub: HubOptions
}

export interface GenerateOptions {
  voicePath: string
  text: string
  temperature: number
  seed: number
  // Returns false to stop the generation, the utterance being cancelled
  onAudio: (samples: Float32Array) => boolean
  signal?: AbortSignal
}

const DEFAULT_QUANT: PhononQuant = 'q8'
const WORKER_PATH = join(__dirname, 'worker.mjs')

interface Generation {
  onAudio: GenerateOptions['onAudio']
  resolve: () => void
  reject: (error: Error) => void
}

/**
 * The model, loaded on a worker thread of its own.
 *
 * Sentences are generated one after the other, in the order they were asked
 * for, whichever call they come from: the module runs on a single thread, so
 * two generations at once would only share it.
 */
export class Synthesizer {
  private counter = 0
  private generations = new Map<number, Generation>()

  private constructor(
    private readonly worker: Worker,
    /** Model files, voices of the model folder included. */
    readonly files: ModelFiles,
    readonly sampleRate: number,
    /** Languages the model was trained for, as its config lists them. */
    readonly languages: string[]
  ) {
    worker.on('message', (message: WorkerReply) => this.handleReply(message))
    // The shared instance lives as long as the process, it must not keep it
    // up. Done once the listeners are on, since adding one refs the worker
    // again.
    worker.unref()
  }

  static async load(options: SynthesizerOptions): Promise<Synthesizer> {
    const quant = options.quant ?? DEFAULT_QUANT
    const modelDir = parseHubModel(options.model)
      ? await downloadHubModel(options.model, quant, options.hub)
      : options.model
    const files = resolveModelFiles(modelDir, quant)

    const workerData: WorkerData = {
      weights: files.weights,
      tokenizer: files.tokenizer,
      config: files.config,
      quant,
      language: options.language,
      rewrites: options.rewrites,
      conditions: options.conditions,
    }
    const worker = new Worker(WORKER_PATH, { workerData })

    return new Promise((resolve, reject) => {
      const handleReady = (message: WorkerReply) => {
        if (message.type === 'ready') {
          worker.off('message', handleReady)
          resolve(
            new Synthesizer(
              worker,
              files,
              message.sampleRate,
              message.languages
            )
          )
        } else if (message.type === 'loadFailed') {
          worker.terminate()
          reject(new Error(`Phonon failed to load: ${message.message}`))
        }
      }
      worker.on('message', handleReady)
      worker.once('error', reject)
    })
  }

  /** Generates one sentence, handing its frames over as they come. */
  generate(options: GenerateOptions): Promise<void> {
    const id = ++this.counter
    const { signal } = options
    if (signal?.aborted) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      let stopped = false
      const cancel = () => {
        if (stopped) return
        stopped = true
        this.send({ type: 'cancel', id })
      }
      signal?.addEventListener('abort', cancel, { once: true })

      this.generations.set(id, {
        onAudio: (samples) => {
          // Frames already on their way when the cancel was sent
          if (stopped) return false
          if (options.onAudio(samples)) return true
          cancel()
          return false
        },
        resolve: () => {
          signal?.removeEventListener('abort', cancel)
          resolve()
        },
        reject: (error) => {
          signal?.removeEventListener('abort', cancel)
          reject(error)
        },
      })

      this.send({
        type: 'generate',
        id,
        voicePath: options.voicePath,
        text: options.text,
        temperature: options.temperature,
        seed: options.seed,
      })
    })
  }

  private send(message: WorkerRequest) {
    this.worker.postMessage(message)
  }

  private handleReply(message: WorkerReply) {
    if (!('id' in message)) return
    const generation = this.generations.get(message.id)
    if (!generation) return

    switch (message.type) {
      case 'audio':
        generation.onAudio(message.samples)
        break
      case 'failed':
        this.generations.delete(message.id)
        generation.reject(new Error(message.message))
        break
      case 'done':
        this.generations.delete(message.id)
        generation.resolve()
        break
    }
  }
}

/**
 * One worker per configuration, shared by every call.
 *
 * The language is part of it because the module normalizes text with the
 * rules it was built with.
 */
const synthesizers = new SharedInstances<Synthesizer>()

export function loadSynthesizer(
  options: SynthesizerOptions
): Promise<Synthesizer> {
  return synthesizers.load(
    [
      options.model,
      options.language,
      options.quant ?? null,
      options.rewrites ?? null,
      options.conditions ?? null,
      options.hub.cacheDir ?? null,
    ],
    () => Synthesizer.load(options)
  )
}
