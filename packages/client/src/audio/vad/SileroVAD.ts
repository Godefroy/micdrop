import { MicdropStorageKeys, storage } from '../../storage'
import { concatFloat32, resample } from '../pcm'
import { MicSource } from '../types'
import { VAD, VADStatus } from './VAD'

/** Rate and window the Silero v5 model expects */
export const SILERO_SAMPLE_RATE = 16000
export const SILERO_FRAME_SAMPLES = 512
const MS_PER_FRAME = (SILERO_FRAME_SAMPLES / SILERO_SAMPLE_RATE) * 1000 // 32 ms

/**
 * One loaded Silero model, whichever runtime holds it.
 *
 * `@micdrop/web` runs it with onnxruntime-web and `@micdrop/react-native` with
 * onnxruntime-react-native. Both answer the same question: how likely is it
 * that these 512 samples are speech.
 */
export interface SileroModel {
  /**
   * Scores one window of audio
   * @param frame - 512 mono samples at 16 kHz, in the -1..1 range
   * @returns The probability that it is speech, between 0 and 1
   */
  process(frame: Float32Array): Promise<number>

  /** Forgets what came before, at the start of a new call */
  reset(): void

  /** Releases the runtime */
  release(): Promise<void>
}

/** Loads the model, which usually means fetching a couple of megabytes */
export type SileroModelLoader = () => Promise<SileroModel>

// See https://docs.vad.ricky0123.com/user-guide/algorithm/
export type SileroVADOptions = {
  /** Above this probability, the window counts as speech */
  positiveSpeechThreshold: number
  /** Below this probability, the window counts as silence */
  negativeSpeechThreshold: number
  /** Windows of speech needed before a turn is confirmed */
  minSpeechFrames: number
  /** Windows of silence tolerated inside a turn before it is closed */
  redemptionFrames: number
}

const defaultOptions: SileroVADOptions = {
  positiveSpeechThreshold: 0.18,
  negativeSpeechThreshold: 0.11,
  minSpeechFrames: 4,
  redemptionFrames: 8,
}

let loadModel: SileroModelLoader | undefined

/**
 * Says how the Silero model is loaded on this platform. Called by
 * `@micdrop/web` and `@micdrop/react-native` when they are imported.
 * @param loader - Loads and returns a ready to use model
 */
export function setSileroModelLoader(loader: SileroModelLoader) {
  loadModel = loader
}

/**
 * Voice activity detection with the Silero model.
 *
 * It hears the difference between a voice and a noise, where
 * {@link VolumeVAD} only hears how loud the room is. The model itself is
 * loaded by the platform package, everything else runs the same everywhere.
 *
 * @see https://github.com/snakers4/silero-vad
 */
export class SileroVAD extends VAD {
  public readonly name = 'SileroVAD'
  public options = defaultOptions

  // The model decides on the first window it hears speech in, so it is quick.
  // The reserve still covers a few windows, since scoring runs asynchronously
  // and may lag behind the audio on a busy device.
  public delay = 3 * MS_PER_FRAME // about 100 ms

  private model: SileroModel | undefined
  private mic: MicSource | undefined
  private _isPaused = false
  private buffer: Float32Array[] = []
  private bufferLength = 0
  private bufferRate = SILERO_SAMPLE_RATE
  private speaking = false
  private speechFrames = 0
  private silenceFrames = 0
  private processing = false
  // Bumped whenever the state is reset, so a window scored before that is
  // dropped rather than reopening a turn
  private round = 0

  constructor(options?: Partial<SileroVADOptions>) {
    super()

    if (options) {
      this.setOptions(options)
    } else {
      const saved = storage.getItem(MicdropStorageKeys.SileroVADOptions)
      try {
        this.setOptions(saved ? JSON.parse(saved) : {})
      } catch {
        this.setOptions({})
      }
    }
  }

  get isStarted(): boolean {
    return !!this.mic
  }

  get isPaused(): boolean {
    return this._isPaused
  }

  async start(mic: MicSource): Promise<void> {
    if (this.mic) return
    if (!loadModel) {
      throw new Error(
        "No Silero model. Add `import '@micdrop/web/silero'` in a browser or `import '@micdrop/react-native/silero'` on a phone, or call setSileroModelLoader()."
      )
    }

    this.model = await loadModel()
    this.resetState()
    // A call starts in silence, whatever the previous one ended on
    this.setStatus(VADStatus.Silence)
    this.mic = mic
    mic.on('Frames', this.onFrames)
  }

