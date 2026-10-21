import { float32ToPcm16, Pcm16Resampler, SentenceTTS } from '@micdrop/server'

/**
 * Mistral text to speech (Voxtral Speech 3)
 *
 * @see https://docs.mistral.ai/studio/audio/text-to-speech/overview
 * @see https://docs.mistral.ai/api/endpoint/audio/speech
 *
 * The speech endpoint reads a whole text at once, so the answer is cut into
 * sentences, and the audio of each one is emitted as the server streams it.
 * A sentence starts playing in about half a second and is generated several
 * times faster than it is spoken, so the next one is ready before the current
 * one ends.
 */

export interface MistralTTSOptions {
  apiKey: string
  model?: string
  // Preset voice (`voice_592` for Marie in French, `gb_jane_neutral`...) or
  // the id of a voice saved in your Mistral account
  voiceId?: string
  // A few seconds of speech to clone, base64 encoded, used instead of voiceId
  refAudio?: string
  // Extra fields of the request body, such as phoneme_hints
  settings?: Record<string, unknown>
  // API address, to reach the European or US endpoint
  baseUrl?: string
}

const DEFAULT_MODEL = 'voxtral-mini-tts-3-0'
const DEFAULT_VOICE_ID = 'voice_3150' // James, American English
const DEFAULT_BASE_URL = 'https://api.mistral.ai'
const MISTRAL_SAMPLE_RATE = 24000 // Rate of the pcm output from Mistral
const OUTPUT_SAMPLE_RATE = 16000 // Rate expected by the Micdrop client
const FLOAT32_BYTES = 4 // The pcm output is mono float32 little-endian

export class MistralTTS extends SentenceTTS {
  constructor(private readonly options: MistralTTSOptions) {
    super()
  }

  protected async synthesize(
    text: string,
    signal: AbortSignal
  ): Promise<undefined> {
    const response = await this.request(text, signal)
    if (!response.body) throw new Error('Mistral answered without a body')

    // One resampler per sentence: two sentences are independent streams, so
    // the fractional position must not carry over from one to the next
    const resampler = new Pcm16Resampler(
      MISTRAL_SAMPLE_RATE,
      OUTPUT_SAMPLE_RATE
    )
    // Half of a float32 sample split between two events
    let leftover = Buffer.alloc(0)

    for await (const event of readEvents(response.body, signal)) {
      if (event.type === 'error') {
        throw new Error(
          `Speech generation failed: ${JSON.stringify(event.error ?? event)}`
        )
      }
      if (event.type !== 'speech.audio.delta' || !event.audio_data) continue

      const data = Buffer.concat([
        leftover,
        Buffer.from(event.audio_data, 'base64'),
      ])
      const length = data.length - (data.length % FLOAT32_BYTES)
      leftover = data.subarray(length)
      const samples = new Float32Array(length / FLOAT32_BYTES)
      for (let i = 0; i < samples.length; i++) {
        samples[i] = data.readFloatLE(i * FLOAT32_BYTES)
      }

      // Cancelled or replaced, the rest is not wanted
      if (!this.emitAudio(resampler.process(float32ToPcm16(samples)))) break
    }

    return undefined
  }

  private async request(text: string, signal: AbortSignal) {
    const { options } = this
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      signal,
      body: JSON.stringify({
        ...options.settings,
        model: options.model || DEFAULT_MODEL,
        input: text,
        ...(options.refAudio
          ? { ref_audio: options.refAudio }
          : { voice_id: options.voiceId || DEFAULT_VOICE_ID }),
        // Raw samples rather than wav, so chunks can be concatenated without a
        // header in the middle of the audio
        response_format: 'pcm',
        stream: true,
      }),
    })

    if (!response.ok) {
      const details = await response.text().catch(() => '')
      throw new Error(
        `Mistral answered ${response.status} ${response.statusText}: ${details}`
      )
    }

    return response
  }
}

/** Parses the server-sent events of the response, one JSON payload each. */
async function* readEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<any> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) yield JSON.parse(data)
      }
    }
  } finally {
    // Closing the body closes the connection, and the server stops generating
    reader.cancel().catch(() => {})
  }
}
