import { PassThrough, Readable } from 'stream'
import { TTS } from './TTS'
import { Logger } from '..'

export interface FallbackTTSOptions {
  factories: Array<() => TTS>
}

/** The utterance being spoken, and the stream its next text goes to */
interface CurrentUtterance {
  ended: boolean
  stream: PassThrough
}

export class FallbackTTS extends TTS {
  private tts: TTS | null = null
  private ttsIndex = -1 // Start at -1 because we need to increment it before using it
  private current?: CurrentUtterance

  constructor(private readonly options: FallbackTTSOptions) {
    super()
    if (this.options.factories.length === 0) {
      throw new Error('FallbackTTS: No factories provided')
    }
    this.startNextTTS()
  }

  speak(textStream: Readable) {
    const utterance: CurrentUtterance = {
      ended: false,
      stream: new PassThrough(),
    }
    this.current = utterance
    textStream.on('data', (chunk) => utterance.stream.write(chunk))
    textStream.on('end', () => {
      utterance.ended = true
      utterance.stream.end()
    })
    this.tts?.speak(utterance.stream)
  }

  cancel() {
    this.current = undefined
    this.tts?.cancel()
  }

  destroy() {
    super.destroy()
    this.tts?.destroy()
    this.tts = null
    this.ttsIndex = -1
  }

  private startNextTTS() {
    this.ttsIndex++
    if (this.ttsIndex >= this.options.factories.length) {
      this.ttsIndex = 0
    }
    this.tts?.destroy()
    this.tts = this.options.factories[this.ttsIndex]()
    this.tts.on('Audio', this.onAudio)
    this.tts.on('Failed', this.onFailed)

    // Set logger after event loop
    setTimeout(() => {
      if (this.tts && this.logger) {
        this.tts.logger = new Logger(this.tts.constructor.name)
      }
    }, 0)
  }

  private onAudio = (audio: Buffer) => {
    this.emit('Audio', audio)
  }

  /**
   * Hands the unspoken text to the next TTS. An utterance whose text is still
   * being written goes on there, so its end is spoken too.
   */
  private onFailed = (chunks: string[]) => {
    this.log('TTS failed, trying next TTS')
    this.startNextTTS()

    const utterance = this.current
    const continues = !!utterance && !utterance.ended
    if (chunks.length === 0 && !continues) return
    this.log('Sending text chunks again')
    const stream = new PassThrough()
    this.tts?.speak(stream)
    chunks.forEach((chunk) => stream.write(chunk))
    if (continues) utterance.stream = stream
    else stream.end()
  }
}
