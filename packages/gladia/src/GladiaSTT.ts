import { DeepPartial, STT } from '@micdrop/server'
import { Readable } from 'stream'
import WebSocket from 'ws'
import { GladiaLiveSessionPayload } from './types'

/**
 * Gladia Real-time V2 STT
 *
 * @see https://docs.gladia.io/chapters/live-stt/getting-started
 */

export interface GladiaSTTOptions {
  apiKey: string
  settings?: DeepPartial<GladiaLiveSessionPayload>
  connectionTimeout?: number
  transcriptionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

const SAMPLE_RATE = 16000
const BIT_DEPTH = 16
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_TRANSCRIPTION_TIMEOUT = 4000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

export class GladiaSTT extends STT {
  private socket?: WebSocket
  private initPromise: Promise<void>
  private reconnectTimeout?: NodeJS.Timeout
  private connectionTimeout?: NodeJS.Timeout
  private transcriptionTimeout?: NodeJS.Timeout
  private audioChunksPending: Buffer[] = [] // Store audio chunks to send them again if reconnecting
  private retryCount = 0
  private destroyed = false

  constructor(private options: GladiaSTTOptions) {
    super()

    // Setup Websocket connection
    this.initPromise = this.getURL()
      .then(this.initWS)
      .catch((error) => {
        console.error('[GladiaSTT] Connection error:', error)
        this.reconnect()
      })
  }

  transcribe(audioStream: Readable) {
    // Read transformed stream and send to Gladia
    audioStream.on('data', async (chunk: Buffer) => {
      this.audioChunksPending.push(chunk)
      await this.initPromise
      this.socket?.send(chunk)
      this.log(`Sent audio chunk (${chunk.byteLength} bytes)`)
    })

    // Send silence when the stream ends to force Gladia to transcribe
    audioStream.on('end', async () => {
      await this.initPromise
      if (this.audioChunksPending.length === 0) return
      this.sendSilence(2)

      // Timeout transcription if no transcript is received
      this.transcriptionTimeout = setTimeout(() => {
        this.transcriptionTimeout = undefined
        this.log(`Transcription timeout`)
        this.emit('Transcript', '')
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
    })

    if (!response.ok) {
      const status = response.status

      // Don't retry on 4xx errors
      if (status >= 400 && status < 500) {
        throw new Error(`${status}: ${response.statusText}`)
      }

      // Retry on other errors
      this.log('Error getting URL, retrying...', {
        status,
        text: response.statusText,
      })
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.retryDelay ?? DEFAULT_RETRY_DELAY)
      )
      return this.getURL()
    }

    const { url } = (await response.json()) as { url: string }
    return url
  }

  // Connect to Gladia
  private initWS = async (url: string) => {
    // Destroyed while the session URL was on its way
    if (this.destroyed) return
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
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
        const message = JSON.parse(event.data.toString())
        if (message.type === 'transcript' && message.data.is_final) {
          const transcript = message.data.utterance.text
          this.log(`Received transcript: "${transcript}"`)
          this.emit('Transcript', transcript)
          // Reset audio chunks and transcript flag to avoid sending them again if reconnecting
          this.audioChunksPending.length = 0

          if (this.transcriptionTimeout) {
            clearTimeout(this.transcriptionTimeout)
            this.transcriptionTimeout = undefined
          }
        }
      })
    })
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
        this.getURL()
          .then(this.initWS)
          .then(() => {
            this.retryCount = 0

            // Send audio chunks again if reconnecting during transcription
            if (this.audioChunksPending.length > 0) {
              this.log('Sending audio chunks again')
              this.audioChunksPending.forEach((chunk) =>
                this.socket?.send(chunk)
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

  private sendSilence(durationSeconds: number) {
    if (!this.socket) return
    const numSamples = Math.round(SAMPLE_RATE * durationSeconds)
    const bytesPerSample = BIT_DEPTH / 8
    const silenceBuffer = Buffer.alloc(numSamples * bytesPerSample)
    this.socket.send(silenceBuffer)
    this.audioChunksPending.push(silenceBuffer)
    this.log(
      `Sent ${durationSeconds * 1000}ms of silence (${silenceBuffer.byteLength} bytes) after stream end`
    )
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
