import { TTS } from '@micdrop/server'
import { Readable } from 'stream'
import WebSocket from 'ws'
import {
  DEFAULT_MODEL_NAME,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_REGION,
  GradiumAudioResponse,
  GradiumEosMessage,
  GradiumResponse,
  GradiumSetupMessage,
  GradiumTextMessage,
  GradiumTTSOptions,
} from './types'

// API Reference: https://gradium.ai/api_docs.html

const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

export class GradiumTTS extends TTS {
  private socket?: WebSocket
  private initPromise: Promise<void>
  private counter = 0
  private isProcessing = false
  private reconnectTimeout?: NodeJS.Timeout
  private textSent = ''
  private textBuffer = ''
  private retryCount = 0

  constructor(private readonly options: GradiumTTSOptions) {
    super()

    this.initPromise = this.initWS().catch((error) => {
      console.error('[GradiumTTS] Connection error:', error)
      this.reconnect()
    })
  }

  speak(textStream: Readable) {
    this.counter++
    const counter = this.counter
    const clientReqId = counter.toString()
    this.isProcessing = true
    this.textSent = ''
    this.textBuffer = ''

    textStream.on('data', async (chunk: Buffer) => {
      if (counter !== this.counter) return
      const text = chunk.toString('utf-8').replace(/[\r\n ]+/g, ' ')
      this.textSent += text

      await this.initPromise

      // Buffer text and only send complete words (flush on last space)
      const spaceIndex = text.lastIndexOf(' ')
      if (spaceIndex === -1) {
        this.textBuffer += text
      } else {
        this.sendTranscript(
          this.textBuffer + text.slice(0, spaceIndex + 1),
          clientReqId
        )
        this.textBuffer = text.slice(spaceIndex + 1)
      }
    })

    textStream.on('error', (error) => {
      this.log('Error in text stream, ending audio stream', error)
      this.isProcessing = false
    })

    textStream.on('end', async () => {
      if (counter !== this.counter) return
      await this.initPromise

      // Send remaining buffered text
      if (this.textBuffer.trim()) {
        this.sendTranscript(this.textBuffer, clientReqId)
        this.textBuffer = ''
      }

      // Signal end of text input for this request
      this.socket?.send(
        JSON.stringify({
          type: 'end_of_stream',
          client_req_id: clientReqId,
        } satisfies GradiumEosMessage)
      )
      this.log('Sent end_of_stream')
    })
  }

  cancel() {
    if (!this.isProcessing) return
    this.log('Cancel')
    this.isProcessing = false
    this.textSent = ''

    // Increment counter to ignore messages from previous calls
    this.counter++

    // Close and reconnect to cancel ongoing synthesis
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.close(1000)
    }
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

  private getEndpoint() {
    const region = this.options.region ?? DEFAULT_REGION
    return `wss://${region}.api.gradium.ai/api/speech/tts`
  }

  private async initWS() {
    return new Promise<void>((resolve) => {
      const socket = new WebSocket(this.getEndpoint(), {
        headers: {
          'x-api-key': this.options.apiKey,
        },
      })
      this.socket = socket

      socket.addEventListener('open', () => {
        this.log('Connection opened')

        // Send setup message
        socket.send(
          JSON.stringify({
            type: 'setup',
            voice_id: this.options.voiceId,
            model_name: this.options.modelName ?? DEFAULT_MODEL_NAME,
            output_format: this.options.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
            close_ws_on_eos: false,
            json_config: this.options.jsonConfig,
          } satisfies GradiumSetupMessage)
        )
      })

      socket.addEventListener('error', (error) => {
        this.log('WebSocket error:', error)
      })

      socket.addEventListener('close', ({ code, reason }) => {
        this.socket?.removeAllListeners()
        this.socket = undefined

        if (code !== 1000) {
          this.reconnect()
        } else {
          this.log('Connection closed', { code, reason })
          // Reconnect for next usage
          if (!this.isProcessing) {
            this.reconnect()
          }
        }
      })

      socket.addEventListener('message', (event) => {
        try {
          const message: GradiumResponse = JSON.parse(event.data.toString())

          switch (message.type) {
            case 'ready':
              this.log('Server ready')
              resolve()
              break

            case 'audio':
              this.processAudioMessage(message)
              break

            case 'end_of_stream':
              // Ignore if from a previous request
              if (
                'client_req_id' in message &&
                message.client_req_id !== this.counter.toString()
              )
                return
              this.log('Audio ended')
              this.isProcessing = false
              this.textSent = ''
              break

            case 'error':
              this.log('Error:', message.message, message.code)
              break
          }
        } catch {
          this.log('Error parsing message', event.data)
        }
      })
    })
  }

  private sendTranscript(text: string, clientReqId: string) {
    this.socket?.send(
      JSON.stringify({
        type: 'text',
        text,
        client_req_id: clientReqId,
      } satisfies GradiumTextMessage)
    )
    this.log(`Sent transcript: "${text}"`)
  }

  private processAudioMessage(message: GradiumAudioResponse) {
    // Ignore messages from previous requests
    if (message.client_req_id !== this.counter.toString()) return

    const chunk = Buffer.from(message.audio, 'base64')
    this.log(`Received audio chunk (${chunk.length} bytes)`)
    this.emit('Audio', chunk)
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

            // Resend text if reconnecting during processing
            if (this.textSent.length > 0) {
              this.log('Sending text chunks again')
              this.socket?.send(
                JSON.stringify({
                  type: 'text',
                  text: this.textSent,
                  client_req_id: this.counter.toString(),
                } satisfies GradiumTextMessage)
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
