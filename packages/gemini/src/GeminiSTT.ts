import { STT } from '@micdrop/server'
import { Readable } from 'stream'
import { LiveSocket } from './LiveSocket'

/**
 * Gemini Transcribe, streamed over the Live API
 *
 * @see https://ai.google.dev/gemini-api/docs/live-api/live-transcribe
 *
 * The Micdrop client already tells when the user speaks, so the automatic
 * activity detection of Gemini is off: each utterance is framed by
 * activityStart and activityEnd, and its final transcript follows the end.
 */

export interface GeminiSTTOptions {
  apiKey: string
  model?: string
  // Language of the user, as a BCP-47 code such as "fr-FR". Detected when
  // left out.
  language?: string
  // Words to recognize, such as product or people names
  vocabulary?: string[]
  // SMART cleans up hesitations and repetitions, VERBATIM keeps them
  mode?: 'SMART' | 'VERBATIM'
  connectionTimeout?: number
  transcriptionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

const DEFAULT_MODEL = 'gemini-3.5-transcribe-live'
const SAMPLE_RATE = 16000 // Rate of the Micdrop client, taken as is by Gemini
const DEFAULT_TRANSCRIPTION_TIMEOUT = 4000

/**
 * What was said in one audio stream given to `transcribe`.
 *
 * - `open`: its audio is going out
 * - `ended`: the stream ended, its transcript is on its way
 * - `given`: its transcript went out on a timeout. It stays first in line to
 *   take the late answer of Gemini, which belongs to no other utterance,
 *   until that answer ends or another timeout passes.
 */
interface Utterance {
  state: 'open' | 'ended' | 'given'
  // Whether its audio went to Gemini, which hears the first one only
  sent: boolean
  // Audio of the utterance, sent again if the connection drops before its
  // transcript comes back
  chunks: Buffer[]
  transcript: string
  timeout?: NodeJS.Timeout
}

export class GeminiSTT extends STT {
  private socket: LiveSocket
  // Gemini closes the session soon, and it is renewed once nothing waits
  private goingAway = false
  // Utterances waiting for their transcript, in the order they were spoken.
  // Gemini names no utterance in what it sends, and goes on to the next one
  // before it is done with the previous. So it hears one at a time: the first
  // one, and the audio of the next waits here until its transcript is in.
  private utterances: Utterance[] = []

  constructor(private readonly options: GeminiSTTOptions) {
    super()
    this.socket = new LiveSocket(
      options,
      () => this.buildSetup(),
      (...message) => this.log(...message)
    )
    this.socket.on('Ready', this.onReady)
    this.socket.on('Message', this.onMessage)
    this.socket.on('Reconnecting', this.onReconnecting)
    this.socket.on('Failed', this.onFailed)
    this.socket.connect()
  }

  transcribe(audioStream: Readable) {
    // Each stream has an utterance of its own, opened by its first audio
    let utterance: Utterance | undefined

    audioStream.on('data', (chunk: Buffer) => {
      if (!utterance) utterance = this.openUtterance()
      // Ended early by the stream that came next
      if (utterance.state !== 'open') return
      utterance.chunks.push(chunk)
      if (utterance.sent) this.sendAudio(chunk)
    })

    audioStream.on('end', () => {
      if (utterance?.state === 'open') this.endUtterance(utterance)
    })
  }

  destroy() {
    super.destroy()
    this.dropUtterances()
    this.socket.destroy()
  }

