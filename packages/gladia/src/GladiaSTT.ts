import { DeepPartial, ReconnectingSocket, STT } from '@micdrop/server'
import { Readable } from 'stream'
import type { RawData } from 'ws'
import { GladiaLiveSessionPayload } from './types'

/**
 * Gladia Real-time V2 STT
 *
 * @see https://docs.gladia.io/chapters/live-stt/getting-started
 */

export interface GladiaSTTOptions {
  apiKey: string
  settings?: DeepPartial<GladiaLiveSessionPayload>
  /** How long a connection attempt may take, session request included */
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
 * - `finishing`: its audio ended, it waits for Gladia to finalize its words
 * - `done`: its transcript was emitted, or it was dropped
 */
type UtteranceStatus = 'streaming' | 'finishing' | 'done'

/** A segment Gladia transcribes, identified by its utterance id */
interface Segment {
  text: string
  final: boolean
}

/** One audio stream given to `transcribe()`, which gets exactly one transcript */
interface Utterance {
  status: UtteranceStatus
  // Audio of the utterance, kept to send it again on a new session
  chunks: Buffer[]
  // Seconds into the current session where its audio stops, silence excluded,
  // known once all of it was sent
  audioEnd?: number
  // Segments Gladia reported for it on the current session, in order
  segments: Map<string, Segment>
  // Runs once the whole utterance reached Gladia
  timeout?: ReturnType<typeof setTimeout>
  // Runs once every segment is final, in case another one is about to start
  grace?: ReturnType<typeof setTimeout>
}

const SAMPLE_RATE = 16000
const BIT_DEPTH = 16
const BYTES_PER_SECOND = (SAMPLE_RATE * BIT_DEPTH) / 8
const SILENCE_SECONDS = 2
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_TRANSCRIPTION_TIMEOUT = 4000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3
// How long an utterance whose segments are all final waits for one more. A
// pause in the middle of the speech splits it, and the final of the first part
// can come before the first partial of the next.
const FINAL_GRACE = 500 // ms

export class GladiaSTT extends STT {
  private socket: ReconnectingSocket
  // Utterances not done yet, oldest first
  private utterances: Utterance[] = []
  // Audio sent on the current session, to place the segments Gladia reports
  private sessionBytes = 0
  // Seconds into the current session up to which every utterance is done, so
  // a segment starting before belongs to none of the pending ones
  private doneUntil = 0

  constructor(private options: GladiaSTTOptions) {
    super()

    // Each connection needs a session URL of its own, requested on every
    // attempt so that a failed request uses the same retry budget
    this.socket = new ReconnectingSocket({
      url: this.getURL,
      connectionTimeout:
        this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT,
      retryDelay: this.options.retryDelay ?? DEFAULT_RETRY_DELAY,
      maxRetry: this.options.maxRetry ?? DEFAULT_MAX_RETRY,
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

    const utterance: Utterance = {
      status: 'streaming',
      chunks: [],
      segments: new Map(),
    }
    this.utterances.push(utterance)

    // Read transformed stream and send to Gladia
    audioStream.on('data', (chunk: Buffer) => {
      if (utterance.status !== 'streaming') return
      utterance.chunks.push(chunk)
      // A chunk that does not go out now goes with the others once connected
      if (this.sendAudio(chunk)) {
        this.log(`Sent audio chunk (${chunk.byteLength} bytes)`)
      }
    })

    audioStream.on('end', () => this.endUtterance(utterance))
  }

  destroy() {
    super.destroy()
    this.socket.destroy()
    this.utterances.forEach((utterance) => this.dropUtterance(utterance))
    this.utterances = []
  }

  // Register real-time transcription to get a WebSocket URL
  private getURL = async (): Promise<string> => {
    const response = await fetch('https://api.gladia.io/v2/live', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gladia-Key': this.options.apiKey,
      },
      body: JSON.stringify({
        encoding: 'wav/pcm',
        sample_rate: SAMPLE_RATE,
        bit_depth: BIT_DEPTH,
        channels: 1,
        ...this.options.settings,
        messages_config: {
          receive_final_transcripts: true,
          // Partial transcripts tell which segments are still being heard,
          // so an utterance waits for all of them before it is complete
          receive_partial_transcripts: true,
          receive_speech_events: false,
          receive_pre_processing_events: false,
          receive_realtime_processing_events: false,
          receive_post_processing_events: false,
          receive_acknowledgments: false,
          receive_errors: true,
          receive_lifecycle_events: false,
          ...this.options.settings?.messages_config,
        },
      }),
      // The connection timeout only starts with the WebSocket, so the request
      // gets one of its own to keep the attempt from hanging
      signal: AbortSignal.timeout(
        this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT
      ),
    })

    if (!response.ok) {
      throw new Error(
        `Session request failed: ${response.status} ${response.statusText}`
      )
    }

    const { url } = (await response.json()) as { url: string }
    return url
  }

