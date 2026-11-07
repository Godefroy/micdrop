import {
  ReconnectingSocket,
  ReconnectingSocketHandshake,
  STT,
} from '@micdrop/server'
import { Readable } from 'stream'
import { RawData } from 'ws'
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

const DEFAULT_TRANSCRIPTION_TIMEOUT = 4000
// Each frame of the transcription model lasts 80 ms
const FRAME_DURATION_MS = 80
const DEFAULT_DELAY_IN_FRAMES = 10

/**
 * One utterance, from its first audio chunk to its transcript.
 *
 * It is capturing while its audio stream runs, then flushing once the stream
 * ended and the flush went out, and done once its transcript is emitted, by
 * the matching `flushed` or by its own timeout.
 */
interface Utterance {
  /** Audio sent so far, sent again whole on a new connection */
  audio: Buffer[]
  /** Text segments received for this utterance */
  transcript: string
  /** Set when the audio stream ends and the flush goes out */
  flushId?: number
  timeout?: ReturnType<typeof setTimeout>
  /** The transcript went out, on `flushed` or on timeout */
  done: boolean
}

export class GradiumSTT extends STT {
  private socket: ReconnectingSocket
  // Utterances in the order their audio went out. The server answers in that
  // order too, so every text segment belongs to the first one not flushed yet
  private utterances: Utterance[] = []
  private flushId = 0
  private delayInFrames = DEFAULT_DELAY_IN_FRAMES // Given by the server when ready

  constructor(private options: GradiumSTTOptions) {
    super()

    const region = options.region ?? DEFAULT_REGION
    this.socket = new ReconnectingSocket({
      url: `wss://${region}.api.gradium.ai/api/speech/asr`,
      clientOptions: { headers: { 'x-api-key': options.apiKey } },
      connectionTimeout: options.connectionTimeout,
      retryDelay: options.retryDelay,
      maxRetry: options.maxRetry,
      // The server opens the connection before checking the setup, so the
      // connection only counts as open once it answers ready
      handshake: this.handshake,
      log: (...message) => this.log(...message),
    })
    this.socket.on('Open', this.onOpen)
    this.socket.on('Message', this.onMessage)
    this.socket.on('Failed', this.onFailed)
    this.socket.connect()
  }

  transcribe(audioStream: Readable) {
    let utterance: Utterance | undefined

    // Read audio stream and send to Gradium
    audioStream.on('data', (chunk: Buffer) => {
      // The utterance starts with its first chunk. Voice detection opens a
      // stream on any noise and many of them never carry a word, so they leave
      // no utterance behind.
      if (!utterance) {
        utterance = { audio: [], transcript: '', done: false }
        this.utterances.push(utterance)
        // A connection that gave up gets a new chance with a new utterance
        this.socket.connect()
      }
      if (utterance.done) return
      utterance.audio.push(chunk)
      // Without a connection the audio waits, and goes out whole on open
      if (this.sendAudioChunk(chunk)) {
        this.log(`Sent audio chunk (${chunk.byteLength} bytes)`)
      }
    })

    // Handle stream end: flush buffered audio so the server finalizes the
    // pending segments and confirms with a matching "flushed" message.
    audioStream.on('end', () => {
      if (!utterance || utterance.done) return
      const current = utterance
      current.audio.push(this.trailingSilence())
      current.flushId = ++this.flushId
      if (this.socket.isOpen) this.sendEnd(current)

      // Timeout transcription if no "flushed" confirmation is received
      current.timeout = setTimeout(() => {
        current.timeout = undefined
        this.log('Transcription timeout')
        this.emitTranscript(current)
      }, this.options.transcriptionTimeout || DEFAULT_TRANSCRIPTION_TIMEOUT)
    })
  }

  destroy() {
    super.destroy()
    this.socket.destroy()
    this.utterances.forEach((utterance) => clearTimeout(utterance.timeout))
    this.utterances = []
  }

  private buildJsonConfig(): GradiumASRJsonConfig {
    const config: GradiumASRJsonConfig = { ...this.options.jsonConfig }
    if (config.language === undefined) {
      config.language = this.options.language ?? DEFAULT_LANGUAGE
    }
    return config
  }

  /** Sends the setup, and waits for the server to accept it */
  private handshake: ReconnectingSocketHandshake = {
    start: (socket) => {
      socket.send(
        JSON.stringify({
          type: 'setup',
          model_name: this.options.modelName ?? DEFAULT_MODEL_NAME,
          input_format: this.options.inputFormat ?? DEFAULT_INPUT_FORMAT,
          json_config: this.buildJsonConfig(),
        } satisfies GradiumASRSetupMessage)
      )
      this.log('Sent setup')
    },
    read: (data) => {
      let message: GradiumASRResponse
      try {
        message = JSON.parse(data.toString())
      } catch {
        this.log('Error parsing message', data)
        return false
      }
      if (message.type === 'error') {
        throw new Error(`Setup refused: ${message.message}`)
      }
      if (message.type !== 'ready') return false
      this.log('Server ready')
      if (typeof message.delay_in_frames === 'number') {
        this.delayInFrames = message.delay_in_frames
      }
      return true
    },
  }

