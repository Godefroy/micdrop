import { EventEmitter } from 'eventemitter3'

/**
 * An input or output audio device offered by the system
 */
export interface MicdropDevice {
  /** Identifier to hand back to `changeMicDevice` or `changeSpeakerDevice` */
  id: string
  /** Name to show, as the system spells it */
  label: string
  kind: 'audioinput' | 'audiooutput'
}

export interface MicEvents {
  /** A batch of mono samples, in the -1..1 range, with its sample rate */
  Frames: [Float32Array, number]
  /** Level of the captured audio, emitted about ten times a second */
  Volume: [number]
  /** The system gained or lost an audio device */
  DeviceChange: []
  Error: [Error]
}

/**
 * What a {@link VAD} listens to. The `Mic` singleton implements it, and so can
 * any other emitter, which makes voice activity detection testable on its own.
 */
export type MicSource = Pick<EventEmitter<MicEvents>, 'on' | 'off'>

export interface MicDriverEvents {
  /** A batch of mono samples, in the -1..1 range, with its sample rate */
  Frames: [Float32Array, number]
  /** The system gained or lost an audio device */
  DeviceChange: []
  Error: [Error]
}

/**
 * Captures the microphone and pushes raw samples.
 *
 * `@micdrop/web` records with the Web Audio API and `@micdrop/react-native`
 * with the native audio engine. Everything above this interface is shared.
 */
export abstract class MicDriver extends EventEmitter<MicDriverEvents> {
  abstract get isStarted(): boolean

  /** Identifier of the input device in use, when the system reports one */
  abstract get deviceId(): string | undefined

  /**
   * Whether the system removes the speaker from what the microphone hears.
   * False when it is known to be off, undefined when the system does not say.
   */
  get echoCancellation(): boolean | undefined {
    return undefined
  }

  /**
   * Asks for the microphone permission and starts capturing
   * @param deviceId - Input device to record from, defaults to the system one
   */
  abstract start(deviceId?: string): Promise<void>

  /** Stops capturing and releases the microphone */
  abstract stop(): Promise<void>

  /** Lists the input devices the system offers */
  abstract getDevices(): Promise<MicdropDevice[]>
}

export interface SpeakerDriverEvents {
  StartPlaying: []
  StopPlaying: []
  /** Level of the audio being played */
  Volume: [number]
}

/**
 * Plays the 16 kHz mono PCM sent by the server.
 */
export abstract class SpeakerDriver extends EventEmitter<SpeakerDriverEvents> {
  abstract get isPlaying(): boolean

  /** Identifier of the output device in use, when the system reports one */
  abstract get deviceId(): string | undefined

  /** Prepares the audio graph, called before the first chunk arrives */
  abstract start(): Promise<void>

  /**
   * Queues samples for playback, right after the ones already queued
   * @param pcm - Mono samples as 16 bits integers
   * @param sampleRate - Sample rate of `pcm`, in Hz
   */
  abstract play(pcm: Int16Array, sampleRate: number): void

  /** Drops everything queued and stops playing immediately */
  abstract stopAudio(): void

  /** Releases the audio graph */
  abstract stop(): Promise<void>

  /**
   * Plays through another output
   * @param deviceId - Output device, or route on a phone
   */
  abstract changeDevice(deviceId: string): Promise<void>

  /** Lists the output devices the system offers */
  abstract getDevices(): Promise<MicdropDevice[]>
}

/** A buffer handed to an {@link AudioSink}, that can still be cancelled */
export interface ScheduledAudio {
  stop(): void
}

/**
 * The minimal slice of an audio engine needed to stream the assistant voice.
 * Implemented on each platform, and faked in the test suite.
 */
export interface AudioSink {
  /** Sample rate of the underlying audio graph, in Hz */
  readonly sampleRate: number

  /** Current time of the audio graph, in seconds */
  readonly currentTime: number

  /**
   * Plays samples at a given time on the audio graph clock
   * @param samples - Mono samples, in the -1..1 range, at `sampleRate`
   * @param when - When to start, in seconds on the audio graph clock
   * @param onEnded - Called once the samples have been played
   */
  schedule(
    samples: Float32Array,
    when: number,
    onEnded: () => void
  ): ScheduledAudio
}