  // A new session knows nothing of the previous one: every pending utterance
  // is sent again in full, and its segments start over
  private onOpen = ({ reconnected }: { reconnected: boolean }) => {
    this.sessionBytes = 0
    this.doneUntil = 0
    const pending = this.utterances.filter(
      (utterance) => utterance.chunks.length > 0
    )
    if (pending.length === 0) return
    this.log(
      reconnected ? 'Sending audio chunks again' : 'Sending queued audio chunks'
    )
    for (const utterance of pending) {
      utterance.segments.clear()
      utterance.audioEnd = undefined
      utterance.chunks.forEach((chunk) => this.sendAudio(chunk))
      if (utterance.status === 'finishing') this.sendEnd(utterance)
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

    if (message.type === 'error') {
      this.log('Error:', message.error ?? message)
      return
    }
    if (message.type !== 'transcript' || !message.data?.utterance) return

    const { id, is_final, utterance: result } = message.data
    const utterance = this.findUtterance(id, result.start)
    if (!utterance) {
      this.log(`Ignoring a segment of a finished utterance: "${result.text}"`)
      return
    }
    utterance.segments.set(id, { text: result.text ?? '', final: !!is_final })
    if (is_final) this.log(`Received transcript: "${result.text}"`)
    this.completeIfFinal(utterance)
  }

  private onFailed = () => {
    // Every pending utterance goes back to the caller, for another STT
    const chunks = this.utterances.flatMap((utterance) => utterance.chunks)
    this.utterances.forEach((utterance) => this.dropUtterance(utterance))
    this.utterances = []
    this.emit('Failed', chunks)
  }

  // The utterance a segment belongs to: the one it was already given to, or
  // the oldest pending one whose audio reaches the segment's start
  private findUtterance(id: string, start: number): Utterance | undefined {
    const owner = this.utterances.find((utterance) =>
      utterance.segments.has(id)
    )
    if (owner) return owner
    if (start < this.doneUntil) return undefined
    return this.utterances.find(
      (utterance) =>
        utterance.audioEnd === undefined || start < utterance.audioEnd
    )
  }

  private endUtterance(utterance: Utterance) {
    if (utterance.status !== 'streaming') return
    // A stream that carried no audio expects no transcript
    if (utterance.chunks.length === 0) {
      this.removeUtterance(utterance)
      return
    }
    utterance.status = 'finishing'
    // Not connected yet: the end goes out with the audio, on `Open`
    if (this.socket.isOpen) this.sendEnd(utterance)
  }

  // Marks where the utterance stops, and sends silence to force Gladia to
  // finalize its last words
  private sendEnd(utterance: Utterance) {
    utterance.audioEnd = this.sessionBytes / BYTES_PER_SECOND
    const silence = Buffer.alloc(SILENCE_SECONDS * BYTES_PER_SECOND)
    if (!this.sendAudio(silence)) return
    this.log(
      `Sent ${SILENCE_SECONDS * 1000}ms of silence (${silence.byteLength} bytes) after stream end`
    )

    // Timeout transcription if Gladia never finalizes it, with what it heard
    clearTimeout(utterance.timeout)
    utterance.timeout = setTimeout(() => {
      this.log('Transcription timeout')
      this.complete(utterance, false)
    }, this.options.transcriptionTimeout || DEFAULT_TRANSCRIPTION_TIMEOUT)

    // Its last words may have been final before its end went out
    this.completeIfFinal(utterance)
  }

  // An utterance is complete once its audio ended and every segment Gladia
  // reported for it stayed final for a moment. One without any segment waits
  // for its timeout.
  private completeIfFinal(utterance: Utterance) {
    if (utterance.status !== 'finishing' || utterance.audioEnd === undefined)
      return
    const segments = [...utterance.segments.values()]
    const allFinal =
      segments.length > 0 && segments.every((segment) => segment.final)
    if (!allFinal) {
      // A new segment started, the utterance goes on
      clearTimeout(utterance.grace)
      utterance.grace = undefined
      return
    }
    utterance.grace ??= setTimeout(() => {
      utterance.grace = undefined
      this.complete(utterance, true)
    }, FINAL_GRACE)
  }

  private complete(utterance: Utterance, finalOnly: boolean) {
    if (utterance.status === 'done') return
    // Gladia finalizes in order: once it is done with this utterance, it is
    // done with the earlier ones too, so they go first with what they have
    // and the transcripts keep the order of the speech
    for (const earlier of this.utterances) {
      if (earlier === utterance) break
      if (earlier.status === 'finishing') this.complete(earlier, true)
    }
    const transcript = [...utterance.segments.values()]
      .filter((segment) => !finalOnly || segment.final)
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(' ')
    if (utterance.audioEnd !== undefined) {
      this.doneUntil = Math.max(this.doneUntil, utterance.audioEnd)
    }
    this.removeUtterance(utterance)
    this.log(`Utterance transcript: "${transcript}"`)
    this.emit('Transcript', transcript)
  }

  private removeUtterance(utterance: Utterance) {
    this.dropUtterance(utterance)
    this.utterances = this.utterances.filter((u) => u !== utterance)
  }

  private dropUtterance(utterance: Utterance) {
    utterance.status = 'done'
    clearTimeout(utterance.timeout)
    utterance.timeout = undefined
    clearTimeout(utterance.grace)
    utterance.grace = undefined
  }

  private sendAudio(chunk: Buffer): boolean {
    if (!this.socket.send(chunk)) return false
    this.sessionBytes += chunk.byteLength
    return true
  }
}
