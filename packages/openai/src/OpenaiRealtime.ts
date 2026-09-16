import {
  MicdropConversationToolCall,
  Pcm16Resampler,
  Realtime,
  RealtimeOptions,
} from '@micdrop/server'
import WebSocket from 'ws'
import z, { toJSONSchema } from 'zod'

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
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

/** A response asked for, until the API gives it an id */
interface RequestedResponse {
  generation: number
  // Out of the conversation, so there is no item to truncate
  outOfBand: boolean
}

export class OpenaiRealtime extends Realtime<OpenaiRealtimeOptions> {
  private socket?: WebSocket
  private connected = false
  private everConnected = false
  private destroyed = false
  // Events sent while the connection opens
  private pending: object[] = []
  private reconnectTimeout?: NodeJS.Timeout
  private retryCount = 0

  private inputResampler = new Pcm16Resampler(SAMPLE_RATE, OPENAI_SAMPLE_RATE)
  private outputResampler = new Pcm16Resampler(OPENAI_SAMPLE_RATE, SAMPLE_RATE)

  // Bumped by every interruption, so late responses can tell they are stale
  private generation = 0
  private requested: RequestedResponse[] = []
  private response?: { id: string } & RequestedResponse
  private ignoredResponses = new Set<string>()
  // Audio of the response being played, to cut what the user did not hear
  private audioItemId?: string
  private audioStartedAt = 0
  private audioBytes = 0

  constructor(options: OpenaiRealtimeOptions) {
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
    if (this.connected) this.sendSessionUpdate()
  }

  protected injectMessage(role: 'user' | 'assistant' | 'system', text: string) {
    // The whole conversation is sent again once reconnected
    if (!this.connected && this.everConnected) return
    this.send(this.messageItem(role, text))
  }

  private createResponse(response?: object) {
    this.requested.push({
      generation: this.generation,
      outOfBand: !!response,
    })
    this.send({ type: 'response.create', ...(response ? { response } : {}) })
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
    this.socket?.send(
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
                model:
                  this.options.transcriptionModel ||
                  DEFAULT_TRANSCRIPTION_MODEL,
                ...(this.options.language
                  ? { language: this.options.language }
                  : {}),
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

  private connect() {
    this.initWS().catch((error) => {
      this.log('Connection error:', error)
      this.reconnect()
    })
  }

  private initWS(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const model = this.options.model || DEFAULT_MODEL
      const socket = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        { headers: { Authorization: `Bearer ${this.options.apiKey}` } }
      )
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

        // A new connection starts from an empty conversation
        if (this.everConnected) {
          for (const message of this.conversation) {
            if (message.role !== 'user' && message.role !== 'assistant') {
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
    this.requested = []
    this.response = undefined
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

  private isIgnored(responseId?: string) {
    return (
      !responseId ||
      this.ignoredResponses.has(responseId) ||
      this.response?.id !== responseId
    )
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'response.created': {
        const requested = this.requested.shift() ?? {
          generation: this.generation,
          outOfBand: false,
        }
        const id = message.response.id
        // Interrupted before it even started
        if (requested.generation !== this.generation) {
          this.ignoredResponses.add(id)
          this.socket?.send(
            JSON.stringify({ type: 'response.cancel', response_id: id })
          )
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

      case 'error':
        // Cancelling a response that just ended is expected
        if (message.error?.code === 'response_cancel_not_active') break
        this.log('Error:', message.error)
        break

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
