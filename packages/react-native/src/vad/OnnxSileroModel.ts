import {
  createDownloadCache,
  LazySession,
  SILERO_SAMPLE_RATE,
  SileroModel,
} from '@micdrop/client'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'

/** Where the model is fetched from, when the app does not provide it */
export const DEFAULT_SILERO_MODEL_URL =
  'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/silero_vad_v5.onnx'

export interface OnnxSileroOptions {
  /**
   * Where the Silero v5 model comes from: an address to fetch it from, a file
   * already on the device, or its bytes.
   */
  model?: string | Uint8Array
}

/**
 * Runs the Silero model on a phone, on the native ONNX runtime.
 *
 * The state machine that turns its answers into turns lives in
 * `@micdrop/client`, this only scores windows of audio. Once released, the
 * model is done with: create a new one to load it again.
 */
export class OnnxSileroModel implements SileroModel {
  private session = new LazySession('Silero', () => this.createSession())
  // Each window reads the memory the previous one left, so they are scored one
  // after the other even when the caller asks for several at once
  private runs: Promise<unknown> = Promise.resolve()
  private state: Tensor
  private sampleRate: Tensor

  constructor(private options: OnnxSileroOptions = {}) {
    this.state = newState()
    this.sampleRate = new Tensor('int64', [BigInt(SILERO_SAMPLE_RATE)])
  }

  async load() {
    await this.session.get()
  }

  private async createSession(): Promise<InferenceSession> {
    const source = this.options.model ?? DEFAULT_SILERO_MODEL_URL

    if (typeof source === 'string' && !source.startsWith('http')) {
      // A file already on the device, the runtime reads it itself
      return InferenceSession.create(source)
    }

    if (typeof source === 'string') {
      return InferenceSession.create(await fetchModel(source))
    }

    return InferenceSession.create(source)
  }

  async process(frame: Float32Array): Promise<number> {
    return this.session.use((session) => {
      const run = async () => {
        const output = await session.run({
          input: new Tensor('float32', frame, [1, frame.length]),
          state: this.state,
          sr: this.sampleRate,
        })
        this.state = output.stateN as Tensor
        return (output.output.data as Float32Array)[0]
      }
      const started = this.runs.then(run, run)
      // A failed window still lets the next one through
      this.runs = started.catch(() => undefined)
      return started
    })
  }

  reset() {
    this.state = newState()
  }

  async release() {
    await this.session.release()
  }
}

// Two megabytes for each address, fetched once and kept for as long as the app
// runs
const fetchModel = createDownloadCache(async (url): Promise<Uint8Array> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Could not load the Silero model from ${url} (${response.status})`
    )
  }
  return new Uint8Array(await response.arrayBuffer())
})

/** The memory the model carries from one window to the next, emptied */
function newState(): Tensor {
  return new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128])
}
