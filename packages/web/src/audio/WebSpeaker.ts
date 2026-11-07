import { MicdropDevice, Pcm16AudioStream, SpeakerDriver } from '@micdrop/client'
import { audioContext } from './audioContext'
import { listDevices } from './WebMic'
import { WebAudioSink } from './WebAudioSink'

// A Bluetooth headset switches to its call profile as its microphone opens,
// and Firefox mangles what it plays through that switch: the first answer of a
// call comes out all at once. The speaker starts right after the microphone, so
// it plays silence that long and holds the first answer until then. The
// microphone opens again at each call, while the speaker stays started, so the
// warm-up comes back with every start.
const FIREFOX_WARM_UP = 2000 // ms
const IS_FIREFOX =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox')

/**
 * Where the sound goes. The audio context is the preferred way, it is the only
 * one that keeps echo cancellation working. Firefox cannot pick an output on
 * an audio context, so a non default device is played back through an audio
 * element instead. iOS reports echo cancellation on and still hears an audio
 * context, but not an element, which is the echo fallback.
 */
type SpeakerOutput =
  | { kind: 'context' }
  | {
      kind: 'element'
      reason: 'device' | 'echoFallback'
      element: HTMLAudioElement
      destination: MediaStreamAudioDestinationNode
    }

type SpeakerState =
  | { status: 'stopped' }
  | {
      status: 'started'
      sink: WebAudioSink
      stream: Pcm16AudioStream
      output: SpeakerOutput
    }

/**
 * Plays the assistant voice with the Web Audio API.
 *
 * The output device is remembered across calls: one chosen before `start()`
 * applies as soon as it starts, and the echo fallback plays through it too.
 */
export class WebSpeaker extends SpeakerDriver {
  private state: SpeakerState = { status: 'stopped' }
  // The output asked for last, undefined for the system one
  private _deviceId: string | undefined
  // Device changes take turns, so the last one asked for is the one heard
  private routing: Promise<void> = Promise.resolve()

  get isPlaying(): boolean {
    return this.state.status === 'started' && this.state.stream.isPlaying
  }

  get deviceId(): string | undefined {
    return this._deviceId
  }

  /** The node the sound comes out of, to analyse or process it */
  get output(): AudioNode | undefined {
    return this.state.status === 'started' ? this.state.sink.output : undefined
  }

  /**
   * Prepares the audio graph, once, and plays through the switch of a headset
   * whose microphone just opened, at every call
   */
  async start(): Promise<void> {
    if (this.state.status === 'started') {
      if (IS_FIREFOX) this.state.stream.warmUp(FIREFOX_WARM_UP)
      return
    }

    const sink = new WebAudioSink()
    const stream = new Pcm16AudioStream(sink)
    if (IS_FIREFOX) stream.warmUp(FIREFOX_WARM_UP)
    stream.on('StartPlaying', () => this.emit('StartPlaying'))
    stream.on('StopPlaying', () => this.emit('StopPlaying'))
    stream.on('Volume', (volume) => this.emit('Volume', volume))

    sink.output.connect(audioContext.destination)
    this.state = {
      status: 'started',
      sink,
      stream,
      output: { kind: 'context' },
    }

    // Play through the output chosen while stopped, or during the last call
    const deviceId = this._deviceId
    if (deviceId) {
      try {
        await this.route(deviceId)
      } catch (error) {
        console.error(
          '[Micdrop] Playing through the chosen output failed',
          error
        )
        // Forgotten, so the caller sees the system output in use
        if (this._deviceId === deviceId) this._deviceId = undefined
      }
    }
  }

  play(pcm: Int16Array, sampleRate: number): void {
    if (this.state.status !== 'started') return
    this.state.stream.playAudio(pcm, sampleRate)
  }

  stopAudio(): void {
    if (this.state.status !== 'started') return
    this.state.stream.stopAudio()
  }

  async stop(): Promise<void> {
    const state = this.state
    if (state.status !== 'started') return
    this.state = { status: 'stopped' }
    state.stream.destroy()
    state.sink.output.disconnect()
    closeOutput(state.output)
  }

