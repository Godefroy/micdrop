import {
  MicdropConversationToolCall,
  Pcm16Resampler,
  Realtime,
  RealtimeOptions,
  ReconnectingSocket,
} from '@micdrop/server'
import z, { toJSONSchema } from 'zod'
import { parseMessage, sessionHandshake } from './session'
import { transcriptionLanguage } from './transcription'

/**
 * OpenAI Realtime API, a model hearing the user and answering with its voice
 *
 * @see https://developers.openai.com/api/docs/guides/realtime-conversations
 *
 * The Micdrop client already tells when the user speaks, so the server side
 * turn detection is off: the audio of a turn is committed when the client
 * closes it, and the answer is asked for right after.
 */

export interface OpenaiRealtimeOptions extends RealtimeOptions {
  apiKey: string
  model?: string
  voice?: string
  // Language of the user, which helps the transcription
  language?: string
  // gpt-4o-transcribe (default) shuts down on February 26, 2027, replaced by
  // gpt-live-transcribe and gpt-transcribe
  transcriptionModel?: string
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

const DEFAULT_MODEL = 'gpt-realtime-2.1'
const DEFAULT_VOICE = 'marin'
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'
const SAMPLE_RATE = 16000 // Rate of the Micdrop client, both ways
const OPENAI_SAMPLE_RATE = 24000 // The only rate of the Realtime API
const OPENAI_BYTES_PER_MS = (OPENAI_SAMPLE_RATE * 2) / 1000
// Events held while the connection opens. The retry budget bounds how long
// that lasts, this bounds what it holds.
const MAX_PENDING_EVENTS = 5000
// Metadata key naming the request a response answers
const REQUEST_METADATA_KEY = 'micdrop_request'

/**
 * Where the connection stands, as the conversation sees it.
 *
 * - `connecting`: never open yet, what is sent waits for the first connection
 * - `connected`: what is sent goes out
 * - `reconnecting`: dropped, the conversation is sent again on the next
 *   connection, followed by what was sent meanwhile
 * - `closed`: every retry failed, or destroyed, nothing goes out anymore
 */
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed'

/** A response asked for, until the API gives it an id */
interface RequestedResponse {
  generation: number
  // Out of the conversation, so there is no item to truncate
  outOfBand: boolean
}

export class OpenaiRealtime extends Realtime<OpenaiRealtimeOptions> {
  private socket: ReconnectingSocket
  private connection: ConnectionState = 'connecting'
  // Events sent while the connection opens
  private pending: object[] = []
  private requestCount = 0

  private inputResampler = new Pcm16Resampler(SAMPLE_RATE, OPENAI_SAMPLE_RATE)
  private outputResampler = new Pcm16Resampler(OPENAI_SAMPLE_RATE, SAMPLE_RATE)

  // Bumped by every interruption, so late responses can tell they are stale
  private generation = 0
  // Responses asked for and not created yet, by the id sent as their metadata
  // and as the event id of their request, which an error names
  private requested = new Map<string, RequestedResponse>()
  private response?: { id: string } & RequestedResponse
  private ignoredResponses = new Set<string>()
  // Audio of the response being played, to cut what the user did not hear
  private audioItemId?: string
  private audioStartedAt = 0
  private audioBytes = 0

