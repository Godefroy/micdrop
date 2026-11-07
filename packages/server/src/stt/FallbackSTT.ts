import { PassThrough, Readable } from 'stream'
import { STT } from './STT'
import { Logger } from '..'

export interface FallbackSTTOptions {
  factories: Array<() => STT>
}

/**
 * An utterance waiting for its transcript, with what is needed to hand it to
 * the next STT: its audio so far, and the stream its next chunks go to.
 */
interface PendingUtterance {
  chunks: Buffer[]
  ended: boolean
  stream: PassThrough
}

export class FallbackSTT extends STT {
  private stt: STT | null = null
  private sttIndex = -1 // Start at -1 because we need to increment it before using it
  // In the order spoken, each STT giving one transcript per utterance in turn
  private pending: PendingUtterance[] = []

  constructor(private readonly options: FallbackSTTOptions) {
    super()
    if (this.options.factories.length === 0) {
      throw new Error('FallbackSTT: No factories provided')
    }
    this.startNextSTT()
  }

  transcribe(audioStream: Readable) {
    const utterance: PendingUtterance = {
      chunks: [],
      ended: false,
      stream: new PassThrough(),
    }
    this.pending.push(utterance)
    audioStream.on('data', (chunk: Buffer) => {
      utterance.chunks.push(chunk)
      utterance.stream.write(chunk)
    })
    audioStream.on('end', () => {
      utterance.ended = true
      utterance.stream.end()
    })
    this.stt?.transcribe(utterance.stream)
  }

  destroy() {
    super.destroy()
    this.stt?.destroy()
    this.stt = null
    this.sttIndex = -1
    this.pending = []
  }

  private startNextSTT() {
    this.sttIndex++
    if (this.sttIndex >= this.options.factories.length) {
      this.sttIndex = 0
    }
    this.stt?.destroy()
    this.stt = this.options.factories[this.sttIndex]()
    this.stt.on('Transcript', this.onTranscript)
    this.stt.on('Failed', this.onFailed)

    // Set logger after event loop
    setTimeout(() => {
      if (this.stt && this.logger) {
        this.stt.logger = new Logger(this.stt.constructor.name)
      }
    }, 0)
  }

  private onTranscript = (transcript: string) => {
    this.pending.shift()
    this.emit('Transcript', transcript)
  }

  /**
   * Hands every utterance still waiting to the next STT, one stream each so
   * each gets its own transcript. One still being spoken keeps going there.
   */
  private onFailed = () => {
    this.log('STT failed, trying next STT')
    this.startNextSTT()

    if (this.pending.length > 0) this.log('Sending audio chunks again')
    for (const utterance of this.pending) {
      utterance.stream = new PassThrough()
      this.stt?.transcribe(utterance.stream)
      utterance.chunks.forEach((chunk) => utterance.stream.write(chunk))
      if (utterance.ended) utterance.stream.end()
    }
  }
}
