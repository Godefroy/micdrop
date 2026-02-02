import { audioContext } from '../utils/audioContext'
import { LocalStorageKeys } from '../utils/localStorage'
import { VAD, VADStatus } from './VAD'

export type VolumeVADOptions = {
  history: number
  threshold: number
}

const defaultOptions: VolumeVADOptions = {
  history: 5,
  threshold: -55,
}

/**
 * Volume-based Voice Activity Detection
 * Based on the hark library implementation
 */
export class VolumeVAD extends VAD {
  public readonly name = 'VolumeVAD'
  public options = defaultOptions
  private _isPaused = false
  private analyser: AnalyserNode | undefined
  private sourceNode: MediaStreamAudioSourceNode | undefined
  private fftBins: Float32Array<ArrayBuffer> | undefined
  private running: boolean = false
  private speaking: boolean = false
  private attemptSpeaking: boolean = false
  private speakingHistory: number[] = []

  constructor(options?: Partial<VolumeVADOptions>) {
    super()

    if (options) {
      this.setOptions(options)
    } else {
      const savedOptions = localStorage.getItem(
        LocalStorageKeys.VolumeVADOptions
      )
      try {
        this.setOptions(savedOptions ? JSON.parse(savedOptions) : {})
      } catch (error) {
        this.setOptions({})
      }
    }
  }

  private getMaxVolume(): number {
    if (!this.analyser || !this.fftBins) return -Infinity

    let maxVolume = -Infinity
    this.analyser.getFloatFrequencyData(this.fftBins)

    for (let i = 4; i < this.fftBins.length; i++) {
      if (this.fftBins[i] > maxVolume && this.fftBins[i] < 0) {
        maxVolume = this.fftBins[i]
      }
    }

    return maxVolume
  }

  get isStarted(): boolean {
    return this.running
  }

  get isPaused(): boolean {
    return this._isPaused
  }

  async start(stream: MediaStream): Promise<void> {
    if (this.running || this._isPaused) return

    // Create audio context and nodes
    this.analyser = audioContext.createAnalyser()
    this.sourceNode = audioContext.createMediaStreamSource(stream)

    // Configure analyser
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.1
    this.fftBins = new Float32Array(this.analyser.frequencyBinCount)

    // Connect nodes
    this.sourceNode.connect(this.analyser)

    this.running = true
    this.startLoop()
  }

  private startLoop(): void {
    if (!this.running) return

    const currentVolume = this.getMaxVolume()

    // Check if started speaking
    if (currentVolume > this.options.threshold) {
      if (!this.speaking) {
        // Check recent history (last 3 samples)
        let recentHistory = 0
        for (
          let i = this.speakingHistory.length - 3;
          i < this.speakingHistory.length;
          i++
        ) {
          recentHistory += this.speakingHistory[i]
        }

        if (recentHistory >= 2) {
          this.speaking = true
          this.attemptSpeaking = false
          this.emit('ConfirmSpeaking')
        } else if (recentHistory === 1) {
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
      // Check last sample
      let lastHistory = this.speakingHistory[this.speakingHistory.length - 1]

      if (lastHistory === 0) {
        this.attemptSpeaking = false
        this.emit('CancelSpeaking')
      }
    }

    // Update history
    this.speakingHistory.shift()
    this.speakingHistory.push(Number(currentVolume > this.options.threshold))

    // Schedule next check
    setTimeout(() => this.startLoop(), this.delay)
  }

  private resetHistory(): void {
    this.speaking = false
    this.attemptSpeaking = false
    for (let i = 0; i < this.speakingHistory.length; i++) {
      this.speakingHistory[i] = 0
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return

    this.running = false
    this.resetHistory()

    switch (this.status) {
      case VADStatus.Speaking:
        this.emit('StopSpeaking')
        break
      case VADStatus.MaybeSpeaking:
        this.emit('CancelSpeaking')
        break
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = undefined
    }

    if (this.analyser) {
      this.analyser.disconnect()
      this.analyser = undefined
    }

    this.fftBins = undefined
  }

  async pause(): Promise<void> {
    if (!this.running || this._isPaused) return
    this._isPaused = true
    this.running = false
    this.resetHistory()

    switch (this.status) {
      case VADStatus.Speaking:
        this.emit('StopSpeaking')
        break
      case VADStatus.MaybeSpeaking:
        this.emit('CancelSpeaking')
        break
    }
  }

  async resume(): Promise<void> {
    if (!this._isPaused) return
    this._isPaused = false
    this.running = true
    this.startLoop()
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

    // Save to local storage
    localStorage.setItem(
      LocalStorageKeys.VolumeVADOptions,
      JSON.stringify(this.options)
    )
  }

  resetOptions() {
    this.setOptions(defaultOptions)
  }
}
