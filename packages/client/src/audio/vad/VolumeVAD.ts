import { MicdropStorageKeys, storage } from '../../storage'
import { MicSource } from '../types'
import { VAD, VADStatus } from './VAD'

export type VolumeVADOptions = {
  /** Number of recent samples kept to decide whether someone is speaking */
  history: number
  /** Level above which audio counts as speech, in decibels */
  threshold: number
}

const defaultOptions: VolumeVADOptions = {
  history: 5,
  threshold: -55,
}

/**
 * Volume based Voice Activity Detection.
 *
 * It follows the level reported by the microphone, and needs a few consecutive
 * loud samples before confirming speech, so a door slam or a keyboard click
 * does not start a turn.
 */
export class VolumeVAD extends VAD {
  public readonly name = 'VolumeVAD'
  public options = defaultOptions

  // The microphone reports a level about every 100 ms, and two consecutive loud
  // ones are needed before a turn opens. Speech can therefore begin up to two
  // reports before it is noticed. A quiet onset (a soft consonant, a word
  // spoken low) stays under the threshold for a while too, so the reserve adds
  // a margin: without it the first syllable of a sentence never reaches the
  // server.
  public delay = 500 // ms

  private mic: MicSource | undefined
  private running = false
  private _isPaused = false
  private speaking = false
  private attemptSpeaking = false
  private speakingHistory: number[] = []

  constructor(options?: Partial<VolumeVADOptions>) {
    super()

    if (options) {
      this.setOptions(options)
    } else {
      const saved = storage.getItem(MicdropStorageKeys.VolumeVADOptions)
      try {
        this.setOptions(saved ? JSON.parse(saved) : {})
      } catch {
        this.setOptions({})
      }
    }
  }

  get isStarted(): boolean {
    return this.running
  }

  get isPaused(): boolean {
    return this._isPaused
  }

  async start(mic: MicSource): Promise<void> {
    if (this.mic) return
    this.mic = mic
    mic.on('Volume', this.onVolume)
    this.running = !this._isPaused
  }

  async stop(): Promise<void> {
    this.mic?.off('Volume', this.onVolume)
    this.mic = undefined
    this.running = false
    this.reset()
  }

  async pause(): Promise<void> {
    if (this._isPaused) return
    this._isPaused = true
    this.running = false
    this.reset()
  }

  async resume(): Promise<void> {
    if (!this._isPaused) return
    this._isPaused = false
    this.running = !!this.mic
  }

  setOptions(options: Partial<VolumeVADOptions>) {
    if (typeof options.history === 'number' && options.history < 3) {
      throw new Error('History must be at least 3')
    }

    this.options = { ...this.options, ...options }

    // Adjust history
    while (this.speakingHistory.length > this.options.history) {
      this.speakingHistory.shift()
    }
    while (this.speakingHistory.length < this.options.history) {
      this.speakingHistory.push(0)
    }

    storage.setItem(
      MicdropStorageKeys.VolumeVADOptions,
      JSON.stringify(this.options)
    )
  }

  resetOptions() {
    this.setOptions(defaultOptions)
  }

  private onVolume = (volume: number) => {
    if (!this.running) return
    const isLoud = volume > this.options.threshold

    // Check if started speaking
    if (isLoud) {
      if (!this.speaking) {
        // Check recent history (last 3 samples)
        let recentHistory = 0
        for (
          let i = Math.max(0, this.speakingHistory.length - 3);
          i < this.speakingHistory.length;
          i++
        ) {
          recentHistory += this.speakingHistory[i]
        }

        if (recentHistory >= 2) {
          this.speaking = true
          this.attemptSpeaking = false
          this.emit('ConfirmSpeaking')
        } else if (recentHistory === 1 && !this.attemptSpeaking) {
          this.attemptSpeaking = true
          this.emit('StartSpeaking')
        }
      }
    }

    // Check if stopped speaking
    else if (this.speaking) {
      let totalHistory = 0
      for (let i = 0; i < this.speakingHistory.length; i++) {
        totalHistory += this.speakingHistory[i]
      }

      if (totalHistory === 0) {
        this.speaking = false
        this.emit('StopSpeaking')
      }
    }

    // Check if attempt has failed
    else if (this.attemptSpeaking) {
      const lastHistory = this.speakingHistory[this.speakingHistory.length - 1]

      if (lastHistory === 0) {
        this.attemptSpeaking = false
        this.emit('CancelSpeaking')
      }
    }

    // Update history
    this.speakingHistory.shift()
    this.speakingHistory.push(Number(isLoud))
  }

  private reset() {
    const status = this.status
    this.speaking = false
    this.attemptSpeaking = false
    for (let i = 0; i < this.speakingHistory.length; i++) {
      this.speakingHistory[i] = 0
    }

    switch (status) {
      case VADStatus.Speaking:
        this.emit('StopSpeaking')
        break
      case VADStatus.MaybeSpeaking:
        this.emit('CancelSpeaking')
        break
    }
  }
}