  async stop(): Promise<void> {
    this.mic?.off('Frames', this.onFrames)
    this.mic = undefined
    this.closeOpenTurn()
    this.resetState()
    await this.model?.release()
    this.model = undefined
  }

  async pause(): Promise<void> {
    if (this._isPaused) return
    this._isPaused = true
    this.closeOpenTurn()
    this.resetState()
  }

  async resume(): Promise<void> {
    this._isPaused = false
  }

  setOptions(options: Partial<SileroVADOptions>) {
    this.options = { ...this.options, ...options }
    storage.setItem(
      MicdropStorageKeys.SileroVADOptions,
      JSON.stringify(this.options)
    )
  }

  resetOptions() {
    this.setOptions(defaultOptions)
  }

  private onFrames = (frames: Float32Array, sampleRate: number) => {
    if (this._isPaused || !this.model) return

    if (sampleRate !== this.bufferRate) {
      this.buffer = []
      this.bufferLength = 0
      this.bufferRate = sampleRate
    }

    this.buffer.push(frames)
    this.bufferLength += frames.length
    this.drain()
  }

  // The model is asynchronous, so windows are scored one after the other rather
  // than raced: its answer for a window depends on the ones before it.
  private async drain() {
    if (this.processing) return
    this.processing = true

    try {
      const needed = Math.ceil(
        (SILERO_FRAME_SAMPLES * this.bufferRate) / SILERO_SAMPLE_RATE
      )

      while (this.bufferLength >= needed && this.model && !this._isPaused) {
        const gathered = concatFloat32(this.buffer)
        const window = gathered.subarray(0, needed)
        const rest = gathered.subarray(needed)
        this.buffer = rest.length ? [rest] : []
        this.bufferLength = rest.length

        const frame = resample(window, this.bufferRate, SILERO_SAMPLE_RATE)
        const round = this.round
        const probability = await this.model.process(
          frame.length === SILERO_FRAME_SAMPLES
            ? frame
            : fit(frame, SILERO_FRAME_SAMPLES)
        )
        // Stopped or paused while the window was being scored. Its speech would
        // put the VAD back in a turn nobody listens to any more, and that stale
        // status would keep the next call from ever going silent.
        if (round !== this.round) break
        this.onProbability(probability)
      }
    } catch (error) {
      console.error('[Micdrop] Silero VAD failed', error)
    } finally {
      this.processing = false
    }
  }

  // Ported from the reference implementation of the algorithm
  // https://docs.vad.ricky0123.com/user-guide/algorithm/
  private onProbability(probability: number) {
    const { positiveSpeechThreshold, negativeSpeechThreshold } = this.options

    if (probability >= positiveSpeechThreshold) {
      // Speech, so whatever silence came before was part of the sentence
      this.silenceFrames = 0
      this.speechFrames++

      if (!this.speaking) {
        this.speaking = true
        this.emit('StartSpeaking')
      }
      if (this.speechFrames === this.options.minSpeechFrames) {
        this.emit('ConfirmSpeaking')
      }
      return
    }

    if (probability < negativeSpeechThreshold && this.speaking) {
      this.silenceFrames++
      if (this.silenceFrames < this.options.redemptionFrames) return

      // Long enough to be the end of the turn rather than a pause between words
      const confirmed = this.speechFrames >= this.options.minSpeechFrames
      this.speaking = false
      this.speechFrames = 0
      this.silenceFrames = 0
      this.emit(confirmed ? 'StopSpeaking' : 'CancelSpeaking')
    }
  }

  private closeOpenTurn() {
    if (!this.speaking) return
    const confirmed = this.speechFrames >= this.options.minSpeechFrames
    this.emit(confirmed ? 'StopSpeaking' : 'CancelSpeaking')
  }

  private resetState() {
    this.round++
    this.model?.reset()
    this.buffer = []
    this.bufferLength = 0
    this.speaking = false
    this.speechFrames = 0
    this.silenceFrames = 0
  }
}

/** Pads or trims a window to the exact length the model wants */
function fit(frame: Float32Array, length: number): Float32Array {
  if (frame.length === length) return frame
  const fitted = new Float32Array(length)
  fitted.set(frame.subarray(0, length))
  return fitted
}
