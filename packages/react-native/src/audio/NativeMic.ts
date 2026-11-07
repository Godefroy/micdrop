import { MicDriver, MicdropDevice } from '@micdrop/client'
import {
  AudioManager,
  AudioRecorder,
  RecorderAdapterNode,
} from 'react-native-audio-api'
import { getAudioContext } from './context'
import { configureCallSession } from './session'

const SAMPLE_RATE = 16000
// Samples asked of the recorder for each callback, about 20 ms at 16 kHz
const BUFFER_LENGTH = 320

type MicState =
  | { status: 'stopped' }
  | { status: 'starting'; requested: string | undefined }
  | {
      status: 'started'
      /** The device asked for, undefined for the system one */
      requested: string | undefined
      recorder: AudioRecorder
      adapter: RecorderAdapterNode
    }

/**
 * Records the microphone with `react-native-audio-api`.
 *
 * The audio session is configured for a phone call: the operating system then
 * applies echo cancellation, which keeps the assistant voice out of what is
 * recorded.
 *
 * Starts and stops take turns, so two starts never hold two recorders. A stop
 * or a start for another device aborts the start under way, which lets go of
 * whatever it obtained, and the last call wins.
 */
export class NativeMic extends MicDriver {
  private state: MicState = { status: 'stopped' }
  // The device recorded from last, kept after a stop
  private _deviceId: string | undefined
  // The start under way or waiting for its turn, which the next call aborts
  private attempt:
    | { requested: string | undefined; aborted: boolean; done: Promise<void> }
    | undefined
  private queue: Promise<void> = Promise.resolve()

  get isStarted(): boolean {
    return this.state.status === 'started'
  }

  get deviceId(): string | undefined {
    return this._deviceId
  }

  start(deviceId?: string): Promise<void> {
    // The same request is already on its way
    if (this.attempt && this.attempt.requested === deviceId) {
      return this.attempt.done
    }

    if (this.attempt) this.attempt.aborted = true
    const attempt = {
      requested: deviceId,
      aborted: false,
      done: Promise.resolve(),
    }
    attempt.done = this.enqueue(() => this.open(attempt))
    this.attempt = attempt
    const clear = () => {
      if (this.attempt === attempt) this.attempt = undefined
    }
    attempt.done.then(clear, clear)
    return attempt.done
  }

  async stop(): Promise<void> {
    if (this.attempt) this.attempt.aborted = true
    this.attempt = undefined
    // Resolves once a start under way has let go of its recorder too
    await this.enqueue(async () => {
      await this.close()
      await releaseSession()
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const done = this.queue.then(operation)
    this.queue = done.catch(() => undefined)
    return done
  }

  private async open(attempt: {
    requested: string | undefined
    aborted: boolean
  }) {
    if (attempt.aborted) return
    const { requested } = attempt

    const state = this.state
    if (state.status === 'started') {
      if (requested === state.requested) return
      // Tear the graph down without releasing the session, the call goes on
      await this.close()
    }

    this.state = { status: 'starting', requested }
    let recorder: AudioRecorder | undefined
    let adapter: RecorderAdapterNode | undefined
    try {
      const permission = await AudioManager.requestRecordingPermissions()
      if (permission !== 'Granted') {
        throw new Error(`Microphone permission ${permission.toLowerCase()}`)
      }
      if (attempt.aborted) return

      configureCallSession()
      await AudioManager.setAudioSessionActivity(true)
      if (requested) {
        await AudioManager.setInputDevice(requested)
      }
      if (attempt.aborted) return

      // The recorder feeds the audio graph through an adapter node, so the
      // captured sound stays available to the rest of the graph
      const context = getAudioContext()
      adapter = context.createRecorderAdapter()

      recorder = new AudioRecorder()
      recorder.connect(adapter)
      recorder.onError(({ message }) => this.emit('Error', new Error(message)))
      recorder.onAudioReady(
        {
          sampleRate: SAMPLE_RATE,
          bufferLength: BUFFER_LENGTH,
          channelCount: 1,
        },
        ({ buffer }) => {
          // The native buffer is reused between callbacks, so keep a copy
          const frames = Float32Array.from(buffer.getChannelData(0))
          this.emit('Frames', frames, buffer.sampleRate)
        }
      )

      const result = await recorder.start()
      if (result.status === 'error') throw new Error(result.message)
      if (attempt.aborted) return

      this._deviceId = requested
      this.state = { status: 'started', requested, recorder, adapter }
      recorder = undefined
      adapter = undefined
    } finally {
      // Aborted or failed: nothing obtained on the way stays open
      await releaseGraph(recorder, adapter)
      if (this.state.status === 'starting') {
        this.state = { status: 'stopped' }
        // A failed switch of devices tore the previous graph down already, so
        // nothing records any more and the call mode goes too. An aborted
        // start leaves it to the stop or the start that aborted it.
        if (!attempt.aborted) await releaseSession()
      }
    }
  }

  /** Tears the running recorder down, if there is one */
  private async close() {
    const state = this.state
    if (state.status !== 'started') return
    this.state = { status: 'stopped' }
    await releaseGraph(state.recorder, state.adapter)
  }

  async getDevices(): Promise<MicdropDevice[]> {
    const { availableInputs } = await AudioManager.getDevicesInfo()
    return availableInputs.map(({ id, name }) => ({
      id,
      label: name,
      kind: 'audioinput' as const,
    }))
  }
}

/**
 * Stops a recorder and unplugs it from the graph
 * @param recorder - The recorder, when there is one
 * @param adapter - The node it fed, when there is one
 */
async function releaseGraph(
  recorder: AudioRecorder | undefined,
  adapter: RecorderAdapterNode | undefined
) {
  try {
    recorder?.clearOnAudioReady()
    recorder?.clearOnError()
    await recorder?.stop()
    recorder?.disconnect()
  } catch (error) {
    console.error('[Micdrop] Error stopping the recorder', error)
  }
  adapter?.disconnect()
}

/**
 * Hands the audio session back, so the phone leaves call mode and whatever was
 * playing before can resume
 */
async function releaseSession() {
  try {
    await AudioManager.setAudioSessionActivity(false)
  } catch (error) {
    console.error('[Micdrop] Error releasing the audio session', error)
  }
}
