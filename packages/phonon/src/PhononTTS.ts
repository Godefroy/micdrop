import { float32ToPcm16, Pcm16Resampler, SentenceTTS } from '@micdrop/server'
import { existsSync } from 'fs'
import { downloadCatalogVoice, getHubToken, HubOptions } from './hub'
import { VOICE_EXTENSION } from './modelFiles'
import type { PhononLanguage, PhononQuant } from './protocol'
import { loadSynthesizer, Synthesizer, SynthesizerOptions } from './synthesizer'
import { PHONON_VOICES, PhononVoice, PhononVoiceName } from './voices'

/**
 * Local Gradium Phonon text to speech, running in the Node process through
 * its WebAssembly build, on a worker thread. Nothing leaves the machine and no
 * server has to be started next to it.
 *
 * Phonon is Gradium's on-device model, built on Kyutai's Pocket TTS. It
 * generates faster than real time on a single core and hands its audio over
 * by frames of 80 ms, so the first words of a sentence reach the client in a
 * fraction of a second.
 *
 * The model and the voices are downloaded from Hugging Face on first use.
 *
 * @see https://huggingface.co/collections/gradium/phonon
 */

export interface PhononTTSOptions {
  /**
   * A Hugging Face repo, `hf://owner/name` or `hf://owner/name@revision`, or
   * the path to a model folder laid out the same way. Phonon 31M in English
   * by default, see `PHONON_MODELS` for the others.
   */
  model?: string

  /**
   * A voice of the catalog, by name ("Easton") or id, a voice of the model
   * folder, or the path to a voice file (`.safetensors`). The model's own
   * voice by default.
   */
  voice?: PhononVoiceName | (string & {})

  /**
   * Language the text is normalized as before it is spoken, which decides
   * how numbers and symbols are read. Takes a locale ("fr-FR") as well.
   * The language of the catalog voice by default, else "en".
   */
  language?: PhononLanguage | (string & {})

  /**
   * Word rewrites run on the normalized text: "default" (numbers, currency,
   * emails, urls, abbreviations), "all" (those and phones, times, dates),
   * "none", or a comma separated list of rule names.
   */
  rewrites?: string

  /**
   * Values for the conditioners the model's `config.json` lists, by name,
   * such as `{ padding_bonus: 0.5 }`.
   */
  conditions?: Record<string, number | string>

  /** Sampling temperature, 0.3 by default. */
  temperature?: number

  /** Sampling seed, so the same sentence comes out the same way. */
  seed?: number

  /** Weight precision of the flow transformer, "q8" by default. */
  quant?: PhononQuant

  /**
   * Hugging Face token, `HF_TOKEN` or the one `hf auth login` saved by
   * default. Only the gated 40M models need one, once their terms are
   * accepted on their page.
   */
  hfToken?: string

  /** Hugging Face cache folder, `HF_HUB_CACHE` or `~/.cache/huggingface/hub`. */
  cacheDir?: string

  /** Synthesizes one word at startup, on by default. */
  warmup?: boolean
}

export interface PhononModel {
  /** The value to pass as `model`. */
  model: string
  languages: PhononLanguage[]
  license: string
  /** Its weights are downloaded with a Hugging Face token only. */
  gated: boolean
}

/** The models Gradium publishes. They take the same options and voices. */
export const PHONON_MODELS = {
  'phonon-31m-en': hubModel('phonon-31m-en', ['en'], 'Apache-2.0', false),
  'phonon-40m-en': hubModel('phonon-40m-en', ['en'], 'CC-BY-NC-4.0'),
  'phonon-40m-fr': hubModel('phonon-40m-fr', ['fr'], 'CC-BY-NC-4.0'),
  'phonon-40m-de': hubModel('phonon-40m-de', ['de'], 'CC-BY-NC-4.0'),
  'phonon-40m-es': hubModel('phonon-40m-es', ['es'], 'CC-BY-NC-4.0'),
  'phonon-40m-pt': hubModel('phonon-40m-pt', ['pt'], 'CC-BY-NC-4.0'),
  'phonon-40m-multilingual': hubModel(
    'phonon-40m-multilingual',
    ['en', 'fr', 'de', 'es', 'pt'],
    'CC-BY-NC-4.0'
  ),
} satisfies Record<string, PhononModel>

// Pinned, so a model already in the cache loads without asking the Hub
const DEFAULT_MODEL =
  'hf://gradium/phonon-31m-en@541f5752bc3c79583068bb205bfda5eb39aaa08a'
const DEFAULT_LANGUAGE: PhononLanguage = 'en'
const DEFAULT_TEMPERATURE = 0.3
const LANGUAGES: PhononLanguage[] = ['en', 'fr', 'de', 'es', 'pt', 'none']
const OUTPUT_SAMPLE_RATE = 16000 // Rate expected by the Micdrop client

