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

export class GeminiSTT extends STT {
  private socket: LiveSocket
  private goingAway = false
  // Audio of the utterance, sent again if the connection drops before its
  // transcript comes back
  private chunks: Buffer[] = []
  private utteranceOpen = false
  private utteranceEnded = false
  private transcript = ''
  private transcriptionTimeout?: NodeJS.Timeout

  constructor(private readonly options: GeminiSTTOptions) {
    super()
    this.socket = new LiveSocket(
      options,
      () => this.buildSetup(),
      (...message) => this.log(...message)
    )
    this.socket.on('Message', this.onMessage)
    this.socket.on('Reconnecting', this.onReconnecting)
    this.socket.on('Failed', () => this.emit('Failed', this.chunks))
    this.socket.connect()
  }

  transcribe(audioStream: Readable) {
    audioStream.on('data', (chunk: Buffer) => {
      if (!this.utteranceOpen) this.openUtterance()
      this.chunks.push(chunk)
      this.sendAudio(chunk)
    })

    audioStream.on('end', () => {
      if (!this.utteranceOpen || this.utteranceEnded) return
      this.utteranceEnded = true
      this.socket.send({ realtimeInput: { activityEnd: {} } })

      // Give up on a transcript that never comes
      this.clearTranscriptionTimeout()
      this.transcriptionTimeout = setTimeout(() => {
        this.transcriptionTimeout = undefined
        this.log('Transcription timeout')
        this.finishUtterance()
      }, this.options.transcriptionTimeout ?? DEFAULT_TRANSCRIPTION_TIMEOUT)
    })
  }

  destroy() {
    super.destroy()
    this.clearTranscriptionTimeout()
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

  private openUtterance() {
    // An utterance still waiting for its transcript is left behind
    if (this.utteranceOpen) this.finishUtterance()
    this.utteranceOpen = true
    this.utteranceEnded = false
    this.chunks = []
    this.transcript = ''
    this.socket.send({ realtimeInput: { activityStart: {} } })
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

  /** Emits what was transcribed of the utterance, possibly nothing */
  private finishUtterance() {
    this.clearTranscriptionTimeout()
    const transcript = this.transcript.trim()
    this.utteranceOpen = false
    this.utteranceEnded = false
    this.chunks = []
    this.transcript = ''
    this.log(`Transcript: "${transcript}"`)
    this.emit('Transcript', transcript)
    if (this.goingAway) {
      this.goingAway = false
      this.socket.renew()
    }
  }

  private onMessage = (message: any) => {
    const content = message.serverContent
    if (content?.inputTranscription?.text && this.utteranceOpen) {
      this.transcript += content.inputTranscription.text
    }
    if (content?.generationComplete && this.utteranceEnded) {
      this.finishUtterance()
    }

    // Gemini closes a session after some minutes, move on between utterances
    if (message.goAway) {
      this.log('Connection ending in', message.goAway.timeLeft)
      if (this.utteranceOpen) {
        this.goingAway = true
      } else {
        this.socket.renew()
      }
    }
  }

  private onReconnecting = () => {
    // A new session knows nothing of the utterance, so it starts over
    this.socket.clearPending()
    if (!this.utteranceOpen) return
    this.transcript = ''
    this.socket.send({ realtimeInput: { activityStart: {} } })
    this.chunks.forEach((chunk) => this.sendAudio(chunk))
    if (this.utteranceEnded) {
      this.socket.send({ realtimeInput: { activityEnd: {} } })
    }
  }

  private clearTranscriptionTimeout() {
    if (!this.transcriptionTimeout) return
    clearTimeout(this.transcriptionTimeout)
    this.transcriptionTimeout = undefined
  }
}
