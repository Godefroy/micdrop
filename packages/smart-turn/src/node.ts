import fs from 'node:fs/promises'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { LazySession } from './lazySession'
import { FEATURE_SHAPE, setSmartTurnModelLoader, SmartTurnModel } from './model'

const BASE_URL = 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main'

/** The quantised checkpoint, the quicker of the two on a processor */
export const QUANTISED_MODEL_URL = `${BASE_URL}/smart-turn-v3.2-cpu.onnx`

/** The full precision checkpoint, a couple of points more accurate */
export const FULL_MODEL_URL = `${BASE_URL}/smart-turn-v3.2-gpu.onnx`

export interface NodeSmartTurnOptions {
  /** Path or address of the checkpoint, or the bytes of it */
  model?: string | ArrayBuffer
  /** How many cores one inference may use */
  threads?: number
}

/**
 * Runs Smart Turn on a server.
 *
 * A single core answers in about forty milliseconds and four cores in fifteen,
 * against the several hundred milliseconds and the tokens an agent spends when
 * it is asked the same question in words.
 *
 * Once released, the model is done with: create a new one to load it again.
 */
export class NodeSmartTurnModel implements SmartTurnModel {
  private session = new LazySession('Smart Turn', () => this.createSession())

  constructor(private options: NodeSmartTurnOptions = {}) {}

  async load() {
    await this.session.get()
  }

  private async createSession(): Promise<InferenceSession> {
    const source = this.options.model ?? QUANTISED_MODEL_URL
    let bytes: ArrayBuffer | Uint8Array
    if (typeof source !== 'string') {
      bytes = source
    } else if (/^https?:\/\//.test(source)) {
      const response = await fetch(source)
      if (!response.ok) {
        throw new Error(
          `Could not load the Smart Turn model from ${source} (${response.status})`
        )
      }
      bytes = await response.arrayBuffer()
    } else {
      bytes = await fs.readFile(source)
    }

    return InferenceSession.create(bytes as Uint8Array, {
      executionMode: 'sequential',
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
      // Left to the runtime unless the caller says otherwise
      ...(this.options.threads
        ? { intraOpNumThreads: this.options.threads }
        : {}),
    })
  }

  async predict(features: Float32Array): Promise<number> {
    const outputs = await this.session.use((session) =>
      session.run({
        input_features: new Tensor('float32', features, [...FEATURE_SHAPE]),
      })
    )
    return Number(Object.values(outputs)[0].data[0])
  }

  async release() {
    await this.session.release()
  }
}

let options: NodeSmartTurnOptions = {}

/**
 * Says where the model comes from, a local file for instance so a server never
 * reaches out at boot.
 * @param next - Path, address or bytes of the model
 */
export function setSmartTurnOptions(next: NodeSmartTurnOptions) {
  options = next
}

setSmartTurnModelLoader(async () => {
  const model = new NodeSmartTurnModel(options)
  await model.load()
  return model
})
