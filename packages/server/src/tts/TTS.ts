import { EventEmitter } from 'eventemitter3'
import { Readable } from 'stream'
import { Logger } from '../Logger'
import { DEFAULT_SAMPLE_RATE } from '../types'

export interface TTSEvents {
  /** Voice of the answer, in PCM16 mono at `sampleRate` */
  Audio: [Buffer]
  Failed: [string[]]
}

export abstract class TTS extends EventEmitter<TTSEvents> {
  public logger?: Logger

  /**
   * Rate of the audio emitted, in Hz.
   *
   * The server reads it with each chunk and tells the client when it changes,
   * so the audio reaches the client at the rate the provider produced it. A
   * provider that offers several rates takes the one chosen in its options.
   */
  get sampleRate(): number {
    return DEFAULT_SAMPLE_RATE
  }

  abstract speak(textStream: Readable): void
  abstract cancel(): void

  protected log(...message: any[]) {
    this.logger?.log(...message)
  }

  destroy() {
    this.log('Destroyed')
    this.cancel()
  }
}
