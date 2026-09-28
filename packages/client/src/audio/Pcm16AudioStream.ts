import { EventEmitter } from 'eventemitter3'
import { pcm16ToFloat, resample } from './pcm'
import { AudioSink, ScheduledAudio } from './types'
import { VOLUME_SAMPLE_RATE, VolumeMeter } from './volume'

// Buffer this much audio before starting a fresh playback. Providers (e.g.
// OpenAI TTS) often deliver a small first burst then pause while generating,
// so playing immediately underruns. Waiting for a duration of audio (rather
// than a wall-clock delay) naturally absorbs that slow start.
const PREBUFFER_DURATION = 100 // ms
// If no new chunk arrives for this long while still prebuffering, start anyway.
// Handles utterances shorter than PREBUFFER_DURATION (there is no explicit
// end-of-speech signal). Kept above providers' inter-chunk gaps so it does not
// fire mid-utterance.
const QUIET_FLUSH_DELAY = 600 // ms
// How long everything scheduled has to stay finished before the utterance is
// considered over and a fresh prebuffer is armed for the next one.
//
// Running out of scheduled audio is not the end of a sentence: a chunk that
// arrives a few milliseconds late leaves the same silence, and there is no
// end-of-speech signal to tell the two apart. Rearming immediately turns that
// small hole into a long one, since the late chunk then has to wait for a whole
// new prebuffer before it may be heard.
const UTTERANCE_END_DELAY = 300 // ms
// Cadence of the Volume events, used to drive a level meter while the
// assistant speaks.
const VOLUME_INTERVAL = 100 // ms
export interface Pcm16AudioStreamEvents {
  StartPlaying: []
  StopPlaying: []
  Volume: [number]
}

/**
 * Turns the stream of PCM chunks sent by the server into continuous playback.
 *
 * Chunks arrive faster or slower than they are heard, so each one is scheduled
 * right after the previous one on the audio graph clock instead of being played
 * on arrival.
 */
export class Pcm16AudioStream extends EventEmitter<Pcm16AudioStreamEvents> {
  public isPlaying = false

  private sources: ScheduledAudio[] = []
  private nextStartTime = 0
  private prebuffering = true
  private prebuffer: Float32Array[] = []
  private prebufferDuration = 0
  private quietTimer?: ReturnType<typeof setTimeout>
  private endTimer?: ReturnType<typeof setTimeout>
  private volumeTimers: ReturnType<typeof setTimeout>[] = []
  private meter = new VolumeMeter()
  // Wall time before which no utterance starts, see warmUp()
  private holdUntil = 0
  private holdTimer?: ReturnType<typeof setTimeout>
  private warmUpAudio?: ScheduledAudio

  constructor(private sink: AudioSink) {
    super()
  }

  /**
   * Queues samples for playback
   * @param pcm - Mono samples as 16 bits integers
   * @param sampleRate - Sample rate of `pcm`, in Hz
   */
  playAudio(pcm: Int16Array, sampleRate: number) {
    if (pcm.length === 0) return
    const samples = resample(
      pcm16ToFloat(pcm),
      sampleRate,
      this.sink.sampleRate
    )
    this.handleSamples(samples)
  }

  /**
   * Plays silence for a while, and holds the next utterance until it is over.
   *
   * Firefox mangles what it plays while a Bluetooth headset switches to its
   * call profile, which the headset does as soon as its microphone opens. The
   * first answer then comes out all at once. Silence played through that switch
   * goes unheard.
   * @param duration - How long to play silence, in milliseconds
   */
  warmUp(duration: number) {
    this.holdUntil = Date.now() + duration
    const samples = new Float32Array(
      Math.round((duration / 1000) * this.sink.sampleRate)
    )
    this.warmUpAudio?.stop()
    this.warmUpAudio = this.sink.schedule(
      samples,
      this.sink.currentTime,
      () => (this.warmUpAudio = undefined)
    )
  }

  /** Stops playing, for a stream no longer used */
  destroy() {
    this.stopAudio()
    this.warmUpAudio?.stop()
    this.warmUpAudio = undefined
    this.removeAllListeners()
  }

  /** Drops everything queued and stops playing immediately */
  stopAudio() {
    for (const source of this.sources) {
      try {
        source.stop()
      } catch (error) {
        // Ignore errors when stopping
      }
    }
    this.sources = []
    this.nextStartTime = 0
    this.resetPrebuffer()
    this.setIsPlaying(false)
    this.clearVolumeTimers()
  }

