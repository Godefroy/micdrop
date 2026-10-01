import { TTS } from '@micdrop/server'
import { Readable } from 'stream'
import WebSocket from 'ws'
import {
  CartesiaCancelPayload,
  CartesiaGenerationConfig,
  CartesiaLanguage,
  CartesiaPayload,
  CartesiaResponse,
} from './types'

export interface CartesiaTTSOptions {
  apiKey: string
  modelId: string
  voiceId: string
  language?: CartesiaLanguage
  /** @deprecated Sonic 3 models read `generationConfig.speed` instead */
  speed?: 'fast' | 'normal' | 'slow'
  generationConfig?: CartesiaGenerationConfig
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3
export class CartesiaTTS extends TTS {
  private socket?: WebSocket
  private initPromise: Promise<void>
  private counter = 0
  // Bumped by every speak() and every cancel(), so a context claimed late can
  // tell whether it is still the one that should be heard. Kept apart from
  // `counter`, which numbers the audio contexts and must only move when there
  // is something to synthesize.
  private generation = 0
  private isProcessing = false
  private reconnectTimeout?: NodeJS.Timeout
  private connectionTimeout?: NodeJS.Timeout
  private textSent: string = '' // Store text chunks to send them again if reconnecting
  private retryCount = 0
  private destroyed = false

  constructor(private readonly options: CartesiaTTSOptions) {
    super()

    // Setup WebSocket connection
    this.initPromise = this.initWS().catch((error) => {
      console.error('[CartesiaTTS] Connection error:', error)
      this.reconnect()
    })
  }

  speak(textStream: Readable) {
    const generation = ++this.generation
    let counter = 0
    let context_id = ''

    // Claiming the context is deferred until there is something to say.
    //
    // Taking the next id right away would silence the utterance still playing,
    // because incoming audio is matched against the current context and
    // anything older is dropped. A stream that never carries a word, which is
    // what an answer skipped by a tool or by onBeforeAnswer hands over, would
    // then cut the assistant off mid-sentence for nothing.
    const claimContext = () => {
      if (counter) return true
      // Cancelled, or superseded by another speak(), before the first word.
      if (this.generation !== generation) return false
      this.counter++
      counter = this.counter
      context_id = counter.toString()
      this.isProcessing = true
      this.textSent = ''
      return true
    }

    textStream.on('data', async (chunk: Buffer) => {
      if (!claimContext()) return
      if (counter !== this.counter) return
      const text = chunk.toString('utf-8').replace(/[\r\n ]+/g, ' ')
      this.textSent += text

      await this.initPromise

      this.socket?.send(
        JSON.stringify({
          ...this.getConfig(),
          transcript: text,
          context_id,
          continue: true,
        } satisfies CartesiaPayload)
      )
      this.log(`Sent transcript: "${text}"`)
    })

    textStream.on('error', (error) => {
      if (!counter) return
      this.log('Error in text stream, ending audio stream', error)
      this.isProcessing = false
    })

    textStream.on('end', async () => {
      // Nothing was ever said, so there is no context to close.
      if (!counter || counter !== this.counter) return
      await this.initPromise
      this.socket?.send(
        JSON.stringify({
          ...this.getConfig(),
          transcript: '',
          context_id,
          continue: false,
        } satisfies CartesiaPayload)
      )
    })
  }

  cancel() {
    this.generation++
    if (!this.isProcessing) return
    this.log('Cancel')
    this.isProcessing = false
    this.textSent = ''

    // Signal Cartesia to stop sending data
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({
          context_id: this.counter.toString(),
          cancel: true,
        } satisfies CartesiaCancelPayload)
      )
    }

    // Increment counter to avoid processing messages from previous calls
    this.counter++
  }

  destroy() {
    super.destroy()
    this.destroyed = true
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = undefined
    }
    if (this.socket) closeSocket(this.socket)
    this.socket = undefined
    this.isProcessing = false
  }

  private getConfig() {
    return {
      model_id: this.options.modelId,
      voice: {
        mode: 'id',
        id: this.options.voiceId,
      },
      output_format: {
        container: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: 16000,
      },
      language: this.options.language,
      speed: this.options.speed,
      generation_config: this.options.generationConfig,
    } as const
  }

  // Connect to Cartesia
  private async initWS() {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        `wss://api.cartesia.ai/tts/websocket?api_key=${this.options.apiKey}&cartesia_version=2025-04-16`
      )
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
        this.isProcessing = false

        // Always reconnect: cancel() never closes the socket (it cancels
        // in-band), and destroy() detaches its listeners before closing, so any
        // close reaching this handler is server-initiated. Reconnecting even on
        // a graceful 1000 close keeps the connection ready, otherwise the next
        // speak() would send on an undefined socket and silently no-op.
        this.log('Connection closed', { code, reason })
        this.reconnect()
      })

      socket.addEventListener('message', (event) => {
        try {
          const message: CartesiaResponse = JSON.parse(event.data.toString())

          // Ignore messages from previous calls
          if (this.counter.toString() !== message.context_id) return

          switch (message.type) {
            case 'chunk':
              const chunk = Buffer.from(message.data, 'base64')
              this.log(`Received audio chunk (${chunk.length} bytes)`)
              this.emit('Audio', chunk)
              break
            case 'done':
              this.log('Audio ended')
              this.isProcessing = false
              this.textSent = ''
              break
            case 'error':
              this.log('Error', message.error)
              break
          }
        } catch {
          this.log('Error parsing message', event.data)
        }
      })
    })
  }

  private reconnect() {
    if (this.destroyed) return
    this.retryCount++
    if (this.retryCount > (this.options.maxRetry ?? DEFAULT_MAX_RETRY)) {
      this.log('Max retries reached, giving up')
      this.emit('Failed', [this.textSent])
      return
    }

    this.initPromise = new Promise((resolve) => {
      this.log('Reconnecting...')
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = undefined
        this.initWS()
          .then(() => {
            this.retryCount = 0

            // Send text chunks again if reconnecting
            if (this.textSent.length > 0) {
              this.log('Sending text chunks again')
              this.socket?.send(
                JSON.stringify({
                  ...this.getConfig(),
                  transcript: this.textSent,
                  context_id: this.counter.toString(),
                  continue: true,
                } satisfies CartesiaPayload)
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