  private sendAudioChunk(chunk: Buffer) {
    return this.socket.send(
      JSON.stringify({
        type: 'audio',
        audio: chunk.toString('base64'),
      })
    )
  }

  /**
   * Silence as long as the transcription lags behind, to follow the speech.
   *
   * The model writes each word a few frames after hearing it, and a flush only
   * processes the audio already sent. With nothing after the last word, the
   * server confirms the flush before writing that word, which then opens the
   * next transcript.
   */
  private trailingSilence(): Buffer {
    const sampleRate = pcmSampleRate(
      this.options.inputFormat ?? DEFAULT_INPUT_FORMAT
    )
    // Silence is a run of zeros in raw PCM only
    if (!sampleRate) return Buffer.alloc(0)
    const durationMs = this.delayInFrames * FRAME_DURATION_MS
    const samples = Math.round((sampleRate * durationMs) / 1000)
    return Buffer.alloc(samples * 2)
  }

  /** Sends the trailing silence, already the last audio chunk, and the flush */
  private sendEnd(utterance: Utterance) {
    const silence = utterance.audio[utterance.audio.length - 1]
    if (silence.length) this.sendAudioChunk(silence)
    this.socket.send(
      JSON.stringify({ type: 'flush', flush_id: utterance.flushId })
    )
    this.log(`Sent flush (flush_id=${utterance.flushId})`)
  }

  private emitTranscript(utterance: Utterance) {
    if (utterance.done) return
    utterance.done = true
    clearTimeout(utterance.timeout)
    utterance.timeout = undefined
    // Its audio is no longer needed, but the utterance stays in the queue until
    // its flush returns, so the late segments of a timed out utterance don't
    // land in the next one
    utterance.audio = []
    const transcript = utterance.transcript.replace(/\s+/g, ' ').trim()
    this.log(`Received transcript: "${transcript}"`)
    this.emit('Transcript', transcript)
  }

  // A new connection knows nothing of the utterances under way: the audio read
  // before the first connection opened, or lost with the previous one, goes out
  // again whole, and the server transcribes it from the start
  private onOpen = () => {
    // A new session never confirms the flushes of the previous one
    this.utterances = this.utterances.filter((utterance) => !utterance.done)
    if (this.utterances.length === 0) return
    this.log('Sending audio chunks again')
    for (const utterance of this.utterances) {
      utterance.transcript = ''
      if (utterance.flushId === undefined) {
        utterance.audio.forEach((chunk) => this.sendAudioChunk(chunk))
      } else {
        // The trailing silence goes out with the flush
        utterance.audio
          .slice(0, -1)
          .forEach((chunk) => this.sendAudioChunk(chunk))
        this.sendEnd(utterance)
      }
    }
  }

  private onMessage = (data: RawData) => {
    let message: GradiumASRResponse
    try {
      message = JSON.parse(data.toString())
    } catch {
      this.log('Error parsing message', data)
      return
    }

    switch (message.type) {
      case 'text': {
        const utterance = this.utterances[0]
        if (typeof message.text === 'string' && utterance) {
          utterance.transcript +=
            (utterance.transcript ? ' ' : '') + message.text
          this.log(`Received text segment: "${message.text}"`)
        }
        break
      }

      case 'flushed': {
        // Every segment of the flushed utterance arrived. Those before it in
        // the queue are flushed too, since the server answers in order.
        const index = this.utterances.findIndex(
          (utterance) => utterance.flushId === message.flush_id
        )
        if (index === -1) break
        const flushed = this.utterances.splice(0, index + 1)
        flushed.forEach((utterance) => this.emitTranscript(utterance))
        break
      }

      case 'end_text':
        // Segment finalized, nothing to accumulate (text already received)
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

  private onFailed = () => {
    // The audio of every utterance still waiting for its transcript, for a
    // fallback to transcribe it instead
    const pending = this.utterances.filter((utterance) => !utterance.done)
    this.utterances.forEach((utterance) => clearTimeout(utterance.timeout))
    this.utterances = []
    this.emit(
      'Failed',
      pending.flatMap((utterance) => utterance.audio)
    )
  }
}

/** Sample rate of a raw PCM input format, undefined for an encoded one */
function pcmSampleRate(format: GradiumInputFormat): number | undefined {
  if (format === 'pcm') return 24000
  const match = format.match(/^pcm_(\d+)$/)
  return match ? Number(match[1]) : undefined
}
