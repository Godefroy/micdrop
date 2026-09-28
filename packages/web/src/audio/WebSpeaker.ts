import { MicdropDevice, Pcm16AudioStream, SpeakerDriver } from '@micdrop/client'
import { audioContext } from './audioContext'
import { listDevices } from './WebMic'
import { WebAudioSink } from './WebAudioSink'

// A Bluetooth headset switches to its call profile as its microphone opens,
// and Firefox mangles what it plays through that switch: the first answer of a
// call comes out all at once. The speaker starts right after the microphone, so
// it plays silence that long and holds the first answer until then.
const FIREFOX_WARM_UP = 2000 // ms

/**
 * Plays the assistant voice with the Web Audio API.
 */
export class WebSpeaker extends SpeakerDriver {
  private sink: WebAudioSink | undefined
  private stream: Pcm16AudioStream | undefined
  private _deviceId: string | undefined
  // Firefox cannot pick an output on an audio context, so a non default device
  // is played back through an audio element instead
  private element: HTMLAudioElement | undefined

  get isPlaying(): boolean {
    return this.stream?.isPlaying ?? false
  }

  get deviceId(): string | undefined {
    return this._deviceId
  }

  /** The node the sound comes out of, to analyse or process it */
  get output(): AudioNode | undefined {
    return this.sink?.output
  }

  async start(): Promise<void> {
    if (this.stream) return

    this.sink = new WebAudioSink()
    this.stream = new Pcm16AudioStream(this.sink)
    if (navigator.userAgent.includes('Firefox')) {
      this.stream.warmUp(FIREFOX_WARM_UP)
    }
    this.stream.on('StartPlaying', () => this.emit('StartPlaying'))
    this.stream.on('StopPlaying', () => this.emit('StopPlaying'))
    this.stream.on('Volume', (volume) => this.emit('Volume', volume))

    this.sink.output.connect(audioContext.destination)
  }

  play(pcm: Int16Array, sampleRate: number): void {
    this.stream?.playAudio(pcm, sampleRate)
  }

  stopAudio(): void {
    this.stream?.stopAudio()
  }

  async stop(): Promise<void> {
    this.stream?.destroy()
    this.stream = undefined
    this.sink?.output.disconnect()
    this.sink = undefined
    if (this.element) {
      this.element.pause()
      this.element.srcObject = null
      this.element = undefined
    }
  }

  async changeDevice(deviceId: string): Promise<void> {
    const sink = this.sink
    if (!sink) {
      this._deviceId = deviceId
      return
    }

    const devices = await this.getDevices()
    const isDefault = devices.length === 0 || devices[0].id === deviceId

    if (isDefault || 'setSinkId' in audioContext) {
      // Playing through the audio context is the preferred way, it is the only
      // one that keeps echo cancellation working
      await (audioContext as any).setSinkId?.(isDefault ? '' : deviceId)
      sink.output.disconnect()
      sink.output.connect(audioContext.destination)

      if (this.element) {
        this.element.pause()
        this.element.srcObject = null
        this.element = undefined
      }
    } else {
      // Firefox: stream the sound back into an audio element, which does accept
      // an output device
      if (!this.element) {
        const destination = audioContext.createMediaStreamDestination()
        sink.output.disconnect()
        sink.output.connect(destination)

        this.element = new Audio()
        this.element.autoplay = true
        this.element.srcObject = destination.stream
      }
      await this.element.setSinkId(deviceId)
    }

    this._deviceId = deviceId
  }

  async getDevices(): Promise<MicdropDevice[]> {
    return listDevices('audiooutput')
  }
}
