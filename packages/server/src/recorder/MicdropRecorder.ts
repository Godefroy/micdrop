import { EventEmitter } from 'eventemitter3'
import type { MicdropServer } from '../MicdropServer'
import type { MicdropConversationItem } from '../types'
import { Logger } from '../Logger'
import { Pcm16Resampler } from '../audio'
import { DEFAULT_SAMPLE_RATE } from '../types'

export interface AudioMessage {
  /** PCM16 mono audio, at `sampleRate` */
  buffer: Buffer
  /** Rate of `buffer`, in Hz: 16 kHz for the user, the voice's for the assistant */
  sampleRate: number
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
  // Rate of the assistant message being recorded, the one of its first chunk
  private currentAssistantRate = DEFAULT_SAMPLE_RATE
  // Brings the chunks of a voice that changed rate mid-message, after a
  // fallback, to the rate of the message
  private assistantResampler?: { from: number; resampler: Pcm16Resampler }
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
    this.server.on('Message', this.onMessage)
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

  private onAssistantAudio = (
    chunk: Buffer,
    sampleRate = DEFAULT_SAMPLE_RATE
  ) => {
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
    this.currentAssistantChunks.push(this.toAssistantRate(chunk, sampleRate))
  }

  /** A message holds one rate, the one its first chunk came at */
  private toAssistantRate(chunk: Buffer, sampleRate: number): Buffer {
    if (this.currentAssistantChunks.length === 0) {
      this.currentAssistantRate = sampleRate
      this.assistantResampler = undefined
    }
    if (sampleRate === this.currentAssistantRate) return chunk
    if (this.assistantResampler?.from !== sampleRate) {
      this.assistantResampler = {
        from: sampleRate,
        resampler: new Pcm16Resampler(sampleRate, this.currentAssistantRate),
      }
    }
    return this.assistantResampler.resampler.process(chunk)
  }

  private onMessage = (message: MicdropConversationItem) => {
    const messageIndex = this.server.conversation.length - 1

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

    const message = this.server.conversation[this.lastUserMessageIndex]
    if (!message) return
    const buffer = Buffer.concat(this.currentUserChunks)

    const audioMessage: AudioMessage = {
      buffer,
      sampleRate: DEFAULT_SAMPLE_RATE,
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

    const message = this.server.conversation[this.lastAssistantMessageIndex]
    if (!message) return
    const buffer = Buffer.concat(this.currentAssistantChunks)

    const audioMessage: AudioMessage = {
      buffer,
      sampleRate: this.currentAssistantRate,
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
    this.assistantResampler = undefined
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
    this.server.off('Message', this.onMessage)

    this.removeAllListeners()
  }

  protected log(...message: any[]) {
    this.logger?.log(...message)
  }
}
