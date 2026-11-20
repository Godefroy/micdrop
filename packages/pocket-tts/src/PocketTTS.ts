import { float32ToPcm16, MicdropVoice, SentenceTTS } from '@micdrop/server'
import sherpa, { type GenerationConfig } from 'sherpa-onnx-node'
import {
  PocketBundledVoice,
  resolveModelFiles,
  resolveVoicePath,
} from './modelFiles'
import { loadSynthesizer, loadVoice, SynthesizerOptions } from './synthesizer'

/**
 * Local Pocket TTS text to speech, running in the Node process through the
 * sherpa-onnx addon and ONNX Runtime. Nothing leaves the machine and no server
 * has to be started next to it.
 *
 * Pocket TTS is a 100 million parameter model from Kyutai, built for the CPU,
 * that clones the voice of a few seconds of reference audio. It generates
 * several times faster than real time and hands its audio over while it is
 * still writing the rest, so the first words of a sentence reach the client in
 * about three hundred milliseconds.
 *
 * The weights are downloaded separately, see the README.
 *
 * @see https://github.com/kyutai-labs/pocket-tts
 * @see https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html
 */

export interface PocketTTSOptions {
  /** Folder holding the model files, as extracted from the archive. */
  modelDir: string

  /**
   * Voice to clone: a bundled name ("bria"), or the path to a wav file
   * carrying a few seconds of the voice to speak with.
   */
  voice?: PocketBundledVoice | (string & {})

  /** Speech rate, 1 being the natural pace of the voice. */
  speed?: number

  /** Sampling steps per frame, higher sounding better and generating slower. */
  numSteps?: number

  /** Seconds of the reference audio the voice is built from. */
  referenceLength?: number

  /** Sampling seed, so the same sentence comes out the same way. */
  seed?: number

  /** Threads given to ONNX Runtime, 2 by default. */
  numThreads?: number

  /** Execution provider passed to ONNX Runtime, "cpu" by default. */
  provider?: 'cpu' | 'cuda' | 'coreml'

  /** Synthesizes one word at startup, on by default. */
  warmup?: boolean
}

const DEFAULT_VOICE: PocketBundledVoice = 'bria'
const DEFAULT_NUM_STEPS = 2
const DEFAULT_REFERENCE_LENGTH = 12
// Rate of the model, until it is loaded and states its own
const DEFAULT_SAMPLE_RATE = 24000

export class PocketTTS extends SentenceTTS {
  /**
   * Lists the reference voices the archive ships. Pocket TTS speaks English
   * alone and clones any recording given as `voice`, so `language` keeps
   * them only for English.
   */
  static async listVoices(
    options: { language?: string } = {}
  ): Promise<MicdropVoice[]> {
    if (options.language && !/^en\b/i.test(options.language)) return []
    return [
      {
        id: 'bria',
        name: 'Bria',
        languages: ['en'],
        gender: 'female',
        description: 'A woman reading calmly',
      },
      {
        id: 'loona',
        name: 'Loona',
        languages: ['en'],
        description: 'Cloned from a one second clip',
      },
      {
        id: 'frenchAccent',
        name: 'French accent',
        languages: ['en'],
        description: 'A French speaker cloned into English words',
      },
    ]
  }

  // The model states its rate once loaded, and the audio is sent at it
  private rate = DEFAULT_SAMPLE_RATE

  constructor(private readonly options: PocketTTSOptions) {
    super()

    // Fail at startup rather than on the first sentence of the call
    resolveModelFiles(options.modelDir)

    loadSynthesizer(this.getSynthesizerOptions()).catch((error) => {
      console.error('[PocketTTS] Failed to load model:', error)
    })

    if (options.warmup !== false) {
      this.warmup()
        .then(() => this.log('Model warmed up'))
        .catch(() => {})
    }
  }

  get sampleRate() {
    return this.rate
  }

  protected async synthesize(
    text: string,
    signal: AbortSignal
  ): Promise<undefined> {
    const synthesizer = await loadSynthesizer(this.getSynthesizerOptions())
    // The utterance may have been cancelled while the model was loading
    if (signal.aborted) return

    this.rate = synthesizer.sampleRate

    await synthesizer.generateAsync({
      text,
      // The samples of a chunk live in native memory for the length of the
      // callback, which is where they are copied into a PCM16 buffer
      enableExternalBuffer: true,
      generationConfig: this.getGenerationConfig(),
      onProgress: ({ samples }) => {
        const audio = float32ToPcm16(samples)
        // Stop generating what nobody is going to hear
        return this.emitAudio(audio) ? 1 : 0
      },
    })
  }

  /**
   * Speaks one short word to pay the first inference up front.
   *
   * It also builds the embedding of the voice, which the addon then keeps, so
   * the first sentence of the call only pays for its own generation.
   */
  private async warmup(): Promise<void> {
    const synthesizer = await loadSynthesizer(this.getSynthesizerOptions())
    await synthesizer.generateAsync({
      text: 'Hello.',
      generationConfig: this.getGenerationConfig(),
    })
  }

  private getGenerationConfig(): GenerationConfig {
    const { options } = this
    const voice = loadVoice(
      resolveVoicePath(options.modelDir, options.voice ?? DEFAULT_VOICE)
    )

    return new sherpa.GenerationConfig({
      speed: options.speed,
      numSteps: options.numSteps ?? DEFAULT_NUM_STEPS,
      referenceAudio: voice.samples,
      referenceSampleRate: voice.sampleRate,
      extra: {
        max_reference_audio_len:
          options.referenceLength ?? DEFAULT_REFERENCE_LENGTH,
        ...(options.seed === undefined ? {} : { seed: options.seed }),
      },
    })
  }

  private getSynthesizerOptions(): SynthesizerOptions {
    return {
      modelDir: this.options.modelDir,
      numThreads: this.options.numThreads,
      provider: this.options.provider,
    }
  }
}
