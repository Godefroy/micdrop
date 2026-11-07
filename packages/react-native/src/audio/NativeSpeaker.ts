import { MicdropDevice, Pcm16AudioStream, SpeakerDriver } from '@micdrop/client'
import { NativeSink } from './NativeSink'
import { configureCallSession } from './session'

/** Playing loud, or against the ear, is what choosing an output means on a phone */
export const SPEAKER_DEVICE = 'speaker'
export const EARPIECE_DEVICE = 'earpiece'

/**
 * Plays the assistant voice with `react-native-audio-api`.
 */
export class NativeSpeaker extends SpeakerDriver {
  private sink: NativeSink | undefined
  private stream: Pcm16AudioStream | undefined
  private _deviceId: string = SPEAKER_DEVICE

  get isPlaying(): boolean {
    return this.stream?.isPlaying ?? false
  }

  get deviceId(): string {
    return this._deviceId
  }

  async start(): Promise<void> {
    if (this.stream) return

    this.sink = new NativeSink()
    this.stream = new Pcm16AudioStream(this.sink)
    this.stream.on('StartPlaying', () => this.emit('StartPlaying'))
    this.stream.on('StopPlaying', () => this.emit('StopPlaying'))
    this.stream.on('Volume', (volume) => this.emit('Volume', volume))
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
    this.sink?.close()
    this.sink = undefined
  }

  async changeDevice(deviceId: string): Promise<void> {
    if (deviceId !== SPEAKER_DEVICE && deviceId !== EARPIECE_DEVICE) {
      throw new Error(
        `Unknown output "${deviceId}", a phone plays through "${SPEAKER_DEVICE}" or "${EARPIECE_DEVICE}"`
      )
    }

    // Choosing between the loudspeaker and the earpiece is a matter of audio
    // session options rather than of picking a device. They are remembered, so
    // the microphone keeps them when it switches inputs.
    configureCallSession({ earpiece: deviceId === EARPIECE_DEVICE })
    this._deviceId = deviceId
  }

  async getDevices(): Promise<MicdropDevice[]> {
    // Headphones and Bluetooth are routed by the operating system, so what is
    // left to choose is how the phone itself plays
    return [
      { id: SPEAKER_DEVICE, label: 'Speaker', kind: 'audiooutput' },
      { id: EARPIECE_DEVICE, label: 'Earpiece', kind: 'audiooutput' },
    ]
  }
}
