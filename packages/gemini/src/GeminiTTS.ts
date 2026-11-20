import { GoogleGenAI } from '@google/genai'
import { MicdropVoice, SentenceTTS } from '@micdrop/server'
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

// Streams each sentence several times faster than it is spoken, its first
// sound in under a second
const DEFAULT_MODEL = 'gemini-3.8-flash-tts'
// The Interactions API only serves speech on its beta version: the default
// one answers that the model is not found
const API_VERSION = 'v1beta'
const DEFAULT_VOICE = 'Kore'
const GEMINI_SAMPLE_RATE = 24000 // Rate of the audio Gemini returns, sent as is
const DEFAULT_MAX_RETRY = 2

// The prebuilt voices, with the tone Google gives each one. The genders come
// from the Chirp 3 HD voices of Cloud Text-to-Speech, which carry the same names.
const VOICES: Array<[string, string, 'female' | 'male']> = [
  ['Zephyr', 'Bright', 'female'],
  ['Puck', 'Upbeat', 'male'],
  ['Charon', 'Informative', 'male'],
  ['Kore', 'Firm', 'female'],
  ['Fenrir', 'Excitable', 'male'],
  ['Leda', 'Youthful', 'female'],
  ['Orus', 'Firm', 'male'],
  ['Aoede', 'Breezy', 'female'],
  ['Callirrhoe', 'Easy-going', 'female'],
  ['Laomedeia', 'Upbeat', 'female'],
  ['Autonoe', 'Bright', 'female'],
  ['Enceladus', 'Breathy', 'male'],
  ['Iapetus', 'Clear', 'male'],
  ['Umbriel', 'Easy-going', 'male'],
  ['Algieba', 'Smooth', 'male'],
  ['Despina', 'Smooth', 'female'],
  ['Erinome', 'Clear', 'female'],
  ['Algenib', 'Gravelly', 'male'],
  ['Rasalgethi', 'Informative', 'male'],
  ['Achernar', 'Soft', 'female'],
  ['Alnilam', 'Firm', 'male'],
  ['Schedar', 'Even', 'male'],
  ['Gacrux', 'Mature', 'female'],
  ['Pulcherrima', 'Forward', 'female'],
  ['Achird', 'Friendly', 'male'],
  ['Zubenelgenubi', 'Casual', 'male'],
  ['Vindemiatrix', 'Gentle', 'female'],
  ['Sadachbia', 'Lively', 'male'],
  ['Sadaltager', 'Knowledgeable', 'male'],
  ['Sulafat', 'Warm', 'female'],
]

export class GeminiTTS extends SentenceTTS {
  /**
   * Lists the prebuilt voices, which speak every language the model does, so
   * `language` keeps them all. Gemini has no listing, so the list is written
   * here.
   */
  static async listVoices(
    options: { language?: string } = {}
  ): Promise<MicdropVoice[]> {
    return VOICES.map(([name, tone, gender]) => ({
      id: name,
      name,
      gender,
      description: tone,
    }))
  }

  private genai: GoogleGenAI
  // Read from the audio, which states its rate
  private rate = GEMINI_SAMPLE_RATE

  get sampleRate() {
    return this.rate
  }

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
        api_version: API_VERSION,
      },
      { fetchOptions: { signal } }
    )

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
      this.rate = sample_rate || GEMINI_SAMPLE_RATE
      const audio = Buffer.from(data, 'base64')
      if (audio.length > 0) progress.emitted = true
      // Cancelled or replaced, the rest is not wanted
      if (!this.emitAudio(audio)) break
    }
  }
}

/**
 * Whether Gemini may have refused the sentence on its content.
 *
 * The filter blocks an ordinary sentence now and then, and lets the very same
 * one through on the next request. The SDK does not retry a 400, so without a
 * second attempt the sentence is lost from the answer. The SDK can also lose
 * the body that names the reason, so any 400 counts: a request that is wrong
 * for good fails again on every attempt, which costs a few round trips.
 */
function isBlocked(error: any): boolean {
  return (
    error?.status === 400 ||
    error?.code === 'content_blocked' ||
    error?.error?.error?.code === 'content_blocked' ||
    String(error?.body ?? '').includes('content_blocked')
  )
}
