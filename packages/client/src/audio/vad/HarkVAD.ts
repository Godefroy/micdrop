import hark, { Harker } from 'hark'
import { VAD } from './VAD'

export type HarkVADOptions = {
  threshold: number
}

const defaultOptions: HarkVADOptions = {
  threshold: 0.5,
}

/**
 * Hark VAD
 * @see https://github.com/otalk/hark
 */
export class HarkVAD extends VAD {
  public readonly name = 'HarkVAD'
  public options = defaultOptions
  private hark: Harker | undefined
  private _isPaused = false

  constructor(options: Partial<HarkVADOptions> = {}) {
    super()
    this.setOptions(options)
  }

  get isStarted(): boolean {
    return !!this.hark
  }

  get isPaused(): boolean {
    return this._isPaused
  }

  async start(stream: MediaStream): Promise<void> {
    if (this.hark) return

    this.hark = hark(stream, {
      interval: this.delay,
      play: false,
      threshold: this.options.threshold,
    })

    this.hark.on('speaking', () => {
      this.emit('StartSpeaking')
      this.emit('ConfirmSpeaking')
    })
    this.hark.on('stopped_speaking', () => this.emit('StopSpeaking'))
  }

  async stop(): Promise<void> {
    if (!this.hark) return

    // @ts-ignore - hark types are incorrect
    this.hark.off('speaking', () => this.emit('StartSpeaking'))
    // @ts-ignore - hark types are incorrect
    this.hark.off('stopped_speaking', () => this.emit('StopSpeaking'))
    this.hark.stop()
    this.hark = undefined
  }

  async pause(): Promise<void> {
    if (!this.hark || this._isPaused) return
    this._isPaused = true
    this.hark.suspend()
  }

  async resume(): Promise<void> {
    if (!this.hark || !this._isPaused) return
    this._isPaused = false
    this.hark.resume()
  }

  async setOptions(options: Partial<HarkVADOptions>): Promise<void> {
    this.options = { ...this.options, ...options }
    this.hark?.setThreshold(this.options.threshold)
  }
}
