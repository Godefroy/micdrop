import { EventEmitter } from 'eventemitter3'
import { Duplex, PassThrough, Readable } from 'stream'
import { WebSocket } from 'ws'
import type { Agent } from './agent'
import { Logger } from './Logger'
import type { STT } from './stt'
import type { TTS } from './tts'
import {
  MicdropCallSummary,
  MicdropClientCommands,
  MicdropConversationItem,
  MicdropServerCommands,
} from './types'

export interface MicdropServerEvents {
  End: [MicdropCallSummary]
  UserAudio: [Buffer]
  AssistantAudio: [Buffer]
}

export interface MicdropConfig {
  firstMessage?: string
  generateFirstMessage?: boolean
  agent: Agent
  stt: STT
  tts: TTS
}

export class MicdropServer extends EventEmitter<MicdropServerEvents> {
  public socket: WebSocket | null = null
  public config: MicdropConfig | null = null
  public logger?: Logger

  private startTime = Date.now()
  private lastMessageSpeeched?: MicdropConversationItem

  // Queue system for operations
  private operationQueue: Array<() => Promise<void>> = []
  private isProcessingQueue = false

  // When user is speaking, we're streaming chunks for STT
  private currentUserStream?: Duplex
  private userSpeechChunks = 0

  constructor(socket: WebSocket, config: MicdropConfig) {
    super()
    this.socket = socket
    this.config = config
    this.log(`Call started`)

    // Setup STT
    this.config.stt.on('Transcript', this.onTranscriptSTT)

    // Setup TTS
    this.config.tts.on('Audio', this.onAudioTTS)

    // Setup agent
    this.config.agent.on('Message', (message) =>
      this.socket?.send(
        `${MicdropServerCommands.Message} ${JSON.stringify(message)}`
      )
    )
    this.config.agent.on('CancelLastUserMessage', () =>
      this.socket?.send(MicdropServerCommands.CancelLastUserMessage)
    )
    this.config.agent.on('SkipAnswer', () =>
      this.socket?.send(MicdropServerCommands.SkipAnswer)
    )
    this.config.agent.on('EndCall', () =>
      this.socket?.send(MicdropServerCommands.EndCall)
    )
    this.config.agent.on('ToolCall', (toolCall) =>
      this.socket?.send(
        `${MicdropServerCommands.ToolCall} ${JSON.stringify(toolCall)}`
      )
    )

    // Assistant speaks first
    this.sendFirstMessage()

    // Listen to events
    socket.on('close', this.onClose)
    socket.on('message', this.onMessage)
  }

  private log(...message: any[]) {
    this.logger?.log(...message)
  }

  private async processQueue() {
    if (this.isProcessingQueue || this.operationQueue.length === 0) return

    this.isProcessingQueue = true

    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift()
      if (operation) {
        try {
          await operation()
        } catch (error) {
          this.log('Error processing queued operation:', error)
        }
      }
    }

