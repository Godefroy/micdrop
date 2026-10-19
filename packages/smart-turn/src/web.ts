import * as ort from 'onnxruntime-web'
import { FEATURE_SHAPE, setSmartTurnModelLoader, SmartTurnModel } from './model'
import { queueOnnxRun } from './queue'

/** Where the checkpoints are published */
const BASE_URL = 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main'

/**
 * The full precision checkpoint, thirty megabytes. Quantised weights are not
 * supported by the WebGPU backend, so this is the one the graphics path needs,
 * and it is also the more accurate of the two.
 */
export const WEBGPU_MODEL_URL = `${BASE_URL}/smart-turn-v3.2-gpu.onnx`

/** The quantised checkpoint, eight megabytes, for the WebAssembly path */
export const WASM_MODEL_URL = `${BASE_URL}/smart-turn-v3.2-cpu.onnx`

// onnxruntime-web is not hosted on jsdelivr (its dist exceeds the CDN size
// limit), so the WebAssembly backend comes from unpkg instead.
const DEFAULT_WASM_PATH = 'https://unpkg.com/onnxruntime-web@1.23.2/dist/'

export interface OnnxSmartTurnOptions {
  /** Address of the checkpoint, or the bytes of it */
  model?: string | ArrayBuffer
  /** Which backend runs it, taken from what the browser offers by default */
  executionProvider?: 'webgpu' | 'wasm'
  /**
   * Where the ONNX runtime loads its WebAssembly files from. `false` leaves
   * them to the runtime, which finds them next to itself once a bundler has
   * emitted them, as the `@micdrop/web/vite` plugin does.
   */
  wasmPath?: string | false
}

/**
 * Runs Smart Turn in the browser.
 *
 * The graphics card answers in about thirty milliseconds whatever the device,
 * where WebAssembly takes two hundred on a laptop and more than a second on a
 * slow phone, so WebGPU is used whenever the browser offers it.
 */
export class OnnxSmartTurnModel implements SmartTurnModel {
  private session: ort.InferenceSession | undefined

  constructor(private options: OnnxSmartTurnOptions = {}) {}

  /** Which backend this model runs on */
  get executionProvider(): 'webgpu' | 'wasm' {
    return (
      this.options.executionProvider ??
      (typeof navigator !== 'undefined' && 'gpu' in navigator
        ? 'webgpu'
        : 'wasm')
    )
  }

  async load() {
    if (this.session) return

    const provider = this.executionProvider
    const wasmPath = this.options.wasmPath ?? DEFAULT_WASM_PATH
    if (wasmPath !== false) {
      ort.env.wasm.wasmPaths = wasmPath
    }
    ort.env.logLevel = 'error'

    const source =
      this.options.model ??
      (provider === 'webgpu' ? WEBGPU_MODEL_URL : WASM_MODEL_URL)
    const bytes = typeof source === 'string' ? await fetchModel(source) : source

    this.session = await ort.InferenceSession.create(bytes, {
      executionProviders: [provider],
      graphOptimizationLevel: 'all',
    })
  }

  async predict(features: Float32Array): Promise<number> {
    if (!this.session) await this.load()
    const outputs = await queueOnnxRun(() =>
      this.session!.run({
        input_features: new ort.Tensor('float32', features, [...FEATURE_SHAPE]),
      })
    )
    return Number(Object.values(outputs)[0].data[0])
  }

  async release() {
    await this.session?.release()
    this.session = undefined
  }
}

async function fetchModel(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Could not load the Smart Turn model from ${url} (${response.status})`
    )
  }
  return response.arrayBuffer()
}

let options: OnnxSmartTurnOptions = {}

/**
 * Says where the model comes from, to serve it from your own domain rather
 * than from a public one, or to hand over its bytes directly. Merged into the
 * options already set, so it keeps what the `@micdrop/web/vite` plugin chose.
 * @param next - Address or bytes of the model, and of the ONNX runtime
 */
export function setSmartTurnOptions(next: OnnxSmartTurnOptions) {
  options = { ...options, ...next }
}

// The ONNX runtime weighs more than the rest of this package put together, so
// it only enters the bundle of an app that imports this file
setSmartTurnModelLoader(async () => {
  const model = new OnnxSmartTurnModel(options)
  await model.load()
  return model
})
