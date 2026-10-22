import {
  MicdropConversationToolCall,
  Pcm16Resampler,
  Realtime,
  RealtimeOptions,
} from '@micdrop/server'
import WebSocket from 'ws'
import z, { toJSONSchema } from 'zod'

/**
 * ElevenLabs Realtime, a model hearing the user and answering with its voice
 *
 * @see https://elevenlabs.io/docs/eleven-agents/guides/openai-realtime-compatibility
 *
 * The API speaks the protocol of the OpenAI Realtime API, with its own
 * behaviors:
 * - The Micdrop client tells when the user speaks, so the server side turn
 *   detection is off and each turn is committed when the client closes it.
 * - A response asked for with instructions or out of the conversation answers
 *   the conversation as usual, so a text to read and the first message are
 *   asked for in a message of the user, like with Gemini Live.
 * - A cancelled response is followed by one ElevenLabs opens on its own, which
 *   says nothing and refuses any other response until it is cancelled.
 * - Audio of the user arriving before an answer starts drops that answer.
 * - System messages are dropped, so they are sent as messages of the user.
 * - The transcript of an answer carries the audio tags the voice performs.
 */

export type ElevenLabsRealtimeModel =
  'eleven_realtime_v1_mini' | 'eleven_realtime_v1_max'

export interface ElevenLabsRealtimeOptions extends RealtimeOptions {
  apiKey: string
  model?: ElevenLabsRealtimeModel
  // Name or id of an ElevenLabs voice
  voice?: string
  // Language of the call, for the transcription, the voice and the answers
  language?: string
  temperature?: number
  // Length of a session in seconds, up to 7200, before it is renewed
  maxDuration?: number
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

const REALTIME_URL = 'wss://api.elevenlabs.io/v1/convai/realtime'
const DEFAULT_MODEL = 'eleven_realtime_v1_mini'
const DEFAULT_VOICE = 'brian'
const DEFAULT_MAX_DURATION = 7200
const SAMPLE_RATE = 16000 // Rate of the Micdrop client, accepted as input
const OUTPUT_SAMPLE_RATE = 24000 // The only rate of the voice
const OUTPUT_BYTES_PER_MS = (OUTPUT_SAMPLE_RATE * 2) / 1000
// The response ElevenLabs opens after a cancelled one comes right after it
const AFTER_CANCEL_DELAY = 150 // ms
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

const FIRST_MESSAGE_PROMPT =
  'The call starts now. Speak first, as your instructions say.'
const SYSTEM_MESSAGE_PREFIX = '(System message, not said by the user)'
// An audio tag such as [laughs], and the space after it
const AUDIO_TAG = /\[[^\]\n]*\]\s*/g
const MAX_AUDIO_TAG_LENGTH = 40

/** A response asked for, until the API gives it an id */
interface RequestedResponse {
  generation: number
}

export class ElevenLabsRealtime extends Realtime<ElevenLabsRealtimeOptions> {
  private socket?: WebSocket
  private connected = false
  private everConnected = false
  private destroyed = false
  // Events sent while the connection opens
  private pending: object[] = []
  private reconnectTimeout?: NodeJS.Timeout
  private retryCount = 0

  private outputResampler = new Pcm16Resampler(OUTPUT_SAMPLE_RATE, SAMPLE_RATE)

  // Bumped by every interruption, so late responses can tell they are stale
  private generation = 0
  // ElevenLabs runs one response at a time, so they are asked for in turn
  private queued: RequestedResponse[] = []
  private requested?: RequestedResponse
  private activeResponseId?: string
  private afterCancelTimeout?: NodeJS.Timeout
  private response?: { id: string } & RequestedResponse
  private ignoredResponses = new Set<string>()
  // Audio of the response being played, to cut what the user did not hear
  private audioItemId?: string
  private audioStartedAt = 0
  private audioBytes = 0
  // Transcript held back while it may end with the start of an audio tag
  private heldTranscript = ''

  constructor(options: ElevenLabsRealtimeOptions) {
    super(options)
    this.connect()
  }

  destroy() {
    this.destroyed = true
    super.destroy()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    this.closeSocket()
  }

  protected openTurn() {}

  protected appendAudio(chunk: Buffer) {
    this.send({
      type: 'input_audio_buffer.append',
      audio: chunk.toString('base64'),
    })
  }

  protected closeTurn() {
    this.send({ type: 'input_audio_buffer.commit' })
    this.createResponse()
  }

  protected clearTurn() {
    this.send({ type: 'input_audio_buffer.clear' })
  }

  protected generate() {
    this.send(this.messageItem('user', FIRST_MESSAGE_PROMPT))
    this.createResponse()
  }

  protected speakText(text: string) {
    this.send(
      this.messageItem(
        'user',
        `Say exactly the following text, word for word, and nothing else: ${text}`
      )
    )
    this.createResponse()
  }

