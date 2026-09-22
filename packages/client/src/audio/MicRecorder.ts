import { EventEmitter } from 'eventemitter3'
import { concatFloat32, floatToPcm16, resample } from './pcm'
import { TurnDetector } from '../types'
import { MicSource } from './types'
import { equalVADConfig, getVAD, VADConfig } from './vad/getVAD'
import { VAD } from './vad/VAD'

const SAMPLE_RATE = 16000
const CHUNK_INTERVAL = 100 // ms

/**
 * How long a turn may stay open after the detector asked to wait.
 *
 * Long enough to cover the pause of someone looking for their words, and short
 * enough that a wrong verdict costs one awkward silence rather than the call.
 */
export const DEFAULT_TURN_MAX_WAIT = 4000 // ms

/**
 * How much longer than the VAD delay a turn may wait for its confirmation.
 *
 * The audio heard before the speech is confirmed is held back, and only its
 * most recent part is kept: a VAD that stays unsure for a long time (a noisy
 * room keeps the volume VAD up) would otherwise send everything since then.
 */
export const CONFIRM_MARGIN = 300 // ms

/**
 * How long the microphone stays deaf after the speaker went quiet, when the
 * user may not interrupt the assistant.
 *
 * Without echo cancellation, what the speaker plays comes back through the
 * microphone. The sound leaves the speaker a little after it was played, and
 * lingers in the room.
 */
export const ECHO_TAIL = 300 // ms

export interface MicRecorderState {
  isStarting: boolean
  isStarted: boolean
  isSpeaking: boolean
}

const defaultMicRecorderState: MicRecorderState = {
  isStarting: false,
  isStarted: false,
  isSpeaking: false,
}

export interface MicRecorderEvents {
  Chunk: [Int16Array]
  StartSpeaking: void
  StopSpeaking: void
  StateChange: [MicRecorderState]
}

/**
 * Turns what the microphone captures into the chunks sent to the server.
 *
 * It only records while the VAD hears someone, and keeps a short reserve of
 * audio so the first syllable, spoken before the VAD reacted, is sent too.
 *
 * Recording and the turn are two different things. The VAD decides what is
 * worth sending, so the silences stay out of the stream either way. A
 * {@link TurnDetector}, when there is one, decides when the turn is over, and
 * a pause the speaker is about to fill leaves it open.
 */
export class MicRecorder extends EventEmitter<MicRecorderEvents> {
  public state: MicRecorderState
  public vad: VAD

  private mic: MicSource | undefined
  private isRecording = false
  private speakingConfirmed = false
  private sourceSampleRate = SAMPLE_RATE
  private reserve: Float32Array[] = []
  private reserveLength = 0
  private buffer: Float32Array[] = []
  private bufferLength = 0
  // Samples left before the echo of the speaker has died out
  private echoSamples = 0
  private speakerPlaying = false

  // The turn is open between the first confirmed word and the moment the
  // server is told to answer, which can span several pauses
  private turnOpen = false
  private turnListening = false
  private turnTimer: ReturnType<typeof setTimeout> | undefined
  // Bumped whenever the turn moves on, so a late answer is dropped
  private turnRound = 0

  constructor(
    private vadConfig?: VADConfig,
    private turnDetector?: TurnDetector,
    /**
     * How long a turn stays open once the detector asked to wait.
     *
     * The way out of a detector that hears an unfinished sentence where there
     * is none: the speaker who never comes back still gets an answer.
     */
    public turnMaxWait = DEFAULT_TURN_MAX_WAIT
  ) {
    super()

    // Set initial state
    this.state = defaultMicRecorderState
    // Init VAD
    this.vad = getVAD(vadConfig)
  }

  start = async (mic: MicSource) => {
    if (this.state.isStarted) {
      throw new Error('MicRecorder is already started')
    }
    try {
      // Update state to starting
      this.changeState({
        isStarting: true,
        isSpeaking: false,
      })
      this.mic = mic
      this.resetBuffers()

      // Listen to the captured audio
      mic.on('Frames', this.onFrames)

      // Start speaking detection
      await this.vad.start(mic)
      this.vad.on('StartSpeaking', this.onStartSpeaking)
      this.vad.on('ConfirmSpeaking', this.onConfirmSpeaking)
      this.vad.on('CancelSpeaking', this.onCancelSpeaking)
      this.vad.on('StopSpeaking', this.onStopSpeaking)

      this.changeState({
        isStarting: false,
        isStarted: true,
      })
    } catch (err) {
      this.stop()
      console.error(err)
    }
  }

