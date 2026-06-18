import { TTS } from '@micdrop/server'
import OpenAI from 'openai'
import { Readable } from 'stream'
import { OpenaiOptions } from './OpenaiAgent'
import { Pcm16Resampler } from './utils/Pcm16Resampler'

/**
 * OpenAI Text-to-Speech
 *
 * @see https://platform.openai.com/docs/guides/text-to-speech
 *
 * The OpenAI speech endpoint takes a complete text input (no streaming text
 * in), so the incoming text stream is buffered into sentences and each
 * sentence is synthesized as soon as it is complete. Requests are processed
 * sequentially, which keeps the emitted audio in order while still starting
 * playback as soon as the first sentence is ready.
 */

export type OpenaiTTSOptions = OpenaiOptions & {
  model?: string
  voice?: string
  // Prosody instructions (accent, emotion, speed, tone...).
  // Only works with gpt-4o-mini-tts, not tts-1 / tts-1-hd.
  instructions?: string
  // Speech speed from 0.25 to 4.0. Only works with tts-1 / tts-1-hd.
  speed?: number
}

const DEFAULT_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_VOICE = 'alloy'
const OPENAI_SAMPLE_RATE = 24000 // Rate of the pcm output from OpenAI
const OUTPUT_SAMPLE_RATE = 16000 // Rate expected by the Micdrop client

interface QueueItem {
  counter: number
  text: string
}

export class OpenaiTTS extends TTS {
  private openai: OpenAI
  private counter = 0 // Identifies the current speak() call
  private buffer = '' // Incomplete sentence waiting for more text
  private queue: QueueItem[] = []
  private processing = false
  private abortController?: AbortController

  constructor(private readonly options: OpenaiTTSOptions) {
    super()
    this.openai =
      'openai' in options
        ? options.openai
        : new OpenAI({ apiKey: options.apiKey })
  }

  speak(textStream: Readable) {
    this.counter++
    const counter = this.counter
    this.buffer = ''

    textStream.on('data', (chunk: Buffer) => {
      if (counter !== this.counter) return
      this.buffer += chunk.toString('utf-8')
      this.flushSentences(counter, false)
    })

    textStream.on('error', (error) => {
      this.log('Error in text stream', error)
    })

    textStream.on('end', () => {
      if (counter !== this.counter) return
      this.flushSentences(counter, true)
    })
  }

  cancel() {
    this.log('Cancel')
    // Increment counter to ignore in-flight and queued work
    this.counter++
    this.buffer = ''
    this.queue = []
    this.abortController?.abort()
    this.abortController = undefined
  }

  // Extract complete sentences from the buffer and enqueue them.
  // On `end`, whatever remains in the buffer is flushed as a last sentence.
  private flushSentences(counter: number, end: boolean) {
    const regex = /[\s\S]*?[.!?…\n]+(?=\s|$)/g
    let match: RegExpExecArray | null
    let lastIndex = 0
    while ((match = regex.exec(this.buffer)) !== null) {
      // A sentence ending at the very end of an unfinished stream may still
      // grow, so keep it buffered until more text arrives or the stream ends.
      if (!end && regex.lastIndex === this.buffer.length) break
      const sentence = match[0].trim()
      if (sentence) this.enqueue(counter, sentence)
      lastIndex = regex.lastIndex
    }
    this.buffer = this.buffer.slice(lastIndex)

    if (end) {
      const rest = this.buffer.trim()
      if (rest) this.enqueue(counter, rest)
      this.buffer = ''
    }
  }

  private enqueue(counter: number, text: string) {
    this.queue.push({ counter, text })
    this.processQueue()
  }

  private async processQueue() {
    if (this.processing) return
    this.processing = true

    while (this.queue.length > 0) {
      const item = this.queue.shift()!
      // Skip work from a cancelled or superseded speak() call
      if (item.counter !== this.counter) continue
      await this.synthesize(item.counter, item.text)
    }

    this.processing = false
    // Items may have been enqueued right as we exited the loop
    if (this.queue.length > 0) this.processQueue()
  }

  private async synthesize(counter: number, text: string) {
    const abortController = new AbortController()
    this.abortController = abortController

    try {
      const response = await this.openai.audio.speech.create(
        {
          model: this.options.model || DEFAULT_MODEL,
          voice: this.options.voice || DEFAULT_VOICE,
          input: text,
          response_format: 'pcm',
          ...(this.options.instructions
            ? { instructions: this.options.instructions }
            : {}),
          ...(this.options.speed ? { speed: this.options.speed } : {}),
        },
        { signal: abortController.signal }
      )

      if (!response.body) return
      this.log(`Synthesizing: "${text}"`)

      const resampler = new Pcm16Resampler(
        OPENAI_SAMPLE_RATE,
        OUTPUT_SAMPLE_RATE
      )
      const reader = response.body.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (counter !== this.counter) {
          await reader.cancel()
          break
        }
        const output = resampler.process(Buffer.from(value))
        if (output.length > 0) this.emit('Audio', output)
      }
    } catch (error) {
      if (abortController.signal.aborted) return
      this.log('Error synthesizing speech:', error)
      this.emit('Failed', [text])
    } finally {
      if (this.abortController === abortController) {
        this.abortController = undefined
      }
    }
  }
}