    this.isProcessingQueue = false
  }

  private queueOperation(operation: () => Promise<void>) {
    this.operationQueue.push(operation)
    this.processQueue()
  }

  public cancel() {
    this.config?.tts.cancel()
    this.config?.agent.cancel()
    // Clear the queue
    this.operationQueue = []
  }

  private onClose = () => {
    if (!this.config) return
    this.log('Connection closed')
    const duration = Math.round((Date.now() - this.startTime) / 1000)

    // Destroy instances
    this.config.agent.destroy()
    this.config.stt.destroy()
    this.config.tts.destroy()

    // Emit End event
    this.emit('End', {
      conversation: this.config.agent.conversation,
      duration,
    })

    // Unset params
    this.socket = null
    this.config = null
  }

  private onMessage = async (message: Buffer) => {
    if (message.byteLength === 0) return
    if (!Buffer.isBuffer(message)) {
      this.log('Message is not a buffer')
      return
    }

    // Commands
    if (message.byteLength < 15) {
      const cmd = message.toString()
      this.log(`Command: ${cmd}`)

      if (cmd === MicdropClientCommands.StartSpeaking) {
        // User started speaking
        this.onStartSpeaking()
      } else if (cmd === MicdropClientCommands.Mute) {
        // User muted the call
        this.onMute()
      } else if (cmd === MicdropClientCommands.StopSpeaking) {
        // User stopped speaking
        this.onStopSpeaking()
      }
    }

    // Audio chunk
    else if (this.currentUserStream) {
      this.onUserAudio(message)
    }
  }

  private onUserAudio(chunk: Buffer) {
    this.log(`Received chunk (${chunk.byteLength} bytes)`)
    this.currentUserStream?.write(chunk)
    this.userSpeechChunks++
    this.emit('UserAudio', chunk)
  }

  private onMute() {
    this.userSpeechChunks = 0
    this.currentUserStream?.end()
    this.currentUserStream = undefined
    this.cancel()
  }

  private onStartSpeaking() {
    if (!this.config) return
    this.userSpeechChunks = 0
    this.currentUserStream?.end()
    this.currentUserStream = new PassThrough()
    this.config.stt.transcribe(this.currentUserStream)
    this.cancel()
  }

  private onStopSpeaking() {
    const hasNoUserSpeech =
      !this.currentUserStream || this.userSpeechChunks === 0
    this.currentUserStream?.end()
    this.currentUserStream = undefined
    this.userSpeechChunks = 0

    // If user is not speaking or no chunks were received, skip
    if (hasNoUserSpeech) {
      this.socket?.send(MicdropServerCommands.SkipAnswer)
      return
    }

    const conversation = this.config?.agent.conversation
    const lastMessage = conversation?.[conversation.length - 1]
    if (
      lastMessage?.role === 'user' &&
      this.lastMessageSpeeched !== lastMessage
    ) {
      this.log(
        'User stopped speaking and a transcript already exists, answering'
      )
      this.cancel()
      this.answer()
    }
  }

  private onTranscriptSTT = async (transcript: string) => {
    if (!this.config) return

    // Skip answer if transcript is empty
    if (transcript === '') {
      this.socket?.send(MicdropServerCommands.SkipAnswer)
      return
    }

    this.log(`User transcript: "${transcript}"`)
    this.config.agent.addUserMessage(transcript)

    // Answer if user stopped speaking
    if (!this.currentUserStream) {
      this.log('User stopped speaking, answering')
      this.cancel()
      this.answer()
    }
  }

  private onAudioTTS = (audio: Buffer) => {
    if (!this.socket) return
    this.log(`Send audio chunk (${audio.byteLength} bytes)`)
    this.socket.send(audio)
    this.emit('AssistantAudio', audio)
  }

  private sendFirstMessage() {
    if (!this.config) return
    if (this.config.firstMessage) {
      // Send first message
      this.config.agent.addAssistantMessage(this.config.firstMessage)
      this.speak(this.config.firstMessage)
    } else if (this.config.generateFirstMessage) {
      // Generate first message
      this.answer()
    } else {
      // Skip answer if no first message is provided
      // to avoid keeping the client in a processing state
      this.socket?.send(MicdropServerCommands.SkipAnswer)
    }
  }

  public answer() {
    this.queueOperation(async () => {
      await this._answer()
    })
  }

  private async _answer() {
    if (!this.config) return

    // Prevent answering twice
    const lastMessage =
      this.config.agent.conversation[this.config.agent.conversation.length - 1]
    if (this.lastMessageSpeeched === lastMessage) {
      this.log('Already answered, skipping')
      return
    }
    this.lastMessageSpeeched = lastMessage

    try {
      // LLM: Generate answer
      const stream = this.config.agent.answer()

      // TTS: Generate answer audio
      await this._speak(stream)
    } catch (error) {
      this.socket?.send(MicdropServerCommands.SkipAnswer)
      throw error
    }
  }

  // Run text-to-speech and send to client
  public speak(message: string | Readable) {
    this.queueOperation(async () => {
      await this._speak(message)
    })
  }

  private async _speak(message: string | Readable) {
    if (!this.socket || !this.config) return

    // Convert message to stream if needed
    let textStream: Readable
    if (typeof message === 'string') {
      const stream = new PassThrough()
      stream.write(message)
      stream.end()
      textStream = stream
    } else {
      textStream = message
    }

    // Run TTS
    this.config.tts.speak(textStream)
  }
}
