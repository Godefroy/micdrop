import { STT } from '@micdrop/server'
import { Readable } from 'stream'
import WebSocket from 'ws'
import { closeSocket } from './closeSocket'
import {
  DEFAULT_INPUT_FORMAT,
  DEFAULT_LANGUAGE,
  DEFAULT_MODEL_NAME,
  DEFAULT_REGION,
  GradiumASRJsonConfig,
  GradiumASRResponse,
  GradiumASRSetupMessage,
  GradiumInputFormat,
  GradiumSTTOptions,
} from './types'

/**
 * Gradium Real-time STT (ASR)
 *
 * @see https://docs.gradium.ai/guides/speech-to-text
 */

const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_TRANSCRIPTION_TIMEOUT = 4000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3
// Each frame of the transcription model lasts 80 ms
const FRAME_DURATION_MS = 80
const DEFAULT_DELAY_IN_FRAMES = 10

export class GradiumSTT extends STT {
  private socket?: WebSocket
  private initPromise: Promise<void>
  private reconnectTimeout?: NodeJS.Timeout
  private connectionTimeout?: NodeJS.Timeout
  private transcriptionTimeout?: NodeJS.Timeout
  private audioChunksPending: Buffer[] = [] // Store audio chunks to send them again if reconnecting
  private transcript = '' // Accumulated text segments for the current utterance
  private flushId = 0
  private delayInFrames = DEFAULT_DELAY_IN_FRAMES // Given by the server when ready
  private retryCount = 0
  private destroyed = false

  constructor(private options: GradiumSTTOptions) {
    super()

    // Setup WebSocket connection
    this.initPromise = this.connect()
  }

  transcribe(audioStream: Readable) {
    let started = false

    // Read audio stream and send to Gradium
    audioStream.on('data', async (chunk: Buffer) => {
      // New utterance: start from a clean transcript for this stream, but only
      // once it carries something. Voice detection opens a stream on any noise
      // and many of them never carry a word, and clearing here rather than on
      // entry keeps those from wiping the transcript of the utterance before,
      // whose flush may still be on its way back.
      if (!started) {
        started = true
        this.transcript = ''
      }
      this.audioChunksPending.push(chunk)
      await this.initPromise
      this.sendAudioChunk(chunk)
      this.log(`Sent audio chunk (${chunk.byteLength} bytes)`)
    })

    // Handle stream end: flush buffered audio so the server finalizes the
    // pending segments and confirms with a matching "flushed" message.
    audioStream.on('end', async () => {
      await this.initPromise
      if (this.audioChunksPending.length === 0) return
      this.sendTrailingSilence()
      const flushId = ++this.flushId
      this.sendFlush(flushId)

      // Timeout transcription if no "flushed" confirmation is received
      this.transcriptionTimeout = setTimeout(() => {
        this.transcriptionTimeout = undefined
        this.log('Transcription timeout')
        this.emitTranscript()
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
      console.error('[GradiumSTT] Connection error:', error)
      this.reconnect()
    })
  }

  private getEndpoint() {
    const region = this.options.region ?? DEFAULT_REGION
    return `wss://${region}.api.gradium.ai/api/speech/asr`
  }

  private async initWS(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.getEndpoint(), {
        headers: {
          'x-api-key': this.options.apiKey,
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
        this.sendSetup()
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
        try {
          this.handleMessage(JSON.parse(event.data.toString()))
        } catch {
          this.log('Error parsing message', event.data)
        }
      })
    })
  }

  private buildJsonConfig(): GradiumASRJsonConfig {
    const config: GradiumASRJsonConfig = { ...this.options.jsonConfig }
    if (config.language === undefined) {
      config.language = this.options.language ?? DEFAULT_LANGUAGE
    }
    return config
  }

  private sendSetup() {
    this.socket?.send(
      JSON.stringify({
        type: 'setup',
        model_name: this.options.modelName ?? DEFAULT_MODEL_NAME,
        input_format: this.options.inputFormat ?? DEFAULT_INPUT_FORMAT,
        json_config: this.buildJsonConfig(),
      } satisfies GradiumASRSetupMessage)
    )
    this.log('Sent setup')
  }

  private sendAudioChunk(chunk: Buffer) {
    this.socket?.send(
      JSON.stringify({
        type: 'audio',
        audio: chunk.toString('base64'),
      })
    )
  }

  /**
   * Follows the speech with as much silence as the transcription lags behind.
   *
   * The model writes each word a few frames after hearing it, and a flush only
   * processes the audio already sent. With nothing after the last word, the
   * server confirms the flush before writing that word, which then opens the
   * next transcript.
   */
  private sendTrailingSilence() {
    const sampleRate = pcmSampleRate(
      this.options.inputFormat ?? DEFAULT_INPUT_FORMAT
    )
    // Silence is a run of zeros in raw PCM only
    if (!sampleRate) return
    const durationMs = this.delayInFrames * FRAME_DURATION_MS
    const samples = Math.round((sampleRate * durationMs) / 1000)
    const silence = Buffer.alloc(samples * 2)
    this.audioChunksPending.push(silence)
    this.sendAudioChunk(silence)
    this.log(`Sent ${durationMs}ms of silence`)
  }

  private sendFlush(flushId: number) {
    this.socket?.send(JSON.stringify({ type: 'flush', flush_id: flushId }))
    this.log(`Sent flush (flush_id=${flushId})`)
  }

  private emitTranscript() {
    const transcript = this.transcript.replace(/\s+/g, ' ').trim()
    this.log(`Received transcript: "${transcript}"`)
    this.emit('Transcript', transcript)
    // Reset state and clear timeout
    this.transcript = ''
    this.audioChunksPending.length = 0
    if (this.transcriptionTimeout) {
      clearTimeout(this.transcriptionTimeout)
      this.transcriptionTimeout = undefined
    }
  }

  private handleMessage(message: GradiumASRResponse) {
    switch (message.type) {
      case 'ready':
        this.log('Server ready')
        // The server accepted the setup, so the connection is usable
        this.retryCount = 0
        if (typeof message.delay_in_frames === 'number') {
          this.delayInFrames = message.delay_in_frames
        }
        break

      case 'text':
        if (typeof message.text === 'string') {
          this.transcript += (this.transcript ? ' ' : '') + message.text
          this.log(`Received text segment: "${message.text}"`)
        }
        break

      case 'end_text':
        // Segment finalized, nothing to accumulate (text already received)
        break

      case 'flushed':
        // The flush for the current utterance completed: all pending segments
        // have been received, emit the full transcript.
        if (message.flush_id === this.flushId) {
          this.emitTranscript()
        }
        break

      case 'step':
        // Voice activity detection frames, ignored
        break

      case 'end_of_stream':
        this.log('End of stream')
        break

      case 'error':
        this.log('Error:', message.message, message.code)
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
        // The count starts over once the server accepts the session, since it
        // opens the connection before checking the setup
        this.initWS()
          .then(() => {
            // Resend audio chunks if reconnecting during transcription. Setup
            // is sent on open and the server replays the whole utterance, so
            // reset the accumulated segments to avoid duplicating them.
            if (this.audioChunksPending.length > 0) {
              this.log('Sending audio chunks again')
              this.transcript = ''
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

/** Sample rate of a raw PCM input format, undefined for an encoded one */
function pcmSampleRate(format: GradiumInputFormat): number | undefined {
  if (format === 'pcm') return 24000
  const match = format.match(/^pcm_(\d+)$/)
  return match ? Number(match[1]) : undefined
}
