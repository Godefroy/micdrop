import { Pcm16Resampler, ReconnectingSocket, STT } from '@micdrop/server'
import { Readable } from 'stream'
import { parseMessage, sessionHandshake } from './session'
import { transcriptionLanguage } from './transcription'

/**
 * OpenAI Real-time STT
 *
 * @see https://platform.openai.com/docs/guides/speech-to-text
 */

export interface OpenaiSTTOptions {
  apiKey: string
  // gpt-4o-transcribe (default) and gpt-4o-mini-transcribe shut down on
  // February 26, 2027, replaced by gpt-live-transcribe and gpt-transcribe
  model?: string
  language?: string
  prompt?: string
  connectionTimeout?: number
  transcriptionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

const DEFAULT_MODEL = 'gpt-4o-transcribe'
const DEFAULT_LANGUAGE = 'en'
const SAMPLE_RATE = 16000 // Rate of the incoming audio (Micdrop client)
const OPENAI_SAMPLE_RATE = 24000 // Min rate accepted by the GA Realtime API
const DEFAULT_TRANSCRIPTION_TIMEOUT = 4000

/**
 * Where one utterance stands, until its transcript is emitted.
 *
 * - `streaming`: its audio is coming in
 * - `committed`: its audio is complete and committed, its transcript awaited
 */
type UtteranceStatus = 'streaming' | 'committed'

interface Utterance {
  // Sent as the event id of its commit, so an error can name it
  id: string
  status: UtteranceStatus
  // Kept until the transcript arrives, to send them again after a reconnection
  chunks: Buffer[]
  // Its own, so replaying one utterance never disturbs the state of another
  resampler: Pcm16Resampler
  // Given by the API when it acknowledges the commit
  itemId?: string
  // Gives up on the transcript, a single one per utterance
  timer?: NodeJS.Timeout
  // Settled, and waiting for the utterances spoken before it to be given
  transcript?: string
}

export class OpenaiSTT extends STT {
  private socket: ReconnectingSocket
  private utteranceCount = 0
  // Utterances not transcribed yet, in the order they were spoken. Each one
  // leaves the list with the single transcript it emits.
  private utterances: Utterance[] = []
  // Commits sent and not acknowledged yet, in the order the API handles them
  private unacknowledged: Utterance[] = []

  constructor(private options: OpenaiSTTOptions) {
    super()

    this.socket = new ReconnectingSocket({
      url: 'wss://api.openai.com/v1/realtime?intent=transcription',
      clientOptions: {
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
      },
      connectionTimeout: options.connectionTimeout,
      retryDelay: options.retryDelay,
      maxRetry: options.maxRetry,
      handshake: sessionHandshake,
      log: (...message) => this.log(...message),
    })
    this.socket.on('Open', () => this.onOpen())
    this.socket.on('Close', () => {
      // The acknowledgements of the lost session will never come
      this.unacknowledged = []
    })
    this.socket.on('Message', (data) => this.handleMessage(parseMessage(data)))
    this.socket.on('Failed', () => this.onFailed())
    this.socket.connect()
  }

  /**
   * Transcribes one utterance, and emits its transcript once, possibly empty
   * when none comes in time.
   *
   * After the connection was given up on, the next utterance tries it again.
   */
  transcribe(audioStream: Readable) {
    const utterance: Utterance = {
      id: `micdrop-stt-${++this.utteranceCount}`,
      status: 'streaming',
      chunks: [],
      resampler: new Pcm16Resampler(SAMPLE_RATE, OPENAI_SAMPLE_RATE),
    }
    this.utterances.push(utterance)
    this.socket.connect()

    // Read audio stream and send to OpenAI. Audio read while the connection is
    // not open is sent once it opens.
    audioStream.on('data', (chunk: Buffer) => {
      // Dropped by a failure or by destroy()
      if (!this.utterances.includes(utterance)) return
      utterance.chunks.push(chunk)
      this.sendAudioChunk(utterance, chunk)
    })

    // Handle stream end
    audioStream.on('end', () => {
      if (!this.utterances.includes(utterance)) return
      if (utterance.chunks.length === 0) {
        this.remove(utterance)
        return
      }
      utterance.status = 'committed'
      this.commitAudio(utterance)
    })
  }

  destroy() {
    super.destroy()
    this.socket.destroy()
    this.utterances.forEach((utterance) => clearTimeout(utterance.timer))
    this.utterances = []
    this.unacknowledged = []
  }

