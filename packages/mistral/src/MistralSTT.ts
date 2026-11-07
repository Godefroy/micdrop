import { ReconnectingSocket, STT } from '@micdrop/server'
import { Readable } from 'stream'
import type { RawData } from 'ws'

/**
 * Mistral Real-time STT (Voxtral)
 *
 * @see https://docs.mistral.ai/studio/audio/speech-to-text/overview
 */

export type MistralAudioEncoding =
  | 'pcm_s16le'
  | 'pcm_s32le'
  | 'pcm_f16le'
  | 'pcm_f32le'
  | 'pcm_mulaw'
  | 'pcm_alaw'

export interface MistralSTTOptions {
  apiKey: string
  model?: string
  encoding?: MistralAudioEncoding
  targetStreamingDelayMs?: number
  /** How long a connection attempt may take */
  connectionTimeout?: number
  /** How long an utterance waits for its transcript once it ended */
  transcriptionTimeout?: number
  /** Delay between two connection attempts */
  retryDelay?: number
  /** How many attempts in a row may fail before `Failed` is emitted */
  maxRetry?: number
}

/**
 * Where an utterance stands.
 *
 * - `streaming`: its audio is still coming
 * - `flushing`: its audio ended and was flushed, it waits for
 *   `transcription.done`
 * - `done`: its transcript was emitted, or it was dropped
 */
type UtteranceStatus = 'streaming' | 'flushing' | 'done'

/** One audio stream given to `transcribe()`, which gets exactly one transcript */
interface Utterance {
  status: UtteranceStatus
  // Audio of the utterance, kept to send it again on a new session
  chunks: Buffer[]
  // Accumulated transcription.text.delta chunks of the current session
  text: string
  // Runs once the flush went out
  timeout?: ReturnType<typeof setTimeout>
}

const DEFAULT_MODEL = 'voxtral-mini-transcribe-realtime-3-0'
const DEFAULT_ENCODING: MistralAudioEncoding = 'pcm_s16le'
const SAMPLE_RATE = 16000 // Rate of the incoming audio (Micdrop client)
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_TRANSCRIPTION_TIMEOUT = 4000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

export class MistralSTT extends STT {
  private socket: ReconnectingSocket
  // Utterances not done yet, oldest first. The server answers them in the
  // order their audio went out, so the transcript in progress is the oldest's.
  private utterances: Utterance[] = []
  // Flushes of utterances that timed out on this session, whose deltas and
  // transcription.done may still arrive and must not go to the next one. Each
  // is forgotten after another timeout, so an answer that never comes does not
  // swallow every transcript after it.
  private staleFlushes: number[] = []

