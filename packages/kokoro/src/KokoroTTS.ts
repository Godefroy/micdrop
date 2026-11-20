import { float32ToPcm16, SentenceTTS } from '@micdrop/server'
import {
  KokoroDevice,
  KokoroDtype,
  loadSynthesizer,
  SynthesizerOptions,
  warmupSynthesizer,
} from './synthesizer'
import { KokoroVoiceName, resolveVoice } from './voices'

/**
 * Local Kokoro text to speech, running in the Node process through
 * Transformers.js and ONNX Runtime. Nothing leaves the machine and no server
 * has to be started next to it.
 *
 * Kokoro only speaks English here: kokoro-js phonemizes every input with the
 * English rules, so the French and Asian voices of the upstream model would
 * come out with an English accent. @micdrop/piper covers the other languages.
 *
 * @see https://huggingface.co/hexgrad/Kokoro-82M
 */

export interface KokoroTTSOptions {
  /** Repository holding the ONNX export of Kokoro. */
  model?: string

  /** A shorthand ("britishFemale") or a Kokoro voice id ("af_heart"). */
  voice?: KokoroVoiceName | (string & {})

  /** Speech rate, 1 being the natural pace of the voice. */
  speed?: number

  /** Weight precision, "q8" by default. */
  dtype?: KokoroDtype

  /** Execution provider passed to Transformers.js, "cpu" by default. */
  device?: KokoroDevice

  /** Synthesizes one word at startup, on by default. */
  warmup?: boolean
}

const DEFAULT_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const DEFAULT_VOICE: KokoroVoiceName = 'americanFemale'
const DEFAULT_DTYPE: KokoroDtype = 'q8'
const DEFAULT_DEVICE: KokoroDevice = 'cpu'
const KOKORO_SAMPLE_RATE = 24000 // Rate of the audio Kokoro generates, sent as is

export class KokoroTTS extends SentenceTTS {
  // Read from the audio, which states its rate
  private rate = KOKORO_SAMPLE_RATE

  get sampleRate() {
    return this.rate
  }

  constructor(private readonly options: KokoroTTSOptions = {}) {
    super()

    const synthesizerOptions = this.getSynthesizerOptions()
    loadSynthesizer(synthesizerOptions).catch((error) => {
      console.error('[KokoroTTS] Failed to load model:', error)
    })

    if (options.warmup !== false) {
      warmupSynthesizer(synthesizerOptions, this.getVoice())
        .then(() => this.log('Model warmed up'))
        .catch(() => {})
    }
  }

  protected async synthesize(
    text: string,
    signal: AbortSignal
  ): Promise<Buffer | undefined> {
    const synthesizer = await loadSynthesizer(this.getSynthesizerOptions())
    // The utterance may have been cancelled while the model was loading
    if (signal.aborted) return

    const audio = await synthesizer.generate(text, {
      voice: this.getVoice() as never,
      speed: this.options.speed,
    })
    if (signal.aborted) return

    this.rate = audio.sampling_rate || KOKORO_SAMPLE_RATE
    return float32ToPcm16(audio.audio)
  }

  private getVoice(): string {
    return resolveVoice(this.options.voice ?? DEFAULT_VOICE)
  }

  private getSynthesizerOptions(): SynthesizerOptions {
    return {
      model: this.options.model ?? DEFAULT_MODEL,
      dtype: this.options.dtype ?? DEFAULT_DTYPE,
      device: this.options.device ?? DEFAULT_DEVICE,
    }
  }
}
