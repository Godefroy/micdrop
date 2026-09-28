import type { VoiceSettings } from '@elevenlabs/elevenlabs-js/api'
import { Readable } from 'stream'
import WebSocket from 'ws'
import {
  closeSocket,
  ElevenLabsWebSocket,
  ElevenLabsWebSocketHost,
} from './ElevenLabsWebSocket'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_OUTPUT_FORMAT,
  ElevenLabsTTSOptions,
  ElevenLabsWebSocketAudioOutputMessage,
  ElevenLabsWebSocketMessage,
} from './types'

// API Reference: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input

const WS_INACTIVITY_TIMEOUT = 180
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

/**
 * The Text to Speech WebSocket, for Flash, Multilingual v2 and Turbo v2.5.
 */
export class SpeechWebSocket implements ElevenLabsWebSocket {
  private socket?: WebSocket
  private initPromise: Promise<void>
  private isProcessing = false
  private textEnded = false // Whether the text stream has ended
  private textSent = '' // Text sent to ElevenLabs
  private textBuffer = '' // Buffer of text to send to ElevenLabs
  private receivedAudioText = '' // Text of chunks received from ElevenLabs
  private keepAliveInterval?: NodeJS.Timeout
  private reconnectTimeout?: NodeJS.Timeout
  private connectionTimeout?: NodeJS.Timeout
  private retryCount = 0
  private destroyed = false
  private canceled = false
  // Bumped by every speak() and every cancel(), so a stream that starts late
  // can tell whether it is still the one that should be heard.
  private generation = 0

  constructor(
    private readonly options: ElevenLabsTTSOptions,
    private readonly host: ElevenLabsWebSocketHost
  ) {
    // Setup WebSocket connection
    this.initPromise = this.initWS().catch((error) => {
      console.error('[ElevenLabsTTS] Connection error:', error)
      this.reconnect()
    })
  }

  speak(textStream: Readable) {
    const generation = ++this.generation
    let started = false

    // Taking over is deferred until there is something to say.
    //
    // These fields track the utterance being spoken right now, and the
    // comparison between what was sent and what came back as audio is what
    // says where it is. Resetting them for a stream that never carries a word,
    // which is what an answer skipped by a tool or by onBeforeAnswer hands
    // over, loses the state of a sentence still being spoken and flushes it
    // for nothing.
    const start = () => {
      if (started) return true
      // Cancelled, or superseded by another speak(), before the first word.
      if (this.generation !== generation) return false
      started = true
      this.canceled = false
      this.isProcessing = true
      this.textEnded = false
      this.textBuffer = ''
      this.textSent = ''
      this.receivedAudioText = ''
      return true
    }

    // Forward text chunks coming from the caller to ElevenLabs
    textStream.on('data', async (chunk: Buffer) => {
      if (!start()) return
      if (this.canceled) return
      const text = chunk.toString('utf-8').replace(/[\r\n ]+/g, ' ')
      this.textSent += text

      await this.initPromise

      const spaceIndex = text.lastIndexOf(' ')
      if (spaceIndex === -1) {
        this.textBuffer += text
      } else {
        this.sendTranscript(this.textBuffer + text.slice(0, spaceIndex + 1))
        this.textBuffer = text.slice(spaceIndex + 1)
      }
    })

    textStream.on('error', (error) => {
      if (!started) return
      this.log('Error in text stream, ending audio stream', error)
      this.isProcessing = false
    })

    textStream.on('end', async () => {
      // Nothing was ever said, so there is nothing to flush.
      if (!started || this.canceled) return
      await this.initPromise
      // Send last buffered text
      if (this.textBuffer.trim()) {
        this.sendTranscript(this.textBuffer + ' ')
        this.textBuffer = ''
      }
      this.textEnded = true
      // Flush buffered text and mark end of utterance.
      this.socket?.send(JSON.stringify({ text: ' ', flush: true }))
      this.log('Flushed text')
    })
  }

