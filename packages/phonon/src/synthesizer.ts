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
 * Ready while its worker runs. Dead once the worker crashed or exited: every
 * pending sentence was rejected with that error, and so is every later one.
 */
type SynthesizerState = { status: 'ready' } | { status: 'dead'; error: Error }

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
  private state: SynthesizerState = { status: 'ready' }

  private constructor(
    private readonly worker: Worker,
    /** Model files, voices of the model folder included. */
    readonly files: ModelFiles,
    readonly sampleRate: number,
    /** Languages the model was trained for, as its config lists them. */
    readonly languages: string[],
    // Called once when the worker dies, so the cache forgets this instance
    private readonly onDeath: () => void
  ) {
    worker.on('message', (message: WorkerReply) => this.handleReply(message))
    // A worker that crashes (out of memory, a panic in the module) or exits
    // would otherwise leave every pending sentence waiting forever
    worker.on('error', (error) => this.die(error))
    worker.on('exit', (code) =>
      this.die(new Error(`Phonon worker exited with code ${code}`))
    )
    // The shared instance lives as long as the process, it must not keep it
    // up. Done once the listeners are on, since adding one refs the worker
    // again.
    worker.unref()
  }

  static async load(
    options: SynthesizerOptions,
    onDeath: () => void = () => {}
  ): Promise<Synthesizer> {
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
      // The loading listeners go away once settled, the synthesizer puts its
      // own on, so a later error is not swallowed by this promise
      const settle = () => {
        worker.off('message', handleReady)
        worker.off('error', handleError)
        worker.off('exit', handleExit)
      }
      const handleReady = (message: WorkerReply) => {
        if (message.type === 'ready') {
          settle()
          resolve(
            new Synthesizer(
              worker,
              files,
              message.sampleRate,
              message.languages,
              onDeath
            )
          )
        } else if (message.type === 'loadFailed') {
          settle()
          worker.terminate()
          reject(new Error(`Phonon failed to load: ${message.message}`))
        }
      }
      const handleError = (error: Error) => {
        settle()
        reject(error)
      }
      const handleExit = (code: number) => {
        settle()
        reject(
          new Error(`Phonon worker exited with code ${code} while loading`)
        )
      }
      worker.on('message', handleReady)
      worker.on('error', handleError)
      worker.on('exit', handleExit)
    })
  }

  /** Generates one sentence, handing its frames over as they come. */
  generate(options: GenerateOptions): Promise<void> {
    if (this.state.status === 'dead') return Promise.reject(this.state.error)
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
    if (this.state.status === 'dead') return
    this.worker.postMessage(message)
  }

  /**
   * Rejects every pending sentence and makes the cache load a new worker.
   *
   * An error event is followed by an exit event, only the first one counts.
   */
  private die(error: Error) {
    if (this.state.status === 'dead') return
    this.state = { status: 'dead', error }
    console.error('[PhononTTS] Worker died:', error)
    const generations = [...this.generations.values()]
    this.generations.clear()
    for (const generation of generations) generation.reject(error)
    this.worker.terminate().catch(() => {})
    this.onDeath()
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
  const key = [
    options.model,
    options.language,
    options.quant ?? null,
    options.rewrites ?? null,
    options.conditions ?? null,
    options.hub.cacheDir ?? null,
  ]
  const loading: Promise<Synthesizer> = synthesizers.load(key, () =>
    Synthesizer.load(options, () => {
      // The call after a crash loads a new worker instead of getting the dead
      // one back. A newer worker under the same key is left alone.
      if (synthesizers.get(key) === loading) synthesizers.delete(key)
    })
  )
  return loading
}
