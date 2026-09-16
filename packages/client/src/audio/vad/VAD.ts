import { EventEmitter } from 'eventemitter3'
import { MicSource } from '../types'

export interface VADEvents {
  // Speech starts, even it it's not confirmed
  StartSpeaking: void
  // Speech start is confirmed
  ConfirmSpeaking: void
  // Speech is cancelled, it's just noise and can be ignored
  CancelSpeaking: void
  // Speech stops, only if it's confirmed
  StopSpeaking: void
  // Status changed
  ChangeStatus: [VADStatus]
}

export enum VADStatus {
  Silence,
  MaybeSpeaking,
  Speaking,
}

/**
 * Abstract VAD class
 * VAD = Voice Activity Detection
 */
export abstract class VAD extends EventEmitter<VADEvents> {
  public readonly name = this.constructor.name
  public status: VADStatus = VADStatus.Silence

  // Worst case time this VAD takes to notice that someone started speaking.
  // That much audio is kept in reserve and sent along with the turn, so the
  // beginning of a sentence reaches the server rather than being cut off.
  // A VAD that needs several samples to make up its mind has to say so here.
  public delay = 100 // ms

  /**
   * Checks if the VAD is started
   * @returns True if the VAD is started, false otherwise
   */
  abstract get isStarted(): boolean

  /**
   * Checks if the VAD is paused
   * @returns True if the VAD is paused, false otherwise
   */
  abstract get isPaused(): boolean

  /**
   * Starts the VAD
   * @param mic - The microphone to listen to
   */
  abstract start(mic: MicSource): Promise<void>

  /**
   * Stops the VAD
   */
  abstract stop(): Promise<void>

  /**
   * Pauses the VAD
   */
  abstract pause(): Promise<void>

  /**
   * Resumes the VAD
   */
  abstract resume(): Promise<void>

  /**
   * Emits an event (overrides the default implementation)
   * @param event - The event to emit
   * @param args - The arguments to emit
   * @returns True if the event was emitted, false otherwise
   */
  emit<T extends keyof VADEvents>(
    event: T,
    ...args: EventEmitter.EventArgs<VADEvents, T>
  ) {
    switch (event) {
      case 'StartSpeaking':
        this.setStatus(VADStatus.MaybeSpeaking)
        break
      case 'ConfirmSpeaking':
        this.setStatus(VADStatus.Speaking)
        break
      case 'CancelSpeaking':
        this.setStatus(VADStatus.Silence)
        break
      case 'StopSpeaking':
        this.setStatus(VADStatus.Silence)
        break
      default:
        break
    }
    return super.emit(event, ...args)
  }

  /**
   * Sets the status of the VAD
   * @param status - The status to set
   */
  protected setStatus(status: VADStatus) {
    if (this.status === status) return
    this.status = status
    super.emit('ChangeStatus', status)
  }
}
