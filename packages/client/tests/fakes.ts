import { EventEmitter } from 'eventemitter3'
import {
  AudioSink,
  MicDriver,
  MicdropDevice,
  MicEvents,
  ScheduledAudio,
  SpeakerDriver,
} from '../src/audio/types'
import { TurnDetector } from '../src/types'
import { VAD } from '../src/audio/vad/VAD'

/** A microphone that plays back whatever the test hands it */
export class FakeMicDriver extends MicDriver {
  public started = false
  public startedWith: string | undefined
  public devices: MicdropDevice[] = [
    { id: 'built-in', label: 'Built-in Microphone', kind: 'audioinput' },
  ]

  get isStarted() {
    return this.started
  }

  get deviceId() {
    return this.startedWith
  }

  async start(deviceId?: string) {
    this.started = true
    this.startedWith = deviceId
  }

  async stop() {
    this.started = false
  }

  async getDevices() {
    return this.devices
  }

  /** Pushes samples as the native recorder would */
  push(frames: Float32Array, sampleRate = 16000) {
    this.emit('Frames', frames, sampleRate)
  }
}

/** A speaker that remembers what it was asked to play */
export class FakeSpeakerDriver extends SpeakerDriver {
  public played: Int16Array[] = []
  /** Rate of each chunk in `played`, in Hz */
  public rates: number[] = []
  public devices: MicdropDevice[] = [
    { id: 'speaker', label: 'Speaker', kind: 'audiooutput' },
    { id: 'headphones', label: 'Headphones', kind: 'audiooutput' },
  ]
  public stopAudioCalls = 0
  private playing = false
  private _deviceId: string | undefined

  get isPlaying() {
    return this.playing
  }

  get deviceId() {
    return this._deviceId
  }

  async changeDevice(deviceId: string) {
    if (!this.devices.some((device) => device.id === deviceId)) {
      throw new Error(`Unknown output ${deviceId}`)
    }
    this._deviceId = deviceId
  }

  async start() {}

  play(pcm: Int16Array, sampleRate: number) {
    this.played.push(pcm)
    this.rates.push(sampleRate)
    this.setPlaying(true)
  }

  stopAudio() {
    this.stopAudioCalls++
    this.setPlaying(false)
  }

  async stop() {
    this.setPlaying(false)
  }

  async getDevices() {
    return this.devices
  }

  /** Every sample handed to the speaker so far, in order */
  get allSamples(): Int16Array {
    const length = this.played.reduce((sum, pcm) => sum + pcm.length, 0)
    const all = new Int16Array(length)
    let offset = 0
    for (const pcm of this.played) {
      all.set(pcm, offset)
      offset += pcm.length
    }
    return all
  }

  setPlaying(playing: boolean) {
    if (this.playing === playing) return
    this.playing = playing
    this.emit(playing ? 'StartPlaying' : 'StopPlaying')
  }
}

/** An audio graph with a clock the test moves forward by hand */
export class FakeAudioSink implements AudioSink {
  public sampleRate: number
  public currentTime = 0
  public scheduled: {
    samples: Float32Array
    when: number
    onEnded: () => void
    stopped: boolean
  }[] = []

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate
  }

  schedule(
    samples: Float32Array,
    when: number,
    onEnded: () => void
  ): ScheduledAudio {
    const entry = { samples, when, onEnded, stopped: false }
    this.scheduled.push(entry)
    return {
      stop() {
        entry.stopped = true
      },
    }
  }

  /** Plays out everything scheduled before `time` */
  advanceTo(time: number) {
    this.currentTime = time
    for (const entry of [...this.scheduled]) {
      if (entry.stopped) continue
      const end = entry.when + entry.samples.length / this.sampleRate
      if (end > time) continue
      this.scheduled.splice(this.scheduled.indexOf(entry), 1)
      entry.onEnded()
    }
  }
}

/** A source of Volume and Frames events, without any device behind it */
export class FakeMicSource extends EventEmitter<MicEvents> {
  volume(...volumes: number[]) {
    for (const volume of volumes) this.emit('Volume', volume)
  }
}

/** A VAD driven by the test rather than by the audio */
export class ManualVAD extends VAD {
  public readonly name = 'ManualVAD'
  public delay = 100
  private started = false
  private paused = false

  get isStarted() {
    return this.started
  }

  get isPaused() {
    return this.paused
  }

  async start() {
    this.started = true
  }

  async stop() {
    this.started = false
  }

  async pause() {
    this.paused = true
  }

  async resume() {
    this.paused = false
  }
}

/**
 * Builds samples of a sine wave
 * @param seconds - How long the wave lasts
 * @param options - Amplitude, frequency and sample rate of the wave
 */
export function sine(
  seconds: number,
  {
    amplitude = 0.5,
    frequency = 220,
    sampleRate = 16000,
  }: { amplitude?: number; frequency?: number; sampleRate?: number } = {}
): Float32Array {
  const length = Math.round(seconds * sampleRate)
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    samples[i] =
      amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  }
  return samples
}

/** Builds silent samples */
export function silence(seconds: number, sampleRate = 16000): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate))
}

/** A turn detector that answers from a script, and remembers what it heard */
export class FakeTurnDetector implements TurnDetector {
  public heard: Float32Array[] = []
  public questions = 0
  public resets = 0

  /** Answers to give in order, the last one repeating for good */
  constructor(public answers: boolean[] = [true]) {}

  /** How much audio it was given since the last reset, in seconds */
  get seconds() {
    return (
      this.heard.reduce((total, frames) => total + frames.length, 0) / 16000
    )
  }

  push(samples: Float32Array) {
    this.heard.push(samples)
  }

  async predict() {
    const index = Math.min(this.questions, this.answers.length - 1)
    this.questions++
    return { complete: this.answers[index] }
  }

  reset() {
    this.resets++
    this.heard = []
  }
}
