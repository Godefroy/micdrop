import { MicDriver, MicdropDevice } from '@micdrop/client'
import { audioContext } from './audioContext'
import { initPcmProcessor } from './pcm-processor'
import { stopStream } from './stopStream'

/**
 * How long Firefox needs to let go of a microphone it released.
 *
 * A microphone requested again before that comes back without its processing:
 * no echo cancellation, no noise suppression and a raw gain some 30 dB higher,
 * while its settings still report them on. The room then sounds like speech,
 * and the assistant hears its own voice. No event tells when the device is
 * free, so a new stream waits for this delay to pass.
 */
const FIREFOX_RELEASE_DELAY = 15000 // ms

const isFirefox =
  typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent)

// The last stream released, outside the class: the browser holds the device
// whichever WebMic opened it
let lastRelease: { at: number; deviceId: string | undefined } | undefined

/**
 * Records the microphone with the Web Audio API.
 *
 * An audio worklet delivers the samples at a steady pace, and everything that
 * happens to them afterwards lives in `@micdrop/client`.
 */
export class WebMic extends MicDriver {
  private stream: MediaStream | undefined
  private source: MediaStreamAudioSourceNode | undefined
  private worklet: AudioWorkletNode | undefined
  private _deviceId: string | undefined

  get isStarted(): boolean {
    return !!this.stream
  }

  get deviceId(): string | undefined {
    return this._deviceId
  }

  async start(deviceId?: string): Promise<void> {
    if (this.stream) {
      // Same device, keep recording
      if (this._deviceId === deviceId) return
      await this.stop()
    }

    await waitForRelease(deviceId)

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { ideal: deviceId },
        sampleRate: 16000, // not working, it will follow device settings, usually 44.1kHz
        sampleSize: 16,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })

    // Remember which device the browser settled on
    const track = this.stream.getTracks()[0]
    const settled = track?.getCapabilities?.().deviceId
    this._deviceId =
      settled && settled !== 'default' ? settled : (deviceId ?? settled)

    await initPcmProcessor()
    this.worklet = new AudioWorkletNode(audioContext, 'pcm-processor')
    this.worklet.port.onmessage = this.onWorkletMessage

    this.source = audioContext.createMediaStreamSource(this.stream)
    this.source.connect(this.worklet)

    // A browser only reveals the device labels once a stream is running, and
    // Firefox lists nothing at all before that
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange)
  }

  async stop(): Promise<void> {
    navigator.mediaDevices.removeEventListener(
      'devicechange',
      this.onDeviceChange
    )
    if (this.worklet) {
      this.worklet.port.onmessage = null
      this.worklet.disconnect()
      this.worklet = undefined
    }
    if (this.source) {
      this.source.disconnect()
      this.source = undefined
    }
    if (this.stream) {
      stopStream(this.stream)
      this.stream = undefined
      lastRelease = { at: Date.now(), deviceId: this._deviceId }
    }
  }

  async getDevices(): Promise<MicdropDevice[]> {
    return listDevices('audioinput')
  }

  private onWorkletMessage = (event: MessageEvent) => {
    const { type, frames, sampleRate } = event.data
    if (type !== 'frames') return
    this.emit('Frames', frames as Float32Array, sampleRate as number)
  }

  private onDeviceChange = () => {
    this.emit('DeviceChange')
  }
}

/**
 * Waits until Firefox let go of the microphone, see FIREFOX_RELEASE_DELAY
 * @param deviceId - The device about to be opened
 */
async function waitForRelease(deviceId?: string) {
  if (!isFirefox || !lastRelease) return
  if (deviceId && lastRelease.deviceId && deviceId !== lastRelease.deviceId) {
    return
  }
  const remaining = lastRelease.at + FIREFOX_RELEASE_DELAY - Date.now()
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }
}

/**
 * Lists the devices of one kind, the default one first
 * @param kind - Which devices to list
 */
export async function listDevices(
  kind: 'audioinput' | 'audiooutput'
): Promise<MicdropDevice[]> {
  const all = await navigator.mediaDevices.enumerateDevices()
  if (all.length === 0) return []

  // A browser lists the default device twice, once under the id "default" and
  // once under its real id. Keep the real one, and put it first.
  const defaults = all.filter((device) => device.deviceId === 'default')
  const devices = all.filter(
    (device) => device.deviceId !== 'default' && device.kind === kind
  )
  for (const fallback of defaults) {
    const index = devices.findIndex(
      (device) => device.groupId === fallback.groupId
    )
    if (index > 0) devices.unshift(...devices.splice(index, 1))
  }

  return devices.map((device) => ({
    id: device.deviceId,
    label: device.label || (kind === 'audioinput' ? 'Microphone' : 'Speaker'),
    kind,
  }))
}