export class PhononTTS extends SentenceTTS {
  private readonly catalogVoice?: PhononVoice
  private voicePath?: Promise<string>

  constructor(private readonly options: PhononTTSOptions = {}) {
    super()
    this.catalogVoice = options.voice ? findVoice(options.voice) : undefined
    // Fail at startup rather than on the first sentence of the call
    parseLanguage(this.getLanguage())

    this.load().catch((error) => {
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
    const { synthesizer, voicePath } = await this.load()
    // The utterance may have been cancelled while the model was loading
    if (signal.aborted) return

    // One resampler for the whole sentence: its frames are a single continuous
    // stream, and the resampler carries its fractional position across them
    const resampler = new Pcm16Resampler(
      synthesizer.sampleRate,
      OUTPUT_SAMPLE_RATE
    )

    await synthesizer.generate({
      voicePath,
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
    const { synthesizer, voicePath } = await this.load()
    await synthesizer.generate({
      voicePath,
      text: 'Hello.',
      temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
      seed: this.getSeed(),
      onAudio: () => true,
    })
  }

  private async load(): Promise<{
    synthesizer: Synthesizer
    voicePath: string
  }> {
    const synthesizer = await loadSynthesizer(this.getSynthesizerOptions())
    if (!this.voicePath) {
      this.voicePath = this.resolveVoicePath(synthesizer)
      this.checkLanguage(synthesizer)
      // A failed download must not stick, the next sentence retries it
      this.voicePath.catch(() => (this.voicePath = undefined))
    }
    return { synthesizer, voicePath: await this.voicePath }
  }

  private async resolveVoicePath(synthesizer: Synthesizer): Promise<string> {
    const { voices, defaultVoice } = synthesizer.files
    const voice = this.options.voice ?? defaultVoice
    if (!voice) {
      throw new Error('Phonon model has no voice of its own, set the voice')
    }

    if (voice.endsWith(VOICE_EXTENSION)) {
      if (!existsSync(voice)) {
        throw new Error(`Phonon voice not found: "${voice}"`)
      }
      return voice
    }
    if (voices[voice]) return voices[voice]
    if (this.catalogVoice) {
      return downloadCatalogVoice(this.catalogVoice.id, this.getHubOptions())
    }
    throw new Error(
      `Phonon voice "${voice}" is neither in the catalog nor in the model, ` +
        'see PHONON_VOICES'
    )
  }

  /** Warns when the model was not trained for the language of the call. */
  private checkLanguage(synthesizer: Synthesizer) {
    const language = parseLanguage(this.getLanguage())
    if (language === 'none' || !synthesizer.languages.length) return
    if (!synthesizer.languages.includes(language)) {
      console.warn(
        `[PhononTTS] The model speaks ${synthesizer.languages.join(', ')}, ` +
          `not "${language}", pick another model in PHONON_MODELS`
      )
    }
  }

  private getLanguage(): string {
    return (
      this.options.language ?? this.catalogVoice?.language ?? DEFAULT_LANGUAGE
    )
  }

  private getSeed(): number {
    return this.options.seed ?? Math.floor(Math.random() * 2 ** 32)
  }

  private getHubOptions(): HubOptions {
    return {
      accessToken: this.options.hfToken ?? getHubToken(),
      cacheDir: this.options.cacheDir,
    }
  }

  private getSynthesizerOptions(): SynthesizerOptions {
    const { conditions } = this.options
    return {
      model: this.options.model ?? DEFAULT_MODEL,
      language: parseLanguage(this.getLanguage()),
      quant: this.options.quant,
      rewrites: this.options.rewrites,
      conditions:
        conditions &&
        Object.entries(conditions).map(([name, value]) => `${name}=${value}`),
      hub: this.getHubOptions(),
    }
  }
}

function hubModel(
  name: string,
  languages: PhononLanguage[],
  license: string,
  gated = true
): PhononModel {
  return { model: `hf://gradium/${name}`, languages, license, gated }
}

/** A voice of the catalog, by name whatever its case, or by id. */
function findVoice(voice: string): PhononVoice | undefined {
  const name = voice.toLowerCase()
  return PHONON_VOICES.find(
    (entry) => entry.id === voice || entry.name.toLowerCase() === name
  )
}

/** Reads "fr", "fr-FR" or "fr_FR" as "fr". */
function parseLanguage(language: string): PhononLanguage {
  const code = language.toLowerCase().split(/[-_]/)[0] as PhononLanguage
  if (!LANGUAGES.includes(code)) {
    throw new Error(
      `Phonon does not speak "${language}", ` +
        `use one of ${LANGUAGES.join(', ')}`
    )
  }
  return code
}