  private buildSetup() {
    return {
      setup: {
        model: `models/${this.options.model || DEFAULT_MODEL}`,
        generationConfig: { responseModalities: ['TEXT'] },
        inputAudioTranscription: {
          languageCodes: this.options.language ? [this.options.language] : [],
          ...(this.options.vocabulary?.length
            ? { customVocabulary: this.options.vocabulary }
            : {}),
          ...(this.options.mode ? { mode: this.options.mode } : {}),
        },
        // The Micdrop client detects when the user speaks
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: true },
        },
      },
    }
  }

  private openUtterance(): Utterance {
    // Gemini hears one utterance at a time, so one still open ends here
    const last = this.utterances[this.utterances.length - 1]
    if (last?.state === 'open') this.endUtterance(last)
    const utterance: Utterance = {
      state: 'open',
      sent: false,
      chunks: [],
      transcript: '',
    }
    this.utterances.push(utterance)
    this.sendFirst()
    return utterance
  }

  private endUtterance(utterance: Utterance) {
    utterance.state = 'ended'
    if (utterance.sent) this.sendEnd(utterance)
  }

  /** Sends the first utterance to Gemini, with the audio it held meanwhile */
  private sendFirst() {
    const utterance = this.utterances[0]
    if (!utterance || utterance.sent) return
    utterance.sent = true
    this.socket.send({ realtimeInput: { activityStart: {} } })
    utterance.chunks.forEach((chunk) => this.sendAudio(chunk))
    if (utterance.state === 'ended') this.sendEnd(utterance)
  }

  private sendEnd(utterance: Utterance) {
    this.socket.send({ realtimeInput: { activityEnd: {} } })

    // Give up on a transcript that never comes. It counts from the moment
    // Gemini heard the whole utterance, not from when it waited its turn.
    utterance.timeout = setTimeout(() => {
      utterance.timeout = undefined
      this.log('Transcription timeout')
      this.give(utterance)
    }, this.options.transcriptionTimeout ?? DEFAULT_TRANSCRIPTION_TIMEOUT)
  }

  private sendAudio(chunk: Buffer) {
    this.socket.send({
      realtimeInput: {
        audio: {
          mimeType: `audio/pcm;rate=${SAMPLE_RATE}`,
          data: chunk.toString('base64'),
        },
      },
    })
  }

  /**
   * Emits what was transcribed of an utterance, possibly nothing, and keeps
   * it in line for what Gemini still sends about it
   */
  private give(utterance: Utterance) {
    if (utterance.timeout) clearTimeout(utterance.timeout)
    utterance.state = 'given'
    const transcript = utterance.transcript.trim()
    this.log(`Transcript: "${transcript}"`)
    this.emit('Transcript', transcript)
    utterance.timeout = setTimeout(
      () => this.remove(utterance),
      this.options.transcriptionTimeout ?? DEFAULT_TRANSCRIPTION_TIMEOUT
    )
  }

  private remove(utterance: Utterance) {
    if (utterance.timeout) clearTimeout(utterance.timeout)
    utterance.timeout = undefined
    this.utterances = this.utterances.filter((other) => other !== utterance)
    this.renewIfGoingAway()
    this.sendFirst()
  }

  /** Moves to a new connection once no utterance waits on this one */
  private renewIfGoingAway() {
    if (!this.goingAway || this.utterances.length > 0) return
    this.goingAway = false
    this.socket.renew()
  }

  private onReady = () => {
    this.goingAway = false
  }

  private onMessage = (message: any) => {
    const content = message.serverContent
    const utterance = this.utterances[0]
    if (content?.inputTranscription?.text && utterance) {
      utterance.transcript += content.inputTranscription.text
    }
    if (content?.generationComplete && utterance) {
      if (utterance.state === 'ended') this.give(utterance)
      if (utterance.state === 'given') this.remove(utterance)
    }

    // Gemini closes a session after some minutes, move on between utterances
    if (message.goAway) {
      this.log('Connection ending in', message.goAway.timeLeft)
      this.goingAway = true
      this.renewIfGoingAway()
    }
  }

  private onReconnecting = () => {
    // A new session knows nothing of the utterances, so they start over
    this.goingAway = false
    this.socket.clearPending()
    // Those already given wait for nothing more from the old session
    for (const utterance of this.utterances) {
      if (utterance.state === 'given') this.remove(utterance)
    }
    for (const utterance of this.utterances) {
      if (utterance.timeout) clearTimeout(utterance.timeout)
      utterance.timeout = undefined
      utterance.sent = false
      utterance.transcript = ''
    }
    this.sendFirst()
  }

  private onFailed = () => {
    // The audio nobody transcribed goes to whoever takes over
    const chunks = this.utterances
      .filter((utterance) => utterance.state !== 'given')
      .flatMap((utterance) => utterance.chunks)
    this.dropUtterances()
    this.emit('Failed', chunks)
  }

  private dropUtterances() {
    for (const utterance of this.utterances) {
      if (utterance.timeout) clearTimeout(utterance.timeout)
      // A stream still open stops sending audio
      if (utterance.state === 'open') utterance.state = 'ended'
    }
    this.utterances = []
  }
}
