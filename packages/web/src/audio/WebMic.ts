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

type MicState =
  | { status: 'stopped' }
  | { status: 'starting'; requested: string | undefined }
  | {
      status: 'started'
      /** The device asked for, undefined for the system one */
      requested: string | undefined
      stream: MediaStream
      source: MediaStreamAudioSourceNode
      worklet: AudioWorkletNode
    }

/**
 * Records the microphone with the Web Audio API.
 *
 * An audio worklet delivers the samples at a steady pace, and everything that
 * happens to them afterwards lives in `@micdrop/client`.
 *
 * Starts and stops take turns, so two starts never hold two streams. A stop or
 * a start for another device aborts the start under way, which lets go of
 * whatever it obtained, and the last call wins.
 */
export class WebMic extends MicDriver {
  private state: MicState = { status: 'stopped' }
  // The device the browser settled on last, kept after a stop
  private _deviceId: string | undefined
  // The start under way or waiting for its turn, which the next call aborts
  private attempt:
    | {
        requested: string | undefined
        controller: AbortController
        done: Promise<void>
      }
    | undefined
  private queue: Promise<void> = Promise.resolve()

  get isStarted(): boolean {
    return this.state.status === 'started'
  }

  get deviceId(): string | undefined {
    return this._deviceId
  }

  // Asking for echo cancellation is not getting it: some browsers and devices
  // do without, and the settings of the track say so
  get echoCancellation(): boolean | undefined {
    if (this.state.status !== 'started') return undefined
    const track = this.state.stream.getAudioTracks()[0]
    const setting = track?.getSettings?.().echoCancellation as unknown
    if (setting === undefined) return undefined
    return setting !== false
  }

  start(deviceId?: string): Promise<void> {
    // The same request is already on its way
    if (this.attempt && this.attempt.requested === deviceId) {
      return this.attempt.done
    }

    this.attempt?.controller.abort()
    const controller = new AbortController()
    const done = this.enqueue(() => this.open(deviceId, controller.signal))
    const attempt = { requested: deviceId, controller, done }
    this.attempt = attempt
    const clear = () => {
      if (this.attempt === attempt) this.attempt = undefined
    }
    done.then(clear, clear)
    return done
  }

  async stop(): Promise<void> {
    this.attempt?.controller.abort()
    this.attempt = undefined
    // Resolves once a start under way has let go of its stream too
    await this.enqueue(async () => this.close())
  }

  async getDevices(): Promise<MicdropDevice[]> {
    return listDevices('audioinput')
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const done = this.queue.then(operation)
    this.queue = done.catch(() => undefined)
    return done
  }

  private async open(requested: string | undefined, signal: AbortSignal) {
    if (signal.aborted) return

    const state = this.state
    if (state.status === 'started') {
      // Same device, keep recording. A device asked for by its real id is the
      // one the browser settled on when the system one was asked for.
      if (requested === state.requested || requested === this._deviceId) return
      this.close()
    }

    this.state = { status: 'starting', requested }
    let stream: MediaStream | undefined
    let settled: string | undefined
    try {
      await waitForRelease(requested, signal)
      if (signal.aborted) return

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { ideal: requested },
          sampleRate: 16000, // not working, it will follow device settings, usually 44.1kHz
          sampleSize: 16,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      // Remember which device the browser settled on
      const track = stream.getTracks()[0]
      const capability = track?.getCapabilities?.().deviceId
      settled =
        capability && capability !== 'default'
          ? capability
          : (requested ?? capability)
      if (signal.aborted) return

      await initPcmProcessor()
      if (signal.aborted) return

      const worklet = new AudioWorkletNode(audioContext, 'pcm-processor')
      const source = audioContext.createMediaStreamSource(stream)
      worklet.port.onmessage = this.onWorkletMessage
      source.connect(worklet)

      // A browser only reveals the device labels once a stream is running, and
      // Firefox lists nothing at all before that
      navigator.mediaDevices.addEventListener(
        'devicechange',
        this.onDeviceChange
      )

      this._deviceId = settled
      this.state = { status: 'started', requested, stream, source, worklet }
      stream = undefined
    } finally {
      // Aborted or failed: nothing obtained on the way stays open
      if (stream) releaseStream(stream, settled)
      if (this.state.status === 'starting') this.state = { status: 'stopped' }
    }
  }

  /** Tears the running microphone down, if there is one */
  private close() {
    const state = this.state
    if (state.status !== 'started') return
    this.state = { status: 'stopped' }

    navigator.mediaDevices.removeEventListener(
      'devicechange',
      this.onDeviceChange
    )
    state.worklet.port.onmessage = null
    state.worklet.disconnect()
    state.source.disconnect()
    releaseStream(state.stream, this._deviceId)
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
 * Stops a stream, and notes when its device was let go
 * @param stream - The stream to stop
 * @param deviceId - The device it recorded from
 */
function releaseStream(stream: MediaStream, deviceId: string | undefined) {
  stopStream(stream)
  lastRelease = { at: Date.now(), deviceId }
}

/**
 * Waits until Firefox let go of the microphone, see FIREFOX_RELEASE_DELAY
 * @param deviceId - The device about to be opened
 * @param signal - Ends the wait early, when the start is aborted
 */
async function waitForRelease(
  deviceId: string | undefined,
  signal: AbortSignal
) {
  if (!isFirefox || !lastRelease) return
  if (deviceId && lastRelease.deviceId && deviceId !== lastRelease.deviceId) {
    return
  }
  const remaining = lastRelease.at + FIREFOX_RELEASE_DELAY - Date.now()
  if (remaining <= 0 || signal.aborted) return
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, remaining)
    signal.addEventListener('abort', done)
  })
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