  // Accumulate audio until enough is buffered, then start playing. Once
  // playing, schedule incoming samples directly.
  private handleSamples(samples: Float32Array) {
    // Audio is still coming, so what just ran out was a hole, not an ending.
    if (this.endTimer !== undefined) {
      clearTimeout(this.endTimer)
      this.endTimer = undefined
    }

    if (!this.prebuffering) {
      this.scheduleSamples(samples)
      return
    }

    this.prebuffer.push(samples)
    this.prebufferDuration += (samples.length / this.sink.sampleRate) * 1000

    if (this.prebufferDuration >= PREBUFFER_DURATION) {
      this.flushPrebuffer()
      return
    }

    // Restart the quiet timer: flush if the stream stalls (short utterance)
    if (this.quietTimer !== undefined) clearTimeout(this.quietTimer)
    this.quietTimer = setTimeout(() => this.flushPrebuffer(), QUIET_FLUSH_DELAY)
  }

  private flushPrebuffer() {
    if (this.quietTimer !== undefined) {
      clearTimeout(this.quietTimer)
      this.quietTimer = undefined
    }
    // Keep buffering through the warm-up, and start once it is over
    const hold = this.holdUntil - Date.now()
    if (hold > 0) {
      this.holdTimer ??= setTimeout(() => {
        this.holdTimer = undefined
        this.flushPrebuffer()
      }, hold)
      return
    }
    this.prebuffering = false
    const buffers = this.prebuffer
    this.prebuffer = []
    this.prebufferDuration = 0
    for (const samples of buffers) this.scheduleSamples(samples)
  }

  private resetPrebuffer() {
    if (this.quietTimer !== undefined) {
      clearTimeout(this.quietTimer)
      this.quietTimer = undefined
    }
    if (this.endTimer !== undefined) {
      clearTimeout(this.endTimer)
      this.endTimer = undefined
    }
    if (this.holdTimer !== undefined) {
      clearTimeout(this.holdTimer)
      this.holdTimer = undefined
    }
    this.prebuffering = true
    this.prebuffer = []
    this.prebufferDuration = 0
  }

  private scheduleSamples(samples: Float32Array) {
    const duration = samples.length / this.sink.sampleRate

    // Schedule these samples right after the previous ones end (or now for the
    // first ones, since nextStartTime is 0)
    const now = this.sink.currentTime
    const startTime = Math.max(this.nextStartTime, now)
    this.nextStartTime = startTime + duration

    const source = this.sink.schedule(samples, startTime, () => {
      // Remove from tracked sources
      const index = this.sources.indexOf(source)
      if (index !== -1) this.sources.splice(index, 1)

      // Nothing left scheduled. That is the end of the utterance only if it
      // stays that way, so the prebuffer is armed on a delay: a chunk arriving
      // late is played straight away instead of waiting for a new one.
      if (this.sources.length === 0) {
        this.nextStartTime = 0
        this.setIsPlaying(false)
        if (this.endTimer !== undefined) clearTimeout(this.endTimer)
        this.endTimer = setTimeout(() => {
          this.endTimer = undefined
          this.resetPrebuffer()
        }, UTTERANCE_END_DELAY)
      }
    })

    this.sources.push(source)
    this.scheduleVolume(samples, startTime - now)
    this.setIsPlaying(true)
  }

  // Report the level of what is being heard rather than of what just arrived:
  // a burst of chunks would otherwise light up the meter all at once and leave
  // it dark for the rest of the sentence.
  private scheduleVolume(samples: Float32Array, delay: number) {
    const step = Math.max(
      1,
      Math.round((VOLUME_INTERVAL / 1000) * this.sink.sampleRate)
    )
    for (let offset = 0; offset < samples.length; offset += step) {
      const slice = samples.subarray(offset, offset + step)
      const at = delay * 1000 + (offset / this.sink.sampleRate) * 1000
      const timer = setTimeout(
        () => {
          const index = this.volumeTimers.indexOf(timer)
          if (index !== -1) this.volumeTimers.splice(index, 1)
          this.emit(
            'Volume',
            this.meter.measure(
              resample(slice, this.sink.sampleRate, VOLUME_SAMPLE_RATE)
            )
          )
        },
        Math.max(0, at)
      )
      this.volumeTimers.push(timer)
    }
  }

  private clearVolumeTimers() {
    for (const timer of this.volumeTimers) clearTimeout(timer)
    this.volumeTimers = []
    this.meter.reset()
  }

  private setIsPlaying(isPlaying: boolean) {
    if (this.isPlaying === isPlaying) return
    this.isPlaying = isPlaying

    if (!isPlaying) {
      // Nothing is being heard any more, so the meter has to empty. Without
      // this it would keep showing the level of the last thing played.
      this.clearVolumeTimers()
      this.emit('Volume', -Infinity)
    }

    this.emit(isPlaying ? 'StartPlaying' : 'StopPlaying')
  }
}
