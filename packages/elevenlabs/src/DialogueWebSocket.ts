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
  ElevenLabsDialogueClientMessage,
  ElevenLabsDialogueMessage,
  ElevenLabsTTSOptions,
} from './types'

// API Reference: https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket

// The server closes a connection that hears nothing for 20 seconds
const KEEP_ALIVE_INTERVAL = 15000
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

// Punctuation closing a sentence, with the space that follows it. An ellipsis
// is a pause within the sentence, which v4 performs, so it does not close one.
const SENTENCE_END = /(?:[!?]+|(?<!\.)\.(?!\.))\s+/g

/**
 * The Text to Dialogue WebSocket, the only one serving Eleven v3 and v4.
 *
 * The server holds text back until it has about 40 characters and 8 words,
 * which delays a short first sentence such as "Hi there!". Flushing at the end
 * of every sentence starts its audio right away.
 *
 * Nothing in the protocol stops a synthesis once it is sent, so cancelling
 * drops the connection and opens a fresh one. It opens in under 100 ms, while
 * the user is still speaking.
 */
export class DialogueWebSocket implements ElevenLabsWebSocket {
  private socket?: WebSocket
  private initPromise!: Promise<void>
  private connectionTimeout?: NodeJS.Timeout
  private keepAliveInterval?: NodeJS.Timeout
  private reconnectTimeout?: NodeJS.Timeout
  private retryCount = 0
  private destroyed = false
  // Bumped by every speak() and every cancel(), so a stream that starts late
  // can tell whether it is still the one that should be heard.
  private generation = 0
  // Generation of the stream being spoken. A speak() that never carries a
  // word leaves it in place, so the sentence it sends goes on to its end.
  private speaking = 0
  private isProcessing = false
  private textEnded = false // Whether the text stream has ended
  private textSent = '' // Text of the utterance sent to ElevenLabs
  private textBuffer = '' // End of the last chunk, held until its word is complete
  private unflushed = false // Whether text was sent since the last flush
  private pendingFlushes = 0 // Flushes whose audio is not complete yet
  private newTurn = false // Whether the next input starts a new utterance
  private hasSpoken = false // Whether the connection received any text

  constructor(
    private readonly options: ElevenLabsTTSOptions,
    private readonly host: ElevenLabsWebSocketHost
  ) {
    this.connect()
  }

  speak(textStream: Readable) {
    const generation = ++this.generation
    let started = false

    // Taking over is deferred until there is something to say, for the same
    // reason as on the Text to Speech WebSocket: a stream that never carries a
    // word must not cut off the sentence still being spoken.
    const start = () => {
      if (started) return this.speaking === generation
      // Cancelled, or superseded by another speak(), before the first word.
      if (this.generation !== generation) return false
      started = true
      // The utterance still being synthesized is superseded: drop it with
      // its connection.
      if (this.isProcessing) this.restart()
      this.speaking = generation
      this.isProcessing = true
      this.textEnded = false
      this.textSent = ''
      this.textBuffer = ''
      this.unflushed = false
      this.pendingFlushes = 0
      this.newTurn = true
      return true
    }

    textStream.on('data', async (chunk: Buffer) => {
      if (!start()) return
      const text = chunk.toString('utf-8').replace(/[\r\n ]+/g, ' ')

      await this.initPromise
      if (this.speaking !== generation) return

      // Only send complete words
      const spaceIndex = text.lastIndexOf(' ')
      if (spaceIndex === -1) {
        this.textBuffer += text
      } else {
        this.sendText(this.textBuffer + text.slice(0, spaceIndex + 1))
        this.textBuffer = text.slice(spaceIndex + 1)
      }
    })

    textStream.on('error', (error) => {
      if (!started || this.speaking !== generation) return
      this.log('Error in text stream, ending audio stream', error)
      this.isProcessing = false
    })

    textStream.on('end', async () => {
      // Nothing was ever said, so there is nothing to flush.
      if (!started) return
      await this.initPromise
      if (this.speaking !== generation) return
      if (this.textBuffer.trim()) {
        this.sendText(this.textBuffer + ' ')
        this.textBuffer = ''
      }
      this.textEnded = true
      this.flush()
      this.checkEnded()
    })
  }

  cancel() {
    this.generation++
    this.speaking = 0
    if (!this.isProcessing) return
    this.log('Cancel')
    this.isProcessing = false
    this.textSent = ''
    this.textBuffer = ''
    this.restart()
  }

  destroy() {
    this.destroyed = true
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    this.dropSocket()
    this.isProcessing = false
  }

  private connect() {
    this.initPromise = this.initWS().catch((error) => {
      console.error('[ElevenLabsTTS] Connection error:', error)
      this.reconnect()
    })
  }