  cancel() {
    this.generation++
    if (!this.isProcessing) return
    this.log('Cancel')

    this.canceled = true
    this.textSent = ''
    this.receivedAudioText = ''
    this.isProcessing = false

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ text: ' ', flush: true }))
    }
  }

  destroy() {
    this.destroyed = true
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = undefined
    }
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = undefined
    }
    if (this.socket) closeSocket(this.socket)
    this.socket = undefined
    this.isProcessing = false
  }

  private initWS(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Build query params
      const params = new URLSearchParams()
      params.append('model_id', this.options.modelId ?? DEFAULT_MODEL_ID)
      params.append(
        'output_format',
        this.options.outputFormat ?? DEFAULT_OUTPUT_FORMAT
      )
      params.append('inactivity_timeout', WS_INACTIVITY_TIMEOUT.toString())
      const voiceSettings = toWireVoiceSettings(this.options.voiceSettings)
      if (voiceSettings) {
        params.append('voice_settings', JSON.stringify(voiceSettings))
      }
      if (this.options.language) {
        params.append('language_code', this.options.language)
      }

      const uri = `wss://api.elevenlabs.io/v1/text-to-speech/${this.options.voiceId}/stream-input?${params.toString()}`

      // Connect to ElevenLabs
      const socket = new WebSocket(uri, {
        headers: {
          'xi-api-key': this.options.apiKey,
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
        this.log('Connection opened')

        // Send initialization / keep-alive message with voice settings
        this.socket?.send(
          JSON.stringify({
            text: ' ',
            voice_settings: voiceSettings,
          })
        )

        // Start keep-alive interval
        this.keepAliveInterval = setInterval(
          () => {
            if (this.socket?.readyState === WebSocket.OPEN) {
              this.log('Sending keep-alive message')
              this.socket.send(JSON.stringify({ text: ' ' }))
              // Still open: the server accepted the key and the voice
              this.retryCount = 0
            }
          },
          (WS_INACTIVITY_TIMEOUT - 1) * 1000
        )

        resolve()
      })

      socket.addEventListener('error', (error) => {
        clearTimeout(timeout)
        this.log('WebSocket error:', error)
        reject(new Error('WebSocket connection error'))
      })

      socket.addEventListener('message', (event) => {
        if (this.canceled) return
        try {
          this.onMessage(JSON.parse(event.data.toString()))
        } catch (error: any) {
          this.log('message' in error ? error.message : error)
          this.log('Event data during error:', event.data)
        }
      })

      socket.addEventListener('close', ({ code, reason }) => {
        clearTimeout(timeout)
        this.socket?.removeAllListeners()
        this.socket = undefined
        this.isProcessing = false

        if (this.keepAliveInterval) {
          clearInterval(this.keepAliveInterval)
          this.keepAliveInterval = undefined
        }

        this.log('Connection closed', { code, reason })
        this.reconnect()
      })
    })
  }

  private onMessage(message: ElevenLabsWebSocketMessage) {
    if ('audio' in message && message.audio) {
      this.processAudioMessage(message)
    }
    if ('isFinal' in message && message.isFinal) {
      this.log('Audio ended')
      this.isProcessing = false
      this.textSent = ''
    }
    // Sent before the server closes the connection, for a wrong key or an
    // unknown voice
    if ('error' in message) {
      console.error('[ElevenLabsTTS] Error:', message.error, message.message)
    }
  }

  private processAudioMessage(message: ElevenLabsWebSocketAudioOutputMessage) {
    const chunk = Buffer.from(message.audio, 'base64')
    this.retryCount = 0

    // Check text of received audio chunk
    if (message.alignment) {
      const chunkText = message.alignment.chars.join('')
      const receivedAudioText = this.receivedAudioText + chunkText

      // Ignore chunk if it is from previous session
      if (this.textSent.trim().indexOf(receivedAudioText.trim()) === -1) {
        this.log(`Ignore audio chunk ("${chunkText}")`)
        return
      }

      this.log(`Received audio chunk ("${chunkText}")`)
      this.receivedAudioText = receivedAudioText

      // Fix isFinal (apparently ElevenLabs doesn't send it like it should)
      this.fixIsFinal(message)
    }

    // Send to audio stream
    this.host.audio(chunk)
  }

  private fixIsFinal(message: ElevenLabsWebSocketAudioOutputMessage) {
    if (message.isFinal || !this.textEnded) return
    if (this.receivedAudioText.trim() === this.textSent.trim()) {
      message.isFinal = true
    }
  }

  private sendTranscript(text: string) {
    this.socket?.send(JSON.stringify({ text, try_trigger_generation: true }))
    this.log(`Sent transcript: "${text}"`)
  }

  private reconnect() {
    if (this.destroyed) return
    this.retryCount++
    if (this.retryCount > (this.options.maxRetry ?? DEFAULT_MAX_RETRY)) {
      this.log('Max retries reached, giving up')
      this.host.failed(this.textSent.trim() ? [this.textSent] : [])
      return
    }

    this.initPromise = new Promise((resolve) => {
      this.log('Reconnecting...')
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = undefined
        // The count starts over once the connection proves usable, since the
        // server opens it before checking the voice
        this.initWS()
          .then(() => {
            // Send text chunks again if reconnecting
            if (this.textSent.length > 0) {
              this.log('Sending text chunks again')
              this.sendTranscript(this.textSent)
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

  private log(...message: any[]) {
    this.host.log(...message)
  }
}

/**
 * Voice settings as the WebSocket reads them.
 *
 * The SDK types them in camel case and the WebSocket reads snake case, so
 * similarityBoost and useSpeakerBoost would be ignored if sent as they are.
 */
function toWireVoiceSettings(settings?: VoiceSettings) {
  if (!settings) return undefined
  const { similarityBoost, useSpeakerBoost, ...rest } = settings
  return {
    similarity_boost: similarityBoost,
    use_speaker_boost: useSpeakerBoost,
    ...rest,
  }
}
