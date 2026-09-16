import { GoogleGenAI } from '@google/genai'
import { Pcm16Resampler, SentenceTTS } from '@micdrop/server'
import { GeminiOptions } from './GeminiAgent'

/**
 * Gemini text to speech, through the Interactions API
 *
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 *
 * The model reads a whole text at once, so the answer is cut into sentences,
 * and the audio of each one is emitted as the model streams it.
 */

export type GeminiTTSOptions = GeminiOptions & {
  model?: string
  // Name of a prebuilt voice, such as "Kore" or "Puck"
  voice?: string
  // Direction for the voice, such as "Say cheerfully", put before the text
  instructions?: string
  // Attempts after a sentence was blocked by mistake, see isBlocked()
  maxRetry?: number
}

// Sends each sentence whole, where gemini-3.1-flash-tts-preview streams it
// slower than it is spoken and leaves gaps in it
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts'
const DEFAULT_VOICE = 'Kore'
const GEMINI_SAMPLE_RATE = 24000 // Rate of the audio Gemini returns
const OUTPUT_SAMPLE_RATE = 16000 // Rate expected by the Micdrop client
const DEFAULT_MAX_RETRY = 2

export class GeminiTTS extends SentenceTTS {
  private genai: GoogleGenAI

  constructor(private readonly options: GeminiTTSOptions) {
    super()
    this.genai =
      'genai' in options
        ? options.genai
        : new GoogleGenAI({ apiKey: options.apiKey })
  }

  protected async synthesize(
    text: string,
    signal: AbortSignal
  ): Promise<undefined> {
    const input = this.options.instructions
      ? `${this.options.instructions}: ${text}`
      : text
    const maxRetry = this.options.maxRetry ?? DEFAULT_MAX_RETRY

    for (let attempt = 0; ; attempt++) {
      const progress = { emitted: false }
      try {
        await this.synthesizeOnce(input, signal, progress)
        return undefined
      } catch (error) {
        // A sentence already partly heard would be heard twice
        if (signal.aborted || progress.emitted || attempt >= maxRetry) {
          throw error
        }
        if (!isBlocked(error)) throw error
        this.log(`Sentence blocked, trying again: "${text}"`)
      }
    }
  }

  private async synthesizeOnce(
    input: string,
    signal: AbortSignal,
    progress: { emitted: boolean }
  ) {
    const stream = await this.genai.interactions.create(
      {
        model: this.options.model || DEFAULT_MODEL,
        store: false,
        stream: true,
        input,
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [{ voice: this.options.voice || DEFAULT_VOICE }],
        },
      },
      { fetchOptions: { signal } }
    )

    let resampler: Pcm16Resampler | undefined
    for await (const event of stream) {
      if (signal.aborted) break
      if (event.event_type === 'error') {
        throw Object.assign(
          new Error(event.error?.message || 'Speech generation failed'),
          { code: event.error?.code }
        )
      }
      if (event.event_type !== 'step.delta' || event.delta.type !== 'audio') {
        continue
      }

      const { data, sample_rate } = event.delta as {
        data?: string
        sample_rate?: number
      }
      if (!data) continue
      resampler ??= new Pcm16Resampler(
        sample_rate || GEMINI_SAMPLE_RATE,
        OUTPUT_SAMPLE_RATE
      )
      const audio = resampler.process(Buffer.from(data, 'base64'))
      if (audio.length > 0) progress.emitted = true
      // Cancelled or replaced, the rest is not wanted
      if (!this.emitAudio(audio)) break
    }
  }
}

/**
 * Whether Gemini refused the sentence on its content.
 *
 * The filter blocks an ordinary sentence now and then, and lets the very same
 * one through on the next request. The SDK does not retry a 400, so without a
 * second attempt the sentence is lost from the answer.
 */
function isBlocked(error: any): boolean {
  return (
    error?.code === 'content_blocked' ||
    error?.error?.error?.code === 'content_blocked' ||
    String(error?.body ?? '').includes('content_blocked')
  )
}
