import { pcm16ToFloat32, STT } from '@micdrop/server'
import { Readable } from 'stream'
import { filterHallucination } from './hallucinations'
import { WhisperModelName } from './models'
import {
  loadTranscriber,
  TranscriberOptions,
  warmupTranscriber,
} from './transcriber'

/**
 * Local Whisper speech to text, running in the Node process through
 * Transformers.js and ONNX Runtime. Nothing leaves the machine and no server
 * has to be started next to it.
 *
 * Micdrop hands over one utterance at a time, already cut by the voice
 * activity detection of the client, so the audio is transcribed in one pass
 * when the stream ends rather than streamed to the model. On a recent laptop a
 * five second sentence comes back in a few hundred milliseconds with the base
 * model.
 *
 * @see https://huggingface.co/docs/transformers.js
 */

export interface WhisperSTTOptions {
  /**
   * A shorthand ("tiny", "base", "small", "turbo") or the id of any Hugging
   * Face repository holding an ONNX export of Whisper.
   */
  model?: WhisperModelName | (string & {})

  /**
   * Spoken language as a two letter code ("en", "fr"). Leaving it out lets
   * Whisper detect it, which costs a little time and occasionally picks wrong
   * on short sentences, so set it when the call has a known language.
   */
  language?: string

  /** Weight precision, either one value or one per sub-model. */
  dtype?: string | Record<string, string>

  /** Execution provider passed to Transformers.js, "cpu" by default. */
  device?: string

  /** Where the weights are downloaded, defaults to the Transformers.js cache. */
  cacheDir?: string

  /**
   * Utterances shorter than this are answered with an empty transcript instead
   * of being sent to the model, which invents words when given a fragment.
   */
  minDurationMs?: number

  /**
   * Utterances longer than this are transcribed in overlapping windows, since
   * Whisper itself only reads thirty seconds at a time.
   */
  chunkDurationMs?: number

  /** Drops sound tags and subtitle credits, see hallucinations.ts. */
  filterHallucinations?: boolean

  /** Runs one inference on silence at startup, on by default. */
  warmup?: boolean
}

const DEFAULT_MODEL: WhisperModelName = 'base'
const DEFAULT_DEVICE = 'cpu'
const DEFAULT_DTYPE = 'q8'
const DEFAULT_MIN_DURATION_MS = 250
const DEFAULT_CHUNK_DURATION_MS = 30000
const SAMPLE_RATE = 16000 // Rate of the incoming audio (Micdrop client)

export class WhisperSTT extends STT {
  private generation = 0 // Bumped by destroy() to drop work in flight
  // Settles once the latest utterance has been emitted. Utterances are
  // transcribed at the same time but emitted in the order they were spoken,
  // each one waiting for the previous: a short sentence would otherwise
  // overtake a long one said before it.
  private emitted: Promise<void> = Promise.resolve()

  constructor(private readonly options: WhisperSTTOptions = {}) {
    super()

    // Start loading now rather than on the first sentence. The promise is not
    // kept: a failed load leaves the shared cache, and the next utterance
    // loads again instead of failing forever on this rejection.
    const transcriberOptions = this.getTranscriberOptions()
    loadTranscriber(transcriberOptions).catch((error) => {
      console.error('[WhisperSTT] Failed to load model:', error)
    })

    if (options.warmup !== false) {
      warmupTranscriber(transcriberOptions)
        .then(() => this.log('Model warmed up'))
        .catch(() => {})
    }
  }

  transcribe(audioStream: Readable) {
    const generation = this.generation
    const chunks: Buffer[] = []

    audioStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    audioStream.on('error', (error) => {
      this.log('Error in audio stream', error)
    })

    audioStream.on('end', () => {
      if (generation !== this.generation) return
      const outcome = this.process(Buffer.concat(chunks), chunks)
      this.emitted = this.emitted
        .then(() => outcome)
        .then((emitOutcome) => {
          if (generation === this.generation) emitOutcome()
        })
        .catch((error) => {
          console.error('[WhisperSTT] Error emitting transcript:', error)
        })
    })
  }

  destroy() {
    // Weights stay in the shared cache, only this call stops using them
    this.generation++
    super.destroy()
  }

  /**
   * Transcribes one utterance, resolving with the function that emits its
   * outcome. It never rejects, a failure is emitted as Failed.
   */
  private async process(audio: Buffer, chunks: Buffer[]): Promise<() => void> {
    const durationMs = (audio.length / 2 / SAMPLE_RATE) * 1000
    const minDuration = this.options.minDurationMs ?? DEFAULT_MIN_DURATION_MS

    if (durationMs < minDuration) {
      return () => {
        this.log(`Utterance too short (${Math.round(durationMs)}ms), skipping`)
        this.emit('Transcript', '')
      }
    }

    try {
      const transcript = await this.run(audio, durationMs)
      return () => {
        this.log(`Transcript: "${transcript}"`)
        this.emit('Transcript', transcript)
      }
    } catch (error) {
      return () => {
        console.error('[WhisperSTT] Transcription error:', error)
        this.emit('Failed', chunks)
      }
    }
  }

  private async run(audio: Buffer, durationMs: number): Promise<string> {
    const transcriber = await loadTranscriber(this.getTranscriberOptions())
    const samples = pcm16ToFloat32(audio)
    const chunkDurationMs =
      this.options.chunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS

    this.log(`Transcribing ${Math.round(durationMs)}ms of audio`)

    const result = await transcriber(samples, {
      language: this.options.language,
      task: 'transcribe',
      // Whisper reads thirty seconds at a time, longer utterances are split
      // into overlapping windows that Transformers.js stitches back together
      ...(durationMs > chunkDurationMs
        ? { chunk_length_s: chunkDurationMs / 1000, stride_length_s: 5 }
        : {}),
    })

    const text = Array.isArray(result)
      ? result.map((item) => item.text ?? '').join(' ')
      : (result.text ?? '')

    return this.options.filterHallucinations === false
      ? text.trim()
      : filterHallucination(text)
  }

  private getTranscriberOptions(): TranscriberOptions {
    return {
      model: this.options.model ?? DEFAULT_MODEL,
      dtype: this.options.dtype ?? DEFAULT_DTYPE,
      device: this.options.device ?? DEFAULT_DEVICE,
      cacheDir: this.options.cacheDir,
    }
  }
}
