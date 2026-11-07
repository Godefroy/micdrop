import {
  createDownloadCache,
  LazySession,
  SileroModel,
  SILERO_SAMPLE_RATE,
} from '@micdrop/client'
import * as ort from 'onnxruntime-web'
import { queueOnnxRun } from './onnxQueue'

/** Where the model is fetched from, when the app does not provide it */
export const DEFAULT_SILERO_MODEL_URL =
  'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/silero_vad_v5.onnx'

// onnxruntime-web@1.23 is not hosted on jsdelivr (its dist exceeds the CDN size
// limit, so every file 404s). unpkg serves it, so the wasm backend comes from
// there instead.
const DEFAULT_WASM_PATH = 'https://unpkg.com/onnxruntime-web@1.23.2/dist/'

export interface OnnxSileroOptions {
  /** Address of the Silero v5 model, or the bytes of it */
  model?: string | ArrayBuffer
  /**
   * Where the ONNX runtime loads its WebAssembly files from. `false` leaves
   * them to the runtime, which finds them next to itself once a bundler has
   * emitted them, as the `@micdrop/web/vite` plugin does.
   */
  wasmPath?: string | false
}

// A couple of megabytes for each address, fetched once per page
const fetchModel = createDownloadCache(async (url): Promise<ArrayBuffer> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Could not load the Silero model from ${url} (${response.status})`
    )
  }
  return response.arrayBuffer()
})

/**
 * Runs the Silero model in the browser, on the ONNX WebAssembly runtime.
 *
 * The state machine that turns its answers into turns lives in
 * `@micdrop/client`, this only scores windows of audio. Once released, the
 * model is done with: create a new one to load it again.
 */
export class OnnxSileroModel implements SileroModel {
  private session = new LazySession('Silero', () => this.createSession())
  private state: ort.Tensor
  private sampleRate: ort.Tensor

  constructor(private options: OnnxSileroOptions = {}) {
    this.state = newState()
    this.sampleRate = new ort.Tensor('int64', [BigInt(SILERO_SAMPLE_RATE)])
  }

  async load() {
    await this.session.get()
  }

  private async createSession(): Promise<ort.InferenceSession> {
    const wasmPath = this.options.wasmPath ?? DEFAULT_WASM_PATH
    if (wasmPath !== false) {
      ort.env.wasm.wasmPaths = wasmPath
    }

    const source = this.options.model ?? DEFAULT_SILERO_MODEL_URL
    const bytes = typeof source === 'string' ? await fetchModel(source) : source
    return ort.InferenceSession.create(bytes)
  }

  async process(frame: Float32Array): Promise<number> {
    return this.session.use((session) =>
      queueOnnxRun(async () => {
        const output = await session.run({
          input: new ort.Tensor('float32', frame, [1, frame.length]),
          state: this.state,
          sr: this.sampleRate,
        })
        // Carried over before the next window takes its turn, which reads it
        this.state = output.stateN as ort.Tensor
        return (output.output.data as Float32Array)[0]
      })
    )
  }

  reset() {
    this.state = newState()
  }

  async release() {
    await this.session.release()
  }
}

/** The memory the model carries from one window to the next, emptied */
function newState(): ort.Tensor {
  return new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128])
}