  protected cancelAnswer() {
    this.generation++
    this.queued = []
    // A response asked for and not started yet is dropped by ElevenLabs when
    // the audio of the next turn arrives, or starts and is cancelled as stale
    this.requested = undefined
    this.outputResampler.reset()
    this.heldTranscript = ''
    const response = this.response
    if (!response) return
    this.response = undefined
    this.ignoredResponses.add(response.id)
    this.send({ type: 'response.cancel', response_id: response.id })

    // The client played part of the audio at most, the model should not
    // remember saying the rest
    if (this.audioItemId) {
      const played = Math.min(
        Date.now() - this.audioStartedAt,
        this.audioBytes / OUTPUT_BYTES_PER_MS
      )
      this.send({
        type: 'conversation.item.truncate',
        item_id: this.audioItemId,
        content_index: 0,
        audio_end_ms: Math.max(0, Math.floor(played)),
      })
    }
    this.audioItemId = undefined
  }

  protected updateTools() {
    if (this.connected) this.sendSessionUpdate()
  }

  protected injectMessage(role: 'user' | 'assistant' | 'system', text: string) {
    // The whole conversation is sent again once reconnected
    if (!this.connected && this.everConnected) return
    this.send(this.messageItem(role, text))
  }

  private createResponse() {
    this.queued.push({ generation: this.generation })
    this.sendNextResponse()
  }

  /** Asks for the next response once the API runs none */
  private sendNextResponse() {
    if (
      !this.connected ||
      this.requested ||
      this.activeResponseId ||
      this.afterCancelTimeout
    ) {
      return
    }
    const next = this.queued.shift()
    if (!next) return
    this.requested = next
    this.socket?.send(JSON.stringify({ type: 'response.create' }))
  }