  stop = () => {
    this.changeState({
      isStarting: false,
      isStarted: false,
      isSpeaking: false,
    })
    this.cancelPendingClose()

    try {
      // Stop listening to the captured audio
      this.mic?.off('Frames', this.onFrames)
      this.mic = undefined

      // Stop speaking detection
      this.vad.stop()
      this.vad.off('StartSpeaking', this.onStartSpeaking)
      this.vad.off('ConfirmSpeaking', this.onConfirmSpeaking)
      this.vad.off('CancelSpeaking', this.onCancelSpeaking)
      this.vad.off('StopSpeaking', this.onStopSpeaking)
    } catch (err) {
      console.error(err)
    }

    this.resetBuffers()
  }

  /**
   * Changes what decides when a turn is over
   * @param turnDetector - The new detector, or nothing to leave it to the VAD
   */
  changeTurnDetector = (turnDetector?: TurnDetector) => {
    if (turnDetector === this.turnDetector) return
    // A turn opened under the previous detector has to end somewhere
    if (this.turnOpen) {
      this.endTurn()
    }
    this.turnDetector = turnDetector
  }

  changeVad = (vadConfig: VADConfig) => {
    if (equalVADConfig(vadConfig, this.vadConfig)) return

    const mic = this.mic
    if (mic) {
      this.stop()
    }

    this.vadConfig = vadConfig
    this.vad = getVAD(vadConfig)

    if (mic) {
      this.start(mic)
    }
  }

  /**
   * Leaves out what the microphone hears while the speaker plays, so the
   * assistant is never sent back to the server as if the user had said it.
   *
   * Only for calls the user may not interrupt: an interruption relies on echo
   * cancellation, and needs every word the user says over the assistant.
   * @param playing - True while the assistant is heard
   */
  setSpeakerPlaying = (playing: boolean) => {
    if (playing === this.speakerPlaying) return
    this.speakerPlaying = playing
    if (!playing) {
      this.echoSamples = Math.round((ECHO_TAIL / 1000) * this.sourceSampleRate)
    }
  }

  private onFrames = (frames: Float32Array, sampleRate: number) => {
    // What the microphone hears while the speaker plays may be the speaker
    // itself, so it is dropped, reserve included
    if (this.speakerPlaying || this.echoSamples > 0) {
      this.echoSamples = Math.max(0, this.echoSamples - frames.length)
      this.reserve = []
      this.reserveLength = 0
      this.buffer = []
      this.bufferLength = 0
      return
    }

    // The detector hears the turn as it was spoken, pauses included, where the
    // stream sent to the server has the silences cut out of it
    if (this.turnListening) {
      this.turnDetector?.push(frames, sampleRate)
    }

    if (sampleRate !== this.sourceSampleRate) {
      // The device changed its mind about the sample rate, start over
      this.flushChunks()
      this.sourceSampleRate = sampleRate
      this.reserve = []
      this.reserveLength = 0
    }

    // Keep the last moments of audio, the VAD needs some of them to make up
    // its mind and the beginning of the sentence lives there. It keeps rolling
    // while recording, so a false start the VAD cancels leaves it intact for
    // the real one that often follows.
    this.reserve.push(frames)
    this.reserveLength += frames.length
    this.reserveLength = trimFrames(
      this.reserve,
      this.reserveLength,
      Math.round((this.vad.delay / 1000) * sampleRate)
    )

    if (!this.isRecording) return
    this.buffer.push(frames)
    this.bufferLength += frames.length
    if (this.speakingConfirmed) {
      this.flushChunks()
      return
    }

    // Held back until the speech is confirmed, keeping only what may belong
    // to its beginning
    this.bufferLength = trimFrames(
      this.buffer,
      this.bufferLength,
      Math.round(((this.vad.delay + CONFIRM_MARGIN) / 1000) * sampleRate)
    )
  }

  private onStartSpeaking = () => {
    this.speakingConfirmed = false

    // Start recording, from the reserve so nothing is cut off
    this.isRecording = true
    this.buffer = [...this.reserve]
    this.bufferLength = this.reserveLength

    // A new turn starts on the reserve too, so the model hears the first
    // syllable. An open turn keeps the audio it already has.
    if (this.turnDetector && !this.turnListening) {
      this.turnDetector.reset()
      this.turnListening = true
      for (const frames of this.buffer) {
        this.turnDetector.push(frames, this.sourceSampleRate)
      }
    }
  }

