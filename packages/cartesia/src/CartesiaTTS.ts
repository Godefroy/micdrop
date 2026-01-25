import { TTS } from '@micdrop/server'
import { Readable } from 'stream'
import WebSocket from 'ws'
import {
  CartesiaCancelPayload,
  CartesiaLanguage,
  CartesiaPayload,
  CartesiaResponse,
} from './types'

export interface CartesiaTTSOptions {
  apiKey: string
  modelId: string
  voiceId: string
  language?: CartesiaLanguage
  speed?: 'fast' | 'normal' | 'slow'
  retryDelay?: number
  maxRetry?: number
}

const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3
export class CartesiaTTS extends TTS {
  private socket?: WebSocket
  private initPromise: Promise<void>
  private counter = 0
  private isProcessing = false
  private reconnectTimeout?: NodeJS.Timeout
  private textSent: string = '' // Store text chunks to send them again if reconnecting
  private retryCount = 0

  constructor(private readonly options: CartesiaTTSOptions) {
    super()

    // Setup WebSocket connection
    this.initPromise = this.initWS().catch((error) => {
      console.error('[CartesiaTTS] Connection error:', error)
      this.reconnect()
    })
  }

  speak(textStream: Readable) {
    this.counter++
    const counter = this.counter
    const context_id = counter.toString()
    this.isProcessing = true
    this.textSent = ''

    textStream.on('data', async (chunk: Buffer) => {
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
      this.log('Error in text stream, ending audio stream', error)
      this.isProcessing = false
    })

    textStream.on('end', async () => {
      if (counter !== this.counter) return
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
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    this.socket?.removeAllListeners()
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket?.close(1000)
    }
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
    } as const
  }

  // Connect to Cartesia
  private async initWS() {
    return new Promise<void>((resolve) => {
      const socket = new WebSocket(
        `wss://api.cartesia.ai/tts/websocket?api_key=${this.options.apiKey}&cartesia_version=2025-04-16`
      )
      this.socket = socket

      socket.addEventListener('open', () => {
        this.log('Connection opened')
        resolve()
      })

      socket.addEventListener('error', (error) => {
        this.log('WebSocket error:', error)
      })

      socket.addEventListener('close', ({ code, reason }) => {
        this.socket?.removeAllListeners()
        this.socket = undefined
        this.isProcessing = false

        if (code !== 1000) {
          this.reconnect()
        } else {
          this.log('Connection closed', { code, reason })
        }
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