  constructor(private options: MistralSTTOptions) {
    super()

    this.socket = new ReconnectingSocket({
      url: this.getURL(),
      clientOptions: {
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
        },
      },
      connectionTimeout:
        this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT,
      retryDelay: this.options.retryDelay ?? DEFAULT_RETRY_DELAY,
      maxRetry: this.options.maxRetry ?? DEFAULT_MAX_RETRY,
      // The audio format must be set before any audio is appended
      handshake: {
        start: (socket) => socket.send(this.getSessionUpdate()),
      },
      log: (...message) => this.log(...message),
    })
    this.socket.on('Open', this.onOpen)
    this.socket.on('Message', this.onMessage)
    this.socket.on('Failed', this.onFailed)
    this.socket.connect()
  }

  transcribe(audioStream: Readable) {
    // After giving up, a new utterance gives the connection another chance
    this.socket.connect()

    const utterance: Utterance = { status: 'streaming', chunks: [], text: '' }
    this.utterances.push(utterance)

    // Read audio stream and send to Mistral
    audioStream.on('data', (chunk: Buffer) => {
      if (utterance.status !== 'streaming') return
      utterance.chunks.push(chunk)
      // A chunk that does not go out now goes with the others once connected
      if (this.sendAudioChunk(chunk)) {
        this.log(`Sent audio chunk (${chunk.byteLength} bytes)`)
      }
    })

    // Handle stream end: flush buffered audio so the server finalizes the
    // transcription (transcription.done). Unlike input_audio.end, a flush keeps
    // the session alive, so the same connection is reused for the next utterance.
    audioStream.on('end', () => this.endUtterance(utterance))
  }

  destroy() {
    super.destroy()
    this.socket.destroy()
    this.utterances.forEach((utterance) => this.dropUtterance(utterance))
    this.utterances = []
  }

  private getURL() {
    const model = this.options.model || DEFAULT_MODEL
    return `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(
      model
    )}`
  }

  private getSessionUpdate() {
    // Configure the audio format. Must be sent before any audio is appended;
    // Mistral rejects format updates once audio has started.
    return JSON.stringify({
      type: 'session.update',
      session: {
        audio_format: {
          encoding: this.options.encoding || DEFAULT_ENCODING,
          sample_rate: SAMPLE_RATE,
        },
        ...(this.options.targetStreamingDelayMs !== undefined && {
          target_streaming_delay_ms: this.options.targetStreamingDelayMs,
        }),
      },
    })
  }

  // A new session knows nothing of the previous one: every pending utterance
  // is sent again in full and replays its whole transcript, so the deltas it
  // gathered start over to avoid duplicating them
  private onOpen = ({ reconnected }: { reconnected: boolean }) => {
    this.staleFlushes = []
    const pending = this.utterances.filter(
      (utterance) => utterance.chunks.length > 0
    )
    if (pending.length === 0) return
    this.log(
      reconnected ? 'Sending audio chunks again' : 'Sending queued audio chunks'
    )
    for (const utterance of pending) {
      utterance.text = ''
      utterance.chunks.forEach((chunk) => this.sendAudioChunk(chunk))
      if (utterance.status === 'flushing') this.flushAudio(utterance)
    }
  }

  private onMessage = (data: RawData) => {
    let message: any
    try {
      message = JSON.parse(data.toString())
    } catch {
      this.log('Ignoring a message that is not JSON')
      return
    }

    switch (message.type) {
      case 'transcription.text.delta': {
        if (typeof message.text !== 'string') break
        this.log(`Received transcript delta: "${message.text}"`)
        // Deltas of an utterance that timed out are dropped with it
        if (this.hasStaleFlush()) break
        const utterance = this.utterances[0]
        if (utterance) utterance.text += message.text
        break
      }

      case 'transcription.done': {
        // The answer to a flush whose utterance already timed out
        if (this.hasStaleFlush()) {
          this.staleFlushes.shift()
          this.log('Ignoring the transcript of a timed out utterance')
          break
        }
        const utterance = this.utterances[0]
        // Only a flush finalizes a transcript: one that was not asked for
        // leaves the utterance in progress alone
        if (utterance?.status !== 'flushing') {
          this.log('Ignoring an unexpected transcription.done')
          break
        }
        const transcript =
          typeof message.text === 'string' ? message.text : utterance.text
        this.log(`Received completed transcript: "${transcript}"`)
        this.complete(utterance, transcript)
        break
      }

      case 'error':
        this.log('Error:', message.error ?? message)
        break

      default:
        break
    }
  }

  private onFailed = () => {
    // Every pending utterance goes back to the caller, for another STT
    const chunks = this.utterances.flatMap((utterance) => utterance.chunks)
    this.utterances.forEach((utterance) => this.dropUtterance(utterance))
    this.utterances = []
    this.emit('Failed', chunks)
  }

  private endUtterance(utterance: Utterance) {
    if (utterance.status !== 'streaming') return
    // A stream that carried no audio expects no transcript
    if (utterance.chunks.length === 0) {
      this.removeUtterance(utterance)
      return
    }
    utterance.status = 'flushing'
    // Not connected yet: the flush goes out with the audio, on `Open`
    if (this.socket.isOpen) this.flushAudio(utterance)
  }

  private flushAudio(utterance: Utterance) {
    // Flush buffered audio so the server processes the tail and emits a final
    // transcription.done for this utterance. We deliberately do NOT send
    // input_audio.end: that terminates the session (the server drops the
    // connection), whereas a flush finalizes the current utterance and keeps the
    // session ready for the next one.
    if (!this.socket.send(JSON.stringify({ type: 'input_audio.flush' }))) {
      return
    }
    this.log('Flushed audio input')

    // Timeout transcription if no transcript is received, with the deltas
    // received so far
    clearTimeout(utterance.timeout)
    utterance.timeout = setTimeout(() => {
      this.log('Transcription timeout')
      // Its flush is still answered later on this session, and that answer
      // belongs to no other utterance
      this.staleFlushes.push(Date.now() + this.transcriptionTimeout)
      this.complete(utterance, utterance.text)
    }, this.transcriptionTimeout)
  }

  private get transcriptionTimeout(): number {
    return this.options.transcriptionTimeout || DEFAULT_TRANSCRIPTION_TIMEOUT
  }

  /** Whether an answer to a timed out flush may still be on its way */
  private hasStaleFlush(): boolean {
    const now = Date.now()
    while (this.staleFlushes.length > 0 && this.staleFlushes[0] <= now) {
      this.log('Forgetting a flush that was never answered')
      this.staleFlushes.shift()
    }
    return this.staleFlushes.length > 0
  }

  private complete(utterance: Utterance, transcript: string) {
    if (utterance.status === 'done') return
    this.removeUtterance(utterance)
    this.emit('Transcript', transcript.trim())
  }

  private removeUtterance(utterance: Utterance) {
    this.dropUtterance(utterance)
    this.utterances = this.utterances.filter((u) => u !== utterance)
  }

  private dropUtterance(utterance: Utterance) {
    utterance.status = 'done'
    clearTimeout(utterance.timeout)
    utterance.timeout = undefined
  }

  private sendAudioChunk(chunk: Buffer): boolean {
    return this.socket.send(
      JSON.stringify({
        type: 'input_audio.append',
        audio: chunk.toString('base64'),
      })
    )
  }
}