  private send(event: object) {
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event))
    } else {
      this.pending.push(event)
    }
  }

  private messageItem(role: 'user' | 'assistant' | 'system', text: string) {
    return {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: role === 'assistant' ? 'assistant' : 'user',
        content: [
          role === 'assistant'
            ? { type: 'output_text', text }
            : {
                type: 'input_text',
                text:
                  role === 'system' ? `${SYSTEM_MESSAGE_PREFIX} ${text}` : text,
              },
        ],
      },
    }
  }

  private sendSessionUpdate() {
    this.socket?.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: this.options.model || DEFAULT_MODEL,
          instructions: this.options.systemPrompt,
          output_modalities: ['audio'],
          max_duration_seconds:
            this.options.maxDuration ?? DEFAULT_MAX_DURATION,
          ...(this.options.temperature !== undefined
            ? { temperature: this.options.temperature }
            : {}),
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: SAMPLE_RATE },
              // The Micdrop client detects when the user speaks
              turn_detection: null,
              ...(this.options.language
                ? { transcription: { language: this.options.language } }
                : {}),
            },
            output: {
              format: { type: 'audio/pcm' },
              voice: this.options.voice || DEFAULT_VOICE,
            },
          },
          tools: this.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: toJSONSchema(tool.inputSchema || z.object()),
          })),
        },
      })
    )
  }

  private connect() {
    this.initWS().catch((error) => {
      this.log('Connection error:', error)
      this.reconnect()
    })
  }

  private initWS(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(REALTIME_URL, {
        headers: { 'xi-api-key': this.options.apiKey },
      })
      this.socket = socket

      const timeout = setTimeout(() => {
        this.log('Connection timeout')
        this.closeSocket()
        reject(new Error('WebSocket connection timeout'))
      }, this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT)

      socket.on('open', () => {
        clearTimeout(timeout)
        this.log('Connection opened')
        this.sendSessionUpdate()

        // A new connection starts from an empty conversation, the system
        // prompt aside
        if (this.everConnected) {
          for (const message of this.conversation.slice(1)) {
            if (
              message.role !== 'user' &&
              message.role !== 'assistant' &&
              message.role !== 'system'
            ) {
              continue
            }
            socket.send(
              JSON.stringify(this.messageItem(message.role, message.content))
            )
          }
        }

        this.connected = true
        this.everConnected = true
        this.retryCount = 0
        const pending = this.pending
        this.pending = []
        pending.forEach((event) => this.send(event))
        this.sendNextResponse()
        resolve()
      })

      socket.on('error', (error) => {
        clearTimeout(timeout)
        this.log('WebSocket error:', error)
        reject(new Error('WebSocket connection error'))
      })

      socket.on('close', (code, reason) => {
        clearTimeout(timeout)
        const wasConnected = this.connected
        this.closeSocket()
        if (this.destroyed) return
        this.log('Connection closed', { code, reason: reason.toString() })
        if (wasConnected) this.reconnect()
      })

      socket.on('message', (data) => {
        this.handleMessage(JSON.parse(data.toString()))
      })
    })
  }

  private closeSocket() {
    const socket = this.socket
    this.socket = undefined
    this.connected = false
    // What was waiting for this connection is sent again with the
    // conversation, or belonged to an answer that is lost
    this.pending = []
    this.queued = []
    this.requested = undefined
    this.activeResponseId = undefined
    this.clearAfterCancelTimeout()
    this.response = undefined
    this.heldTranscript = ''
    if (!socket) return
    socket.removeAllListeners()
    socket.on('error', () => {})
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close(1000)
    }
    // The answer in progress is lost with the connection
    this.endAnswer()
  }

  private reconnect() {
    if (this.destroyed) return
    this.retryCount++
    if (this.retryCount > (this.options.maxRetry ?? DEFAULT_MAX_RETRY)) {
      this.log('Max retries reached, giving up')
      this.emit('Failed')
      return
    }
    this.log('Reconnecting...')
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined
      this.connect()
    }, this.options.retryDelay ?? DEFAULT_RETRY_DELAY)
  }

  private clearAfterCancelTimeout() {
    if (!this.afterCancelTimeout) return
    clearTimeout(this.afterCancelTimeout)
    this.afterCancelTimeout = undefined
  }

  private isIgnored(responseId?: string) {
    return (
      !responseId ||
      this.ignoredResponses.has(responseId) ||
      this.response?.id !== responseId
    )
  }

  /** Passes on the transcript, without the audio tags the voice performs */
  private addTranscript(delta: string, final = false) {
    let text = this.heldTranscript + delta
    this.heldTranscript = ''
    const tagStart = text.lastIndexOf('[')
    if (
      !final &&
      tagStart !== -1 &&
      !text.includes(']', tagStart) &&
      text.length - tagStart <= MAX_AUDIO_TAG_LENGTH
    ) {
      this.heldTranscript = text.slice(tagStart)
      text = text.slice(0, tagStart)
    }
    text = text.replace(AUDIO_TAG, '')
    if (text !== '') this.addAnswerTranscript(text)
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'response.created': {
        const id = message.response.id
        this.activeResponseId = id
        this.clearAfterCancelTimeout()
        const requested = this.requested
        this.requested = undefined
        // Opened by ElevenLabs after a cancelled response, or interrupted
        // before it even started
        if (!requested || requested.generation !== this.generation) {
          this.ignoredResponses.add(id)
          this.socket?.send(
            JSON.stringify({ type: 'response.cancel', response_id: id })
          )
          break
        }
        this.response = { id, ...requested }
        this.audioItemId = undefined
        this.audioBytes = 0
        this.heldTranscript = ''
        this.outputResampler.reset()
        break
      }

      case 'response.output_audio.delta': {
        if (this.isIgnored(message.response_id)) break
        const audio = Buffer.from(message.delta, 'base64')
        if (this.audioItemId !== message.item_id) {
          this.audioItemId = message.item_id
          this.audioStartedAt = Date.now()
          this.audioBytes = 0
        }
        this.audioBytes += audio.length
        const output = this.outputResampler.process(audio)
        if (output.length > 0) this.emitAudio(output)
        break
      }

      case 'response.output_audio_transcript.delta':
        if (this.isIgnored(message.response_id)) break
        this.addTranscript(message.delta)
        break

      case 'conversation.item.input_audio_transcription.completed':
        this.log(`User transcript: "${message.transcript}"`)
        this.addUserTranscript(message.transcript || '')
        this.commitUserTranscript()
        break

      case 'conversation.item.input_audio_transcription.failed':
        this.log('Transcription failed:', message.error)
        this.commitUserTranscript()
        break

      case 'response.done':
        this.onResponseDone(message.response)
        break

      case 'error':
        // The response asked for came while another one ran, it waits for
        // the end of that one
        if (
          message.error?.code === 'conversation_already_has_active_response'
        ) {
          if (this.requested) this.queued.unshift(this.requested)
          this.requested = undefined
          break
        }
        this.log('Error:', message.error)
        break

      default:
        break
    }
  }

  private async onResponseDone(response: any) {
    if (this.activeResponseId === response.id) {
      this.activeResponseId = undefined
      if (response.status === 'cancelled') {
        // Leaves the time for the response ElevenLabs opens after it
        this.afterCancelTimeout = setTimeout(() => {
          this.afterCancelTimeout = undefined
          this.sendNextResponse()
        }, AFTER_CANCEL_DELAY)
      }
    }

    if (
      this.ignoredResponses.delete(response.id) ||
      this.response?.id !== response.id
    ) {
      this.sendNextResponse()
      return
    }
    this.response = undefined
    const generation = this.generation

    if (this.heldTranscript !== '') this.addTranscript('', true)
    if (response.status === 'failed') {
      this.log('Response failed:', response.status_details)
    }

    const calls = (response.output ?? []).filter(
      (item: any) => item.type === 'function_call'
    )
    if (calls.length === 0) {
      this.endAnswer()
      this.sendNextResponse()
      return
    }

    // Run the tools, then have the model speak about their results
    let skipAnswer = true
    for (const call of calls) {
      const toolCall: MicdropConversationToolCall = {
        role: 'tool_call',
        toolCallId: call.call_id,
        toolName: call.name,
        parameters: call.arguments,
      }
      const result = await this.runTool(toolCall)
      if (generation !== this.generation) return
      if (!result.skipAnswer) skipAnswer = false
      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result.output ?? null),
        },
      })
    }

    if (skipAnswer) {
      this.endAnswer()
      this.sendNextResponse()
    } else {
      this.createResponse()
    }
  }
}
