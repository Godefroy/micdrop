import { STT } from '@micdrop/server'
import { Readable } from 'stream'
import WebSocket from 'ws'

/**
 * Mistral Real-time STT (Voxtral)
 *
 * @see https://docs.mistral.ai/studio-api/audio/speech_to_text/realtime_transcription
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
  connectionTimeout?: number
  transcriptionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

const DEFAULT_MODEL = 'voxtral-mini-transcribe-realtime-2602'
const DEFAULT_ENCODING: MistralAudioEncoding = 'pcm_s16le'
const SAMPLE_RATE = 16000 // Rate of the incoming audio (Micdrop client)
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_TRANSCRIPTION_TIMEOUT = 4000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

export class MistralSTT extends STT {
  private socket?: WebSocket
  private initPromise: Promise<void>
  private reconnectTimeout?: NodeJS.Timeout
  private connectionTimeout?: NodeJS.Timeout
  private transcriptionTimeout?: NodeJS.Timeout
  private audioChunksPending: Buffer[] = [] // Store audio chunks to send them again if reconnecting
  private transcriptDelta = '' // Accumulated transcription.text.delta chunks
  private retryCount = 0
  private destroyed = false

  constructor(private options: MistralSTTOptions) {
    super()

    // Setup WebSocket connection
    this.initPromise = this.connect()
  }

  transcribe(audioStream: Readable) {
    let started = false

    // Read audio stream and send to Mistral
    audioStream.on('data', async (chunk: Buffer) => {
      // New utterance: a flush finalizes and resets the transcription context,
      // so start from a clean transcript for this stream, but only once it
      // carries something. Voice detection opens a stream on any noise and many
      // of them never carry a word, and clearing here rather than on entry
      // keeps those from wiping the transcript of the utterance before, whose
      // flush may still be on its way back.
      if (!started) {
        started = true
        this.transcriptDelta = ''
      }
      this.audioChunksPending.push(chunk)
      await this.initPromise
      this.sendAudioChunk(chunk)
      this.log(`Sent audio chunk (${chunk.byteLength} bytes)`)
    })

    // Handle stream end: flush buffered audio so the server finalizes the
    // transcription (transcription.done). Unlike input_audio.end, a flush keeps
    // the session alive, so the same connection is reused for the next utterance.
    audioStream.on('end', async () => {
      await this.initPromise
      if (this.audioChunksPending.length === 0) return
      this.flushAudio()

      // Timeout transcription if no transcript is received
      this.transcriptionTimeout = setTimeout(() => {
        this.transcriptionTimeout = undefined
        this.log('Transcription timeout')
        this.emit('Transcript', this.transcriptDelta.trim())
        this.transcriptDelta = ''
        this.audioChunksPending.length = 0
      }, this.options.transcriptionTimeout || DEFAULT_TRANSCRIPTION_TIMEOUT)
    })
  }

  destroy() {
    super.destroy()
    this.destroyed = true
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    if (this.transcriptionTimeout) {
      clearTimeout(this.transcriptionTimeout)
      this.transcriptionTimeout = undefined
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = undefined
    }
    if (this.socket) closeSocket(this.socket)
    this.socket = undefined
  }

  private connect(): Promise<void> {
    return this.initWS().catch((error) => {
      console.error('[MistralSTT] Connection error:', error)
      this.reconnect()
    })
  }

  private getURL() {
    const model = this.options.model || DEFAULT_MODEL
    return `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(
      model
    )}`
  }

  private async initWS(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.getURL(), {
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
        },
      })
      this.socket = socket

      const timeout = setTimeout(() => {
        this.log('Connection timeout')
        closeSocket(socket)
        this.socket = undefined
        reject(new Error('WebSocket connection timeout'))
      }, this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT)
      this.connectionTimeout = timeout

      socket.addEventListener('open', () => {
        clearTimeout(timeout)
        this.sendSessionUpdate()
        this.log('Connection opened')
        resolve()
      })

      socket.addEventListener('error', (error) => {
        clearTimeout(timeout)
        this.log('WebSocket error:', error)
        reject(new Error('WebSocket connection error'))
      })

      socket.addEventListener('close', ({ code, reason }) => {
        clearTimeout(timeout)
        this.socket?.removeAllListeners()
        this.socket = undefined

        if (code !== 1000) {
          this.reconnect()
        } else {
          this.log('Connection closed', { code, reason })
        }
      })

      socket.addEventListener('message', (event) => {
        this.handleMessage(JSON.parse(event.data.toString()))
      })
    })
  }

  private sendSessionUpdate() {
    if (!this.socket) return

    // Configure the audio format. Must be sent before any audio is appended;
    // Mistral rejects format updates once audio has started.
    this.socket.send(
      JSON.stringify({
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
    )
  }

  private sendAudioChunk(chunk: Buffer) {
    if (!this.socket) return
    this.socket.send(
      JSON.stringify({
        type: 'input_audio.append',
        audio: chunk.toString('base64'),
      })
    )
  }

  private flushAudio() {
    if (!this.socket) return
    // Flush buffered audio so the server processes the tail and emits a final
    // transcription.done for this utterance. We deliberately do NOT send
    // input_audio.end: that terminates the session (the server drops the
    // connection), whereas a flush finalizes the current utterance and keeps the
    // session ready for the next one.
    this.socket.send(JSON.stringify({ type: 'input_audio.flush' }))
    this.log('Flushed audio input')
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'transcription.text.delta':
        if (typeof message.text === 'string') {
          this.transcriptDelta += message.text
          this.log(`Received transcript delta: "${message.text}"`)
        }
        break

      case 'transcription.done': {
        const transcript =
          typeof message.text === 'string' ? message.text : this.transcriptDelta
        this.log(`Received completed transcript: "${transcript}"`)
        this.emit('Transcript', transcript.trim())
        // Reset state and clear timeout. The session stays alive after a flush,
        // so the same connection is reused for the next utterance.
        this.transcriptDelta = ''
        this.audioChunksPending.length = 0
        if (this.transcriptionTimeout) {
          clearTimeout(this.transcriptionTimeout)
          this.transcriptionTimeout = undefined
        }
        break
      }

      case 'error':
        this.log('Error:', message.error ?? message)
        break

      default:
        break
    }
  }

  private reconnect() {
    if (this.destroyed) return
    this.retryCount++
    if (this.retryCount > (this.options.maxRetry ?? DEFAULT_MAX_RETRY)) {
      this.log('Max retries reached, giving up')
      this.emit('Failed', this.audioChunksPending)
      return
    }

    this.initPromise = new Promise((resolve) => {
      this.log('Reconnecting...')
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = undefined
        this.initWS()
          .then(() => {
            this.retryCount = 0

            // Resend audio chunks if reconnecting during transcription. The new
            // session is fresh and replays the whole utterance, so reset the
            // accumulated deltas to avoid duplicating them.
            if (this.audioChunksPending.length > 0) {
              this.log('Sending audio chunks again')
              this.transcriptDelta = ''
              this.audioChunksPending.forEach((chunk) =>
                this.sendAudioChunk(chunk)
              )
            }
          })
          .then(resolve)
          .catch((error) => {
            this.log('Reconnection error:', error)
            this.reconnect()
          })
      }, this.options.retryDelay ?? DEFAULT_RETRY_DELAY)
    })
  }
}

/**
 * Closes a socket without hearing from it again.
 *
 * A socket closed while still connecting emits an error, and an error nobody
 * listens to crashes the process, so a listener that ignores it stays.
 */
function closeSocket(socket: WebSocket) {
  socket.removeAllListeners()
  socket.on('error', () => {})
  if (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  ) {
    socket.close(1000)
  }
}
