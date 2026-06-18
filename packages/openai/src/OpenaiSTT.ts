import { STT } from '@micdrop/server'
import { Readable } from 'stream'
import WebSocket from 'ws'
import { Pcm16Resampler } from './utils/Pcm16Resampler'

/**
 * OpenAI Real-time STT
 *
 * @see https://platform.openai.com/docs/guides/speech-to-text
 */

export interface OpenaiSTTOptions {
  apiKey: string
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
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_TRANSCRIPTION_TIMEOUT = 4000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

export class OpenaiSTT extends STT {
  private socket?: WebSocket
  private initPromise: Promise<void>
  private reconnectTimeout?: NodeJS.Timeout
  private retryCount = 0
  private transcriptionTimeout?: NodeJS.Timeout
  private audioChunksPending: Buffer[] = [] // Store audio chunks to send them again if reconnecting
  private resampler = new Pcm16Resampler(SAMPLE_RATE, OPENAI_SAMPLE_RATE)

  constructor(private options: OpenaiSTTOptions) {
    super()

    // Setup WebSocket connection
    this.initPromise = this.initWS().catch((error) => {
      console.error('[OpenaiSTT] Connection error:', error)
      this.reconnect()
    })
  }

  transcribe(audioStream: Readable) {
    // New utterance: OpenAI commits and clears its buffer after each one, so
    // resample this stream independently from the previous one.
    this.resampler.reset()

    // Read audio stream and send to OpenAI
    audioStream.on('data', async (chunk: Buffer) => {
      this.audioChunksPending.push(chunk)
      await this.initPromise
      this.sendAudioChunk(chunk)
      this.log(`Sent audio chunk (${chunk.byteLength} bytes)`)
    })

    // Handle stream end
    audioStream.on('end', async () => {
      await this.initPromise
      if (this.audioChunksPending.length === 0) return
      this.commitAudio()

      // Timeout transcription if no transcript is received
      this.transcriptionTimeout = setTimeout(() => {
        this.transcriptionTimeout = undefined
        this.log('Transcription timeout')
        this.emit('Transcript', '')
        this.audioChunksPending.length = 0
      }, this.options.transcriptionTimeout || DEFAULT_TRANSCRIPTION_TIMEOUT)
    })
  }

  destroy() {
    super.destroy()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    if (this.transcriptionTimeout) {
      clearTimeout(this.transcriptionTimeout)
      this.transcriptionTimeout = undefined
    }
    this.socket?.removeAllListeners()
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket?.close(1000)
    }
    this.socket = undefined
  }

  private sendSessionUpdate() {
    if (!this.socket) return

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
                model: this.options.model || DEFAULT_MODEL,
                language: this.options.language || DEFAULT_LANGUAGE,
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

  private async initWS(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        'wss://api.openai.com/v1/realtime?intent=transcription',
        {
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
          },
        }
      )
      this.socket = socket

      const timeout = setTimeout(() => {
        this.log('Connection timeout')
        socket.removeAllListeners()
        socket.close()
        this.socket = undefined
        reject(new Error('WebSocket connection timeout'))
      }, this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT)

      socket.addEventListener('open', () => {
        clearTimeout(timeout)
        this.sendSessionUpdate()
        this.log('Connection opened')
        resolve()
      })

      socket.addEventListener('error', (error: any) => {
        clearTimeout(timeout)
        this.log('WebSocket error:', error)
        reject(new Error('WebSocket connection error'))
      })

      socket.addEventListener(
        'close',
        ({ code, reason }: { code: number; reason: string }) => {
          clearTimeout(timeout)
          this.socket?.removeAllListeners()
          this.socket = undefined

          if (code !== 1000) {
            this.reconnect()
          } else {
            this.log('Connection closed', { code, reason })
          }
        }
      )

      socket.addEventListener('message', (event: any) => {
        this.handleMessage(JSON.parse(event.data.toString()))
      })
    })
  }

  private sendAudioChunk(chunk: Buffer) {
    if (!this.socket) return

    // Resample 16kHz -> 24kHz (GA Realtime API requires a rate >= 24kHz)
    const resampled = this.resampler.process(chunk)
    if (resampled.length === 0) return

    this.socket.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: resampled.toString('base64'),
      })
    )
  }

  private handleMessage(message: any) {
    switch (message.type) {
      // case 'input_audio_buffer.committed':
      //   this.log('Audio buffer committed')
      //   break

      // case 'input_audio_buffer.speech_started':
      //   this.log('Speech started')
      //   break

      // case 'input_audio_buffer.speech_stopped':
      //   this.log('Speech stopped')
      //   break

      // case 'conversation.item.input_audio_transcription.delta':
      //   this.log(`Received transcript delta: "${message.delta}"`)
      //   break

      case 'conversation.item.input_audio_transcription.completed':
        const transcript = message.transcript || ''
        this.log(`Received completed transcript: "${transcript}"`)
        this.emit('Transcript', transcript)
        // Reset audio chunks and clear timeout
        this.audioChunksPending.length = 0
        if (this.transcriptionTimeout) {
          clearTimeout(this.transcriptionTimeout)
          this.transcriptionTimeout = undefined
        }
        break

      case 'error':
        this.log('Error:', message.error)
        break

      default:
        break
    }
  }

  private reconnect() {
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

            // Send audio chunks again if reconnecting during transcription.
            // The OpenAI buffer is fresh, so replay them through a reset
            // resampler to reproduce the exact same stream.
            if (this.audioChunksPending.length > 0) {
              this.log('Sending audio chunks again')
              this.resampler.reset()
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

  private commitAudio() {
    if (!this.socket) return
    this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    this.log('Committed audio buffer')
  }
}
