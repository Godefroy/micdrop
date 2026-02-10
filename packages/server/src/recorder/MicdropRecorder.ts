import { EventEmitter } from 'eventemitter3'
import type { MicdropServer } from '../MicdropServer'
import type { MicdropConversationItem } from '../types'
import { Logger } from '../Logger'

export interface AudioMessage {
  buffer: Buffer
  messageIndex: number
  message: string
  role: 'user' | 'assistant'
}

export interface MicdropRecorderEvents {
  AudioMessage: [AudioMessage]
  Complete: [AudioMessage[]]
}

export class MicdropRecorder extends EventEmitter<MicdropRecorderEvents> {
  public logger?: Logger

  private audioMessages: AudioMessage[] = []
  private currentUserChunks: Buffer[] = []
  private currentAssistantChunks: Buffer[] = []
  private lastUserMessageIndex: number = -1
  private lastAssistantMessageIndex: number = -1

  constructor(private server: MicdropServer) {
    super()
    this.setupListeners()
  }

  private setupListeners() {
    // Listen to audio events from server
    this.server.on('UserAudio', this.onUserAudio)
    this.server.on('AssistantAudio', this.onAssistantAudio)
    this.server.on('End', this.onEnd)

    // Listen to message events from agent
    const agent = this.server.config?.agent
    if (agent) {
      agent.on('Message', this.onMessage)
    }
  }

  private onUserAudio = (chunk: Buffer) => {
    // Finalize or discard assistant audio when user starts speaking
    if (this.currentAssistantChunks.length > 0) {
      if (this.lastAssistantMessageIndex >= 0) {
        this.finalizeAssistantAudio()
      } else {
        // Discard orphaned chunks (no associated message)
        this.log('Discarding orphaned assistant audio chunks')
        this.currentAssistantChunks = []
      }
    }

    this.log('Recording user audio chunk')
    this.currentUserChunks.push(chunk)
  }

  private onAssistantAudio = (chunk: Buffer) => {
    // Finalize or discard user audio when assistant starts speaking
    if (this.currentUserChunks.length > 0) {
      if (this.lastUserMessageIndex >= 0) {
        this.finalizeUserAudio()
      } else {
        // Discard orphaned chunks (no associated message)
        this.log('Discarding orphaned user audio chunks')
        this.currentUserChunks = []
      }
    }

    this.log('Recording assistant audio chunk')
    this.currentAssistantChunks.push(chunk)
  }

  private onMessage = (message: MicdropConversationItem) => {
    const conversation = this.server.config?.agent.conversation
    if (!conversation) return

    const messageIndex = conversation.length - 1

    if (message.role === 'user') {
      this.lastUserMessageIndex = messageIndex
      // User audio might already be complete, finalize if we have chunks
      // Audio chunks arrive BEFORE message, so we finalize when we know the message
      if (this.currentUserChunks.length > 0) {
        this.finalizeUserAudio()
      }
    } else if (message.role === 'assistant') {
      this.lastAssistantMessageIndex = messageIndex
      // Don't finalize assistant audio here - chunks can still arrive after message
    }
  }

  private finalizeUserAudio() {
    if (this.currentUserChunks.length === 0) return
    if (this.lastUserMessageIndex < 0) return

    const conversation = this.server.config?.agent.conversation
    if (!conversation) return

    const message = conversation[this.lastUserMessageIndex]
    const buffer = Buffer.concat(this.currentUserChunks)

    const audioMessage: AudioMessage = {
      buffer,
      messageIndex: this.lastUserMessageIndex,
      message: 'content' in message ? message.content : '',
      role: 'user',
    }

    this.log(
      `Finalized user audio: ${buffer.length} bytes, message index ${this.lastUserMessageIndex}`
    )
    this.audioMessages.push(audioMessage)
    this.emit('AudioMessage', audioMessage)

    // Reset
    this.currentUserChunks = []
    this.lastUserMessageIndex = -1
  }

  private finalizeAssistantAudio() {
    if (this.currentAssistantChunks.length === 0) return
    if (this.lastAssistantMessageIndex < 0) return

    const conversation = this.server.config?.agent.conversation
    if (!conversation) return

    const message = conversation[this.lastAssistantMessageIndex]
    const buffer = Buffer.concat(this.currentAssistantChunks)

    const audioMessage: AudioMessage = {
      buffer,
      messageIndex: this.lastAssistantMessageIndex,
      message: 'content' in message ? message.content : '',
      role: 'assistant',
    }

    this.log(
      `Finalized assistant audio: ${buffer.length} bytes, message index ${this.lastAssistantMessageIndex}`
    )
    this.audioMessages.push(audioMessage)
    this.emit('AudioMessage', audioMessage)

    // Reset
    this.currentAssistantChunks = []
    this.lastAssistantMessageIndex = -1
  }

  private onEnd = () => {
    // Finalize any remaining audio
    if (this.currentUserChunks.length > 0) {
      this.finalizeUserAudio()
    }
    if (this.currentAssistantChunks.length > 0) {
      this.finalizeAssistantAudio()
    }

    this.log(`Recording complete: ${this.audioMessages.length} audio messages`)
    this.emit('Complete', this.audioMessages)
  }

  public getAudioMessages(): AudioMessage[] {
    return [...this.audioMessages]
  }

  public destroy() {
    this.log('Destroyed')
    this.server.off('UserAudio', this.onUserAudio)
    this.server.off('AssistantAudio', this.onAssistantAudio)
    this.server.off('End', this.onEnd)

    const agent = this.server.config?.agent
    if (agent) {
      agent.off('Message', this.onMessage)
    }

    this.removeAllListeners()
  }

  protected log(...message: any[]) {
    this.logger?.log(...message)
  }
}