  private onConfirmSpeaking = () => {
    this.speakingConfirmed = true
    this.changeState({ isSpeaking: true })

    // The speaker picked their sentence back up, so the turn they had left
    // open carries on and the server keeps the same stream
    this.cancelPendingClose()
    if (!this.turnOpen) {
      this.turnOpen = true
      this.emit('StartSpeaking')
    }

    // Send what was recorded before the speech was confirmed
    this.flushChunks()
  }

  private onCancelSpeaking = () => {
    // It was only noise, forget it. A turn already open keeps waiting, and
    // keeps whatever timer it was running.
    this.stopRecording()
    if (!this.turnOpen) {
      this.turnListening = false
    }
  }

  private onStopSpeaking = () => {
    const wasConfirmed = this.speakingConfirmed
    this.changeState({ isSpeaking: false })

    // Send the tail of the sentence before closing the turn
    if (wasConfirmed) {
      this.flushChunks(true)
    }
    this.stopRecording()
    this.closeTurn()
  }

  /**
   * Ends the turn, unless the detector hears an unfinished sentence.
   *
   * A microphone that is no longer listening ends it straight away: a muted or
   * paused call has nothing more to say, whatever the sentence sounded like.
   */
  private async closeTurn() {
    if (
      !this.turnDetector ||
      !this.turnOpen ||
      !this.vad.isStarted ||
      this.vad.isPaused
    ) {
      this.endTurn()
      return
    }

    const round = this.turnRound
    try {
      const { complete } = await this.turnDetector.predict()
      // The speaker started again, or the call moved on, while it was thinking
      if (round !== this.turnRound) return
      if (complete) {
        this.endTurn()
        return
      }
    } catch (error) {
      console.error('[Micdrop] Turn detection failed', error)
      this.endTurn()
      return
    }

    // Leave the turn open, and close it if the sentence never comes back
    this.cancelPendingClose()
    this.turnTimer = setTimeout(() => {
      this.turnTimer = undefined
      this.endTurn()
    }, this.turnMaxWait)
  }

  private endTurn() {
    this.cancelPendingClose()
    this.turnOpen = false
    this.turnListening = false
    this.emit('StopSpeaking')
  }

  /** Drops the pending close, both the timer and the answer still owed */
  private cancelPendingClose() {
    this.turnRound++
    if (this.turnTimer) {
      clearTimeout(this.turnTimer)
      this.turnTimer = undefined
    }
  }

  private stopRecording() {
    this.isRecording = false
    this.speakingConfirmed = false
    this.buffer = []
    this.bufferLength = 0
  }

  /**
   * Emits every complete chunk waiting in the buffer
   * @param final - Also emit the incomplete last chunk
   */
  private flushChunks(final = false) {
    const chunkLength = Math.round(
      (CHUNK_INTERVAL / 1000) * this.sourceSampleRate
    )

    // Nothing leaves before the speech is confirmed
    if (!this.speakingConfirmed || this.bufferLength === 0) return
    if (this.bufferLength < chunkLength && !final) return

    const merged = concatFloat32(this.buffer)
    let offset = 0
    while (merged.length - offset >= chunkLength) {
      this.emitChunk(merged.subarray(offset, offset + chunkLength))
      offset += chunkLength
    }

    const rest = merged.subarray(offset)
    if (final && rest.length > 0) {
      this.emitChunk(rest)
      this.buffer = []
      this.bufferLength = 0
      return
    }
    this.buffer = rest.length ? [rest] : []
    this.bufferLength = rest.length
  }

  private emitChunk(samples: Float32Array) {
    const pcm = floatToPcm16(
      resample(samples, this.sourceSampleRate, SAMPLE_RATE)
    )

    this.emit('Chunk', pcm)
  }

  private resetBuffers() {
    this.isRecording = false
    this.speakingConfirmed = false
    this.turnOpen = false
    this.turnListening = false
    this.reserve = []
    this.reserveLength = 0
    this.buffer = []
    this.bufferLength = 0
  }

  private changeState(state: Partial<MicRecorderState>) {
    const hasChanged = Object.keys(state).some(
      (key) =>
        this.state[key as keyof MicRecorderState] !==
        state[key as keyof MicRecorderState]
    )
    if (!hasChanged) return
    this.state = { ...this.state, ...state }
    this.emit('StateChange', this.state)
  }
}

/**
 * Drops the oldest frames while the rest still covers `max` samples
 * @returns The number of samples left
 */
function trimFrames(frames: Float32Array[], length: number, max: number) {
  while (frames.length > 1 && length - frames[0].length >= max) {
    length -= frames[0].length
    frames.shift()
  }
  return length
}