  private sendSessionUpdate() {
    const model = this.options.model || DEFAULT_MODEL

    // Configure the transcription session (GA Realtime API schema)
    this.socket.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: {
                type: 'audio/pcm',
                rate: OPENAI_SAMPLE_RATE,
              },
              transcription: {
                model,
                ...transcriptionLanguage(
                  model,
                  this.options.language || DEFAULT_LANGUAGE
                ),
                prompt:
                  this.options.prompt ||
                  'Transcribe the incoming audio in real time.',
              },
              // Disable server-side VAD: the Micdrop client already detects
              // speech and only streams audio while the user is talking, so we
              // commit the buffer manually at the end of each utterance.
              turn_detection: null,
              noise_reduction: {
                type: 'near_field',
              },
            },
          },
        },
      })
    )
  }

  /**
   * Configures the session, then sends again what a previous connection did
   * not get transcribed. The OpenAI buffer of a new session is empty, so each
   * utterance is replayed through a fresh resampler, which reproduces the exact
   * same stream, and committed again if it was.
   */
  private onOpen() {
    this.sendSessionUpdate()
    this.unacknowledged = []
    if (this.utterances.length > 0) this.log('Sending audio chunks again')
    for (const utterance of this.utterances) {
      // Already transcribed, it only waits for its turn to be given
      if (utterance.transcript !== undefined) continue
      utterance.itemId = undefined
      utterance.resampler = new Pcm16Resampler(SAMPLE_RATE, OPENAI_SAMPLE_RATE)
      utterance.chunks.forEach((chunk) => this.sendAudioChunk(utterance, chunk))
      if (utterance.status === 'committed') this.commitAudio(utterance)
    }
  }

  /** Every retry failed: the audio waiting for a transcript is handed back */
  private onFailed() {
    const chunks = this.utterances.flatMap((utterance) => utterance.chunks)
    this.utterances.forEach((utterance) => clearTimeout(utterance.timer))
    this.utterances = []
    this.unacknowledged = []
    this.emit('Failed', chunks)
  }

  private sendAudioChunk(utterance: Utterance, chunk: Buffer) {
    // Fed only with what is sent, so a replay starts from a clean state
    if (!this.socket.isOpen) return

    // Resample 16kHz -> 24kHz (GA Realtime API requires a rate >= 24kHz)
    const resampled = utterance.resampler.process(chunk)
    if (resampled.length === 0) return

    this.socket.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: resampled.toString('base64'),
      })
    )
  }

  private commitAudio(utterance: Utterance) {
    // Committed on the next connection otherwise
    if (!this.socket.isOpen) return
    this.socket.send(
      JSON.stringify({
        type: 'input_audio_buffer.commit',
        event_id: utterance.id,
      })
    )
    this.unacknowledged.push(utterance)
    this.log('Committed audio buffer')

    // Timeout transcription if no transcript is received. A commit sent again
    // after a reconnection gives the new session the full delay.
    clearTimeout(utterance.timer)
    utterance.timer = setTimeout(() => {
      utterance.timer = undefined
      this.log('Transcription timeout')
      this.finish(utterance, '')
    }, this.options.transcriptionTimeout || DEFAULT_TRANSCRIPTION_TIMEOUT)
  }

  /**
   * Settles the transcript of an utterance, the only one it gets.
   *
   * The API transcribes each utterance on its own and may finish a short one
   * before a long one spoken earlier, so transcripts go out in the order the
   * utterances were spoken.
   */
  private finish(utterance: Utterance, transcript: string) {
    if (!this.utterances.includes(utterance)) return
    if (utterance.transcript !== undefined) return
    clearTimeout(utterance.timer)
    utterance.timer = undefined
    utterance.transcript = transcript
    while (this.utterances[0]?.transcript !== undefined) {
      const first = this.utterances[0]
      this.remove(first)
      this.emit('Transcript', first.transcript!)
    }
  }

  private remove(utterance: Utterance) {
    clearTimeout(utterance.timer)
    utterance.timer = undefined
    this.utterances = this.utterances.filter((other) => other !== utterance)
    this.unacknowledged = this.unacknowledged.filter(
      (other) => other !== utterance
    )
  }

  /**
   * The utterance a transcript event is about. The API names the item, and
   * the item of each utterance is known from the acknowledgement of its
   * commit. A transcript of an utterance that timed out matches none.
   */
  private findUtterance(itemId?: string) {
    if (!itemId) {
      return this.utterances.find(
        ({ status, transcript }) =>
          status === 'committed' && transcript === undefined
      )
    }
    return this.utterances.find((utterance) => utterance.itemId === itemId)
  }

  private handleMessage(message: any) {
    switch (message?.type) {
      case 'input_audio_buffer.committed': {
        const utterance = this.unacknowledged.shift()
        if (utterance) utterance.itemId = message.item_id
        break
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = message.transcript || ''
        this.log(`Received completed transcript: "${transcript}"`)
        const utterance = this.findUtterance(message.item_id)
        if (!utterance) {
          this.log('Transcript of an utterance already given up on, ignored')
          break
        }
        this.finish(utterance, transcript)
        break
      }

      case 'conversation.item.input_audio_transcription.failed': {
        this.log('Transcription failed:', message.error)
        const utterance = this.findUtterance(message.item_id)
        if (utterance) this.finish(utterance, '')
        break
      }

      case 'error': {
        this.log('Error:', message.error)
        // A refused commit, of a buffer too short for instance, is never
        // acknowledged nor transcribed
        const utterance = this.utterances.find(
          ({ id }) => id === message.error?.event_id
        )
        if (utterance) this.finish(utterance, '')
        break
      }

      default:
        break
    }
  }
}
