import type { VoiceSettings } from '@elevenlabs/elevenlabs-js/api'
import { Readable } from 'stream'
import {
  ElevenLabsConnection,
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

/**
 * Where the utterance stands.
 *
 * - `idle`: nothing is being spoken
 * - `speaking`: the text stream is still coming
 * - `flushed`: the text stream ended and was flushed, its audio is coming
 */
type UtteranceState = 'idle' | 'speaking' | 'flushed'

/**
 * The Text to Speech WebSocket, for Flash, Multilingual v2 and Turbo v2.5.
 *
 * Its messages carry no utterance ID, and nothing in the protocol stops a
 * synthesis once it is sent. So cancelling drops the connection and opens a
 * fresh one, while the user is still speaking, and the audio of the cancelled
 * utterance is never heard of again.
 */
export class SpeechWebSocket implements ElevenLabsWebSocket {
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
  private heardUntil = 0 // Index in textSent where the audio received ends

  constructor(
    private readonly options: ElevenLabsTTSOptions,
    private readonly host: ElevenLabsWebSocketHost
  ) {
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

    this.connection = new ElevenLabsConnection({
      url: `wss://api.elevenlabs.io/v1/text-to-speech/${this.options.voiceId}/stream-input?${params.toString()}`,
      tts: options,
      // Initialization message with voice settings
      init: { text: ' ', voice_settings: voiceSettings },
      keepAlive: {
        interval: (WS_INACTIVITY_TIMEOUT - 1) * 1000,
        message: { text: ' ' },
      },
      host,
      onOpen: () => this.resume(),
      onMessage: (message) => this.onMessage(message),
      onFailed: () => this.onFailed(),
    })
    this.connection.connect()
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
      this.state = 'speaking'
      return true
    }

    // Forward text chunks coming from the caller to ElevenLabs
    textStream.on('data', async (chunk: Buffer) => {
      if (!start()) return
      this.textBuffer += chunk.toString('utf-8').replace(/[\r\n ]+/g, ' ')
      if (!(await this.connection.ready())) return
      if (this.speaking !== generation) return

      // Only send complete words
      const spaceIndex = this.textBuffer.lastIndexOf(' ')
      if (spaceIndex === -1) return
      this.sendTranscript(this.textBuffer.slice(0, spaceIndex + 1))
      this.textBuffer = this.textBuffer.slice(spaceIndex + 1)
    })

    textStream.on('error', (error) => {
      if (!started || this.speaking !== generation) return
      this.log('Error in text stream, ending audio stream', error)
      // The text sent so far is still spoken, the rest is dropped
      this.speaking = 0
      this.textBuffer = ''
      this.flush()
    })

    textStream.on('end', async () => {
      // Nothing was ever said, so there is nothing to flush.
      if (!started) return
      if (!(await this.connection.ready())) return
      if (this.speaking !== generation) return
      // Send last buffered text
      if (this.textBuffer.trim()) {
        this.sendTranscript(this.textBuffer + ' ')
      }
      this.textBuffer = ''
      this.flush()
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

  /** Flushes buffered text and marks the end of the utterance */
  private flush() {
    this.state = 'flushed'
    this.connection.send({ text: ' ', flush: true })
    this.log('Flushed text')
    this.checkEnded()
  }

  /**
   * Sends the text of the utterance in flight again on a new connection. The
   * server lost what it was generating, so it goes on from the audio received.
   */
  private resume() {
    if (this.state === 'idle') return
    // Audio can stop inside a word, which goes again whole rather than from
    // its middle
    const wordStart = this.textSent.lastIndexOf(' ', this.heardUntil - 1) + 1
    const unheard = this.textSent.slice(wordStart)
    this.textSent = ''
    this.heardUntil = 0
    if (unheard.trim()) {
      this.log('Sending text chunks again')
      this.sendTranscript(unheard)
    }
    if (this.state === 'flushed') this.flush()
  }

  /** Every retry failed: hands the unspoken text over and drops the utterance */
  private onFailed() {
    const unspoken =
      this.state === 'idle'
        ? ''
        : this.textSent.slice(this.heardUntil) + this.textBuffer
    this.speaking = 0
    this.resetUtterance()
    this.host.failed(unspoken.trim() ? [unspoken] : [])
  }

  private resetUtterance() {
    this.state = 'idle'
    this.textSent = ''
    this.textBuffer = ''
    this.heardUntil = 0
  }

  private onMessage(message: ElevenLabsWebSocketMessage) {
    if ('audio' in message && message.audio) {
      this.processAudioMessage(message)
    }
    if ('isFinal' in message && message.isFinal && this.state !== 'idle') {
      this.log('Audio ended')
      this.resetUtterance()
    }
    // Sent before the server closes the connection, for a wrong key or an
    // unknown voice
    if ('error' in message) {
      console.error('[ElevenLabsTTS] Error:', message.error, message.message)
    }
  }

  private processAudioMessage(message: ElevenLabsWebSocketAudioOutputMessage) {
    const chunk = Buffer.from(message.audio, 'base64')
    this.connection.prove()
    if (this.state === 'idle') {
      this.log('Ignore audio chunk, nothing is being spoken')
      return
    }

    // Check text of received audio chunk
    if (message.alignment) {
      const chunkText = message.alignment.chars.join('')

      // A connection carries one utterance at a time, since a cancel or a
      // new utterance opens another, so its audio is always wanted. The
      // alignment only tells how far the voice got, for a reconnection. It
      // follows the text sent, a few characters aside when the voice skips
      // or rewrites some, and is placed where it fits next.
      const end = findHeardEnd(this.textSent, this.heardUntil, chunkText)
      if (end === -1) {
        this.log(`Audio chunk off the text sent ("${chunkText}")`)
      } else {
        this.log(`Received audio chunk ("${chunkText}")`)
        this.heardUntil = end
      }
    }

    // Send to audio stream
    this.host.audio(chunk)

    // ElevenLabs doesn't send isFinal after a flush, so the end of the
    // utterance is when its audio covers all its text
    this.checkEnded()
  }

  private checkEnded() {
    if (this.state !== 'flushed') return
    if (this.textSent.slice(this.heardUntil).trim()) return
    this.log('Audio ended')
    this.resetUtterance()
  }

  private sendTranscript(text: string) {
    // Counted as sent even when the connection just dropped, so the
    // reconnection sends it again
    this.textSent += text
    if (!this.connection.send({ text, try_trigger_generation: true })) return
    this.log(`Sent transcript: "${text}"`)
  }

  private log(...message: any[]) {
    this.host.log(...message)
  }
}

/**
 * Where `heard` ends in `text`, at the first place from `from` where the text
 * goes on with it, or -1 when it does nowhere
 */
function findHeardEnd(text: string, from: number, heard: string): number {
  for (let start = from; start < text.length; start++) {
    const end = endOfPrefix(text, start, heard)
    if (end !== -1) return end
  }
  return -1
}

/**
 * Where `heard` ends in `text`, read from `from` and compared without
 * whitespace, or -1 when the text does not go on with it there.
 */
function endOfPrefix(text: string, from: number, heard: string): number {
  let index = from
  for (let i = 0; i < heard.length; i++) {
    if (isSpace(heard[i])) continue
    while (index < text.length && isSpace(text[index])) index++
    if (text[index] !== heard[i]) return -1
    index++
  }
  return index
}

function isSpace(char: string) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
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
