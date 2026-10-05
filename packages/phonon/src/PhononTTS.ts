import { float32ToPcm16, Pcm16Resampler, SentenceTTS } from '@micdrop/server'
import { listVoices, PhononVoiceName, resolveVoicePath } from './modelFiles'
import type { PhononLanguage, PhononQuant } from './protocol'
import { loadSynthesizer, SynthesizerOptions } from './synthesizer'

/**
 * Local Gradium Phonon text to speech, running in the Node process through
 * its WebAssembly build, on a worker thread. Nothing leaves the machine and no
 * server has to be started next to it.
 *
 * Phonon is Gradium's on-device model, built on Kyutai's Pocket TTS. It
 * generates several times faster than real time on a single core and hands
 * its audio over by frames of 80 ms, so the first words of a sentence reach
 * the client in about a hundred milliseconds.
 *
 * The weights are supplied by Gradium, see the README.
 *
 * @see https://github.com/gradium-ai/xn-ptts
 */

export interface PhononTTSOptions {
  /** Folder holding the model files, as extracted from the archive. */
  modelDir: string

  /**
   * A voice of the model folder ("Freya"), or the path to a voice file of its
   * own (`.safetensors`).
   */
  voice?: PhononVoiceName | (string & {})

  /**
   * Language the text is normalized as before it is spoken, which decides
   * how numbers and symbols are read. Takes a locale ("fr-FR") as well.
   * "en" by default.
   */
  language?: PhononLanguage | (string & {})

  /**
   * Word rewrites run on the normalized text: "default" (numbers, currency,
   * emails, urls), "all" (those and phones, times, dates) or "none".
   */
  rewrites?: string

  /** Sampling temperature, 0.3 by default. */
  temperature?: number

  /** Sampling seed, so the same sentence comes out the same way. */
  seed?: number

  /** Weight precision of the flow transformer, "q8" by default. */
  quant?: PhononQuant

  /** Synthesizes one word at startup, on by default. */
  warmup?: boolean
}

const DEFAULT_VOICE: PhononVoiceName = 'Freya'
const DEFAULT_LANGUAGE: PhononLanguage = 'en'
const DEFAULT_TEMPERATURE = 0.3
const LANGUAGES: PhononLanguage[] = ['en', 'fr', 'de', 'es', 'pt', 'none']
const OUTPUT_SAMPLE_RATE = 16000 // Rate expected by the Micdrop client

export class PhononTTS extends SentenceTTS {
  private readonly voicePath: string

  constructor(private readonly options: PhononTTSOptions) {
    super()

    // Fail at startup rather than on the first sentence of the call
    this.voicePath = resolveVoicePath(options.modelDir, this.getVoice())

    loadSynthesizer(this.getSynthesizerOptions()).catch((error) => {
      console.error('[PhononTTS] Failed to load model:', error)
    })

    if (options.warmup !== false) {
      this.warmup()
        .then(() => this.log('Model warmed up'))
        .catch(() => {})
    }
  }

  protected async synthesize(
    text: string,
    signal: AbortSignal
  ): Promise<undefined> {
    const synthesizer = await loadSynthesizer(this.getSynthesizerOptions())
    // The utterance may have been cancelled while the model was loading
    if (signal.aborted) return

    // One resampler for the whole sentence: its frames are a single continuous
    // stream, and the resampler carries its fractional position across them
    const resampler = new Pcm16Resampler(
      synthesizer.sampleRate,
      OUTPUT_SAMPLE_RATE
    )

    await synthesizer.generate({
      voicePath: this.voicePath,
      text,
      temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
      seed: this.getSeed(),
      signal,
      // Stop generating what nobody is going to hear
      onAudio: (samples) =>
        this.emitAudio(resampler.process(float32ToPcm16(samples))),
    })
  }

  /**
   * Speaks one short word to pay the first inference up front.
   *
   * It also registers the voice with the model, so the first sentence of the
   * call only pays for its own generation.
   */
  private async warmup(): Promise<void> {
    const synthesizer = await loadSynthesizer(this.getSynthesizerOptions())
    await synthesizer.generate({
      voicePath: this.voicePath,
      text: 'Hello.',
      temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
      seed: this.getSeed(),
      onAudio: () => true,
    })
  }

  private getVoice(): string {
    if (this.options.voice) return this.options.voice
    // A model of another language may not hold the English voices
    const voices = listVoices(this.options.modelDir)
    return voices.includes(DEFAULT_VOICE) ? DEFAULT_VOICE : (voices[0] ?? '')
  }

  private getSeed(): number {
    return this.options.seed ?? Math.floor(Math.random() * 2 ** 32)
  }

  private getSynthesizerOptions(): SynthesizerOptions {
    return {
      modelDir: this.options.modelDir,
      language: parseLanguage(this.options.language),
      quant: this.options.quant,
      rewrites: this.options.rewrites,
    }
  }
}

/** Reads "fr", "fr-FR" or "fr_FR" as "fr". */
function parseLanguage(language?: string): PhononLanguage {
  if (!language) return DEFAULT_LANGUAGE
  const code = language.toLowerCase().split(/[-_]/)[0] as PhononLanguage
  if (!LANGUAGES.includes(code)) {
    throw new Error(
      `Phonon does not speak "${language}", ` +
        `use one of ${LANGUAGES.join(', ')}`
    )
  }
  return code
}