  /**
   * Moves the sound to an audio element, while it plays. The audio context
   * keeps playing until the element is known to be allowed to.
   */
  async useEchoFallback(): Promise<boolean> {
    const state = this.state
    if (state.status !== 'started' || state.output.kind !== 'context') {
      return false
    }

    const output = createElementOutput('echoFallback')
    output.element.srcObject = output.destination.stream
    try {
      await output.element.play()
      // Through the device chosen, rather than the system one
      if (this._deviceId) await output.element.setSinkId?.(this._deviceId)
    } catch (error) {
      console.error('[Micdrop] Playing through an element failed', error)
      closeOutput(output)
      return false
    }

    // The call ended, or the output changed, in the meantime
    if (this.state !== state || state.output.kind !== 'context') {
      closeOutput(output)
      return false
    }
    setOutput(state, output)
    return true
  }

  resetEchoFallback(): void {
    const state = this.state
    if (
      state.status !== 'started' ||
      state.output.kind !== 'element' ||
      state.output.reason !== 'echoFallback'
    ) {
      return
    }
    setOutput(state, { kind: 'context' })

    // Firefox needs an element of its own to play through a chosen device
    const deviceId = this._deviceId
    if (deviceId) {
      this.route(deviceId).catch((error) =>
        console.error(
          '[Micdrop] Playing through the chosen output failed',
          error
        )
      )
    }
  }

  async changeDevice(deviceId: string): Promise<void> {
    await this.route(deviceId)
    this._deviceId = deviceId
  }

  async getDevices(): Promise<MicdropDevice[]> {
    return listDevices('audiooutput')
  }

  /**
   * Plays through a device, after the changes asked for before
   * @param deviceId - The output device
   */
  private route(deviceId: string): Promise<void> {
    const done = this.routing.then(() => this.applyDevice(deviceId))
    this.routing = done.catch(() => undefined)
    return done
  }

  private async applyDevice(deviceId: string): Promise<void> {
    // Stopped: start() applies it
    const state = this.state
    if (state.status !== 'started') return

    const devices = await this.getDevices()
    const isDefault = devices.length === 0 || devices[0].id === deviceId
    // Stopped, or started again, while the devices were listed
    if (this.state !== state) return

    const output = state.output
    if (output.kind === 'element' && output.reason === 'echoFallback') {
      // The element stays, it only plays through the new device
      await output.element.setSinkId?.(isDefault ? '' : deviceId)
      return
    }

    if (isDefault || 'setSinkId' in audioContext) {
      await (audioContext as any).setSinkId?.(isDefault ? '' : deviceId)
      if (this.state !== state) return
      // The echo fallback took over meanwhile, and keeps the sound
      const current = state.output
      if (current.kind === 'element' && current.reason === 'echoFallback') {
        await current.element.setSinkId?.(isDefault ? '' : deviceId)
        return
      }
      setOutput(state, { kind: 'context' })
      return
    }

    // Firefox: stream the sound back into an audio element, which does accept
    // an output device
    let element = output.kind === 'element' ? output.element : undefined
    if (!element) {
      const next = createElementOutput('device')
      next.element.autoplay = true
      next.element.srcObject = next.destination.stream
      setOutput(state, next)
      element = next.element
    }
    await element.setSinkId?.(deviceId)
  }
}

/**
 * Sends the sound of a running speaker somewhere else
 * @param state - The running speaker
 * @param output - Where the sound goes from now on
 */
function setOutput(
  state: Extract<SpeakerState, { status: 'started' }>,
  output: SpeakerOutput
) {
  const previous = state.output
  if (previous === output) return
  if (previous.kind === 'context' && output.kind === 'context') return
  // Only this connection, an analyser plugged on the output stays plugged
  state.sink.output.disconnect(destinationOf(previous))
  state.sink.output.connect(destinationOf(output))
  state.output = output
  closeOutput(previous)
}

function destinationOf(output: SpeakerOutput): AudioNode {
  return output.kind === 'context'
    ? audioContext.destination
    : output.destination
}

/** An audio element fed from the audio context, not playing yet */
function createElementOutput(
  reason: 'device' | 'echoFallback'
): Extract<SpeakerOutput, { kind: 'element' }> {
  return {
    kind: 'element',
    reason,
    element: new Audio(),
    destination: audioContext.createMediaStreamDestination(),
  }
}

/** Silences and frees an output, once nothing plays through it any more */
function closeOutput(output: SpeakerOutput) {
  if (output.kind !== 'element') return
  output.element.pause()
  output.element.srcObject = null
}