  constructor(options: OpenaiRealtimeOptions) {
    super(options)
    const model = options.model || DEFAULT_MODEL
    this.socket = new ReconnectingSocket({
      url: `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      clientOptions: {
        headers: { Authorization: `Bearer ${options.apiKey}` },
      },
      connectionTimeout: options.connectionTimeout,
      retryDelay: options.retryDelay,
      maxRetry: options.maxRetry,
      handshake: sessionHandshake,
      log: (...message) => this.log(...message),
    })
    this.socket.on('Open', ({ reconnected }) => this.onOpen(reconnected))
    this.socket.on('Close', () => {
      this.connection = 'reconnecting'
      this.resetSession()
    })
    this.socket.on('Failed', () => {
      this.connection = 'closed'
      this.pending = []
      this.resetSession()
      this.emit('Failed')
    })
    this.socket.on('Message', (data) => this.handleMessage(parseMessage(data)))
    this.socket.connect()
  }

  destroy() {
    super.destroy()
    this.connection = 'closed'
    this.pending = []
    this.socket.destroy()
  }

  protected openTurn() {
    this.inputResampler.reset()
  }

  protected appendAudio(chunk: Buffer) {
    const audio = this.inputResampler.process(chunk)
    if (audio.length === 0) return
    this.send({
      type: 'input_audio_buffer.append',
      audio: audio.toString('base64'),
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
    this.createResponse()
  }

  protected speakText(text: string) {
    // Out of the conversation: the text is already in it, recorded by the
    // caller, and the instruction to read it does not belong there
    this.createResponse({
      conversation: 'none',
      instructions: `Say exactly the following text, word for word, and nothing else: ${text}`,
    })
  }

  protected cancelAnswer() {
    this.generation++
    this.outputResampler.reset()
    const response = this.response
    if (!response) return
    this.response = undefined
    this.ignoredResponses.add(response.id)
    this.send({ type: 'response.cancel', response_id: response.id })

    // The client played part of the audio at most, the model should not
    // remember saying the rest
    if (!response.outOfBand && this.audioItemId) {
      const played = Math.min(
        Date.now() - this.audioStartedAt,
        this.audioBytes / OPENAI_BYTES_PER_MS
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
    // Sent with the session on the next connection otherwise
    if (this.connection === 'connected') this.sendSessionUpdate()
  }

  protected injectMessage(role: 'user' | 'assistant' | 'system', text: string) {
    // The whole conversation is sent again once reconnected
    if (this.connection === 'reconnecting') return
    this.send(this.messageItem(role, text))
  }

  /**
   * Asks for a response, tagged so its `response.created` tells which request
   * it answers. Matching them by order alone would shift every later response
   * onto the wrong request as soon as one is refused.
   */
  private createResponse(response?: object) {
    const id = `micdrop-response-${++this.requestCount}`
    const generation = this.generation
    const accepted = this.send({
      type: 'response.create',
      // Errors caused by this event carry its id
      event_id: id,
      response: { ...response, metadata: { [REQUEST_METADATA_KEY]: id } },
    })
    if (!accepted) {
      // Nothing will answer it, so the answer ends now, once its caller is
      // ready to hear that it did
      queueMicrotask(() => {
        if (generation === this.generation) this.endAnswer()
      })
      return
    }
    this.requested.set(id, { generation, outOfBand: !!response })
  }

  /**
   * Sends an event, or holds it until the connection opens.
   * @returns False when it was dropped, the connection being given up on
   */
  private send(event: object): boolean {
    if (this.connection === 'connected') {
      return this.socket.send(JSON.stringify(event))
    }
    if (this.connection === 'closed') return false
    if (this.pending.length >= MAX_PENDING_EVENTS) {
      this.log('Too many events waiting for the connection, dropped')
      return false
    }
    this.pending.push(event)
    return true
  }

  private messageItem(role: 'user' | 'assistant' | 'system', text: string) {
    return {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role,
        content: [
          {
            type: role === 'assistant' ? 'output_text' : 'input_text',
            text,
          },
        ],
      },
    }
  }

  private sendSessionUpdate() {
    const transcriptionModel =
      this.options.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL
    this.socket.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: this.options.model || DEFAULT_MODEL,
          instructions: this.options.systemPrompt,
          output_modalities: ['audio'],
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: OPENAI_SAMPLE_RATE },
              // The Micdrop client detects when the user speaks
              turn_detection: null,
              transcription: {
                model: transcriptionModel,
                ...transcriptionLanguage(
                  transcriptionModel,
                  this.options.language
                ),
              },
              noise_reduction: { type: 'near_field' },
            },
            output: {
              format: { type: 'audio/pcm', rate: OPENAI_SAMPLE_RATE },
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

  /**
   * Sets the session up, then sends what waited for it. A new connection
   * starts from an empty conversation, so a reconnection sends it again first.
   */
  private onOpen(reconnected: boolean) {
    this.connection = 'connected'
    this.sendSessionUpdate()
    if (reconnected) {
      for (const message of this.conversation) {
        if (message.role !== 'user' && message.role !== 'assistant') continue
        this.send(this.messageItem(message.role, message.content))
      }
    }
    const pending = this.pending
    this.pending = []
    pending.forEach((event) => this.send(event))
  }

  /**
   * Forgets what belonged to the session that is gone: its responses, and the
   * answer in progress, which is lost with it.
   */
  private resetSession() {
    this.requested.clear()
    this.response = undefined
    this.ignoredResponses.clear()
    this.audioItemId = undefined
    this.audioBytes = 0
    this.outputResampler.reset()
    // Tools still running answer a call the next session does not know, the
    // conversation sent again holding only messages
    this.generation++
    this.endAnswer()
  }

  private isIgnored(responseId?: string) {
    return (
      !responseId ||
      this.ignoredResponses.has(responseId) ||
      this.response?.id !== responseId
    )
  }

  private handleMessage(message: any) {
    switch (message?.type) {
      case 'response.created': {
        const id = message.response.id
        const requestId = message.response.metadata?.[REQUEST_METADATA_KEY]
        // A response the model started on its own belongs to the answer
        const requested: RequestedResponse | undefined = requestId
          ? this.requested.get(requestId)
          : { generation: this.generation, outOfBand: false }
        if (requestId) this.requested.delete(requestId)
        // Interrupted before it even started
        if (!requested || requested.generation !== this.generation) {
          this.ignoredResponses.add(id)
          this.send({ type: 'response.cancel', response_id: id })
          break
        }
        this.response = { id, ...requested }
        this.audioItemId = undefined
        this.audioBytes = 0
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
        this.addAnswerTranscript(message.delta)
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

      case 'error': {
        // Cancelling a response that just ended is expected
        if (message.error?.code === 'response_cancel_not_active') break
        this.log('Error:', message.error)
        // A refused request never gets a response, so the answer it was for
        // ends here, unless another response of that answer is under way
        const requestId = message.error?.event_id
        const requested = this.requested.get(requestId)
        if (!requested) break
        this.requested.delete(requestId)
        if (requested.generation === this.generation && !this.response) {
          this.endAnswer()
        }
        break
      }

      default:
        break
    }
  }

  private async onResponseDone(response: any) {
    if (this.ignoredResponses.delete(response.id)) return
    if (this.response?.id !== response.id) return
    this.response = undefined
    const generation = this.generation

    if (response.status === 'failed') {
      this.log('Response failed:', response.status_details)
    }

    const calls = (response.output ?? []).filter(
      (item: any) => item.type === 'function_call'
    )
    if (calls.length === 0) {
      this.endAnswer()
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
    } else {
      this.createResponse()
    }
  }
}
