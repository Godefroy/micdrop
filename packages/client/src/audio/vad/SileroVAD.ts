import { MicVAD } from '@ricky0123/vad-web'
import { LocalStorageKeys } from '../utils/localStorage'
import { VAD } from './VAD'

// See https://docs.vad.ricky0123.com/user-guide/algorithm/
export type SileroVADOptions = {
  positiveSpeechThreshold: number
  negativeSpeechThreshold: number
  minSpeechFrames: number
  redemptionFrames: number
}

const defaultOptions: SileroVADOptions = {
  positiveSpeechThreshold: 0.18,
  negativeSpeechThreshold: 0.11,
  minSpeechFrames: 8,
  redemptionFrames: 20,
}

/**
 * Silero VAD
 * @see https://github.com/ricky0123/vad
 */
export class SileroVAD extends VAD {
  public readonly name = 'SileroVAD'
  public options = defaultOptions
  private vad: MicVAD | undefined
  private _isPaused = false

  constructor(options?: Partial<SileroVADOptions>) {
    super()

    if (options) {
      this.setOptions(options)
    } else {
      const savedOptions = localStorage.getItem(
        LocalStorageKeys.SileroVADOptions
      )
      try {
        this.setOptions(savedOptions ? JSON.parse(savedOptions) : {})
      } catch (error) {
        this.setOptions({})
      }
    }
  }

  get isStarted(): boolean {
    return !!this.vad
  }

  get isPaused(): boolean {
    return this._isPaused
  }

  async start(stream: MediaStream): Promise<void> {
    if (this.vad) return

    this.vad = await MicVAD.new({
      getStream: async () => stream,
      pauseStream: async () => {},
      resumeStream: async () => stream,
      model: 'v5',
      submitUserSpeechOnPause: true,
      baseAssetPath:
        'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@latest/dist/',
      onnxWASMBasePath:
        'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/',
      onSpeechStart: () => {
        this.emit('StartSpeaking')
      },
      onSpeechRealStart: () => {
        this.emit('ConfirmSpeaking')
      },
      onVADMisfire: () => {
        this.emit('CancelSpeaking')
      },
      onSpeechEnd: () => {
        this.emit('StopSpeaking')
      },
      ...this.options,
    })

    this.vad.start()
  }

  async stop(): Promise<void> {
    if (!this.vad) return
    this.vad.destroy()
    this.vad = undefined
  }

  async pause(): Promise<void> {
    if (!this.vad || this._isPaused) return
    this._isPaused = true
    this.vad.pause()
  }

  async resume(): Promise<void> {
    if (!this.vad || !this._isPaused) return
    this._isPaused = false
    this.vad.start()
  }

  setOptions(options: Partial<SileroVADOptions>) {
    this.options = { ...this.options, ...options }
    this.vad?.setOptions(this.options)

    // Save to local storage
    localStorage.setItem(
      LocalStorageKeys.SileroVADOptions,
      JSON.stringify(this.options)
    )
  }

  resetOptions() {
    this.setOptions(defaultOptions)
  }
}