  /** Drops the connection, with the synthesis running on it, for a new one */
  private restart() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    this.dropSocket()
    this.connect()
  }

  /** Closes the connection without reconnecting */
  private dropSocket() {
    // A connection dropped while opening never settles, rather than failing
    // and reconnecting
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
  }

  private initWS(): Promise<void> {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams()
      params.append('model_id', this.options.modelId ?? DEFAULT_MODEL_ID)
      params.append(
        'output_format',
        this.options.outputFormat ?? DEFAULT_OUTPUT_FORMAT
      )
      if (this.options.language) {
        params.append('language_code', this.options.language)
      }

      const socket = new WebSocket(
        `wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?${params.toString()}`,
        {
          headers: {
            'xi-api-key': this.options.apiKey,
          },
        }
      )
      this.socket = socket
      let opened = false

      const timeout = setTimeout(() => {
        this.log('Connection timeout')
        closeSocket(socket)
        this.socket = undefined
        reject(new Error('WebSocket connection timeout'))
      }, this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT)
      this.connectionTimeout = timeout

      socket.addEventListener('open', () => {
        clearTimeout(timeout)
        opened = true
        this.log('Connection opened')

        // Register the voice. Dialogue models only read the stability.
        const stability = this.options.voiceSettings?.stability
        this.send({
          voices: [this.options.voiceId],
          voice_settings: stability === undefined ? undefined : { stability },
        })
        this.hasSpoken = false

        this.keepAliveInterval = setInterval(() => {
          this.send({ keep_alive: true })
          // Still open: the server accepted the key and the voice
          this.retryCount = 0
        }, KEEP_ALIVE_INTERVAL)

        resolve()
      })

      socket.addEventListener('error', (error) => {
        clearTimeout(timeout)
        this.log('WebSocket error:', error)
        reject(new Error('WebSocket connection error'))
      })

      socket.addEventListener('message', (event) => {
        try {
          this.onMessage(JSON.parse(event.data.toString()))
        } catch (error: any) {
          this.log('message' in error ? error.message : error)
          this.log('Event data during error:', event.data)
        }
      })

      socket.addEventListener('close', ({ code, reason }) => {
        clearTimeout(timeout)
        if (this.keepAliveInterval) {
          clearInterval(this.keepAliveInterval)
          this.keepAliveInterval = undefined
        }
        this.socket?.removeAllListeners()
        this.socket = undefined

        // dropSocket() detaches the socket before closing it, so any close
        // reaching this handler comes from the server. A connection that never
        // opened was rejected, and the rejection reconnects.
        this.log('Connection closed', { code, reason })
        if (opened) this.reconnect()
      })
    })
  }

  private onMessage(message: ElevenLabsDialogueMessage) {
    if ('audio' in message && message.audio) {
      const chunk = Buffer.from(message.audio, 'base64')
      this.log(`Received audio chunk (${chunk.length} bytes)`)
      this.retryCount = 0
      this.host.audio(chunk)
    }
    if (
      'is_final_audio_for_turn' in message &&
      message.is_final_audio_for_turn
    ) {
      this.pendingFlushes = Math.max(0, this.pendingFlushes - 1)
      this.checkEnded()
    }
    // Sent before the server closes the connection, for a wrong key, an
    // unknown voice or no dialogue session left
    if ('error' in message) {
      console.error('[ElevenLabsTTS] Error:', message.error, message.message)
    }
  }

  /** Sends text, flushing after each sentence it completes */
  private sendText(text: string) {
    let start = 0
    for (const match of text.matchAll(SENTENCE_END)) {
      const end = match.index! + match[0].length
      this.sendInput(text.slice(start, end), true)
      start = end
    }
    if (start < text.length) {
      this.sendInput(text.slice(start), false)
    }
  }

  private sendInput(text: string, flush: boolean) {
    this.textSent += text
    if (!text.trim()) return
    this.send({
      inputs: [
        {
          text,
          voice_id: this.options.voiceId,
          // Resets the prosody between two utterances
          new_turn: (this.newTurn && this.hasSpoken) || undefined,
        },
      ],
      flush: flush || undefined,
    })
    this.log(`Sent text${flush ? ' and flushed' : ''}: "${text}"`)
    this.newTurn = false
    this.hasSpoken = true
    if (flush) {
      this.pendingFlushes++
      this.unflushed = false
    } else {
      this.unflushed = true
    }
  }

  /** Generates the text held by the server, if any */
  private flush() {
    if (!this.unflushed) return
    this.send({ flush: true })
    this.pendingFlushes++
    this.unflushed = false
    this.log('Flushed text')
  }

  /** Ends the utterance once its text is over and all its audio came */
  private checkEnded() {
    if (!this.isProcessing || !this.textEnded) return
    if (this.unflushed || this.pendingFlushes > 0) return
    this.log('Audio ended')
    this.isProcessing = false
    this.textSent = ''
  }

  private send(message: ElevenLabsDialogueClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(message))
  }

  private reconnect() {
    if (this.destroyed) return
    this.retryCount++
    if (this.retryCount > (this.options.maxRetry ?? DEFAULT_MAX_RETRY)) {
      this.log('Max retries reached, giving up')
      const unspoken = this.isProcessing ? this.textSent + this.textBuffer : ''
      this.host.failed(unspoken.trim() ? [unspoken] : [])
      return
    }

    this.initPromise = new Promise((resolve) => {
      this.log('Reconnecting...')
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = undefined
        // The count starts over once the connection proves usable, since the
        // server opens it before checking the key and the voice
        this.initWS()
          .then(() => {
            // Speak the utterance in flight again on the new connection
            if (this.isProcessing && this.textSent.trim()) {
              this.log('Sending text again')
              const text = this.textSent
              this.textSent = ''
              this.unflushed = false
              this.pendingFlushes = 0
              this.sendText(text)
              if (this.textEnded) this.flush()
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
