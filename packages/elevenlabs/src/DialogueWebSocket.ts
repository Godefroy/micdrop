import { Readable } from 'stream'
import {
  ElevenLabsConnection,
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

// Punctuation closing a sentence, with the space that follows it. An ellipsis
// is a pause within the sentence, which v4 performs, so it does not close one.
const SENTENCE_END = /(?:[!?]+|(?<!\.)\.(?!\.))\s+/g

/**
 * Where the utterance stands.
 *
 * - `idle`: nothing is being spoken
 * - `streaming`: the text stream is still coming
 * - `draining`: the text stream ended, the audio of its flushes is coming
 */
type UtteranceState = 'idle' | 'streaming' | 'draining'

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
  private readonly connection: ElevenLabsConnection
  private state: UtteranceState = 'idle'
  // Bumped by every speak() and every cancel(), so a stream that starts late
  // can tell whether it is still the one that should be heard.
  private generation = 0
  // Generation of the stream being spoken. A speak() that never carries a
  // word leaves it in place, so the sentence it sends goes on to its end.
  private speaking = 0
  private textSent = '' // Text of the utterance sent to ElevenLabs
  private textBuffer = '' // Text not sent yet, held until its word is complete
  private unflushed = false // Whether text was sent since the last flush
  private pendingFlushes = 0 // Flushes whose audio is not complete yet
  private newTurn = false // Whether the next input starts a new utterance
  private hasSpoken = false // Whether the connection received any text

  constructor(
    private readonly options: ElevenLabsTTSOptions,
    private readonly host: ElevenLabsWebSocketHost
  ) {
    const params = new URLSearchParams()
    params.append('model_id', this.options.modelId ?? DEFAULT_MODEL_ID)
    params.append(
      'output_format',
      this.options.outputFormat ?? DEFAULT_OUTPUT_FORMAT
    )
    if (this.options.language) {
      params.append('language_code', this.options.language)
    }

    // Register the voice. Dialogue models only read the stability.
    const stability = this.options.voiceSettings?.stability
    const init: ElevenLabsDialogueClientMessage = {
      voices: [this.options.voiceId],
      voice_settings: stability === undefined ? undefined : { stability },
    }

    this.connection = new ElevenLabsConnection({
      url: `wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?${params.toString()}`,
      tts: options,
      init,
      keepAlive: {
        interval: KEEP_ALIVE_INTERVAL,
        message: { keep_alive: true },
      },
      host,
      onOpen: () => this.onOpen(),
      onMessage: (message) => this.onMessage(message),
      onFailed: () => this.onFailed(),
    })
    this.connection.connect()
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
      // its connection. Otherwise connect again if the last one gave up.
      if (this.state !== 'idle') this.connection.restart()
      else this.connection.connect()
      this.resetUtterance()
      this.speaking = generation
      this.state = 'streaming'
      this.newTurn = true
      return true
    }

    textStream.on('data', async (chunk: Buffer) => {
      if (!start()) return
      this.textBuffer += chunk.toString('utf-8').replace(/[\r\n ]+/g, ' ')
      if (!(await this.connection.ready())) return
      if (this.speaking !== generation) return

      // Only send complete words
      const spaceIndex = this.textBuffer.lastIndexOf(' ')
      if (spaceIndex === -1) return
      this.sendText(this.textBuffer.slice(0, spaceIndex + 1))
      this.textBuffer = this.textBuffer.slice(spaceIndex + 1)
    })

    textStream.on('error', (error) => {
      if (!started || this.speaking !== generation) return
      this.log('Error in text stream, ending audio stream', error)
      // The text sent so far is still spoken, the rest is dropped
      this.speaking = 0
      this.textBuffer = ''
      this.endText()
    })

    textStream.on('end', async () => {
      // Nothing was ever said, so there is nothing to flush.
      if (!started) return
      if (!(await this.connection.ready())) return
      if (this.speaking !== generation) return
      if (this.textBuffer.trim()) {
        this.sendText(this.textBuffer + ' ')
      }
      this.textBuffer = ''
      this.endText()
    })
  }

  cancel() {
    this.generation++
    this.speaking = 0
    if (this.state === 'idle') return
    this.log('Cancel')
    this.resetUtterance()
    this.connection.restart()
  }

  destroy() {
    this.generation++
    this.speaking = 0
    this.resetUtterance()
    this.connection.destroy()
  }

  private onOpen() {
    this.hasSpoken = false
    if (this.state === 'idle') return
    // The flushes in flight were lost with the previous connection, so the
    // utterance is spoken again from its start
    const text = this.textSent
    this.textSent = ''
    this.unflushed = false
    this.pendingFlushes = 0
    if (text.trim()) {
      this.log('Sending text again')
      this.sendText(text)
    }
    if (this.state === 'draining') this.flush()
    this.checkEnded()
  }

  /** Every retry failed: hands the unspoken text over and drops the utterance */
  private onFailed() {
    const unspoken =
      this.state === 'idle' ? '' : this.textSent + this.textBuffer
    this.speaking = 0
    this.resetUtterance()
    this.host.failed(unspoken.trim() ? [unspoken] : [])
  }

  private resetUtterance() {
    this.state = 'idle'
    this.textSent = ''
    this.textBuffer = ''
    this.unflushed = false
    this.pendingFlushes = 0
  }

  /** The text stream is over: flushes what the server holds */
  private endText() {
    this.state = 'draining'
    this.flush()
    this.checkEnded()
  }

  private onMessage(message: ElevenLabsDialogueMessage) {
    if ('audio' in message && message.audio) {
      const chunk = Buffer.from(message.audio, 'base64')
      this.connection.prove()
      if (this.state === 'idle') {
        this.log('Ignore audio chunk, nothing is being spoken')
      } else {
        this.log(`Received audio chunk (${chunk.length} bytes)`)
        this.host.audio(chunk)
      }
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
    if (this.state !== 'draining') return
    if (this.unflushed || this.pendingFlushes > 0) return
    this.log('Audio ended')
    this.resetUtterance()
  }

  // Lost when the connection just dropped, which is fine: the reconnection
  // sends the utterance again from textSent
  private send(message: ElevenLabsDialogueClientMessage) {
    this.connection.send(message)
  }

  private log(...message: any[]) {
    this.host.log(...message)
  }
}
