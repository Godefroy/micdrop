import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { createDownloadCache, LazySession } from './lazySession'
import { FEATURE_SHAPE, setSmartTurnModelLoader, SmartTurnModel } from './model'

const BASE_URL = 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main'

/**
 * The quantised checkpoint, eight megabytes.
 *
 * A phone runs the model on its own processor through the native runtime, so
 * the smaller weights are both the lighter download and the quicker answer.
 */
export const QUANTISED_MODEL_URL = `${BASE_URL}/smart-turn-v3.2-cpu.onnx`

/** The full precision checkpoint, thirty megabytes and a couple of points more accurate */
export const FULL_MODEL_URL = `${BASE_URL}/smart-turn-v3.2-gpu.onnx`

export interface NativeSmartTurnOptions {
  /**
   * Where the checkpoint comes from: an address to fetch it from, a file
   * already on the device, or its bytes.
   */
  model?: string | Uint8Array

  /**
   * Which backends the runtime may use, in order of preference.
   *
   * The processor handles it on its own, so leave this alone unless you have
   * measured that `nnapi` or `coreml` helps on the devices you ship to.
   */
  executionProviders?: string[]
}

/**
 * Runs Smart Turn on a phone, on the native ONNX runtime.
 *
 * The features it reads are built in Javascript while the speaker talks, one
 * short transform every ten milliseconds, so the phone has almost nothing left
 * to do when the sentence ends.
 *
 * Once released, the model is done with: create a new one to load it again.
 */
export class NativeSmartTurnModel implements SmartTurnModel {
  private session = new LazySession('Smart Turn', () => this.createSession())

  constructor(private options: NativeSmartTurnOptions = {}) {}

  async load() {
    await this.session.get()
  }

  private async createSession(): Promise<InferenceSession> {
    const source = this.options.model ?? QUANTISED_MODEL_URL
    const sessionOptions = this.options.executionProviders
      ? { executionProviders: this.options.executionProviders }
      : undefined

    if (typeof source === 'string' && !source.startsWith('http')) {
      // A file already on the device, the runtime reads it itself
      return InferenceSession.create(source, sessionOptions)
    }

    if (typeof source === 'string') {
      return InferenceSession.create(await fetchModel(source), sessionOptions)
    }

    return InferenceSession.create(source, sessionOptions)
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

// Eight megabytes for each address, fetched once and kept for as long as the
// app runs
const fetchModel = createDownloadCache(async (url): Promise<Uint8Array> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Could not load the Smart Turn model from ${url} (${response.status})`
    )
  }
  return new Uint8Array(await response.arrayBuffer())
})

let options: NativeSmartTurnOptions = {}

/**
 * Says where the model comes from, to ship it with the app rather than
 * fetching it on the first call.
 * @param next - Address, file or bytes of the model
 */
export function setSmartTurnOptions(next: NativeSmartTurnOptions) {
  options = next
}

// The native ONNX runtime adds a good chunk to the app, so it is only linked
// in when this file is imported
setSmartTurnModelLoader(async () => {
  const model = new NativeSmartTurnModel(options)
  await model.load()
  return model
})
